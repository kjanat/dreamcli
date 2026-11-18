/** API model consumed by the reference pages and schema generator. @module */

import type { PublicApiSymbolKind } from './api-index.ts';

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

export interface NormalizedApiGroupChild {
	reflectionId: number;
	name: string;
}

export interface NormalizedApiGroup {
	title: string;
	children: readonly NormalizedApiGroupChild[];
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
			value: string | number | boolean | null;
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
	hasDocumentation: boolean;
	exportIds: readonly string[];
	missingExports: readonly string[];
}

export interface NormalizedApiModel {
	schemaVersion: '1';
	collectorVersion: number;
	packageName: string;
	entrypoints: readonly NormalizedApiEntrypoint[];
	exports: readonly NormalizedApiExport[];
}
