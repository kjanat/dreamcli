/** Extract static Twoslash popper slots before Vue compiles the page. @module */
import { createHash } from 'node:crypto';
import type { ShikiTransformer } from '@shikijs/core';
import { hastToHtml } from '@shikijs/core';
import type { VitePressPluginTwoslashOptions } from '@shikijs/vitepress-twoslash';
import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import type { Element, Root } from 'hast';
import type { MarkdownOptions, Plugin } from 'vitepress';
import type { highlightCache } from './highlight-cache.ts';

export function twoslashPayloads(cache?: ReturnType<typeof highlightCache>) {
	const name = 'dreamcli-twoslash-payloads';
	const assets = new Map<string, string>();
	const fences = new Map<string, string>();
	const highlights = new Map<string, Root>();
	let restored = new Map<string, Root>();
	let hits = 0;
	let building = false;

	// Page and search renderers share the same popup assets for the lifetime of a build.
	const shikiSetup: NonNullable<MarkdownOptions['shikiSetup']> = (highlighter) => {
		const render = highlighter.codeToHtml.bind(highlighter);
		highlighter.codeToHtml = (code, options) => {
			const meta = String(options.meta?.__raw ?? '');
			// Includes read or update Shiki's shared definitions during preprocessing.
			if (
				!building ||
				!/\btwoslash\b/.test(meta) ||
				/include\s+[\w-]+/.test(meta) ||
				code.includes('// @include: ')
			) {
				return render(code, options);
			}
			const { transformers, ...settings } = options;
			const key = JSON.stringify([code, settings, transformers?.map((t) => t.name)]);
			const cached = fences.get(key);
			if (cached !== undefined) return cached;
			const html = render(code, options);
			fences.set(key, html);
			return html;
		};
	};

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
						tree = restored.get(key);
						if (tree) hits++;
						else tree = highlight(code, highlightOptions);
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
			if (!building && cache) restored = cache.restore();
			building = true;
		},
		generateBundle() {
			for (const [id, source] of assets) {
				this.emitFile({ type: 'asset', fileName: `assets/twoslash/${id}.txt`, source });
			}
		},
	} satisfies Plugin;
	function finish() {
		fences.clear();
		if (!cache) return;
		console.log(
			`Twoslash highlights: ${hits} restored from disk, ${highlights.size - hits} generated.`,
		);
		if (hits !== highlights.size || hits !== restored.size) cache.save(highlights);
	}
	return { shikiSetup, twoslash, transformer, plugin, finish };
}
