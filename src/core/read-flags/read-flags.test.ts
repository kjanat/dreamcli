/**
 * readFlags() runtime behavior: parsing, precedence, diagnostics, and the
 * runtime-adapter defaults, all with explicit injection.
 */

import { describe, expect, it } from 'vitest';
import { CLIError, isParseError, isValidationError } from '#internals/core/errors/index.ts';
import { createTestPrompter } from '#internals/core/prompt/index.ts';
import type { DeprecationWarning } from '#internals/core/resolve/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import type { DenoNamespace } from '#internals/runtime/deno.ts';
import { createDenoAdapter } from '#internals/runtime/deno.ts';
import type { NodeProcess } from '#internals/runtime/node.ts';
import { createNodeAdapter } from '#internals/runtime/node.ts';
import { createMockDenoNamespace } from '#internals/runtime/test-helpers.ts';
import { readFlags } from './index.ts';

/** What one argv produced: the resolved values, or the error code that replaced them. */
interface Outcome {
	readonly flags: Record<string, unknown> | undefined;
	readonly code: string | undefined;
}

// === Test helpers

/** Minimal hand-rolled Standard Schema validator, no external dependency. */
function standard<Output>(
	validate: StandardSchemaV1<unknown, Output>['~standard']['validate'],
): StandardSchemaV1<unknown, Output> {
	return { '~standard': { version: 1, vendor: 'test', validate } };
}

/** Async validator accepting a string longer than two characters. */
const asyncName = standard<string>(async (value) => {
	if (typeof value !== 'string' || value.length <= 2) {
		return { issues: [{ message: 'must be longer than two characters' }] };
	}
	return { value };
});

/** Minimal Node process stub for the Node adapter. */
function nodeProcess(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): NodeProcess {
	return {
		argv,
		env,
		versions: { node: '22.22.2' },
		cwd: () => '/',
		platform: 'linux',
		stdin: {
			[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
				return { next: () => Promise.resolve({ done: true, value: new Uint8Array(0) }) };
			},
		},
		stdout: { write: () => true },
		stderr: { write: () => true },
		exit: (code: number): never => {
			throw new Error(`process exited with code ${code}`);
		},
	};
}

/** Capture the error thrown by an awaited promise. */
async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
	} catch (error: unknown) {
		return error;
	}
	throw new Error('expected the call to reject');
}

// === Values and kinds

describe('readFlags() values', () => {
	it('resolves CLI values for every builder kind', async () => {
		const values = await readFlags(
			{
				name: flag.string(),
				port: flag.number(),
				watch: flag.boolean(),
				target: flag.enum(['node', 'browser']),
				tag: flag.array(flag.string()),
				verbose: flag.count().alias('v'),
				env: flag.keyValue(),
				hex: flag.custom((raw) => Number.parseInt(String(raw), 16)),
				site: flag.url(),
				out: flag.path(),
				since: flag.date(),
				timeout: flag.duration(),
				limit: flag.bytes(),
			},
			{
				argv: [
					'--name',
					'booga',
					'--port',
					'8080',
					'--watch',
					'--target',
					'browser',
					'--tag',
					'a',
					'--tag',
					'b',
					'-vv',
					'--env',
					'A=1',
					'--env',
					'B=2',
					'--hex',
					'ff',
					'--site',
					'https://example.com/',
					'--out',
					'dist',
					'--since',
					'2026-07-10',
					'--timeout',
					'30s',
					'--limit',
					'64kb',
				],
				env: {},
			},
		);

		expect(values.name).toBe('booga');
		expect(values.port).toBe(8080);
		expect(values.watch).toBe(true);
		expect(values.target).toBe('browser');
		expect(values.tag).toEqual(['a', 'b']);
		expect(values.verbose).toBe(2);
		expect(values.env).toEqual({ A: '1', B: '2' });
		expect(values.hex).toBe(255);
		expect(values.site).toBeInstanceOf(URL);
		expect(values.site?.href).toBe('https://example.com/');
		expect(values.out).toBe('dist');
		expect(values.since).toEqual(new Date('2026-07-10'));
		expect(values.timeout).toBe(30_000);
		expect(values.limit).toBe(65_536);
	});

	it('applies kind-specific fallbacks for absent flags', async () => {
		const values = await readFlags(
			{
				name: flag.string(),
				tag: flag.array(flag.string()),
				env: flag.keyValue(),
				verbose: flag.count(),
				watch: flag.boolean(),
			},
			{ argv: [], env: {} },
		);

		expect(values.name).toBeUndefined();
		expect(values.tag).toEqual([]);
		expect(values.env).toEqual({});
		expect(values.verbose).toBe(0);
		expect(values.watch).toBe(false);
	});

	it('resolves an empty definition record to an empty object', async () => {
		expect(await readFlags({}, { argv: [], env: {} })).toEqual({});
	});
});

