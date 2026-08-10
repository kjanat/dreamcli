/**
 * Tests for the compiled execution graph: schema identity with the public
 * schema tree, absence of builder retention, alias route indexing, and
 * sibling route conflict detection.
 */
import { describe, expect, it } from 'vitest';
import { configFormat } from '#internals/core/config/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { compileCommand } from './compiled.ts';
import { cli, compiledStateOf, createCLISchema, plugin } from './index.ts';

// === Test helpers

/** Leaf command with a handler and one derive step. */
function leaf(name: string) {
	return command(name)
		.derive(() => ({ token: 'x' }))
		.action(({ out }) => {
			out.log(name);
		});
}

// === Tests

describe('compileCommand', () => {
	it('holds the builder schema object by identity', () => {
		const cmd = leaf('deploy');

		expect(compileCommand(cmd).schema).toBe(cmd.schema);
	});

	it('holds the builder execution steps by identity', () => {
		const cmd = leaf('deploy');
		const compiled = compileCommand(cmd);

		expect(compiled.handler).toBe(cmd.handler);
		expect(compiled.steps).toBe(cmd._executionSteps);
	});

	it('retains no reference to the builder', () => {
		const compiled = compileCommand(leaf('deploy'));

		expect(Object.keys(compiled).toSorted()).toEqual(['handler', 'schema', 'steps', 'subcommands']);
	});

	it('shares subcommand schema identity with the parent schema tree', () => {
		const sub = leaf('migrate');
		const group = command('db').command(sub);
		const compiled = compileCommand(group);

		expect(compiled.subcommands.get('migrate')?.schema).toBe(sub.schema);
		expect(group.schema.commands[0]).toBe(sub.schema);
	});

	it('indexes a subcommand under its name and every alias', () => {
		const sub = leaf('migrate').alias('m').alias('mig');
		const compiled = compileCommand(command('db').command(sub));

		const byName = compiled.subcommands.get('migrate');
		expect(byName).toBeDefined();
		expect(compiled.subcommands.get('m')).toBe(byName);
		expect(compiled.subcommands.get('mig')).toBe(byName);
	});

	it('rejects two siblings claiming the same route', () => {
		const group = command('db').command(leaf('migrate')).command(leaf('seed').alias('migrate'));

		let thrown: unknown;
		try {
			compileCommand(group);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(CLIError);
		expect((thrown as CLIError).code).toBe('DUPLICATE_COMMAND');
	});

	it('reports a repeated alias as a self-collision', () => {
		const group = command('db').command(leaf('migrate').alias('migrate'));

		expect(() => compileCommand(group)).toThrow("Command 'migrate' reuses route 'migrate'");
	});
});

describe('CLISchema and the compiled graph', () => {
	it('rejects duplicate routes in plain definitions', () => {
		expect(() =>
			createCLISchema({
				name: 'mytool',
				commands: [{ name: 'deploy' }, { name: 'status', aliases: ['deploy'] }],
			}),
		).toThrow("Command route 'deploy' is already registered by 'deploy'");
	});

	it('registers the command schema object itself', () => {
		const deploy = leaf('deploy');
		const app = cli('mytool').command(deploy);

		expect(app.schema.commands[0]).toBe(deploy.schema);
	});

	it('registers the default command schema object itself', () => {
		const serve = leaf('serve');
		const app = cli('mytool').default(serve);

		expect(app.schema.defaultCommand).toBe(serve.schema);
	});

	it('keeps handlers off the schema tree', () => {
		const app = cli('mytool').command(leaf('deploy'));

		expect(Object.keys(app.schema)).not.toContain('plugins');
		expect(app.schema.commands[0]).not.toHaveProperty('handler');
		expect(app.schema.commands[0]).not.toHaveProperty('_execute');
	});

	it('stores a compiled node whose schema is the registered schema object', () => {
		const deploy = leaf('deploy');
		const app = cli('mytool').command(deploy);

		expect(compiledStateOf(app).commands[0]?.schema).toBe(app.schema.commands[0]);
	});

	it('stores a compiled default node whose schema is the registered schema object', () => {
		const serve = leaf('serve');
		const app = cli('mytool').default(serve);

		expect(compiledStateOf(app).defaultCommand?.schema).toBe(app.schema.defaultCommand);
	});

	it('stores compiled subcommand nodes whose schemas are the nested schema objects', () => {
		const app = cli('mytool').command(command('db').command(leaf('migrate')));

		const compiledDb = compiledStateOf(app).commands[0];
		expect(compiledDb?.subcommands.get('migrate')?.schema).toBe(
			app.schema.commands[0]?.commands[0],
		);
	});

	it('rebuilds carry the compiled nodes by identity', () => {
		const app = cli('mytool').command(leaf('deploy'));
		const renamed = app.version('1.0.0').description('tool');

		expect(compiledStateOf(renamed).commands[0]).toBe(compiledStateOf(app).commands[0]);
	});

	it('carries the compiled graph through every builder method', async () => {
		const initial = cli('mytool').command(leaf('deploy'));
		const compiledDeploy = compiledStateOf(initial).commands[0];
		const app = initial
			.version('1.0.0')
			.description('tool')
			.links({ name: 'https://example.com' })
			.help({ footer: false })
			.config('mytool')
			.configLoader(configFormat(['yaml'], () => ({})))
			.manifest({ version: '1.0.0' })
			.packageJson()
			.denoJson()
			.completions()
			.plugin(plugin({}))
			.default(leaf('serve'));

		const result = await app.execute(['deploy']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('deploy');
		expect(compiledStateOf(app).commands[0]).toBe(compiledDeploy);
	});
});
