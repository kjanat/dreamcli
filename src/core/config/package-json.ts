/**
 * Package.json auto-discovery via directory walk-up.
 *
 * Walks up from `adapter.cwd` to find the nearest `package.json`, parses
 * it, and extracts metadata (name, version, description, bin). All I/O
 * flows through the adapter — fully testable with virtual filesystems.
 *
 * @module dreamcli/core/config/package-json
 */

import type { RuntimeAdapter } from '../../runtime/adapter.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of package.json fields relevant to CLI metadata.
 *
 * All fields are optional — a valid package.json may omit any of them.
 */
interface PackageJsonData {
	readonly name: string | undefined;
	readonly version: string | undefined;
	readonly description: string | undefined;
	readonly bin: string | Readonly<Record<string, string>> | undefined;
}

/**
 * The subset of {@link RuntimeAdapter} needed for package.json discovery.
 *
 * Using a narrow pick keeps the function easy to test and makes the
 * dependency explicit.
 */
type PackageJsonAdapter = Pick<RuntimeAdapter, 'readFile' | 'cwd'>;

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

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
	const sep = path.includes('\\') ? '\\' : '/';
	const idx = path.lastIndexOf(sep);
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

// ---------------------------------------------------------------------------
// discoverPackageJson
// ---------------------------------------------------------------------------

/**
 * Discover the nearest `package.json` by walking up from `adapter.cwd`.
 *
 * Returns the parsed metadata on success, `null` when no `package.json`
 * is found (not an error). Malformed JSON and non-object roots also
 * return `null` — the feature is a convenience, not a hard requirement.
 *
 * @example
 * ```ts
 * import { discoverPackageJson } from 'dreamcli';
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
			return parsePackageJson(content);
		}
		dir = parentDir(dir);
	}

	return null;
}

// ---------------------------------------------------------------------------
// parsePackageJson
// ---------------------------------------------------------------------------

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
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return null;
		}
		const pkg = parsed as Record<string, unknown>;
		return {
			name: typeof pkg['name'] === 'string' ? pkg['name'] : undefined,
			version: typeof pkg['version'] === 'string' ? pkg['version'] : undefined,
			description: typeof pkg['description'] === 'string' ? pkg['description'] : undefined,
			bin: parseBinField(pkg['bin']),
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
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		// Validate all values are strings
		for (const v of Object.values(obj)) {
			if (typeof v !== 'string') return undefined;
		}
		return obj as Record<string, string>;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// inferCliName
// ---------------------------------------------------------------------------

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
 * import { inferCliName } from 'dreamcli';
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { discoverPackageJson, inferCliName };
export type { PackageJsonAdapter, PackageJsonData };
