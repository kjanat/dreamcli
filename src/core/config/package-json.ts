/**
 * Package.json auto-discovery via directory walk-up.
 *
 * Walks up from `adapter.cwd` to find the nearest `package.json`, parses
 * it, and extracts metadata (name, version, description, bin). All I/O
 * flows through the adapter — fully testable with virtual filesystems.
 *
 * @module dreamcli/core/config/package-json
 */

import * as z from 'zod';
import { isRecord } from '#internals/core/internal/guards.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';

// --- Validation schemas

/**
 * Zod schema describing the package.json fields this module reads.
 *
 * The root must be a loose object (shared {@link isRecord} semantics — any
 * non-null, non-array object). Each field is independently coerced: non-string
 * `name`/`version`/`description` and malformed `bin` values are dropped rather
 * than rejected, matching the historical hand-checked extraction. Parsing never
 * throws here — callers convert failure to a `null` return.
 *
 * @internal
 */
const binSchema = z.union([
	z.string(),
	// Object bin: a record of string→string; any non-string value drops the
	// whole field (parse fails), matching the historical hand-checked extraction.
	z.record(z.string(), z.string()),
]);

/** @internal */
const packageJsonSchema = z
	.custom<Record<string, unknown>>((value) => isRecord(value))
	.transform((obj) => {
		const name = z.string().safeParse(obj['name']);
		const version = z.string().safeParse(obj['version']);
		const description = z.string().safeParse(obj['description']);
		const bin = binSchema.safeParse(obj['bin']);
		return {
			...(name.success ? { name: name.data } : {}),
			...(version.success ? { version: version.data } : {}),
			...(description.success ? { description: description.data } : {}),
			...(bin.success ? { bin: bin.data } : {}),
		} satisfies PackageJsonData;
	});

// --- Types

/**
 * Subset of package.json fields relevant to CLI metadata.
 *
 * All fields are optional — a valid package.json may omit any of them.
 */
interface PackageJsonData {
	/** Package name (e.g. `@scope/mycli`). */
	readonly name?: string;
	/** Semver version string from `package.json`. */
	readonly version?: string;
	/** One-line package description. */
	readonly description?: string;
	/** Binary entry point(s) — string for single-bin, object for multi-bin. */
	readonly bin?: string | Readonly<Record<string, string>>;
}

/**
 * The subset of {@link RuntimeAdapter} needed for package.json discovery.
 *
 * Using a narrow pick keeps the function easy to test and makes the
 * dependency explicit.
 */
type PackageJsonAdapter = Pick<RuntimeAdapter, 'readFile' | 'cwd'>;

// --- Path utilities

/**
 * Compute the parent directory of a path using the separator detected
 * from the path itself.
 *
 * Returns `undefined` when the path is already the root (e.g. `/` or `C:\`).
 * Pure string manipulation — no filesystem access.
 *
 * @internal
 */
function parentDir(path: string): string | undefined {
	// Handle mixed separators (common on Windows) by finding the last of either.
	const fwdIdx = path.lastIndexOf('/');
	const bkIdx = path.lastIndexOf('\\');
	const idx = Math.max(fwdIdx, bkIdx);
	// Derive separator from whichever was found last (for drive root construction).
	const sep = bkIdx > fwdIdx ? '\\' : '/';
	// Already at root (Unix `/` or Windows `C:\`)
	if (idx < 0) return undefined;
	if (idx === 0) return path.length > 1 ? sep : undefined;
	const parent = path.slice(0, idx);
	// Windows drive root: `C:` → `C:\`, but already AT drive root → stop
	if (parent.length === 2 && parent[1] === ':') {
		const driveRoot = `${parent}${sep}`;
		return driveRoot === path ? undefined : driveRoot;
	}
	return parent;
}

/**
 * Join a base path with a filename segment.
 *
 * @internal
 */
function joinPath(base: string, segment: string): string {
	const sep = base.includes('\\') ? '\\' : '/';
	return base.endsWith(sep) ? `${base}${segment}` : `${base}${sep}${segment}`;
}

