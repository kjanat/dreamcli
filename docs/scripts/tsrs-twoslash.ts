/** Analyze documentation snippets with the tsrs language server. @module */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
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

async function analyze(
	connection: MessageConnection,
	uri: string,
	code: string,
): Promise<TwoslashGenericResult | null> {
	const positions = createPositionConverter(code);
	const markers = {
		removals: [] as Range[],
		positionQueries: [] as number[],
		positionCompletions: [],
		positionHighlights: [] as [number, number, string?][],
	};
	findCutNotations(code, markers);
	findQueryMarkers(code, markers, positions);
	if (markers.positionCompletions.length) return null;

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
		items: { severity: number }[];
	}>('textDocument/diagnostic', { textDocument: document });
	// The repository tsconfig also checks unused locals. Let stock Twoslash validate
	// diagnostics using the documentation's compiler options and format any errors.
	if (diagnostics.items.some((issue) => issue.severity === 1)) return null;
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
			if (!parts?.[1]) return null;
			// Pass symbol references to the site’s existing JSDoc link resolver.
			const docs = parts[2]
				?.trim()
				.replace(/\[\x60?([^\x60\]]+)\x60?\]\(file:\/\/[^)]+\)/g, '{@linkcode $1}');
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
	const nodes: NodeWithoutPosition[] = [];
	for (const group of hoverNodes) {
		if (!group) return null;
		nodes.push(...group);
	}
	for (const [start, end, text] of markers.positionHighlights) {
		nodes.push({ type: 'highlight', start, length: end - start, ...(text && { text }) });
	}
	const result = removeCodeRanges(code, markers.removals, nodes);
	if (
		result.nodes.filter((node) => node.type === 'query').length !== markers.positionQueries.length
	) {
		return null;
	}
	return {
		code: result.code,
		nodes: resolveNodePositions(result.nodes, result.code),
	};
}

export async function openTsrs(root: string) {
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
		let version = 0;
		return {
			async analyze(code: string) {
				// Match the docs renderer’s ambient test types without shifting source positions.
				const text = `${code}\nimport type {} from 'vitest/globals';`;
				if (++version === 1) {
					await connection.sendNotification('textDocument/didOpen', {
						textDocument: {
							uri,
							languageId: 'typescript',
							version,
							text,
						},
					});
				} else {
					await connection.sendNotification('textDocument/didChange', {
						textDocument: { uri, version },
						contentChanges: [{ text }],
					});
				}
				return analyze(connection, uri, code);
			},
			async close() {
				try {
					const stopped = once(child, 'close');
					await connection.sendRequest('shutdown');
					connection.end();
					const [exitCode] = await stopped;
					if (exitCode !== 0) throw new Error(`tsrs exited with code ${exitCode}`);
				} finally {
					connection.dispose();
					child.kill();
				}
			},
		};
	} catch (error) {
		connection.dispose();
		child.kill();
		throw error;
	}
}
