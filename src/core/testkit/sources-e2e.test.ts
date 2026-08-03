import { describe, expect, it, vi } from 'vitest';
import { readFlags } from '#internals/core/read-flags/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import type { ResolutionProvenance, SourcesOf } from '#internals/core/schema/provenance.ts';
import { wasExplicit } from '#internals/core/schema/provenance.ts';
import type { RunOptions } from '#internals/core/schema/run.ts';
import { runCommand } from './index.ts';

// === L18 — the provenance a handler receives

/** Run a one-flag command and report where its value came from. */
async function flagSource(
	argv: readonly string[],
	options?: RunOptions,
): Promise<ResolutionProvenance | undefined> {
	let seen: ResolutionProvenance | undefined;
	const cmd = command('send')
		.flag(
			'body',
			flag
				.string()
				.stdin()
				.env('BODY')
				.config('send.body')
				.prompt({ kind: 'input', message: 'Body' })
				.default('fallback'),
		)
		.action(({ sources }) => {
			seen = sources.flags.body;
		});

	const result = await runCommand(cmd, [...argv], options);
	expect(result.exitCode).toBe(0);
	return seen;
}

/** Run a one-arg command and report where its value came from. */
async function argSource(
	argv: readonly string[],
	options?: RunOptions,
): Promise<ResolutionProvenance | undefined> {
	let seen: ResolutionProvenance | undefined;
	const cmd = command('send')
		.arg(
			'body',
			arg
				.string()
				.stdin()
				.env('BODY')
				.config('send.body')
				.prompt({ kind: 'input', message: 'Body' })
				.default('fallback'),
		)
		.action(({ sources }) => {
			seen = sources.args.body;
		});

	const result = await runCommand(cmd, [...argv], options);
	expect(result.exitCode).toBe(0);
	return seen;
}

describe('sources on the flag surface', () => {
	it('names the CLI for a typed value', async () => {
		expect(await flagSource(['--body', 'typed'])).toEqual({ stage: 'cli' });
	});

	it('names the dash trigger for an explicit dash', async () => {
		expect(await flagSource(['--body', '-'], { stdinData: 'piped' })).toEqual({
			stage: 'cli',
			via: 'stdin',
			trigger: 'dash',
		});
	});

	it('names the fallback trigger for an absent input', async () => {
		expect(await flagSource([], { stdinData: 'piped' })).toEqual({
			stage: 'stdin',
			via: 'stdin',
			trigger: 'fallback',
		});
	});

	it('names the environment variable', async () => {
		expect(await flagSource([], { env: { BODY: 'from-env' } })).toEqual({
			stage: 'env',
			envVar: 'BODY',
		});
	});

	it('names the config path', async () => {
		expect(await flagSource([], { config: { send: { body: 'from-config' } } })).toEqual({
			stage: 'config',
			configPath: 'send.body',
		});
	});

	it('names the prompt', async () => {
		expect(await flagSource([], { answers: ['answered'] })).toEqual({ stage: 'prompt' });
	});

	it('names the default', async () => {
		expect(await flagSource([])).toEqual({ stage: 'default' });
	});
});

describe('sources of a collection the buffer spliced into', () => {
	it('names the dash trigger for a flag whose list took bytes from the pipe', async () => {
		let seen: { value: unknown; source: ResolutionProvenance | undefined } | undefined;
		const cmd = command('t')
			.flag('tag', flag.array(flag.string()).stdin())
			.action(({ flags, sources }) => {
				seen = { value: flags.tag, source: sources.flags.tag };
			});

		await runCommand(cmd, ['--tag', 'before', '--tag', '-', '--tag', 'after'], {
			stdinData: 'a\nb\n',
		});

		expect(seen).toEqual({
			value: ['before', 'a', 'b', 'after'],
			source: { stage: 'cli', via: 'stdin', trigger: 'dash' },
		});
	});

	it('names the dash trigger for a positional tail the pipe filled', async () => {
		let seen: ResolutionProvenance | undefined;
		const cmd = command('t')
			.arg('files', arg.string().variadic().stdin())
			.action(({ sources }) => {
				seen = sources.args.files;
			});

		await runCommand(cmd, ['before', '-', 'after'], { stdinData: 'a\nb\n' });

		expect(seen).toEqual({ stage: 'cli', via: 'stdin', trigger: 'dash' });
	});

	it('names the plain CLI stage for a literal dash no input reads stdin for', async () => {
		let seen: { value: unknown; source: ResolutionProvenance | undefined } | undefined;
		const cmd = command('t')
			.arg('files', arg.string().variadic())
			.action(({ args, sources }) => {
				seen = { value: args.files, source: sources.args.files };
			});

		await runCommand(cmd, ['a', '-', 'b'], { stdinData: 'piped' });

		expect(seen).toEqual({ value: ['a', '-', 'b'], source: { stage: 'cli' } });
	});
});

