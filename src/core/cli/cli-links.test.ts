/**
 * Integration tests for OSC 8 hyperlinks in the root-help header.
 *
 * Tests the .links() builder method, TTY gating, derivation from
 * package.json metadata (repository/homepage, discovery and pre-loaded
 * data), and that escapes never leak outside the header line.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { osc8 } from '#internals/core/help/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { cli } from './index.ts';
import { formatRootHelp } from './root-help.ts';

// === Test helpers

const ESC = '\u001B';
const REPO = 'https://github.com/me/mytool';

/** Command with a description for the commands table. */
function deployCommand() {
	return command('deploy')
		.description('Deploy the app')
		.action(({ out }) => {
			out.log('deployed');
		});
}

/** Helper: run app via .run() with adapter, capture stdout/stderr. */
async function runWithAdapter(
	app: ReturnType<typeof cli>,
	argv: readonly string[],
	options?: {
		readonly files?: Readonly<Record<string, string>>;
		readonly isTTY?: boolean;
	},
): Promise<{ stdout: string[]; stderr: string[]; exitCode: number }> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	let exitCode = 0;

	const adapter = createTestAdapter({
		argv: ['node', 'test', ...argv],
		stdout: (s) => stdoutLines.push(s),
		stderr: (s) => stderrLines.push(s),
		readFile: async (path: string) => options?.files?.[path] ?? null,
		...(options?.isTTY !== undefined ? { isTTY: options.isTTY } : {}),
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

// === CLIBuilder.links() — builder method

describe('CLIBuilder.links() — builder method', () => {
	it('returns a new CLIBuilder (immutability)', () => {
		const a = cli('mytool');
		const b = a.links();
		expect(a).not.toBe(b);
		expect(a.schema.helpLinks).toBeUndefined();
		expect(b.schema.helpLinks).toBeDefined();
	});

	it('stores explicit URLs', () => {
		const app = cli('mytool').links({ name: REPO, version: `${REPO}/releases/tag/v1.0.0` });
		expect(app.schema.helpLinks).toEqual({
			name: REPO,
			version: `${REPO}/releases/tag/v1.0.0`,
		});
	});

	it('normalizes URL instances to strings', () => {
		const app = cli('mytool').links({ name: new URL(REPO) });
		expect(app.schema.helpLinks?.name).toBe(REPO);
	});

	it('stores undefined fields when called without arguments (derive later)', () => {
		const app = cli('mytool').links();
		expect(app.schema.helpLinks).toEqual({ name: undefined, version: undefined });
	});

	it('helpLinks is undefined when .links() not called', () => {
		expect(cli('mytool').schema.helpLinks).toBeUndefined();
	});
});

// === Root help — explicit links via execute()

describe('root help — explicit links', () => {
	it('wraps name and version in OSC 8 hyperlinks when TTY', async () => {
		const app = cli('mytool')
			.version('1.0.0')
			.links({ name: REPO, version: `${REPO}/releases/tag/v1.0.0` })
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v1.0.0`, 'v1.0.0')}`,
		);
	});

	it('keeps usage line, hint, and commands table plain', async () => {
		const app = cli('mytool')
			.version('1.0.0')
			.links({ name: REPO, version: `${REPO}/releases/tag/v1.0.0` })
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).toContain('Usage: mytool <command> [options]');
		expect(output).toContain("Run 'mytool <command> --help' for more information.");
		// Escapes appear in the header line only
		const [header, ...rest] = output.split('\n');
		expect(header).toContain(ESC);
		expect(rest.join('\n')).not.toContain(ESC);
	});

	it('emits no escapes when stdout is not a TTY (default)', async () => {
		const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

		const result = await app.execute(['--help']);

		const output = result.stdout.join('');
		expect(output).not.toContain(ESC);
		expect(output).toContain('mytool v1.0.0');
	});

	it('help.hyperlinks option forces links without TTY', async () => {
		const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

		const result = await app.execute(['--help'], { help: { hyperlinks: true } });

		expect(result.stdout.join('')).toContain(osc8(REPO, 'mytool'));
	});

	it('help.hyperlinks: false suppresses links on a TTY', async () => {
		const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true, help: { hyperlinks: false } });

		expect(result.stdout.join('')).not.toContain(ESC);
	});

	describe('environment overrides', () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it('NO_HYPERLINKS suppresses header links on a TTY', async () => {
			vi.stubEnv('NO_HYPERLINKS', '1');
			const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

			const result = await app.execute(['--help'], { isTTY: true });

			expect(result.stdout.join('')).not.toContain(ESC);
		});

		it('FORCE_HYPERLINKS emits header links without a TTY', async () => {
			vi.stubEnv('FORCE_HYPERLINKS', '1');
			const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

			const result = await app.execute(['--help']);

			expect(result.stdout.join('')).toContain(osc8(REPO, 'mytool'));
		});
	});

	it('links only the name when no version URL is configured', async () => {
		const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		expect(result.stdout.join('')).toContain(`${osc8(REPO, 'mytool')} v1.0.0`);
	});

	it('--version output stays plain', async () => {
		const app = cli('mytool')
			.version('1.0.0')
			.links({ name: REPO, version: `${REPO}/releases/tag/v1.0.0` })
			.command(deployCommand());

		const result = await app.execute(['--version'], { isTTY: true });

		expect(result.stdout.join('')).toBe('1.0.0\n');
	});
});