// === Precedence

describe('readFlags() precedence', () => {
	const definitions = {
		region: flag.string().env('REGION').config('deploy.region').prompt({
			kind: 'input',
			message: 'Region?',
		}),
	};

	it('CLI beats env, config, prompt, and default', async () => {
		const values = await readFlags(definitions, {
			argv: ['--region', 'cli'],
			env: { REGION: 'env' },
			config: { deploy: { region: 'config' } },
			prompter: createTestPrompter(['prompt'], { onExhausted: 'cancel' }),
		});

		expect(values.region).toBe('cli');
	});

	it('env beats config, prompt, and default', async () => {
		const values = await readFlags(definitions, {
			argv: [],
			env: { REGION: 'env' },
			config: { deploy: { region: 'config' } },
			prompter: createTestPrompter(['prompt'], { onExhausted: 'cancel' }),
		});

		expect(values.region).toBe('env');
	});

	it('config beats prompt and default', async () => {
		const values = await readFlags(definitions, {
			argv: [],
			env: {},
			config: { deploy: { region: 'config' } },
			prompter: createTestPrompter(['prompt'], { onExhausted: 'cancel' }),
		});

		expect(values.region).toBe('config');
	});

	it('prompt beats default', async () => {
		const values = await readFlags(
			{
				region: flag
					.string()
					.env('REGION')
					.config('deploy.region')
					.prompt({ kind: 'input', message: 'Region?' })
					.default('fallback'),
			},
			{
				argv: [],
				env: {},
				config: {},
				prompter: createTestPrompter(['prompt']),
			},
		);

		expect(values.region).toBe('prompt');
	});

	it('falls back to the default when nothing else resolves', async () => {
		const values = await readFlags(
			{ region: flag.string().env('REGION').config('deploy.region').default('fallback') },
			{ argv: [], env: {}, config: {} },
		);

		expect(values.region).toBe('fallback');
	});
});

// === Parser behavior

