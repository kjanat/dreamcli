import { partyStart } from '__ENTRY_FILE__';
import { runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from 'bun:test';

describe('party start command', () => {
	it('applies sparkle middleware when --sparkle is set', async () => {
		const result = await runCommand(partyStart, ['--theme', 'midnight', '--sparkle']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['✨ Party started with midnight theme! ✨\n']);
		expect(result.stderr).toEqual([]);
	});

	it('renders help text', async () => {
		const result = await runCommand(partyStart, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Start the pony party');
	});
});
