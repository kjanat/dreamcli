/**
 * Config file discovery and loading.
 *
 * Probes a prioritised list of candidate paths, reads the first match via
 * {@link RuntimeAdapter.readFile}, and parses the content using an
 * extension-based loader (JSON built-in, others additive via {@link FormatLoader}).
 *
 * The module is pure — all I/O flows through the adapter, making it fully
 * testable with {@link createTestAdapter}'s virtual filesystem.
 *
 * @module dreamcli/core/config
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';

/** @internal */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

// --- Types — format loaders

/**
 * Format loader — parses file content into a config object.
 *
 * Register custom config formats by providing file extensions and a parser.
 * Parsers may return any parsed value; {@link discoverConfig} validates that
 * the result is a plain object before feeding it into the resolution chain.
 *
 * Implementations should throw on syntax or shape errors; the caller wraps
 * those failures as {@link CLIError} with code `CONFIG_PARSE_ERROR`.
 */
interface FormatLoader {
	/** File extensions this loader handles (without leading dot, e.g. `'toml'`). */
	readonly extensions: readonly string[];

	/**
	 * Parse file content into a config value.
	 *
	 * Arrays, primitives, and `null` are allowed at this boundary so generic
	 * parsers like `Bun.YAML.parse` can be passed directly. Those values are
	 * still rejected by {@link discoverConfig}, which requires a plain object.
	 */
	readonly parse: (content: string) => unknown;
}

// --- Types — discovery options + result

/** Options for {@link discoverConfig}. */
interface ConfigDiscoveryOptions {
	/**
	 * Explicit config file path (`--config` override).
	 * When provided, skips search — loads only this path.
	 */
	readonly configPath?: string;

	/**
	 * Additional format loaders (JSON is built-in).
	 * Later loaders for the same extension win (allows override).
	 */
	readonly loaders?: readonly FormatLoader[];

	/**
	 * Custom search paths (absolute).
	 * Replaces the default search paths when provided.
	 * Probed in order; first found wins.
	 */
	readonly searchPaths?: readonly string[];
}

/** Successful config discovery — file found and parsed. */
interface ConfigFound {
	/** Discriminant — `true` indicates a config file was found and parsed successfully. */
	readonly found: true;
	/** Absolute path to the config file that was loaded. */
	readonly path: string;
	/** Parsed config data. */
	readonly data: Readonly<Record<string, unknown>>;
	/** File extension that determined the loader (e.g. `'json'`). */
	readonly format: string;
}

/** No config file found at any candidate path (not an error). */
interface ConfigNotFound {
	/** Discriminant — `false` indicates no config file exists at any candidate path. */
	readonly found: false;
}

/** Discriminated result of config discovery. */
type ConfigDiscoveryResult = ConfigFound | ConfigNotFound;

// --- Built-in JSON loader

/** @internal */
const jsonLoader: FormatLoader = {
	extensions: ['json'],
	parse: (content: string): Record<string, unknown> => {
		const parsed: unknown = JSON.parse(content);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			throw new Error('Config must be a JSON object');
		}
		return parsed as Record<string, unknown>;
	},
};

// --- Path utilities

/**
 * Join path segments using the separator detected from the base path.
 *
 * Avoids importing `node:path` — the base path is already platform-native
 * (comes from `adapter.cwd` / `adapter.configDir`), so we infer the
 * separator from its content.
 *
 * @internal
 */
function joinPath(base: string, ...segments: readonly string[]): string {
	const sep = base.includes('\\') ? '\\' : '/';
	return [base, ...segments].join(sep);
}

/**
 * Extract the file extension (without leading dot, lowercased).
 * Returns empty string when no extension is present.
 *
 * @internal
 */
function getExtension(path: string): string {
	const lastDot = path.lastIndexOf('.');
	const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	if (lastDot <= lastSep) return '';
	return path.slice(lastDot + 1).toLowerCase();
}

// --- buildConfigSearchPaths

