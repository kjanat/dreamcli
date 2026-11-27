import { describe, expect, it } from 'vitest';
import {
	copyTransformedArgv,
	hasArgvBoundary,
	isHyphenOperand,
	markArgvBoundaries,
	markHyphenOperand,
} from './argv-boundaries.ts';

describe('copyTransformedArgv', () => {
	it('preserves different metadata on repeated pairs between edits', () => {
		const argv = ['--before', '--token', '--other', '--middle', '--token', '--other', '--after'];
		markHyphenOperand(argv, 2);
		markArgvBoundaries(argv, new Set([5]));

		const changed = copyTransformedArgv(argv, [
			'--alpha',
			'--extra',
			'--token',
			'--other',
			'--omega',
			'--token',
			'--other',
			'--end',
		]);
		expect(changed.flatMap((_, i) => (isHyphenOperand(changed, i) ? [i] : []))).toEqual([3]);
		expect(changed.flatMap((_, i) => (hasArgvBoundary(changed, i) ? [i] : []))).toEqual([6]);
	});

	it('keeps a repeated pair at an unchanged edge when another is replaced', () => {
		const argv = ['--before', '--token', '--other', '--middle', '--token', '--other', '--after'];
		markArgvBoundaries(argv, new Set([2, 5]));

		const changed = copyTransformedArgv(argv, [
			'--alpha',
			'--token',
			'--replacement',
			'--other',
			'--middle',
			'--token',
			'--other',
			'--after',
		]);
		expect(changed.flatMap((_, i) => (hasArgvBoundary(changed, i) ? [i] : []))).toEqual([6]);
	});

	it('does not guess which unanchored repeated pair a transform removed', () => {
		const argv = ['--before', '--token', '--other', '--middle', '--token', '--other', '--after'];
		markArgvBoundaries(argv, new Set([5]));

		const changed = copyTransformedArgv(argv, ['--alpha', '--token', '--other', '--omega']);
		expect(hasArgvBoundary(changed, 2)).toBe(false);
	});
});
