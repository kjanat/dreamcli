/**
 * Stdin resolution tests through the public test harness.
 */

import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import { runCommand } from './index.ts';

function jsonStdinCommand() {
	return command('deploy')
		.arg('target', arg.string().stdin())
		.action(({ args, out }) => {
			out.json({ target: args.target });
		});
}

describe('runCommand — stdin', () => {
	it('supports stdin-backed args in JSON mode', async () => {
		const result = await runCommand(jsonStdinCommand(), [], {
			stdinData: 'stdin-target',
			jsonMode: true,
		});

		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout[0] ?? '');
		expect(parsed).toEqual({ target: 'stdin-target' });
		expect(result.stderr).toEqual([]);
	});
});

describe('CLIBuilder.run — stdin TTY behavior', () => {
	it('falls through when stdin is a TTY even when test stdinData is provided', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
			stdinData: 'ignored-target',
			stdinIsTTY: true,
			stdout: (line) => stdoutLines.push(line),
			exit: (code) => {
				throw new ExitError(code);
			},
		});
		const app = cli('test').command(
			command('deploy')
				.arg('target', arg.string().stdin().optional())
				.action(({ args, out }) => {
					out.log(`target=${String(args.target)}`);
				}),
		);

		try {
			await app.run({ adapter });
		} catch (error) {
			if (!(error instanceof ExitError)) {
				throw error;
			}
			expect(error.code).toBe(0);
		}

		expect(stdoutLines).toEqual(['target=undefined\n']);
	});
});
