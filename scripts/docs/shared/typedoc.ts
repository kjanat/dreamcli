/**
 * TypeDoc collection and normalization helpers for generated API docs.
 *
 * @module
 */

import { dirname, extname, resolve } from 'node:path';

import { Application, type JSONOutput, normalizePath, ReflectionKind } from 'typedoc';

import type { PublicApiEntrypoint, PublicApiSymbol, PublicApiSymbolKind } from './api-index.ts';
import { tsconfigPath } from './paths.ts';

export interface NormalizedApiCommentTag {
	tag: string;
	content: string;
	name: string | null;
}

export interface NormalizedApiComment {
	summary: string;
	blockTags: readonly NormalizedApiCommentTag[];
	modifierTags: readonly string[];
}

export interface NormalizedApiSource {
	path: string;
	line: number;
	character: number;
	url: string | null;
}

export interface NormalizedApiGroup {
	title: string;
	childNames: readonly string[];
}

export type NormalizedApiType =
	| {
			kind: 'array';
			elementType: NormalizedApiType;
	  }
	| {
			kind: 'conditional';
			checkType: NormalizedApiType;
			extendsType: NormalizedApiType;
			trueType: NormalizedApiType;
			falseType: NormalizedApiType;
	  }
	| {
			kind: 'indexedAccess';
			objectType: NormalizedApiType;
			indexType: NormalizedApiType;
	  }
	| {
			kind: 'inferred';
			name: string;
			constraint: NormalizedApiType | null;
	  }
	| {
			kind: 'intersection';
			types: readonly NormalizedApiType[];
	  }
	| {
			kind: 'intrinsic';
			name: string;
	  }
	| {
			kind: 'literal';
			value: string;
	  }
	| {
			kind: 'mapped';
			parameter: string;
			parameterType: NormalizedApiType | null;
			templateType: NormalizedApiType | null;
			readonlyModifier: string | null;
			optionalModifier: string | null;
			nameType: NormalizedApiType | null;
	  }
	| {
			kind: 'namedTupleMember';
			name: string;
			isOptional: boolean;
			element: NormalizedApiType;
	  }
	| {
			kind: 'optional';
			elementType: NormalizedApiType;
	  }
	| {
			kind: 'predicate';
			name: string;
			asserts: boolean;
			targetType: NormalizedApiType | null;
	  }
	| {
			kind: 'query';
			queryType: NormalizedApiType;
	  }
	| {
			kind: 'reference';
			name: string;
			target: string | null;
			packageName: string | null;
			qualifiedName: string | null;
			externalUrl: string | null;
			refersToTypeParameter: boolean;
			typeArguments: readonly NormalizedApiType[];
	  }
	| {
			kind: 'reflection';
			declaration: NormalizedApiNode;
	  }
	| {
			kind: 'rest';
			elementType: NormalizedApiType;
	  }
	| {
			kind: 'templateLiteral';
			head: string;
			tail: readonly {
				type: NormalizedApiType;
				text: string;
			}[];
	  }
	| {
			kind: 'tuple';
			elements: readonly NormalizedApiType[];
	  }
	| {
			kind: 'typeOperator';
			operator: string;
			target: NormalizedApiType;
	  }
	| {
			kind: 'union';
			types: readonly NormalizedApiType[];
	  }
	| {
			kind: 'unknown';
			name: string;
	  };

export type NormalizedApiNodeKind =
	| 'accessor'
	| 'callSignature'
	| 'class'
	| 'constructor'
	| 'constructorSignature'
	| 'document'
	| 'enum'
	| 'enumMember'
	| 'function'
	| 'getSignature'
	| 'indexSignature'
	| 'interface'
	| 'method'
	| 'module'
	| 'namespace'
	| 'parameter'
	| 'project'
	| 'property'
	| 'reference'
	| 'setSignature'
	| 'typeAlias'
	| 'typeLiteral'
	| 'typeParameter'
	| 'variable'
	| 'unknown';

export interface NormalizedApiNode {
	reflectionId: number;
	name: string;
	kind: NormalizedApiNodeKind;
	flags: readonly string[];
	comment: NormalizedApiComment | null;
	sourcePath: string | null;
	sources: readonly NormalizedApiSource[];
	defaultValue: string | null;
	type: NormalizedApiType | null;
	signatures: readonly NormalizedApiNode[];
	parameters: readonly NormalizedApiNode[];
	typeParameters: readonly NormalizedApiNode[];
	children: readonly NormalizedApiNode[];
	indexSignatures: readonly NormalizedApiNode[];
	getSignature: NormalizedApiNode | null;
	setSignature: NormalizedApiNode | null;
	extendedTypes: readonly NormalizedApiType[];
	implementedTypes: readonly NormalizedApiType[];
	groups: readonly NormalizedApiGroup[];
}

