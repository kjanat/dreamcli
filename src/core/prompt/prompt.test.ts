import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PromptResult, SelectChoice } from '../schema/prompt.ts';
import type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedPromptConfig,
	ResolvedSelectPromptConfig,
	TestAnswer,
	TestPrompterOptions,
} from './index.ts';
import {
	createTerminalPrompter,
	createTestPrompter,
	PROMPT_CANCEL,
	resolvePromptConfig,
} from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a ReadFn that returns lines from a queue, null on empty. */
function mockRead(lines: readonly (string | null)[]): ReadFn {
	let index = 0;
	return () => {
		if (index >= lines.length) return Promise.resolve(null);
		const line = lines[index];
		index += 1;
		return Promise.resolve(line ?? null);
	};
}

/** Capture WriteFn output into an array. */
function captureWrite(): { write: (data: string) => void; lines: string[] } {
	const lines: string[] = [];
	return { write: (s: string) => lines.push(s), lines };
}

// ===========================================================================
// PROMPT_CANCEL sentinel
// ===========================================================================

describe('PROMPT_CANCEL', () => {
	it('is a symbol', () => {
		expect(typeof PROMPT_CANCEL).toBe('symbol');
	});

	it('uses Symbol.for for cross-bundle safety', () => {
		expect(PROMPT_CANCEL).toBe(Symbol.for('dreamcli.prompt.cancel'));
	});

	it('is strictly equal to another Symbol.for with same key', () => {
		const other: symbol = Symbol.for('dreamcli.prompt.cancel');
		expect(other).toBe(PROMPT_CANCEL);
	});
});

// ===========================================================================
// createTestPrompter
// ===========================================================================

describe('createTestPrompter', () => {
	it('returns answers in order', async () => {
		const prompter = createTestPrompter(['a', 'b', 'c']);
		const r1 = await prompter.promptOne({ kind: 'input', message: 'q1' });
		const r2 = await prompter.promptOne({ kind: 'input', message: 'q2' });
		const r3 = await prompter.promptOne({ kind: 'input', message: 'q3' });
		expect(r1).toEqual({ answered: true, value: 'a' });
		expect(r2).toEqual({ answered: true, value: 'b' });
		expect(r3).toEqual({ answered: true, value: 'c' });
	});

	it('handles various value types', async () => {
		const prompter = createTestPrompter([42, true, ['x', 'y'], null, undefined]);
		expect(await prompter.promptOne({ kind: 'input', message: '' })).toEqual({
			answered: true,
			value: 42,
		});
		expect(await prompter.promptOne({ kind: 'confirm', message: '' })).toEqual({
			answered: true,
			value: true,
		});
		expect(await prompter.promptOne({ kind: 'input', message: '' })).toEqual({
			answered: true,
			value: ['x', 'y'],
		});
		expect(await prompter.promptOne({ kind: 'input', message: '' })).toEqual({
			answered: true,
			value: null,
		});
		expect(await prompter.promptOne({ kind: 'input', message: '' })).toEqual({
			answered: true,
			value: undefined,
		});
	});

	it('returns cancelled for PROMPT_CANCEL', async () => {
		const prompter = createTestPrompter(['yes', PROMPT_CANCEL, 'no']);
		const r1 = await prompter.promptOne({ kind: 'input', message: '' });
		const r2 = await prompter.promptOne({ kind: 'input', message: '' });
		const r3 = await prompter.promptOne({ kind: 'input', message: '' });
		expect(r1).toEqual({ answered: true, value: 'yes' });
		expect(r2).toEqual({ answered: false });
		expect(r3).toEqual({ answered: true, value: 'no' });
	});

	it('throws when exhausted (default behavior)', async () => {
		const prompter = createTestPrompter(['only']);
		await prompter.promptOne({ kind: 'input', message: '' });
		await expect(prompter.promptOne({ kind: 'input', message: '' })).rejects.toThrow(
			/exhausted.*expected at most 1/i,
		);
	});

	it('throws with correct count in error message', async () => {
		const prompter = createTestPrompter(['a', 'b']);
		await prompter.promptOne({ kind: 'input', message: '' });
		await prompter.promptOne({ kind: 'input', message: '' });
		await expect(prompter.promptOne({ kind: 'input', message: '' })).rejects.toThrow(
			/expected at most 2.*got prompt #3/i,
		);
	});

	it('cancels when exhausted with onExhausted: cancel', async () => {
		const prompter = createTestPrompter(['one'], { onExhausted: 'cancel' });
		const r1 = await prompter.promptOne({ kind: 'input', message: '' });
		const r2 = await prompter.promptOne({ kind: 'input', message: '' });
		const r3 = await prompter.promptOne({ kind: 'input', message: '' });
		expect(r1).toEqual({ answered: true, value: 'one' });
		expect(r2).toEqual({ answered: false });
		expect(r3).toEqual({ answered: false });
	});

	it('works with empty answers array and onExhausted: cancel', async () => {
		const prompter = createTestPrompter([], { onExhausted: 'cancel' });
		const result = await prompter.promptOne({ kind: 'input', message: '' });
		expect(result).toEqual({ answered: false });
	});

	it('works with empty answers array and default throw', async () => {
		const prompter = createTestPrompter([]);
		await expect(prompter.promptOne({ kind: 'input', message: '' })).rejects.toThrow(/exhausted/);
	});

	it('satisfies PromptEngine interface', () => {
		const prompter = createTestPrompter([]);
		expectTypeOf(prompter).toMatchTypeOf<PromptEngine>();
	});

	it('ignores config parameter (uses queue only)', async () => {
		const prompter = createTestPrompter(['answer']);
		// Pass any config — answer comes from queue
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'Pick one',
			choices: [{ value: 'a' }, { value: 'b' }],
		});
		expect(result).toEqual({ answered: true, value: 'answer' });
	});
});

