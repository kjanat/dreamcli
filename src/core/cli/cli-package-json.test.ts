/**
 * Integration tests for package.json auto-discovery wired through CLIBuilder.run().
 *
 * Tests the .packageJson() builder method, auto-fill of version/description,
 * name inference, precedence (explicit wins), and completions skip.
 */
import { describe, expect, it } from 'vitest';
import { createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

// ===================================================================
// Test helpers
// ===================================================================

/** Command that outputs flags as JSON. */
function infoCommand() {
	return command('info')
		.description('Show info')
		.flag('verbose', flag.boolean().alias('v'))
		.action(({ out }) => {
			out.json({ ok: true });
		});
}

/** Helper: run app via .run() with adapter, capture stdout/stderr. */
async function runWithAdapter(
	app: ReturnType<typeof cli>,
	argv: readonly string[],
	files?: Readonly<Record<string, string>>,
	cwd?: string,
): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let exitCode = 0;

	const adapter = createTestAdapter({
		argv: ['node', 'test', ...argv],
		stdout: (s) => stdoutLines.push(s),
		stderr: (s) => stderrLines.push(s),
		readFile: async (path: string) => files?.[path] ?? null,
		...(cwd !== undefined ? { cwd } : {}),
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
// CLIBuilder.packageJson() — builder method
// ===================================================================

describe('CLIBuilder.packageJson() — builder method', () => {
	it('returns a new CLIBuilder (immutability)', () => {
		const a = cli('myapp');
		const b = a.packageJson();
		expect(a).not.toBe(b);
		expect(a.schema.packageJsonSettings).toBeUndefined();
		expect(b.schema.packageJsonSettings).toBeDefined();
	});

	it('stores default settings (inferName: false)', () => {
		const app = cli('myapp').packageJson();
		expect(app.schema.packageJsonSettings).toEqual({ inferName: false });
	});

	it('stores inferName: true', () => {
		const app = cli('myapp').packageJson({ inferName: true });
		expect(app.schema.packageJsonSettings).toEqual({ inferName: true });
	});

	it('packageJsonSettings is undefined when .packageJson() not called', () => {
		const app = cli('myapp');
		expect(app.schema.packageJsonSettings).toBeUndefined();
	});
});

// ===================================================================
// CLIBuilder.run() — version discovery
// ===================================================================

describe('CLIBuilder.run() — package.json version', () => {
	it('fills version from package.json', async () => {
		const app = cli('myapp').packageJson().command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"3.2.1"}',
		});

		expect(stdout.join('')).toBe('3.2.1\n');
	});

	it('explicit .version() wins over discovered', async () => {
		const app = cli('myapp').packageJson().version('9.9.9').command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"1.0.0"}',
		});

		expect(stdout.join('')).toBe('9.9.9\n');
	});

	it('rejects --version when neither explicit nor discovered', async () => {
		const app = cli('myapp').packageJson().command(infoCommand());

		const { exitCode, stderr } = await runWithAdapter(app, ['--version']);

		// No version configured → --version falls through as unknown flag
		expect(exitCode).toBe(2);
		expect(stderr.join('')).toContain('Unknown flag --version');
	});
});

// ===================================================================
// CLIBuilder.run() — description discovery
// ===================================================================

describe('CLIBuilder.run() — package.json description', () => {
	it('fills description from package.json into help', async () => {
		const app = cli('myapp').packageJson().command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"description":"My awesome CLI tool"}',
		});

		expect(stdout.join('')).toContain('My awesome CLI tool');
	});

	it('explicit .description() wins over discovered', async () => {
		const app = cli('myapp').packageJson().description('Explicit desc').command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"description":"Package desc"}',
		});

		expect(stdout.join('')).toContain('Explicit desc');
		expect(stdout.join('')).not.toContain('Package desc');
	});
});

// ===================================================================
// CLIBuilder.run() — name inference
// ===================================================================