export interface NormalizedApiExport {
	id: string;
	name: string;
	entrypoint: string;
	subpath: string;
	publicKind: PublicApiSymbolKind;
	sourcePath: string;
	reflection: NormalizedApiNode;
}

export interface NormalizedApiEntrypoint {
	entrypoint: string;
	subpath: string;
	sourcePath: string;
	hasTypeDoc: boolean;
	exportIds: readonly string[];
	missingExports: readonly string[];
}

export interface NormalizedApiModel {
	schemaVersion: '1';
	typedocSchemaVersion: string;
	packageName: string;
	entrypoints: readonly NormalizedApiEntrypoint[];
	exports: readonly NormalizedApiExport[];
}

export async function collectTypeDocModel(
	packageJsonFilePath: string,
	publicApi: readonly PublicApiEntrypoint[],
): Promise<{
	rawProject: JSONOutput.ProjectReflection;
	normalized: NormalizedApiModel;
}> {
	const rootDir = dirname(packageJsonFilePath);
	const rawProject = await collectRawTypeDocProject(rootDir, publicApi);
	const moduleMap = new Map<string, JSONOutput.DeclarationReflection>(
		(rawProject.children ?? []).map((entrypoint) => [entrypoint.name, entrypoint]),
	);
	const normalizedExports: NormalizedApiExport[] = [];

	const entrypoints = publicApi.map((entrypoint) => {
		const typeDocModule = moduleMap.get(entrypoint.entrypoint);
		const moduleChildren = typeDocModule?.children ?? [];
		const exportIds: string[] = [];
		const missingExports: string[] = [];

		for (const symbol of flattenEntrypointSymbols(entrypoint)) {
			const reflection = moduleChildren.find((child) => child.name === symbol.name);
			if (reflection === undefined) {
				missingExports.push(symbol.name);
				continue;
			}

			const exportId = `${entrypoint.entrypoint}:${symbol.name}`;
			exportIds.push(exportId);
			normalizedExports.push({
				id: exportId,
				name: symbol.name,
				entrypoint: entrypoint.entrypoint,
				subpath: entrypoint.subpath,
				publicKind: symbol.kind,
				sourcePath: symbol.sourcePath,
				reflection: normalizeReflection(reflection),
			});
		}

		return {
			entrypoint: entrypoint.entrypoint,
			subpath: entrypoint.subpath,
			sourcePath: entrypoint.sourcePath,
			hasTypeDoc: typeDocModule !== undefined,
			exportIds,
			missingExports,
		} satisfies NormalizedApiEntrypoint;
	});

	return {
		rawProject,
		normalized: {
			schemaVersion: '1',
			typedocSchemaVersion: rawProject.schemaVersion,
			packageName: rawProject.packageName ?? rawProject.name,
			entrypoints,
			exports: normalizedExports,
		},
	};
}

async function collectRawTypeDocProject(
	rootDir: string,
	publicApi: readonly PublicApiEntrypoint[],
): Promise<JSONOutput.ProjectReflection> {
	const entryPoints = publicApi
		.filter((entrypoint) => extname(entrypoint.sourcePath) === '.ts')
		.map((entrypoint) => resolve(rootDir, entrypoint.sourcePath));
	const app = await Application.bootstrap({
		entryPoints,
		entryPointStrategy: 'resolve',
		plugin: [],
		sourceLinkTemplate: 'https://github.com/kjanat/dreamcli/blob/master/{path}#L{line}',
		tsconfig: tsconfigPath,
	});
	const project = await app.convert();
	if (project === undefined) {
		throw new Error('TypeDoc conversion failed for generated API docs');
	}

	return app.serializer.projectToObject(project, normalizePath(rootDir));
}

function flattenEntrypointSymbols(entrypoint: PublicApiEntrypoint): readonly PublicApiSymbol[] {
	return entrypoint.kindGroups
		.flatMap((group) => group.symbols)
		.filter((symbol) => symbol.kind !== 'asset');
}

type TypeDocNode =
	| JSONOutput.DeclarationReflection
	| JSONOutput.SignatureReflection
	| JSONOutput.ParameterReflection
	| JSONOutput.ProjectReflection
	| JSONOutput.TypeParameterReflection;

