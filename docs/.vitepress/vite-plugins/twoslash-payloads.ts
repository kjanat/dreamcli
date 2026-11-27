/** Extract static Twoslash popper slots before Vue compiles the page. @module */
import { createHash } from 'node:crypto';
import type { ShikiTransformer } from '@shikijs/core';
import { hastToHtml } from '@shikijs/core';
import type { Element, Root } from 'hast';
import type { Plugin } from 'vitepress';

export function twoslashPayloads() {
	const name = 'dreamcli-twoslash-payloads';
	const assets = new Map<string, string>();
	let building = false;

	function visit(node: Element | Root): void {
		if (node.type === 'element' && node.tagName === 'v-menu') {
			const slot = node.children.find(
				(child): child is Element =>
					child.type === 'element' &&
					child.tagName === 'template' &&
					'v-slot:popper' in child.properties,
			);
			if (slot?.content) {
				node.tagName = 'twoslash-menu';
				if (building) {
					const markup = hastToHtml(slot.content);
					const id = createHash('sha256').update(markup).digest('hex').slice(0, 24);
					assets.set(id, markup);
					node.properties.payload = `/assets/twoslash/${id}.txt`;
					node.children.splice(node.children.indexOf(slot), 1);
				}
			}
		}
		for (const child of node.children) {
			if (child.type === 'element') visit(child);
		}
	}

	const transformer: ShikiTransformer = {
		name,
		root(root) {
			if ('twoslash' in this.meta) visit(root);
		},
	};
	const plugin: Plugin = {
		name,
		apply: 'build',
		configResolved() {
			building = true;
		},
		generateBundle() {
			for (const [id, source] of assets) {
				this.emitFile({ type: 'asset', fileName: `assets/twoslash/${id}.txt`, source });
			}
		},
	};
	return { transformer, plugin };
}
