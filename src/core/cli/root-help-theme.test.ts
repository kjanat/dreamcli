/**
 * Tests for themed root help through the CLI builder.
 *
 * @module dreamcli/core/cli/root-help-theme.test
 */

import { createColors } from 'ansispeck';
import { describe, expect, it } from 'vitest';

import { executeCLI } from '#internals/core/cli/index.ts';
import { stripAnsi } from '#internals/core/help/ansi.ts';
import { createCaptureOutput } from '#internals/core/output/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';

import { cli } from './index.ts';

// Expected strings must come from an explicitly enabled palette — ansispeck's
// top-level exports auto-gate and are identity in a non-TTY test process.
const on = createColors(true);
const ESC = '[';

function deployCommand() {
	return command('deploy')
		.description('Deploy the application')
		.flag('force', flag.boolean().alias('f').describe('Skip confirmation'))
		.action(() => {});
}

function app() {
	return cli('mycli').version('1.0.0').description('My CLI').command(deployCommand());
}

describe('root help theming', () => {
	it('emits no escapes through the default (non-TTY) capture channel', async () => {
		const result = await app().execute(['--help']);
		expect(result.stdout.join('')).not.toContain(ESC);
	});

	it('styles header, sections, and commands under forced color', async () => {
		const [out, captured] = createCaptureOutput({ color: true });
		await executeCLI(app(), ['--help'], { out, captured });
		const output = captured.stdout.join('');
		expect(output).toContain(on.bold('mycli'));
		expect(output).toContain(on.dim('v1.0.0'));
		expect(output).toContain(on.bold(on.underline('Usage:')));
		expect(output).toContain(on.bold(on.underline('Commands:')));
		expect(output).toContain(on.bold(on.underline('Global options:')));
		expect(output).toContain(on.cyan('deploy'));
		expect(output).toContain(on.cyan('-h, --help'));
	});

	it('strip-equivalence: forced-color root help strips to the plain rendering', async () => {
		const plain = (await app().execute(['--help'])).stdout.join('');
		const [out, captured] = createCaptureOutput({ color: true });
		await executeCLI(app(), ['--help'], { out, captured });
		expect(stripAnsi(captured.stdout.join(''))).toBe(plain);
	});

	it('merges default-command usage with a 7-space continuation under color', async () => {
		const build = () =>
			cli('mycli')
				.command(
					command('status')
						.description('Show status')
						.action(() => {}),
				)
				.default(
					command('serve')
						.description('Serve the app')
						.flag('port', flag.number().default(8080))
						.action(() => {}),
				);
		const plain = (await build().execute(['--help'])).stdout.join('');
		const [out, captured] = createCaptureOutput({ color: true });
		await executeCLI(build(), ['--help'], { out, captured });
		const colored = captured.stdout.join('');
		expect(stripAnsi(colored)).toBe(plain);
		// The merged usage block: root line + continuation aligned under 'Usage: '.
		const stripped = stripAnsi(colored);
		const usageLine = stripped.split('\n').findIndex((line) => line.startsWith('Usage:'));
		expect(usageLine).toBeGreaterThanOrEqual(0);
		expect(stripped.split('\n')[usageLine + 1]?.startsWith('       mycli')).toBe(true);
	});

	it('threads .help({ theme }) overrides into root help', async () => {
		const [out, captured] = createCaptureOutput({ color: true });
		await executeCLI(app().help({ theme: (c) => ({ command: c.green }) }), ['--help'], {
			out,
			captured,
		});
		const output = captured.stdout.join('');
		expect(output).toContain(on.green('deploy'));
		expect(output).not.toContain(on.cyan('deploy'));
	});

	it('.help({ theme }) leaks nothing without forced color', async () => {
		const result = await app()
			.help({ theme: (c) => ({ command: c.green }) })
			.execute(['--help']);
		expect(result.stdout.join('')).not.toContain(ESC);
	});

	it('testkit runCommand --help stays escape-free', async () => {
		const result = await runCommand(deployCommand(), ['--help']);
		expect(result.stdout.join('')).not.toContain(ESC);
	});
});