// --- discoverPackageJson

/**
 * Discover the nearest `package.json` by walking up from `startDir` (or
 * `adapter.cwd` when omitted).
 *
 * Convenience helper behind `CLIBuilder.packageJson()`. Most apps should let
 * the CLI runtime discover package metadata automatically; call this directly
 * when testing metadata inference or embedding the behavior in custom tooling.
 *
 * Returns the parsed metadata on success, `null` when no `package.json`
 * is found (not an error). Malformed JSON and non-object roots also
 * return `null` — the feature is a convenience, not a hard requirement.
 *
 * @param adapter - Adapter providing `readFile` + `cwd`.
 * @param startDir - Optional explicit directory or file path to walk up from.
 *   Pass an absolute path inside your own package (e.g.
 *   `fileURLToPath(import.meta.url)`) when authoring an installable CLI whose
 *   version should reflect the CLI's own package, not the consumer's working
 *   directory. Defaults to `adapter.cwd` when `undefined`. A file path is
 *   probed as a directory first (yielding nothing) before the walk-up reaches
 *   its real parent directory, so passing `import.meta.url` resolves correctly.
 *
 * @example
 * ```ts
 * import { discoverPackageJson } from '@kjanat/dreamcli';
 *
 * const pkg = await discoverPackageJson(adapter);
 * if (pkg !== null) {
 *   console.log(pkg.version); // '1.2.3'
 * }
 * ```
 */
async function discoverPackageJson(
	adapter: PackageJsonAdapter,
	startDir?: string,
): Promise<PackageJsonData | null> {
	let dir: string | undefined = startDir ?? adapter.cwd;

	while (dir !== undefined) {
		let content: string | null = null;
		try {
			content = await adapter.readFile(joinPath(dir, 'package.json'));
		} catch {
			// Adapter may throw on permission errors, is-directory, or other
			// syscall failures — skip this directory and keep walking up.
		}
		if (content !== null) {
			const parsed = parsePackageJson(content);
			if (parsed !== null) {
				return parsed;
			}
		}
		dir = parentDir(dir);
	}

	return null;
}

// --- parsePackageJson

/**
 * Parse a package.json content string into {@link PackageJsonData}.
 *
 * Returns `null` for malformed JSON or non-object roots.
 *
 * @internal
 */
function parsePackageJson(content: string): PackageJsonData | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	// zod validates the root shape and extracts/coerces fields. A non-object
	// root fails the schema, yielding the historical `null` return rather than
	// a thrown error.
	const result = packageJsonSchema.safeParse(parsed);
	return result.success ? result.data : null;
}

// --- inferCliName

/**
 * Infer the CLI binary name from package.json data.
 *
 * Resolution order:
 * 1. First key of `bin` object (e.g. `{"mycli": "./dist/cli.js"}` → `"mycli"`)
 * 2. Package `name` with scope stripped (e.g. `"@scope/mycli"` → `"mycli"`)
 * 3. `undefined` if neither exists
 *
 * @example
 * ```ts
 * import { inferCliName } from '@kjanat/dreamcli';
 *
 * inferCliName({ bin: { mycli: './dist/cli.js' } }); // 'mycli'
 * inferCliName({ name: '@scope/mycli' });             // 'mycli'
 * inferCliName({ name: 'mycli' });                    // 'mycli'
 * inferCliName({});                                   // undefined
 * ```
 */
function inferCliName(pkg: PackageJsonData): string | undefined {
	// Prefer bin key name
	if (typeof pkg.bin === 'object') {
		const keys = Object.keys(pkg.bin);
		if (keys.length > 0 && keys[0] !== undefined) return keys[0];
	}
	// Fall back to package name, stripped of scope
	if (pkg.name !== undefined) {
		const slashIdx = pkg.name.indexOf('/');
		return slashIdx >= 0 ? pkg.name.slice(slashIdx + 1) : pkg.name;
	}
	return undefined;
}

// --- Exports

export type { PackageJsonAdapter, PackageJsonData };
export { discoverPackageJson, inferCliName };