// ===========================================================================
// createTerminalPrompter — confirm
// ===========================================================================

describe('createTerminalPrompter — confirm', () => {
	it('accepts y as true', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['y']), write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'Continue?' });
		expect(result).toEqual({ answered: true, value: true });
		expect(lines[0]).toContain('Continue?');
		expect(lines[0]).toContain('(y/n)');
	});

	it('accepts yes as true (case-insensitive)', async () => {
		const prompter = createTerminalPrompter(mockRead(['YES']), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: true, value: true });
	});

	it('accepts n as false', async () => {
		const prompter = createTerminalPrompter(mockRead(['n']), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: true, value: false });
	});

	it('accepts no as false (case-insensitive)', async () => {
		const prompter = createTerminalPrompter(mockRead(['No']), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: true, value: false });
	});

	it('accepts empty string as true (default)', async () => {
		const prompter = createTerminalPrompter(mockRead(['']), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: true, value: true });
	});

	it('returns cancelled on EOF', async () => {
		const prompter = createTerminalPrompter(mockRead([null]), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: false });
	});

	it('retries on invalid input then accepts valid', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['maybe', 'y']), write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: true, value: true });
		expect(lines.some((l) => l.includes('Please answer y or n'))).toBe(true);
	});

	it('trims whitespace from input', async () => {
		const prompter = createTerminalPrompter(mockRead(['  Y  ']), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'confirm', message: 'q' });
		expect(result).toEqual({ answered: true, value: true });
	});
});

// ===========================================================================
// createTerminalPrompter — input
// ===========================================================================

