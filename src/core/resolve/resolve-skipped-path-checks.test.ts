/**
 * Skipped path check tests — observability for `flag.path()` / `arg.path()`
 * checks that resolution had no means to run (#146).
 *
 * Covers the `skippedPathChecks` record on `resolve()` and `runCommand()`
 * results, the `pathChecks: 'strict'` opt-in on every process-free surface,
 * and the `missing: 'mkdir'` case for `create` without directory creation.
 */

import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { plugin } from '#internals/core/cli/plugin.ts';
import { CLIError, isValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { command, createCommandSchema } from '#internals/core/schema/command.ts';
import { createFlagSchema, flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { SkippedPathCheck } from './index.ts';
import { resolve } from './index.ts';

// --- Helpers

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return createCommandSchema({ name: 'test', ...overrides });
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
	return { flags: {}, args: {}, ...overrides };
}

/** Plain wrapper-fn probe — records every probed path, no module mocks. */
function statProbe(lookup: Readonly<Record<string, 'file' | 'directory'>> = {}) {
	const calls: string[] = [];
	return {
		calls,
		stat: (path: string): Promise<'file' | 'directory' | null> => {
			calls.push(path);
			return Promise.resolve(lookup[path] ?? null);
		},
	};
}

const FILE_CHECKS = { mustExist: true, type: 'file', create: false } as const;
const CREATE_CHECKS = { mustExist: true, type: 'directory', create: true } as const;

/** The issue's reproduction: `type: 'file'` implies existence. */
function probeCommand() {
	return command('probe')
		.arg('output', arg.path({ type: 'file' }))
		.action(({ out }) => out.log('action ran'));
}

// === resolve() — recording

describe('resolve() — skippedPathChecks', () => {
	it('records a flag check that had no stat probe', async () => {
		const schema = makeSchema({
			flags: { input: createFlagSchema('string', { pathChecks: FILE_CHECKS }) },
		});

		const result = await resolve(schema, makeParsed({ flags: { input: '/nope' } }));

		expect(result.flags).toEqual({ input: '/nope' });
		expect(result.skippedPathChecks).toEqual<SkippedPathCheck[]>([
			{ kind: 'flag', name: 'input', checks: FILE_CHECKS, missing: 'stat' },
		]);
	});

	it('records an arg check that had no stat probe', async () => {
		const result = await resolve(
			probeCommand().schema,
			makeParsed({ args: { output: '/tmp/missing.wasm' } }),
		);

		expect(result.args).toEqual({ output: '/tmp/missing.wasm' });
		expect(result.skippedPathChecks).toEqual<SkippedPathCheck[]>([
			{ kind: 'arg', name: 'output', checks: FILE_CHECKS, missing: 'stat' },
		]);
	});

	it('records every skipped input across both surfaces, flags first', async () => {
		const schema = makeSchema({
			flags: { input: createFlagSchema('string', { pathChecks: FILE_CHECKS }) },
			args: [
				{
					name: 'output',
					schema: probeCommand().schema.args[0]?.schema ?? expect.unreachable('arg'),
				},
			],
		});

		const result = await resolve(
			schema,
			makeParsed({ flags: { input: '/in' }, args: { output: '/out' } }),
		);

		expect(result.skippedPathChecks.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
			'flag:input',
			'arg:output',
		]);
	});

	it('records nothing when a stat probe ran the checks', async () => {
		const probe = statProbe({ '/in.txt': 'file' });
		const schema = makeSchema({
			flags: { input: createFlagSchema('string', { pathChecks: FILE_CHECKS }) },
		});

		const result = await resolve(schema, makeParsed({ flags: { input: '/in.txt' } }), {
			stat: probe.stat,
		});

		expect(result.skippedPathChecks).toEqual([]);
		expect(probe.calls).toEqual(['/in.txt']);
	});

	it('records nothing for an unresolved optional path — production checks nothing either', async () => {
		const schema = makeSchema({
			flags: { input: createFlagSchema('string', { pathChecks: FILE_CHECKS }) },
		});

		const result = await resolve(schema, makeParsed());

		expect(result.skippedPathChecks).toEqual([]);
	});

	it('records nothing for a path input that declares no checks', async () => {
		const schema = makeSchema({
			flags: { input: createFlagSchema('string', { pathChecks: undefined }) },
		});

		const result = await resolve(schema, makeParsed({ flags: { input: '/anything' } }));

		expect(result.skippedPathChecks).toEqual([]);
	});

	it('records a defaulted path value — the production failure the issue hit', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					presence: 'defaulted',
					defaultValue: '/default/missing',
					pathChecks: FILE_CHECKS,
				}),
			},
		});

		const result = await resolve(schema, makeParsed());

		expect(result.flags).toEqual({ input: '/default/missing' });
		expect(result.skippedPathChecks).toEqual([
			{ kind: 'flag', name: 'input', checks: FILE_CHECKS, missing: 'stat' },
		]);
	});

	it('records a collection input once, however many paths it carries', async () => {
		const cmd = command('read')
			.flag('inputs', flag.array(flag.path({ type: 'file' })))
			.action(() => {});

		const result = await resolve(cmd.schema, makeParsed({ flags: { inputs: ['/a', '/b'] } }));

		expect(result.skippedPathChecks).toHaveLength(1);
		expect(result.skippedPathChecks[0]?.name).toBe('inputs');
	});

	// --- create without mkdir

	it("records missing: 'mkdir' when create is declared, the path is missing, and mustExist is false", async () => {
		const checks = { mustExist: false, type: 'directory', create: true } as const;
		const schema = makeSchema({
			flags: { outDir: createFlagSchema('string', { pathChecks: checks }) },
		});
		const probe = statProbe();

		const result = await resolve(schema, makeParsed({ flags: { outDir: '/build/out' } }), {
			stat: probe.stat,
		});

		expect(result.flags).toEqual({ outDir: '/build/out' });
		expect(result.skippedPathChecks).toEqual<SkippedPathCheck[]>([
			{ kind: 'flag', name: 'outDir', checks, missing: 'mkdir' },
		]);
	});

	it('does not record mkdir when the directory already exists', async () => {
		const schema = makeSchema({
			flags: { outDir: createFlagSchema('string', { pathChecks: CREATE_CHECKS }) },
		});
		const probe = statProbe({ '/build/out': 'directory' });

		const result = await resolve(schema, makeParsed({ flags: { outDir: '/build/out' } }), {
			stat: probe.stat,
		});

		expect(result.skippedPathChecks).toEqual([]);
	});

	it('does not record mkdir when one was supplied and created the directory', async () => {
		const schema = makeSchema({
			flags: { outDir: createFlagSchema('string', { pathChecks: CREATE_CHECKS }) },
		});
		const probe = statProbe();

		const result = await resolve(schema, makeParsed({ flags: { outDir: '/build/out' } }), {
			stat: probe.stat,
			mkdir: () => Promise.resolve(),
		});

		expect(result.skippedPathChecks).toEqual([]);
	});
});

