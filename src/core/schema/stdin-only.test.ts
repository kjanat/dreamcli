/**
 * Stdin inputs without command-line forms.
 * @module dreamcli/core/schema/stdin-only.test
 */
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { generateCompletion } from '#internals/core/completion/index.ts';
import { formatHelp } from '#internals/core/help/index.ts';
import { generateCommandSchema } from '#internals/core/json-schema/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { readFlags } from '#internals/core/read-flags/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import { arg } from './arg.ts';
import { command, createCommandSchema } from './command.ts';
import { flag } from './flag.ts';
import { sourceBindings } from './source.ts';

const secret = () => flag.string().stdin({ argv: false, trim: true }).sensitive().required();

describe('stdin-only inputs', () => {
	it('reads piped values through execute, runCommand, and readFlags', async () => {
		const cmd = command('set')
			.flag('value', secret())
			.action(({ flags, out }) => out.log(flags.value));
		const options = { stdinData: 'piped\n', env: {} };
		expect((await cli('secrets').command(cmd).execute(['set'], options)).stdout).toEqual([
			'piped\n',
		]);
		expect((await runCommand(cmd, [], options)).stdout).toEqual(['piped\n']);
		expect(await readFlags({ value: secret() }, { ...options, argv: [] })).toEqual({
			value: 'piped',
		});
	});

	it.each(['--secret-value', '--secretValue', '--old-name', '-s'])('rejects %s', (spelling) => {
		const schema = command('set').flag('secretValue', secret().alias('s').alias('old-name')).schema;
		expect(() => parse(schema, [spelling, 'argv'])).toThrow(
			expect.objectContaining({ code: 'UNKNOWN_FLAG' }),
		);
	});

	it('removes negated forms and their aliases', () => {
		const schema = command('set').flag(
			'enabled',
			flag.boolean().negatable().stdin({ argv: false }),
		).schema;
		expect(() => parse(schema, ['--no-enabled'])).toThrow(
			expect.objectContaining({ code: 'UNKNOWN_FLAG' }),
		);
	});

	it('keeps argv positions around a stdin-only argument', async () => {
		const cmd = command('set')
			.arg('first', arg.string())
			.arg('value', arg.string().stdin({ argv: false }))
			.arg('last', arg.string())
			.action(({ args, out }) => out.json(args));
		const result = await runCommand(cmd, ['a', 'b'], { stdinData: 'piped' });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.join(''))).toEqual({ first: 'a', value: 'piped', last: 'b' });
		expect(() => parse(cmd.schema, ['a', 'b', 'c'])).toThrow(
			expect.objectContaining({ code: 'UNEXPECTED_POSITIONAL' }),
		);
	});

	it('allows argv arguments after stdin-only variadics and vice versa', async () => {
		for (const cmd of [
			command('set')
				.arg('value', arg.string().variadic().stdin({ argv: false }))
				.arg('name', arg.string()),
			command('set')
				.arg('name', arg.string().variadic())
				.arg('value', arg.string().stdin({ argv: false })),
		]) {
			const result = await resolve(cmd.schema, parse(cmd.schema, ['key']), { stdinData: 'piped' });
			expect(result.args.value).toEqual(
				cmd.schema.args.find((entry) => entry.name === 'value')?.schema.variadic
					? ['piped']
					: 'piped',
			);
		}
	});

	it('omits argv forms from help and all completion scripts', () => {
		const cmd = command('set')
			.flag(
				'secretValue',
				secret().stdin({ argv: false, consume: 'broadcast' }).alias('secret-alias'),
			)
			.arg('secretArg', arg.string().stdin({ argv: false, consume: 'broadcast' }));
		const help = formatHelp(cmd.schema);
		expect(help).toBe('Usage: set\n');
		const app = cli('tool').default(cmd);
		for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
			const script = generateCompletion(app.schema, shell);
			expect(script).not.toContain('secretValue');
			expect(script).not.toContain('secret-alias');
			expect(script).not.toContain('secretArg');
		}
	});

	it('preserves other sources and omits the CLI resolution stage', async () => {
		const value = secret().env('SECRET').config('secret').default('fallback');
		const schema = command('set').flag('value', value).schema;
		expect(sourceBindings(value.schema).map((binding) => binding.stage)).toEqual([
			'stdin',
			'env',
			'config',
			'default',
		]);
		for (const [options, expected] of [
			[{ stdinData: 'piped', env: { SECRET: 'env' }, config: { secret: 'config' } }, 'piped'],
			[{ env: { SECRET: 'env' }, config: { secret: 'config' } }, 'env'],
			[{ config: { secret: 'config' } }, 'config'],
			[{}, 'fallback'],
		] as const) {
			const result = await resolve(schema, parse(schema, []), options);
			expect(result.flags.value).toBe(expected);
		}
		const result = await resolve(
			schema,
			{ ...parse(schema, []), flags: { value: 'injected' } },
			{ stdinData: 'piped' },
		);
		expect(result.flags.value).toBe('piped');
	});

	it('suggests stdin when a required input is missing', async () => {
		const cmd = command('set')
			.flag('value', secret())
			.action(() => {});
		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Pipe a value to stdin');
		expect(result.stderr.join('')).not.toContain('Provide --value');
		expect(result.stderr.join('')).not.toContain('pass --value -');
	});

	it('reads propagated stdin-only flags once through a runtime adapter', async () => {
		const seen: unknown[] = [];
		const cmd = command('secrets')
			.flag('value', secret().propagate())
			.command(
				command('set').action(({ flags }) => {
					seen.push(flags);
				}),
			);
		const app = cli('tool').command(cmd);
		const base = createTestAdapter({
			argv: ['node', 'cli', 'secrets', 'set'],
			stdinData: 'piped\n',
		});
		let reads = 0;
		try {
			await app.run({
				adapter: {
					...base,
					readStdin: () => {
						reads++;
						return base.readStdin();
					},
				},
			});
		} catch (error) {
			if (!(error instanceof ExitError)) throw error;
		}
		expect(reads).toBe(1);
		expect(seen).toEqual([{ value: 'piped' }]);
	});

	it('allows disabled spellings to share aliases and built-in names', async () => {
		const cmd = command('set')
			.flag('help', flag.string().stdin({ argv: false }).alias('value'))
			.flag('value', flag.string())
			.action(({ flags, out }) => out.json(flags));
		const result = await cli('tool')
			.command(cmd)
			.execute(['set', '--value', 'argv'], { stdinData: 'piped' });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.join(''))).toEqual({ help: 'piped', value: 'argv' });
		expect(() =>
			cli('tool')
				.completions({ as: 'flag' })
				.command(command('set').flag('completions', flag.string().stdin({ argv: false }))),
		).not.toThrow();
	});

	it('keeps argv enabled by default and when explicitly true', () => {
		for (const value of [flag.string().stdin(), flag.string().stdin({ argv: true })]) {
			const schema = command('set').flag('value', value).schema;
			expect(parse(schema, ['--value', 'argv']).flags).toEqual({ value: 'argv' });
		}
	});

	it('round-trips the argv setting in definition documents', () => {
		const schema = command('set').flag('value', secret()).schema;
		const fragment = generateCommandSchema(schema);
		expect(fragment.flags.value?.stdin).toEqual({
			when: 'dash-or-missing',
			consume: 'exclusive',
			trim: true,
			argv: false,
		});
		const restored = createCommandSchema({
			name: 'set',
			flags: { value: { kind: 'string', stdin: fragment.flags.value?.stdin } },
		});
		expect(restored.flags.value?.stdin).toEqual(schema.flags.value?.stdin);
		expect(() => parse(restored, ['--value', 'argv'])).toThrow();
	});

	it('rejects unreachable dash-only bindings and invalid argv settings', () => {
		expect(() => flag.string().stdin({ argv: false, when: 'dash' })).toThrow(
			"Stdin mode 'dash' requires a command-line form",
		);
		expect(() => arg.string().stdin({ argv: false, when: 'dash' })).toThrow(
			"Stdin mode 'dash' requires a command-line form",
		);
		// @ts-expect-error Invalid runtime callers must be rejected too.
		expect(() => flag.string().stdin({ argv: 'false' })).toThrow('Stdin argv must be a boolean');
	});
});
