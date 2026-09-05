import { describe, expect, it } from 'vitest';
import { diagnosticValue, REDACTED } from './diagnostic-value.ts';

describe('diagnosticValue()', () => {
	it('retains and formats a non-sensitive value', () => {
		const value = { token: 'visible' };

		expect(diagnosticValue(false, value)).toEqual({
			kind: 'visible',
			value,
			text: '{"token":"visible"}',
		});
	});

	it('does not retain or format a sensitive value', () => {
		let formats = 0;
		const value = {
			toJSON: () => {
				formats += 1;
				return 'private';
			},
			toString: () => {
				formats += 1;
				return 'private';
			},
		};

		const report = diagnosticValue(true, value);

		expect(report).toEqual({ kind: 'redacted', text: REDACTED });
		expect(report).not.toHaveProperty('value');
		expect(formats).toBe(0);
	});
});