/**
 * Build the default config search paths for an app.
 *
 * Advanced helper used by DreamCLI's config discovery. Most apps should call
 * `.config()` or {@link discoverConfig} instead of constructing search paths
 * manually. Exported for debugging, custom discovery flows, and help text.
 *
 * Search order (first match wins):
 * 1. `$CWD/.{appName}.json` — dotfile in project root
 * 2. `$CWD/{appName}.config.json` — explicit config in project root
 * 3. `$CONFIG_DIR/{appName}/config.json` — XDG / AppData standard
 *    (`$XDG_CONFIG_HOME` / `~/.config` on Unix,
 *    `%APPDATA%` / `%USERPROFILE%\\AppData\\Roaming` on Windows)
 *
 * When custom {@link ConfigDiscoveryOptions.loaders | loaders} are registered,
 * each path pattern is repeated per supported extension (JSON always first).
 *
 * @param appName - CLI application name used to derive config filenames.
 * @param cwd - Current working directory (project-root search location).
 * @param configDir - Platform config directory (XDG / AppData).
 * @param loaders - Optional custom {@link FormatLoader}s whose extensions expand the search set.
 * @returns Ordered list of candidate config file paths (first match wins).
 *
 * @example
 * ```ts
 * const paths = buildConfigSearchPaths('mycli', '/repo', '/home/me/.config');
 * ```
 */
function buildConfigSearchPaths(
	appName: string,
	cwd: string,
	configDir: string,
	loaders?: readonly FormatLoader[],
): readonly string[] {
	const extensions = buildExtensionList(loaders);

	const paths: string[] = [];
	for (const ext of extensions) {
		paths.push(joinPath(cwd, `.${appName}.${ext}`));
	}
	for (const ext of extensions) {
		paths.push(joinPath(cwd, `${appName}.config.${ext}`));
	}
	for (const ext of extensions) {
		paths.push(joinPath(configDir, appName, `config.${ext}`));
	}
	return paths;
}

/**
 * Collect unique extensions from the built-in JSON loader + any custom loaders.
 * JSON always comes first. Order otherwise matches loader registration order.
 *
 * @param loaders - Optional custom {@link FormatLoader}s to append after JSON.
 * @returns Deduplicated, lowercased extension list (JSON first).
 *
 * @internal
 */
function buildExtensionList(loaders?: readonly FormatLoader[]): readonly string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	// JSON first — always built-in
	for (const ext of jsonLoader.extensions) {
		const lower = ext.toLowerCase();
		if (!seen.has(lower)) {
			seen.add(lower);
			result.push(lower);
		}
	}

	// Additional loaders
	if (loaders !== undefined) {
		for (const loader of loaders) {
			for (const ext of loader.extensions) {
				const lower = ext.toLowerCase();
				if (!seen.has(lower)) {
					seen.add(lower);
					result.push(lower);
				}
			}
		}
	}

	return result;
}

// --- buildLoaderMap

/**
 * Build extension → loader lookup. Later loaders for the same extension
 * override earlier ones (allows user to replace the built-in JSON loader).
 *
 * @param loaders - Optional custom {@link FormatLoader}s (later entries override earlier for same extension).
 * @returns Map from lowercased extension to its {@link FormatLoader}.
 *
 * @internal
 */
function buildLoaderMap(loaders?: readonly FormatLoader[]): ReadonlyMap<string, FormatLoader> {
	const map = new Map<string, FormatLoader>();
	for (const ext of jsonLoader.extensions) {
		map.set(ext.toLowerCase(), jsonLoader);
	}
	if (loaders !== undefined) {
		for (const loader of loaders) {
			for (const ext of loader.extensions) {
				map.set(ext.toLowerCase(), loader);
			}
		}
	}
	return map;
}

// --- discoverConfig

/**
 * The subset of {@link RuntimeAdapter} needed for config discovery.
 *
 * Exported so custom hosts and tests can type the minimal adapter required by
 * {@link discoverConfig} without depending on the full runtime adapter shape.
 */
type ConfigAdapter = Pick<RuntimeAdapter, 'readFile' | 'cwd' | 'configDir'>;

/**
 * Discover and load a config file.
 *
 * Low-level discovery helper behind `CLIBuilder.config()`. Most apps should
 * let the CLI runtime call this automatically; call it directly when testing
 * config behavior or building custom bootstrapping around {@linkcode RuntimeAdapter}.
 *
 * Pure function — all filesystem I/O flows through `adapter.readFile`.
 * Returns a discriminated union: `{ found: true, ... }` when a config
 * file was found and parsed, `{ found: false }` when no file exists.
 *
 * @throws {CLIError} code `CONFIG_NOT_FOUND` — explicit `configPath` doesn't exist
 * @throws {CLIError} code `CONFIG_PARSE_ERROR` — file exists but fails to parse
 * @throws {CLIError} code `CONFIG_UNKNOWN_FORMAT` — no loader for the file extension
 *
 * @example
 * ```ts
 * const result = await discoverConfig('mycli', adapter, {
 *   loaders: [
 *     configFormat(['yaml', 'yml'], Bun.YAML.parse),
 *     configFormat(['toml'], Bun.TOML.parse),
 *   ],
 * });
 * ```
 */
