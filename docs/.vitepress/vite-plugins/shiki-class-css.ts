/**
 * Vite plugin that serves Shiki CSS classes as a virtual CSS module.
 *
 * @module
 */

import { transformerStyleToClass } from '@shikijs/transformers';
import type { Plugin } from 'vitepress';

const shikiClasses = transformerStyleToClass();

/** Serves collected Shiki CSS classes as a virtual CSS module. */
function shikiClassCssPlugin(): Plugin {
	const virtualId = 'virtual:shiki-class.css';
	const resolvedId = `\0${virtualId}`;
	return {
		name: 'shiki-class-css',
		resolveId(id) {
			if (id === virtualId) return resolvedId;
		},
		load(id) {
			if (id === resolvedId) return shikiClasses.getCSS();
		},
	};
}

export { shikiClassCssPlugin, shikiClasses };
