/**
 * Integration tests for manifest auto-discovery wired through CLIBuilder.run().
 *
 * Tests the .manifest() builder method, auto-fill of version/description,
 * name inference, precedence (explicit wins), and completions skip.
 */
import { describe, expect, it } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { cli, isMainModule } from './index.ts';

// === Test helpers

/** Command that outputs flags as JSON. */
function infoCommand() {
	return command('info')
		.description('Show info')
		.flag('verbose', flag.boolean().alias('v'))
		.action(({ out }) => {
			out.json({ ok: true });
		});
}

/** Deno-family manifest candidates, in discovery priority order. */
const DENO_FILES: readonly string[] = ['deno.json', 'deno.jsonc', 'jsr.json'];

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

// === CLIBuilder.manifest() — builder method

describe('CLIBuilder.manifest() — builder method', () => {
	it('returns a new CLIBuilder (immutability)', () => {
		const a = cli('myapp');
		const b = a.manifest();
		expect(a).not.toBe(b);
		expect(a.schema.packageJsonSettings).toBeUndefined();
		expect(b.schema.packageJsonSettings).toBeDefined();
	});

	it('packageJsonSettings is undefined when .manifest() not called', () => {
		const app = cli('myapp');
		expect(app.schema.packageJsonSettings).toBeUndefined();
	});

	it('defaults files to package.json', () => {
		const app = cli('myapp').manifest();
		expect(app.schema.packageJsonSettings).toEqual({
			inferName: false,
			stripScope: true,
			from: undefined,
			files: ['package.json'],
			data: undefined,
		});
	});

	it('stores custom files in priority order', () => {
		const app = cli('myapp').manifest({ files: ['deno.json', 'jsr.json'] });
		expect(app.schema.packageJsonSettings?.files).toEqual(['deno.json', 'jsr.json']);
	});

	it('inferName: { scope: "keep" } sets stripScope false', () => {
		const app = cli('myapp').manifest({ inferName: { scope: 'keep' } });
		expect(app.schema.packageJsonSettings).toMatchObject({ inferName: true, stripScope: false });
	});

	it('inferName: { scope: "strip" } keeps stripScope true', () => {
		const app = cli('myapp').manifest({ inferName: { scope: 'strip' } });
		expect(app.schema.packageJsonSettings).toMatchObject({ inferName: true, stripScope: true });
	});

	it('inferName: true strips scope by default', () => {
		const app = cli('myapp').manifest({ inferName: true });
		expect(app.schema.packageJsonSettings).toEqual({
			inferName: true,
			stripScope: true,
			from: undefined,
			files: ['package.json'],
			data: undefined,
		});
	});

	it('explicit inferName: false resolves to no inference, scope strip default', () => {
		const app = cli('myapp').manifest({ inferName: false });
		expect(app.schema.packageJsonSettings).toEqual({
			inferName: false,
			stripScope: true,
			from: undefined,
			files: ['package.json'],
			data: undefined,
		});
	});

	it('empty object falls through to the settings overload (not data)', () => {
		const app = cli('myapp').manifest({});
		expect(app.schema.packageJsonSettings).toEqual({
			inferName: false,
			stripScope: true,
			from: undefined,
			files: ['package.json'],
			data: undefined,
		});
	});

	it('stores from as a plain string path', () => {
		const app = cli('myapp').manifest({ from: '/anchor' });
		expect(app.schema.packageJsonSettings).toEqual({
			inferName: false,
			stripScope: true,
			from: '/anchor',
			files: ['package.json'],
			data: undefined,
		});
	});

	it('normalizes a file: URL string in from', () => {
		const app = cli('myapp').manifest({ from: 'file:///anchor/cli.js' });
		expect(app.schema.packageJsonSettings?.from).toBe('/anchor/cli.js');
	});

	it('normalizes a URL instance in from', () => {
		const app = cli('myapp').manifest({ from: new URL('file:///anchor/cli.js') });
		expect(app.schema.packageJsonSettings?.from).toBe('/anchor/cli.js');
	});

	it('data overload merges version and hardcodes inferName false / from undefined', () => {
		const app = cli('myapp').manifest({ version: '9.9.9' });
		expect(app.schema.version).toBe('9.9.9');
		expect(app.schema.packageJsonSettings).toEqual({
			inferName: false,
			stripScope: true,
			from: undefined,
			files: ['package.json'],
			data: { version: '9.9.9' },
		});
	});

	it('routes name/bin objects to the data overload', () => {
		expect(cli('x').manifest({ name: 'pkg' }).schema.packageJsonSettings?.data).toEqual({
			name: 'pkg',
		});
		expect(cli('x').manifest({ bin: { tool: './c.js' } }).schema.packageJsonSettings?.data).toEqual(
			{ bin: { tool: './c.js' } },
		);
	});

	it('routes homepage-only and repository-only objects to the data overload', () => {
		// isPackageJsonData recognizes homepage/repository, so these are data, not settings.
		expect(
			cli('x').manifest({ homepage: 'https://x.dev' }).schema.packageJsonSettings?.data,
		).toEqual({ homepage: 'https://x.dev' });
		expect(
			cli('y').manifest({ repository: 'github:me/y' }).schema.packageJsonSettings?.data,
		).toEqual({ repository: 'github:me/y' });
	});

	it('routes non-object / array inputs to the settings overload', () => {
		// Defensive: the public overloads forbid these, but the runtime guard
		// must not misclassify them as data (covers the null / Array.isArray paths).
		const callManifest = (value: unknown): ReturnType<typeof cli> =>
			(cli('x').manifest as (v: unknown) => ReturnType<typeof cli>)(value);

		expect(callManifest(null).schema.packageJsonSettings?.data).toBeUndefined();
		expect(callManifest([1]).schema.packageJsonSettings?.data).toBeUndefined();
	});
});

