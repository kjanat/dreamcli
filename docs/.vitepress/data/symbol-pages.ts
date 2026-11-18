/**
 * Symbol page rendering helpers for generated API docs.
 *
 * @module
 */

import { join } from 'node:path';
import type {
	NormalizedApiComment,
	NormalizedApiCommentTag,
	NormalizedApiExport,
	NormalizedApiGroup,
	NormalizedApiModel,
	NormalizedApiNode,
	NormalizedApiType,
} from './api-model.ts';
import { replaceDocLinks, replaceProseLinks } from './doc-links.ts';

type RenderProse = (text: string) => string;

import type { ExampleEntry } from './examples.ts';

export interface GeneratedSymbolPage {
	id: string;
	name: string;
	entrypoint: string;
	publicKind: string;
	routePath: string;
	filePath: string;
	content: string;
	summary: string | null;
}

export function collectSymbolPages(
	model: NormalizedApiModel,
	symbolPagesRoot: string,
	examples: readonly ExampleEntry[],
): readonly GeneratedSymbolPage[] {
	const caseInsensitiveCollisions = collectCaseInsensitiveCollisions(model.exports);
	const exampleLinksBySymbol = collectExampleLinksBySymbol(examples);
	const exportsByName = new Map<string, NormalizedApiExport[]>();
	for (const entry of model.exports) {
		const entries = exportsByName.get(entry.name) ?? [];
		entries.push(entry);
		exportsByName.set(entry.name, entries);
	}

	return model.exports
		.map((entry) => {
			const hasCaseInsensitiveCollision = caseInsensitiveCollisions.has(
				toCollisionKey(entry.entrypoint, entry.name),
			);
			const routePath = toSymbolPageRoute(entry.entrypoint, entry.name, {
				publicKind: entry.publicKind,
				hasCaseInsensitiveCollision,
			});
			const renderProse = (text: string) =>
				replaceProseLinks(text, ({ target, label, code }) => {
					const text = code ? `\`${label}\`` : label.replace(/[[\]]/gu, '\\$&');
					if (/^https?:\/\//u.test(target)) return `[${text}](<${target}>)`;
					const [name, member] = target.replace(/\(\)$/u, '').split(/[.#]/u);
					const candidates = exportsByName.get(name ?? '') ?? [];
					const linked =
						candidates.find((candidate) => candidate.entrypoint === entry.entrypoint) ??
						candidates[0];
					if (linked === undefined) return text;
					const route = toSymbolPageRoute(linked.entrypoint, linked.name, {
						publicKind: linked.publicKind,
						hasCaseInsensitiveCollision: caseInsensitiveCollisions.has(
							toCollisionKey(linked.entrypoint, linked.name),
						),
					});
					const anchor =
						member !== undefined &&
						linked.reflection.children.some((child) => child.name === member)
							? `#${member.toLowerCase()}`
							: '';
					return `[${text}](${route}${anchor})`;
				});
			return {
				id: entry.id,
				name: entry.name,
				entrypoint: entry.entrypoint,
				publicKind: entry.publicKind,
				routePath,
				filePath: toSymbolPageFilePath(symbolPagesRoot, entry.entrypoint, entry.name, {
					publicKind: entry.publicKind,
					hasCaseInsensitiveCollision,
				}),
				content: renderSymbolPage(entry, exampleLinksBySymbol.get(entry.id) ?? [], renderProse),
				summary:
					entry.reflection.comment === null
						? null
						: replaceDocLinks(entry.reflection.comment.summary, ({ label }) => label).trim() ||
							null,
			} satisfies GeneratedSymbolPage;
		})
		.sort((left, right) => left.id.localeCompare(right.id));
}

export function toSymbolPageRoute(
	entrypoint: string,
	symbolName: string,
	options?: {
		publicKind?: string;
		hasCaseInsensitiveCollision?: boolean;
	},
): string {
	return `/reference/symbols/${toSymbolPageSection(entrypoint)}/${toSymbolPageSlug(symbolName, options)}`;
}

export function toSymbolPageFilePath(
	symbolPagesRoot: string,
	entrypoint: string,
	symbolName: string,
	options?: {
		publicKind?: string;
		hasCaseInsensitiveCollision?: boolean;
	},
): string {
	return join(
		symbolPagesRoot,
		toSymbolPageSection(entrypoint),
		`${toSymbolPageSlug(symbolName, options)}.md`,
	);
}

export function collectCaseInsensitiveCollisions(
	entries: readonly { entrypoint: string; name: string }[],
): ReadonlySet<string> {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const key = toCollisionKey(entry.entrypoint, entry.name);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return new Set(
		Array.from(counts.entries())
			.filter(([, count]) => count > 1)
			.map(([key]) => key),
	);
}

export function toCollisionKey(entrypoint: string, symbolName: string): string {
	return `${entrypoint}:${symbolName.toLowerCase()}`;
}

function toSymbolPageSlug(
	symbolName: string,
	options?: {
		publicKind?: string;
		hasCaseInsensitiveCollision?: boolean;
	},
): string {
	if (options?.hasCaseInsensitiveCollision !== true || symbolName === symbolName.toLowerCase()) {
		return symbolName;
	}

	return `${symbolName.toLowerCase()}-${options.publicKind ?? 'symbol'}`;
}

function toSymbolPageSection(entrypoint: string): string {
	if (entrypoint === '@kjanat/dreamcli') {
		return 'main';
	}

	const segments = entrypoint.startsWith('@')
		? entrypoint.split('/').slice(2)
		: entrypoint.split('/').slice(1);
	return segments[0] ?? 'main';
}

function renderSymbolPage(
	entry: NormalizedApiExport,
	relatedExamples: readonly ExampleEntry[],
	renderProse: RenderProse,
): string {
	const summary = summarizeComment(entry.reflection.comment, renderProse);
	const source = entry.reflection.sources[0] ?? null;
	const deprecatedNote = renderDeprecatedNote(entry.reflection.comment, renderProse);
	const exampleTags = collectExampleTags(entry.reflection);
	const sections = [
		renderSignatureSection(entry, renderProse),
		renderMembersSection(entry.reflection, renderProse),
		renderExamplesSection(exampleTags),
		renderRelatedExamplesSection(relatedExamples),
		renderSeeAlsoSection(entry),
	].flatMap((section) => (section === null ? [] : [section]));

	return [
		`# \`${entry.name}\``,
		'',
		summary ?? `Generated reference page for the \`${entry.name}\` ${entry.publicKind} export.`,
		'',
		`- Import: \`${entry.entrypoint}\``,
		`- Export kind: ${entry.publicKind}`,
		`- Declared in: \`${entry.sourcePath}\``,
		...(source?.url !== null && source?.url !== undefined
			? [`- Source link: [\`${source.path}:${source.line}\`](${source.url})`]
			: []),
		'',
		...(deprecatedNote === null ? [] : [deprecatedNote, '']),
		...sections.flatMap((section) => [section, '']),
	].join('\n');
}

function renderSignatureSection(
	entry: NormalizedApiExport,
	renderProse: RenderProse,
): string | null {
	const reflection = entry.reflection;
	const declarations = renderDeclarations(entry.name, reflection, renderProse);
	if (declarations.length === 0) {
		return null;
	}

	return ['## Signatures', '', ...declarations].join('\n');
}

function renderDeclarations(
	name: string,
	reflection: NormalizedApiNode,
	renderProse: RenderProse,
): readonly string[] {
	switch (reflection.kind) {
		case 'function':
			return renderFunctionDeclarations(name, reflection, renderProse);
		case 'class':
			return [renderCodeBlock(renderClassDeclaration(name, reflection))];
		case 'interface':
			return [renderCodeBlock(renderInterfaceDeclaration(name, reflection))];
		case 'typeAlias':
			return [renderCodeBlock(renderTypeAliasDeclaration(name, reflection))];
		case 'enum':
			return [renderCodeBlock(renderEnumDeclaration(name, reflection))];
		case 'variable':
			return [renderCodeBlock(renderVariableDeclaration(name, reflection))];
		default:
			if (reflection.signatures.length > 0) {
				return renderFunctionDeclarations(name, reflection, renderProse);
			}

			if (reflection.type !== null) {
				return [renderCodeBlock(`const ${name}: ${renderType(reflection.type)};`)];
			}

			return [];
	}
}

function renderFunctionDeclarations(
	name: string,
	reflection: NormalizedApiNode,
	renderProse: RenderProse,
): readonly string[] {
	const signatures = reflection.signatures.length === 0 ? [reflection] : reflection.signatures;
	return signatures.map((signature, index) => {
		const lines = signatures.length === 1 ? [] : [`### Overload ${index + 1}`, ''];
		return [
			...lines,
			renderCodeBlock(renderCallableSignature(name, signature, 'function')),
			...renderParameterDetails(signature, renderProse),
		].join('\n');
	});
}

function renderClassDeclaration(name: string, reflection: NormalizedApiNode): string {
	const heritage = [
		...renderHeritageClause('extends', reflection.extendedTypes),
		...renderHeritageClause('implements', reflection.implementedTypes),
	].join(' ');
	const suffix = heritage === '' ? '' : ` ${heritage}`;
	return `class ${name}${renderTypeParameterList(reflection.typeParameters)}${suffix} {}`;
}

function renderInterfaceDeclaration(name: string, reflection: NormalizedApiNode): string {
	const heritage = renderHeritageClause('extends', reflection.extendedTypes).join(' ');
	const suffix = heritage === '' ? '' : ` ${heritage}`;
	return `interface ${name}${renderTypeParameterList(reflection.typeParameters)}${suffix} {}`;
}

function renderTypeAliasDeclaration(name: string, reflection: NormalizedApiNode): string {
	const value = reflection.type === null ? 'unknown' : renderType(reflection.type);
	return `type ${name}${renderTypeParameterList(reflection.typeParameters)} = ${value};`;
}

function renderEnumDeclaration(name: string, reflection: NormalizedApiNode): string {
	const members = reflection.children.map((child) => child.name).join(', ');
	return members === '' ? `enum ${name} {}` : `enum ${name} { ${members} }`;
}

function renderVariableDeclaration(name: string, reflection: NormalizedApiNode): string {
	const value = reflection.type === null ? 'unknown' : renderType(reflection.type);
	return `const ${name}: ${value};`;
}

function renderParameterDetails(
	signature: NormalizedApiNode,
	renderProse: RenderProse,
): readonly string[] {
	if (signature.parameters.length === 0) {
		return [];
	}

	const rows = signature.parameters.flatMap((parameter) => {
		const summary = summarizeComment(parameter.comment, renderProse);
		return summary === null
			? []
			: [
					`| \`${parameter.name}\` | \`${escapeTable(renderParameterType(parameter))}\` | ${escapeTable(summary)} |`,
				];
	});
	if (rows.length === 0) {
		return [];
	}

	return ['', '| Parameter | Type | Description |', '| --- | --- | --- |', ...rows];
}

function renderMembersSection(
	reflection: NormalizedApiNode,
	renderProse: RenderProse,
): string | null {
	const allMembers = [
		...reflection.children,
		...reflection.signatures,
		...reflection.indexSignatures,
	];
	if (allMembers.length === 0) {
		return null;
	}

	const memberById = new Map(allMembers.map((m) => [m.reflectionId, m]));
	const groups =
		reflection.groups.length === 0
			? buildFallbackGroups(allMembers)
			: mergeUngroupedMembers(reflection.groups, allMembers);
	const sections = groups.flatMap((group) => {
		const children = group.children.flatMap((ref) => {
			const child = memberById.get(ref.reflectionId);
			return child === undefined ? [] : [child];
		});
		if (children.length === 0) {
			return [];
		}

		return [
			`### ${group.title}`,
			'',
			...children.flatMap((child) => renderMember(child, renderProse)),
		];
	});
	if (sections.length === 0) {
		return null;
	}

	return ['## Members', '', ...sections].join('\n');
}

function buildFallbackGroups(members: readonly NormalizedApiNode[]): readonly NormalizedApiGroup[] {
	return [
		{
			title: 'Members',
			children: members.map((child) => ({
				reflectionId: child.reflectionId,
				name: child.name,
			})),
		},
	];
}

function mergeUngroupedMembers(
	groups: readonly NormalizedApiGroup[],
	allMembers: readonly NormalizedApiNode[],
): readonly NormalizedApiGroup[] {
	const groupedIds = new Set(groups.flatMap((g) => g.children.map((c) => c.reflectionId)));
	const ungrouped = allMembers.filter((m) => !groupedIds.has(m.reflectionId));
	if (ungrouped.length === 0) {
		return groups;
	}

	return [
		...groups,
		{
			title: 'Signatures',
			children: ungrouped.map((m) => ({
				reflectionId: m.reflectionId,
				name: m.name,
			})),
		},
	];
}

function renderMember(member: NormalizedApiNode, renderProse: RenderProse): readonly string[] {
	const summaries = new Set(
		[member.comment, ...member.signatures.map((signature) => signature.comment)]
			.map((comment) => summarizeComment(comment, renderProse))
			.filter((summary) => summary !== null),
	);
	const declaration = renderMemberDeclaration(member);
	return [
		`#### \`${member.name}\``,
		'',
		...Array.from(summaries).flatMap((summary) => [summary, '']),
		renderCodeBlock(declaration),
		'',
	];
}

function renderMemberName(name: string): string {
	return /^[\p{ID_Start}_$][\p{ID_Continue}$\u200C\u200D]*$/u.test(name)
		? name
		: JSON.stringify(name);
}

function renderMemberDeclaration(member: NormalizedApiNode): string {
	switch (member.kind) {
		case 'property':
			return `${renderMemberName(member.name)}${isOptionalNode(member) ? '?' : ''}: ${renderNodeType(member)};`;
		case 'method':
			return renderMethodDeclaration(member);
		case 'accessor':
		case 'getSignature':
		case 'setSignature':
			return renderAccessorDeclaration(member);
		case 'constructor':
			return (member.signatures.length === 0 ? [member] : member.signatures)
				.map((signature) => renderCallableSignature('constructor', signature, 'constructor'))
				.join('\n');
		case 'interface':
			return renderInterfaceDeclaration(member.name, member);
		case 'typeAlias':
			return renderTypeAliasDeclaration(member.name, member);
		case 'callSignature':
			return renderCallableSignature('', member, 'call');
		case 'indexSignature':
			return renderIndexSignature(member);
		default:
			if (member.signatures.length > 0) {
				return renderMethodDeclaration(member);
			}

			return `${member.name}: ${renderNodeType(member)};`;
	}
}

function renderMethodDeclaration(member: NormalizedApiNode): string {
	return (member.signatures.length === 0 ? [member] : member.signatures)
		.map((signature) => renderCallableSignature(renderMemberName(member.name), signature, 'method'))
		.join('\n');
}

function renderAccessorDeclaration(member: NormalizedApiNode): string {
	const getter = member.getSignature ?? member;
	const setter = member.setSignature;
	if (setter === null) {
		return `get ${renderMemberName(member.name)}(): ${renderNodeType(getter)};`;
	}

	const valueParameter = setter.parameters[0];
	const setterType =
		valueParameter === undefined ? 'unknown' : renderParameter(valueParameter, false);
	return [
		`get ${renderMemberName(member.name)}(): ${renderNodeType(getter)};`,
		`set ${renderMemberName(member.name)}(${setterType});`,
	].join('\n');
}

function renderIndexSignature(member: NormalizedApiNode): string {
	const parameter = member.parameters[0];
	if (parameter === undefined) {
		return `[key: string]: ${renderNodeType(member)};`;
	}

	return `[${parameter.name}: ${renderNodeType(parameter)}]: ${renderNodeType(member)};`;
}

function renderCallableSignature(
	name: string,
	signature: NormalizedApiNode,
	kind: 'function' | 'method' | 'constructor' | 'call',
): string {
	const typeParameters = renderTypeParameterList(signature.typeParameters);
	const parameters = signature.parameters.map((p) => renderParameter(p, false)).join(', ');
	const returnType = signature.type === null ? 'void' : renderType(signature.type);

	if (kind === 'constructor') {
		return `constructor${typeParameters}(${parameters});`;
	}

	if (kind === 'call') {
		return `(${parameters}): ${returnType};`;
	}

	const prefix = kind === 'function' ? 'function ' : '';
	return `${prefix}${name}${typeParameters}(${parameters}): ${returnType};`;
}

function renderParameter(parameter: NormalizedApiNode, includeDefault = true): string {
	const optional = isOptionalNode(parameter);
	const type = parameter.type === null ? 'unknown' : renderType(parameter.type);
	const defaultValue =
		includeDefault && parameter.defaultValue !== null ? ` = ${parameter.defaultValue}` : '';
	if (parameter.type?.kind === 'rest') {
		return `...${parameter.name}: ${renderType(parameter.type.elementType)}[]`;
	}
	if (parameter.flags.includes('isRest')) return `...${parameter.name}: ${type}`;

	return `${parameter.name}${optional && !defaultValue ? '?' : ''}: ${type}${defaultValue}`;
}

function renderParameterType(parameter: NormalizedApiNode): string {
	const optional = isOptionalNode(parameter);
	const type = parameter.type === null ? 'unknown' : renderType(parameter.type);
	const defaultValue = parameter.defaultValue === null ? '' : ` = ${parameter.defaultValue}`;
	if (parameter.type?.kind === 'rest') {
		return `...${renderType(parameter.type.elementType)}[]`;
	}
	if (parameter.flags.includes('isRest')) return `...${type}`;

	return `${type}${optional && !defaultValue ? ' | undefined' : ''}${defaultValue}`;
}

function renderNodeType(node: NormalizedApiNode): string {
	return node.type === null ? 'unknown' : renderType(node.type);
}

function renderType(type: NormalizedApiType): string {
	switch (type.kind) {
		case 'array':
			return `${wrapIfNeeded(type.elementType)}[]`;
		case 'conditional':
			return `${renderType(type.checkType)} extends ${renderType(type.extendsType)} ? ${renderType(type.trueType)} : ${renderType(type.falseType)}`;
		case 'indexedAccess':
			return `${renderType(type.objectType)}[${renderType(type.indexType)}]`;
		case 'inferred':
			return type.constraint === null
				? `infer ${type.name}`
				: `infer ${type.name} extends ${renderType(type.constraint)}`;
		case 'intersection':
			return type.types.map(wrapUnionishType).join(' & ');
		case 'intrinsic':
			return type.name;
		case 'literal':
			return type.value === null ? 'null' : JSON.stringify(type.value);
		case 'mapped':
			return renderMappedType(type);
		case 'namedTupleMember':
			return `${type.name}${type.isOptional ? '?' : ''}: ${renderType(type.element)}`;
		case 'optional':
			return `${renderType(type.elementType)} | undefined`;
		case 'predicate':
			return `${type.asserts ? 'asserts ' : ''}${type.name}${type.targetType === null ? '' : ` is ${renderType(type.targetType)}`}`;
		case 'query':
			return `typeof ${renderType(type.queryType)}`;
		case 'reference':
			return renderReferenceType(type);
		case 'reflection':
			return renderReflectionType(type.declaration);
		case 'rest':
			return `...${renderType(type.elementType)}[]`;
		case 'templateLiteral':
			return `\`${type.head}${type.tail.map((entry) => `\${${renderType(entry.type)}}${entry.text}`).join('')}\``;
		case 'tuple':
			return `[${type.elements.map(renderType).join(', ')}]`;
		case 'typeOperator':
			return `${type.operator} ${wrapIfNeeded(type.target)}`;
		case 'union':
			return type.types.map(renderType).join(' | ');
		case 'unknown':
			return type.name;
	}
}

function renderMappedType(type: Extract<NormalizedApiType, { kind: 'mapped' }>): string {
	const readonlyModifier = type.readonlyModifier === null ? '' : `${type.readonlyModifier} `;
	const optionalModifier = type.optionalModifier === null ? '' : type.optionalModifier;
	const parameterType = type.parameterType === null ? 'unknown' : renderType(type.parameterType);
	const nameType = type.nameType === null ? '' : ` as ${renderType(type.nameType)}`;
	const templateType = type.templateType === null ? 'unknown' : renderType(type.templateType);
	return `{ ${readonlyModifier}[${type.parameter} in ${parameterType}${nameType}]${optionalModifier}: ${templateType} }`;
}

function renderReferenceType(type: Extract<NormalizedApiType, { kind: 'reference' }>): string {
	const targetName = type.qualifiedName ?? type.name;
	const typeArguments =
		type.typeArguments.length === 0 ? '' : `<${type.typeArguments.map(renderType).join(', ')}>`;
	return `${targetName}${typeArguments}`;
}

function renderReflectionType(reflection: NormalizedApiNode): string {
	if (reflection.kind !== 'typeLiteral') {
		return reflection.name;
	}

	if (
		reflection.children.length === 0 &&
		reflection.signatures.length === 0 &&
		reflection.indexSignatures.length === 0
	) {
		return '{}';
	}

	const members = [
		...reflection.signatures.map((signature) => renderCallableSignature('', signature, 'call')),
		...reflection.indexSignatures.map((sig) => renderIndexSignature(sig)),
		...reflection.children.map((child) => renderMemberDeclaration(child)),
	];

	return `{ ${members.join(' ')} }`;
}

function wrapIfNeeded(type: NormalizedApiType): string {
	const rendered = renderType(type);
	return type.kind === 'union' || type.kind === 'intersection' ? `(${rendered})` : rendered;
}

function wrapUnionishType(type: NormalizedApiType): string {
	const rendered = renderType(type);
	return type.kind === 'union' ? `(${rendered})` : rendered;
}

function renderHeritageClause(
	keyword: string,
	types: readonly NormalizedApiType[],
): readonly string[] {
	if (types.length === 0) {
		return [];
	}

	return [`${keyword} ${types.map(renderType).join(', ')}`];
}

function renderExamplesSection(tags: readonly NormalizedApiCommentTag[]): string | null {
	if (tags.length === 0) {
		return null;
	}

	return [
		'## Examples',
		'',
		...tags.flatMap((tag) => [renderExampleBlock(tag.content.trimEnd()), '']),
	].join('\n');
}

function renderRelatedExamplesSection(examples: readonly ExampleEntry[]): string | null {
	if (examples.length === 0) {
		return null;
	}

	return [
		'## Related Examples',
		'',
		...examples.map(
			(example) => `- [${example.title}](${example.routePath}) - \`${example.sourcePath}\``,
		),
	].join('\n');
}

function renderSeeAlsoSection(entry: NormalizedApiExport): string {
	return [
		'## See Also',
		'',
		'- [Examples overview](/examples/)',
		'- [Example Hover](/reference/example-hover-prototype)',
		'- [API overview](/reference/api)',
		`- [${entry.entrypoint}](${toEntrypointReference(entry.entrypoint)})`,
	].join('\n');
}

function collectExampleLinksBySymbol(
	examples: readonly ExampleEntry[],
): ReadonlyMap<string, readonly ExampleEntry[]> {
	const links = new Map<string, ExampleEntry[]>();
	for (const example of examples) {
		for (const symbol of example.relatedSymbols) {
			const existing = links.get(`${symbol.entrypoint}:${symbol.name}`);
			if (existing === undefined) {
				links.set(`${symbol.entrypoint}:${symbol.name}`, [example]);
				continue;
			}

			existing.push(example);
		}
	}

	return links;
}

function toEntrypointReference(entrypoint: string): string {
	switch (entrypoint) {
		case '@kjanat/dreamcli':
			return '/reference/main';
		case '@kjanat/dreamcli/completion':
			return '/reference/completion';
		case '@kjanat/dreamcli/config':
			return '/reference/config';
		case '@kjanat/dreamcli/json-schema':
			return '/reference/json-schema';
		case '@kjanat/dreamcli/prompt':
			return '/reference/prompt';
		case '@kjanat/dreamcli/runtime':
			return '/reference/runtime';
		case '@kjanat/dreamcli/schema':
			return '/reference/schema';
		case '@kjanat/dreamcli/testkit':
			return '/reference/testkit';
		case '@kjanat/dreamcli/version':
			return '/reference/version';
		default:
			return '/reference/api';
	}
}

function collectExampleTags(reflection: NormalizedApiNode): readonly NormalizedApiCommentTag[] {
	const tags = [
		...extractExampleTags(reflection.comment),
		...reflection.signatures.flatMap((signature) => extractExampleTags(signature.comment)),
	];
	return [...new Map(tags.map((tag) => [tag.content, tag])).values()];
}

function extractExampleTags(
	comment: NormalizedApiComment | null,
): readonly NormalizedApiCommentTag[] {
	if (comment === null) {
		return [];
	}

	return comment.blockTags.filter((tag) => tag.tag === '@example' && tag.content.trim() !== '');
}

function renderDeprecatedNote(
	comment: NormalizedApiComment | null,
	renderProse: RenderProse,
): string | null {
	if (comment === null) {
		return null;
	}

	const deprecatedTag = comment.blockTags.find((tag) => tag.tag === '@deprecated');
	if (deprecatedTag !== undefined) {
		const content = renderProse(deprecatedTag.content).trim();
		return content === '' ? '> Deprecated.' : `> Deprecated: ${content}`;
	}

	return comment.modifierTags.includes('@deprecated') ? '> Deprecated.' : null;
}

function summarizeComment(
	comment: NormalizedApiComment | null,
	renderProse: RenderProse,
): string | null {
	if (comment === null) {
		return null;
	}

	const summary = renderProse(comment.summary).trim();
	return summary === '' ? null : summary;
}

function renderTypeParameterList(typeParameters: readonly NormalizedApiNode[]): string {
	if (typeParameters.length === 0) {
		return '';
	}

	return `<${typeParameters.map(renderTypeParameter).join(', ')}>`;
}

function renderTypeParameter(parameter: NormalizedApiNode): string {
	const constraint = parameter.type === null ? '' : ` extends ${renderType(parameter.type)}`;
	return `${parameter.name}${constraint}`;
}

function isOptionalNode(node: NormalizedApiNode): boolean {
	return node.flags.includes('isOptional');
}

function renderCodeBlock(content: string): string {
	return ['```ts', content, '```'].join('\n');
}

function renderExampleBlock(content: string): string {
	return content.startsWith('```') ? content : renderCodeBlock(content);
}

function escapeTable(value: string): string {
	return value.replace(/\r\n|\r|\n/g, '<br>').replaceAll('|', '\\|');
}
