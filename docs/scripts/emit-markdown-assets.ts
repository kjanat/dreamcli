#!/usr/bin/env bun
/**
 * Copy documentation sources into the build output so agents can fetch the
 * markdown a page was built from.
 *
 * VitePress renders these files to HTML; shipping the sources alongside means
 * `Accept: text/markdown` is answered with authored markdown instead of a
 * lossy HTML-to-markdown conversion.
 */

import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const docsRoot = dirname(import.meta.dirname);
const distRoot = join(docsRoot, '.vitepress', 'dist');
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

const sources = await collect(docsRoot);
for (const source of sources) {
	const target = join(distRoot, relative(docsRoot, source));
	await mkdir(dirname(target), { recursive: true });
	await copyFile(source, target);
}

console.log(`Copied ${sources.length} markdown sources into dist`);
