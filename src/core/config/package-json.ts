/**
 * Package.json auto-discovery via directory walk-up.
 *
 * Walks up from `adapter.cwd` to find the nearest `package.json`, parses
 * it, and extracts metadata (name, version, description, bin). All I/O
 * flows through the adapter — fully testable with virtual filesystems.
 *
 * @module dreamcli/core/config/package-json
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { SLASH, stripTrailing } from '#internals/strings.ts';

// --- Narrowing helpers

/** Type guard: narrows `unknown` to a plain (non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Types

/**
 * Object form of the package.json `repository` field
 * (e.g. `{"type":"git","url":"git+https://github.com/u/r.git"}`).
 */
interface PackageRepository {
	/** Version control system type (usually `'git'`). */
	readonly type?: string;
	/** Repository URL or locator. */
	readonly url?: string;
	/** Subdirectory within a monorepo where the package lives. */
	readonly directory?: string;
}

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
	/** Project homepage URL. */
	readonly homepage?: string;
	/** Repository locator — URL/shorthand string or `{type, url, directory}` object. */
	readonly repository?: string | PackageRepository;
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

// --- discoverManifest

/** Default manifest filenames probed when none are supplied. @internal */
const DEFAULT_MANIFEST_FILES: readonly string[] = ['package.json'];

/** Options for {@link discoverManifest}. */
interface ManifestDiscoveryOptions {
	/**
	 * Explicit directory or file path to walk up from. Defaults to
	 * `adapter.cwd` when omitted. Pass an absolute path inside your own package
	 * (e.g. `fileURLToPath(import.meta.url)`) for installable CLIs whose version
	 * should reflect the CLI's own package, not the consumer's working directory.
	 *
	 * This low-level helper takes a resolved path **string** only. The builder
	 * sugar `CLIBuilder.manifest({ from })` exposes the same anchor under the name
	 * `from` and additionally accepts a `file:` URL string or `URL` instance,
	 * normalizing it to a path first.
	 */
	readonly startDir?: string;
	/**
	 * Candidate manifest filenames, in per-directory priority order
	 * (e.g. `['deno.json', 'jsr.json']`). At each directory the first existing
	 * file that carries CLI metadata wins, so the nearest manifest directory
	 * always takes precedence over file order. A file that parses but holds no
	 * recognised metadata (e.g. a config-only `deno.json` with just
	 * `tasks`/`imports`) is skipped, so a sibling `jsr.json` — or a manifest
	 * higher up — can still be found. Defaults to `['package.json']`.
	 *
	 * An empty list is a deliberate no-op: with no candidates to probe, the
	 * walk-up reads nothing and resolves to `null` (consistent with the
	 * "returns `null` when no manifest is found" contract).
	 */
	readonly files?: readonly string[];
}

/**
 * Whether parsed manifest data carries any CLI-relevant metadata.
 *
 * {@link parsePackageJson} returns an empty object for a config-only manifest
 * (e.g. a `deno.json` holding only `tasks` / `imports` / `compilerOptions`).
 * Treating that empty result as a discovery hit would shadow a sibling
 * `jsr.json` and halt the walk-up, silently dropping real metadata. Discovery
 * therefore only accepts a manifest that actually carries at least one
 * recognised field.
 *
 * @internal
 */
function manifestHasMetadata(data: PackageJsonData): boolean {
	return (
		data.name !== undefined ||
		data.version !== undefined ||
		data.description !== undefined ||
		data.bin !== undefined ||
		data.homepage !== undefined ||
		data.repository !== undefined
	);
}

/**
 * Discover the nearest manifest (`package.json`, `deno.json`, `jsr.json`, …)
 * by walking up from `startDir` (or `adapter.cwd` when omitted).
 *
 * Convenience helper behind `CLIBuilder.manifest()`. Most apps should let the
 * CLI runtime discover metadata automatically; call this directly when testing
 * metadata inference or embedding the behavior in custom tooling.
 *
 * Candidate files are parsed as JSON with a JSONC fallback — `package.json`,
 * `deno.json`, `jsr.json`, and `deno.jsonc` all qualify, including files that
 * carry `//` / block comments or trailing commas (common in `deno.json`). A
 * file that fails both parses is skipped, so discovery keeps probing.
 *
 * Returns the parsed metadata on success, `null` when no manifest is found
 * (not an error). Malformed JSON, non-object roots, and config-only manifests
 * that carry no recognised metadata (e.g. a `deno.json` with only `tasks` /
 * `imports`) are all skipped, so discovery keeps probing the remaining
 * candidate files and parent directories — the feature is a convenience, not a
 * hard requirement.
 *
 * @param adapter - Adapter providing `readFile` + `cwd`.
 * @param options - Optional anchor (`startDir`) and candidate filenames (`files`).
 *
 * @example
 * ```ts
 * import { discoverManifest } from '@kjanat/dreamcli';
 *
 * const meta = await discoverManifest(adapter, { files: ['deno.json', 'jsr.json'] });
 * if (meta !== null) {
 *   console.log(meta.version); // '1.2.3'
 * }
 * ```
 */
