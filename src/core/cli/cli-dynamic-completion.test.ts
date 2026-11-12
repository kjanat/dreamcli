/** Tests for runtime value completion without command execution. */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { generateCompletion } from '#internals/core/completion/index.ts';
import { generateSchema } from '#internals/core/json-schema/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command, group } from '#internals/core/schema/command.ts';
import type { CompletionContext } from '#internals/core/schema/completion.ts';
import { createFlagSchema, flag } from '#internals/core/schema/flag.ts';
import { middleware } from '#internals/core/schema/middleware.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { cli } from './index.ts';

const unexpected = () => {
	throw new Error('Normal execution must not run');
};

function fixture() {
	return cli('app').command(
		command('adopt')
			.alias('a')
			.flag(
				'packageName',
				flag
					.string()
					.alias('p')
					.complete(async ({ prefix }) => {
						expectTypeOf(prefix).toEqualTypeOf<string>();
						return ['widget', 'widget tools', 'other'];
					}),
			)
			.flag('verbose', flag.boolean().alias('v'))
			.flag('required', flag.string().required())
			.arg(
				'target',
				arg.string().complete(() => ['server', 'staging']),
			)
			.arg(
				'rest',
				arg
					.string()
					.variadic()
					.optional()
					.complete(() => ['extra', 'extended']),
			)
			.middleware(middleware(unexpected))
			.action(unexpected),
	);
}