// === Root help — links derived from package.json data

describe('root help — links derived from .packageJson(data)', () => {
	it('derives name from repository and version from the GitHub release tag', async () => {
		const app = cli('mytool')
			.packageJson({ version: '2.5.0', repository: `git+${REPO}.git` })
			.links()
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v2.5.0`, 'v2.5.0')}`,
		);
	});

	it('derives links when .links() is called before .packageJson(data)', async () => {
		const app = cli('mytool')
			.links()
			.packageJson({ version: '2.5.0', repository: REPO })
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		expect(result.stdout.join('')).toContain(osc8(REPO, 'mytool'));
	});

	it('falls back to homepage for the name when no repository exists', async () => {
		const app = cli('mytool')
			.packageJson({ version: '1.0.0', homepage: 'https://mytool.dev' })
			.links()
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).toContain(osc8('https://mytool.dev', 'mytool'));
		// No repository → no derived release link
		expect(output).toContain(' v1.0.0');
	});

	it('uses the GitLab release route for gitlab.com repositories', async () => {
		const repo = 'https://gitlab.com/me/mytool';
		const app = cli('mytool')
			.packageJson({ version: '1.0.0', repository: `git+${repo}.git` })
			.links()
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		expect(result.stdout.join('')).toContain(osc8(`${repo}/-/releases/v1.0.0`, 'v1.0.0'));
	});

	it('explicit URLs win over derived ones', async () => {
		const app = cli('mytool')
			.packageJson({ version: '1.0.0', repository: REPO, homepage: 'https://mytool.dev' })
			.links({ name: 'https://docs.mytool.dev' })
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).toContain(osc8('https://docs.mytool.dev', 'mytool'));
		expect(output).toContain(osc8(`${REPO}/releases/tag/v1.0.0`, 'v1.0.0'));
	});

	it('explicit .version() is used for the derived release tag', async () => {
		const app = cli('mytool')
			.version('9.9.9')
			.packageJson({ version: '1.0.0', repository: REPO })
			.links()
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		expect(result.stdout.join('')).toContain(osc8(`${REPO}/releases/tag/v9.9.9`, 'v9.9.9'));
	});

	it('renders a plain header when package.json has no link metadata', async () => {
		const app = cli('mytool').packageJson({ version: '1.0.0' }).links().command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).not.toContain(ESC);
		expect(output).toContain('mytool v1.0.0');
	});
});

// === Root help — links derived via .run() discovery

describe('root help — links derived from package.json discovery in .run()', () => {
	const files = {
		'/test/package.json': JSON.stringify({
			version: '3.0.0',
			repository: { type: 'git', url: `git+${REPO}.git` },
		}),
	};

	it('derives links from the discovered package.json on a TTY', async () => {
		const app = cli('mytool').packageJson().links().command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], { files, isTTY: true });

		const output = stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v3.0.0`, 'v3.0.0')}`,
		);
	});

	it('stays plain when stdout is not a TTY', async () => {
		const app = cli('mytool').packageJson().links().command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], { files });

		const output = stdout.join('');
		expect(output).not.toContain(ESC);
		expect(output).toContain('mytool v3.0.0');
	});

	it('explicit links work in .run() without .packageJson()', async () => {
		const app = cli('mytool').version('1.0.0').links({ name: REPO }).command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], { isTTY: true });

		expect(stdout.join('')).toContain(osc8(REPO, 'mytool'));
	});
});

// === Root help — links derived from deno.json / jsr.json manifests

