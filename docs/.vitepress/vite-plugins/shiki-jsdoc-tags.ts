/**
 * Shiki code transformer that converts literal JSDoc inline tags in twoslash
 * popup text into rendered elements.
 *
 * The `@shikijs/vitepress-twoslash` renderer strips `{@link ...}` but does
 * not handle `{@linkcode ...}` or `{@linkplain ...}`. This transformer walks
 * the HAST tree after twoslash has generated popup elements and replaces
 * literal tag text with proper `<code>` elements (for `@linkcode`) or plain
 * text (for `@linkplain`).
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

function splitTextNode(text: string): HastNode[] {
	const nodes: HastNode[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(JSDOC_INLINE_TAG_RE)) {
		const before = text.slice(lastIndex, match.index);
		if (before !== '') {
			nodes.push({ type: 'text', value: before });
		}

		const variant = match[1];
		const display = extractDisplayText(match[2]);

		if (variant === 'code') {
			nodes.push({
				type: 'element',
				tagName: 'code',
				properties: {},
				children: [{ type: 'text', value: display }],
			});
		} else {
			nodes.push({ type: 'text', value: display });
		}

		lastIndex = match.index + match[0].length;
	}

	const remaining = text.slice(lastIndex);
	if (remaining !== '') {
		nodes.push({ type: 'text', value: remaining });
	}

	return nodes;
}

function walkAndFix(node: HastNode): void {
	if (node.content !== undefined) {
		walkAndFix(node.content);
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
			newChildren.push(...splitTextNode(child.value));
			modified = true;
		} else {
			walkAndFix(child);
			newChildren.push(child);
		}
	}

	if (modified) {
		node.children = newChildren;
	}
}

function transformerJSDocTags(): ShikiTransformer {
	return {
		name: 'dreamcli-jsdoc-tags',
		root(root) {
			walkAndFix(root as unknown as HastNode);
		},
	};
}

export { transformerJSDocTags };
