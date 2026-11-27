/** Experimental Twoslash analysis for the TypeScript fences in the flags guide. @module */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findCutNotations, findQueryMarkers } from 'twoslash';
import type {
	NodeWithoutPosition,
	Position,
	Range,
	TwoslashGenericResult,
} from 'twoslash-protocol';
import {
	createPositionConverter,
	isInRanges,
	removeCodeRanges,
	resolveNodePositions,
} from 'twoslash-protocol';
import ts from 'typescript';
import type { MessageConnection } from 'vscode-jsonrpc/node';
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from 'vscode-jsonrpc/node';

type Hover = {
	contents: { value: string };
	range: { start: Position; end: Position };
};

export async function loadFlagsGuide(root: string) {
	const path = join(root, 'docs/guide/flags.md');
	const guide = await readFile(path, 'utf8');
	const snippets = Array.from(
		guide.matchAll(/^```ts twoslash\n([\s\S]*?)\n```$/gm),
		(match) => match[1] ?? '',
	);
	return { path, guide, snippets };
}

async function analyze(
	connection: MessageConnection,
	uri: string,
	code: string,
): Promise<TwoslashGenericResult> {
	const positions = createPositionConverter(code);
	const markers = {
		removals: [] as Range[],
		positionQueries: [] as number[],
		positionCompletions: [],
		positionHighlights: [],
	};
	findCutNotations(code, markers);
	findQueryMarkers(code, markers, positions);
	if (markers.positionCompletions.length || markers.positionHighlights.length) {
		throw new Error('This prototype supports hover and query markers only.');
	}

	// Use the TS parser only to locate identifiers. All type information comes from tsrs.
	const file = ts.createSourceFile('snippet.ts', code, ts.ScriptTarget.Latest, true);
	const identifiers: ts.Identifier[] = [];
	function visit(node: ts.Node): void {
		if (ts.isIdentifier(node) && !isInRanges(node.getStart(file), markers.removals, false))
			identifiers.push(node);
		ts.forEachChild(node, visit);
	}
	visit(file);
	const document = { uri };
	const diagnostics = await connection.sendRequest<{
		items: {
			code: number;
			message: string;
			severity: number;
		}[];
	}>('textDocument/diagnostic', { textDocument: document });
	for (const issue of diagnostics.items) {
		if (issue.severity === 1) throw new Error(`tsrs TS${issue.code}: ${issue.message}`);
	}
	const hoverNodes = await Promise.all(
		identifiers.map(async (identifier) => {
			const start = identifier.getStart(file);
			const hover = await connection.sendRequest<Hover | null>('textDocument/hover', {
				textDocument: document,
				position: positions.indexToPos(start),
			});
			if (!hover) return [];
			const hoverStart = positions.posToIndex(hover.range.start.line, hover.range.start.character);
			const hoverEnd = positions.posToIndex(hover.range.end.line, hover.range.end.character);
			const parts = /^```(?:typescript|ts)\n([\s\S]*?)\n```(?:\n([\s\S]*))?$/.exec(
				hover.contents.value.trim(),
			);
			if (!parts?.[1])
				throw new Error(`Unexpected hover for ${identifier.text}: ${hover.contents.value}`);
			// The language server links into the local checkout. Display the link label in the prototype.
			const docs = parts[2]?.trim().replace(/\[([^\]]+)\]\(file:\/\/[^)]+\)/g, '$1');
			const node = {
				type: 'hover' as const,
				start: hoverStart,
				length: hoverEnd - hoverStart,
				target: code.slice(hoverStart, hoverEnd),
				text: parts[1],
				...(docs && { docs }),
			};
			const nodes: NodeWithoutPosition[] = [node];
			for (const query of markers.positionQueries) {
				if (query >= hoverStart && query < hoverEnd) nodes.push({ ...node, type: 'query' });
			}
			return nodes;
		}),
	);
	const result = removeCodeRanges(code, markers.removals, hoverNodes.flat());
	if (
		result.nodes.filter((node) => node.type === 'query').length !== markers.positionQueries.length
	) {
		throw new Error('A Twoslash query did not resolve to a native hover');
	}
	return {
		code: result.code,
		nodes: resolveNodePositions(result.nodes, result.code),
	};
}

export async function analyzeWithTsrs(
	root: string,
	snippets: string[],
): Promise<Map<string, TwoslashGenericResult>> {
	const uri = pathToFileURL(join(root, `twoslash-${randomUUID()}.ts`)).href;
	const rootUri = pathToFileURL(root).href;
	const launcher = join(
		dirname(createRequire(join(root, 'docs/package.json')).resolve('tsrs/package.json')),
		'bin/tsrs',
	);
	const child = spawn('node', [launcher, '--lsp', '--stdio'], {
		cwd: root,
		stdio: ['pipe', 'pipe', 'inherit'],
	});
	const connection = createMessageConnection(
		new StreamMessageReader(child.stdout),
		new StreamMessageWriter(child.stdin),
	);
	child.on('error', () => connection.dispose());
	child.on('exit', () => connection.dispose());
	connection.listen();
	try {
		await connection.sendRequest('initialize', {
			processId: process.pid,
			rootUri,
			workspaceFolders: [{ uri: rootUri, name: 'dreamcli' }],
			capabilities: {
				textDocument: {
					hover: { contentFormat: ['markdown'] },
					diagnostic: {},
				},
			},
		});
		await connection.sendNotification('initialized', {});
		const results = new Map<string, TwoslashGenericResult>();
		let version = 0;
		for (const code of snippets) {
			if (++version === 1) {
				await connection.sendNotification('textDocument/didOpen', {
					textDocument: {
						uri,
						languageId: 'typescript',
						version,
						text: code,
					},
				});
			} else {
				await connection.sendNotification('textDocument/didChange', {
					textDocument: { uri, version },
					contentChanges: [{ text: code }],
				});
			}
			results.set(code, await analyze(connection, uri, code));
		}
		const stopped = once(child, 'close');
		await connection.sendRequest('shutdown');
		connection.end();
		const [exitCode] = await stopped;
		if (exitCode !== 0) throw new Error(`tsrs exited with code ${exitCode}`);
		return results;
	} finally {
		connection.dispose();
		child.stdin.end();
		child.kill();
	}
}

/** Shiki's lookup runs synchronously; prepare the native results before VitePress renders. */
export async function createFlagsCache(root: string) {
	const { snippets } = await loadFlagsGuide(root);
	const native = await analyzeWithTsrs(root, snippets);
	return {
		read(code: string, lang?: string) {
			if (lang !== 'ts' && lang !== 'typescript') return null;
			return native.get(code.trimEnd()) ?? null;
		},
		write() {},
	};
}
