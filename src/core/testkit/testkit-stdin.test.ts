/**
 * Stdin resolution tests through the public test harness.
 */

import { describe, expect, it } from 'vitest';
import { createTestAdapter, ExitError } from '../../runtime/adapter.ts';
import { cli } from '../cli/index.ts';
import { arg } from '../schema/arg.ts';
import { command } from '../schema/command.ts';
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
		expect(result.stdout).toEqual(['{"target":"stdin-target"}\n']);
		expect(result.stderr).toEqual([]);
	});
});

describe('CLIBuilder.run — stdin TTY behavior', () => {
	it('falls through when stdin is a TTY and no piped data exists', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
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
