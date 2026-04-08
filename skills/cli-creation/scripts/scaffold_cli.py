#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""
Generate DreamCLI starter files from bundled templates.
"""

import argparse
import json
import re
import sys
from pathlib import Path

MANIFEST_FILENAMES = (
    "package.json",
    "package.json5",
    "package.yaml",
    "package.yml",
)

LOCKFILE_TO_MANAGER = (
    ("bun.lock", "bun"),
    ("bun.lockb", "bun"),
    ("pnpm-lock.yaml", "pnpm"),
    ("pnpm-lock.yml", "pnpm"),
    ("pnpm-workspace.yaml", "pnpm"),
    ("pnpm-workspace.yml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("package-lock.json", "npm"),
    ("npm-shrinkwrap.json", "npm"),
)


def normalize_name(raw: str) -> str:
    name = raw.strip().lower()
    name = re.sub(r"[^a-z0-9]+", "-", name)
    name = name.strip("-")
    name = re.sub(r"-{2,}", "-", name)
    return name


def read_template(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Template not found: {path}")
    return path.read_text()


def render_template(template: str, replacements: dict[str, str]) -> str:
    rendered = template
    for key, value in replacements.items():
        rendered = rendered.replace(key, value)
    if not rendered.endswith("\n"):
        rendered += "\n"
    return rendered


def write_file(path: Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"Refusing to overwrite existing file: {path}. Use --force to overwrite.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def iter_ancestors(path: Path):
    current = path.resolve()
    while True:
        yield current
        if current.parent == current:
            break
        current = current.parent


def lockfiles_for_directory(directory: Path) -> list[Path]:
    lockfiles: list[Path] = []
    for lockfile, _ in LOCKFILE_TO_MANAGER:
        candidate = directory / lockfile
        if candidate.exists():
            lockfiles.append(candidate)

    pnpm_globs = (
        "pnpm-*.yaml",
        "pnpm-*.yml",
    )
    for pattern in pnpm_globs:
        for candidate in sorted(directory.glob(pattern)):
            if candidate not in lockfiles:
                lockfiles.append(candidate)
    return lockfiles


def manifests_for_directory(directory: Path) -> list[Path]:
    manifests: list[Path] = []
    for filename in MANIFEST_FILENAMES:
        candidate = directory / filename
        if candidate.exists():
            manifests.append(candidate)
    return manifests


def package_manager_from_lockfiles(directory: Path) -> str | None:
    for candidate in lockfiles_for_directory(directory):
        if candidate.name.startswith("pnpm-") and candidate.suffix in {".yaml", ".yml"}:
            return "pnpm"
        for lockfile, manager in LOCKFILE_TO_MANAGER:
            if candidate.name == lockfile:
                return manager
    return None


def package_manager_from_manifest(manifest: dict) -> str | None:
    raw_value = manifest.get("packageManager")
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None
    manager = raw_value.split("@", 1)[0].strip().lower()
    if manager in {"bun", "pnpm", "npm", "yarn"}:
        return manager
    return None


def read_text_file(path: Path) -> str | None:
    try:
        return path.read_text(errors="ignore")
    except OSError:
        return None


def package_manager_from_text(raw_text: str) -> str | None:
    match = re.search(
        r'(?mi)^[ \t]*["\']?packageManager["\']?[ \t]*:[ \t]*["\']?([^"\',\n\r#]+)',
        raw_text,
    )
    if match is None:
        return None

    value = match.group(1).strip()
    manager = value.split("@", 1)[0].strip().lower()
    if manager in {"bun", "pnpm", "npm", "yarn"}:
        return manager
    return None


def manifest_text_uses_vitest(raw_text: str) -> bool:
    return re.search(r"\bvitest\b", raw_text) is not None


def detect_package_manager_with_root(start: Path) -> tuple[str | None, Path | None]:
    for directory in iter_ancestors(start):
        for manifest_path in manifests_for_directory(directory):
            if manifest_path.name == "package.json":
                manifest = read_package_json(manifest_path)
                if manifest is not None:
                    from_manifest = package_manager_from_manifest(manifest)
                    if from_manifest is not None:
                        return (from_manifest, directory)

            raw_text = read_text_file(manifest_path)
            if raw_text is not None:
                from_text = package_manager_from_text(raw_text)
                if from_text is not None:
                    return (from_text, directory)

        from_lockfile = package_manager_from_lockfiles(directory)
        if from_lockfile is not None:
            return (from_lockfile, directory)
    return (None, None)


def read_package_json(path: Path) -> dict | None:
    try:
        raw = path.read_text()
        parsed = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def manifest_uses_vitest(manifest: dict) -> bool:
    dependency_fields = (
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    )
    for field in dependency_fields:
        deps = manifest.get(field)
        if isinstance(deps, dict) and "vitest" in deps:
            return True

    scripts = manifest.get("scripts")
    if isinstance(scripts, dict):
        for script in scripts.values():
            if isinstance(script, str) and "vitest" in script:
                return True

    return False


def find_project_root(start: Path) -> Path | None:
    for directory in iter_ancestors(start):
        if package_manager_from_lockfiles(directory) is not None:
            return directory
        if manifests_for_directory(directory):
            return directory
    return None


def iter_to_ancestor(start: Path, ancestor: Path):
    current = start.resolve()
    target = ancestor.resolve()
    while True:
        yield current
        if current == target:
            break
        if current.parent == current:
            break
        current = current.parent


def detect_vitest_usage_in_project(project_root: Path, manager_root: Path | None) -> bool:
    stop_at = manager_root.resolve() if manager_root is not None else project_root.resolve()
    for directory in iter_to_ancestor(project_root, stop_at):
        for manifest_path in manifests_for_directory(directory):
            if manifest_path.name == "package.json":
                manifest = read_package_json(manifest_path)
                if manifest and manifest_uses_vitest(manifest):
                    return True

            raw_text = read_text_file(manifest_path)
            if raw_text is not None and manifest_text_uses_vitest(raw_text):
                return True

    if (stop_at / "node_modules" / "vitest" / "package.json").exists():
        return True

    for lockfile in lockfiles_for_directory(stop_at):
        try:
            if "vitest" in lockfile.read_text(errors="ignore"):
                return True
        except OSError:
            continue

    return False


def choose_test_template(mode: str, package_manager: str | None, uses_vitest: bool) -> tuple[str, str]:
    if package_manager == "bun" and not uses_vitest:
        return (f"{mode}-command.bun-test.ts.tpl", "bun:test")
    return (f"{mode}-command.test.ts.tpl", "vitest")


def choose_test_command(package_manager: str | None, test_framework: str, test_path: str) -> str:
    if test_framework == "bun:test":
        return f"bun test {test_path}"
    if package_manager == "bun":
        return f"bun test {test_path}"
    if package_manager == "pnpm":
        return f"pnpm vitest run {test_path}"
    if package_manager == "yarn":
        return f"yarn vitest run {test_path}"
    return f"npx vitest run {test_path}"


def format_run_path(path: Path, cwd: Path) -> str:
    try:
        relative = path.relative_to(cwd).as_posix()
        if not relative.startswith((".", "..")):
            return f"./{relative}"
        return relative
    except ValueError:
        return path.as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaffold Bun-first DreamCLI starter files from templates.")
    parser.add_argument("--name", required=True, help="CLI name (e.g. mycli)")
    parser.add_argument(
        "--mode",
        choices=["single", "multi"],
        default="single",
        help="Starter shape. single=one root command, multi=nested command groups.",
    )
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument(
        "--no-test",
        action="store_true",
        help="Skip generating the starter test file.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing files if present.",
    )
    args = parser.parse_args()

    cli_name = normalize_name(args.name)
    if not cli_name:
        print("[ERROR] --name must include at least one letter or digit.")
        return 1

    output_dir = Path(args.out).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    skill_root = Path(__file__).resolve().parent.parent
    templates_dir = skill_root / "assets" / "templates"

    entry_template_path = templates_dir / f"{args.mode}-command.ts.tpl"
    test_template_path = templates_dir / f"{args.mode}-command.test.ts.tpl"

    entry_filename = f"{cli_name}.ts"
    entry_path = output_dir / entry_filename
    test_path = output_dir / f"{cli_name}.test.ts"
    include_test = not args.no_test
    project_root = find_project_root(output_dir) or find_project_root(Path.cwd()) or output_dir
    package_manager, manager_root = detect_package_manager_with_root(project_root)
    uses_vitest = detect_vitest_usage_in_project(project_root, manager_root)
    test_framework = "none"

    replacements = {
        "__CLI_NAME__": cli_name,
        "__ENTRY_FILE__": f"./{entry_filename}",
    }

    try:
        entry_template = read_template(entry_template_path)
        entry_content = render_template(entry_template, replacements)
        write_file(entry_path, entry_content, args.force)
        print(f"[OK] Wrote {entry_path}")

        if include_test:
            test_template_name, test_framework = choose_test_template(args.mode, package_manager, uses_vitest)
            test_template_path = templates_dir / test_template_name
            test_template = read_template(test_template_path)
            test_content = render_template(test_template, replacements)
            write_file(test_path, test_content, args.force)
            print(f"[OK] Wrote {test_path}")
    except (FileExistsError, FileNotFoundError) as error:
        print(f"[ERROR] {error}")
        return 1

    print("\nNext steps:")
    run_path = format_run_path(entry_path, Path.cwd())
    test_run_path = format_run_path(test_path, Path.cwd())
    print(f"1. Run: bun {run_path} --help")
    if include_test:
        test_command = choose_test_command(package_manager, test_framework, test_run_path)
        print(f"2. Test: {test_command}")
        if test_framework == "bun:test":
            print("   Detected Bun without vitest; generated a bun:test starter test.")
    else:
        print("2. Re-run without --no-test to include a starter test file")
    print("3. Adapt commands, flags, and prompts to the user request")
    return 0


if __name__ == "__main__":
    sys.exit(main())
