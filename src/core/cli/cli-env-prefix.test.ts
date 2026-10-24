/**
 * CLI-wide environment namespaces: `.envPrefix()`, relative and absolute env
 * bindings, name-derived bindings, and the concrete names every surface reports.
 *
 * Every test injects its environment snapshot.
 *
 * @module dreamcli/core/cli/cli-env-prefix.test
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { generateSchema } from '#internals/core/json-schema/index.ts';
import { readFlags } from '#internals/core/read-flags/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command, createCommandSchema } from '#internals/core/schema/command.ts';
import { deriveEnvName, deriveEnvPrefix } from '#internals/core/schema/env-binding.ts';
import { createFlagSchema, flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import { cli, createCLISchema } from './index.ts';

// === helpers

/** A command that reports its resolved values and their provenance as JSON. */
function deployCommand() {
	return command('deploy')
		.flag('token', flag.string().env('TOKEN'))
		.flag('home', flag.string().env('HOME', { absolute: true }))
		.flag(
			'servers',
			flag.array(flag.string()).env({ count: 'SERVER_COUNT', value: 'SERVER_{index}' }),
		)
		.arg('target', arg.string().env('TARGET').default('local'))
		.action(({ flags, args, sources, out }) => out.json({ flags, args, sources }));
}

interface Report {
	readonly flags: Record<string, unknown>;
	readonly args: Record<string, unknown>;
	readonly sources: {
		readonly flags: Record<string, unknown>;
		readonly args: Record<string, unknown>;
	};
}

function reportOf(stdout: readonly string[]): Report {
	return JSON.parse(stdout.join('')) as Report;
}

/** Run a construction that must fail and return its `CLIError`. */
function schemaError(build: () => unknown): CLIError {
	try {
		build();
	} catch (error) {
		if (error instanceof CLIError) return error;
		throw error;
	}
	throw new Error('expected the construction to be rejected');
}

// === derivation

describe('deriveEnvPrefix()', () => {
	it.each([
		['foo', 'FOO_'],
		['foo-bar', 'FOO_BAR_'],
		['foo.bar', 'FOO_BAR_'],
		['foo_bar', 'FOO_BAR_'],
		['my cool cli', 'MY_COOL_CLI_'],
		['--foo--bar--', 'FOO_BAR_'],
		['9lives', '9LIVES_'],
		['café', 'CAF_'],
	])('derives %j as %j', (name, prefix) => {
		expect(deriveEnvPrefix(name)).toBe(prefix);
	});

	it('rejects a name with no letter or digit', () => {
		const error = schemaError(() => deriveEnvPrefix('---'));
		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.suggest).toContain(".envPrefix('ACME_')");
	});
});

// === the builder

describe('CLIBuilder.envPrefix()', () => {
	it('derives the namespace from the declared CLI name', () => {
		expect(cli('foo-bar').envPrefix().schema.envPrefix).toBe('FOO_BAR_');
	});

	it('uses an explicit prefix verbatim', () => {
		expect(cli('foo').envPrefix('ACME_').schema.envPrefix).toBe('ACME_');
		expect(cli('foo').envPrefix('ACME').schema.envPrefix).toBe('ACME');
	});

	it.each(['', 'A=B', 'A{index}', 'A\0'])('rejects the explicit prefix %j', (prefix) => {
		expect(schemaError(() => cli('foo').envPrefix(prefix)).code).toBe('INVALID_SCHEMA');
	});

	it('leaves names unprefixed when no namespace is declared', async () => {
		const app = cli('foo').command(deployCommand());
		const result = await app.execute(['deploy'], { env: { TOKEN: 't', FOO_TOKEN: 'wrong' } });

		expect(cli('foo').schema.envPrefix).toBeUndefined();
		expect(reportOf(result.stdout).flags.token).toBe('t');
		expect(reportOf(result.stdout).sources.flags.token).toEqual({ stage: 'env', envVar: 'TOKEN' });
	});

	it('validates a definition-supplied prefix', () => {
		expect(createCLISchema({ name: 'foo', envPrefix: 'ACME_' }).envPrefix).toBe('ACME_');
		expect(schemaError(() => createCLISchema({ name: 'foo', envPrefix: '' })).code).toBe(
			'INVALID_SCHEMA',
		);
	});
});