describe('readFlags() parser behavior', () => {
	it('accepts short and long aliases', async () => {
		const definitions = { watch: flag.boolean().alias('w').alias('follow') };

		expect((await readFlags(definitions, { argv: ['-w'], env: {} })).watch).toBe(true);
		expect((await readFlags(definitions, { argv: ['--follow'], env: {} })).watch).toBe(true);
	});

	it('accepts the negated spelling of a negatable boolean', async () => {
		const definitions = { minify: flag.boolean().default(true).negatable() };

		expect((await readFlags(definitions, { argv: ['--no-minify'], env: {} })).minify).toBe(false);
		expect((await readFlags(definitions, { argv: [], env: {} })).minify).toBe(true);
	});

	it('rejects a value on the negated spelling', async () => {
		const error = await thrownBy(() =>
			readFlags({ minify: flag.boolean().negatable() }, { argv: ['--no-minify=true'], env: {} }),
		);

		expect(isParseError(error)).toBe(true);
		expect(isParseError(error) && error.code).toBe('INVALID_VALUE');
	});

	it('keeps the last occurrence by default', async () => {
		const values = await readFlags(
			{ region: flag.string() },
			{ argv: ['--region', 'us', '--region', 'eu'], env: {} },
		);

		expect(values.region).toBe('eu');
	});

	it('keeps the first occurrence under the first policy', async () => {
		const values = await readFlags(
			{ region: flag.string().duplicates('first') },
			{ argv: ['--region', 'us', '--region', 'eu'], env: {} },
		);

		expect(values.region).toBe('us');
	});

	it('rejects a repeat under the error policy', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ region: flag.string().duplicates('error') },
				{ argv: ['--region', 'us', '--region', 'eu'], env: {} },
			),
		);

		expect(isParseError(error)).toBe(true);
		expect(isParseError(error) && error.code).toBe('DUPLICATE_FLAG');
	});

	it('accepts the camel counterpart of a kebab name', async () => {
		const values = await readFlags({ 'dry-run': flag.boolean() }, { argv: ['--dryRun'], env: {} });

		expect(values['dry-run']).toBe(true);
	});

	it('rejects the counterpart when case parity is off', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ 'dry-run': flag.boolean() },
				{
					argv: ['--dryRun'],
					env: {},
					parse: { caseParity: false },
				},
			),
		);

		expect(isParseError(error) && error.code).toBe('UNKNOWN_FLAG');
	});

	it('rejects an unknown flag and suggests a declared spelling', async () => {
		const error = await thrownBy(() =>
			readFlags({ watch: flag.boolean() }, { argv: ['--wathc'], env: {} }),
		);

		expect(isParseError(error)).toBe(true);
		expect(isParseError(error) && error.code).toBe('UNKNOWN_FLAG');
		expect(isParseError(error) && error.message).toContain('Did you mean --watch?');
	});

	it('rejects positional arguments', async () => {
		const error = await thrownBy(() =>
			readFlags({ watch: flag.boolean() }, { argv: ['build'], env: {} }),
		);

		expect(isParseError(error) && error.code).toBe('UNEXPECTED_POSITIONAL');
	});

	it('accepts the inline value form', async () => {
		const values = await readFlags(
			{ name: flag.string(), port: flag.number(), target: flag.enum(['node', 'browser']) },
			{ argv: ['--name=booga', '--port=8080', '--target=browser'], env: {} },
		);

		expect(values.name).toBe('booga');
		expect(values.port).toBe(8080);
		expect(values.target).toBe('browser');
	});

	it('ignores a trailing end-of-options separator', async () => {
		const values = await readFlags(
			{ name: flag.string() },
			{ argv: ['--name', 'booga', '--'], env: {} },
		);

		expect(values.name).toBe('booga');
	});

	it('treats a token after the separator as a positional', async () => {
		const error = await thrownBy(() =>
			readFlags({ name: flag.string() }, { argv: ['--', '--name'], env: {} }),
		);

		expect(isParseError(error) && error.code).toBe('UNEXPECTED_POSITIONAL');
	});

	it('keeps the internal command name out of parse diagnostics', async () => {
		const error = await thrownBy(() =>
			readFlags({ watch: flag.boolean() }, { argv: ['--unknown'], env: {} }),
		);

		expect(isParseError(error) && error.message).not.toContain('standalone');
	});
});

// === Flag-form collisions

describe('readFlags() collisions', () => {
	it('rejects two definitions sharing an alias', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ watch: flag.boolean().alias('v'), verbose: flag.boolean().alias('v') },
				{ argv: [], env: {} },
			),
		);

		expect(isParseError(error)).toBe(false);
		expect(error).toBeInstanceOf(Error);
		expect(error instanceof Error && error.message).toContain('collides');
		expect(error instanceof CLIError && error.code).toBe('FLAG_NAME_COLLISION');
	});

	it('rejects an alias colliding with another canonical name', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ watch: flag.boolean(), follow: flag.boolean().alias('watch') },
				{ argv: [], env: {} },
			),
		);

		expect(error instanceof Error && error.message).toContain('collides');
		expect(error instanceof CLIError && error.code).toBe('FLAG_NAME_COLLISION');
	});

	it('rejects a negated spelling colliding with a canonical name', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ minify: flag.boolean().negatable(), 'no-minify': flag.boolean() },
				{ argv: [], env: {} },
			),
		);

		expect(error instanceof Error && error.message).toContain('collides');
		expect(error instanceof CLIError && error.code).toBe('FLAG_NAME_COLLISION');
	});
});

// === Definition keys that collide with Object.prototype