// === CLIBuilder.run() — version discovery

describe('CLIBuilder.run() — package.json version', () => {
	it('fills version from package.json', async () => {
		const app = cli('myapp').manifest().command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"3.2.1"}',
		});

		expect(stdout.join('')).toBe('3.2.1\n');
	});

	it('explicit .version() wins over discovered', async () => {
		const app = cli('myapp').manifest().version('9.9.9').command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"1.0.0"}',
		});

		expect(stdout.join('')).toBe('9.9.9\n');
	});

	it('rejects --version when neither explicit nor discovered', async () => {
		const app = cli('myapp').manifest().command(infoCommand());

		const { exitCode, stderr } = await runWithAdapter(app, ['--version']);

		// No version configured → --version falls through as unknown flag
		expect(exitCode).toBe(2);
		expect(stderr.join('')).toContain('Unknown flag --version');
	});
});

// === CLIBuilder.run() — discovered version collides with a command flag

describe('CLIBuilder.run() — discovered version reserved-flag collision', () => {
	it('renders the collision to stderr and exits instead of rejecting', async () => {
		const app = cli('myapp')
			.manifest()
			.command(
				command('info')
					.flag('version', flag.boolean())
					.action(({ out }) => {
						out.json({ ok: true });
					}),
			);

		const { exitCode, stdout, stderr } = await runWithAdapter(app, ['info'], {
			'/test/package.json': '{"version":"6.6.6"}',
		});

		expect(exitCode).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([
			"Error: Command 'info' defines a '--version' flag, which is reserved by the root '--version' flag. The root intercepts that token before dispatch, so the command can never receive it\n",
			'Suggestion: Rename the flag\n',
		]);
	});

	it('serializes the collision to stdout in json mode', async () => {
		const app = cli('myapp')
			.manifest()
			.command(
				command('info')
					.flag('version', flag.boolean())
					.action(({ out }) => {
						out.json({ ok: true });
					}),
			);

		const { exitCode, stdout, stderr } = await runWithAdapter(app, ['info', '--json'], {
			'/test/package.json': '{"version":"6.6.6"}',
		});

		expect(exitCode).toBe(1);
		expect(stderr).toEqual([]);
		expect(stdout.length).toBe(1);
		expect(JSON.parse(stdout[0] ?? '')).toEqual({
			error: {
				name: 'CLIError',
				code: 'RESERVED_FLAG',
				message:
					"Command 'info' defines a '--version' flag, which is reserved by the root '--version' flag. The root intercepts that token before dispatch, so the command can never receive it",
				details: { command: 'info', flag: 'version' },
				suggest: 'Rename the flag',
				exitCode: 1,
			},
		});
	});

	it('runs the discovered-version command when nothing collides', async () => {
		const app = cli('myapp')
			.manifest()
			.command(
				command('info')
					.flag('versionTag', flag.string())
					.action(({ out }) => {
						out.json({ ok: true });
					}),
			);

		const { exitCode, stdout, stderr } = await runWithAdapter(app, ['info'], {
			'/test/package.json': '{"version":"6.6.6"}',
		});

		expect(exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(JSON.parse(stdout.join(''))).toEqual({ ok: true });
	});

	it('renders a collision on the default command', async () => {
		const app = cli('myapp').default(
			command('start')
				.flag('version', flag.boolean())
				.action(({ out }) => {
					out.json({ ok: true });
				}),
		);

		const { exitCode, stdout, stderr } = await runWithAdapter(app.manifest(), [], {
			'/test/package.json': '{"version":"6.6.6"}',
		});

		expect(exitCode).toBe(1);
		expect(stdout).toEqual([]);
		expect(stderr[0]).toContain("Command 'start' defines a '--version' flag");
	});

	it('leaves a released built-in alone when discovery supplies the version', async () => {
		const app = cli('myapp')
			.builtins({ json: 'off' })
			.manifest()
			.command(
				command('validate')
					.flag('json', flag.string())
					.action(({ flags, out }) => {
						out.log(flags.json ?? '');
					}),
			);

		const { exitCode, stdout, stderr } = await runWithAdapter(
			app,
			['validate', '--json', 'doc.txt'],
			{
				'/test/package.json': '{"version":"6.6.6"}',
			},
		);

		expect(exitCode).toBe(0);
		expect(stderr).toEqual([]);
		expect(stdout.join('')).toContain('doc.txt');
	});
});

// === CLIBuilder.run() — deno-family manifest discovery

describe('CLIBuilder.run() — deno-family manifest discovery', () => {
	it('fills version from deno.json', async () => {
		const app = cli('myapp').manifest({ files: DENO_FILES }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/deno.json': '{"name":"@scope/myapp","version":"4.5.6"}',
		});

		expect(stdout.join('')).toBe('4.5.6\n');
	});

	it('falls back to jsr.json when deno.json is absent', async () => {
		const app = cli('myapp').manifest({ files: DENO_FILES }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/jsr.json': '{"version":"7.8.9"}',
		});

		expect(stdout.join('')).toBe('7.8.9\n');
	});

	it('discovers a deno.jsonc file (with comments)', async () => {
		const app = cli('myapp').manifest({ files: DENO_FILES }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/deno.jsonc': '{\n  // pinned\n  "version": "6.6.6"\n}',
		});

		expect(stdout.join('')).toBe('6.6.6\n');
	});

	it('.manifest({ files }) discovers the requested manifest', async () => {
		const app = cli('myapp')
			.manifest({ files: ['deno.json'] })
			.command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/deno.json': '{"version":"1.2.3"}',
		});

		expect(stdout.join('')).toBe('1.2.3\n');
	});

	it('inferName keeps the scope when scope: "keep"', async () => {
		const app = cli('placeholder')
			.manifest({ files: DENO_FILES, inferName: { scope: 'keep' } })
			.command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/deno.json': '{"name":"@scope/realname","version":"1.0.0"}',
		});

		// Scoped name is preserved as the CLI binary name in help output.
		expect(stdout.join('')).toContain('@scope/realname');
	});

	it('inferName strips the scope by default', async () => {
		const app = cli('placeholder')
			.manifest({ files: DENO_FILES, inferName: true })
			.command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/deno.json': '{"name":"@scope/realname","version":"1.0.0"}',
		});

		const help = stdout.join('');
		expect(help).toContain('realname');
		expect(help).not.toContain('@scope/realname');
	});

	it('.manifest({ files, from }) composes a custom file list with an anchor through run()', async () => {
		// Headline installable-Deno-CLI case: a non-default `files` list AND a
		// `from` anchor wired together. The anchor's deno.json must win over the
		// cwd ('/test') one, proving startDir+files are passed together.
		const app = cli('placeholder')
			.manifest({
				files: ['deno.json', 'jsr.json'],
				from: 'file:///anchor/cli.js',
				inferName: { scope: 'keep' },
			})
			.command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/deno.json': '{"name":"@scope/wrong","version":"0.0.0"}',
			'/anchor/deno.json': '{"name":"@scope/right","version":"5.6.7"}',
		});

		expect(stdout.join('')).toBe('5.6.7\n');
	});

	it('keeps the anchored scoped name when inferName scope is "keep"', async () => {
		const app = cli('placeholder')
			.manifest({
				files: ['deno.json', 'jsr.json'],
				from: 'file:///anchor/cli.js',
				inferName: { scope: 'keep' },
			})
			.command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/deno.json': '{"name":"@scope/wrong","version":"0.0.0"}',
			'/anchor/deno.json': '{"name":"@scope/right","version":"5.6.7"}',
		});

		expect(stdout.join('')).toContain('@scope/right');
	});

	it('skips a config-only deno.json and uses jsr.json version', async () => {
		// Headline Deno shape: deno.json kept as a tasks/imports config file,
		// publish metadata lives in jsr.json. The config-only deno.json must NOT
		// shadow the sibling jsr.json.
		const app = cli('myapp').manifest({ files: DENO_FILES }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/deno.json': '{"tasks":{"dev":"deno run main.ts"},"imports":{}}',
			'/test/jsr.json': '{"name":"@s/p","version":"1.2.3"}',
		});

		expect(stdout.join('')).toBe('1.2.3\n');
	});

	it('inferName preserves the configured cli() name when the manifest has no name/bin', async () => {
		// deno.json carries a version but no `name` and no `bin`, so inferCliName
		// returns undefined — the configured cli('placeholder') name must survive
		// (not be clobbered with an empty/undefined value).
		const app = cli('placeholder')
			.manifest({ files: DENO_FILES, inferName: true })
			.command(infoCommand());

		const files = { '/test/deno.json': '{"version":"1.0.0"}' };

		const help = await runWithAdapter(app, ['--help'], files);
		expect(help.stdout.join('')).toContain('placeholder');

		const version = await runWithAdapter(app, ['--version'], files);
		expect(version.stdout.join('')).toBe('1.0.0\n');
	});
});

