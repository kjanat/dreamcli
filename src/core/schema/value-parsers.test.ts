import { describe, expect, expectTypeOf, it } from 'vitest';
import { runCommand } from '#internals/core/testkit/index.ts';
import { command } from './command.ts';
import type { InferFlag } from './flag.ts';
import { flag } from './flag.ts';
import {
	parseBytesValue,
	parseDateValue,
	parseDurationValue,
	parseUrlValue,
} from './value-parsers.ts';

// === parseDateValue — strict ISO-8601

describe('parseDateValue()', () => {
	// --- valid shapes

	it('parses a date-only string as UTC midnight', () => {
		const d = parseDateValue('2026-07-10');
		expect(d).toBeInstanceOf(Date);
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 10));
	});

	it('parses a datetime with Z suffix', () => {
		const d = parseDateValue('2026-07-10T14:30:00Z');
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 10, 14, 30, 0));
	});

	it('parses a datetime with a positive offset', () => {
		const d = parseDateValue('2026-07-10T14:30:00+02:00');
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 10, 12, 30, 0));
	});

	it('parses a datetime with a negative offset', () => {
		const d = parseDateValue('2026-07-10T14:30:00-05:00');
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 10, 19, 30, 0));
	});

	it('treats an offset-less datetime as UTC, independent of machine timezone', () => {
		const d = parseDateValue('2026-07-10T14:30');
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 10, 14, 30, 0));
	});

	it('accepts boundary time components 23:59:59', () => {
		const d = parseDateValue('2026-07-10T23:59:59Z');
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 10, 23, 59, 59));
	});

	// --- rejected shapes

	it('rejects Date.parse-lenient input like "March 5"', () => {
		expect(() => parseDateValue('March 5')).toThrow(/^Invalid date: expected ISO-8601/);
	});

	it('rejects the bare string "0"', () => {
		expect(() => parseDateValue('0')).toThrow(/^Invalid date: expected ISO-8601/);
	});

	it('rejects non-ISO shapes', () => {
		expect(() => parseDateValue('2026/07/10')).toThrow(/expected ISO-8601/);
		expect(() => parseDateValue('2026-7-1')).toThrow(/expected ISO-8601/);
		expect(() => parseDateValue('10-07-2026')).toThrow(/Invalid date/);
	});

	it('rejects non-string input', () => {
		expect(() => parseDateValue(42)).toThrow(/expected an ISO-8601 string/);
		expect(() => parseDateValue(null)).toThrow(/expected an ISO-8601 string/);
	});

	// --- calendar validity

	it('rejects 2026-02-31 instead of rolling over to March', () => {
		expect(() => parseDateValue('2026-02-31')).toThrow(/not a real calendar date/);
	});

	it('rejects February 29 in a non-leap year', () => {
		expect(() => parseDateValue('2025-02-29')).toThrow(/not a real calendar date/);
	});

	it('accepts February 29 in a leap year', () => {
		const d = parseDateValue('2024-02-29');
		expect(d.getTime()).toBe(Date.UTC(2024, 1, 29));
	});

	it('rejects month 13', () => {
		expect(() => parseDateValue('2026-13-01')).toThrow(/month must be 01-12/);
	});

	it('rejects day 00', () => {
		expect(() => parseDateValue('2026-07-00')).toThrow(/not a real calendar date/);
	});

	// --- time component bounds

	it('rejects hours above 23', () => {
		expect(() => parseDateValue('2026-07-10T24:00')).toThrow(/hours must be 00-23/);
	});

	it('rejects minutes above 59', () => {
		expect(() => parseDateValue('2026-07-10T10:60')).toThrow(/minutes must be 00-59/);
	});

	it('rejects seconds above 59', () => {
		expect(() => parseDateValue('2026-07-10T10:30:60')).toThrow(/seconds must be 00-59/);
	});

	// --- min/max bounds

	it('accepts a date equal to min (inclusive)', () => {
		const min = new Date('2026-07-10');
		expect(parseDateValue('2026-07-10', { min }).getTime()).toBe(min.getTime());
	});

	it('accepts a date equal to max (inclusive)', () => {
		const max = new Date('2026-07-10');
		expect(parseDateValue('2026-07-10', { max }).getTime()).toBe(max.getTime());
	});

	it('rejects a date before min', () => {
		expect(() => parseDateValue('2026-07-09', { min: new Date('2026-07-10') })).toThrow(
			/before the earliest allowed/,
		);
	});

	it('rejects a date after max', () => {
		expect(() => parseDateValue('2026-07-11', { max: new Date('2026-07-10') })).toThrow(
			/after the latest allowed/,
		);
	});

	// --- timezone offset edge case

	it('does not falsely reject an offset datetime whose UTC day differs', () => {
		// UTC instant is 2026-07-09T23:00Z — calendar validation must use the
		// written components (day 10), not the round-tripped UTC components.
		const d = parseDateValue('2026-07-10T01:00:00+02:00');
		expect(d.getTime()).toBe(Date.UTC(2026, 6, 9, 23, 0, 0));
	});
});

