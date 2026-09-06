/**
 * Config file and package manifest discovery.
 *
 * `CLIBuilder.run()` loads discovery code on demand when config or manifest
 * discovery runs. Preloaded `.manifest(data)` keeps discovery cold.
 * Import this module directly to run discovery from your own
 * bootstrap code or to register custom config formats.
 *
 * @module @kjanat/dreamcli/config
 */

export type {
	ConfigAdapter,
	ConfigDiscoveryOptions,
	ConfigDiscoveryResult,
	ConfigFound,
	ConfigNotFound,
	ConfigSearchPathOptions,
	FormatLoader,
	ManifestDiscoveryOptions,
	PackageJsonAdapter,
	PackageJsonData,
	PackageRepository,
	PackageRepositoryUrlOptions,
} from './core/config/index.ts';
export {
	buildConfigSearchPaths,
	configFormat,
	discoverConfig,
	discoverManifest,
	inferCliName,
	packageRepositoryUrl,
} from './core/config/index.ts';