// === CLIBuilder.run() — description discovery

describe('CLIBuilder.run() — package.json description', () => {
	it('fills description from package.json into help', async () => {
		const app = cli('myapp').manifest().command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"description":"My awesome CLI tool"}',
		});

		expect(stdout.join('')).toContain('My awesome CLI tool');
	});

	it('explicit .description() wins over discovered', async () => {
		const app = cli('myapp').manifest().description('Explicit desc').command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"description":"Package desc"}',
		});

		expect(stdout.join('')).toContain('Explicit desc');
		expect(stdout.join('')).not.toContain('Package desc');
	});
});

// === CLIBuilder.run() — name inference

describe('CLIBuilder.run() — package.json name inference', () => {
	it('infers name from bin key when inferName: true', async () => {
		const app = cli('placeholder').manifest({ inferName: true }).command(infoCommand());

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
		const app = cli('placeholder').manifest({ inferName: true }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"name":"@scope/my-tool"}',
		});

		expect(stdout.join('')).toContain('my-tool');
	});

	it('does not infer name when inferName is omitted (default)', async () => {
		const app = cli('myapp').manifest().command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': JSON.stringify({
				name: 'other-name',
				bin: { 'other-tool': './dist/cli.js' },
			}),
		});

		expect(stdout.join('')).toContain('myapp');
		expect(stdout.join('')).not.toContain('other-tool');
	});

	it('does not infer name when inferName is EXPLICITLY false', async () => {
		// Guards the normalizeInferName `option === false` branch: an explicit
		// false must not flip to inference-on.
		const app = cli('myapp').manifest({ inferName: false }).command(infoCommand());

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

// === CLIBuilder.run() — walk-up resolution

describe('CLIBuilder.run() — package.json walk-up', () => {
	it('walks up to find package.json in parent directory', async () => {
		const app = cli('myapp').manifest().command(infoCommand());

		const { stdout } = await runWithAdapter(
			app,
			['--version'],
			{ '/projects/package.json': '{"version":"5.0.0"}' },
			'/projects/myapp/src',
		);

		expect(stdout.join('')).toBe('5.0.0\n');
	});
});

// === CLIBuilder.run() — walk-up past a metadata-less manifest

describe('CLIBuilder.run() — walk-up past a metadata-less package.json', () => {
	it('skips a metadata-less leaf and surfaces an ancestor version', async () => {
		// Documented behavior change (manifest generalization): a metadata-less
		// leaf package.json — e.g. a monorepo root with only private/workspaces —
		// no longer halts the walk-up. The nearest ancestor carrying real metadata
		// wins, so its version surfaces where the old behavior resolved to {}.
		const app = cli('myapp').manifest().command(infoCommand());

		const { stdout } = await runWithAdapter(
			app,
			['--version'],
			{
				'/projects/myapp/package.json': '{"private":true,"workspaces":["packages/*"]}',
				'/projects/package.json': '{"version":"7.0.0"}',
			},
			'/projects/myapp',
		);

		expect(stdout.join('')).toBe('7.0.0\n');
	});
});

// === CLIBuilder.run() — no discovery when not opted in

describe('CLIBuilder.run() — no discovery without .manifest()', () => {
	it('does not read package.json when .manifest() not called', async () => {
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

// === CLIBuilder.run() — completions skip manifest discovery

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

		const app = cli('myapp').manifest().command(infoCommand()).completions();

		try {
			await app.run({ adapter });
		} catch (e: unknown) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(readCalled).toBe(false);
		expect(stdoutLines.join('')).toContain('_myapp_completions');
	});
});

// === CLIBuilder.run() — error resilience

describe('CLIBuilder.run() — package.json error resilience', () => {
	it('malformed package.json is silently ignored', async () => {
		const app = cli('myapp').manifest().version('1.0.0').command(infoCommand());

		const { stdout, exitCode } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{bad json',
		});

		expect(exitCode).toBe(0);
		expect(stdout.join('')).toBe('1.0.0\n');
	});

	it('no package.json found is silently ignored', async () => {
		const app = cli('myapp').manifest().command(infoCommand());

		const { exitCode } = await runWithAdapter(app, ['info']);

		expect(exitCode).toBe(0);
	});
});

// === CLIBuilder.run() — combined with .config()

describe('CLIBuilder.run() — package.json combined with config', () => {
	it('both .manifest() and .config() work together', async () => {
		const app = cli('myapp')
			.manifest()
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
		const app = cli('myapp').manifest().config('myapp').command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"4.5.6"}',
		});

		expect(stdout.join('')).toBe('4.5.6\n');
	});
});

