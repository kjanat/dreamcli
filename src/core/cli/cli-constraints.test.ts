/** Test post-resolution constraints through the CLI's public execution paths. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { generateCompletion, SHELLS } from '#internals/core/completion/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { cli } from './index.ts';

const render = command('render')
	.flag('output', flag.string().alias('o').env('OUTPUT').default('default.ico'))
	.flag('keep-name', flag.boolean().alias('k').negatable())
	.flag('remote', flag.boolean())
	.flag('token', flag.string())
	.arg('destination', arg.string().optional())
	.constrain((c) => {
		expectTypeOf<Parameters<typeof c.flag>[0]>().toEqualTypeOf<
			'output' | 'keep-name' | 'remote' | 'token'
		>();
		expectTypeOf<Parameters<typeof c.arg>[0]>().toEqualTypeOf<'destination'>();
		return [
			c.conflicts('output', 'keep-name'),
			c.requires('remote', 'token'),
			c.allOrNone('token', c.arg('destination')),
		];
	})
	.action(({ out }) => out.log('rendered'));

describe('resolved command constraints', () => {
	it('honors explicit provenance and boolean enablement', async () => {
		expect((await runCommand(render, ['--keep-name'])).stdout).toEqual(['rendered\n']);
		expect((await runCommand(render, ['--keep-name', '--no-keep-name', '-o', 'x'])).exitCode).toBe(
			0,
		);
		expect(
			(await runCommand(render, ['--keep-name'], { env: { OUTPUT: 'selected.ico' } })).error,
		).toMatchObject({ code: 'CONFLICTING_FLAGS' });
		expect((await runCommand(render, ['--remote'])).error).toMatchObject({
			code: 'MISSING_DEPENDENT_FLAG',
		});
		expect((await runCommand(render, ['--token', 'secret'])).error).toMatchObject({
			code: 'INCOMPLETE_INPUT_GROUP',
		});
		expect((await runCommand(render, ['--remote', '--token', 'secret', 'staging'])).exitCode).toBe(
			0,
		);
	});

	it('supports required and optional exclusive groups', async () => {
		const transport = command('transport')
			.flag('stdio', flag.boolean())
			.flag('socket', flag.number().default(6009))
			.flag('fast', flag.boolean())
			.flag('safe', flag.boolean())
			.constrain((c) => [c.exactlyOne('stdio', 'socket'), c.atMostOne('fast', 'safe')])
			.action(() => {});
		expect((await runCommand(transport, [])).error?.code).toBe('EXACTLY_ONE_REQUIRED');
		expect((await runCommand(transport, ['--stdio', '--socket', '6009'])).error?.code).toBe(
			'EXACTLY_ONE_REQUIRED',
		);
		expect((await runCommand(transport, ['--stdio', '--fast', '--safe'])).error?.code).toBe(
			'CONFLICTING_FLAGS',
		);
		expect((await runCommand(transport, ['--stdio'])).exitCode).toBe(0);
	});

	it('renders relationships in text and JSON help', async () => {
		const app = cli('demo').command(render);
		const text = await app.execute(['render', '--help']);
		expect(text.stdout.join('')).toContain('--output conflicts with --keep-name');
		const json = await app.execute(['render', '--help', '--json']);
		expect(JSON.parse(json.stdout.join(''))).toHaveProperty(
			'constraints',
			render.schema.constraints,
		);
	});
});

describe('command Standard Schema validation', () => {
	it('redacts nested paths of sensitive flags and args in resolved-input validation', async () => {
		const cmd = command('prepare')
			.flag('credentials', flag.keyValue().sensitive())
			.flag('interactive', flag.string())
			.arg('secret', arg.string().sensitive())
			.interactive(() => ({ interactive: { kind: 'password', message: 'Secret' } }))
			.validate(
				{
					'~standard': {
						version: 1,
						vendor: 'test',
						validate: () => ({
							issues: [
								{ message: 'Invalid credentials', path: ['flags', 'credentials', 'private-key'] },
								{ message: 'Invalid input', path: ['args', 'secret', 'private-arg'] },
								{
									message: 'Invalid interactive input',
									path: ['flags', 'interactive', 'private-prompt'],
								},
							],
						}),
					},
				},
				{ input: 'resolved' },
			)
			.action(() => {});
		const result = await runCommand(cmd, [
			'--credentials',
			'private-key=value',
			'--interactive',
			'value',
			'argument',
			'--json',
		]);
		const output = result.stdout.join('');
		expect(output).not.toMatch(/private-(?:key|arg|prompt)/u);
		expect(JSON.parse(output)).toMatchObject({
			error: {
				code: 'COMMAND_VALIDATION_FAILED',
				details: {
					issues: [
						{ label: '--credentials', path: ['flags', 'credentials'] },
						{ label: '<secret>', path: ['args', 'secret'] },
						{ label: '--interactive', path: ['flags', 'interactive'] },
					],
				},
			},
		});
	});

	it('retains nested paths for public flags and only the name for sensitive flags', async () => {
		const cmd = command('prepare')
			.flag('credentials', flag.keyValue().sensitive())
			.flag('options', flag.keyValue())
			.validate({
				'~standard': {
					version: 1,
					vendor: 'test',
					validate: () => ({
						issues: [
							{ message: 'Invalid key', path: ['credentials', 'private-key'] },
							{ message: 'Invalid option', path: ['options', 'port'] },
						],
					}),
				},
			})
			.action(() => {});
		const result = await runCommand(cmd, ['--json']);
		expect(JSON.parse(result.stdout.join(''))).toMatchObject({
			error: { details: { issues: [{ path: ['credentials'] }, { path: ['options', 'port'] }] } },
		});
	});

	const validator: StandardSchemaV1 = {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: async (value) =>
				value !== null && typeof value === 'object' && 'target' in value && value.target === 'ok'
					? { value: { target: 'transformed' } }
					: { issues: [{ path: ['target'], message: 'Unknown target' }] },
		},
	};

	it('validates asynchronously, reports flag paths, and keeps handler input values', async () => {
		const cmd = command('prepare')
			.flag('target', flag.string())
			.validate(validator)
			.action(({ flags, out }) => out.log(flags.target ?? 'missing'));
		const bad = await runCommand(cmd, ['--target', 'invalid', '--json']);
		expect(bad.error).toMatchObject({
			code: 'COMMAND_VALIDATION_FAILED',
			message: '--target: Unknown target',
			details: { issues: [{ path: ['target'], message: 'Unknown target' }] },
		});
		expect((await runCommand(cmd, ['--target', 'ok'])).stdout).toEqual(['ok\n']);
	});

	it('can validate positional inputs and provenance before derive', async () => {
		const steps: string[] = [];
		const cmd = command('prepare')
			.arg('target', arg.string())
			.derive(() => {
				steps.push('derive');
			})
			.validate(
				{
					'~standard': {
						version: 1,
						vendor: 'test',
						validate(value) {
							expect(value).toMatchObject({
								args: { target: 'env' },
								sources: { args: { target: { stage: 'cli' } } },
							});
							steps.push('validate');
							return { value };
						},
					},
				},
				{ input: 'resolved' },
			)
			.action(() => {
				steps.push('action');
			});
		expect((await runCommand(cmd, ['env'])).exitCode).toBe(0);
		expect(steps).toEqual(['validate', 'derive', 'action']);
	});
});

describe('completion with command constraints', () => {
	const app = cli('demo').command(render);

	it.each([
		['render', '-oname.ico'],
		['render', '--output', 'name.ico'],
		['render', '--output=name.ico'],
	])('suppresses a conflicting long flag and its alias after %j %j', async (...argv) => {
		const result = await app.execute(['__complete', '--', ...argv, '-']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('--remote\n');
		expect(result.stdout).not.toContain('--keep-name\n');
		expect(result.stdout).not.toContain('-k\n');
		expect(result.stdout).toContain('--no-keep-name\n');
	});

	it('tracks clustered short flags and overrides by negation', async () => {
		const conflict = await app.execute(['__complete', '--blocked-flags', '--', 'render', '-k']);
		expect(conflict.stdout).toEqual(['output\n']);
		const disabled = await app.execute([
			'__complete',
			'--blocked-flags',
			'--',
			'render',
			'-k',
			'--no-keep-name',
		]);
		expect(disabled.stdout).toEqual([]);
	});

	it.each(SHELLS)('connects %s completion to the constraint-aware endpoint', (shell) => {
		const script = generateCompletion(app.schema, shell);
		expect(script).toContain('__complete');
		if (shell === 'fish') expect(script).toContain('__complete --blocked-flags');
	});
});
