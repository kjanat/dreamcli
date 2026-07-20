/**
 * Tests for the global `--quiet`/`-q` flag: verbosity mapping, pre-dispatch
 * stripping, `--` separator semantics, and the `.run()` adapter path.
 */
import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
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