// === resolution

describe('resolution under a CLI namespace', () => {
	const env = {
		FOO_TOKEN: 'from-namespace',
		TOKEN: 'unprefixed',
		HOME: '/home/kaj',
		FOO_HOME: 'ignored',
		FOO_SERVER_COUNT: '2',
		FOO_SERVER_0: 'a.example',
		FOO_SERVER_1: 'b.example',
		FOO_TARGET: 'prod',
	};

	it('reads relative bindings with the prefix and absolute ones as written', async () => {
		const app = cli('foo').envPrefix().command(deployCommand());
		const { flags, args, sources } = reportOf((await app.execute(['deploy'], { env })).stdout);

		expect(flags).toEqual({
			token: 'from-namespace',
			home: '/home/kaj',
			servers: ['a.example', 'b.example'],
		});
		expect(args).toEqual({ target: 'prod' });
		expect(sources.flags).toEqual({
			token: { stage: 'env', envVar: 'FOO_TOKEN' },
			home: { stage: 'env', envVar: 'HOME' },
			servers: {
				stage: 'env',
				via: 'indexed',
				count: 'FOO_SERVER_COUNT',
				envVars: ['FOO_SERVER_0', 'FOO_SERVER_1'],
			},
		});
		expect(sources.args).toEqual({ target: { stage: 'env', envVar: 'FOO_TARGET' } });
	});

	it('does not fall back to the unprefixed name', async () => {
		const app = cli('foo').envPrefix().command(deployCommand());
		const { flags } = reportOf((await app.execute(['deploy'], { env: { TOKEN: 'x' } })).stdout);
		expect(flags.token).toBeUndefined();
	});

	it('reads an absolute indexed family as written', async () => {
		const app = cli('foo')
			.envPrefix()
			.command(
				command('git')
					.flag(
						'servers',
						flag
							.array(flag.string())
							.env({ count: 'SERVER_COUNT', value: 'SERVER_{index}' }, { absolute: true }),
					)
					.action(({ flags, out }) => out.json(flags.servers)),
			);

		const result = await app.execute(['git'], {
			env: { SERVER_COUNT: '1', SERVER_0: 'raw', FOO_SERVER_COUNT: '1', FOO_SERVER_0: 'no' },
		});
		expect(JSON.parse(result.stdout.join(''))).toEqual(['raw']);
	});

	it('shares one namespace across nested commands', async () => {
		const leaf = command('leaf')
			.flag('token', flag.string().env('TOKEN'))
			.action(({ sources, out }) => out.json(sources.flags.token));
		const app = cli('foo').envPrefix().command(command('outer').command(leaf));

		const result = await app.execute(['outer', 'leaf'], { env: { FOO_TOKEN: 't' } });
		expect(JSON.parse(result.stdout.join(''))).toEqual({ stage: 'env', envVar: 'FOO_TOKEN' });
	});

	it('names the concrete variable in diagnostics and suggestions', async () => {
		const app = cli('foo')
			.envPrefix()
			.command(
				command('deploy')
					.flag('port', flag.number().env('PORT'))
					.flag('token', flag.string().env('TOKEN').required())
					.flag(
						'servers',
						flag.array(flag.string()).env({ count: 'SERVER_COUNT', value: 'SERVER_{index}' }),
					)
					.action(() => {}),
			);

		const badPort = await app.execute(['deploy', '--token', 't'], { env: { FOO_PORT: 'x' } });
		const missing = await app.execute(['deploy'], { env: {} });
		const member = await app.execute(['deploy', '--token', 't'], {
			env: { FOO_SERVER_COUNT: '1' },
		});

		expect(badPort.error?.message).toBe(
			"Invalid number value 'x' from env FOO_PORT for flag --port",
		);
		expect(missing.error?.suggest).toBe('Provide --token <value> or set FOO_TOKEN');
		expect(missing.error?.details).toMatchObject({ envVar: 'FOO_TOKEN' });
		expect(member.error?.message).toBe(
			'Env FOO_SERVER_COUNT declares 1 entry for flag --servers, but FOO_SERVER_0 is not set',
		);
	});

	it('suggests the concrete variable for a missing required argument', async () => {
		const app = cli('foo')
			.envPrefix()
			.command(
				command('send')
					.arg('target', arg.string().env('TARGET'))
					.action(() => {}),
			);

		const result = await app.execute(['send'], { env: {} });
		expect(result.error?.suggest).toBe('Provide a value for <target> or set FOO_TARGET');
	});

	it('looks up a prefixed name colliding with Object.prototype safely', async () => {
		const app = cli('foo')
			.envPrefix('to')
			.command(
				command('probe')
					.flag('value', flag.string().env('String'))
					.action(({ flags, out }) => out.json({ value: flags.value ?? null })),
			);

		const result = await app.execute(['probe'], { env: {} });
		expect(JSON.parse(result.stdout.join(''))).toEqual({ value: null });
	});

	it('lets a run-level envPrefix override the declared one', async () => {
		const app = cli('foo').envPrefix().command(deployCommand());
		const { flags } = reportOf(
			(await app.execute(['deploy'], { env: { BAR_TOKEN: 'b' }, envPrefix: 'BAR_' })).stdout,
		);
		expect(flags.token).toBe('b');
	});
});

