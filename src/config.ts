/**
 * Config file and package manifest discovery.
 *
 * `CLIBuilder.run()` loads this module on demand when `.config()` or
 * `.manifest()` is active. Import it directly to run discovery from your own
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