describe('CLIBuilder.run() — package.json name inference', () => {
	it('infers name from bin key when inferName: true', async () => {
		const app = cli('placeholder').packageJson({ inferName: true }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': JSON.stringify({
				name: 'my-package',
				bin: { 'my-tool': './dist/cli.js' },
			}),
		});

		expect(stdout.join('')).toContain('my-tool');
		expect(stdout.join('')).not.toContain('placeholder');
	});

	it('infers name from package name (scope stripped) when no bin', async () => {
		const app = cli('placeholder').packageJson({ inferName: true }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"name":"@scope/my-tool"}',
		});

		expect(stdout.join('')).toContain('my-tool');
	});

	it('does not infer name when inferName is false (default)', async () => {
		const app = cli('myapp').packageJson().command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': JSON.stringify({
				name: 'other-name',
				bin: { 'other-tool': './dist/cli.js' },
			}),
		});

		expect(stdout.join('')).toContain('myapp');
		expect(stdout.join('')).not.toContain('other-tool');
	});
});

// ===================================================================
// CLIBuilder.run() — walk-up resolution
// ===================================================================

describe('CLIBuilder.run() — package.json walk-up', () => {
	it('walks up to find package.json in parent directory', async () => {
		const app = cli('myapp').packageJson().command(infoCommand());

		const { stdout } = await runWithAdapter(
			app,
			['--version'],
			{ '/projects/package.json': '{"version":"5.0.0"}' },
			'/projects/myapp/src',
		);

		expect(stdout.join('')).toBe('5.0.0\n');
	});
});

// ===================================================================
// CLIBuilder.run() — no discovery when not opted in
// ===================================================================

describe('CLIBuilder.run() — no discovery without .packageJson()', () => {
	it('does not read package.json when .packageJson() not called', async () => {
		let readCalled = false;
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', '--version'],
			stdout: (s) => stdoutLines.push(s),
			readFile: async () => {
				readCalled = true;
				return '{"version":"1.0.0"}';
			},
		});

		const app = cli('myapp').version('0.0.1').command(infoCommand());

		try {
			await app.run({ adapter });
		} catch (e: unknown) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(readCalled).toBe(false);
		expect(stdoutLines.join('')).toBe('0.0.1\n');
	});
});

// ===================================================================
// CLIBuilder.run() — completions skip package.json
// ===================================================================

describe('CLIBuilder.run() — completions skip package.json', () => {
	it('completions subcommand does not trigger package.json loading', async () => {
		let readCalled = false;
		const stdoutLines: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'completions', 'bash'],
			stdout: (s) => stdoutLines.push(s),
			readFile: async () => {
				readCalled = true;
				return null;
			},
		});

		const app = cli('myapp').packageJson().command(infoCommand()).completions();

		try {
			await app.run({ adapter });
		} catch (e: unknown) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(readCalled).toBe(false);
		expect(stdoutLines.join('')).toContain('_myapp_completions');
	});
});

// ===================================================================
// CLIBuilder.run() — error resilience
// ===================================================================

describe('CLIBuilder.run() — package.json error resilience', () => {
	it('malformed package.json is silently ignored', async () => {
		const app = cli('myapp').packageJson().version('1.0.0').command(infoCommand());

		const { stdout, exitCode } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{bad json',
		});

		expect(exitCode).toBe(0);
		expect(stdout.join('')).toBe('1.0.0\n');
	});

	it('no package.json found is silently ignored', async () => {
		const app = cli('myapp').packageJson().command(infoCommand());

		const { exitCode } = await runWithAdapter(app, ['info']);

		expect(exitCode).toBe(0);
	});
});

// ===================================================================
// CLIBuilder.run() — combined with .config()
// ===================================================================

describe('CLIBuilder.run() — package.json combined with config', () => {
	it('both .packageJson() and .config() work together', async () => {
		const app = cli('myapp')
			.packageJson()
			.config('myapp')
			.command(
				command('deploy')
					.flag('region', flag.string().config('deploy.region').default('us'))
					.action(({ flags, out }) => {
						out.json({ region: flags.region });
					}),
			);

		const { stdout } = await runWithAdapter(app, ['deploy'], {
			'/test/package.json': '{"version":"2.0.0","description":"Deployer"}',
			'/test/.myapp.json': '{"deploy":{"region":"eu"}}',
		});

		expect(stdout).toHaveLength(1);
		const [output] = stdout;
		if (output === undefined) throw new Error('unreachable: stdout empty after length check');
		expect(JSON.parse(output)).toEqual({ region: 'eu' });
	});

	it('--version shows discovered version when combined with .config()', async () => {
		const app = cli('myapp').packageJson().config('myapp').command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"4.5.6"}',
		});

		expect(stdout.join('')).toBe('4.5.6\n');
	});
});
