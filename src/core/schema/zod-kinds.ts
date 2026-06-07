/**
 * Kind → zod schema derivation.
 *
 * Derives the canonical **declared-type** zod schema for a flag/arg from its
 * runtime descriptor. zod is the single validation substrate: this schema
 * drives JSON Schema generation (`z.toJSONSchema`) and backs runtime validation
 * in the parse and resolve coercion engines.
 *
 * The schema is derived on demand (pure function of `kind` + `enumValues` +
 * `elementSchema`) rather than stored on the descriptor, so flag/arg schemas
 * remain plain, structurally-comparable, JSON-serialisable objects.
 *
 * Source-specific coercion (comma-splitting arrays, boolean word lists, env/
 * config string handling) is layered on top by the individual engines; this
 * module only models the resolved value type.
 *
 * @module dreamcli/core/schema/zod-kinds
 * @internal
 */

import { z } from 'zod';
import type { ArgSchema } from './arg.ts';
import type { FlagSchema } from './flag.ts';

/** Options influencing the constructed schema for compound/constrained kinds. */
interface ZodKindOptions {
	/** Allowed literals when `kind === 'enum'`. */
	readonly enumValues?: readonly string[] | undefined;
	/** Element schema when `kind === 'array'`. */
	readonly elementZod?: z.ZodType | undefined;
}

/**
 * Build the canonical declared-type zod schema for a flag/arg kind.
 *
 * - `string`  → `z.string()`
 * - `number`  → `z.number()` (rejects `NaN`)
 * - `boolean` → `z.boolean()`
 * - `enum`    → `z.enum(values)` (falls back to `z.string()` when no values yet)
 * - `array`   → `z.array(element)` (element defaults to `z.unknown()`)
 * - `custom`  → `z.unknown()` (opaque; refined by the property's parse function)
 *
 * @param kind - Flag or arg kind discriminator.
 * @param options - Enum values / element schema for compound kinds.
 * @returns A zod schema describing the kind's resolved value type.
 */
function buildZodSchema(kind: string, options: ZodKindOptions = {}): z.ZodType {
	switch (kind) {
		case 'string':
			return z.string();
		case 'number':
			return z.number();
		case 'boolean':
			return z.boolean();
		case 'enum': {
			const values = options.enumValues;
			return values !== undefined && values.length > 0
				? z.enum([...values] as [string, ...string[]])
				: z.string();
		}
		case 'array':
			return z.array(options.elementZod ?? z.unknown());
		case 'custom':
			return z.unknown();
		default:
			return z.unknown();
	}
}

/** Derive the declared-type zod schema for a flag (recurses into array elements). */
function flagZod(schema: FlagSchema): z.ZodType {
	return buildZodSchema(schema.kind, {
		enumValues: schema.enumValues,
		elementZod: schema.elementSchema !== undefined ? flagZod(schema.elementSchema) : undefined,
	});
}

/** Derive the declared-type zod schema for a positional arg. */
function argZod(schema: ArgSchema): z.ZodType {
	return buildZodSchema(schema.kind, { enumValues: schema.enumValues });
}

export type { ZodKindOptions };
export { argZod, buildZodSchema, flagZod };
