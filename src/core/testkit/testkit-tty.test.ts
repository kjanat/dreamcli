/**
 * Tests for isTTY propagation through testkit runCommand().
 */

import { describe, expect, it } from 'vitest';
import { command } from '../schema/command.ts';
import { runCommand } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Command that branches output on isTTY. */
function ttyAwareCommand() {
	return command('status')
		.description('Show status')
		.action(({ out }) => {
			if (out.jsonMode) {
				out.json({ status: 'ok', mode: 'json' });
			} else if (out.isTTY) {
				out.log('Status: ok (interactive)');
			} else {
				out.log('Status: ok');
			}
		});
}

/** Command that reports isTTY and jsonMode state. */
function modeReportCommand() {
	return command('mode')
		.description('Report output mode')
		.action(({ out }) => {
			out.json({ isTTY: out.isTTY, jsonMode: out.jsonMode });
		});
}

// ---------------------------------------------------------------------------
// isTTY propagation through runCommand
// ---------------------------------------------------------------------------

describe('runCommand — isTTY', () => {
	it('defaults isTTY to false', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.isTTY).toBe(false);
	});

	it('passes isTTY=true to handler via out', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, [], { isTTY: true });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.isTTY).toBe(true);
	});

	it('passes isTTY=false explicitly', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, [], { isTTY: false });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.isTTY).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Handler branching on isTTY
// ---------------------------------------------------------------------------

describe('runCommand — handler isTTY branching', () => {
	it('handler sees isTTY=false by default (piped mode)', async () => {
		const cmd = ttyAwareCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Status: ok\n']);
	});

	it('handler sees isTTY=true and uses interactive output', async () => {
		const cmd = ttyAwareCommand();
		const result = await runCommand(cmd, [], { isTTY: true });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Status: ok (interactive)\n']);
	});

	it('jsonMode takes precedence over isTTY=true', async () => {
		const cmd = ttyAwareCommand();
		const result = await runCommand(cmd, [], { isTTY: true, jsonMode: true });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ status: 'ok', mode: 'json' });
	});
});

// ---------------------------------------------------------------------------
// Combined isTTY × jsonMode state
// ---------------------------------------------------------------------------

describe('runCommand — isTTY × jsonMode combinations', () => {
	it('isTTY=false, jsonMode=false: plain mode', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, [], { isTTY: false, jsonMode: false });

		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ isTTY: false, jsonMode: false });
	});

	it('isTTY=true, jsonMode=false: interactive mode', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, [], { isTTY: true, jsonMode: false });

		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ isTTY: true, jsonMode: false });
	});

	it('isTTY=false, jsonMode=true: structured piped mode', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, [], { isTTY: false, jsonMode: true });

		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ isTTY: false, jsonMode: true });
	});

	it('isTTY=true, jsonMode=true: structured TTY mode', async () => {
		const cmd = modeReportCommand();
		const result = await runCommand(cmd, [], { isTTY: true, jsonMode: true });

		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ isTTY: true, jsonMode: true });
	});
});
