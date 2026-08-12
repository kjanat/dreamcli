/**
 * Tests for the global `--quiet`/`-q` flag: verbosity mapping, pre-dispatch
 * stripping, `--` separator semantics, and the `.run()` adapter path.
 */
import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import { cli } from './index.ts';

// === Helpers

function statusCommand() {
	return command('gen')
		.description('Generate a file')
		.action(({ out }) => {
			out.log('artifact');
			out.info('starting');
			out.status('Wrote dist/app.js');
		});
}

// === --quiet / -q via execute()

describe('global --quiet flag', () => {
	it('suppresses info and status, keeps log and result output', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['gen', '--quiet']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('artifact\n');
		expect(result.stderr.join('')).toBe('');
	});

	it('-q works as the short form', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['gen', '-q']);
		expect(result.stdout.join('')).toBe('artifact\n');
		expect(result.stderr.join('')).toBe('');
	});

	it('emits status on stderr without the flag', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['gen']);
		expect(result.stdout.join('')).toBe('artifact\nstarting\n');
		expect(result.stderr.join('')).toBe('Wrote dist/app.js\n');
	});

	it('is stripped before dispatch, so commands never see it', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['--quiet', 'gen']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('artifact\n');
	});

	it('a post-separator -q reaches the command as a positional', async () => {
		const echo = command('echo')
			.arg('value', arg.string())
			.action(({ args, out }) => {
				out.log(String(args.value));
			});
		const app = cli('mycli').command(echo);
		const result = await app.execute(['echo', '--', '-q']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('-q\n');
	});

	it('appears in root help global options', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['--help']);
		expect(result.stdout.join('')).toContain('-q, --quiet');
	});
});

// === Explicit --quiet=<value> (#85)

describe('global --quiet with an explicit value', () => {
	it('--quiet=true and --quiet=1 set quiet verbosity', async () => {
		const app = cli('mycli').command(statusCommand());

		for (const token of ['--quiet=true', '--quiet=1']) {
			const result = await app.execute(['gen', token]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toBe('artifact\n');
			expect(result.stderr.join('')).toBe('');
		}
	});

	it('--quiet=false and --quiet=0 keep normal verbosity', async () => {
		const app = cli('mycli').command(statusCommand());

		for (const token of ['--quiet=false', '--quiet=0']) {
			const result = await app.execute(['gen', token]);
			expect(result.exitCode).toBe(0);
			expect(result.stdout.join('')).toBe('artifact\nstarting\n');
			expect(result.stderr.join('')).toBe('Wrote dist/app.js\n');
		}
	});

	it('is stripped before dispatch, so commands never see the valued form', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['--quiet=true', 'gen']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('artifact\n');
	});

	it('takes the last occurrence, like a command boolean flag', async () => {
		const app = cli('mycli').command(statusCommand());

		const lastWinsOff = await app.execute(['gen', '--quiet', '--quiet=false']);
		expect(lastWinsOff.stderr.join('')).toBe('Wrote dist/app.js\n');

		const lastWinsOn = await app.execute(['gen', '--quiet=false', '--quiet']);
		expect(lastWinsOn.stderr.join('')).toBe('');
	});

	it('lets a later valid value replace an earlier invalid value', async () => {
		const app = cli('mycli').command(statusCommand());

		const quiet = await app.execute(['gen', '--quiet=banana', '--quiet=true']);
		expect(quiet.exitCode).toBe(0);
		expect(quiet.stderr.join('')).toBe('');

		const json = await app.execute(['gen', '--json=banana', '--json=false']);
		expect(json.exitCode).toBe(0);
		expect(json.error).toBeUndefined();
	});

	it('preserves an invalid value for a different root output flag', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['gen', '--quiet=banana', '--json=true']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.details).toMatchObject({ flag: 'quiet', value: 'banana' });
	});

	it('rejects an invalid value with the parser boolean error', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await app.execute(['gen', '--quiet=banana']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.stderr.join('')).toBe(
			"Invalid boolean value 'banana' for flag --quiet. Use true/false or 1/0\n",
		);
	});

	it('reports the same error a command boolean flag reports for the same value', async () => {
		const local = command('gen')
			.flag('hush', flag.boolean())
			.action(() => {});
		const app = cli('mycli').command(local);
		const result = await app.execute(['gen', '--hush=banana']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.stderr.join('')).toBe(
			"Invalid boolean value 'banana' for flag --hush. Use true/false or 1/0\n",
		);
	});

	it('renders --version and root --help ahead of an invalid value', async () => {
		const app = cli('mycli').version('9.9.9').command(statusCommand());

		const version = await app.execute(['--version', '--quiet=banana']);
		expect(version.exitCode).toBe(0);
		expect(version.stdout.join('')).toBe('9.9.9\n');

		const rootHelp = await app.execute(['--help', '--json=banana']);
		expect(rootHelp.exitCode).toBe(0);
		expect(rootHelp.stdout.join('')).toContain('Usage: mycli');
	});

	it('renders a command --help ahead of an invalid value, as a command flag does', async () => {
		const local = command('gen')
			.flag('force', flag.boolean())
			.action(() => {});
		const app = cli('mycli').command(local);

		const rootFlag = await app.execute(['gen', '--help', '--quiet=banana']);
		const commandFlag = await app.execute(['gen', '--help', '--force=banana']);

		expect(rootFlag.exitCode).toBe(0);
		expect(rootFlag.exitCode).toBe(commandFlag.exitCode);
		expect(rootFlag.stdout).toEqual(commandFlag.stdout);
	});

	it('leaves -q=true to the command, as a command-level boolean short flag does', async () => {
		const app = cli('mycli').command(statusCommand());
		const rootResult = await app.execute(['gen', '-q=true']);

		expect(rootResult.exitCode).toBe(2);
		expect(rootResult.stderr.join('')).toContain('Unknown flag -q');

		const local = command('gen')
			.flag('quick', flag.boolean().alias('k'))
			.action(() => {});
		const commandResult = await cli('mycli').command(local).execute(['gen', '-k=true']);

		expect(commandResult.exitCode).toBe(2);
		expect(commandResult.stderr.join('')).toContain('Unknown flag -=');
	});

	it('a post-separator --quiet=true reaches the command as a positional', async () => {
		const echo = command('echo')
			.arg('value', arg.string())
			.action(({ args, out }) => {
				out.log(String(args.value));
			});
		const app = cli('mycli').command(echo);
		const result = await app.execute(['echo', '--', '--quiet=true']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('--quiet=true\n');
	});

	it('combines --json=true with --quiet=false', async () => {
		const app = cli('mycli').command(
			command('emit').action(({ out }) => {
				out.log('human line');
				out.json({ ok: true });
			}),
		);
		const result = await app.execute(['emit', '--json=true', '--quiet=false']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('{"ok":true}\n');
		expect(result.stderr.join('')).toBe('human line\n');
	});

	it('--json=false keeps human output', async () => {
		const app = cli('mycli').command(
			command('emit').action(({ out }) => {
				out.log(`json:${String(out.jsonMode)}`);
			}),
		);
		const result = await app.execute(['emit', '--json=false']);

		expect(result.stdout.join('')).toBe('json:false\n');
	});

	it('--json takes the last occurrence', async () => {
		const app = cli('mycli').command(
			command('emit').action(({ out }) => {
				out.log(`json:${String(out.jsonMode)}`);
			}),
		);

		const off = await app.execute(['emit', '--json', '--json=false']);
		expect(off.stdout.join('')).toBe('json:false\n');

		const on = await app.execute(['emit', '--json=false', '--json=true']);
		expect(on.stderr.join('')).toBe('json:true\n');
	});
});

