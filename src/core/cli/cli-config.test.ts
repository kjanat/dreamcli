/**
 * Integration tests for config auto-discovery wired through CLIBuilder.run().
 *
 * Tests the --config flag, auto-discovery search paths, error rendering,
 * and precedence between explicit options.config and loaded config.
 */
import { describe, expect, it } from 'vitest';
import type { FormatLoader } from '#internals/core/config/index.ts';
import { configFormat } from '#internals/core/config/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { cli } from './index.ts';

// === Test helpers

/** Command that reads a flag from config and outputs it as JSON. */
function regionCommand() {
	return command('deploy')
		.description('Deploy to a region')
		.flag('region', flag.string().config('deploy.region').default('us'))
		.action(({ flags, out }) => {
			out.json({ region: flags.region });
		});
}

/** Helper: run app via .run() with adapter, capture stdout/stderr. */
async function runWithAdapter(
	app: ReturnType<typeof cli>,
	argv: readonly string[],
	files?: Readonly<Record<string, string>>,
	adapterOptions?: {
		readonly cwd?: string;
		readonly configDir?: string;
	},
): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let exitCode = 0;

	const adapter = createTestAdapter({
		argv: ['node', 'test', ...argv],
		...(adapterOptions?.cwd !== undefined ? { cwd: adapterOptions.cwd } : {}),
		...(adapterOptions?.configDir !== undefined ? { configDir: adapterOptions.configDir } : {}),
		stdout: (s) => stdoutLines.push(s),
		stderr: (s) => stderrLines.push(s),
		readFile: async (path: string) => files?.[path] ?? null,
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

	return { stdout: stdoutLines, stderr: stderrLines, exitCode };
}

// === CLIBuilder.config() — builder method

describe('CLIBuilder.config() — builder method', () => {
	it('returns a new CLIBuilder (immutability)', () => {
		const a = cli('myapp');
		const b = a.config('myapp');
		expect(a).not.toBe(b);
		expect(a.schema.configSettings).toBeUndefined();
		expect(b.schema.configSettings).toBeDefined();
	});

	it('stores appName in configSettings', () => {
		const app = cli('myapp').config('myapp');
		expect(app.schema.configSettings?.appName).toBe('myapp');
	});

	it('stores loaders in configSettings', () => {
		const loader = { extensions: ['toml'], parse: () => ({}) };
		const app = cli('myapp').config('myapp', [loader]);
		expect(app.schema.configSettings?.loaders).toEqual([loader]);
	});

	it('configSettings is undefined when .config() not called', () => {
		const app = cli('myapp');
		expect(app.schema.configSettings).toBeUndefined();
	});
});

// === CLIBuilder.run() — auto-discovery

describe('CLIBuilder.run() — config auto-discovery', () => {
	it('loads config from dotfile in cwd', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy'], {
			'/test/.myapp.json': '{"deploy":{"region":"eu"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'eu' });
	});

	it('loads config from {app}.config.json', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy'], {
			'/test/myapp.config.json': '{"deploy":{"region":"ap"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'ap' });
	});

	it('loads config from XDG config dir', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy'], {
			'/home/test/.config/myapp/config.json': '{"deploy":{"region":"af"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'af' });
	});

	it('loads config from AppData on Windows', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(
			app,
			['deploy'],
			{
				'C:\\Users\\alice\\AppData\\Roaming\\myapp\\config.json': '{"deploy":{"region":"sa"}}',
			},
			{
				cwd: 'C:\\Users\\alice\\project',
				configDir: 'C:\\Users\\alice\\AppData\\Roaming',
			},
		);

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'sa' });
	});

	it('uses default when no config found', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy']);

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'us' });
	});

	it('does not load config when .config() not called', async () => {
		const app = cli('myapp').command(regionCommand());

		// Even with a config file present, should use default
		const { stdout } = await runWithAdapter(app, ['deploy'], {
			'/test/.myapp.json': '{"deploy":{"region":"eu"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'us' });
	});
});

// === CLIBuilder.run() — --config flag