// === CLIBuilder.manifest({ from }) — anchored discovery in run()

describe('CLIBuilder.manifest({ from }) — anchored discovery', () => {
	it('anchors discovery to the from directory, overriding cwd', async () => {
		const app = cli('myapp').manifest({ from: '/anchor' }).command(infoCommand());

		// cwd is the default '/test'; the from anchor must win.
		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/test/package.json': '{"version":"1.0.0"}',
			'/anchor/package.json': '{"version":"8.8.8"}',
		});

		expect(stdout.join('')).toBe('8.8.8\n');
	});

	it('anchors discovery from a file: URL string (e.g. import.meta.url)', async () => {
		const app = cli('myapp').manifest({ from: 'file:///anchor/cli.js' }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/anchor/package.json': '{"version":"2.2.2"}',
		});

		expect(stdout.join('')).toBe('2.2.2\n');
	});

	it('anchors discovery from a URL instance', async () => {
		const app = cli('myapp')
			.manifest({ from: new URL('file:///anchor/cli.js') })
			.command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/anchor/package.json': '{"version":"2.2.2"}',
		});

		expect(stdout.join('')).toBe('2.2.2\n');
	});

	it('anchors discovery from an import.meta object', async () => {
		const meta: ImportMeta = { ...import.meta, url: 'file:///anchor/cli.js' };
		const app = cli('myapp').manifest({ from: meta }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--version'], {
			'/anchor/package.json': '{"version":"3.3.3"}',
		});

		expect(stdout.join('')).toBe('3.3.3\n');
	});
});

