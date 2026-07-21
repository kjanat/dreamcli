#!/usr/bin/env bun
/**
 * Copy documentation sources into the build output under `/raw/` so agents can
 * fetch the markdown a page was built from.
 *
 * VitePress renders these files to HTML; shipping the sources alongside means
 * `Accept: text/markdown` is answered with authored markdown instead of a lossy
 * HTML-to-markdown conversion. A Cloudflare Transform Rule matching the Accept
 * header rewrites `/<page>` to `/raw/<page>`; the paths stay directly fetchable
 * for anyone who prefers a plain URL over content negotiation.
 */

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const SITE_ORIGIN = 'https://dreamcli.kjanat.dev';

/** Section order for llms.txt; anything else lands under Other. */
const SECTIONS: readonly { readonly title: string; readonly prefix: string }[] = [
	{ title: 'Guide', prefix: 'guide/' },
	{ title: 'Concepts', prefix: 'concepts/' },
	{ title: 'Examples', prefix: 'examples/' },
	{ title: 'Reference', prefix: 'reference/' },
];

const docsRoot = dirname(import.meta.dirname);
const distRoot = join(docsRoot, '.vitepress', 'dist');
const rawRoot = join(distRoot, 'raw');
const SKIP_DIRS = new Set(['.vitepress', 'node_modules', 'public']);

async function collect(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			files.push(...(await collect(full)));
		} else if (entry.name.endsWith('.md') && !entry.name.startsWith('[')) {
			files.push(full);
		}
	}
	return files;
}

/** Strip frontmatter so titles and bodies read cleanly when concatenated. */
function stripFrontmatter(content: string): string {
	if (!content.startsWith('---')) return content;
	const end = content.indexOf('\n---', 3);
	return end === -1 ? content : content.slice(end + 4).replace(/^\r?\n/, '');
}

/** First markdown heading, falling back to the route slug. */
function titleOf(content: string, route: string): string {
	const heading = /^#\s+(.+)$/m.exec(stripFrontmatter(content));
	if (heading?.[1] !== undefined) return heading[1].trim();
	const slug = route.split('/').pop() ?? route;
	return slug === '' ? 'Home' : slug;
}

/** Frontmatter values VitePress home layouts carry instead of prose. */
function frontmatterSummary(content: string): string | undefined {
	if (!content.startsWith('---')) return undefined;
	const end = content.indexOf('\n---', 3);
	if (end === -1) return undefined;
	const block = content.slice(3, end);
	const tagline = /^\s*(?:tagline|description):\s*(.+)$/m.exec(block);
	return tagline?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

/** First non-heading, non-empty prose line, used as the llms.txt one-liner. */
function summaryOf(content: string): string | undefined {
	const fromFrontmatter = frontmatterSummary(content);
	if (fromFrontmatter !== undefined && fromFrontmatter !== '') return fromFrontmatter;

	let inBlock = false;
	for (const line of stripFrontmatter(content).split('\n')) {
		const lower = line.trim().toLowerCase();
		if (lower.startsWith('<style') || lower.startsWith('<script')) inBlock = true;
		if (inBlock) {
			if (lower.startsWith('</style') || lower.startsWith('</script')) inBlock = false;
			continue;
		}
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(':::')) continue;
		if (trimmed.startsWith('<') || trimmed.startsWith('```')) continue;
		return trimmed.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*`_]/g, '');
	}
	return undefined;
}

interface Page {
	readonly route: string;
	readonly markdownUrl: string;
	readonly title: string;
	readonly summary: string | undefined;
	readonly content: string;
}

const sources = await collect(docsRoot);
const pages: Page[] = [];

for (const source of sources) {
	const rel = relative(docsRoot, source);
	const route = rel === 'index.md' ? '/' : `/${rel.replace(/\.md$/, '')}`;
	// Extensionless, so a Transform Rule is a plain `concat("/raw", path)` and
	// `/raw/<page>` mirrors `/<page>` exactly.
	const target = join(rawRoot, route === '/' ? 'index' : route.slice(1));
	await mkdir(dirname(target), { recursive: true });
	await copyFile(source, target);

	const content = await readFile(source, 'utf8');
	pages.push({
		route,
		markdownUrl: `${SITE_ORIGIN}/raw${route === '/' ? '/index' : route}`,
		title: titleOf(content, route),
		summary: summaryOf(content),
		content,
	});
}

pages.sort((a, b) => a.route.localeCompare(b.route));

const home = pages.find((page) => page.route === '/');
const header = [
	'# @kjanat/dreamcli',
	'',
	`> ${home?.summary ?? 'Schema-first, fully typed TypeScript CLI framework.'}`,
	'',
	'Every documentation page is available as authored markdown under `/raw/`',
	'(or send `Accept: text/markdown` to any page URL).',
	'',
].join('\n');

const grouped = new Map<string, Page[]>();
for (const page of pages) {
	if (page.route === '/') continue;
	const key = SECTIONS.find((s) => page.route.startsWith(`/${s.prefix}`))?.title ?? 'Other';
	const bucket = grouped.get(key);
	if (bucket === undefined) grouped.set(key, [page]);
	else bucket.push(page);
}

const orderedTitles = [...SECTIONS.map((s) => s.title), 'Other'];
const indexBody = orderedTitles
	.filter((title) => grouped.has(title))
	.map((title) => {
		const entries = (grouped.get(title) ?? []).map((page) =>
			page.summary === undefined
				? `- [${page.title}](${page.markdownUrl})`
				: `- [${page.title}](${page.markdownUrl}): ${page.summary}`,
		);
		return `## ${title}\n\n${entries.join('\n')}\n`;
	})
	.join('\n');

await writeFile(join(distRoot, 'llms.txt'), `${header}\n${indexBody}`, 'utf8');

const fullBody = pages
	.map(
		(page) =>
			`# ${page.title}\n\nSource: ${page.markdownUrl}\n\n${stripFrontmatter(page.content).trim()}\n`,
	)
	.join('\n---\n\n');

await writeFile(join(distRoot, 'llms-full.txt'), `${header}\n${fullBody}`, 'utf8');

console.log(
	`Copied ${sources.length} markdown sources into dist/raw, wrote llms.txt and llms-full.txt`,
);
