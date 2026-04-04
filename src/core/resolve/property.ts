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

/** Flag/arg kinds that share a common coercion path. */
const SHARED_PROPERTY_MODEL_KINDS = ['string', 'number', 'enum', 'custom'] as const;

/** Union of kind discriminants that participate in shared coercion. */
type SharedPropertyKind = (typeof SHARED_PROPERTY_MODEL_KINDS)[number];

/** Minimal coercion-relevant slice of a flag or arg schema, discriminated by kind. */
type SharedPropertySchema =
	| { readonly kind: 'string' }
	| { readonly kind: 'number' }
	| { readonly kind: 'enum'; readonly enumValues: readonly string[] | undefined }
	| { readonly kind: 'custom'; readonly parseFn?: (raw: unknown) => unknown };

/** Contract asserting which concerns are shared vs. kept separate between flags and args. */
interface SharedPropertyModelContract {
	/** Only coercion logic is shared; resolution orchestration is not. */
	readonly scope: 'coercion';
	/** The kind discriminants that participate in shared coercion. */
	readonly sharedKinds: readonly SharedPropertyKind[];
	/** Flag and arg precedence chains remain independent. */
	readonly keepsFlagAndArgPrecedenceSeparate: true;
	/** Fallback-on-coercion-error rules remain independent. */
	readonly keepsFallbackRulesSeparate: true;
	/** Required-value validation remains independent. */
	readonly keepsRequiredValueRulesSeparate: true;
}

/** Runtime-accessible contract instance for property model tests. */
const sharedPropertyModelContract = {
	scope: 'coercion',
	sharedKinds: SHARED_PROPERTY_MODEL_KINDS,
	keepsFlagAndArgPrecedenceSeparate: true,
	keepsFallbackRulesSeparate: true,
	keepsRequiredValueRulesSeparate: true,
} satisfies SharedPropertyModelContract;

/** Extract the shared coercion slice from a flag schema, or `undefined` for boolean/array (handled separately). */
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

/** Extract the shared coercion slice from an arg schema (all arg kinds are shared). */
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