describe('sources on the arg surface', () => {
	it('names the CLI for a typed value', async () => {
		expect(await argSource(['typed'])).toEqual({ stage: 'cli' });
	});

	it('names the dash trigger for an explicit dash', async () => {
		expect(await argSource(['-'], { stdinData: 'piped' })).toEqual({
			stage: 'cli',
			via: 'stdin',
			trigger: 'dash',
		});
	});

	it('names the fallback trigger for an absent input', async () => {
		expect(await argSource([], { stdinData: 'piped' })).toEqual({
			stage: 'stdin',
			via: 'stdin',
			trigger: 'fallback',
		});
	});

	it('names the environment variable', async () => {
		expect(await argSource([], { env: { BODY: 'from-env' } })).toEqual({
			stage: 'env',
			envVar: 'BODY',
		});
	});

	it('names the config path', async () => {
		expect(await argSource([], { config: { send: { body: 'from-config' } } })).toEqual({
			stage: 'config',
			configPath: 'send.body',
		});
	});

	it('names the prompt', async () => {
		expect(await argSource([], { answers: ['answered'] })).toEqual({ stage: 'prompt' });
	});

	it('names the default', async () => {
		expect(await argSource([])).toEqual({ stage: 'default' });
	});
});

describe('sources beside the resolved values', () => {
	it('leaves an unresolved optional input without a record', async () => {
		let seen: SourcesOf<{ readonly body: unknown }> | undefined;
		const cmd = command('send')
			.flag('body', flag.string())
			.action(({ sources }) => {
				seen = sources.flags;
			});

		await runCommand(cmd, []);

		expect(seen?.body).toBeUndefined();
		expect(wasExplicit(seen?.body)).toBe(false);
	});

	it('answers a name of an Object.prototype member with no record', async () => {
		const seen: Record<string, unknown> = {};
		const cmd = command('t')
			.flag('toString', flag.string())
			.arg('valueOf', arg.string().optional())
			.action(({ sources }) => {
				const flags: Record<string, unknown> = sources.flags;
				const args: Record<string, unknown> = sources.args;
				seen.flag = flags.toString;
				seen.arg = args.valueOf;
				seen.explicit = wasExplicit(flags.toString as never);
			});

		await runCommand(cmd, []);

		expect(seen).toEqual({ flag: undefined, arg: undefined, explicit: false });
	});

	it('separates an explicit value equal to the default from the default itself', async () => {
		const explicitness: boolean[] = [];
		const cmd = command('build')
			.flag('out', flag.string().default('dist'))
			.action(({ sources }) => {
				explicitness.push(wasExplicit(sources.flags.out));
			});

		await runCommand(cmd, ['--out', 'dist']);
		await runCommand(cmd, []);

		expect(explicitness).toEqual([true, false]);
	});

	it('reaches derive and middleware with the same record', async () => {
		const seen: Array<ResolutionProvenance | undefined> = [];
		const cmd = command('deploy')
			.flag('region', flag.string().env('REGION'))
			.middleware(
				middleware(({ sources, next }) => {
					seen.push(sources.flags.region);
					return next({});
				}),
			)
			.derive(({ sources }) => {
				seen.push(sources.flags.region);
			})
			.action(({ sources }) => {
				seen.push(sources.flags.region);
			});

		await runCommand(cmd, [], { env: { REGION: 'eu' } });

		expect(seen).toEqual([
			{ stage: 'env', envVar: 'REGION' },
			{ stage: 'env', envVar: 'REGION' },
			{ stage: 'env', envVar: 'REGION' },
		]);
	});
});

describe('readFlags() provenance', () => {
	it('hands the whole record to onSources', async () => {
		const onSources = vi.fn();

		const values = await readFlags(
			{
				watch: flag.boolean().env('WATCH'),
				target: flag.string().default('node'),
			},
			{ argv: ['--watch'], env: {}, onSources },
		);

		expect(values).toEqual({ watch: true, target: 'node' });
		expect(onSources).toHaveBeenCalledWith({
			watch: { stage: 'cli' },
			target: { stage: 'default' },
		});
	});

	it('names the stdin trigger a flag actually took', async () => {
		const onSources = vi.fn();

		await readFlags(
			{ body: flag.string().stdin() },
			{ argv: [], env: {}, stdinData: 'piped', onSources },
		);

		expect(onSources).toHaveBeenCalledWith({
			body: { stage: 'stdin', via: 'stdin', trigger: 'fallback' },
		});
	});
});
