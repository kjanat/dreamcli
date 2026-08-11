/**
 * What the command line produced for one input, in the order it was typed.
 *
 * The parser keeps every occurrence of an input as its own {@link Occurrence}:
 * a decoded value token, a `KEY=VALUE` entry, the position a stdin sentinel
 * holds, a negated spelling, or one increment of a count. Nothing folds while
 * argv is being read. {@link projectOccurrences} turns a list into the value a
 * parse result carries, and {@link liftOccurrences} reads such a value back as
 * occurrences, so a caller-built parse result and a parsed one aggregate
 * through the same list.
 *
 * @module dreamcli/core/parse/occurrences
 * @internal
 */

import type { Cardinality } from '#internals/core/schema/cardinality.ts';
import { STDIN_SENTINEL } from '#internals/core/schema/source.ts';

/**
 * One occurrence of an input on the command line.
 *
 * - `'value'`: one decoded value, or one element of a collection
 * - `'entry'`: one decoded `KEY=VALUE` pair
 * - `'stdin'`: the position a `-` selector holds
 * - `'negated'`: a `--no-x` spelling
 * - `'increment'`: one bare occurrence of a count flag
 * - `'aggregated'`: a value a caller aggregated before the resolver saw it
 */
type Occurrence =
	| { readonly kind: 'value'; readonly value: unknown }
	| { readonly kind: 'entry'; readonly key: string; readonly value: unknown }
	| { readonly kind: 'stdin' }
	| { readonly kind: 'negated' }
	| { readonly kind: 'increment' }
	| { readonly kind: 'aggregated'; readonly value: unknown };

/** The sentinel occurrence, shared by every `-` position. */
const STDIN_OCCURRENCE: Occurrence = { kind: 'stdin' };

/** The negated occurrence, shared by every `--no-x` spelling. */
const NEGATED_OCCURRENCE: Occurrence = { kind: 'negated' };

/** One bare occurrence of a count flag. */
const INCREMENT_OCCURRENCE: Occurrence = { kind: 'increment' };

/**
 * The value one occurrence stands for in a parse result.
 *
 * @param occurrence - The occurrence to read.
 * @returns What a parse result carries for it.
 */
function occurrenceValue(occurrence: Occurrence): unknown {
	switch (occurrence.kind) {
		case 'value':
			return occurrence.value;
		case 'entry':
			return [occurrence.key, occurrence.value];
		case 'stdin':
			return STDIN_SENTINEL;
		case 'negated':
			return false;
		case 'increment':
			return 1;
		case 'aggregated':
			return occurrence.value;
	}
}

/**
 * Project one input's occurrences onto the value a parse result carries.
 *
 * A scalar keeps its last occurrence, a count folds its increments and its
 * explicit values, and a collection keeps every occurrence in order for the
 * resolver to aggregate.
 *
 * @param cardinality - How the input's values combine.
 * @param occurrences - Every occurrence of the input, in order.
 * @returns The parse result's value for it.
 */
function projectOccurrences(cardinality: Cardinality, occurrences: readonly Occurrence[]): unknown {
	if (cardinality.kind === 'count') {
		return projectCount(occurrences);
	}
	if (cardinality.kind === 'one') {
		const last = occurrences[occurrences.length - 1];
		return last === undefined ? undefined : occurrenceValue(last);
	}
	return occurrences.map(occurrenceValue);
}

/** Fold a count flag's increments and explicit values in occurrence order. */
function projectCount(occurrences: readonly Occurrence[]): unknown {
	let count: unknown;
	for (const occurrence of occurrences) {
		count =
			occurrence.kind === 'increment'
				? (typeof count === 'number' ? count : 0) + 1
				: occurrenceValue(occurrence);
	}
	return count;
}

/**
 * Read what a parse result carries for a collection back as occurrences.
 *
 * A value the parser did not leave as a list is an aggregate a caller built by
 * hand, so it stays one opaque occurrence and reaches the resolved value
 * untouched.
 *
 * @param cardinality - The `many` or `entries` axis being filled.
 * @param value - What the parse result carries.
 * @param readsOnDash - Whether the input's stdin binding reacts to `-`.
 * @returns The occurrences behind that value.
 */
function liftOccurrences(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	value: unknown,
	readsOnDash: boolean,
): readonly Occurrence[] {
	if (!Array.isArray(value)) return [{ kind: 'aggregated', value }];
	return value.map((element: unknown) => liftElement(cardinality, element, readsOnDash));
}

/** Read one element of a parse result's collection as its occurrence. */
function liftElement(
	cardinality: Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }>,
	element: unknown,
	readsOnDash: boolean,
): Occurrence {
	if (readsOnDash && element === STDIN_SENTINEL) return STDIN_OCCURRENCE;
	if (cardinality.kind === 'entries') {
		const pair = entryPairOf(element);
		if (pair !== undefined) return { kind: 'entry', key: pair[0], value: pair[1] };
	}
	return { kind: 'value', value: element };
}

/** Read one element as the `[key, value]` pair an entry occurrence carries. */
function entryPairOf(element: unknown): readonly [string, unknown] | undefined {
	if (!Array.isArray(element) || element.length !== 2) return undefined;
	const key: unknown = element[0];
	const value: unknown = element[1];
	return typeof key === 'string' ? [key, value] : undefined;
}

/**
 * The aggregate a caller supplied ready-made.
 *
 * @param occurrences - One input's occurrences.
 * @returns The aggregate, or `undefined` when the occurrences are the parser's.
 */
function readAggregated(
	occurrences: readonly Occurrence[],
): { readonly value: unknown } | undefined {
	const only = occurrences.length === 1 ? occurrences[0] : undefined;
	return only?.kind === 'aggregated' ? { value: only.value } : undefined;
}

/**
 * The pairs an `entries` collection folds, in occurrence order.
 *
 * @param occurrences - The occurrences left after splicing.
 * @returns Every pair among them.
 */
function entryPairsOf(occurrences: readonly Occurrence[]): readonly (readonly [string, unknown])[] {
	const pairs: (readonly [string, unknown])[] = [];
	for (const occurrence of occurrences) {
		if (occurrence.kind === 'entry') pairs.push([occurrence.key, occurrence.value]);
	}
	return pairs;
}

export type { Occurrence };
export {
	entryPairsOf,
	INCREMENT_OCCURRENCE,
	liftOccurrences,
	NEGATED_OCCURRENCE,
	occurrenceValue,
	projectOccurrences,
	readAggregated,
	STDIN_OCCURRENCE,
	STDIN_SENTINEL,
};