describe('createTerminalPrompter — input', () => {
	it('reads user input', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['hello world']), write);
		const result = await prompter.promptOne({ kind: 'input', message: 'Name' });
		expect(result).toEqual({ answered: true, value: 'hello world' });
		expect(lines[0]).toContain('Name:');
	});

	it('shows placeholder when set', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['test']), write);
		await prompter.promptOne({ kind: 'input', message: 'Email', placeholder: 'user@example.com' });
		expect(lines[0]).toContain('(user@example.com)');
	});

	it('omits placeholder when not set', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['test']), write);
		await prompter.promptOne({ kind: 'input', message: 'Name' });
		expect(lines[0]).toBe('Name: ');
	});

	it('returns cancelled on EOF', async () => {
		const prompter = createTerminalPrompter(mockRead([null]), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'input', message: 'q' });
		expect(result).toEqual({ answered: false });
	});

	it('trims input', async () => {
		const prompter = createTerminalPrompter(mockRead(['  spaced  ']), captureWrite().write);
		const result = await prompter.promptOne({ kind: 'input', message: 'q' });
		expect(result).toEqual({ answered: true, value: 'spaced' });
	});

	it('validates input and retries on failure', async () => {
		const { write, lines } = captureWrite();
		const validate = (v: string) => (v.length >= 3 ? true : 'Must be at least 3 chars');
		const prompter = createTerminalPrompter(mockRead(['ab', 'abc']), write);
		const result = await prompter.promptOne({
			kind: 'input',
			message: 'Code',
			validate,
		});
		expect(result).toEqual({ answered: true, value: 'abc' });
		expect(lines.some((l) => l.includes('Must be at least 3 chars'))).toBe(true);
	});

	it('returns cancelled on EOF during validation retry', async () => {
		const validate = (v: string) => (v.length >= 3 ? true : 'Too short');
		const prompter = createTerminalPrompter(mockRead(['ab', null]), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'input',
			message: 'q',
			validate,
		});
		expect(result).toEqual({ answered: false });
	});

	it('cancels after MAX_RETRIES invalid attempts', async () => {
		const validate = () => 'Always invalid' as const;
		// Create 11 responses — all will fail validation, 10th triggers max retry
		const responses = Array.from({ length: 11 }, () => 'bad');
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(responses), write);
		const result = await prompter.promptOne({
			kind: 'input',
			message: 'q',
			validate,
		});
		expect(result).toEqual({ answered: false });
		expect(lines.some((l) => l.includes('Too many invalid attempts'))).toBe(true);
	});
});

// ===========================================================================
// createTerminalPrompter — select
// ===========================================================================

describe('createTerminalPrompter — select', () => {
	const choices: readonly [SelectChoice, ...SelectChoice[]] = [
		{ value: 'us', label: 'US East' },
		{ value: 'eu', label: 'EU West' },
		{ value: 'ap', label: 'AP South' },
	];

	it('displays choices and accepts valid selection', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['2']), write);
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'Region',
			choices,
		});
		expect(result).toEqual({ answered: true, value: 'eu' });
		expect(lines.some((l) => l.includes('1) US East'))).toBe(true);
		expect(lines.some((l) => l.includes('2) EU West'))).toBe(true);
		expect(lines.some((l) => l.includes('3) AP South'))).toBe(true);
	});

	it('uses value as label when label is omitted', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['1']), write);
		await prompter.promptOne({
			kind: 'select',
			message: 'Pick',
			choices: [{ value: 'raw-value' }],
		});
		expect(lines.some((l) => l.includes('1) raw-value'))).toBe(true);
	});

	it('shows description when present', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['1']), write);
		await prompter.promptOne({
			kind: 'select',
			message: 'Pick',
			choices: [{ value: 'a', description: 'Alpha option' }],
		});
		expect(lines.some((l) => l.includes('Alpha option'))).toBe(true);
	});

	it('retries on out-of-range selection', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['0', '4', '2']), write);
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'Region',
			choices,
		});
		expect(result).toEqual({ answered: true, value: 'eu' });
		expect(lines.some((l) => l.includes('between 1 and 3'))).toBe(true);
	});

	it('retries on non-numeric input', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['abc', '1']), write);
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'Region',
			choices,
		});
		expect(result).toEqual({ answered: true, value: 'us' });
		expect(lines.some((l) => l.includes('between 1 and 3'))).toBe(true);
	});

	it('returns cancelled on EOF', async () => {
		const prompter = createTerminalPrompter(mockRead([null]), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'Region',
			choices,
		});
		expect(result).toEqual({ answered: false });
	});

	it('cancels after MAX_RETRIES', async () => {
		const bad = Array.from({ length: 11 }, () => 'x');
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(bad), write);
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'Region',
			choices,
		});
		expect(result).toEqual({ answered: false });
		expect(lines.some((l) => l.includes('Too many invalid attempts'))).toBe(true);
	});

	it('rejects fractional numbers', async () => {
		const prompter = createTerminalPrompter(mockRead(['1.5', '1']), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'select',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: true, value: 'us' });
	});
});