// === runCommand and readFlags

describe('process-free entry points', () => {
	it('runCommand() reads names as written when no namespace is passed', async () => {
		const result = await runCommand(deployCommand(), [], { env: { TOKEN: 't', FOO_TOKEN: 'x' } });
		expect(reportOf(result.stdout).flags.token).toBe('t');
	});

	it('runCommand() applies a namespace passed as envPrefix', async () => {
		const result = await runCommand(deployCommand(), [], {
			env: { TOKEN: 'x', FOO_TOKEN: 't' },
			envPrefix: 'FOO_',
		});
		expect(reportOf(result.stdout).sources.flags.token).toEqual({
			stage: 'env',
			envVar: 'FOO_TOKEN',
		});
	});

	it('runCommand() rejects an invalid envPrefix as a structured error', async () => {
		const result = await runCommand(deployCommand(), [], { env: {}, envPrefix: 'A=' });
		expect(result.error?.code).toBe('INVALID_SCHEMA');
	});

	it('readFlags() applies envPrefix the same way', async () => {
		const flags = await readFlags(
			{ token: flag.string().env('TOKEN'), home: flag.string().env('HOME', { absolute: true }) },
			{ argv: [], env: { ACME_TOKEN: 't', HOME: '/h' }, envPrefix: 'ACME_' },
		);
		expect(flags).toEqual({ token: 't', home: '/h' });
	});
});

// === invocation names

describe('the namespace is fixed at declaration', () => {
	it('ignores an inherited invocation name', async () => {
		let seen: unknown;
		let usage = '';
		const app = cli({ name: 'foo', inherit: true })
			.envPrefix()
			.command(
				command('x')
					.flag('t', flag.string().env('T'))
					.action(({ sources, meta }) => {
						seen = sources.flags.t;
						usage = meta.bin;
					}),
			);

		await app
			.run({
				adapter: createTestAdapter({
					argv: ['node', '/usr/local/bin/f', 'x'],
					env: { FOO_T: 'namespaced', F_T: 'inherited' },
				}),
			})
			.catch((error: unknown) => {
				if (!(error instanceof ExitError)) throw error;
			});

		expect(usage).toBe('f');
		expect(seen).toEqual({ stage: 'env', envVar: 'FOO_T' });
	});
});

// === help

