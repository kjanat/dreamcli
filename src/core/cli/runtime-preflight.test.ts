/**
 * Focused tests for runtime preflight extraction.
 *
 * Locks down adapter-driven sourcing before CLIBuilder.run() hands off to the
 * planner and shared executor.
 */

import { describe, expect, it, vi } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter } from '#internals/runtime/index.ts';
import { cli } from './index.ts';
import { extractConfigFlag, prepareRuntimePreflight } from './runtime-preflight.ts';

describe('runtime-preflight — extractConfigFlag', () => {
	it('strips equals-form config flags', () => {
		expect(extractConfigFlag(['deploy', '--config=/tmp/app.json', '--json'])).toEqual({
			configPath: '/tmp/app.json',
			filteredArgv: ['deploy', '--json'],
		});
	});
});

describe('runtime-preflight — prepareRuntimePreflight', () => {
	it('loads config and package metadata before execution', async () => {
		const app = cli('fallback')
			.config('myapp')
			.packageJson({ inferName: true })
			.command(
				command('deploy')
					.flag('region', flag.string().config('deploy.region').default('us'))
					.action(() => {}),
			);

		const adapter = createTestAdapter({
			argv: ['node', '/work/bin/custom.js', 'deploy'],
			cwd: '/work',
			readFile: async (path) => {
				if (path === '/work/package.json') {
					return JSON.stringify({
						name: '@acme/custom',
						bin: { shipped: './bin/custom.js' },
						version: '2.3.4',
						description: 'runtime package',
					});
				}
				if (path === '/work/.myapp.json') {
					return '{"deploy":{"region":"eu"}}';
				}
				return null;
			},
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			adapter,
			options: undefined,
			inheritedName: 'custom.js',
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.schema.name).toBe('custom.js');
		expect(preflight.schema.version).toBe('2.3.4');
		expect(preflight.schema.description).toBe('runtime package');
		expect(preflight.inputs.config).toEqual({ deploy: { region: 'eu' } });
		expect(preflight.filteredArgv).toEqual(['deploy']);
	});

	it('skips config discovery for completions invocations', async () => {
		const readFile = vi.fn(async () => '{"deploy":{"region":"eu"}}');
		const app = cli('myapp').config('myapp').completions();
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'completions', 'bash'],
			readFile,
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.config).toBeUndefined();
		expect(readFile).not.toHaveBeenCalled();
	});

	it('reads stdin only when the planned invocation needs stdin', async () => {
		const app = cli('myapp').command(
			command('echo')
				.arg('input', arg.string().stdin())
				.action(() => {}),
		);
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'echo'],
			stdinData: 'piped data',
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.stdinData).toBe('piped data');
	});

	it('does not read stdin for root help despite stdin-capable commands', async () => {
		const app = cli('myapp').command(
			command('echo')
				.arg('input', arg.string().stdin())
				.action(() => {}),
		);
		const adapter = createTestAdapter({
			argv: ['node', 'test', '--help'],
			stdinData: 'piped data',
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.stdinData).toBeUndefined();
	});

	it('auto-creates a terminal prompter only for interactive stdin', async () => {
		const app = cli('myapp').command(
			command('deploy')
				.flag('region', flag.string().prompt({ kind: 'input', message: 'Region?' }))
				.action(() => {}),
		);
		const interactiveAdapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
			stdinIsTTY: true,
		});
		const pipedAdapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
			stdinIsTTY: false,
		});

		const interactive = await prepareRuntimePreflight({
			schema: app.schema,
			adapter: interactiveAdapter,
			options: undefined,
			inheritedName: undefined,
		});
		const piped = await prepareRuntimePreflight({
			schema: app.schema,
			adapter: pipedAdapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(interactive.kind).toBe('ready');
		expect(piped.kind).toBe('ready');
		if (interactive.kind !== 'ready' || piped.kind !== 'ready') return;
		expect(interactive.inputs.prompter).toBeDefined();
		expect(piped.inputs.prompter).toBeUndefined();
	});

	it('returns config-error outcomes for CLI config failures', async () => {
		const app = cli('myapp')
			.config('myapp')
			.command(command('deploy').action(() => {}));
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy', '--json'],
			readFile: async () => '{not valid json',
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('config-error');
		if (preflight.kind !== 'config-error') return;
		expect(preflight.jsonMode).toBe(true);
		expect(preflight.error.code).toBe('CONFIG_PARSE_ERROR');
	});
});