describe('isMainModule', () => {
	it('is false when the module is not the process entrypoint', () => {
		expect(isMainModule(import.meta)).toBe(false);
	});

	it('is true when import.meta.main is set', () => {
		const meta: ImportMeta = { ...import.meta, main: true };
		expect(isMainModule(meta)).toBe(true);
	});
});

// === CLIBuilder.manifest() — settings vs data discrimination (end-to-end)

describe('CLIBuilder.manifest() — settings vs data discrimination', () => {
	it('empty {} routes to settings: --version falls through as unknown flag', async () => {
		const app = cli('myapp').manifest({}).command(infoCommand());

		const { exitCode, stderr } = await runWithAdapter(app, ['--version']);

		expect(exitCode).toBe(2);
		expect(stderr.join('')).toContain('Unknown flag --version');
	});

	it('{ inferName: true } routes to settings and still infers the name', async () => {
		const app = cli('placeholder').manifest({ inferName: true }).command(infoCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			'/test/package.json': '{"name":"@scope/inferred-tool"}',
		});

		expect(stdout.join('')).toContain('inferred-tool');
		expect(stdout.join('')).not.toContain('placeholder');
	});
});

// === CLIBuilder.manifest(data) — end-to-end (canonical data overload)

describe('CLIBuilder.manifest(data) — end-to-end', () => {
	it('reports version from data via execute() — filesystem-free path', async () => {
		const app = cli('myapp').manifest({ version: '8.8.8' }).command(infoCommand());

		const result = await app.execute(['--version']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('8.8.8\n');
	});

	it('does NOT touch the filesystem for manifest(data) in run()', async () => {
		let readCalled = false;
		const out: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'test', '--version'],
			stdout: (s) => out.push(s),
			stderr: () => {},
			readFile: async () => {
				readCalled = true;
				return null;
			},
		});

		const app = cli('myapp').manifest({ version: '8.8.8' }).command(infoCommand());
		try {
			await app.run({ adapter });
		} catch (e: unknown) {
			if (!(e instanceof ExitError)) throw e;
		}

		expect(readCalled).toBe(false);
		expect(out.join('')).toBe('8.8.8\n');
	});

	it('fills description from data into help via execute()', async () => {
		const app = cli('myapp').manifest({ description: 'Manifest data desc' }).command(infoCommand());

		const result = await app.execute(['--help']);

		expect(result.stdout.join('')).toContain('Manifest data desc');
	});

	it('explicit .version() before .manifest(data) wins', async () => {
		const app = cli('myapp').version('9.9.9').manifest({ version: '1.1.1' }).command(infoCommand());

		const result = await app.execute(['--version']);

		expect(result.stdout.join('')).toBe('9.9.9\n');
	});

	it('explicit .description() wins over data description', async () => {
		const app = cli('myapp')
			.description('Explicit desc')
			.manifest({ description: 'Data desc' })
			.command(infoCommand());

		const result = await app.execute(['--help']);

		expect(result.stdout.join('')).toContain('Explicit desc');
		expect(result.stdout.join('')).not.toContain('Data desc');
	});

	it('does NOT infer name from data even when name/bin present', async () => {
		const app = cli('placeholder')
			.manifest({ name: '@scope/my-tool', bin: { 'my-tool': './dist/cli.js' } })
			.command(infoCommand());

		expect(app.schema.packageJsonSettings?.inferName).toBe(false);

		const result = await app.execute(['--help']);
		expect(result.stdout.join('')).toContain('placeholder');
		expect(result.stdout.join('')).not.toContain('my-tool');
	});
});
