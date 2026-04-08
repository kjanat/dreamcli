/**
 * Example docs generation helpers.
 *
 * @module
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

import { gitRef } from './paths.ts';
import { toSymbolPageRoute } from './symbol-pages.ts';

const backTick = '`';
const codeFence = `${backTick}${backTick}${backTick}`;
const codeSnippet = (content: string): string => `${backTick}${content}${backTick}`;

export interface ExampleRelatedSymbol {
	entrypoint: string;
	name: string;
	href: string;
}

export interface ExampleEntry {
	slug: string;
	title: string;
	summary: string;
	demonstrates: string | null;
	usage: readonly string[];
	sourcePath: string;
	routePath: string;
	sourceUrl: string;
	sourceCode: string;
	relatedSymbols: readonly ExampleRelatedSymbol[];
}

export interface ExampleMeta {
	slug: string;
	/** Docblock first line — descriptive sentence for display. */
	title: string;
	/** Short slug-derived label for sidebar navigation. */
	navTitle: string;
	routePath: string;
}

/**
 * Cheap metadata collection for sidebar generation.
 *
 * Reads only filenames and docblock summaries — no source code loading,
 * no symbol resolution, no TypeDoc. Safe to call in VitePress config.
 */
export async function collectExampleMeta(examplesRoot: string): Promise<readonly ExampleMeta[]> {
	const entries = await readdir(examplesRoot, { withFileTypes: true });
	const exampleFiles = entries
		.filter(
			(entry) =>
				entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts'),
		)
		.map((entry) => entry.name)
		.sort();

	return Promise.all(
		exampleFiles.map(async (fileName) => {
			const slug = basename(fileName, '.ts');
			const source = await readFile(join(examplesRoot, fileName), 'utf8');
			const { title } = parseDocblock(source, slug);
			return {
				slug,
				title,
				navTitle: titleFromSlug(slug),
				routePath: `/examples/${slug}`,
			};
		}),
	);
}

export async function collectExamples(
	examplesRoot: string,
	repoRoot: string,
): Promise<readonly ExampleEntry[]> {
	const entries = await readdir(examplesRoot, { withFileTypes: true });
	const exampleFiles = entries
		.filter(
			(entry) =>
				entry.isFile() && extname(entry.name) === '.ts' && !entry.name.endsWith('.test.ts'),
		)
		.map((entry) => entry.name)
		.sort();

	return Promise.all(
		exampleFiles.map(async (fileName) => parseExample(join(examplesRoot, fileName), repoRoot)),
	);
}

export function renderExamplePage(example: ExampleEntry): string {
	const usageSection =
		example.usage.length === 0
			? ['No usage snippets declared in the example docblock.', '']
			: [`${codeFence}bash`, ...example.usage, codeFence, ''];
	const symbolLinks = example.relatedSymbols.map(
		(symbol) => `- [${backTick}${symbol.name}${backTick}](${symbol.href})`,
	);
	const relatedLinks = [
		'- [Examples overview](/examples/)',
		'- [API overview](/reference/api)',
		...symbolLinks,
	];

	return `\
# ${example.title}

${example.summary}

- Source: [${codeSnippet(example.sourcePath)}](${example.sourceUrl})

${(example.demonstrates === null ? [] : [`- Demonstrates: ${example.demonstrates}`]).join('\n')}

## Usage

${usageSection.join('\n')}

## Source

${codeFence}ts twoslash
${example.sourceCode.replace(/^#!.*\n/, '').trimEnd()}
${codeFence}

## Related Links

${relatedLinks.join('\n')}
`;
}

async function parseExample(filePath: string, repoRoot: string): Promise<ExampleEntry> {
	const source = await readFile(filePath, 'utf8');
	const sourcePath = toRepoPath(filePath, repoRoot);
	const slug = basename(filePath, '.ts');
	const { title, summary, demonstrates, usage } = parseDocblock(source, slug);

	return {
		slug,
		title,
		summary,
		demonstrates,
		usage,
		sourcePath,
		routePath: `/examples/${slug}`,
		sourceUrl: `https://github.com/kjanat/dreamcli/blob/${gitRef}/${sourcePath}`,
		sourceCode: source,
		relatedSymbols: collectRelatedSymbols(source),
	};
}