// === resolve() — strict mode

describe("resolve() — pathChecks: 'strict'", () => {
	it('fails with PATH_CHECK_SKIPPED (exit 1) when no stat probe was supplied', async () => {
		await expect(
			resolve(probeCommand().schema, makeParsed({ args: { output: '/tmp/missing.wasm' } }), {
				pathChecks: 'strict',
			}),
		).rejects.toMatchObject({
			code: 'PATH_CHECK_SKIPPED',
			exitCode: 1,
			message: 'Filesystem checks were skipped for argument <output>: no stat probe was supplied',
			suggest:
				"Pass stat (and mkdir for create) in run options to exercise the checks, or drop pathChecks: 'strict'",
			details: {
				skipped: [
					{
						kind: 'arg',
						name: 'output',
						missing: 'stat',
						checks: { mustExist: true, type: 'file', create: false },
					},
				],
			},
		});
	});

	it('raises a CLIError, not a ValidationError — the input itself may be valid', async () => {
		try {
			await resolve(probeCommand().schema, makeParsed({ args: { output: '/out' } }), {
				pathChecks: 'strict',
			});
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(CLIError);
			expect(isValidationError(error)).toBe(false);
		}
	});

	it('lists every skipped input in one error', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', { pathChecks: FILE_CHECKS }),
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: false, type: 'directory', create: true },
				}),
			},
		});
		const probe = statProbe();

		// `input` has a probe, so only `outDir` lacks a capability here; without
		// a probe both are reported, flags in declaration order.
		await expect(
			resolve(schema, makeParsed({ flags: { input: '/in', outDir: '/out' } }), {
				pathChecks: 'strict',
			}),
		).rejects.toMatchObject({
			code: 'PATH_CHECK_SKIPPED',
			message: [
				'Filesystem checks were skipped for 2 inputs:',
				'  - flag --input: no stat probe was supplied',
				'  - flag --outDir: no stat probe was supplied',
			].join('\n'),
		});

		await expect(
			resolve(schema, makeParsed({ flags: { input: '/in', outDir: '/out' } }), {
				stat: probe.stat,
				pathChecks: 'strict',
			}),
		).rejects.toMatchObject({
			code: 'PATH_CHECK_SKIPPED',
			message: 'Filesystem checks were skipped for flag --outDir: no mkdir was supplied for create',
			details: { skipped: [expect.objectContaining({ name: 'outDir', missing: 'mkdir' })] },
		});
	});

	it('wins over a value-level failure the missing capability itself caused', async () => {
		// `create` with no `mkdir` falls back to `mustExist`, so lenient mode
		// reports a path that production would have created. Strict mode names
		// the real cause instead.
		const schema = makeSchema({
			flags: { outDir: createFlagSchema('string', { pathChecks: CREATE_CHECKS }) },
		});
		const probe = statProbe();

		await expect(
			resolve(schema, makeParsed({ flags: { outDir: '/build/out' } }), {
				stat: probe.stat,
				pathChecks: 'strict',
			}),
		).rejects.toMatchObject({ code: 'PATH_CHECK_SKIPPED' });

		await expect(
			resolve(schema, makeParsed({ flags: { outDir: '/build/out' } }), { stat: probe.stat }),
		).rejects.toMatchObject({ code: 'CONSTRAINT_VIOLATED' });
	});

	it('passes when the checks ran, and still reports their real verdict', async () => {
		const present = statProbe({ '/tmp/out.wasm': 'file' });
		const absent = statProbe();

		const ok = await resolve(
			probeCommand().schema,
			makeParsed({ args: { output: '/tmp/out.wasm' } }),
			{ stat: present.stat, pathChecks: 'strict' },
		);
		expect(ok.skippedPathChecks).toEqual([]);

		await expect(
			resolve(probeCommand().schema, makeParsed({ args: { output: '/tmp/out.wasm' } }), {
				stat: absent.stat,
				pathChecks: 'strict',
			}),
		).rejects.toMatchObject({ code: 'CONSTRAINT_VIOLATED' });
	});

	it('passes when nothing had a check to run', async () => {
		const schema = makeSchema({
			flags: { input: createFlagSchema('string', { pathChecks: FILE_CHECKS }) },
		});

		const result = await resolve(schema, makeParsed(), { pathChecks: 'strict' });

		expect(result.flags).toEqual({ input: undefined });
		expect(result.skippedPathChecks).toEqual([]);
	});

	it("'lenient' is the default and may be spelled out", async () => {
		const result = await resolve(probeCommand().schema, makeParsed({ args: { output: '/out' } }), {
			pathChecks: 'lenient',
		});

		expect(result.skippedPathChecks).toHaveLength(1);
	});
});