// === .run() adapter path

async function runWithAdapter(
	app: ReturnType<typeof cli>,
	argv: readonly string[],
): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
	const stdout: string[] = [];
	const stderr: string[] = [];
	let exitCode = 0;
	const adapter = createTestAdapter({
		argv: ['node', 'test', ...argv],
		stdout: (s) => stdout.push(s),
		stderr: (s) => stderr.push(s),
	});
	try {
		await app.run({ adapter });
	} catch (e: unknown) {
		if (e instanceof ExitError) {
			exitCode = e.code;
		} else {
			throw e;
		}
	}
	return { stdout, stderr, exitCode };
}

describe('run() adapter path', () => {
	it('honors --quiet through preflight', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await runWithAdapter(app, ['gen', '--quiet']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('artifact\n');
		expect(result.stderr.join('')).toBe('');
	});

	it('honors --quiet=true through preflight', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await runWithAdapter(app, ['gen', '--quiet=true']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('artifact\n');
		expect(result.stderr.join('')).toBe('');
	});

	it('keeps normal verbosity for --quiet=false through preflight', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await runWithAdapter(app, ['gen', '--quiet=false']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('artifact\nstarting\n');
		expect(result.stderr.join('')).toBe('Wrote dist/app.js\n');
	});

	it('rejects --quiet=banana through preflight', async () => {
		const app = cli('mycli').command(statusCommand());
		const result = await runWithAdapter(app, ['gen', '--quiet=banana']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toBe(
			"Invalid boolean value 'banana' for flag --quiet. Use true/false or 1/0\n",
		);
	});

	it('honors an explicit --json value through preflight', async () => {
		const emit = command('emit').action(({ out }) => {
			out.log(`json:${String(out.jsonMode)}`);
		});
		const app = cli('mycli').command(emit);

		const machine = await runWithAdapter(app, ['emit', '--json=true']);
		expect(machine.exitCode).toBe(0);
		expect(machine.stderr.join('')).toBe('json:true\n');

		const human = await runWithAdapter(app, ['emit', '--json=false']);
		expect(human.exitCode).toBe(0);
		expect(human.stdout.join('')).toBe('json:false\n');
	});

	it('a post-separator --json literal does not enter JSON mode', async () => {
		const echo = command('echo')
			.arg('value', arg.string())
			.action(({ args, out }) => {
				out.log(String(args.value));
				out.info(`json:${String(out.jsonMode)}`);
			});
		const app = cli('mycli').command(echo);
		const result = await runWithAdapter(app, ['echo', '--', '--json']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('--json\njson:false\n');
	});
});
