import { describe, expect, expectTypeOf, it } from 'vitest';
import type { TableOptions } from '#internals/core/schema/activity.ts';
import type { ActivityPolicy, OutputPolicy, OutputStream, Verbosity } from './contracts.ts';
import {
	outputContract,
	resolveProgressPolicy,
	resolveSpinnerPolicy,
	resolveTableFormat,
	resolveTableTextStream,
	resolveTextStream,
	shouldEmitInfo,
} from './contracts.ts';

describe('output contracts — text routing', () => {
	const normalPolicy: OutputPolicy = {
		jsonMode: false,
		isTTY: false,
		verbosity: 'normal',
	};

	it('routes plain text to stdout outside jsonMode', () => {
		expect(resolveTextStream(normalPolicy)).toBe('stdout');
	});

	it('routes plain text to stderr in jsonMode', () => {
		expect(resolveTextStream({ ...normalPolicy, jsonMode: true })).toBe('stderr');
	});

	it('suppresses info only in quiet mode', () => {
		expect(shouldEmitInfo(normalPolicy)).toBe(true);
		expect(shouldEmitInfo({ ...normalPolicy, verbosity: 'quiet' })).toBe(false);
	});

	it('keeps text tables on requested stream when forced', () => {
		const options: TableOptions = { format: 'text', stream: 'stderr' };
		expect(resolveTableTextStream(normalPolicy, options)).toBe('stderr');
	});

	it('uses json table format by default in jsonMode', () => {
		expect(resolveTableFormat({ ...normalPolicy, jsonMode: true })).toBe('json');
	});
});

describe('output contracts — activity policy', () => {
	const basePolicy: OutputPolicy = {
		jsonMode: false,
		isTTY: false,
		verbosity: 'normal',
	};

	it('uses tty spinner mode only when tty and non-json', () => {
		expect(resolveSpinnerPolicy({ ...basePolicy, isTTY: true }, 'silent')).toEqual({
			mode: 'tty',
			stream: 'stderr',
			cleanup: 'stop',
		});
	});

	it('uses static spinner mode for non-tty static fallback', () => {
		expect(resolveSpinnerPolicy(basePolicy, 'static')).toEqual({
			mode: 'static',
			stream: 'stderr',
			cleanup: 'stop',
		});
	});

	it('suppresses spinner activity in jsonMode even with static fallback', () => {
		expect(resolveSpinnerPolicy({ ...basePolicy, jsonMode: true, isTTY: true }, 'static')).toEqual({
			mode: 'noop',
			stream: 'stderr',
			cleanup: 'none',
		});
	});

	it('uses done cleanup for progress handles', () => {
		expect(resolveProgressPolicy({ ...basePolicy, isTTY: true }, 'silent')).toEqual({
			mode: 'tty',
			stream: 'stderr',
			cleanup: 'done',
		});
	});
});

describe('output contracts — type surface', () => {
	it('Verbosity remains the stable quiet/normal union', () => {
		expectTypeOf<Verbosity>().toEqualTypeOf<'normal' | 'quiet'>();
	});

	it('text streams remain stdout/stderr only', () => {
		expectTypeOf<OutputStream>().toEqualTypeOf<'stdout' | 'stderr'>();
	});

	it('activity policy remains renderer-agnostic metadata', () => {
		expectTypeOf<ActivityPolicy>().toMatchTypeOf<{
			readonly mode: 'noop' | 'static' | 'tty';
			readonly stream: 'stderr';
			readonly cleanup: 'none' | 'stop' | 'done';
		}>();
	});

	it('output contract facts stay explicit', () => {
		expect(outputContract).toEqual({
			jsonReservesStdoutForStructuredData: true,
			quietSuppressesInfo: true,
			activityUsesStderrOutsideCapture: true,
			ttyActivityRequiresTTYAndNonJson: true,
			spinnerCleanupUsesStop: true,
			progressCleanupUsesDone: true,
		});
	});
});
