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

import type { RuntimeAdapter } from '../../runtime/adapter.ts';
import { CLIError } from '../errors/index.ts';

// ---------------------------------------------------------------------------
// Types — format loaders
// ---------------------------------------------------------------------------

/**
 * Format loader — parses file content into a config object.
 *
 * Implementations must throw on syntax errors; the caller wraps them as
 * {@link CLIError} with code `CONFIG_PARSE_ERROR`.
 */
interface FormatLoader {
	/** File extensions this loader handles (without leading dot, e.g. `'toml'`). */
	readonly extensions: readonly string[];

	/** Parse file content into a config object. Must return a plain object or throw. */
	readonly parse: (content: string) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Types — discovery options + result
// ---------------------------------------------------------------------------

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
	readonly found: false;
}

/** Discriminated result of config discovery. */
type ConfigDiscoveryResult = ConfigFound | ConfigNotFound;

// ---------------------------------------------------------------------------
// Built-in JSON loader
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildConfigSearchPaths
// ---------------------------------------------------------------------------

/**
 * Build the default config search paths for an app.
 *
 * Exported for help text rendering, debugging, and custom search logic.
 *
 * Search order (first match wins):
 * 1. `$CWD/.{appName}.json` — dotfile in project root
 * 2. `$CWD/{appName}.config.json` — explicit config in project root
 * 3. `$CONFIG_DIR/{appName}/config.json` — XDG / AppData standard
 *
 * When custom {@link ConfigDiscoveryOptions.loaders | loaders} are registered,
 * each path pattern is repeated per supported extension (JSON always first).
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

// ---------------------------------------------------------------------------
// buildLoaderMap
// ---------------------------------------------------------------------------

/**
 * Build extension → loader lookup. Later loaders for the same extension
 * override earlier ones (allows user to replace the built-in JSON loader).
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

// ---------------------------------------------------------------------------
// discoverConfig
// ---------------------------------------------------------------------------

/**
 * The subset of {@link RuntimeAdapter} needed for config discovery.
 *
 * Using a narrow pick keeps the function easy to test and makes the
 * dependency explicit.
 */
type ConfigAdapter = Pick<RuntimeAdapter, 'readFile' | 'cwd' | 'configDir'>;

/**
 * Discover and load a config file.
 *
 * Pure function — all filesystem I/O flows through `adapter.readFile`.
 * Returns a discriminated union: `{ found: true, ... }` when a config
 * file was found and parsed, `{ found: false }` when no file exists.
 *
 * @throws {CLIError} code `CONFIG_NOT_FOUND` — explicit `configPath` doesn't exist
 * @throws {CLIError} code `CONFIG_PARSE_ERROR` — file exists but fails to parse
 * @throws {CLIError} code `CONFIG_UNKNOWN_FORMAT` — no loader for the file extension
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

// ---------------------------------------------------------------------------
// configFormat — convenience factory for FormatLoader
// ---------------------------------------------------------------------------

/**
 * Create a {@link FormatLoader} from extensions and a parse function.
 *
 * Convenience factory for the plugin hook — avoids manually constructing
 * the `{ extensions, parse }` object.
 *
 * @param extensions - File extensions this loader handles (without dot, e.g. `'yaml'`).
 * @param parse - Parse function: takes file content string, returns a plain config object.
 *
 * @example
 * ```ts
 * import { configFormat } from 'dreamcli';
 * import { parse as parseYAML } from 'yaml';
 *
 * const yamlLoader = configFormat(['yaml', 'yml'], parseYAML);
 *
 * cli('myapp')
 *   .config('myapp')
 *   .configLoader(yamlLoader)
 *   .run();
 * ```
 */
function configFormat(
	extensions: readonly string[],
	parse: (content: string) => Record<string, unknown>,
): FormatLoader {
	return { extensions, parse };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { buildConfigSearchPaths, configFormat, discoverConfig };
export { discoverPackageJson, inferCliName } from './package-json.ts';
export type {
	ConfigAdapter,
	ConfigDiscoveryOptions,
	ConfigDiscoveryResult,
	ConfigFound,
	ConfigNotFound,
	FormatLoader,
};
export type { PackageJsonAdapter, PackageJsonData } from './package-json.ts';