function normalizeReflection(reflection: TypeDocNode): NormalizedApiNode {
	const children =
		('children' in reflection ? reflection.children : undefined)?.map(normalizeReflection) ?? [];
	const indexSignatures =
		('indexSignatures' in reflection ? reflection.indexSignatures : undefined)?.map(
			normalizeReflection,
		) ?? [];
	const signatures =
		('signatures' in reflection ? reflection.signatures : undefined)?.map(normalizeReflection) ??
		[];
	const parameters =
		('parameters' in reflection ? reflection.parameters : undefined)?.map(normalizeReflection) ??
		[];
	const typeParameters =
		('typeParameters' in reflection ? reflection.typeParameters : undefined)?.map(
			normalizeReflection,
		) ?? [];
	const getSignatureValue =
		'getSignature' in reflection && reflection.getSignature !== undefined
			? normalizeReflection(reflection.getSignature)
			: null;
	const setSignatureValue =
		'setSignature' in reflection && reflection.setSignature !== undefined
			? normalizeReflection(reflection.setSignature)
			: null;

	return {
		reflectionId: reflection.id,
		name: reflection.name,
		kind: normalizeReflectionKind(reflection.kind),
		flags: normalizeFlags(reflection.flags),
		comment: normalizeComment(reflection.comment),
		sourcePath: normalizeSourcePath(getSources(reflection)),
		sources: getSources(reflection).map(normalizeSource),
		defaultValue:
			'defaultValue' in reflection && reflection.defaultValue !== undefined
				? reflection.defaultValue
				: null,
		type:
			'type' in reflection && reflection.type !== undefined ? normalizeType(reflection.type) : null,
		signatures,
		parameters,
		typeParameters,
		children,
		indexSignatures,
		getSignature: getSignatureValue,
		setSignature: setSignatureValue,
		extendedTypes:
			('extendedTypes' in reflection ? reflection.extendedTypes : undefined)?.map(normalizeType) ??
			[],
		implementedTypes:
			('implementedTypes' in reflection ? reflection.implementedTypes : undefined)?.map(
				normalizeType,
			) ?? [],
		groups: normalizeGroups('groups' in reflection ? reflection.groups : undefined, children),
	};
}

function normalizeReflectionKind(kind: number): NormalizedApiNodeKind {
	switch (kind) {
		case ReflectionKind.Accessor:
			return 'accessor';
		case ReflectionKind.CallSignature:
			return 'callSignature';
		case ReflectionKind.Class:
			return 'class';
		case ReflectionKind.Constructor:
			return 'constructor';
		case ReflectionKind.ConstructorSignature:
			return 'constructorSignature';
		case ReflectionKind.Document:
			return 'document';
		case ReflectionKind.Enum:
			return 'enum';
		case ReflectionKind.EnumMember:
			return 'enumMember';
		case ReflectionKind.Function:
			return 'function';
		case ReflectionKind.GetSignature:
			return 'getSignature';
		case ReflectionKind.IndexSignature:
			return 'indexSignature';
		case ReflectionKind.Interface:
			return 'interface';
		case ReflectionKind.Method:
			return 'method';
		case ReflectionKind.Module:
			return 'module';
		case ReflectionKind.Namespace:
			return 'namespace';
		case ReflectionKind.Parameter:
			return 'parameter';
		case ReflectionKind.Project:
			return 'project';
		case ReflectionKind.Property:
			return 'property';
		case ReflectionKind.Reference:
			return 'reference';
		case ReflectionKind.SetSignature:
			return 'setSignature';
		case ReflectionKind.TypeAlias:
			return 'typeAlias';
		case ReflectionKind.TypeLiteral:
			return 'typeLiteral';
		case ReflectionKind.TypeParameter:
			return 'typeParameter';
		case ReflectionKind.Variable:
			return 'variable';
		default:
			return 'unknown';
	}
}

function normalizeFlags(flags: JSONOutput.ReflectionFlags): readonly string[] {
	return Object.entries(flags)
		.filter(([, enabled]) => enabled === true)
		.map(([flag]) => flag)
		.sort();
}

function normalizeComment(comment: JSONOutput.Comment | undefined): NormalizedApiComment | null {
	if (comment === undefined) {
		return null;
	}

	return {
		summary: displayPartsToText(comment.summary),
		blockTags: (comment.blockTags ?? []).map((tag) => ({
			tag: tag.tag,
			content: displayPartsToText(tag.content),
			name: tag.name ?? null,
		})),
		modifierTags: comment.modifierTags ?? [],
	};
}

function displayPartsToText(parts: readonly JSONOutput.CommentDisplayPart[]): string {
	return parts.map((part) => part.text).join('');
}