async function discoverConfig(
	appName: string,
	adapter: ConfigAdapter,
	options?: ConfigDiscoveryOptions,
): Promise<ConfigDiscoveryResult> {
	const loaderMap = buildLoaderMap(options?.loaders);

	const searchPaths =
		options?.configPath !== undefined
			? [options.configPath]
			: (options?.searchPaths ??
				buildConfigSearchPaths(appName, adapter.cwd, adapter.configDir, options?.loaders));

	for (const candidatePath of searchPaths) {
		const content = await adapter.readFile(candidatePath);

		if (content === null) {
			// Explicit --config path must exist
			if (options?.configPath !== undefined) {
				throw new CLIError(`Config file not found: ${candidatePath}`, {
					code: 'CONFIG_NOT_FOUND',
					details: { path: candidatePath },
					suggest: 'Create the config file or remove the --config flag',
				});
			}
			continue;
		}

		// File found — resolve loader by extension
		const ext = getExtension(candidatePath);
		const loader = loaderMap.get(ext);

		if (loader === undefined) {
			throw new CLIError(`No loader registered for config format: .${ext}`, {
				code: 'CONFIG_UNKNOWN_FORMAT',
				details: { path: candidatePath, extension: ext },
				suggest: `Supported formats: ${[...loaderMap.keys()].join(', ')}`,
			});
		}

		try {
			const data = loader.parse(content);
			if (!isPlainObject(data)) {
				throw new Error('Config loader must return a plain object');
			}
			return { found: true, path: candidatePath, data, format: ext };
		} catch (cause: unknown) {
			throw new CLIError(`Failed to parse config file: ${candidatePath}`, {
				code: 'CONFIG_PARSE_ERROR',
				cause,
				details: {
					path: candidatePath,
					format: ext,
					message: cause instanceof Error ? cause.message : String(cause),
				},
				suggest: 'Check the config file for syntax errors',
			});
		}
	}

	return { found: false };
}

// --- configFormat — convenience factory for FormatLoader

/**
 * Create a {@link FormatLoader} from extensions and a parse function.
 *
 * Convenience factory for config loading. It avoids manually constructing the
 * `{ extensions, parse }` object and makes intent clearer at call sites.
 *
 * Later loaders registered for the same extension override earlier ones. Any
 * error thrown by `parse` is wrapped by {@link discoverConfig} as
 * `CONFIG_PARSE_ERROR`.
 *
 * @param extensions - File extensions this loader handles (without dot, e.g. `'yaml'`).
 * @param parse - Parse function: takes file content string and returns a parsed config value.
 * @returns A {@link FormatLoader} ready to pass to {@link ConfigDiscoveryOptions.loaders}.
 *
 * @example
 * ```ts
 * import { cli, configFormat } from '@kjanat/dreamcli';
 * import { parse as parseYaml } from 'yaml';
 * import { parse as parseTOML } from '@iarna/toml';
 *
 * const yamlPackageLoader = configFormat(['yaml', 'yml'], parseYaml);
 * const tomlPackageLoader = configFormat(['toml'], parseTOML);
 * // Or with Bun's built-in parsers:
 * // const yamlLoader = configFormat(['yaml', 'yml'], Bun.YAML.parse);
 * // const tomlLoader = configFormat(['toml'], Bun.TOML.parse);
 *
 * cli('myapp')
 *   .config('myapp')
 *   .configLoader(yamlLoader)
 *   .configLoader(tomlLoader)
 *   .run();
 * ```
 */
function configFormat(
	extensions: readonly string[],
	parse: (content: string) => unknown,
): FormatLoader {
	return { extensions, parse };
}

// --- Exports

export type { PackageJsonAdapter, PackageJsonData } from './package-json.ts';
export { discoverPackageJson, inferCliName } from './package-json.ts';
export type {
	ConfigAdapter,
	ConfigDiscoveryOptions,
	ConfigDiscoveryResult,
	ConfigFound,
	ConfigNotFound,
	FormatLoader,
};
export { buildConfigSearchPaths, configFormat, discoverConfig };
