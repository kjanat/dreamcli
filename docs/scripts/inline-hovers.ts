/// <reference lib="dom.iterable" />
/// <reference lib="dom" />
/** Inspect inline Vue popup slots in trusted production VitePress builds. @module */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { App, ComponentPublicInstance, VNode } from 'vue';
import { launchChromium, openBuiltSite } from './browser-site.ts';

type Hover = {
	theme: string;
	signature: string;
	docs: string;
	tags: { name: string; parameter: string }[];
};
type DocsApp = App & { _context: { provides: Record<symbol, unknown> } };
type SiteRouter = { go(path: string): Promise<void> };

// Only these exact stock → native display changes have been reviewed. Tracking
// both strings prevents a new difference on the same page from being approved.
const queryOrder = new Map([
	['guide/arguments.html', ['enum: "us" | "eu" | "ap"', 'enum: "ap" | "eu" | "us"']],
	[
		'guide/flags.html',
		['enum: "us" | "eu" | "ap" | undefined', 'enum: "ap" | "eu" | "us" | undefined'],
	],
	['guide/read-flags.html', ['target: "node" | "browser"', 'target: "browser" | "node"']],
	[
		'guide/testing.html',
		[
			'type CapturedOutput = { readonly stdout: readonly string[]; readonly stderr: readonly string[]; readonly exitCode: number; readonly error: CLIError | undefined; }',
			'type CapturedOutput = { readonly exitCode: number; readonly stdout: readonly string[]; readonly stderr: readonly string[]; readonly error: CLIError | undefined; }',
		],
	],
	[
		'reference/runtime.html',
		[
			'type Runtime = "node" | "bun" | "deno" | "unknown"',
			'type Runtime = "bun" | "deno" | "node" | "unknown"',
		],
	],
]);

function overloadCount(text: string) {
	const stock = text.match(/\(\+(\d+) overloads?\)/);
	if (stock) return 1 + Number(stock[1]);
	return (
		(text.match(/^function /gm)?.length ?? 0) +
		Number(text.match(/\/\/ \+(\d+) more overloads?/)?.[1] ?? 0)
	);
}

async function openProbe(browser: Browser, dist: string) {
	const { context, base } = await openBuiltSite(browser, dist);
	const page = await context.newPage();
	await page.goto('404.html');
	await page.waitForFunction(
		() => !!(document.querySelector('#app') as { __vue_app__?: unknown })?.__vue_app__,
	);
	await page.evaluate(() => {
		const app = (document.querySelector('#app') as unknown as { __vue_app__: DocsApp }).__vue_app__;
		const router = Object.getOwnPropertySymbols(app._context.provides)
			.map((key) => app._context.provides[key])
			.find(
				(value): value is SiteRouter =>
					!!value && typeof value === 'object' && 'go' in value && 'route' in value,
			);
		if (!router) throw new Error('VitePress router unavailable');
		Object.assign(window, { inspectDocsRoute: (path: string) => router.go(path) });
		// Let the build's own Vue runtime render even minified/hoisted static slots.
		// Replacing the floating component avoids pointer delays and tooltip placement.
		const probe = {
			inheritAttrs: false,
			render(this: ComponentPublicInstance) {
				return (this.$slots.popper ?? this.$slots.default)?.({})[0] as VNode;
			},
			mounted(this: ComponentPublicInstance) {
				const element = this.$el as HTMLElement;
				element.dataset.hoverTheme = String(this.$attrs.theme);
				if (this.$attrs.payload) element.dataset.hoverPayload = String(this.$attrs.payload);
			},
		};
		app.component('v-menu', probe);
		app.component('twoslash-menu', probe);
	});
	return { page, base, dist };
}

