import { describe, expect, it } from 'vitest';
import type { CommandSchema } from '../schema/command.ts';
import { createSchema } from '../schema/flag.ts';
import { collectPropagatedFlags } from './propagate.ts';

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
		it('intermediate non-propagated flag shadows ancestor for grandchild', () => {
			// A child that redefines a flag — even without propagate — masks the
			// ancestor's propagated flag from reaching deeper descendants. This
			// prevents "flag leaking" where an ancestor's propagated flag bypasses
			// an intermediate override.
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
			// Mid's local --verbose blocks root's propagated --verbose from
			// reaching leaf. The flag is not in accumulated.
			expect(result).not.toHaveProperty('verbose');
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