// === runCommand() — the issue's reproduction

describe('runCommand() — skipped filesystem validation is observable', () => {
	it('reports the skipped check on a result that still ran the action', async () => {
		const result = await runCommand(probeCommand(), ['/tmp/dreamcli-missing-issue-probe.wasm']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['action ran\n']);
		expect(result.stderr).toEqual([]);
		expect(result.skippedPathChecks).toEqual<SkippedPathCheck[]>([
			{ kind: 'arg', name: 'output', checks: FILE_CHECKS, missing: 'stat' },
		]);
	});

	it('reports an empty list once a stat probe is injected', async () => {
		const probe = statProbe({ '/tmp/in.wasm': 'file' });

		const result = await runCommand(probeCommand(), ['/tmp/in.wasm'], { stat: probe.stat });

		expect(result.exitCode).toBe(0);
		expect(result.skippedPathChecks).toEqual([]);
	});

	it("fails under pathChecks: 'strict' without running the action", async () => {
		const result = await runCommand(probeCommand(), ['/tmp/missing.wasm'], {
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('PATH_CHECK_SKIPPED');
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toEqual([
			'Filesystem checks were skipped for argument <output>: no stat probe was supplied\n',
			"Suggestion: Pass stat (and mkdir for create) in run options to exercise the checks, or drop pathChecks: 'strict'\n",
		]);
		expect(result.skippedPathChecks).toEqual([]);
	});

	it('renders the strict failure as structured JSON in --json mode', async () => {
		const result = await runCommand(probeCommand(), ['/tmp/missing.wasm', '--json'], {
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(1);
		const parsed = JSON.parse(result.stdout.join('')) as { error: { code: string } };
		expect(parsed.error.code).toBe('PATH_CHECK_SKIPPED');
	});

	it('exercises the real verdict under strict mode with a probe: missing input fails', async () => {
		const probe = statProbe();

		const result = await runCommand(probeCommand(), ['/tmp/missing.wasm'], {
			stat: probe.stat,
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
	});

	it('accepts a new output file once the schema says mustExist: false', async () => {
		const cmd = command('probe')
			.arg('output', arg.path({ type: 'file', mustExist: false }))
			.action(({ out }) => out.log('action ran'));
		const probe = statProbe();

		const result = await runCommand(cmd, ['/tmp/new.wasm'], {
			stat: probe.stat,
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['action ran\n']);
		expect(probe.calls).toEqual(['/tmp/new.wasm']);
	});

	it("reports missing: 'mkdir' for a flag declaring create", async () => {
		const cmd = command('build')
			.flag('cache', flag.path({ type: 'directory', create: true, mustExist: false }))
			.action(({ out }) => out.log('built'));
		const probe = statProbe();

		const lenient = await runCommand(cmd, ['--cache', '/tmp/cache'], { stat: probe.stat });
		expect(lenient.exitCode).toBe(0);
		expect(lenient.skippedPathChecks).toEqual([
			expect.objectContaining({ kind: 'flag', name: 'cache', missing: 'mkdir' }),
		]);

		const strict = await runCommand(cmd, ['--cache', '/tmp/cache'], {
			stat: probe.stat,
			pathChecks: 'strict',
		});
		expect(strict.exitCode).toBe(1);
		expect(strict.error?.code).toBe('PATH_CHECK_SKIPPED');
		expect(strict.error?.message).toBe(
			'Filesystem checks were skipped for flag --cache: no mkdir was supplied for create',
		);

		const created: string[] = [];
		const withMkdir = await runCommand(cmd, ['--cache', '/tmp/cache'], {
			stat: probe.stat,
			mkdir: (path) => {
				created.push(path);
				return Promise.resolve();
			},
			pathChecks: 'strict',
		});
		expect(withMkdir.exitCode).toBe(0);
		expect(withMkdir.skippedPathChecks).toEqual([]);
		expect(created).toEqual(['/tmp/cache']);
	});

	it('keeps the skip visible when the action fails afterwards', async () => {
		const cmd = command('probe')
			.arg('output', arg.path({ type: 'file' }))
			.action(() => {
				throw new CLIError('boom', { code: 'BOOM', exitCode: 7 });
			});

		const result = await runCommand(cmd, ['/tmp/missing.wasm']);

		expect(result.exitCode).toBe(7);
		expect(result.skippedPathChecks).toHaveLength(1);
	});

	it('reports an empty list when execution never reached resolution', async () => {
		const help = await runCommand(probeCommand(), ['--help']);
		expect(help.exitCode).toBe(0);
		expect(help.skippedPathChecks).toEqual([]);

		const parseError = await runCommand(probeCommand(), ['/out', '--bogus']);
		expect(parseError.exitCode).toBe(2);
		expect(parseError.skippedPathChecks).toEqual([]);
	});
});

// === CLIBuilder.execute() — same contract through dispatch

describe('CLIBuilder.execute() — skipped filesystem validation', () => {
	it('reports the skip through dispatch and the default command', async () => {
		const app = cli('probe').default(probeCommand());

		const result = await app.execute(['/tmp/missing.wasm']);

		expect(result.exitCode).toBe(0);
		expect(result.skippedPathChecks).toEqual([
			expect.objectContaining({ kind: 'arg', name: 'output', missing: 'stat' }),
		]);
	});

	it("fails under pathChecks: 'strict' for a nested command", async () => {
		const app = cli('tool').command(command('consume').command(probeCommand()));

		const result = await app.execute(['consume', 'probe', '/tmp/missing.wasm'], {
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('PATH_CHECK_SKIPPED');
	});

	it('hands the skipped checks to afterResolve plugins', async () => {
		const seen: (readonly SkippedPathCheck[])[] = [];
		const observe = plugin({
			afterResolve: ({ skippedPathChecks }) => {
				seen.push(skippedPathChecks);
			},
		});
		const app = cli('probe').plugin(observe).command(probeCommand());

		await app.execute(['probe', '/tmp/missing.wasm']);

		expect(seen).toEqual([[expect.objectContaining({ name: 'output', missing: 'stat' })]]);
	});

	it('reports an empty list on root help and dispatch errors', async () => {
		const app = cli('probe').command(probeCommand());

		expect((await app.execute([])).skippedPathChecks).toEqual([]);
		expect((await app.execute(['nope'])).skippedPathChecks).toEqual([]);
	});
});
