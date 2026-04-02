/**
 * Tests for isTTY propagation through CLIBuilder.
 */

import { describe, expect, it } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import { cli } from './index.ts';

// --- Helpers

/** Command that reports output mode state. */
function modeCommand() {
	return command('mode')
		.description('Report mode')
		.action(({ out }) => {
			out.json({ isTTY: out.isTTY, jsonMode: out.jsonMode });
		});
}

/** Command that branches on isTTY. */
function ttyBranchCommand() {
	return command('status')
		.description('Show status')
		.action(({ out }) => {
			if (out.jsonMode) {
				out.json({ status: 'ok' });
			} else if (out.isTTY) {
				out.log('Status: ok (interactive)');
			} else {
				out.log('Status: ok');
			}
		});
}

/** Command that emits spinner activity. */
function spinnerCommand() {
	return command('build')
		.description('Build with spinner')
		.action(({ out }) => {
			const spinner = out.spinner('Preparing build environment...');
			spinner.succeed('Environment ready');
		});
}

// --- isTTY through CLIBuilder.execute()

describe('CLIBuilder.execute() — isTTY propagation', () => {
	it('passes isTTY=true to command handler', async () => {
		const app = cli('test').command(modeCommand());
		const result = await app.execute(['mode'], { isTTY: true });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.isTTY).toBe(true);
	});

	it('passes isTTY=false to command handler', async () => {
		const app = cli('test').command(modeCommand());
		const result = await app.execute(['mode'], { isTTY: false });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.isTTY).toBe(false);
	});

	it('defaults to isTTY=false when not specified', async () => {
		const app = cli('test').command(modeCommand());
		const result = await app.execute(['mode']);

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed.isTTY).toBe(false);
	});

	it('handler branches on isTTY in execute', async () => {
		const app = cli('test').command(ttyBranchCommand());

		const tty = await app.execute(['status'], { isTTY: true });
		expect(tty.stdout).toEqual(['Status: ok (interactive)\n']);

		const piped = await app.execute(['status'], { isTTY: false });
		expect(piped.stdout).toEqual(['Status: ok\n']);
	});

	it('--json overrides isTTY for output decisions', async () => {
		const app = cli('test').command(ttyBranchCommand());
		const result = await app.execute(['status', '--json'], { isTTY: true });

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ status: 'ok' });
	});
});

// --- isTTY through CLIBuilder.run() — wired from adapter

describe('CLIBuilder.run() — isTTY from adapter', () => {
	it('sources isTTY from adapter.isTTY', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'mode'],
			isTTY: true,
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('test').command(modeCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(stdoutLines.length).toBe(1);
		const parsed = JSON.parse(stdoutLines[0] ?? '');
		expect(parsed.isTTY).toBe(true);
	});

	it('adapter.isTTY=false propagates to handler', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'mode'],
			isTTY: false,
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('test').command(modeCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(stdoutLines.length).toBe(1);
		const parsed = JSON.parse(stdoutLines[0] ?? '');
		expect(parsed.isTTY).toBe(false);
	});

	it('jsonMode via options overrides adapter mode decisions in run', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'status'],
			isTTY: true,
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('test').command(ttyBranchCommand());

		try {
			await app.run({ adapter, jsonMode: true });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(stdoutLines.length).toBe(1);
		const parsed = JSON.parse(stdoutLines[0] ?? '');
		expect(parsed).toEqual({ status: 'ok' });
	});

	it('explicit isTTY in options overrides adapter', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'mode'],
			isTTY: true,
			stdout: (s) => stdoutLines.push(s),
		});

		const app = cli('test').command(modeCommand());

		try {
			// Explicit isTTY=false should override adapter's true
			await app.run({ adapter, isTTY: false });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(stdoutLines.length).toBe(1);
		const parsed = JSON.parse(stdoutLines[0] ?? '');
		expect(parsed.isTTY).toBe(false);
	});

	it('renders spinner activity to adapter stderr in TTY mode', async () => {
		const stdoutLines: string[] = [];
		const stderrLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'build'],
			isTTY: true,
			stdout: (s) => stdoutLines.push(s),
			stderr: (s) => stderrLines.push(s),
		});

		const app = cli('test').command(spinnerCommand());

		try {
			await app.run({ adapter });
		} catch (e) {
			if (!(e instanceof ExitError)) throw e;
		}

		const rendered = stderrLines.join('');
		expect(rendered).toContain('Preparing build environment...');
		expect(rendered).toContain('Environment ready');

		const stdoutRendered = stdoutLines.join('');
		expect(stdoutRendered).not.toContain('Preparing build environment...');
		expect(stdoutRendered).not.toContain('Environment ready');
	});
});
