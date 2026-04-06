import type { Plugin } from 'vitepress';

import { shikiClassCssPlugin, shikiClasses } from './shiki-class-css.ts';
import { shikiDedupePopupStylesPlugin } from './shiki-dedupe-popup-styles.ts';
import { sourceArtifactsPlugin } from './source-artifacts.ts';

/** Composite Vite plugin for DreamCLI docs. */
function dreamcliDocsPlugin(): Plugin[] {
	return [sourceArtifactsPlugin(), shikiClassCssPlugin(), shikiDedupePopupStylesPlugin()];
}

export { dreamcliDocsPlugin, shikiClasses };
