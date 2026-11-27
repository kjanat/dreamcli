/** Analyze documentation snippets with the tsrs language server. @module */
import { spawn } from 'node:child_process';
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

import { createDeclarationLookup, overloadHint } from './tsrs-hover.ts';

type Hover = {
	contents: { value: string };
	range: { start: Position; end: Position };
};

async function analyze(
	connection: MessageConnection,
	uri: string,
	code: string,
	lookup: ReturnType<typeof createDeclarationLookup>,
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
	// Let stock Twoslash validate diagnostics and format any errors for the page.
	if (diagnostics.items.some((issue) => issue.severity === 1)) return null;
	async function hoverNodes(identifier: ts.Identifier) {
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
		let text = parts[1];
		const position = positions.indexToPos(start);
		const exportedProperty = text.startsWith('(alias) (property) exports:');
		const declarations = exportedProperty || !docs ? await lookup.definitions(uri, position) : [];
		if (exportedProperty && declarations.some((location) => location.uri.endsWith('.json'))) {
			text = `import ${identifier.text}`;
		} else {
			const hint = await overloadHint(connection, uri, identifier, (index) =>
				positions.indexToPos(index),
			);
			if (hint) text = text.replace(/(?=\nnamespace )|$/, () => hint);
		}
		const documentation = docs ? { docs } : lookup.documentation(declarations, uri, file);
		const node = {
			type: 'hover' as const,
			start: hoverStart,
			length: hoverEnd - hoverStart,
			target: code.slice(hoverStart, hoverEnd),
			text,
			...documentation,
		};
		const nodes: NodeWithoutPosition[] = [node];
		for (const query of markers.positionQueries) {
			if (query >= hoverStart && query < hoverEnd) nodes.push({ ...node, type: 'query' });
		}
		return nodes;
	}
	const nodes: NodeWithoutPosition[] = [];
	// Bound in-flight LSP responses so long examples cannot fill the server stdout pipe.
	for (let start = 0; start < identifiers.length; start += 8) {
		const groups = await Promise.all(identifiers.slice(start, start + 8).map(hoverNodes));
		for (const group of groups) {
			if (!group) return null;
			nodes.push(...group);
		}
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
	const uri = pathToFileURL(join(root, 'docs/.vitepress/twoslash/snippet.ts')).href;
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
					signatureHelp: { signatureInformation: { documentationFormat: ['markdown'] } },
					diagnostic: {},
				},
			},
		});
		await connection.sendNotification('initialized', {});
		const lookup = createDeclarationLookup(connection);
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
				return analyze(connection, uri, code, lookup);
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
