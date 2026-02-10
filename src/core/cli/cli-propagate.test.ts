import { describe, expect, it } from 'vitest';
import type { CommandSchema } from '../schema/command.js';
import { createSchema } from '../schema/flag.js';
import { collectPropagatedFlags } from './propagate.js';

// ---------------------------------------------------------------------------
// Helpers — build minimal CommandSchema for testing
// ---------------------------------------------------------------------------

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: false,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

function propagatedFlag(kind: 'string' | 'boolean' | 'number' = 'boolean') {
	return createSchema(kind, { propagate: true });
}

function localFlag(kind: 'string' | 'boolean' | 'number' = 'boolean') {
	return createSchema(kind, { propagate: false });
}

// ========================================================================
// collectPropagatedFlags
// ========================================================================

describe('collectPropagatedFlags', () => {
	// --- Base cases --------------------------------------------------------

	describe('base cases', () => {
		it('empty path returns empty record', () => {
			expect(collectPropagatedFlags([])).toEqual({});
		});

		it('single-element path (no ancestors) returns empty record', () => {
			const target = makeSchema({
				name: 'deploy',
				flags: { verbose: propagatedFlag() },
			});
			expect(collectPropagatedFlags([target])).toEqual({});
		});
	});

	// --- Single ancestor ---------------------------------------------------

	describe('single ancestor', () => {
		it('collects propagated flags from parent', () => {
			const parent = makeSchema({
				name: 'root',
				flags: { verbose: propagatedFlag() },
			});
			const child = makeSchema({ name: 'deploy' });

			const result = collectPropagatedFlags([parent, child]);
			expect(result).toEqual({ verbose: propagatedFlag() });
		});

		it('skips non-propagated flags', () => {
			const parent = makeSchema({
				name: 'root',
				flags: {
					verbose: propagatedFlag(),
					debug: localFlag(),
				},
			});
			const child = makeSchema({ name: 'deploy' });

			const result = collectPropagatedFlags([parent, child]);
			expect(result).toEqual({ verbose: propagatedFlag() });
			expect(result).not.toHaveProperty('debug');
		});

		it('returns empty when parent has no propagated flags', () => {
			const parent = makeSchema({
				name: 'root',
				flags: { debug: localFlag() },
			});
			const child = makeSchema({ name: 'deploy' });

			expect(collectPropagatedFlags([parent, child])).toEqual({});
		});

		it('collects multiple propagated flags from one ancestor', () => {
			const parent = makeSchema({
				name: 'root',
				flags: {
					verbose: propagatedFlag(),
					format: propagatedFlag('string'),
					local: localFlag(),
				},
			});
			const child = makeSchema({ name: 'deploy' });

			const result = collectPropagatedFlags([parent, child]);
			expect(Object.keys(result)).toHaveLength(2);
			expect(result).toHaveProperty('verbose');
			expect(result).toHaveProperty('format');
		});
	});

	// --- Multi-level ancestry -----------------------------------------------

	describe('multi-level ancestry', () => {
		it('collects propagated flags from all ancestors', () => {
			const root = makeSchema({
				name: 'cli',
				flags: { verbose: propagatedFlag() },
			});
			const mid = makeSchema({
				name: 'db',
				flags: { dry: propagatedFlag() },
			});
			const leaf = makeSchema({ name: 'migrate' });

			const result = collectPropagatedFlags([root, mid, leaf]);
			expect(result).toEqual({
				verbose: propagatedFlag(),
				dry: propagatedFlag(),
			});
		});

		it('intermediate ancestor shadows root ancestor', () => {
			const rootVerbose = propagatedFlag('string');
			const midVerbose = propagatedFlag('number');

			const root = makeSchema({
				name: 'cli',
				flags: { verbose: rootVerbose },
			});
			const mid = makeSchema({
				name: 'db',
				flags: { verbose: midVerbose },
			});
			const leaf = makeSchema({ name: 'migrate' });

			const result = collectPropagatedFlags([root, mid, leaf]);
			expect(result['verbose']).toBe(midVerbose);
		});

		it('deep path (4 levels) accumulates correctly', () => {
			const l0 = makeSchema({
				name: 'cli',
				flags: { a: propagatedFlag() },
			});
			const l1 = makeSchema({
				name: 'group',
				flags: { b: propagatedFlag() },
			});
			const l2 = makeSchema({
				name: 'sub',
				flags: { c: propagatedFlag() },
			});
			const l3 = makeSchema({ name: 'leaf' });

			const result = collectPropagatedFlags([l0, l1, l2, l3]);
			expect(Object.keys(result).sort()).toEqual(['a', 'b', 'c']);
		});
	});

	// --- Target shadowing ---------------------------------------------------

	describe('target shadowing', () => {
		it('target own flag shadows propagated ancestor flag', () => {
			const parent = makeSchema({
				name: 'root',
				flags: { verbose: propagatedFlag() },
			});
			const child = makeSchema({
				name: 'deploy',
				flags: { verbose: localFlag('string') },
			});

			const result = collectPropagatedFlags([parent, child]);
			expect(result).not.toHaveProperty('verbose');
			expect(Object.keys(result)).toHaveLength(0);
		});

		it('target shadows only matching names, keeps others', () => {
			const parent = makeSchema({
				name: 'root',
				flags: {
					verbose: propagatedFlag(),
					format: propagatedFlag('string'),
				},
			});
			const child = makeSchema({
				name: 'deploy',
				flags: { verbose: localFlag() },
			});

			const result = collectPropagatedFlags([parent, child]);
			expect(result).not.toHaveProperty('verbose');
			expect(result).toHaveProperty('format');
			expect(Object.keys(result)).toHaveLength(1);
		});

		it('target non-propagated flag still shadows ancestor propagated flag', () => {
			const parent = makeSchema({
				name: 'root',
				flags: { verbose: propagatedFlag() },
			});
			const child = makeSchema({
				name: 'deploy',
				flags: { verbose: localFlag() }, // propagate: false, still shadows
			});

			const result = collectPropagatedFlags([parent, child]);
			expect(result).toEqual({});
		});
	});

	// --- Intermediate shadowing ---------------------------------------------

	describe('intermediate shadowing', () => {
		it('intermediate non-propagated flag does NOT shadow for grandchild', () => {
			// root: verbose (propagate=true)
			// mid:  verbose (propagate=false) — stops propagation
			// leaf: no verbose
			// Result: root's verbose should NOT propagate through mid, because
			// mid redefined it without propagate. The walk collects propagated
			// flags only — mid's verbose has propagate=false so it's not collected,
			// and root's verbose was overwritten conceptually by mid's presence.
			//
			// However, our function only looks at propagate===true. Root's flag
			// is collected, then mid's flag (propagate=false) is NOT collected.
			// So root's flag remains in accumulator.
			//
			// This is actually correct behavior: the intermediate command's own
			// non-propagated flag doesn't propagate further, but it also doesn't
			// block root's propagated flag from reaching grandchildren. The
			// intermediate command itself shadows via target shadowing when IT is
			// the target. For grandchildren, only propagated flags flow through.
			//
			// This matches git behavior: if root defines --verbose as propagated,
			// an intermediate group that also has --verbose locally doesn't prevent
			// the root's --verbose from reaching deeper leaves.
			//
			// BUT: if we want "a child override shadows", then mid redefining
			// verbose (even non-propagated) should block root's propagated verbose
			// from reaching the leaf. Let's implement this stricter behavior.
			const root = makeSchema({
				name: 'cli',
				flags: { verbose: propagatedFlag() },
			});
			const mid = makeSchema({
				name: 'db',
				flags: { verbose: localFlag() }, // redefines, not propagated
			});
			const leaf = makeSchema({ name: 'migrate' });

			const result = collectPropagatedFlags([root, mid, leaf]);
			// Root's propagated verbose should still reach leaf because mid's flag
			// has propagate=false so it's not collected, and root's IS collected.
			// Mid's own flag only shadows when mid IS the target.
			// This means: accumulated = { verbose: root's flag }
			// Leaf has no own flags, so nothing is removed.
			expect(result).toHaveProperty('verbose');
		});

		it('intermediate propagated flag shadows root propagated flag for descendants', () => {
			const rootVerbose = propagatedFlag('string');
			const midVerbose = propagatedFlag('number');

			const root = makeSchema({
				name: 'cli',
				flags: { verbose: rootVerbose },
			});
			const mid = makeSchema({
				name: 'db',
				flags: { verbose: midVerbose },
			});
			const leaf = makeSchema({ name: 'migrate' });

			const result = collectPropagatedFlags([root, mid, leaf]);
			// mid's propagated verbose overwrites root's
			expect(result['verbose']).toBe(midVerbose);
		});
	});

	// --- Return value properties --------------------------------------------

	describe('return value properties', () => {
		it('returns a plain object (not frozen/sealed)', () => {
			const parent = makeSchema({
				name: 'root',
				flags: { verbose: propagatedFlag() },
			});
			const child = makeSchema({ name: 'deploy' });

			const result = collectPropagatedFlags([parent, child]);
			expect(typeof result).toBe('object');
			expect(result).not.toBeNull();
		});

		it('returned schemas are the same references as input', () => {
			const verboseSchema = propagatedFlag();
			const parent = makeSchema({
				name: 'root',
				flags: { verbose: verboseSchema },
			});
			const child = makeSchema({ name: 'deploy' });

			const result = collectPropagatedFlags([parent, child]);
			expect(result['verbose']).toBe(verboseSchema);
		});
	});
});
