/**
 * Composite Vite plugins for DreamCLI documentation.
 *
 * @module
 */

import type { Plugin } from 'vitepress';

import { shikiClassCssPlugin, shikiClasses } from './shiki-class-css.ts';
import { sourceArtifactsPlugin } from './source-artifacts.ts';

/** Composite Vite plugin for DreamCLI docs. */
function dreamcliDocsPlugin(): Plugin[] {
	// Keep twoslash style dedupe disabled. Raw chunk rewrites leaked `const __s*`
	// into rendered code and broke popup hovers in production builds.
	return [sourceArtifactsPlugin(), shikiClassCssPlugin()];
}

export { dreamcliDocsPlugin, shikiClasses };