describe('CLIBuilder.run() — --config flag', () => {
	it('overrides auto-discovery with explicit path', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['--config', '/custom/cfg.json', 'deploy'], {
			'/test/.myapp.json': '{"deploy":{"region":"default"}}',
			'/custom/cfg.json': '{"deploy":{"region":"custom"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'custom' });
	});

	it('--config is stripped from argv before command dispatch', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		// --config and its value should not leak to command parsing
		const { stdout, exitCode } = await runWithAdapter(app, ['--config', '/cfg.json', 'deploy'], {
			'/cfg.json': '{"deploy":{"region":"ok"}}',
		});

		expect(exitCode).toBe(0);
		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'ok' });
	});

	it('--config after command name still works', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy', '--config', '/cfg.json'], {
			'/cfg.json': '{"deploy":{"region":"after"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'after' });
	});

	it('--config=path equals form loads config', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['--config=/eq/cfg.json', 'deploy'], {
			'/eq/cfg.json': '{"deploy":{"region":"equals"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'equals' });
	});

	it('--config=path is stripped from argv before dispatch', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout, exitCode } = await runWithAdapter(app, ['--config=/eq.json', 'deploy'], {
			'/eq.json': '{"deploy":{"region":"stripped"}}',
		});

		expect(exitCode).toBe(0);
		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'stripped' });
	});

	it('--config= with empty value is treated as absent', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['--config=', 'deploy']);

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'us' });
	});

	it('--config=path after command name still works', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy', '--config=/after.json'], {
			'/after.json': '{"deploy":{"region":"after-eq"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'after-eq' });
	});
});

// === CLIBuilder.run() — error rendering

describe('CLIBuilder.run() — config errors', () => {
	it('renders CONFIG_NOT_FOUND error when explicit path missing', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stderr, exitCode } = await runWithAdapter(app, ['--config', '/missing.json', 'deploy']);

		expect(exitCode).toBe(1);
		expect(stderr.join('')).toContain('Config file not found');
		expect(stderr.join('')).toContain('/missing.json');
	});

	it('renders CONFIG_NOT_FOUND as JSON when --json present', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout, exitCode } = await runWithAdapter(app, [
			'--json',
			'--config',
			'/missing.json',
			'deploy',
		]);

		expect(exitCode).toBe(1);
		expect(stdout.length).toBe(1);
		const parsed = JSON.parse(stdout[0] ?? '');
		expect(parsed.error.code).toBe('CONFIG_NOT_FOUND');
	});

	it('renders CONFIG_PARSE_ERROR for malformed JSON', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stderr, exitCode } = await runWithAdapter(app, ['deploy'], {
			'/test/.myapp.json': '{bad json',
		});

		expect(exitCode).toBe(1);
		expect(stderr.join('')).toContain('Failed to parse config file');
	});

	it('renders CONFIG_PARSE_ERROR as JSON when --json present', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout, exitCode } = await runWithAdapter(app, ['--json', 'deploy'], {
			'/test/.myapp.json': '{bad json',
		});

		expect(exitCode).toBe(1);
		expect(stdout.length).toBe(1);
		const parsed = JSON.parse(stdout[0] ?? '');
		expect(parsed.error.code).toBe('CONFIG_PARSE_ERROR');
	});
});

// === CLIBuilder.run() — precedence

describe('CLIBuilder.run() — config precedence', () => {
	it('explicit options.config takes precedence over loaded config', async () => {
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
			stdout: (s) => stdoutLines.push(s),
			readFile: async (path: string) =>
				path === '/test/.myapp.json' ? '{"deploy":{"region":"file"}}' : null,
		});

		const app = cli('myapp').config('myapp').command(regionCommand());

		try {
			await app.run({
				adapter,
				config: { deploy: { region: 'explicit' } },
			});
		} catch (e: unknown) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(stdoutLines.length).toBe(1);
		expect(JSON.parse(stdoutLines[0] ?? '')).toEqual({ region: 'explicit' });
	});

	it('CLI flags override config values', async () => {
		const app = cli('myapp').config('myapp').command(regionCommand());

		const { stdout } = await runWithAdapter(app, ['deploy', '--region', 'cli-value'], {
			'/test/.myapp.json': '{"deploy":{"region":"file-value"}}',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ region: 'cli-value' });
	});
});

// === CLIBuilder.run() — completions subcommand skip

describe('CLIBuilder.run() — completions skip config', () => {
	it('completions subcommand does not trigger config loading', async () => {
		let readFileCalled = false;
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'completions', 'bash'],
			stdout: (s) => stdoutLines.push(s),
			readFile: async () => {
				readFileCalled = true;
				return null;
			},
		});

		const app = cli('myapp').config('myapp').command(regionCommand()).completions();

		try {
			await app.run({ adapter });
		} catch (e: unknown) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(readFileCalled).toBe(false);
		// Should have output a bash completion script
		expect(stdoutLines.join('')).toContain('_myapp_completions');
	});
});