describe('readFlags() prototype keys', () => {
	it('rejects a __proto__ definition instead of dropping it', async () => {
		const definitions = { ['__proto__']: flag.string(), keep: flag.string() };
		const error = await thrownBy(() => readFlags(definitions, { argv: [], env: {} }));

		expect(error instanceof CLIError && error.code).toBe('INVALID_SCHEMA');
	});

	it('rejects symbol and non-enumerable definition keys instead of dropping them', async () => {
		const symbolDefinitions = { [Symbol('hidden')]: flag.string(), keep: flag.string() };
		const symbolError = await thrownBy(() =>
			readFlags(symbolDefinitions as never, { argv: [], env: {} }),
		);

		const nonEnumerableDefinitions = { keep: flag.string() };
		Object.defineProperty(nonEnumerableDefinitions, 'hidden', {
			value: flag.string(),
			enumerable: false,
		});
		const nonEnumerableError = await thrownBy(() =>
			readFlags(nonEnumerableDefinitions, { argv: [], env: {} }),
		);

		expect(symbolError instanceof CLIError && symbolError.code).toBe('INVALID_SCHEMA');
		expect(nonEnumerableError instanceof CLIError && nonEnumerableError.code).toBe(
			'INVALID_SCHEMA',
		);
	});

	it('rejects a __proto__ definition written as an object-literal property', async () => {
		const error = await thrownBy(() =>
			readFlags({ __proto__: flag.string(), keep: flag.string() }, { argv: [], env: {} }),
		);

		expect(error instanceof CLIError && error.code).toBe('INVALID_SCHEMA');
	});

	it('resolves a prototype-free definitions record', async () => {
		const definitions: Record<string, ReturnType<typeof flag.string>> = Object.create(null);
		definitions['keep'] = flag.string();

		const values = await readFlags(definitions, { argv: ['--keep', 'v'], env: {} });

		expect(values['keep']).toBe('v');
	});

	it('rejects a definitions record built over another object without naming a key', async () => {
		const base = { shared: flag.string() };
		const definitions: Record<string, ReturnType<typeof flag.string>> = Object.create(base);
		definitions['own'] = flag.string();

		const error = await thrownBy(() => readFlags(definitions, { argv: [], env: {} }));

		expect(error instanceof CLIError && error.code).toBe('INVALID_SCHEMA');
		expect(error instanceof CLIError && error.message).toContain('replaced prototype');
		expect(error instanceof CLIError && error.details).toBeUndefined();
	});

	it('resolves other Object.prototype key names', async () => {
		const values = await readFlags(
			{ constructor: flag.string(), toString: flag.string(), valueOf: flag.string() },
			{ argv: ['--constructor', 'a', '--toString', 'b', '--valueOf', 'c'], env: {} },
		);

		expect(values.constructor).toBe('a');
		expect(values.toString).toBe('b');
		expect(values.valueOf).toBe('c');
	});
});

// === Parity with a command action

describe('readFlags() command parity', () => {
	const definitions = {
		name: flag.string().alias('n'),
		port: flag.number().alias('p'),
		minify: flag.boolean().default(true).negatable(),
		target: flag.enum(['node', 'browser']).default('node'),
		tag: flag.array(flag.string()),
		verbose: flag.count().alias('v'),
		define: flag.keyValue(),
		'dry-run': flag.boolean(),
		strict: flag.string().duplicates('error'),
	};

	/** Resolved values and error code produced by the same definitions on a command. */
	async function viaCommand(argv: readonly string[]): Promise<Outcome> {
		let flags: Record<string, unknown> | undefined;
		const cmd = command('parity')
			.flag('name', definitions.name)
			.flag('port', definitions.port)
			.flag('minify', definitions.minify)
			.flag('target', definitions.target)
			.flag('tag', definitions.tag)
			.flag('verbose', definitions.verbose)
			.flag('define', definitions.define)
			.flag('dry-run', definitions['dry-run'])
			.flag('strict', definitions.strict)
			.action((params) => {
				flags = { ...params.flags };
			});

		const result = await runCommand(cmd, argv, { env: {} });
		return { flags, code: result.error?.code };
	}

	/** The same two facts produced by readFlags, with the throw caught. */
	async function viaReadFlags(argv: readonly string[]): Promise<Outcome> {
		try {
			return { flags: { ...(await readFlags(definitions, { argv, env: {} })) }, code: undefined };
		} catch (error: unknown) {
			if (!(error instanceof CLIError)) throw error;
			return { flags: undefined, code: error.code };
		}
	}

	const cases: readonly (readonly [string, readonly string[]])[] = [
		['long values', ['--name', 'booga', '--port', '8080']],
		['inline value form', ['--name=booga', '--port=8080', '--target=browser']],
		['short aliases', ['-n', 'booga', '-p', '8080', '-vv']],
		['clustered short with inline value', ['-nbooga']],
		['negated boolean', ['--no-minify']],
		['negated boolean with a value', ['--no-minify=true']],
		['case-parity counterpart', ['--dryRun']],
		['duplicate under the last policy', ['--name', 'a', '--name', 'b']],
		['duplicate under the error policy', ['--strict', 'a', '--strict', 'b']],
		['unknown long flag', ['--nope']],
		['unknown short flag', ['-z']],
		['array accumulation', ['--tag', 'a', '--tag', 'b']],
		['key-value accumulation', ['--define', 'A=1', '--define', 'B=2']],
		['missing value', ['--name']],
		['unparsable number', ['--port', 'abc']],
		['value outside the enum', ['--target', 'deno']],
		['trailing separator', ['--name', 'booga', '--']],
		['token after the separator', ['--', '--name']],
		['empty argv', []],
	];

	for (const [label, argv] of cases) {
		it(`matches the command path for ${label}`, async () => {
			const fromCommand = await viaCommand(argv);
			const fromReadFlags = await viaReadFlags(argv);

			expect(fromReadFlags.code).toBe(fromCommand.code);
			expect(fromReadFlags.flags).toEqual(fromCommand.flags);
		});
	}
});

