/**
 * Reading an indexed environment family out of an env snapshot.
 *
 * Acquisition only: this module decides whether the family supplied a value,
 * how many entries it owns, and which concrete variable each entry or field
 * came from. What the entries mean is the input schema's business, so the
 * result carries raw strings and string records for the surface to decode.
 *
 * @module dreamcli/core/resolve/indexed-env
 * @internal
 */

import type { IndexedEnvBinding } from '#internals/core/schema/env-binding.ts';
import {
	expandEnvTemplate,
	indexedEnvMembers,
	MAX_INDEXED_ENV_COUNT,
} from '#internals/core/schema/env-binding.ts';

/** One declared entry of a family, with the variables it was read from. */
interface IndexedEnvEntry {
	/** Zero-based entry index. */
	readonly index: number;
	/** The entry's raw value: a string for a value family, a string record for a record family. */
	readonly raw: string | Readonly<Record<string, string>>;
	/** The concrete member variables this entry read, in field declaration order. */
	readonly envVars: readonly string[];
}

/** Why a family that claimed the input could not be read. */
type IndexedEnvFault =
	| {
			/** The count is not a canonical non-negative integer. */
			readonly kind: 'count';
			readonly countVar: string;
			readonly raw: string;
	  }
	| {
			/** The count exceeds {@link MAX_INDEXED_ENV_COUNT}. */
			readonly kind: 'limit';
			readonly countVar: string;
			readonly raw: string;
			readonly max: number;
	  }
	| {
			/** A declared entry is missing one of its member variables. */
			readonly kind: 'member';
			readonly countVar: string;
			readonly count: number;
			readonly index: number;
			readonly field: string | undefined;
			readonly envVar: string;
	  };

/** The family's entries, once its count variable claimed the input. */
interface IndexedEnvEntries {
	/** Discriminant. */
	readonly kind: 'entries';
	/** The count variable that claimed the input. */
	readonly countVar: string;
	/** Every declared entry, in index order. */
	readonly entries: readonly IndexedEnvEntry[];
}

/** What reading a family produced. */
type IndexedEnvRead =
	| { readonly kind: 'absent' }
	| { readonly kind: 'fault'; readonly fault: IndexedEnvFault }
	| IndexedEnvEntries;

/** A canonical non-negative integer: no sign, no leading zero, no exponent, no blanks. */
const CANONICAL_COUNT = /^(?:0|[1-9][0-9]*)$/;

/**
 * Look up one variable without reading inherited `Object.prototype` members.
 *
 * @param env - The environment snapshot.
 * @param name - The concrete variable name.
 * @returns The variable's value, or `undefined` when it is unset.
 */
function readEnv(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	return Object.hasOwn(env, name) ? env[name] : undefined;
}

/**
 * Read an indexed family out of an env snapshot.
 *
 * An unset count means the env source supplied nothing. A set count claims the
 * input, so from there every problem is a fault rather than an absence: a
 * count that is not a canonical non-negative integer, a count above the limit,
 * or a declared entry missing one of its members. An empty string counts as
 * set, for the count and for members alike; whether `''` is a valid member is
 * the input schema's call.
 *
 * Indices are enumerated from the count, never discovered by scanning the
 * snapshot, so unrelated variables and the snapshot's key order play no part.
 *
 * @param binding - The normalized family to read.
 * @param env - The environment snapshot.
 * @returns The entries, the first fault, or `absent`.
 */
function readIndexedEnv(
	binding: IndexedEnvBinding,
	env: Readonly<Record<string, string | undefined>>,
): IndexedEnvRead {
	const countVar = binding.count;
	const rawCount = readEnv(env, countVar);
	if (rawCount === undefined) return { kind: 'absent' };
	if (!CANONICAL_COUNT.test(rawCount)) {
		return { kind: 'fault', fault: { kind: 'count', countVar, raw: rawCount } };
	}
	const count = Number(rawCount);
	if (count > MAX_INDEXED_ENV_COUNT) {
		return {
			kind: 'fault',
			fault: { kind: 'limit', countVar, raw: rawCount, max: MAX_INDEXED_ENV_COUNT },
		};
	}

	const members = indexedEnvMembers(binding);
	const entries: IndexedEnvEntry[] = [];
	for (let index = 0; index < count; index++) {
		const envVars: string[] = [];
		const values: (readonly [string | undefined, string])[] = [];
		for (const [field, template] of members) {
			const envVar = expandEnvTemplate(template, index);
			const value = readEnv(env, envVar);
			if (value === undefined) {
				return {
					kind: 'fault',
					fault: { kind: 'member', countVar, count, index, field, envVar },
				};
			}
			envVars.push(envVar);
			values.push([field, value]);
		}
		const raw =
			binding.fields === undefined
				? (values[0]?.[1] ?? '')
				: // fromEntries defines own properties, so a field named `__proto__`
					// stays a plain key instead of replacing the record's prototype.
					(Object.fromEntries(values) as Readonly<Record<string, string>>);
		entries.push({ index, raw, envVars });
	}
	return { kind: 'entries', countVar, entries };
}

export type { IndexedEnvEntries, IndexedEnvEntry, IndexedEnvFault, IndexedEnvRead };
export { readIndexedEnv };
