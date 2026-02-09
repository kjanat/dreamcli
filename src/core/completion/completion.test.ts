/**
 * Tests for completion types, Shell enum, and generator stubs.
 */

import { describe, expect, it } from 'vitest';
import { isCLIError } from '../errors/index.js';
import type { CompletionOptions } from './index.js';
import {
	generateBashCompletion,
	generateCompletion,
	generateZshCompletion,
	SHELLS,
} from './index.js';

// ===================================================================
// Test helpers
// ===================================================================

/** Minimal CLISchema for completion tests. */
function minimalSchema() {
	return {
		name: 'testcli',
		version: '1.0.0',
		description: 'A test CLI',
		commands: [],
	} as const;
}

// ===================================================================
// Shell type — SHELLS constant
// ===================================================================

describe('Shell type — SHELLS constant', () => {
	it('contains all four shell targets', () => {
		expect(SHELLS).toEqual(['bash', 'zsh', 'fish', 'powershell']);
	});

	it('is readonly (frozen at type level)', () => {
		// Verify length is stable — SHELLS should not be mutated
		expect(SHELLS).toHaveLength(4);
	});
});

// ===================================================================
// CompletionOptions — type contract
// ===================================================================

describe('CompletionOptions — type contract', () => {
	it('accepts empty options', () => {
		const options: CompletionOptions = {};
		expect(options).toEqual({});
	});

	it('accepts functionPrefix', () => {
		const options: CompletionOptions = { functionPrefix: '_myapp' };
		expect(options.functionPrefix).toBe('_myapp');
	});
});

// ===================================================================
// generateBashCompletion — stub
// ===================================================================

describe('generateBashCompletion — stub throws CLIError', () => {
	it('throws CLIError with UNSUPPORTED_OPERATION code', () => {
		const schema = minimalSchema();

		expect(() => generateBashCompletion(schema)).toThrow();

		try {
			generateBashCompletion(schema);
		} catch (e: unknown) {
			expect(isCLIError(e)).toBe(true);
			if (isCLIError(e)) {
				expect(e.code).toBe('UNSUPPORTED_OPERATION');
				expect(e.message).toContain('Bash');
				expect(e.message).toContain('not yet implemented');
			}
		}
	});

	it('throws with options parameter as well', () => {
		const schema = minimalSchema();
		const options: CompletionOptions = { functionPrefix: '_test' };

		expect(() => generateBashCompletion(schema, options)).toThrow();
	});
});

// ===================================================================
// generateZshCompletion — stub
// ===================================================================

describe('generateZshCompletion — stub throws CLIError', () => {
	it('throws CLIError with UNSUPPORTED_OPERATION code', () => {
		const schema = minimalSchema();

		expect(() => generateZshCompletion(schema)).toThrow();

		try {
			generateZshCompletion(schema);
		} catch (e: unknown) {
			expect(isCLIError(e)).toBe(true);
			if (isCLIError(e)) {
				expect(e.code).toBe('UNSUPPORTED_OPERATION');
				expect(e.message).toContain('Zsh');
				expect(e.message).toContain('not yet implemented');
			}
		}
	});
});

// ===================================================================
// generateCompletion — unified dispatcher
// ===================================================================

describe('generateCompletion — dispatcher', () => {
	it('delegates bash to generateBashCompletion (stub throws)', () => {
		const schema = minimalSchema();

		expect(() => generateCompletion(schema, 'bash')).toThrow();

		try {
			generateCompletion(schema, 'bash');
		} catch (e: unknown) {
			expect(isCLIError(e)).toBe(true);
			if (isCLIError(e)) {
				expect(e.message).toContain('Bash');
			}
		}
	});

	it('delegates zsh to generateZshCompletion (stub throws)', () => {
		const schema = minimalSchema();

		expect(() => generateCompletion(schema, 'zsh')).toThrow();

		try {
			generateCompletion(schema, 'zsh');
		} catch (e: unknown) {
			expect(isCLIError(e)).toBe(true);
			if (isCLIError(e)) {
				expect(e.message).toContain('Zsh');
			}
		}
	});

	it('throws CLIError for fish (unsupported)', () => {
		const schema = minimalSchema();

		expect(() => generateCompletion(schema, 'fish')).toThrow();

		try {
			generateCompletion(schema, 'fish');
		} catch (e: unknown) {
			expect(isCLIError(e)).toBe(true);
			if (isCLIError(e)) {
				expect(e.code).toBe('UNSUPPORTED_OPERATION');
				expect(e.message).toContain('fish');
				expect(e.message).toContain('not yet supported');
			}
		}
	});

	it('throws CLIError for powershell (unsupported)', () => {
		const schema = minimalSchema();

		expect(() => generateCompletion(schema, 'powershell')).toThrow();

		try {
			generateCompletion(schema, 'powershell');
		} catch (e: unknown) {
			expect(isCLIError(e)).toBe(true);
			if (isCLIError(e)) {
				expect(e.code).toBe('UNSUPPORTED_OPERATION');
				expect(e.message).toContain('powershell');
				expect(e.message).toContain('not yet supported');
			}
		}
	});

	it('passes options through to shell-specific generator', () => {
		const schema = minimalSchema();
		const options: CompletionOptions = { functionPrefix: '_custom' };

		// Both bash and zsh stubs should still throw, but accept options
		expect(() => generateCompletion(schema, 'bash', options)).toThrow();
		expect(() => generateCompletion(schema, 'zsh', options)).toThrow();
	});
});
