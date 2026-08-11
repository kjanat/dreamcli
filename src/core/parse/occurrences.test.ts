/**
 * The occurrence representation itself: what a list projects to, and what a
 * parse result lifts back to.
 *
 * @module dreamcli/core/parse/occurrences.test
 */

import { describe, expect, it } from 'vitest';
import type { Cardinality } from '#internals/core/schema/cardinality.ts';
import { flagCardinality } from '#internals/core/schema/cardinality.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { Occurrence } from './occurrences.ts';
import {
	entryPairsOf,
	INCREMENT_OCCURRENCE,
	liftOccurrences,
	NEGATED_OCCURRENCE,
	occurrenceValue,
	projectOccurrences,
	readAggregated,
	STDIN_OCCURRENCE,
} from './occurrences.ts';

const ONE: Cardinality = flagCardinality(flag.string().schema);
const COUNT: Cardinality = flagCardinality(flag.count().schema);
const MANY = flagCardinality(flag.array(flag.string()).schema);
const ENTRIES = flagCardinality(flag.keyValue().schema);

/** Narrow a cardinality to the collection arm the lift accepts. */
function collection(
	cardinality: Cardinality,
): Extract<Cardinality, { kind: 'many' } | { kind: 'entries' }> {
	if (cardinality.kind === 'many' || cardinality.kind === 'entries') return cardinality;
	throw new Error(`expected a collection, got ${cardinality.kind}`);
}

const MANY_COLLECTION = collection(MANY);
const ENTRIES_COLLECTION = collection(ENTRIES);

// === Projection

describe('occurrenceValue', () => {
	it('reads each kind as the value a parse result carries', () => {
		expect(occurrenceValue({ kind: 'value', value: 42 })).toBe(42);
		expect(occurrenceValue({ kind: 'entry', key: 'A', value: '1' })).toEqual(['A', '1']);
		expect(occurrenceValue(STDIN_OCCURRENCE)).toBe('-');
		expect(occurrenceValue(NEGATED_OCCURRENCE)).toBe(false);
		expect(occurrenceValue({ kind: 'aggregated', value: { A: '1' } })).toEqual({ A: '1' });
	});
});

// --- Scalar projection

describe('projectOccurrences, one', () => {
	it('keeps the last occurrence', () => {
		expect(
			projectOccurrences(ONE, [
				{ kind: 'value', value: 'us' },
				{ kind: 'value', value: 'eu' },
			]),
		).toBe('eu');
	});

	it('reads a negation as false', () => {
		expect(projectOccurrences(ONE, [{ kind: 'value', value: true }, NEGATED_OCCURRENCE])).toBe(
			false,
		);
		expect(projectOccurrences(ONE, [NEGATED_OCCURRENCE, { kind: 'value', value: true }])).toBe(
			true,
		);
	});

	it('keeps the sentinel for the resolver to read', () => {
		expect(projectOccurrences(ONE, [STDIN_OCCURRENCE])).toBe('-');
	});

	it('produces nothing without an occurrence', () => {
		expect(projectOccurrences(ONE, [])).toBeUndefined();
	});
});

// --- Count projection

describe('projectOccurrences, count', () => {
	it('adds one per bare occurrence', () => {
		expect(
			projectOccurrences(COUNT, [INCREMENT_OCCURRENCE, INCREMENT_OCCURRENCE, INCREMENT_OCCURRENCE]),
		).toBe(3);
	});

	it('lets an explicit value replace the running count', () => {
		expect(projectOccurrences(COUNT, [INCREMENT_OCCURRENCE, { kind: 'value', value: 2 }])).toBe(2);
	});

	it('resumes counting from an explicit value', () => {
		expect(projectOccurrences(COUNT, [{ kind: 'value', value: 2 }, INCREMENT_OCCURRENCE])).toBe(3);
	});

	it('produces nothing without an occurrence', () => {
		expect(projectOccurrences(COUNT, [])).toBeUndefined();
	});
});

// --- Collection projection

describe('projectOccurrences, collections', () => {
	it('keeps every element in the order it was typed', () => {
		expect(
			projectOccurrences(MANY, [
				{ kind: 'value', value: 'a' },
				STDIN_OCCURRENCE,
				{ kind: 'value', value: 'b' },
			]),
		).toEqual(['a', '-', 'b']);
	});

	it('keeps entries as ordered pairs rather than folding them', () => {
		expect(
			projectOccurrences(ENTRIES, [
				{ kind: 'entry', key: 'A', value: '1' },
				{ kind: 'entry', key: 'A', value: '2' },
			]),
		).toEqual([
			['A', '1'],
			['A', '2'],
		]);
	});

	it('produces an empty collection without an occurrence', () => {
		expect(projectOccurrences(MANY, [])).toEqual([]);
		expect(projectOccurrences(ENTRIES, [])).toEqual([]);
	});
});

// === Lifting

describe('liftOccurrences', () => {
	it('round-trips what a projection produced', () => {
		const occurrences: readonly Occurrence[] = [
			{ kind: 'value', value: 'a' },
			STDIN_OCCURRENCE,
			{ kind: 'value', value: 'b' },
		];
		const projected = projectOccurrences(MANY, occurrences);
		expect(liftOccurrences(MANY_COLLECTION, projected, true)).toEqual(occurrences);
	});

	it('round-trips a projected entries list', () => {
		const occurrences: readonly Occurrence[] = [
			{ kind: 'entry', key: 'A', value: '1' },
			STDIN_OCCURRENCE,
		];
		const projected = projectOccurrences(ENTRIES, occurrences);
		expect(liftOccurrences(ENTRIES_COLLECTION, projected, true)).toEqual(occurrences);
	});

	it('reads a dash as an element when the input never reads stdin', () => {
		expect(liftOccurrences(MANY_COLLECTION, ['-'], false)).toEqual([{ kind: 'value', value: '-' }]);
	});

	it('keeps a pair-shaped element of a many collection as one element', () => {
		expect(liftOccurrences(MANY_COLLECTION, [['A', '1']], false)).toEqual([
			{ kind: 'value', value: ['A', '1'] },
		]);
	});

	it('reads an element that is not a pair as a value inside an entries collection', () => {
		expect(liftOccurrences(ENTRIES_COLLECTION, ['junk', [1, 'v']], false)).toEqual([
			{ kind: 'value', value: 'junk' },
			{ kind: 'value', value: [1, 'v'] },
		]);
	});

	it('holds an aggregate a caller built by hand as one occurrence', () => {
		expect(liftOccurrences(ENTRIES_COLLECTION, { A: '1' }, false)).toEqual([
			{ kind: 'aggregated', value: { A: '1' } },
		]);
		expect(liftOccurrences(MANY_COLLECTION, 'a,b', false)).toEqual([
			{ kind: 'aggregated', value: 'a,b' },
		]);
	});
});

// === Aggregation

describe('readAggregated', () => {
	it('names the aggregate a caller supplied', () => {
		expect(readAggregated([{ kind: 'aggregated', value: 7 }])).toEqual({ value: 7 });
	});

	it('names nothing for occurrences the parser produced', () => {
		expect(readAggregated([{ kind: 'value', value: 7 }])).toBeUndefined();
		expect(readAggregated([])).toBeUndefined();
	});
});

// === Entry pairs

describe('entryPairsOf', () => {
	it('keeps every entry in order and drops the rest', () => {
		expect(
			entryPairsOf([
				{ kind: 'entry', key: 'A', value: '1' },
				{ kind: 'value', value: 'junk' },
				{ kind: 'entry', key: 'B', value: '2' },
			]),
		).toEqual([
			['A', '1'],
			['B', '2'],
		]);
	});
});