describe('help under a CLI namespace', () => {
	it('renders the concrete names for flags, args, families, and absolute bindings', async () => {
		const app = cli('foo').envPrefix().command(deployCommand());
		const help = (await app.execute(['deploy', '--help'], { help: { width: 200 } })).stdout.join(
			'',
		);

		expect(help).toContain('[env: FOO_TOKEN]');
		expect(help).toContain('[env: HOME]');
		expect(help).toContain('[env: FOO_SERVER_{index}, count: FOO_SERVER_COUNT]');
		expect(help).toContain('[env: FOO_TARGET]');
		expect(help).not.toContain('[env: TOKEN]');
	});

	it('renders the concrete names for a default command inlined in root help', async () => {
		const app = cli('foo').envPrefix().default(deployCommand());
		const help = (await app.execute(['--help'], { help: { width: 200 } })).stdout.join('');
		expect(help).toContain('[env: FOO_TOKEN]');
	});

	it('renders runCommand() help with the namespace it was given', async () => {
		const help = (
			await runCommand(deployCommand(), ['--help'], { envPrefix: 'FOO_', help: { width: 200 } })
		).stdout.join('');
		expect(help).toContain('[env: FOO_TOKEN]');
	});
});

// === schema surface

describe('absolute bindings in schemas and documents', () => {
	it('resets to relative when .env() is called without the option', () => {
		const schema = flag.string().env('HOME', { absolute: true }).env('TOKEN').schema;
		expect(schema.envAbsolute).toBe(false);
	});

	it('rejects envAbsolute without an env source in a definition', () => {
		const error = schemaError(() => createFlagSchema('string', { envAbsolute: true }));
		expect(error.message).toBe("Flag schema field 'envAbsolute' requires an env source");
	});

	it('serializes the namespace at the root and logical names on fragments', () => {
		const document = generateSchema(cli('foo').envPrefix().command(deployCommand()).schema);
		const deploy = document.commands[0];

		expect(document.envPrefix).toBe('FOO_');
		expect(deploy?.flags.token).toMatchObject({ envVar: 'TOKEN' });
		expect(deploy?.flags.token).not.toHaveProperty('envAbsolute');
		expect(deploy?.flags.home).toMatchObject({ envVar: 'HOME', envAbsolute: true });
		expect(deploy?.flags.servers).toMatchObject({
			envIndexed: { count: 'SERVER_COUNT', value: 'SERVER_{index}' },
		});
	});

	it('omits envPrefix from a document without a namespace', () => {
		expect(generateSchema(cli('foo').command(deployCommand()).schema)).not.toHaveProperty(
			'envPrefix',
		);
	});
});

// === name-derived bindings

describe('deriveEnvName()', () => {
	it.each([
		['token', 'TOKEN'],
		['api-token', 'API_TOKEN'],
		['apiToken', 'API_TOKEN'],
		['cacheDir', 'CACHE_DIR'],
		['cache_dir', 'CACHE_DIR'],
		['HTTPProxy', 'HTTP_PROXY'],
		['httpProxy', 'HTTP_PROXY'],
		['x2y', 'X2Y'],
		['v2Api', 'V2_API'],
	])('derives %j as %j', (name, envVar) => {
		expect(deriveEnvName(name)).toBe(envVar);
	});

	it('rejects a name with no letter or digit', () => {
		expect(schemaError(() => deriveEnvName('--')).code).toBe('INVALID_SCHEMA');
	});
});