// ===========================================================================
// createTerminalPrompter — multiselect
// ===========================================================================

describe('createTerminalPrompter — multiselect', () => {
	const choices: readonly [SelectChoice, ...SelectChoice[]] = [
		{ value: 'ts' },
		{ value: 'js' },
		{ value: 'py' },
	];

	it('accepts comma-separated selections', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['1,3']), write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'Languages',
			choices,
		});
		expect(result).toEqual({ answered: true, value: ['ts', 'py'] });
		expect(lines.some((l) => l.includes('Enter numbers'))).toBe(true);
	});

	it('accepts single selection', async () => {
		const prompter = createTerminalPrompter(mockRead(['2']), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: true, value: ['js'] });
	});

	it('deduplicates selections', async () => {
		const prompter = createTerminalPrompter(mockRead(['1,1,2']), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: true, value: ['ts', 'js'] });
	});

	it('accepts empty for zero selections when no min', async () => {
		const prompter = createTerminalPrompter(mockRead(['']), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: true, value: [] });
	});

	it('rejects empty when min is set', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['', '1']), write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
			min: 1,
		});
		expect(result).toEqual({ answered: true, value: ['ts'] });
		expect(lines.some((l) => l.includes('at least 1'))).toBe(true);
	});

	it('enforces max constraint', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['1,2,3', '1,2']), write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
			max: 2,
		});
		expect(result).toEqual({ answered: true, value: ['ts', 'js'] });
		expect(lines.some((l) => l.includes('at most 2'))).toBe(true);
	});

	it('shows min/max hints in prompt', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['1']), write);
		await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
			min: 1,
			max: 2,
		});
		expect(lines.some((l) => l.includes('min: 1'))).toBe(true);
		expect(lines.some((l) => l.includes('max: 2'))).toBe(true);
	});

	it('retries on invalid selection', async () => {
		const { write, lines } = captureWrite();
		const prompter = createTerminalPrompter(mockRead(['1,x', '1']), write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: true, value: ['ts'] });
		expect(lines.some((l) => l.includes("Invalid selection 'x'"))).toBe(true);
	});

	it('returns cancelled on EOF', async () => {
		const prompter = createTerminalPrompter(mockRead([null]), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: false });
	});

	it('handles spaces in comma-separated input', async () => {
		const prompter = createTerminalPrompter(mockRead([' 1 , 3 ']), captureWrite().write);
		const result = await prompter.promptOne({
			kind: 'multiselect',
			message: 'q',
			choices,
		});
		expect(result).toEqual({ answered: true, value: ['ts', 'py'] });
	});
});

// ===========================================================================
// createTerminalPrompter — satisfies PromptEngine
// ===========================================================================

describe('createTerminalPrompter — interface', () => {
	it('satisfies PromptEngine interface', () => {
		const prompter = createTerminalPrompter(
			() => Promise.resolve(null),
			() => {},
		);
		expectTypeOf(prompter).toMatchTypeOf<PromptEngine>();
	});
});

// ===========================================================================
// resolvePromptConfig
// ===========================================================================