// === CLIBuilder.configLoader() — incremental plugin registration

describe('CLIBuilder.configLoader() — builder method', () => {
	it('returns a new CLIBuilder (immutability)', () => {
		const loader: FormatLoader = { extensions: ['toml'], parse: () => ({}) };
		const a = cli('myapp').config('myapp');
		const b = a.configLoader(loader);
		expect(a).not.toBe(b);
		expect(a.schema.configSettings?.loaders).toBeUndefined();
		expect(b.schema.configSettings?.loaders).toEqual([loader]);
	});

	it('accumulates loaders across multiple calls', () => {
		const toml: FormatLoader = { extensions: ['toml'], parse: () => ({}) };
		const yaml: FormatLoader = { extensions: ['yaml', 'yml'], parse: () => ({}) };
		const app = cli('myapp').config('myapp').configLoader(toml).configLoader(yaml);
		expect(app.schema.configSettings?.loaders).toEqual([toml, yaml]);
	});

	it('throws when .config() has not been called', () => {
		const loader: FormatLoader = { extensions: ['toml'], parse: () => ({}) };
		expect(() => cli('myapp').configLoader(loader)).toThrow(CLIError);
		try {
			cli('myapp').configLoader(loader);
		} catch (e: unknown) {
			expect(e).toBeInstanceOf(CLIError);
			const err = e as CLIError;
			expect(err.code).toBe('INVALID_BUILDER_STATE');
		}
	});

	it('preserves loaders from .config() call', () => {
		const initial: FormatLoader = { extensions: ['ini'], parse: () => ({}) };
		const added: FormatLoader = { extensions: ['toml'], parse: () => ({}) };
		const app = cli('myapp').config('myapp', [initial]).configLoader(added);
		expect(app.schema.configSettings?.loaders).toEqual([initial, added]);
	});
});

// === CLIBuilder.configLoader() — integration with .run()

describe('CLIBuilder.configLoader() — run() integration', () => {
	/** Trivial TOML-ish parser for tests. */
	const tomlLoader = configFormat(['toml'], (content: string): Record<string, unknown> => {
		const result: Record<string, unknown> = {};
		for (const line of content.split('\n')) {
			const match = /^(\w+)\s*=\s*"(.+)"$/.exec(line.trim());
			if (match?.[1] !== undefined && match[2] !== undefined) {
				result[match[1]] = match[2];
			}
		}
		return result;
	});

	it('loads TOML config via .configLoader()', async () => {
		const app = cli('myapp')
			.config('myapp')
			.configLoader(tomlLoader)
			.command(
				command('show')
					.flag('name', flag.string().config('name').default('unknown'))
					.action(({ flags, out }) => {
						out.json({ name: flags.name });
					}),
			);

		const { stdout } = await runWithAdapter(app, ['show'], {
			'/test/.myapp.toml': 'name = "from-toml"',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ name: 'from-toml' });
	});

	it('JSON still takes priority over TOML at same path level', async () => {
		const app = cli('myapp')
			.config('myapp')
			.configLoader(tomlLoader)
			.command(
				command('show')
					.flag('name', flag.string().config('name').default('unknown'))
					.action(({ flags, out }) => {
						out.json({ name: flags.name });
					}),
			);

		const { stdout } = await runWithAdapter(app, ['show'], {
			'/test/.myapp.json': '{"name":"from-json"}',
			'/test/.myapp.toml': 'name = "from-toml"',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ name: 'from-json' });
	});

	it('multiple loaders registered via .configLoader() all work', async () => {
		/** Trivial INI-ish parser. */
		const iniLoader = configFormat(['ini'], (content: string): Record<string, unknown> => {
			const result: Record<string, unknown> = {};
			for (const line of content.split('\n')) {
				const match = /^(\w+)\s*=\s*(.+)$/.exec(line.trim());
				if (match?.[1] !== undefined && match[2] !== undefined) {
					result[match[1]] = match[2];
				}
			}
			return result;
		});

		const app = cli('myapp')
			.config('myapp')
			.configLoader(tomlLoader)
			.configLoader(iniLoader)
			.command(
				command('show')
					.flag('name', flag.string().config('name').default('unknown'))
					.action(({ flags, out }) => {
						out.json({ name: flags.name });
					}),
			);

		// INI file available at explicit path
		const { stdout } = await runWithAdapter(app, ['--config', '/custom/app.ini', 'show'], {
			'/custom/app.ini': 'name=from-ini',
		});

		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({ name: 'from-ini' });
	});
});