// === parseUrlValue

describe('parseUrlValue()', () => {
	it('parses a valid URL string', () => {
		const url = parseUrlValue('https://example.com/path?q=1');
		expect(url).toBeInstanceOf(URL);
		expect(url.hostname).toBe('example.com');
		expect(url.pathname).toBe('/path');
	});

	it('accepts a protocol on the allowlist', () => {
		const url = parseUrlValue('https://example.com', { protocols: ['https'] });
		expect(url.protocol).toBe('https:');
	});

	it('rejects http when only https is allowed', () => {
		expect(() => parseUrlValue('http://example.com', { protocols: ['https'] })).toThrow(
			/URL protocol is not allowed. Allowed: https/,
		);
	});

	it('rejects garbage input', () => {
		expect(() => parseUrlValue('not a url')).toThrow(/^Invalid URL$/);
	});

	it('rejects non-string, non-URL input', () => {
		expect(() => parseUrlValue(42)).toThrow(/expected a URL string/);
	});
});

// === parseDurationValue — human durations to milliseconds

describe('parseDurationValue()', () => {
	// --- valid inputs

	it("parses '30s'", () => {
		expect(parseDurationValue('30s')).toBe(30_000);
	});

	it("parses '5m'", () => {
		expect(parseDurationValue('5m')).toBe(300_000);
	});

	it("parses fractional '1.5h'", () => {
		expect(parseDurationValue('1.5h')).toBe(5_400_000);
	});

	it("parses '250ms'", () => {
		expect(parseDurationValue('250ms')).toBe(250);
	});

	it("parses '2d'", () => {
		expect(parseDurationValue('2d')).toBe(172_800_000);
	});

	it("parses compound '1h30m'", () => {
		expect(parseDurationValue('1h30m')).toBe(5_400_000);
	});

	it("treats bare '1500' as milliseconds", () => {
		expect(parseDurationValue('1500')).toBe(1500);
	});

	it('passes through a non-negative number as milliseconds', () => {
		expect(parseDurationValue(1500)).toBe(1500);
		expect(parseDurationValue(0)).toBe(0);
	});

	// --- rejected inputs

	it("rejects 'fast'", () => {
		expect(() => parseDurationValue('fast')).toThrow(/^Invalid duration: expected/);
	});

	it('rejects the empty string', () => {
		expect(() => parseDurationValue('')).toThrow(/Invalid duration/);
	});

	it("rejects unknown unit '1x'", () => {
		expect(() => parseDurationValue('1x')).toThrow(/^Invalid duration: expected/);
	});

	it("rejects unit-before-amount 'm5'", () => {
		expect(() => parseDurationValue('m5')).toThrow(/^Invalid duration: expected/);
	});

	it('rejects a negative number', () => {
		expect(() => parseDurationValue(-100)).toThrow(/must be a non-negative number/);
	});

	it("rejects trailing junk '30s!'", () => {
		expect(() => parseDurationValue('30s!')).toThrow(/^Invalid duration: expected/);
	});
});

// === parseBytesValue — human sizes to bytes (binary units)

describe('parseBytesValue()', () => {
	// --- valid inputs

	it("parses '512mb'", () => {
		expect(parseBytesValue('512mb')).toBe(512 * 1024 ** 2);
	});

	it("parses fractional '1.5gb'", () => {
		expect(parseBytesValue('1.5gb')).toBe(1.5 * 1024 ** 3);
	});

	it("parses '64kb'", () => {
		expect(parseBytesValue('64kb')).toBe(64 * 1024);
	});

	it("parses '100b'", () => {
		expect(parseBytesValue('100b')).toBe(100);
	});

	it("treats bare '100' as bytes", () => {
		expect(parseBytesValue('100')).toBe(100);
	});

	it("accepts uppercase units — '512MB'", () => {
		expect(parseBytesValue('512MB')).toBe(512 * 1024 ** 2);
	});

	it('rounds fractional byte results to whole bytes', () => {
		expect(parseBytesValue('1.5b')).toBe(2);
		expect(parseBytesValue('0.4b')).toBe(0);
	});

	it('passes through a non-negative number as bytes', () => {
		expect(parseBytesValue(1024)).toBe(1024);
	});

	// --- rejected inputs

	it("rejects unknown unit '1zb'", () => {
		expect(() => parseBytesValue('1zb')).toThrow(/^Invalid size: expected/);
	});

	it('rejects the empty string', () => {
		expect(() => parseBytesValue('')).toThrow(/Invalid size/);
	});

	it("rejects negative string '-5'", () => {
		expect(() => parseBytesValue('-5')).toThrow(/^Invalid size: expected/);
	});

	it('rejects a negative number', () => {
		expect(() => parseBytesValue(-5)).toThrow(/must be a non-negative number/);
	});
});