describe('resolvePromptConfig', () => {
	it('passes through confirm config unchanged', () => {
		const config = { kind: 'confirm' as const, message: 'Continue?' };
		const result = resolvePromptConfig(config, undefined);
		expect(result).toEqual(config);
	});

	it('passes through input config unchanged', () => {
		const config = { kind: 'input' as const, message: 'Name', placeholder: 'John' };
		const result = resolvePromptConfig(config, undefined);
		expect(result).toEqual(config);
	});

	it('keeps explicit select choices', () => {
		const config = {
			kind: 'select' as const,
			message: 'Pick',
			choices: [{ value: 'a' }, { value: 'b' }] as const,
		};
		const result = resolvePromptConfig(config, ['x', 'y']);
		expect(result.kind).toBe('select');
		if (result.kind === 'select') {
			expect(result.choices).toEqual([{ value: 'a' }, { value: 'b' }]);
		}
	});

	it('falls back to enum values when select choices are omitted', () => {
		const config = { kind: 'select' as const, message: 'Region' };
		const result = resolvePromptConfig(config, ['us', 'eu', 'ap']);
		expect(result.kind).toBe('select');
		if (result.kind === 'select') {
			expect(result.choices).toEqual([{ value: 'us' }, { value: 'eu' }, { value: 'ap' }]);
		}
	});

	it('throws when select has no choices and no enum values', () => {
		const config = { kind: 'select' as const, message: 'Pick' };
		expect(() => resolvePromptConfig(config, undefined)).toThrow(/requires choices/);
	});

	it('throws when select has no choices and empty enum values', () => {
		const config = { kind: 'select' as const, message: 'Pick' };
		expect(() => resolvePromptConfig(config, [])).toThrow(/requires choices/);
	});

	it('resolves multiselect choices from enum values', () => {
		const config = { kind: 'multiselect' as const, message: 'Langs' };
		const result = resolvePromptConfig(config, ['ts', 'js']);
		expect(result.kind).toBe('multiselect');
		if (result.kind === 'multiselect') {
			expect(result.choices).toEqual([{ value: 'ts' }, { value: 'js' }]);
		}
	});

	it('preserves min/max on multiselect', () => {
		const config = { kind: 'multiselect' as const, message: 'Pick', min: 1, max: 3 };
		const result = resolvePromptConfig(config, ['a', 'b', 'c', 'd']);
		expect(result.kind).toBe('multiselect');
		if (result.kind === 'multiselect') {
			expect(result.min).toBe(1);
			expect(result.max).toBe(3);
		}
	});

	it('omits min/max when not set on multiselect', () => {
		const config = { kind: 'multiselect' as const, message: 'Pick' };
		const result = resolvePromptConfig(config, ['a', 'b']);
		expect(result.kind).toBe('multiselect');
		if (result.kind === 'multiselect') {
			expect(result.min).toBeUndefined();
			expect(result.max).toBeUndefined();
		}
	});

	it('returns correct type for resolved config', () => {
		expectTypeOf(
			resolvePromptConfig({ kind: 'confirm', message: 'q' }, undefined),
		).toMatchTypeOf<ResolvedPromptConfig>();
	});
});

// ===========================================================================
// Type-level tests
// ===========================================================================

describe('type contracts', () => {
	it('PromptEngine has correct promptOne signature', () => {
		expectTypeOf<PromptEngine['promptOne']>().toEqualTypeOf<
			(config: ResolvedPromptConfig) => Promise<PromptResult>
		>();
	});

	it('ReadFn returns Promise<string | null>', () => {
		expectTypeOf<ReadFn>().returns.toEqualTypeOf<Promise<string | null>>();
	});

	it('TestAnswer is unknown', () => {
		expectTypeOf<TestAnswer>().toEqualTypeOf<unknown>();
	});

	it('ResolvedSelectPromptConfig has non-empty choices', () => {
		expectTypeOf<ResolvedSelectPromptConfig['choices']>().toMatchTypeOf<
			readonly [{ value: string }, ...{ value: string }[]]
		>();
	});

	it('ResolvedMultiselectPromptConfig has non-empty choices', () => {
		expectTypeOf<ResolvedMultiselectPromptConfig['choices']>().toMatchTypeOf<
			readonly [{ value: string }, ...{ value: string }[]]
		>();
	});

	it('TestPrompterOptions onExhausted accepts throw or cancel', () => {
		expectTypeOf<TestPrompterOptions['onExhausted']>().toEqualTypeOf<
			'throw' | 'cancel' | undefined
		>();
	});
});