// === Coercion, constraints, and validation

describe('readFlags() validation', () => {
	it('reports a missing required flag', async () => {
		const error = await thrownBy(() =>
			readFlags({ name: flag.string().required() }, { argv: [], env: {} }),
		);

		expect(isValidationError(error)).toBe(true);
	});

	it('enforces number constraints during parsing', async () => {
		const error = await thrownBy(() =>
			readFlags({ port: flag.number({ min: 1, max: 10 }) }, { argv: ['--port', '99'], env: {} }),
		);

		expect(isParseError(error) && error.code).toBe('INVALID_VALUE');
	});

	it('enforces string constraints on env values', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ name: flag.string({ minLength: 4 }).env('NAME') },
				{
					argv: [],
					env: { NAME: 'ab' },
				},
			),
		);

		expect(isValidationError(error)).toBe(true);
	});

	it('awaits an async Standard Schema validator', async () => {
		const values = await readFlags(
			{ name: flag.custom(asyncName) },
			{ argv: ['--name', 'booga'], env: {} },
		);

		expect(values.name).toBe('booga');

		const error = await thrownBy(() =>
			readFlags({ name: flag.custom(asyncName) }, { argv: ['--name', 'no'], env: {} }),
		);

		expect(isValidationError(error)).toBe(true);
		expect(error instanceof Error && error.message).toContain('must be longer than two characters');
	});

	it('runs path checks through an injected stat probe', async () => {
		const probed: string[] = [];
		const stat = (path: string): Promise<'file' | 'directory' | null> => {
			probed.push(path);
			return Promise.resolve(path === '/data' ? 'directory' : null);
		};

		const values = await readFlags(
			{ out: flag.path({ mustExist: true, type: 'directory' }) },
			{ argv: ['--out', '/data'], env: {}, stat },
		);

		expect(values.out).toBe('/data');
		expect(probed).toEqual(['/data']);

		const error = await thrownBy(() =>
			readFlags(
				{ out: flag.path({ mustExist: true, type: 'directory' }) },
				{ argv: ['--out', '/missing'], env: {}, stat },
			),
		);

		expect(isValidationError(error)).toBe(true);
	});

	it('creates directories through an injected mkdir', async () => {
		const created: string[] = [];
		const values = await readFlags(
			{ out: flag.path({ type: 'directory', create: true }) },
			{
				argv: ['--out', '/build'],
				env: {},
				stat: () => Promise.resolve(null),
				mkdir: (path: string) => {
					created.push(path);
					return Promise.resolve();
				},
			},
		);

		expect(values.out).toBe('/build');
		expect(created).toEqual(['/build']);
	});
});

// === Deprecations

