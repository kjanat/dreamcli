/**
 * Build-time version constants.
 *
 * Replaced by tsdown `define` during bundling. In development (unbundled),
 * the declared globals resolve to the `'dev'` fallback.
 *
 * @module dreamcli/version
 * @internal
 */

declare const __DREAMCLI_VERSION__: string;
declare const __DREAMCLI_REVISION__: string;

/** Package version (e.g. `"0.9.1"`). `"dev"` when running unbundled. */
export const DREAMCLI_VERSION: string =
	typeof __DREAMCLI_VERSION__ !== 'undefined' ? __DREAMCLI_VERSION__ : 'dev';

/** Git short SHA (e.g. `"f9b5f1a"`). `"dev"` when running unbundled. */
export const DREAMCLI_REVISION: string =
	typeof __DREAMCLI_REVISION__ !== 'undefined' ? __DREAMCLI_REVISION__ : 'dev';