async function discoverManifest(
	adapter: PackageJsonAdapter,
	options: ManifestDiscoveryOptions = {},
): Promise<PackageJsonData | null> {
	const files = options.files ?? DEFAULT_MANIFEST_FILES;
	let dir: string | undefined = options.startDir ?? adapter.cwd;

	while (dir !== undefined) {
		for (const file of files) {
			let content: string | null = null;
			try {
				content = await adapter.readFile(joinPath(dir, file));
			} catch {
				// Adapter may throw on permission errors, is-directory, or other
				// syscall failures — skip this file and keep probing.
			}
			if (content !== null) {
				const parsed = parsePackageJson(content);
				if (parsed !== null && manifestHasMetadata(parsed)) {
					return parsed;
				}
			}
		}
		dir = parentDir(dir);
	}

	return null;
}

// --- stripJsonc

/** Whitespace characters JSON treats as insignificant. @internal */
function isJsonWhitespace(ch: string): boolean {
	return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Strip JSONC extensions (line/block comments and trailing commas) so the result
 * is plain JSON. String-aware: comment markers and commas inside string literals
 * are preserved verbatim, so a `"https://…"` URL or a `"/* …"` value survives
 * untouched. Runtime-agnostic — no dependencies, plain string scanning.
 *
 * Only invoked as a fallback when strict `JSON.parse` fails, so valid JSON never
 * passes through here.
 *
 * @internal
 */
function stripJsonc(input: string): string {
	// Pass 1 — drop comments outside of strings.
	let decommented = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < input.length; i += 1) {
		const ch = input[i] ?? '';
		if (inString) {
			decommented += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			decommented += ch;
			continue;
		}
		if (ch === '/' && input[i + 1] === '/') {
			i += 2;
			while (i < input.length && input[i] !== '\n') i += 1;
			i -= 1; // let the loop's increment land on (and re-emit) the newline
			continue;
		}
		if (ch === '/' && input[i + 1] === '*') {
			i += 2;
			while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
			i += 1; // skip the '*'; the loop increment skips the closing '/'
			continue;
		}
		decommented += ch;
	}

	// Pass 2 — drop commas immediately before a closing `}` or `]`.
	let result = '';
	inString = false;
	escaped = false;
	for (let i = 0; i < decommented.length; i += 1) {
		const ch = decommented[i] ?? '';
		if (inString) {
			result += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			result += ch;
			continue;
		}
		if (ch === ',') {
			let j = i + 1;
			while (j < decommented.length && isJsonWhitespace(decommented[j] ?? '')) j += 1;
			const next = decommented[j];
			if (next === '}' || next === ']') {
				continue; // trailing comma — omit it
			}
		}
		result += ch;
	}
	return result;
}

// --- parsePackageJson

/**
 * Parse a manifest content string into {@link PackageJsonData}.
 *
 * Strict JSON is parsed directly; on failure, a JSONC fallback strips comments
 * and trailing commas (common in `deno.json`) and retries. Returns `null` for
 * content that is neither valid JSON nor JSONC, or whose root is not an object.
 *
 * @internal
 */