// === Factory e2e — sugar flags through runCommand

describe('sugar flag factories — e2e', () => {
	// --- flag.url()

	it('flag.url() resolves a URL instance', async () => {
		let received: URL | undefined;
		const cmd = command('ping')
			.flag('endpoint', flag.url())
			.action(({ flags }) => {
				received = flags.endpoint;
			});

		const result = await runCommand(cmd, ['--endpoint', 'https://example.com/api']);
		expect(result.exitCode).toBe(0);
		expect(received).toBeInstanceOf(URL);
		expect(received?.href).toBe('https://example.com/api');
	});

	it('flag.url() rejects garbage with exit 2 and a parse-failure message', async () => {
		const cmd = command('ping')
			.flag('endpoint', flag.url())
			.action(() => {});

		const result = await runCommand(cmd, ['--endpoint', 'not a url']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toContain('Failed to parse flag');
	});

	// --- flag.date()

	it('flag.date() resolves a Date at UTC midnight', async () => {
		let received: Date | undefined;
		const cmd = command('schedule')
			.flag('when', flag.date())
			.action(({ flags }) => {
				received = flags.when;
			});

		const result = await runCommand(cmd, ['--when', '2026-07-10']);
		expect(result.exitCode).toBe(0);
		expect(received).toBeInstanceOf(Date);
		expect(received?.getTime()).toBe(Date.UTC(2026, 6, 10));
	});

	it('flag.date() rejects a calendar-invalid date with exit 2', async () => {
		const cmd = command('schedule')
			.flag('when', flag.date())
			.action(() => {});

		const result = await runCommand(cmd, ['--when', '2026-02-31']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toContain('Failed to parse flag');
	});

	// --- flag.duration()

	it('flag.duration() resolves compound durations to milliseconds', async () => {
		let received: number | undefined;
		const cmd = command('wait')
			.flag('timeout', flag.duration())
			.action(({ flags }) => {
				received = flags.timeout;
			});

		const result = await runCommand(cmd, ['--timeout', '1h30m']);
		expect(result.exitCode).toBe(0);
		expect(received).toBe(5_400_000);
	});

	it('flag.duration() rejects nonsense with exit 2', async () => {
		const cmd = command('wait')
			.flag('timeout', flag.duration())
			.action(() => {});

		const result = await runCommand(cmd, ['--timeout', 'fast']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toContain('Failed to parse flag');
	});

	// --- flag.bytes()

	it('flag.bytes() resolves binary-unit sizes to bytes', async () => {
		let received: number | undefined;
		const cmd = command('upload')
			.flag('maxSize', flag.bytes())
			.action(({ flags }) => {
				received = flags.maxSize;
			});

		const result = await runCommand(cmd, ['--maxSize', '512mb']);
		expect(result.exitCode).toBe(0);
		expect(received).toBe(512 * 1024 ** 2);
	});

	it('flag.bytes() rejects an unknown unit with exit 2', async () => {
		const cmd = command('upload')
			.flag('maxSize', flag.bytes())
			.action(() => {});

		const result = await runCommand(cmd, ['--maxSize', '1zb']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toContain('Failed to parse flag');
	});
});

// === Type inference — sugar factories

describe('sugar flag factories — type inference', () => {
	it('flag.url(): URL | undefined', () => {
		const f = flag.url();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<URL | undefined>();
	});

	it('flag.date(): Date | undefined', () => {
		const f = flag.date();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<Date | undefined>();
	});

	it('flag.duration(): number | undefined', () => {
		const f = flag.duration();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number | undefined>();
	});

	it('flag.duration().default(): number', () => {
		const f = flag.duration().default(30_000);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number>();
	});

	it('flag.bytes().default(): number', () => {
		const f = flag.bytes().default(10 * 1024 ** 2);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number>();
	});
});
