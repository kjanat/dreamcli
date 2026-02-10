/**
 * Integration tests for config auto-discovery wired through CLIBuilder.run().
 *
 * Tests the --config flag, auto-discovery search paths, error rendering,
 * and precedence between explicit options.config and loaded config.
 */
import { describe, expect, it } from 'vitest';
import { createTestAdapter, ExitError } from '../../runtime/index.js';
import { command } from '../schema/command.js';
import { flag } from '../schema/flag.js';
import { cli } from './index.js';

// ===================================================================
// Test helpers
// ===================================================================

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
): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let exitCode = 0;

	const adapter = createTestAdapter({
		argv: ['node', 'test', ...argv],
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

// ===================================================================
// CLIBuilder.config() — builder method
// ===================================================================

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

// ===================================================================
// CLIBuilder.run() — auto-discovery
// ===================================================================

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

// ===================================================================
// CLIBuilder.run() — --config flag
// ===================================================================

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
});

// ===================================================================
// CLIBuilder.run() — error rendering
// ===================================================================

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

// ===================================================================
// CLIBuilder.run() — precedence
// ===================================================================

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

// ===================================================================
// CLIBuilder.run() — completions subcommand skip
// ===================================================================

describe('CLIBuilder.run() — completions skip config', () => {
	it('completions subcommand does not trigger config loading', async () => {
		let readFileCalled = false;
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'completions', '--shell', 'bash'],
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