describe('readFlags() deprecations', () => {
	it('forwards a custom deprecation message', async () => {
		const seen: DeprecationWarning[] = [];

		await readFlags(
			{ dest: flag.string().deprecated('Use --target instead') },
			{
				argv: ['--dest', 'staging'],
				env: {},
				onDeprecation: (warning) => seen.push(warning),
			},
		);

		expect(seen).toEqual([{ kind: 'flag', name: 'dest', message: 'Use --target instead' }]);
	});

	it('forwards a bare deprecation as message true', async () => {
		const seen: DeprecationWarning[] = [];

		await readFlags(
			{ dest: flag.string().deprecated().env('DEST') },
			{ argv: [], env: { DEST: 'staging' }, onDeprecation: (warning) => seen.push(warning) },
		);

		expect(seen).toEqual([{ kind: 'flag', name: 'dest', message: true }]);
	});

	it('forwards one notice per deprecated flag that resolved a value', async () => {
		const seen: DeprecationWarning[] = [];

		await readFlags(
			{
				dest: flag.string().deprecated('gone'),
				old: flag.string().deprecated('also gone'),
				kept: flag.string().deprecated('never sourced'),
			},
			{
				argv: ['--dest', 'a', '--old', 'b'],
				env: {},
				onDeprecation: (warning) => seen.push(warning),
			},
		);

		expect(seen.map((warning) => warning.name)).toEqual(['dest', 'old']);
	});

	it('resolves without a receiver and writes nothing', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--dest', 'staging'],
			stdout: (line) => written.push(line),
			stderr: (line) => written.push(line),
		});

		const values = await readFlags({ dest: flag.string().deprecated('gone') }, { adapter });

		expect(values.dest).toBe('staging');
		expect(written).toEqual([]);
	});
});

// === Runtime adapter defaults

describe('readFlags() adapter defaults', () => {
	it('reads argv past the binary and script entries', async () => {
		const adapter = createTestAdapter({ argv: ['node', 'build.ts', '--watch', '-p', '8080'] });

		const values = await readFlags(
			{ watch: flag.boolean(), port: flag.number().alias('p') },
			{ adapter },
		);

		expect(values.watch).toBe(true);
		expect(values.port).toBe(8080);
	});

	it('reads environment variables from the adapter', async () => {
		const adapter = createTestAdapter({ argv: ['node', 'build.ts'], env: { WATCH: 'true' } });

		const values = await readFlags({ watch: flag.boolean().env('WATCH') }, { adapter });

		expect(values.watch).toBe(true);
	});

	it('reads path-check primitives from the adapter', async () => {
		const probed: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--out', '/data'],
			stat: (path: string) => {
				probed.push(path);
				return Promise.resolve(path === '/data' ? 'directory' : null);
			},
		});

		const values = await readFlags(
			{ out: flag.path({ mustExist: true, type: 'directory' }) },
			{ adapter },
		);

		expect(values.out).toBe('/data');
		expect(probed).toEqual(['/data']);
	});

	it('lets explicit argv and env override the adapter', async () => {
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--region', 'adapter'],
			env: { REGION: 'adapter' },
		});

		const values = await readFlags(
			{ region: flag.string().env('REGION') },
			{
				adapter,
				argv: [],
				env: { REGION: 'explicit' },
			},
		);

		expect(values.region).toBe('explicit');
	});

	it('reads no runtime source when every fact is injected', async () => {
		const base = createTestAdapter();
		const tripwire: RuntimeAdapter = {
			...base,
			get argv(): readonly string[] {
				throw new Error('adapter argv was read');
			},
			get env(): Readonly<Record<string, string | undefined>> {
				throw new Error('adapter env was read');
			},
			stat: () => Promise.reject(new Error('adapter stat was called')),
			mkdir: () => Promise.reject(new Error('adapter mkdir was called')),
		};

		const values = await readFlags(
			{ watch: flag.boolean(), region: flag.string().env('REGION') },
			{ adapter: tripwire, argv: ['--watch'], env: { REGION: 'eu' } },
		);

		expect(values.watch).toBe(true);
		expect(values.region).toBe('eu');
	});

	it('uses explicit argv and env without an injected adapter', async () => {
		const values = await readFlags(
			{ watch: flag.boolean(), path: flag.string().env('PATH') },
			{ argv: ['--watch'], env: { PATH: '/injected/bin' } },
		);

		expect(values.watch).toBe(true);
		expect(values.path).toBe('/injected/bin');
	});

	it('never exits the process on failure', async () => {
		const adapter = createTestAdapter({ argv: ['node', 'build.ts', '--unknown'] });

		const error = await thrownBy(() => readFlags({ watch: flag.boolean() }, { adapter }));

		expect(isParseError(error)).toBe(true);
		expect(error instanceof Error && error.name).toBe('ParseError');
	});
});