describe('dynamic value completion', () => {
	it.each([
		['adopt', '--packageName', 'wi'],
		['a', '--package-name', 'wi'],
		['adopt', '-p', 'wi'],
		['adopt', '-vp', 'wi'],
	])('completes a flag from %j', async (...argv) => {
		const result = await fixture().execute(['__complete', ...argv]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['widget\n', 'widget tools\n']);
		expect(result.stderr).toEqual([]);
	});

	it.each([
		['--packageName=wi', '--packageName=widget\n'],
		['-pwi', '-pwidget\n'],
		['-vpwi', '-vpwidget\n'],
	])('preserves the inline spelling %s', async (token, first) => {
		const result = await fixture().execute(['__complete', 'adopt', token]);
		expect(result.stdout[0]).toBe(first);
	});

	it('counts positionals while skipping flag operands', async () => {
		const result = await fixture().execute(['__complete', 'adopt', '-p', 'widget', 'st']);
		expect(result.stdout).toEqual(['staging\n']);
	});

	it('completes variadic args after the separator and previous values', async () => {
		const result = await fixture().execute(['__complete', 'adopt', '--', 'server', 'first', 'ex']);
		expect(result.stdout).toEqual(['extra\n', 'extended\n']);
	});

	it('passes canonical path, input, partial argv, and supplied env', async () => {
		let context: CompletionContext | undefined;
		const app = cli('app').command(
			group('repo')
				.alias('r')
				.flag(
					'account',
					flag
						.string()
						.propagate()
						.complete((value) => {
							context = value;
							return ['main'];
						}),
				)
				.command(command('list').alias('ls').action(unexpected)),
		);
		const argv = ['r', 'ls', '--account', 'ma'];
		const result = await app.execute(['__complete', ...argv], { env: { ACCOUNT: 'main' } });
		expect(result.stdout).toEqual(['main\n']);
		expect(context).toEqual({
			prefix: 'ma',
			commandPath: ['repo', 'list'],
			input: { kind: 'flag', name: 'account' },
			argv,
			env: { ACCOUNT: 'main' },
		});
	});

	it('completes the default command without a command token', async () => {
		const app = cli('app').default(
			command('default')
				.arg(
					'package',
					arg.string().complete(() => ['widget']),
				)
				.action(unexpected),
		);
		expect((await app.execute(['__complete', 'wi'])).stdout).toEqual(['widget\n']);
	});

	it('excludes stdin-only inputs from callback dispatch and positional numbering', async () => {
		const app = cli('app').command(
			command('secret')
				.flag(
					'value',
					flag.string().stdin({ argv: false, consume: 'broadcast' }).complete(unexpected),
				)
				.arg(
					'hidden',
					arg.string().stdin({ argv: false, consume: 'broadcast' }).complete(unexpected),
				)
				.arg(
					'target',
					arg.string().complete(() => ['server']),
				),
		);
		expect((await app.execute(['__complete', 'secret', '--value', ''])).exitCode).toBe(1);
		expect((await app.execute(['__complete', 'secret', 'se'])).stdout).toEqual(['server\n']);
	});

	it('ignores enabled builtins before and after a command', async () => {
		const result = await fixture().execute([
			'__complete',
			'--json',
			'-q',
			'adopt',
			'--quiet=false',
			'--packageName',
			'wi',
		]);
		expect(result.stdout).toEqual(['widget\n', 'widget tools\n']);
	});

	it('honors released builtins as ordinary value flags', async () => {
		const app = cli('app')
			.builtins({ json: 'off' })
			.default(
				command('default').flag(
					'json',
					flag.string().complete(() => ['file.json']),
				),
			);
		expect((await app.execute(['__complete', '--json', 'fi'])).stdout).toEqual(['file.json\n']);
	});

	it('honors execution-specific flag spelling settings', async () => {
		const result = await fixture().execute(['__complete', 'adopt', '--package-name', 'wi'], {
			flags: { caseParity: false },
		});
		expect(result.exitCode).toBe(1);
	});

	it('only accepts the default command name when routed', async () => {
		const definition = command('default').flag(
			'name',
			flag.string().complete(() => ['widget']),
		);
		const hiddenRoute = cli('app').default(definition);
		const visibleRoute = cli('app').default(definition, { route: true });
		expect((await hiddenRoute.execute(['__complete', '--name', 'wi'])).stdout).toEqual([
			'widget\n',
		]);
		expect((await visibleRoute.execute(['__complete', 'default', '--name', 'wi'])).stdout).toEqual([
			'widget\n',
		]);
		expect((await hiddenRoute.execute(['__complete', 'default', '--name', 'wi'])).exitCode).toBe(1);
	});

	it('returns status 1 when static completion should handle the input', async () => {
		for (const argv of [[], ['adopt', '--package'], ['adopt', '--required', ''], ['unknown', '']]) {
			const result = await fixture().execute(['__complete', ...argv]);
			expect(result.exitCode).toBe(1);
			expect(result.stdout).toEqual([]);
			expect(result.stderr).toEqual([]);
		}
	});

	it('keeps callback failures silent and does not fall back to unrelated candidates', async () => {
		const app = cli('app').default(
			command('default').arg('value', arg.string().complete(unexpected)),
		);
		const result = await app.execute(['__complete', '']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([]);
		expect(result.stderr).toEqual([]);
	});

	it('filters by prefix, removes duplicates and rejects control characters', async () => {
		const app = cli('app').default(
			command('default').arg(
				'value',
				arg
					.string()
					.complete(() => [
						'ok',
						'ok',
						'ok space',
						'other',
						'ok\nextra',
						'ok\tlabel',
						'ok\x1b[31m',
						'',
						'ok$(command)',
					]),
			),
		);
		expect((await app.execute(['__complete', 'ok'])).stdout).toEqual([
			'ok\n',
			'ok space\n',
			'ok$(command)\n',
		]);
	});

	it('bypasses config discovery, stdin, prompts and actions in run()', async () => {
		const stdout: string[] = [];
		const adapter = createTestAdapter({
			argv: ['node', 'app.ts', '__complete', 'adopt', '--packageName', 'wi'],
			stdout: (text) => stdout.push(text),
			stderr: unexpected,
			readFile: unexpected,
			stdin: unexpected,
		});
		await expect(fixture().config('app').run({ adapter })).rejects.toMatchObject({ code: 0 });
		expect(stdout).toEqual(['widget\n', 'widget tools\n']);
	});

	it('omits callbacks from definition JSON', () => {
		const document = generateSchema(fixture().schema);
		expect(document.commands[0]?.flags.packageName).not.toHaveProperty('completion');
		expect(document.commands[0]?.args[0]).not.toHaveProperty('completion');
	});

	it('preserves callback metadata through definition normalization', async () => {
		const callback = () => ['widget'];
		expect(createFlagSchema('string', { completion: callback }).completion).toBe(callback);
	});

	it('reserves the internal route and its aliases', () => {
		expect(() => cli('app').command(command('__complete'))).toThrow('reserved');
		expect(() => cli('app').command(command('ordinary').alias('__complete'))).toThrow('reserved');
	});

	it.each(['bash', 'zsh', 'fish', 'powershell'] as const)(
		'adds runtime dispatch to %s only when a callback exists',
		(shell) => {
			expect(generateCompletion(fixture().schema, shell)).toContain('__complete');
			expect(
				generateCompletion(cli('plain').command(command('ordinary')).schema, shell),
			).not.toContain('__complete');
		},
	);
});
