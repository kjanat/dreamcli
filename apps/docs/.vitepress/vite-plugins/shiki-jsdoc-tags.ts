/**
 * Shiki code transformer that converts literal JSDoc inline tags in twoslash
 * popup text into rendered link elements.
 *
 * The `@shikijs/vitepress-twoslash` renderer strips `{@link ...}` but does
 * not handle `{@linkcode ...}` or `{@linkplain ...}`. This transformer walks
 * the HAST tree after twoslash has generated popup elements and replaces
 * literal tag text with `<a><code>...</code></a>` elements (for
 * `@linkcode`) or plain `<a>` links (for `@linkplain`) that route to the
 * corresponding `/reference/symbols/` page.
 *
 * @module
 */

import type { ShikiTransformer } from '@shikijs/transformers';

/**
 * Matches `{@linkcode ref | display}` or `{@linkcode ref}`.
 *
 * Group 1: tag variant (`code` or `plain`).
 * Group 2: full content between tag name and closing brace.
 */
const JSDOC_INLINE_TAG_RE = /\{@link(code|plain)\s+([^}]+)\}/g;

interface JSDocTagsOptions {
	symbolRoutes: ReadonlyMap<string, string>;
}

type HastNode = {
	type: string;
	value?: string;
	children?: HastNode[];
	content?: HastNode;
	tagName?: string;
	properties?: Record<string, unknown>;
};

function extractDisplayText(content: string): string {
	const pipeIndex = content.indexOf('|');
	if (pipeIndex !== -1) {
		const display = content.substring(pipeIndex + 1).trim();
		if (display !== '') return display;
	}
	return content.trim();
}

function extractReferenceName(content: string): string {
	const pipeIndex = content.indexOf('|');
	const ref = pipeIndex !== -1 ? content.substring(0, pipeIndex) : content;
	return ref.trim();
}

function splitTextNode(text: string, symbolRoutes: ReadonlyMap<string, string>): HastNode[] {
	const nodes: HastNode[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(JSDOC_INLINE_TAG_RE)) {
		const before = text.slice(lastIndex, match.index);
		if (before !== '') {
			nodes.push({ type: 'text', value: before });
		}

		const variant = match[1];
		const rawContent = match[2];
		const display = extractDisplayText(rawContent);
		const ref = extractReferenceName(rawContent);
		const route = symbolRoutes.get(ref);

		const inner: HastNode =
			variant === 'code'
				? {
						type: 'element',
						tagName: 'code',
						properties: {},
						children: [{ type: 'text', value: display }],
					}
				: { type: 'text', value: display };

		if (route !== undefined) {
			nodes.push({
				type: 'element',
				tagName: 'a',
				properties: { href: route },
				children: [inner],
			});
		} else {
			nodes.push(inner);
		}

		lastIndex = match.index + match[0].length;
	}

	const remaining = text.slice(lastIndex);
	if (remaining !== '') {
		nodes.push({ type: 'text', value: remaining });
	}

	return nodes;
}

function walkAndFix(node: HastNode, symbolRoutes: ReadonlyMap<string, string>): void {
	if (node.content !== undefined) {
		walkAndFix(node.content, symbolRoutes);
	}

	if (node.children === undefined) return;

	let modified = false;
	const newChildren: HastNode[] = [];

	for (const child of node.children) {
		if (
			child.type === 'text' &&
			child.value !== undefined &&
			JSDOC_INLINE_TAG_RE.test(child.value)
		) {
			JSDOC_INLINE_TAG_RE.lastIndex = 0;
			newChildren.push(...splitTextNode(child.value, symbolRoutes));
			modified = true;
		} else {
			walkAndFix(child, symbolRoutes);
			newChildren.push(child);
		}
	}

	if (modified) {
		node.children = newChildren;
	}
}

function transformerJSDocTags(options: JSDocTagsOptions): ShikiTransformer {
	return {
		name: 'dreamcli-jsdoc-tags',
		root(root) {
			walkAndFix(root as unknown as HastNode, options.symbolRoutes);
		},
	};
}

/**
 * Fix `{@linkcode}` / `{@linkplain}` tags in hover doc markdown.
 *
 * TypeScript's quick info may emit the tag with internal newlines
 * (`{@linkcode \nref\ndisplay()\n}`). The upstream `renderMarkdown` regex
 * only strips single-line `{@link ...}`, so multi-line variants and
 * `@linkcode`/`@linkplain` survive into the markdown. This function
 * rewrites them to markdown code links before the markdown parser runs.
 */
function fixTsProcessedLinkcode(docs: string, symbolRoutes: ReadonlyMap<string, string>): string {
	return docs.replace(
		/\{@link(code|plain)\s+([\s\S]+?)\}/g,
		(_match, variant: string, rawContent: string) => {
			const content = rawContent.replace(/\s+/g, ' ').trim();
			const { ref, display } = resolveRefAndDisplay(content, symbolRoutes);
			const route = symbolRoutes.get(ref);

			if (variant === 'code') {
				return route !== undefined ? `[\`${display}\`](${route})` : `\`${display}\``;
			}
			return route !== undefined ? `[${display}](${route})` : display;
		},
	);
}

/**
 * Resolve reference name and display text from tag content.
 *
 * Handles three formats:
 * - `ref | display` — standard pipe separator
 * - `ref display` — TS-emitted space separator (first word is ref)
 * - `ref` — no display text, ref is also the display
 */
function resolveRefAndDisplay(
	content: string,
	symbolRoutes: ReadonlyMap<string, string>,
): { ref: string; display: string } {
	const pipeIndex = content.indexOf('|');
	if (pipeIndex !== -1) {
		const ref = content.substring(0, pipeIndex).trim();
		const display = content.substring(pipeIndex + 1).trim();
		return { ref, display: display !== '' ? display : ref };
	}

	const spaceIndex = content.indexOf(' ');
	if (spaceIndex !== -1) {
		const firstWord = content.substring(0, spaceIndex);
		if (symbolRoutes.has(firstWord)) {
			return { ref: firstWord, display: content.substring(spaceIndex + 1).trim() };
		}
	}

	return { ref: content, display: content };
}

export { fixTsProcessedLinkcode, transformerJSDocTags };