// === Root-owned spellings

describe('readFlags() root-owned spellings', () => {
	it('accepts json, quiet, and help as ordinary flags', async () => {
		const values = await readFlags(
			{
				json: flag.boolean(),
				quiet: flag.boolean().alias('q'),
				help: flag.string(),
			},
			{ argv: ['--json', '-q', '--help', 'topics'], env: {} },
		);

		expect(values.json).toBe(true);
		expect(values.quiet).toBe(true);
		expect(values.help).toBe('topics');
	});
});

// === Built-in help

describe('readFlags() built-in help', () => {
	it('renders help to stdout and exits 0 for --help', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', '/repo/build.ts', '--help'],
			stdout: (line) => written.push(line),
		});

		const error = await thrownBy(() =>
			readFlags({ watch: flag.boolean(), port: flag.number().alias('p') }, { adapter }),
		);

		expect(error).toBeInstanceOf(ExitError);
		expect(error instanceof ExitError && error.code).toBe(0);
		const text = written.join('');
		expect(text).toContain('Usage: build.ts');
		expect(text).not.toContain('standalone');
		expect(text).toContain('--watch');
		expect(text).toContain('-p, --port');
	});

	it('renders help for -h', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '-h'],
			stdout: (line) => written.push(line),
		});

		const error = await thrownBy(() => readFlags({ watch: flag.boolean() }, { adapter }));

		expect(error instanceof ExitError && error.code).toBe(0);
		expect(written.join('')).toContain('--watch');
	});

	it('renders help ahead of flag validation', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--port', 'nope', '--help'],
			stdout: (line) => written.push(line),
		});

		const error = await thrownBy(() => readFlags({ port: flag.number() }, { adapter }));

		expect(error instanceof ExitError && error.code).toBe(0);
		expect(written.join('')).toContain('--port');
	});

	it('falls back to a generic script name without a script entry', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({ argv: [], stdout: (line) => written.push(line) });

		const error = await thrownBy(() =>
			readFlags({ watch: flag.boolean() }, { adapter, argv: ['--help'] }),
		);

		expect(error instanceof ExitError && error.code).toBe(0);
		expect(written.join('')).toContain('Usage: script');
	});

	it('ignores --help after the separator', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--', '--help'],
			stdout: (line) => written.push(line),
		});

		const error = await thrownBy(() => readFlags({ watch: flag.boolean() }, { adapter }));

		expect(isParseError(error) && error.code).toBe('UNEXPECTED_POSITIONAL');
		expect(written).toEqual([]);
	});

	it("does not fire when set to 'off'", async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--help'],
			stdout: (line) => written.push(line),
		});

		const error = await thrownBy(() =>
			readFlags({ watch: flag.boolean() }, { adapter, help: 'off' }),
		);

		expect(isParseError(error) && error.code).toBe('UNKNOWN_FLAG');
		expect(written).toEqual([]);
	});

	it('yields to a definition named help', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--help', 'topics'],
			stdout: (line) => written.push(line),
		});

		const values = await readFlags({ help: flag.string() }, { adapter });

		expect(values.help).toBe('topics');
		expect(written).toEqual([]);
	});

	it('yields entirely when a definition claims only the h spelling', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--help'],
			stdout: (line) => written.push(line),
		});

		const error = await thrownBy(() =>
			readFlags({ verbose: flag.count().alias('h') }, { adapter }),
		);

		expect(isParseError(error) && error.code).toBe('UNKNOWN_FLAG');
		expect(written).toEqual([]);
	});
});

// === Non-strict parsing