async function readPage(
	{ page, base, dist }: { page: Page; base: string; dist: string },
	path: string,
) {
	const source = await readFile(join(dist, path), 'utf8');
	if (!/<pre\b[^>]*\btwoslash\b/.test(source)) return { blocks: [], hovers: [] as Hover[] };
	// Compare the actual SSR text, apart from the enclosing Vue markup.
	const blocks = await page.evaluate(
		(html) =>
			[...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('pre.twoslash')].map(
				(block) => block.textContent,
			),
		source,
	);
	const hovers = await page.evaluate(
		async ({ url, base }) => {
			await (window as unknown as { inspectDocsRoute: SiteRouter['go'] }).inspectDocsRoute(url);
			const nodes = document.querySelectorAll<HTMLElement>('main [data-hover-theme]');
			const bodies = new Map<string, Promise<Document>>();
			return Promise.all(
				[...nodes].map(async (node) => {
					const payload = node.dataset.hoverPayload;
					let body: ParentNode = node;
					if (payload) {
						let pending = bodies.get(payload);
						if (!pending) {
							pending = fetch(base + payload.slice(1)).then(async (response) => {
								if (!response.ok) throw Error(response.url);
								return new DOMParser().parseFromString(await response.text(), 'text/html');
							});
							bodies.set(payload, pending);
						}
						body = await pending;
					}
					const docs = body.querySelector('.twoslash-popup-docs')?.textContent ?? '';
					const tags = [...body.querySelectorAll('.twoslash-popup-docs-tag')].map((el) => {
						const name =
							el.querySelector('.twoslash-popup-docs-tag-name')?.textContent.trim() ?? '';
						const value =
							el.querySelector('.twoslash-popup-docs-tag-value')?.textContent.trim() ?? '';
						return {
							name,
							parameter: name === '@param' ? (value.match(/^[\w.$]+/)?.[0] ?? '') : '',
						};
					});
					return {
						theme: node.dataset.hoverTheme ?? '',
						signature: body.querySelector('.twoslash-popup-code')?.textContent ?? '',
						docs,
						tags,
					};
				}),
			);
		},
		{ url: base + path.replace(/\.html$/, ''), base },
	);
	// Guard against silently comparing two empty or partly hydrated pages.
	const chunk = source.match(/href="([^"]+\.md\.[^"/]+\.lean\.js)"/)?.[1];
	assert.ok(chunk, `Missing page module in ${path}`);
	assert.ok(chunk.startsWith(base), `Page module outside ${base} in ${path}`);
	const js = await readFile(join(dist, chunk.slice(base.length)), 'utf8');
	const expected = js.match(/\bpopper\s*:|\/assets\/twoslash\/[\da-f]{24}\.txt/g) ?? [];
	assert.equal(hovers.length, expected.length, `Captured hovers in ${path}`);
	return { blocks, hovers };
}

export async function compareInlineHovers(stock: string, candidate: string, pages: string[]) {
	const browser = await launchChromium();
	try {
		const [originalSite, currentSite] = await Promise.all([
			openProbe(browser, stock),
			openProbe(browser, candidate),
		]);
		let references = 0,
			examples = 0,
			queries = 0,
			reordered = 0,
			documented = 0,
			overloads = 0;
		const differences = { signature: 0, documentationOnly: 0, sameText: 0 };
		for (const path of pages) {
			const [before, after] = await Promise.all([
				readPage(originalSite, path),
				readPage(currentSite, path),
			]);
			assert.deepEqual(after.blocks, before.blocks, path);
			examples += before.blocks.length;
			assert.equal(after.hovers.length, before.hovers.length, path);
			for (const [index, original] of before.hovers.entries()) {
				const current = after.hovers[index];
				assert.ok(current);
				const where = `${path}, popup ${index + 1}`;
				assert.equal(current.theme, original.theme, where);
				assert.ok(!original.signature || current.signature, where);
				if (original.docs) {
					assert.ok(current.docs.trim(), `Missing docs: ${where}`);
					documented++;
				}
				for (const { name, parameter } of original.tags) {
					const structured = current.tags.some(
						(tag) => tag.name === name && tag.parameter === parameter,
					);
					// The LSP also returns JSDoc tags as Markdown inside its documentation string.
					const inline = `${name} ${parameter}`.trim();
					assert.ok(
						structured || current.docs.replace(/\s+/g, ' ').includes(inline),
						`Missing ${inline}: ${where}`,
					);
				}
				if (original.signature !== current.signature) differences.signature++;
				else if (original.docs !== current.docs) differences.documentationOnly++;
				else differences.sameText++;
				if (/\(\+\d+ overloads?\)/.test(original.signature)) {
					assert.equal(overloadCount(current.signature), overloadCount(original.signature), where);
					overloads++;
				}
				if (original.theme === 'twoslash-query') {
					queries++;
					if (original.signature !== current.signature) {
						assert.deepEqual(
							[original.signature, current.signature].map((t) => t.replace(/\s+/g, ' ').trim()),
							queryOrder.get(path),
							where,
						);
						reordered++;
					}
				}
				references++;
			}
		}
		assert.ok(
			examples && references && queries && documented && overloads,
			'Expected inline Twoslash output',
		);
		console.log(
			`${pages.length} HTML paths, ${examples} matching examples, ${references} hovers, ${documented} documented, ${overloads} overload counts, ${queries} queries (${reordered} approved reorderings).`,
		);
		console.log(
			`Compared hover text: ${differences.sameText} identical, ${differences.documentationOnly} documentation-only differences, ${differences.signature} signature differences.`,
		);
	} finally {
		await browser.close();
	}
}
