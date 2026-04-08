import { hello } from '__ENTRY_FILE__';
import { runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from 'bun:test';

describe('hello command', () => {
	it('prints sparkly greeting when --sparkle is set', async () => {
		const result = await runCommand(hello, ['Twilight', '--sparkle', '--times', '2']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['✨ Hello, Twilight! ✨\n', '✨ Hello, Twilight! ✨\n']);
		expect(result.stderr).toEqual([]);
	});

	it('renders help text', async () => {
		const result = await runCommand(hello, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Say hello with optional sparkle');
	});
});