function getSources(reflection: TypeDocNode): readonly JSONOutput.SourceReference[] {
	return 'sources' in reflection ? (reflection.sources ?? []) : [];
}

function normalizeSource(source: JSONOutput.SourceReference): NormalizedApiSource {
	return {
		path: source.fileName,
		line: source.line,
		character: source.character,
		url: source.url ?? null,
	};
}

function normalizeSourcePath(sources: readonly JSONOutput.SourceReference[]): string | null {
	const firstSource = sources[0];
	return firstSource?.fileName ?? null;
}

function normalizeGroups(
	groups: readonly JSONOutput.ReflectionGroup[] | undefined,
	children: readonly NormalizedApiNode[],
): readonly NormalizedApiGroup[] {
	if (groups === undefined) {
		return [];
	}

	return groups.map((group) => ({
		title: group.title,
		childNames: (group.children ?? []).flatMap((childId) => {
			const child = children.find((entry) => entry.reflectionId === childId);
			return child === undefined ? [] : [child.name];
		}),
	}));
}

function normalizeType(type: JSONOutput.SomeType): NormalizedApiType {
	switch (type.type) {
		case 'array':
			return { kind: 'array', elementType: normalizeType(type.elementType) };
		case 'conditional':
			return {
				kind: 'conditional',
				checkType: normalizeType(type.checkType),
				extendsType: normalizeType(type.extendsType),
				trueType: normalizeType(type.trueType),
				falseType: normalizeType(type.falseType),
			};
		case 'indexedAccess':
			return {
				kind: 'indexedAccess',
				objectType: normalizeType(type.objectType),
				indexType: normalizeType(type.indexType),
			};
		case 'inferred':
			return {
				kind: 'inferred',
				name: type.name,
				constraint: type.constraint === undefined ? null : normalizeType(type.constraint),
			};
		case 'intersection':
			return { kind: 'intersection', types: type.types.map(normalizeType) };
		case 'intrinsic':
			return { kind: 'intrinsic', name: type.name };
		case 'literal':
			return { kind: 'literal', value: String(type.value) };
		case 'mapped':
			return {
				kind: 'mapped',
				parameter: type.parameter,
				parameterType: type.parameterType === undefined ? null : normalizeType(type.parameterType),
				templateType: type.templateType === undefined ? null : normalizeType(type.templateType),
				readonlyModifier: type.readonlyModifier ?? null,
				optionalModifier: type.optionalModifier ?? null,
				nameType: type.nameType === undefined ? null : normalizeType(type.nameType),
			};
		case 'namedTupleMember':
			return {
				kind: 'namedTupleMember',
				name: type.name,
				isOptional: type.isOptional,
				element: normalizeType(type.element),
			};
		case 'optional':
			return { kind: 'optional', elementType: normalizeType(type.elementType) };
		case 'predicate':
			return {
				kind: 'predicate',
				name: type.name,
				asserts: type.asserts,
				targetType: type.targetType === undefined ? null : normalizeType(type.targetType),
			};
		case 'query':
			return { kind: 'query', queryType: normalizeType(type.queryType) };
		case 'reference':
			return {
				kind: 'reference',
				name: type.name,
				target: normalizeReferenceTarget(type.target),
				packageName: type.package ?? null,
				qualifiedName: type.qualifiedName ?? null,
				externalUrl: type.externalUrl ?? null,
				refersToTypeParameter: type.refersToTypeParameter ?? false,
				typeArguments: (type.typeArguments ?? []).map(normalizeType),
			};
		case 'reflection':
			return { kind: 'reflection', declaration: normalizeReflection(type.declaration) };
		case 'rest':
			return { kind: 'rest', elementType: normalizeType(type.elementType) };
		case 'templateLiteral':
			return {
				kind: 'templateLiteral',
				head: type.head,
				tail: type.tail.map(([tailType, text]) => ({ type: normalizeType(tailType), text })),
			};
		case 'tuple':
			return { kind: 'tuple', elements: (type.elements ?? []).map(normalizeType) };
		case 'typeOperator':
			return {
				kind: 'typeOperator',
				operator: type.operator,
				target: normalizeType(type.target),
			};
		case 'union':
			return { kind: 'union', types: type.types.map(normalizeType) };
		case 'unknown':
			return { kind: 'unknown', name: type.name };
	}
}

function normalizeReferenceTarget(target: number | JSONOutput.ReflectionSymbolId): string {
	if (typeof target === 'number') {
		return String(target);
	}

	return `${target.packageName}:${target.packagePath}:${target.qualifiedName}`;
}