function parsePackageJson(content: string): PackageJsonData | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		// Tolerate JSONC: deno.json is parsed as JSONC by Deno and real files
		// routinely carry comments / trailing commas. Retry after stripping them.
		try {
			parsed = JSON.parse(stripJsonc(content));
		} catch {
			return null;
		}
	}
	try {
		if (!isPlainObject(parsed)) {
			return null;
		}
		const name = typeof parsed['name'] === 'string' ? parsed['name'] : undefined;
		const version = typeof parsed['version'] === 'string' ? parsed['version'] : undefined;
		const description =
			typeof parsed['description'] === 'string' ? parsed['description'] : undefined;
		const bin = parseBinField(parsed['bin']);
		const homepage = typeof parsed['homepage'] === 'string' ? parsed['homepage'] : undefined;
		const repository = parseRepositoryField(parsed['repository']);
		return {
			...(name !== undefined ? { name } : {}),
			...(version !== undefined ? { version } : {}),
			...(description !== undefined ? { description } : {}),
			...(bin !== undefined ? { bin } : {}),
			...(homepage !== undefined ? { homepage } : {}),
			...(repository !== undefined ? { repository } : {}),
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

/**
 * Parse the `repository` field from package.json.
 *
 * Accepts either a locator string (`"repository": "github:u/r"`) or an
 * object (`"repository": { "type": "git", "url": "..." }`). Returns
 * `undefined` for anything else.
 *
 * @internal
 */
function parseRepositoryField(value: unknown): string | PackageRepository | undefined {
	if (typeof value === 'string') return value;
	if (!isPlainObject(value)) return undefined;
	const type = typeof value['type'] === 'string' ? value['type'] : undefined;
	const url = typeof value['url'] === 'string' ? value['url'] : undefined;
	const directory = typeof value['directory'] === 'string' ? value['directory'] : undefined;
	if (type === undefined && url === undefined && directory === undefined) return undefined;
	return {
		...(type !== undefined ? { type } : {}),
		...(url !== undefined ? { url } : {}),
		...(directory !== undefined ? { directory } : {}),
	};
}

// --- packageRepositoryUrl

/** Browsable base URLs for npm repository shorthand prefixes. @internal */
const SHORTHAND_HOSTS: Readonly<Record<string, string>> = {
	github: 'https://github.com',
	gitlab: 'https://gitlab.com',
	bitbucket: 'https://bitbucket.org',
};

/** Strip a trailing `.git` suffix from a repository path. @internal */
function stripGitSuffix(path: string): string {
	return path.endsWith('.git') ? path.slice(0, -'.git'.length) : path;
}

/** Options for {@link packageRepositoryUrl}. */
interface PackageRepositoryUrlOptions {
	/**
	 * Throw a `CLIError` (code `INVALID_REPOSITORY`) instead of returning
	 * `undefined` when the `repository` field is absent or not a recognisable
	 * locator. With `require: true` the return type narrows to `string`, so
	 * callers that know their manifest carries a valid repository need no
	 * assertion — and a bad manifest fails fast with a real message instead
	 * of propagating `undefined`.
	 *
	 * @defaultValue `false`
	 */
	readonly require?: boolean;
}

/**
 * Resolve a package's `repository` field to a browsable `https://` URL.
 *
 * Handles the locator formats npm accepts:
 * - object form: `{ "type": "git", "url": "git+https://github.com/u/r.git" }`
 * - `https`/`git`/`ssh` URLs (`git+` prefix and `.git` suffix stripped)
 * - scp-style locators: `git@github.com:u/r.git`
 * - shorthands: `github:u/r`, `gitlab:u/r`, `bitbucket:u/r`, and bare `u/r`
 *   (GitHub, per npm convention)
 *
 * Returns `undefined` when the field is absent or unrecognised — or, with
 * `{ require: true }`, throws instead and the return type is `string`.
 * (The narrowing cannot key off the input type alone: a present `repository`
 * may still be an empty string, a url-less object, or an unparseable
 * locator, so the `string` promise is backed by the runtime check.)
 *
 * @example
 * ```ts
 * packageRepositoryUrl({ repository: 'git+https://github.com/u/r.git' });
 * // 'https://github.com/u/r'
 *
 * const url: string = packageRepositoryUrl(pkg, { require: true });
 * // throws CLIError when pkg.repository is missing or unrecognised
 * ```
 */
function packageRepositoryUrl(
	pkg: PackageJsonData,
	options: PackageRepositoryUrlOptions & { readonly require: true },
): string;
/** Resolve a package repository URL, returning `undefined` for absent or invalid locators. */
function packageRepositoryUrl(
	pkg: PackageJsonData,
	options?: PackageRepositoryUrlOptions,
): string | undefined;
function packageRepositoryUrl(
	pkg: PackageJsonData,
	options?: PackageRepositoryUrlOptions,
): string | undefined {
	const url = resolveRepositoryUrl(pkg);
	if (url === undefined && options?.require === true) {
		throw new CLIError(
			pkg.repository === undefined
				? "package.json has no 'repository' field"
				: `package.json 'repository' is not a recognisable locator: ${JSON.stringify(pkg.repository)}`,
			{
				code: 'INVALID_REPOSITORY',
				suggest:
					"Set 'repository' to a supported locator (e.g. 'github:user/repo' or 'git+https://github.com/user/repo.git'), or drop { require: true } and handle undefined",
			},
		);
	}
	return url;
}

/** Locator normalization behind {@link packageRepositoryUrl}. @internal */
function resolveRepositoryUrl(pkg: PackageJsonData): string | undefined {
	const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
	if (raw === undefined) return undefined;

	let locator = raw.trim();
	if (locator.length === 0) return undefined;

	// npm shorthands: `github:u/r`, `gitlab:u/r`, `bitbucket:u/r`
	const shorthand = /^(github|gitlab|bitbucket):([^/]+\/[^/]+)$/.exec(locator);
	if (shorthand !== null && shorthand[1] !== undefined && shorthand[2] !== undefined) {
		const host = SHORTHAND_HOSTS[shorthand[1]];
		if (host !== undefined) {
			return `${host}/${stripGitSuffix(shorthand[2])}`;
		}
	}

	// Bare `u/r` implies GitHub (npm convention)
	if (/^[\w.-]+\/[\w.-]+$/.test(locator)) {
		return `https://github.com/${stripGitSuffix(locator)}`;
	}

	if (locator.startsWith('git+')) {
		locator = locator.slice('git+'.length);
	}

	// scp-style locator: `git@github.com:u/r.git`
	const scp = /^git@([^:/]+):(.+)$/.exec(locator);
	if (scp !== null && scp[1] !== undefined && scp[2] !== undefined) {
		return `https://${scp[1]}/${stripGitSuffix(stripTrailing(scp[2], [SLASH]))}`;
	}

	if (!/^(?:https?|git|ssh):\/\//.test(locator)) return undefined;
	try {
		const url = new URL(locator);
		const path = stripGitSuffix(stripTrailing(url.pathname, [SLASH]));
		return `https://${url.hostname}${path}`;
	} catch {
		return undefined;
	}
}

// --- inferCliName

/**
 * Infer the CLI binary name from manifest data.
 *
 * Resolution order:
 * 1. First key of `bin` object (e.g. `{"mycli": "./dist/cli.js"}` → `"mycli"`)
 * 2. Package `name`, scope stripped by default (e.g. `"@scope/mycli"` → `"mycli"`);
 *    pass `{ stripScope: false }` to keep the full scoped name
 * 3. `undefined` if neither exists
 *
 * Note: `bin` keys are never scoped, so `stripScope` only affects the `name`
 * fallback (relevant for `deno.json` / `jsr.json`, which have no `bin` field).
 *
 * @param pkg - Parsed manifest metadata.
 * @param options - `stripScope` (default `true`): strip a leading `@scope/`
 *   from the `name` fallback.
 *
 * @example
 * ```ts
 * import { inferCliName } from '@kjanat/dreamcli';
 *
 * inferCliName({ bin: { mycli: './dist/cli.js' } });        // 'mycli'
 * inferCliName({ name: '@scope/mycli' });                   // 'mycli'
 * inferCliName({ name: '@scope/mycli' }, { stripScope: false }); // '@scope/mycli'
 * inferCliName({ name: 'mycli' });                          // 'mycli'
 * inferCliName({});                                         // undefined
 * ```
 */
function inferCliName(
	pkg: PackageJsonData,
	options: { readonly stripScope?: boolean } = {},
): string | undefined {
	// Prefer bin key name (never scoped).
	if (typeof pkg.bin === 'object') {
		const keys = Object.keys(pkg.bin);
		if (keys.length > 0 && keys[0] !== undefined) return keys[0];
	}
	// Fall back to package name, optionally stripped of scope.
	if (pkg.name !== undefined) {
		if (options.stripScope === false) return pkg.name;
		const slashIdx = pkg.name.indexOf('/');
		return slashIdx >= 0 ? pkg.name.slice(slashIdx + 1) : pkg.name;
	}
	return undefined;
}

// --- Exports

export type {
	ManifestDiscoveryOptions,
	PackageJsonAdapter,
	PackageJsonData,
	PackageRepository,
	PackageRepositoryUrlOptions,
};
export { discoverManifest, inferCliName, packageRepositoryUrl };