function collectRelatedSymbols(source: string): readonly ExampleRelatedSymbol[] {
	const symbolLinks = new Map<string, ExampleRelatedSymbol>();
	// Capture `import ... from 'module'` and `import ... from "module"` forms.
	// Default-only imports are intentionally ignored; we only link named imports.
	const importPattern = /import\s+(?:type\s+)?([^;]+?)\s+from\s*(['"])([^'"]+)\2/g;
	for (const match of source.matchAll(importPattern)) {
		const importClause = match[1];
		const moduleName = match[3];
		if (importClause === undefined || moduleName === undefined || !isDreamcliImport(moduleName)) {
			continue;
		}

		for (const importedName of extractImportedNames(importClause)) {
			symbolLinks.set(`${moduleName}:${importedName}`, {
				entrypoint: moduleName,
				name: importedName,
				href: toSymbolPageRoute(moduleName, importedName),
			});
		}
	}

	return Array.from(symbolLinks.values()).sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

function extractImportedNames(importClause: string): readonly string[] {
	const namedSection = /\{([^}]*)\}/.exec(importClause)?.[1];
	if (namedSection === undefined) {
		return [];
	}

	const importedNames: string[] = [];
	for (const entry of namedSection.split(',')) {
		const importedName = normalizeImportedName(entry);
		if (importedName !== null) {
			importedNames.push(importedName);
		}
	}

	return importedNames;
}

function normalizeImportedName(entry: string): string | null {
	const trimmed = entry.trim();
	if (trimmed === '') {
		return null;
	}
	const withoutType = trimmed.startsWith('type ') ? trimmed.slice(5).trim() : trimmed;
	const importedName = withoutType.split(' as ')[0]?.trim();
	return importedName === undefined || importedName === '' ? null : importedName;
}

function isDreamcliImport(moduleName: string): boolean {
	return moduleName === '@kjanat/dreamcli' || moduleName.startsWith('@kjanat/dreamcli/');
}

/**
 * Docblock content model.
 *
 * Parsed from the leading `/** ... *​/` block in example source files.
 *
 * Docblock format contract:
 *
 * ```
 * /**
 *  * Title line — first non-empty line.
 *  *
 *  * Optional prose paragraphs (becomes `summary`).
 *  *
 *  * Demonstrates: labeled value (single or continuation lines)
 *  *
 *  * Usage:
 *  *   indented usage lines
 *  *​/
 * ```
 *
 * If no prose exists between the title and labeled fields, `summary`
 * falls back to `title`.
 */
interface ParsedDocblock {
	title: string;
	summary: string;
	demonstrates: string | null;
	usage: readonly string[];
}

const LABELED_FIELD = /^(Demonstrates|Usage):/;

/**
 * Parse the leading docblock from example source into structured fields.
 *
 * Single source of truth for docblock interpretation — both
 * {@link collectExampleMeta} and {@link parseExample} derive from this.
 */
function parseDocblock(source: string, slug: string): ParsedDocblock {
	const lines = extractDocLines(source);
	const title = firstNonEmpty(lines) ?? titleFromSlug(slug);
	const titleIndex = lines.findIndex((line) => line.trim() === title);

	const proseLines: string[] = [];
	for (let i = titleIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) break;
		const trimmed = line.trim();
		if (LABELED_FIELD.test(trimmed)) break;
		if (trimmed !== '') proseLines.push(trimmed);
	}

	return {
		title,
		summary: proseLines.length > 0 ? proseLines.join(' ') : title,
		demonstrates: extractLabeledValue(lines, 'Demonstrates'),
		usage: extractUsage(lines),
	};
}

function extractDocLines(source: string): readonly string[] {
	const match = /^#!.*\n\/\*\*([\s\S]*?)\*\//.exec(source) ?? /^\/\*\*([\s\S]*?)\*\//.exec(source);
	if (match === null) {
		return [];
	}
	const docBlock = match[1];
	if (docBlock === undefined) {
		return [];
	}

	return docBlock.split('\n').map((line) => line.replace(/^\s*\* ?/, '').trimEnd());
}

function extractUsage(lines: readonly string[]): readonly string[] {
	const usageIndex = lines.indexOf('Usage:');
	if (usageIndex === -1) {
		return [];
	}

	const usage: string[] = [];
	for (const line of lines.slice(usageIndex + 1)) {
		if (line.trim() === '') {
			if (usage.length > 0) {
				break;
			}
			continue;
		}

		usage.push(line.trim());
	}

	return usage;
}

function extractLabeledValue(lines: readonly string[], label: string): string | null {
	const prefix = `${label}:`;
	const startIndex = lines.findIndex((line) => line.startsWith(prefix));
	if (startIndex === -1) return null;

	const startLine = lines[startIndex];
	if (startLine === undefined) return null;
	const firstValue = startLine.slice(prefix.length).trim();

	const parts = firstValue === '' ? [] : [firstValue];
	for (let i = startIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) break;
		const trimmed = line.trim();
		if (trimmed === '' || LABELED_FIELD.test(trimmed)) break;
		parts.push(trimmed);
	}

	return parts.length === 0 ? null : parts.join(' ');
}

function firstNonEmpty(lines: readonly string[]): string | null {
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed !== '') {
			return trimmed;
		}
	}

	return null;
}

function titleFromSlug(slug: string): string {
	return slug
		.split('-')
		.map((part) => {
			const [firstChar, ...rest] = part;
			if (firstChar === undefined) {
				return part;
			}

			return `${firstChar.toUpperCase()}${rest.join('')}`;
		})
		.join(' ');
}

function toRepoPath(filePath: string, repoRoot: string): string {
	return relative(repoRoot, filePath).replaceAll('\\', '/');
}
