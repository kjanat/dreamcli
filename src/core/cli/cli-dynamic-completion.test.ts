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

	it.each([
		['--verbose', 'deploy', '--name', 'wi'],
		['-v', 'd', '--name', 'wi'],
		['--profile=prod', 'deploy', '--name', 'wi'],
	])('matches execution with leading command flags: %j', async (...argv) => {
		const app = cli('app').command(
			command('deploy')
				.alias('d')
				.flag('verbose', flag.boolean().alias('v'))
				.flag('profile', flag.string())
				.flag(
					'name',
					flag.string().complete(() => ['widget']),
				)
				.action(({ flags, out }) => out.log(String(flags.name))),
		);
		expect((await app.execute([...argv.slice(0, -1), 'widget'])).stdout).toEqual(['widget\n']);
		expect((await app.execute(['__complete', ...argv])).stdout).toEqual(['widget\n']);
	});

	it('uses parent flag arity when descending through nested aliases', async () => {
		let context: CompletionContext | undefined;
		const app = cli('app').command(
			group('repo')
				.alias('r')
				.flag('profile', flag.string().propagate())
				.command(
					command('deploy')
						.alias('d')
						.flag('verbose', flag.boolean())
						.flag(
							'name',
							flag.string().complete((value) => {
								context = value;
								return ['widget'];
							}),
						)
						.action(({ flags, out }) => {
							expect(flags).toMatchObject({ profile: 'd' });
							out.log(String(flags.name));
						}),
				),
		);
		const argv = ['r', '--profile', 'd', '--verbose', 'd', '--name', 'wi'];
		expect((await app.execute([...argv.slice(0, -1), 'widget'])).stdout).toEqual(['widget\n']);
		expect((await app.execute(['__complete', ...argv])).stdout).toEqual(['widget\n']);
		expect(context?.commandPath).toEqual(['repo', 'deploy']);
		expect(context?.argv).toEqual(argv);
	});

	it('completes a pending flag on a group that still needs a subcommand', async () => {
		const app = cli('app').command(
			group('repo')
				.flag(
					'profile',
					flag.string().complete(() => ['main']),
				)
				.command(command('deploy')),
		);
		expect((await app.execute(['__complete', 'repo', '--profile', 'ma'])).stdout).toEqual([
			'main\n',
		]);
	});

	it('uses default-command flag arity before selecting a named command', async () => {
		const app = cli('app')
			.default(command('default').flag('profile', flag.string()))
			.command(
				command('deploy')
					.flag('profile', flag.string())
					.flag(
						'name',
						flag.string().complete(() => ['widget']),
					)
					.action(({ flags, out }) => out.log(String(flags.name))),
			);
		const argv = ['--profile', 'deploy', 'deploy', '--name', 'wi'];
		expect((await app.execute([...argv.slice(0, -1), 'widget'])).stdout).toEqual(['widget\n']);
		expect((await app.execute(['__complete', ...argv])).stdout).toEqual(['widget\n']);
	});

	it('rejects unknown leading flags and unrecognized root value operands', async () => {
		const app = cli('app').command(
			command('deploy')
				.flag('profile', flag.string())
				.flag('name', flag.string().complete(unexpected))
				.action(unexpected),
		);
		for (const argv of [
			['--unknown', 'deploy', '--name', 'wi'],
			['--profile', 'prod', 'deploy', '--name', 'wi'],
		]) {
			expect((await app.execute([...argv.slice(0, -1), 'widget'])).exitCode).not.toBe(0);
			expect((await app.execute(['__complete', ...argv])).exitCode).toBe(1);
		}
	});

	it('preserves the separator left by command dispatch', async () => {
		const app = cli('app').command(
			command('deploy')
				.flag('name', flag.string().complete(unexpected))
				.arg(
					'target',
					arg.string().complete(() => ['--name=widget']),
				)
				.action(({ args, out }) => out.log(args.target)),
		);
		const argv = ['--', 'deploy', '--name=wi'];
		expect((await app.execute(['--', 'deploy', '--name=widget'])).stdout).toEqual([
			'--name=widget\n',
		]);
		expect((await app.execute(['__complete', '--', ...argv])).stdout).toEqual(['--name=widget\n']);
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

	it.each([false, true])('hides default callbacks at the root when routed=%s', async (route) => {
		let calls = 0;
		const app = cli('app').default(
			command('secret')
				.hidden()
				.arg(
					'value',
					arg.string().complete(() => {
						calls++;
						return ['secret-value'];
					}),
				)
				.flag(
					'name',
					flag.string().complete(() => {
						calls++;
						return ['secret-value'];
					}),
				),
			{ route },
		);
		for (const argv of [['se'], ['--name', 'se'], ['--name=se'], ['--', 'se']]) {
			const result = await app.execute(['__complete', '--', ...argv]);
			expect(result.exitCode).toBe(1);
			expect(result.stdout).toEqual([]);
		}
		expect(calls).toBe(0);
	});

	it.each([['--config=/cfg.json'], ['--config', '/cfg.json']])(
		'normalizes framework config arguments %j without I/O',
		async (...configArgv) => {
			let context: CompletionContext | undefined;
			const app = cli('app')
				.config('custom-app-name')
				.command(
					command('deploy')
						.flag('profile', flag.string())
						.flag(
							'name',
							flag.string().complete((value) => {
								context = value;
								return ['widget'];
							}),
						),
				);
			for (const argv of [
				[...configArgv, 'deploy', '--name', 'wi'],
				['deploy', ...configArgv, '--json', '--name', 'wi'],
				['deploy', '--profile', ...configArgv, 'prod', '--name', 'wi'],
			]) {
				expect((await app.execute(['__complete', '--', ...argv])).stdout).toEqual(['widget\n']);
				expect(context?.argv).toEqual(argv);
				const stdout: string[] = [];
				const adapter = createTestAdapter({
					argv: ['node', 'app.ts', '__complete', '--', ...argv],
					stdout: (value) => stdout.push(value),
					readFile: unexpected,
					stdin: unexpected,
				});
				await expect(app.run({ adapter })).rejects.toMatchObject({ code: 0 });
				expect(stdout).toEqual(['widget\n']);
				expect(context?.argv).toEqual(argv);
			}
		},
	);

	it('leaves incomplete and repeated framework config flags to normal scanning', async () => {
		let calls = 0;
		const app = cli('app')
			.config('app')
			.default(
				command('default').arg(
					'value',
					arg.string().complete(() => {
						calls++;
						return ['widget'];
					}),
				),
			);
		for (const argv of [
			['--config', 'wi'],
			['--config=wi'],
			['--config=first.json', '--config=second.json', 'wi'],
		]) {
			expect((await app.execute(['__complete', '--', ...argv])).exitCode).toBe(1);
		}
		expect(calls).toBe(0);
	});

	it('allows callbacks after an explicitly typed hidden default route', async () => {
		const app = cli('app').default(
			command('secret')
				.hidden()
				.arg(
					'value',
					arg.string().complete(() => ['secret-value']),
				),
			{ route: true },
		);
		expect((await app.execute(['__complete', '--', 'secret', 'se'])).stdout).toEqual([
			'secret-value\n',
		]);
	});

	it('preserves application config flags when framework config is disabled', async () => {
		const app = cli('app').default(
			command('default')
				.flag(
					'config',
					flag.string().complete(() => ['config.json']),
				)
				.flag(
					'name',
					flag.string().complete(() => ['widget']),
				),
		);
		expect((await app.execute(['__complete', '--', '--config=co'])).stdout).toEqual([
			'--config=config.json\n',
		]);
		for (const argv of [
			['--config=file.json', '--name', 'wi'],
			['--config', 'file.json', '--name', 'wi'],
		]) {
			expect((await app.execute(['__complete', '--', ...argv])).stdout).toEqual(['widget\n']);
		}
	});

	it('keeps literal config tokens after the application separator', async () => {
		const app = cli('app')
			.config('app')
			.default(
				command('default').arg(
					'values',
					arg
						.string()
						.variadic()
						.complete(() => ['widget']),
				),
			);
		expect(
			(await app.execute(['__complete', '--', '--', '--config', 'file.json', 'wi'])).stdout,
		).toEqual(['widget\n']);
	});

	it('preserves named command completion over default positional callbacks', async () => {
		const app = cli('app')
			.default(
				command('default').arg(
					'value',
					arg.string().complete(() => ['other', 'demo']),
				),
			)
			.command(command('deploy').alias('publish'));
		expect((await app.execute(['__complete', '--', 'de'])).stdout).toEqual(['deploy\n', 'demo\n']);
		expect((await app.execute(['__complete', '--', 'pub'])).stdout).toEqual(['publish\n']);
		expect((await app.execute(['__complete', '--', ''])).stdout).toEqual([
			'deploy\n',
			'publish\n',
			'other\n',
			'demo\n',
		]);
		expect((await app.execute(['__complete', '--', 'ot'])).stdout).toEqual(['other\n']);
	});

	it('preserves nested command names alongside positional completions', async () => {
		const app = cli('app').command(
			command('repo')
				.arg(
					'value',
					arg.string().complete(() => ['detail']),
				)
				.action(() => {})
				.command(command('deploy').alias('publish'))
				.command(command('debug').hidden()),
		);
		expect((await app.execute(['__complete', '--', 'repo', 'de'])).stdout).toEqual([
			'deploy\n',
			'detail\n',
		]);
		expect((await app.execute(['__complete', '--', 'repo', 'pub'])).stdout).toEqual(['publish\n']);
		expect((await app.execute(['__complete', '--', 'repo', '--', 'de'])).stdout).toEqual([
			'detail\n',
		]);
	});

	it.each([false, true])(
		'includes the default command route only when routed=%s',
		async (route) => {
			const app = cli('app')
				.default(
					command('deploy')
						.alias('push')
						.arg(
							'value',
							arg.string().complete(() => ['detail']),
						),
					{ route },
				)
				.command(command('debug').hidden());
			expect((await app.execute(['__complete', '--', 'de'])).stdout).toEqual(
				route ? ['deploy\n', 'detail\n'] : ['detail\n'],
			);
			expect((await app.execute(['__complete', '--', 'pu'])).stdout).toEqual(
				route ? ['push\n'] : [],
			);
		},
	);

	it('strips root output flags before consuming command operands', async () => {
		let context: CompletionContext | undefined;
		const app = cli('app').command(
			command('deploy')
				.flag('profile', flag.string())
				.flag(
					'name',
					flag.string().complete((value) => {
						context = value;
						return ['widget'];
					}),
				),
		);
		for (const rootFlag of ['--json', '--quiet', '-q', '--json=false']) {
			const argv = ['deploy', '--profile', rootFlag, 'prod', '--name', 'wi'];
			expect((await app.execute(['__complete', '--', ...argv])).stdout).toEqual(['widget\n']);
			expect(context?.argv).toEqual(argv);
		}
	});

	it('completes inline boolean and count values without consuming following args', async () => {
		const app = cli('app').default(
			command('default')
				.flag(
					'enabled',
					flag.boolean().complete(() => ['false']),
				)
				.flag(
					'count',
					flag.count().complete(() => ['12']),
				)
				.arg(
					'value',
					arg.string().complete(() => ['widget']),
				),
		);
		expect((await app.execute(['__complete', '--', '--enabled=f'])).stdout).toEqual([
			'--enabled=false\n',
		]);
		expect((await app.execute(['__complete', '--', '--count=1'])).stdout).toEqual(['--count=12\n']);
		for (const token of ['--enabled', '--count']) {
			expect((await app.execute(['__complete', '--', token, 'wi'])).stdout).toEqual(['widget\n']);
		}
	});

	it.each([undefined, 'disabled'])(
		'keeps negated boolean spellings presence-only with alias=%s',
		async (alias) => {
			let calls = 0;
			const app = cli('app').default(
				command('default')
					.flag(
						'enabled',
						flag
							.boolean()
							.alias('active')
							.negatable(alias === undefined ? undefined : { alias })
							.complete(() => {
								calls++;
								return ['false'];
							}),
					)
					.arg(
						'value',
						arg.string().complete(() => ['widget']),
					)
					.action(({ flags, out }) => out.log(String(flags.enabled))),
			);
			for (const name of ['enabled', 'active']) {
				expect((await app.execute([`--${name}=false`, 'widget'])).stdout).toEqual(['false\n']);
				expect((await app.execute(['__complete', '--', `--${name}=f`])).stdout).toEqual([
					`--${name}=false\n`,
				]);
			}
			const negated = alias ?? 'no-enabled';
			expect((await app.execute([`--${negated}=false`, 'widget'])).exitCode).not.toBe(0);
			const callsBefore = calls;
			expect((await app.execute(['__complete', '--', `--${negated}=f`])).exitCode).toBe(1);
			expect((await app.execute(['__complete', '--', `--${negated}=false`, 'wi'])).exitCode).toBe(
				1,
			);
			expect(calls).toBe(callsBefore);
			expect((await app.execute(['__complete', '--', `--${negated}`, 'wi'])).stdout).toEqual([
				'widget\n',
			]);
		},
	);

	it.each([false, true])(
		'separates protocol options from application flags with valueOnly=%s',
		async (valueOnly) => {
			const app = cli('app').default(
				command('default').flag(
					'value-only',
					flag.string().complete(() => ['widget']),
				),
			);
			const request = [
				'__complete',
				...(valueOnly ? ['--value-only'] : []),
				'--',
				'--value-only=wi',
			];
			const expected = valueOnly ? 'widget\n' : '--value-only=widget\n';
			expect((await app.execute(request)).stdout).toEqual([expected]);
			expect((await app.execute(['__complete', '--value-only', 'wi'])).stdout).toEqual([
				'widget\n',
			]);
			const stdout: string[] = [];
			const adapter = createTestAdapter({
				argv: ['node', 'app.ts', ...request],
				stdout: (text) => stdout.push(text),
			});
			await expect(app.run({ adapter })).rejects.toMatchObject({ code: 0 });
			expect(stdout).toEqual([expected]);
		},
	);

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
			const script = generateCompletion(fixture().schema, shell);
			if (shell === 'powershell') {
				expect(script).toContain("$dynamicArgs.Add('__complete')");
				expect(script).toContain("$dynamicArgs.Add('--')");
			} else {
				expect(script).toContain(
					shell === 'fish' ? '__complete --value-only -- ' : '__complete -- ',
				);
			}
			expect(
				generateCompletion(cli('plain').command(command('ordinary')).schema, shell),
			).not.toContain('__complete');
		},
	);
});
