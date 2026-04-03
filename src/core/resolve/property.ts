/**
 * Internal shared property-model helpers for resolver coercion.
 *
 * This seam is intentionally narrow: flags and args share coercion-compatible
 * kinds, but they do not share precedence order, fallback rules, or
 * required-value validation.
 *
 * @module dreamcli/core/resolve/property
 * @internal
 */

import type { ArgSchema, FlagSchema } from '#internals/core/schema/index.ts';

const SHARED_PROPERTY_MODEL_KINDS = ['string', 'number', 'enum', 'custom'] as const;

type SharedPropertyKind = (typeof SHARED_PROPERTY_MODEL_KINDS)[number];

type SharedPropertySchema =
	| { readonly kind: 'string' }
	| { readonly kind: 'number' }
	| { readonly kind: 'enum'; readonly enumValues: readonly string[] | undefined }
	| { readonly kind: 'custom'; readonly parseFn?: (raw: unknown) => unknown };

interface SharedPropertyModelContract {
	readonly scope: 'coercion';
	readonly sharedKinds: readonly SharedPropertyKind[];
	readonly keepsFlagAndArgPrecedenceSeparate: true;
	readonly keepsFallbackRulesSeparate: true;
	readonly keepsRequiredValueRulesSeparate: true;
}

const sharedPropertyModelContract = {
	scope: 'coercion',
	sharedKinds: SHARED_PROPERTY_MODEL_KINDS,
	keepsFlagAndArgPrecedenceSeparate: true,
	keepsFallbackRulesSeparate: true,
	keepsRequiredValueRulesSeparate: true,
} satisfies SharedPropertyModelContract;

function toSharedFlagPropertySchema(schema: FlagSchema): SharedPropertySchema | undefined {
	switch (schema.kind) {
		case 'string':
			return { kind: 'string' };
		case 'number':
			return { kind: 'number' };
		case 'enum':
			return { kind: 'enum', enumValues: schema.enumValues };
		case 'custom':
			return schema.parseFn === undefined
				? { kind: 'custom' }
				: { kind: 'custom', parseFn: schema.parseFn };
		case 'boolean':
		case 'array':
			return undefined;
	}
}

function toSharedArgPropertySchema(schema: ArgSchema): SharedPropertySchema {
	switch (schema.kind) {
		case 'string':
			return { kind: 'string' };
		case 'number':
			return { kind: 'number' };
		case 'enum':
			return { kind: 'enum', enumValues: schema.enumValues };
		case 'custom': {
			if (schema.parseFn === undefined) {
				return { kind: 'custom' };
			}

			const parseFn = schema.parseFn;

			return {
				kind: 'custom',
				parseFn: (raw: unknown): unknown => parseFn(typeof raw === 'string' ? raw : String(raw)),
			};
		}
	}
}

export type { SharedPropertyKind, SharedPropertyModelContract, SharedPropertySchema };
export {
	SHARED_PROPERTY_MODEL_KINDS,
	sharedPropertyModelContract,
	toSharedArgPropertySchema,
	toSharedFlagPropertySchema,
};