describe('root help — links derived from deno.json / jsr.json discovery in .run()', () => {
	it('derives name + release link from a discovered deno.json on a TTY', async () => {
		const app = cli('mytool').denoJson().links().command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			files: {
				'/test/deno.json': JSON.stringify({
					version: '3.0.0',
					repository: { type: 'git', url: `git+${REPO}.git` },
				}),
			},
			isTTY: true,
		});

		const output = stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v3.0.0`, 'v3.0.0')}`,
		);
	});

	it('derives links from jsr.json when deno.json is absent', async () => {
		const app = cli('mytool').denoJson().links().command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			files: {
				'/test/jsr.json': JSON.stringify({ version: '4.1.0', repository: `git+${REPO}.git` }),
			},
			isTTY: true,
		});

		const output = stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v4.1.0`, 'v4.1.0')}`,
		);
	});

	it('surfaces the repository link from a deno.json carrying only repository', async () => {
		// manifestHasMetadata accepts a repository-only manifest; prove that link
		// reaches the header end-to-end (no version → name link only, no release).
		const app = cli('mytool').denoJson().links().command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			files: { '/test/deno.json': JSON.stringify({ repository: `git+${REPO}.git` }) },
			isTTY: true,
		});

		const output = stdout.join('');
		expect(output).toContain(osc8(REPO, 'mytool'));
		// No version → no release/tag hyperlink may slip into the header.
		expect(output).not.toContain('/releases/tag/');
	});

	it('.manifest({ files }) discovery derives links the same way', async () => {
		const app = cli('mytool')
			.manifest({ files: ['deno.json', 'jsr.json'] })
			.links()
			.command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			files: { '/test/jsr.json': JSON.stringify({ version: '2.0.0', repository: REPO }) },
			isTTY: true,
		});

		expect(stdout.join('')).toContain(osc8(`${REPO}/releases/tag/v2.0.0`, 'v2.0.0'));
	});

	it('derives links from jsr.json when a sibling deno.json is config-only', async () => {
		// Marquee Deno shape: config-only deno.json (tasks/imports, no metadata) must
		// NOT shadow jsr.json for the help-link channel — links come from jsr.json.
		const app = cli('mytool').denoJson().links().command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			files: {
				'/test/deno.json': JSON.stringify({ tasks: { dev: 'vite' }, imports: {} }),
				'/test/jsr.json': JSON.stringify({ version: '5.0.0', repository: `git+${REPO}.git` }),
			},
			isTTY: true,
		});

		const output = stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v5.0.0`, 'v5.0.0')}`,
		);
	});

	it('uses the inferred (scope-kept) name as the link display text', async () => {
		// inferName + .links() together: the OSC-8 name link's display text is the
		// inferred schema name, so scope:'keep' must surface the scoped name in the link.
		const app = cli('placeholder')
			.denoJson({ inferName: { scope: 'keep' } })
			.links()
			.command(deployCommand());

		const { stdout } = await runWithAdapter(app, ['--help'], {
			files: {
				'/test/deno.json': JSON.stringify({
					name: '@scope/realtool',
					version: '6.0.0',
					repository: `git+${REPO}.git`,
				}),
			},
			isTTY: true,
		});

		const output = stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, '@scope/realtool')} ${osc8(`${REPO}/releases/tag/v6.0.0`, 'v6.0.0')}`,
		);
		expect(output).not.toContain('placeholder');
	});
});

describe('root help — links derived from .denoJson(data)', () => {
	it('derives name from repository and version from the release tag', async () => {
		const app = cli('mytool')
			.denoJson({ version: '2.5.0', repository: `git+${REPO}.git` })
			.links()
			.command(deployCommand());

		const result = await app.execute(['--help'], { isTTY: true });

		const output = result.stdout.join('');
		expect(output).toContain(
			`${osc8(REPO, 'mytool')} ${osc8(`${REPO}/releases/tag/v2.5.0`, 'v2.5.0')}`,
		);
	});
});

// === formatRootHelp — hyperlinks option

describe('formatRootHelp — hyperlinks option', () => {
	it('emits links only when hyperlinks is enabled', () => {
		const app = cli('mytool').version('1.0.0').links({ name: REPO });

		expect(formatRootHelp(app.schema)).not.toContain(ESC);
		expect(formatRootHelp(app.schema, { hyperlinks: true })).toContain(osc8(REPO, 'mytool'));
	});

	it('links the name alone when no version is configured', () => {
		const app = cli('mytool').links({ name: REPO });

		const help = formatRootHelp(app.schema, { hyperlinks: true });
		expect(help.startsWith(`${osc8(REPO, 'mytool')}\n`)).toBe(true);
	});
});
