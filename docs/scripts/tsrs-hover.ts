/** Recover declaration information omitted from tsrs expression hovers. @module */
import { fileURLToPath } from 'node:url';
import type { Position } from 'twoslash-protocol';
import ts from 'typescript';
import type { MessageConnection } from 'vscode-jsonrpc/node';

type Location = { uri: string; range: { start: Position } };
type Documentation = { docs?: string; tags?: [string, string | undefined][] };

function declarationDocs(file: ts.SourceFile, position: Position): Documentation | undefined {
	const offset = file.getPositionOfLineAndCharacter(position.line, position.character);
	function at(node: ts.Node): Documentation | undefined {
		if (offset < node.pos || offset >= node.end) return;
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			node.getStart(file) <= offset &&
			'name' in node.parent &&
			node.parent.name === node
		) {
			for (const doc of ts.getJSDocCommentsAndTags(node.parent)) {
				if (!ts.isJSDoc(doc)) continue;
				const docs = ts.getTextOfJSDocComment(doc.comment);
				const tags = doc.tags?.map((tag): [string, string | undefined] => {
					const comment = ts.getTextOfJSDocComment(tag.comment);
					const value = ts.isJSDocParameterTag(tag)
						? [tag.name.getText(file), comment].filter(Boolean).join(' ')
						: comment;
					return [tag.tagName.text, value];
				});
				if (docs || tags?.length) return { ...(docs && { docs }), ...(tags && { tags }) };
			}
		}
		return ts.forEachChild(node, at);
	}
	return at(file);
}

export function createDeclarationLookup(connection: MessageConnection) {
	const sources = new Map<string, ts.SourceFile | undefined>();
	const comments = new Map<string, Documentation | undefined>();
	return {
		async definitions(uri: string, position: Position) {
			const result = await connection.sendRequest<Location | Location[] | null>(
				'textDocument/definition',
				{ textDocument: { uri }, position },
			);
			return result ? [result].flat() : [];
		},
		documentation(locations: Location[], localUri: string, snippet: ts.SourceFile) {
			for (const { uri, range } of locations) {
				if (uri === localUri) {
					const local = declarationDocs(snippet, range.start);
					if (local) return local;
					continue;
				}
				if (!uri.startsWith('file:') || !/\.[cm]?[jt]sx?$/.test(uri)) continue;
				const key = `${uri}#${range.start.line}:${range.start.character}`;
				if (!comments.has(key)) {
					if (!sources.has(uri)) {
						const path = fileURLToPath(uri);
						const source = ts.sys.readFile(path);
						sources.set(
							uri,
							source === undefined
								? undefined
								: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true),
						);
					}
					const file = sources.get(uri);
					comments.set(key, file && declarationDocs(file, range.start));
				}
				const docs = comments.get(key);
				if (docs) return docs;
			}
		},
	};
}

/** Signature help describes the whole overload set at the call site, including constructors. */
export async function overloadHint(
	connection: MessageConnection,
	uri: string,
	name: ts.Identifier,
	positionAt: (index: number) => Position,
) {
	const member = name.parent;
	const callee = ts.isPropertyAccessExpression(member) && member.name === name ? member : name;
	const call = callee.parent;
	if (
		!(ts.isCallExpression(call) || ts.isNewExpression(call)) ||
		call.expression !== callee ||
		!call.arguments
	)
		return '';
	const result = await connection.sendRequest<{ signatures: { label: string }[] } | null>(
		'textDocument/signatureHelp',
		{
			textDocument: { uri },
			position: positionAt(call.arguments.pos),
		},
	);
	const additional = new Set(result?.signatures.map((signature) => signature.label)).size - 1;
	return additional > 0 ? ` (+${additional} overload${additional === 1 ? '' : 's'})` : '';
}
