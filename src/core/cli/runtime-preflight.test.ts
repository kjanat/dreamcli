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
import { cli, compiledStateOf } from './index.ts';
import { extractConfigFlag, prepareRuntimePreflight } from './runtime-preflight.ts';

describe('runtime-preflight — extractConfigFlag', () => {
	it('strips equals-form config flags', () => {
		expect(extractConfigFlag(['deploy', '--config=/tmp/app.json', '--json'])).toEqual({
			configPath: '/tmp/app.json',
			filteredArgv: ['deploy', '--json'],
		});
	});

	it('does not consume another flag as spaced config value', () => {
		expect(extractConfigFlag(['deploy', '--config', '--json'])).toEqual({
			configPath: undefined,
			filteredArgv: ['deploy', '--config', '--json'],
		});
	});

	it('stops parsing config flags after option terminator', () => {
		expect(extractConfigFlag(['deploy', '--', '--config=/tmp/app.json'])).toEqual({
			configPath: undefined,
			filteredArgv: ['deploy', '--', '--config=/tmp/app.json'],
		});
	});

	it('strips spaced-form config only when value is a positional token', () => {
		expect(extractConfigFlag(['deploy', '--config', '/tmp/app.json', '--json'])).toEqual({
			configPath: '/tmp/app.json',
			filteredArgv: ['deploy', '--json'],
		});
	});
});

describe('runtime-preflight — prepareRuntimePreflight', () => {
	it('loads config and package metadata before execution', async () => {
		const app = cli('fallback')
			.config('myapp')
			.manifest({ inferName: true })
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
			compiled: compiledStateOf(app),
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

	it('uses pre-loaded manifest data and skips package.json discovery', async () => {
		const readFile = vi.fn(async () => null);
		const app = cli('myapp')
			.manifest({ version: '4.4.4', description: 'pre-loaded' })
			.command(command('info').action(() => {}));

		const adapter = createTestAdapter({ argv: ['node', 'test', 'info'], readFile });

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.schema.version).toBe('4.4.4');
		expect(preflight.schema.description).toBe('pre-loaded');
		expect(readFile).not.toHaveBeenCalled();
	});

	it('honors the manifest anchor when discovering metadata', async () => {
		const app = cli('myapp')
			.manifest({ from: '/anchor' })
			.command(command('info').action(() => {}));

		const adapter = createTestAdapter({
			argv: ['node', 'test', 'info'],
			cwd: '/work',
			readFile: async (path) => (path === '/anchor/package.json' ? '{"version":"5.5.5"}' : null),
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.schema.version).toBe('5.5.5');
	});

	it('reports a discovered version that shadows a command flag as a startup error', async () => {
		const app = cli('myapp')
			.manifest()
			.command(
				command('info')
					.flag('version', flag.boolean())
					.action(() => {}),
			);
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'info'],
			readFile: async (path) => (path === '/test/package.json' ? '{"version":"5.5.5"}' : null),
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});
		expect(preflight.kind).toBe('startup-error');
		if (preflight.kind !== 'startup-error') return;
		expect(preflight.error.code).toBe('RESERVED_FLAG');
		expect(preflight.error.message).toMatch(/reserved by the root '--version' flag/);
		expect(preflight.error.suggest).toBe('Rename the flag');
		expect(preflight.jsonMode).toBe(false);
	});

	it('leaves a discovered version alone when no command flag collides', async () => {
		const app = cli('myapp')
			.manifest()
			.command(
				command('info')
					.flag('versionTag', flag.string())
					.action(() => {}),
			);

		const adapter = createTestAdapter({
			argv: ['node', 'test', 'info'],
			cwd: '/work',
			readFile: async (path) => (path === '/work/package.json' ? '{"version":"6.6.6"}' : null),
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.schema.version).toBe('6.6.6');
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
			compiled: compiledStateOf(app),
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
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.stdinData).toBe('piped data');
	});

	it('reads stdin for a stdin arg named after an Object.prototype member', async () => {
		const app = cli('myapp').command(
			command('echo')
				.arg('toString', arg.string().stdin())
				.action(() => {}),
		);
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'echo'],
			stdinData: 'piped data',
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.stdinData).toBe('piped data');
	});

	it('leaves stdin unread when such an arg already has a positional', async () => {
		const app = cli('myapp').command(
			command('echo')
				.arg('toString', arg.string().stdin())
				.action(() => {}),
		);
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'echo', 'from-argv'],
			stdinData: 'piped data',
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.stdinData).toBeUndefined();
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
			compiled: compiledStateOf(app),
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
			compiled: compiledStateOf(app),
			adapter: interactiveAdapter,
			options: undefined,
			inheritedName: undefined,
		});
		const piped = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
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

	it('returns startup-error outcomes for CLI config failures', async () => {
		const app = cli('myapp')
			.config('myapp')
			.command(command('deploy').action(() => {}));
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy', '--json'],
			readFile: async () => '{not valid json',
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('startup-error');
		if (preflight.kind !== 'startup-error') return;
		expect(preflight.jsonMode).toBe(true);
		expect(preflight.error.code).toBe('CONFIG_PARSE_ERROR');
	});

	it('does not strip --config when CLI config discovery is disabled', async () => {
		const app = cli('myapp').command(
			command('deploy')
				.flag('config', flag.string())
				.action(() => {}),
		);
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy', '--config', 'local.json'],
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.filteredArgv).toEqual(['deploy', '--config', 'local.json']);
	});

	it('keeps malformed --config token and still enables --json mode', async () => {
		const app = cli('myapp')
			.config('myapp')
			.command(command('deploy').action(() => {}));
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy', '--config', '--json'],
			readFile: async () => null,
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.filteredArgv).toEqual(['deploy', '--config', '--json']);
		expect(preflight.inputs.jsonMode).toBe(true);
	});

	it('does not treat a user-defined completions command as built-in completions', async () => {
		const app = cli('myapp')
			.config('myapp')
			.command(command('completions').action(() => {}));
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'completions'],
			readFile: async (path) => (path === '/test/.myapp.json' ? '{"region":"eu"}' : null),
		});

		const preflight = await prepareRuntimePreflight({
			schema: app.schema,
			compiled: compiledStateOf(app),
			adapter,
			options: undefined,
			inheritedName: undefined,
		});

		expect(preflight.kind).toBe('ready');
		if (preflight.kind !== 'ready') return;
		expect(preflight.inputs.config).toEqual({ region: 'eu' });
	});
});