describe('.env() without a name', () => {
	function derivedCommand() {
		return command('deploy')
			.flag('api-token', flag.string().env())
			.flag('cacheDir', flag.string().env())
			.flag('home', flag.string().env({ absolute: true }))
			.arg('target', arg.string().env().optional())
			.action(({ flags, args, sources, out }) => out.json({ flags, args, sources }));
	}

	it('fills envVar in from the registered name and clears the marker', () => {
		const { flags, args } = derivedCommand().schema;

		expect([flags['api-token']?.envVar, flags['api-token']?.envFromName]).toEqual([
			'API_TOKEN',
			false,
		]);
		expect(flags.cacheDir?.envVar).toBe('CACHE_DIR');
		expect([flags.home?.envVar, flags.home?.envAbsolute]).toEqual(['HOME', true]);
		expect(args[0]?.schema.envVar).toBe('TARGET');
	});

	it('leaves the marker on a builder that is not registered yet', () => {
		const schema = flag.string().env().schema;
		expect([schema.envVar, schema.envFromName]).toEqual([undefined, true]);
	});

	it('derives a separate name for each key one builder is registered under', () => {
		const shared = flag.string().env();
		const { flags } = command('x').flag('first', shared).flag('second', shared).schema;
		expect([flags.first?.envVar, flags.second?.envVar]).toEqual(['FIRST', 'SECOND']);
	});

	it('reads derived names under the CLI namespace, absolute ones as derived', async () => {
		const app = cli('foo').envPrefix().command(derivedCommand());
		const result = await app.execute(['deploy'], {
			env: { FOO_API_TOKEN: 't', FOO_CACHE_DIR: '/c', HOME: '/h', FOO_TARGET: 'p', API_TOKEN: 'x' },
		});
		const { flags, args, sources } = reportOf(result.stdout);

		expect(flags).toEqual({ 'api-token': 't', cacheDir: '/c', home: '/h' });
		expect(args).toEqual({ target: 'p' });
		expect(sources.flags['api-token']).toEqual({ stage: 'env', envVar: 'FOO_API_TOKEN' });
		expect(sources.flags.home).toEqual({ stage: 'env', envVar: 'HOME' });
	});

	it('reads the derived name as written without a namespace', async () => {
		const result = await runCommand(derivedCommand(), [], { env: { API_TOKEN: 't' } });
		expect(reportOf(result.stdout).flags['api-token']).toBe('t');
	});

	it('renders the derived concrete names in help', async () => {
		const app = cli('foo').envPrefix().command(derivedCommand());
		const help = (await app.execute(['deploy', '--help'], { help: { width: 200 } })).stdout.join(
			'',
		);

		expect(help).toContain('[env: FOO_API_TOKEN]');
		expect(help).toContain('[env: FOO_CACHE_DIR]');
		expect(help).toContain('[env: HOME]');
		expect(help).toContain('[env: FOO_TARGET]');
	});

	it('derives names on the definition path and for readFlags()', async () => {
		const schema = createCommandSchema({
			name: 'x',
			flags: { httpProxy: { kind: 'string', envFromName: true } },
			args: [{ name: 'out-dir', schema: { kind: 'string', envFromName: true } }],
		});
		const flags = await readFlags(
			{ apiToken: flag.string().env() },
			{ argv: [], env: { ACME_API_TOKEN: 't' }, envPrefix: 'ACME_' },
		);

		expect(schema.flags.httpProxy?.envVar).toBe('HTTP_PROXY');
		expect(schema.args[0]?.schema.envVar).toBe('OUT_DIR');
		expect(flags).toEqual({ apiToken: 't' });
	});

	it('serializes the derived name as envVar, never the marker', () => {
		const document = generateSchema(cli('foo').envPrefix().command(derivedCommand()).schema);
		const deploy = document.commands[0];

		expect(deploy?.flags['api-token']).toMatchObject({ envVar: 'API_TOKEN' });
		expect(deploy?.flags['api-token']).not.toHaveProperty('envFromName');
		expect(deploy?.flags.home).toMatchObject({ envVar: 'HOME', envAbsolute: true });
	});

	it('replaces and is replaced by an explicit env source', () => {
		const named = flag.string().env().env('TOKEN').schema;
		const derived = flag.string().env('TOKEN').env().schema;

		expect([named.envVar, named.envFromName]).toEqual(['TOKEN', false]);
		expect([derived.envVar, derived.envFromName]).toEqual([undefined, true]);
	});

	it('rejects envFromName alongside another env source in a definition', () => {
		const error = schemaError(() =>
			createFlagSchema('string', { envFromName: true, envVar: 'TOKEN' }),
		);
		expect(error.message).toBe(
			"Flag schema field 'envFromName' is mutually exclusive with 'envVar' and 'envIndexed'",
		);
	});

	it('treats an object carrying binding keys as a binding, not options', () => {
		const error = schemaError(() =>
			flag
				.array(flag.string())
				.env({ value: 'V_{index}' } as unknown as { count: string; value: string }),
		);
		expect(error.code).toBe('INVALID_SCHEMA');
	});
});
