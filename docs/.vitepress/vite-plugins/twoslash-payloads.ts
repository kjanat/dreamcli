/** Extract static Twoslash popper slots before Vue compiles the page. @module */
import { createHash } from 'node:crypto';
import type { ShikiTransformer } from '@shikijs/core';
import { hastToHtml } from '@shikijs/core';
import type { VitePressPluginTwoslashOptions } from '@shikijs/vitepress-twoslash';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import type { Element, Root } from 'hast';
import type { Plugin } from 'vitepress';

export function twoslashPayloads() {
	const name = 'dreamcli-twoslash-payloads';
	const assets = new Map<string, string>();
	const highlights = new Map<string, Root>();
	let building = false;

	function twoslash(options: VitePressPluginTwoslashOptions): ShikiTransformer {
		const transformer = transformerTwoslash(options);
		const render = transformer.code;
		if (!render) return transformer;
		return {
			...transformer,
			code(node) {
				if (!building) return render.call(this, node);
				const highlight = this.codeToHast;
				const cachedHighlight: typeof highlight = (code, highlightOptions) => {
					const key = JSON.stringify([code, highlightOptions]);
					let tree = highlights.get(key);
					if (!tree) {
						tree = highlight(code, highlightOptions);
						highlights.set(key, tree);
					}
					// Later Shiki transforms can mutate the tree attached to an individual popup.
					return structuredClone(tree);
				};
				return render.call({ ...this, codeToHast: cachedHighlight }, node);
			},
		};
	}

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
	const plugin = {
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
	} satisfies Plugin;
	return { twoslash, transformer, plugin };
}