describe('readFlags() strict false', () => {
	it('drops unknown long flags and their inline values', async () => {
		const values = await readFlags(
			{ watch: flag.boolean() },
			{ argv: ['--unknown', '--other=x', '--watch'], env: {}, strict: false },
		);

		expect(values.watch).toBe(true);
	});

	it('drops positional arguments', async () => {
		const values = await readFlags(
			{ watch: flag.boolean() },
			{ argv: ['build', '--watch', 'extra'], env: {}, strict: false },
		);

		expect(values.watch).toBe(true);
	});

	it('keeps the value token of a declared flag', async () => {
		const values = await readFlags(
			{ name: flag.string() },
			{ argv: ['--junk', '--name', 'booga', 'stray'], env: {}, strict: false },
		);

		expect(values.name).toBe('booga');
	});

	it('does not consume a value for an unknown flag', async () => {
		const values = await readFlags(
			{ name: flag.string() },
			{ argv: ['--unknown', 'value', '--name', 'booga'], env: {}, strict: false },
		);

		expect(values.name).toBe('booga');
	});

	it('drops unknown characters inside a short group', async () => {
		const values = await readFlags(
			{ verbose: flag.count().alias('v') },
			{ argv: ['-zvv'], env: {}, strict: false },
		);

		expect(values.verbose).toBe(2);
	});

	it('drops a short group with no declared characters', async () => {
		const values = await readFlags(
			{ watch: flag.boolean() },
			{ argv: ['-z', '--watch'], env: {}, strict: false },
		);

		expect(values.watch).toBe(true);
	});

	it('keeps the value of a declared short flag after dropped characters', async () => {
		const values = await readFlags(
			{ name: flag.string().alias('n') },
			{ argv: ['-zn', 'booga'], env: {}, strict: false },
		);

		expect(values.name).toBe('booga');
	});

	it('keeps the inline value of a declared short flag', async () => {
		const values = await readFlags(
			{ name: flag.string().alias('n') },
			{ argv: ['-znbooga'], env: {}, strict: false },
		);

		expect(values.name).toBe('booga');
	});

	it('drops everything at and after the separator', async () => {
		const values = await readFlags(
			{ name: flag.string() },
			{ argv: ['--name', 'booga', '--', 'literal', '--name'], env: {}, strict: false },
		);

		expect(values.name).toBe('booga');
	});

	it('still rejects a bad value on a declared flag', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ port: flag.number() },
				{ argv: ['--junk', '--port', 'abc'], env: {}, strict: false },
			),
		);

		expect(isParseError(error) && error.code).toBe('INVALID_VALUE');
	});

	it('still rejects a missing value on a declared flag', async () => {
		const error = await thrownBy(() =>
			readFlags({ name: flag.string() }, { argv: ['--junk', '--name'], env: {}, strict: false }),
		);

		expect(isParseError(error) && error.code).toBe('MISSING_VALUE');
	});

	it('still enforces the duplicate policy of a declared flag', async () => {
		const error = await thrownBy(() =>
			readFlags(
				{ region: flag.string().duplicates('error') },
				{ argv: ['--region', 'us', '--junk', '--region', 'eu'], env: {}, strict: false },
			),
		);

		expect(isParseError(error) && error.code).toBe('DUPLICATE_FLAG');
	});

	it('drops --help silently when the built-in is off', async () => {
		const written: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'build.ts', '--help', '--watch'],
			stdout: (line) => written.push(line),
		});

		const values = await readFlags(
			{ watch: flag.boolean() },
			{ adapter, help: 'off', strict: false },
		);

		expect(values.watch).toBe(true);
		expect(written).toEqual([]);
	});
});

// === Concrete host adapters

describe('readFlags() host adapters', () => {
	it('reads argv and env from the Node adapter, which Bun shares', async () => {
		const adapter = createNodeAdapter(
			nodeProcess(['node', 'build.ts', '--watch'], { REGION: 'eu' }),
		);

		const values = await readFlags(
			{ watch: flag.boolean(), region: flag.string().env('REGION') },
			{ adapter },
		);

		expect(values.watch).toBe(true);
		expect(values.region).toBe('eu');
	});

	it('reads argv and env from the Deno adapter', async () => {
		const namespace: DenoNamespace = {
			...createMockDenoNamespace(),
			args: ['--watch'],
			env: { get: () => 'eu', toObject: () => ({ REGION: 'eu' }) },
		};
		const adapter = createDenoAdapter(namespace);

		const values = await readFlags(
			{ watch: flag.boolean(), region: flag.string().env('REGION') },
			{ adapter },
		);

		expect(values.watch).toBe(true);
		expect(values.region).toBe('eu');
	});
});
