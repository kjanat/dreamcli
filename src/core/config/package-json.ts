/**
 * Package.json auto-discovery via directory walk-up.
 *
 * Walks up from `adapter.cwd` to find the nearest `package.json`, parses
 * it, and extracts metadata (name, version, description, bin). All I/O
 * flows through the adapter — fully testable with virtual filesystems.
 *
 * @module dreamcli/core/config/package-json
 */

import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';

// --- Narrowing helpers

/** Type guard: narrows `unknown` to a plain (non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Types

/**
 * Subset of package.json fields relevant to CLI metadata.
 *
 * All fields are optional — a valid package.json may omit any of them.
 */
interface PackageJsonData {
	readonly name?: string;
	readonly version?: string;
	readonly description?: string;
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
 * Discover the nearest `package.json` by walking up from `adapter.cwd`.
 *
 * Convenience helper behind `CLIBuilder.packageJson()`. Most apps should let
 * the CLI runtime discover package metadata automatically; call this directly
 * when testing metadata inference or embedding the behavior in custom tooling.
 *
 * Returns the parsed metadata on success, `null` when no `package.json`
 * is found (not an error). Malformed JSON and non-object roots also
 * return `null` — the feature is a convenience, not a hard requirement.
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
async function discoverPackageJson(adapter: PackageJsonAdapter): Promise<PackageJsonData | null> {
	let dir: string | undefined = adapter.cwd;

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
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isPlainObject(parsed)) {
			return null;
		}
		const name = typeof parsed['name'] === 'string' ? parsed['name'] : undefined;
		const version = typeof parsed['version'] === 'string' ? parsed['version'] : undefined;
		const description =
			typeof parsed['description'] === 'string' ? parsed['description'] : undefined;
		const bin = parseBinField(parsed['bin']);
		return {
			...(name !== undefined ? { name } : {}),
			...(version !== undefined ? { version } : {}),
			...(description !== undefined ? { description } : {}),
			...(bin !== undefined ? { bin } : {}),
		};
	} catch {
		return null;
	}
}

/**
 * Parse the `bin` field from package.json.
 *
 * Accepts either a string (`"bin": "./dist/cli.js"`) or an object
 * (`"bin": { "mycli": "./dist/cli.js" }`). Returns `undefined` for
 * anything else.
 *
 * @internal
 */
function parseBinField(value: unknown): string | Readonly<Record<string, string>> | undefined {
	if (typeof value === 'string') return value;
	if (!isPlainObject(value)) return undefined;
	const result: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof v !== 'string') return undefined;
		result[k] = v;
	}
	return result;
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
