import { describe, expect, it } from 'vitest';
import type { ResolutionProvenance } from './provenance.ts';
import { wasExplicit } from './provenance.ts';

// === L18 — the explicitness predicate over the provenance record

describe('wasExplicit()', () => {
	const table: ReadonlyArray<readonly [string, ResolutionProvenance | undefined, boolean]> = [
		['a typed CLI value', { stage: 'cli' }, true],
		['an explicit dash', { stage: 'cli', via: 'stdin', trigger: 'dash' }, true],
		['the stdin fallback', { stage: 'stdin', via: 'stdin', trigger: 'fallback' }, true],
		['an environment value', { stage: 'env', envVar: 'REGION' }, true],
		['a config value', { stage: 'config', configPath: 'deploy.region' }, true],
		['a prompt answer', { stage: 'prompt' }, true],
		['a declared default', { stage: 'default' }, false],
		['an input that resolved nothing', undefined, false],
	];

	for (const [name, source, expected] of table) {
		it(`reports ${String(expected)} for ${name}`, () => {
			expect(wasExplicit(source)).toBe(expected);
		});
	}

	// === L19 — the two readings of explicitness, side by side

	it('parts with the typed-it derivation only on the sources that supplied bytes', () => {
		const typedIt = (source: ResolutionProvenance | undefined): boolean => source?.stage === 'cli';

		expect(table.map(([, source]) => [wasExplicit(source), typedIt(source)])).toEqual([
			[true, true],
			[true, true],
			[true, false],
			[true, false],
			[true, false],
			[true, false],
			[false, false],
			[false, false],
		]);
	});
});
