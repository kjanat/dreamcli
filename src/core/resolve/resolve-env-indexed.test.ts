/**
 * Indexed env families end to end: acquisition, precedence, diagnostics,
 * provenance, redaction, and help.
 *
 * Every test injects an environment snapshot, so nothing depends on the host
 * process environment or its key order.
 *
 * @module dreamcli/core/resolve/resolve-env-indexed.test
 */

import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { readIndexedEnv } from './indexed-env.ts';

// === helpers

/** Minimal hand-rolled Standard Schema validator — no external dependency. */
function standard<Output>(
	validate: StandardSchemaV1<unknown, Output>['~standard']['validate'],
): StandardSchemaV1<unknown, Output> {
	return { '~standard': { version: 1, vendor: 'test', validate } };
}

interface ConfigEntry {
	readonly key: string;
	readonly value: string;
}

/** Accepts one `{ key, value }` record of strings with a non-empty key. */
const configEntry = standard<ConfigEntry>((raw) => {
	if (typeof raw !== 'object' || raw === null)
		return { issues: [{ message: 'expected a record' }] };
	const { key, value } = raw as Record<string, unknown>;
	if (typeof key !== 'string' || key === '') {
		return { issues: [{ message: 'expected a non-empty key', path: ['key'] }] };
	}
	if (typeof value !== 'string')
		return { issues: [{ message: 'expected a string', path: ['value'] }] };
	return { value: { key, value } };
});

/** Accepts a whole list of `{ key, value }` records. */
const configEntries = standard<readonly ConfigEntry[]>((raw) => {
	if (!Array.isArray(raw)) return { issues: [{ message: 'expected a list' }] };
	const entries: ConfigEntry[] = [];
	for (const [index, entry] of raw.entries()) {
		const result = configEntry['~standard'].validate(entry);
		if (result instanceof Promise) throw new Error('unexpected async validator');
		if (result.issues !== undefined) {
			return {
				issues: result.issues.map((issue) => ({
					message: issue.message,
					path: [index, ...(issue.path ?? [])],
				})),
			};
		}
		entries.push(result.value);
	}
	return { value: entries };
});

const GIT_CONFIG = {
	count: 'GIT_CONFIG_COUNT',
	fields: { key: 'GIT_CONFIG_KEY_{index}', value: 'GIT_CONFIG_VALUE_{index}' },
} as const;

const servers = command('servers')
	.flag(
		'servers',
		flag
			.array(flag.string())
			.env({ count: 'SERVER_COUNT', value: 'SERVER_{index}' })
			.config('servers')
			.default(['default.example']),
	)
	.action(({ flags, sources, out }) => {
		out.json({ servers: flags.servers, source: sources.flags.servers });
	});

async function serversWith(
	env: Record<string, string>,
	options: { readonly argv?: readonly string[]; readonly config?: Record<string, unknown> } = {},
) {
	const result = await runCommand(servers, options.argv ?? [], {
		env,
		...(options.config !== undefined ? { config: options.config } : {}),
	});
	const stdout = result.stdout.join('');
	return {
		result,
		output:
			stdout === ''
				? undefined
				: (JSON.parse(stdout) as { servers: readonly string[]; source: unknown }),
	};
}

// === acquisition

describe('readIndexedEnv()', () => {
	const values = { count: 'N', value: 'V_{index}' } as const;

	it('treats an unset count as an absent source', () => {
		expect(readIndexedEnv(values, { V_0: 'stray' })).toEqual({ kind: 'absent' });
	});

	it('enumerates exactly 0..count-1 and ignores other members', () => {
		expect(readIndexedEnv(values, { N: '2', V_0: 'a', V_1: 'b', V_2: 'ignored' })).toEqual({
			kind: 'entries',
			countVar: 'N',
			entries: [
				{ index: 0, raw: 'a', envVars: ['V_0'] },
				{ index: 1, raw: 'b', envVars: ['V_1'] },
			],
		});
	});

	it.each(['-1', '1.5', 'abc', '', ' 2', '2 ', '+2', '02', '1e3', '0x2'])(
		'rejects the non-canonical count %j',
		(raw) => {
			expect(readIndexedEnv(values, { N: raw })).toEqual({
				kind: 'fault',
				fault: { kind: 'count', countVar: 'N', raw },
			});
		},
	);

	it('rejects a count above the limit without reading any member', () => {
		expect(readIndexedEnv(values, { N: '10001' })).toEqual({
			kind: 'fault',
			fault: { kind: 'limit', countVar: 'N', raw: '10001', max: 10_000 },
		});
		expect(readIndexedEnv(values, { N: '99999999999999999999999' })).toMatchObject({
			kind: 'fault',
			fault: { kind: 'limit' },
		});
		expect(readIndexedEnv(values, { N: '10000' })).toMatchObject({
			kind: 'fault',
			fault: { kind: 'member', envVar: 'V_0' },
		});
	});

	it('does not read inherited Object.prototype members as variables', () => {
		const binding = { count: 'constructor', value: 'toString_{index}' } as const;
		expect(readIndexedEnv(binding, {})).toEqual({ kind: 'absent' });
		expect(readIndexedEnv({ count: 'N', value: '__proto__{index}' }, { N: '1' })).toMatchObject({
			kind: 'fault',
			fault: { kind: 'member', envVar: '__proto__0' },
		});
	});

	it('keeps a field named __proto__ as an own key of the record', () => {
		const read = readIndexedEnv(
			{ count: 'N', fields: { ['__proto__']: 'P_{index}' } },
			{ N: '1', P_0: 'x' },
		);
		if (read.kind !== 'entries') throw new Error('expected entries');
		const record = read.entries[0]?.raw as Record<string, string>;

		expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
		expect(Object.hasOwn(record, '__proto__')).toBe(true);
	});
});

// === scalar families

describe('an indexed value family', () => {
	it('reads every entry in index order, empty strings included', async () => {
		const { output } = await serversWith({
			SERVER_COUNT: '3',
			SERVER_0: 'a.example',
			SERVER_1: '',
			SERVER_2: 'c.example',
		});

		expect(output).toEqual({
			servers: ['a.example', '', 'c.example'],
			source: {
				stage: 'env',
				via: 'indexed',
				count: 'SERVER_COUNT',
				envVars: ['SERVER_0', 'SERVER_1', 'SERVER_2'],
			},
		});
	});

	it('resolves COUNT=0 to an explicit empty list that beats config and the default', async () => {
		const { output } = await serversWith(
			{ SERVER_COUNT: '0' },
			{ config: { servers: ['config.example'] } },
		);

		expect(output).toEqual({
			servers: [],
			source: { stage: 'env', via: 'indexed', count: 'SERVER_COUNT', envVars: [] },
		});
	});

	it('falls through to config, then the default, when the count is unset', async () => {
		const fromConfig = await serversWith(
			{ SERVER_0: 'stray.example' },
			{ config: { servers: ['config.example'] } },
		);
		const fromDefault = await serversWith({ SERVER_0: 'stray.example' });

		expect(fromConfig.output).toEqual({
			servers: ['config.example'],
			source: { stage: 'config', configPath: 'servers' },
		});
		expect(fromDefault.output).toEqual({
			servers: ['default.example'],
			source: { stage: 'default' },
		});
	});

	it('loses to a CLI value', async () => {
		const { output } = await serversWith(
			{ SERVER_COUNT: '1', SERVER_0: 'env.example' },
			{ argv: ['--servers', 'cli.example'] },
		);
		expect(output).toEqual({ servers: ['cli.example'], source: { stage: 'cli' } });
	});

	it.each([['-1'], ['1.5'], ['abc']])(
		'stops at a malformed count %j instead of falling through to config',
		async (count) => {
			const { result, output } = await serversWith(
				{ SERVER_COUNT: count },
				{ config: { servers: ['config.example'] } },
			);

			expect(output).toBeUndefined();
			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('TYPE_MISMATCH');
			expect(result.error?.message).toBe(
				`Invalid indexed env count '${count}' from env SERVER_COUNT for flag --servers`,
			);
			expect(result.error?.details).toEqual({
				flag: 'servers',
				source: 'env',
				envVar: 'SERVER_COUNT',
				value: count,
				expected: 'count',
			});
		},
	);

	it('rejects a count above the limit as a constraint violation', async () => {
		const { result } = await serversWith({ SERVER_COUNT: '10001' });

		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe(
			"Indexed env count '10001' from env SERVER_COUNT for flag --servers exceeds the limit of 10000",
		);
		expect(result.error?.details).toMatchObject({ constraint: 'maxCount', max: 10_000 });
	});

	it('names the first missing member, at index 0 and at a later index', async () => {
		const first = await serversWith({ SERVER_COUNT: '2' });
		const later = await serversWith(
			{ SERVER_COUNT: '3', SERVER_0: 'a', SERVER_1: 'b' },
			{ config: { servers: ['config.example'] } },
		);

		expect(first.result.error?.message).toBe(
			'Env SERVER_COUNT declares 2 entries for flag --servers, but SERVER_0 is not set',
		);
		expect(later.output).toBeUndefined();
		expect(later.result.error?.message).toBe(
			'Env SERVER_COUNT declares 3 entries for flag --servers, but SERVER_2 is not set',
		);
		expect(later.result.error?.suggest).toBe('Set SERVER_2, or set SERVER_COUNT to 2');
		expect(later.result.error?.details).toEqual({
			flag: 'servers',
			source: 'env',
			envVar: 'SERVER_2',
			countVar: 'SERVER_COUNT',
			count: 3,
			index: 2,
			constraint: 'indexedMember',
		});
	});

	it('decodes each entry through the element and names the failing variable', async () => {
		const cmd = command('ports')
			.flag(
				'ports',
				flag.array(flag.number({ int: true })).env({ count: 'PORT_COUNT', value: 'PORT_{index}' }),
			)
			.action(({ flags, out }) => out.json(flags.ports));

		const ok = await runCommand(cmd, [], { env: { PORT_COUNT: '2', PORT_0: '80', PORT_1: '443' } });
		const bad = await runCommand(cmd, [], { env: { PORT_COUNT: '2', PORT_0: '80', PORT_1: 'x' } });

		expect(JSON.parse(ok.stdout.join(''))).toEqual([80, 443]);
		expect(bad.error?.code).toBe('TYPE_MISMATCH');
		expect(bad.error?.message).toBe("Invalid number value 'x' from env PORT_1 for flag --ports");
		expect(bad.error?.suggest).toBe('Set PORT_1 to a valid number');
	});

	it('hands an empty member to the element, whose constraints decide', async () => {
		const cmd = command('tags')
			.flag(
				'tags',
				flag.array(flag.string().nonEmpty()).env({ count: 'TAG_COUNT', value: 'TAG_{index}' }),
			)
			.action(() => {});

		const result = await runCommand(cmd, [], { env: { TAG_COUNT: '2', TAG_0: 'a', TAG_1: '' } });

		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toContain('from env TAG_1 for flag --tags');
	});

	it('applies unique after reading, keeping first-seen order', async () => {
		const cmd = command('tags')
			.flag(
				'tags',
				flag.array(flag.string()).unique().env({ count: 'TAG_COUNT', value: 'TAG_{index}' }),
			)
			.action(({ flags, out }) => out.json(flags.tags));

		const result = await runCommand(cmd, [], {
			env: { TAG_COUNT: '3', TAG_0: 'b', TAG_1: 'a', TAG_2: 'b' },
		});
		expect(JSON.parse(result.stdout.join(''))).toEqual(['b', 'a']);
	});

	it('hands the whole list to a custom flag', async () => {
		let received: unknown;
		const cmd = command('raw')
			.flag(
				'items',
				flag
					.custom((raw: unknown) => {
						received = raw;
						return raw;
					})
					.env({ count: 'ITEM_COUNT', value: 'ITEM_{index}' }),
			)
			.action(() => {});

		await runCommand(cmd, [], { env: { ITEM_COUNT: '2', ITEM_0: 'x', ITEM_1: 'y' } });
		expect(received).toEqual(['x', 'y']);
	});
});

// === record families

describe('an indexed record family', () => {
	const gitConfig = command('git')
		.flag('config', flag.custom(configEntries).env(GIT_CONFIG).default([]))
		.action(({ flags, sources, out }) =>
			out.json({ config: flags.config, source: sources.flags.config }),
		);

	it('correlates fields by index into one record per entry', async () => {
		const result = await runCommand(gitConfig, [], {
			env: {
				GIT_CONFIG_COUNT: '2',
				GIT_CONFIG_KEY_0: 'user.name',
				GIT_CONFIG_VALUE_0: 'Kaj',
				GIT_CONFIG_KEY_1: 'user.email',
				GIT_CONFIG_VALUE_1: 'kaj@example.com',
			},
		});

		expect(JSON.parse(result.stdout.join(''))).toEqual({
			config: [
				{ key: 'user.name', value: 'Kaj' },
				{ key: 'user.email', value: 'kaj@example.com' },
			],
			source: {
				stage: 'env',
				via: 'indexed',
				count: 'GIT_CONFIG_COUNT',
				envVars: [
					'GIT_CONFIG_KEY_0',
					'GIT_CONFIG_VALUE_0',
					'GIT_CONFIG_KEY_1',
					'GIT_CONFIG_VALUE_1',
				],
			},
		});
	});

	it('names the missing field variable and the field it belongs to', async () => {
		const result = await runCommand(gitConfig, [], {
			env: {
				GIT_CONFIG_COUNT: '2',
				GIT_CONFIG_KEY_0: 'a',
				GIT_CONFIG_VALUE_0: '1',
				GIT_CONFIG_KEY_1: 'b',
			},
		});

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toBe(
			'Env GIT_CONFIG_COUNT declares 2 entries for flag --config, but GIT_CONFIG_VALUE_1 is not set',
		);
		expect(result.error?.details).toMatchObject({ index: 1, field: 'value' });
	});

	it('reports a whole-collection Standard Schema failure with the issue path', async () => {
		const result = await runCommand(gitConfig, [], {
			env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: '', GIT_CONFIG_VALUE_0: 'x' },
		});

		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe(
			'--config failed validation: 0.key: expected a non-empty key',
		);
	});

	it('decodes each record through a custom element, naming the entry that failed', async () => {
		const parsed = command('git')
			.flag(
				'config',
				flag
					.array(
						flag.custom((raw: unknown) => {
							const record = raw as Record<string, string>;
							if (record.key === '') throw new Error('empty key');
							return record;
						}),
					)
					.env(GIT_CONFIG),
			)
			.action(({ flags, out }) => out.json(flags.config));

		const result = await runCommand(parsed, [], {
			env: {
				GIT_CONFIG_COUNT: '2',
				GIT_CONFIG_KEY_0: 'a',
				GIT_CONFIG_VALUE_0: '1',
				GIT_CONFIG_KEY_1: '',
				GIT_CONFIG_VALUE_1: '2',
			},
		});

		expect(result.error?.code).toBe('TYPE_MISMATCH');
		expect(result.error?.message).toContain(
			'env GIT_CONFIG_KEY_1 and GIT_CONFIG_VALUE_1 for flag --config',
		);
		expect(result.error?.details).toMatchObject({
			source: 'env',
			countVar: 'GIT_CONFIG_COUNT',
			index: 1,
			envVars: ['GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1'],
		});
	});

	it('reads three or more fields per record', async () => {
		const cmd = command('remotes')
			.flag(
				'remotes',
				flag.array(flag.custom((raw: unknown) => raw)).env({
					count: 'REMOTE_COUNT',
					fields: {
						name: 'REMOTE_NAME_{index}',
						url: 'REMOTE_URL_{index}',
						push: 'REMOTE_PUSH_{index}',
					},
				}),
			)
			.action(({ flags, out }) => out.json(flags.remotes));

		const result = await runCommand(cmd, [], {
			env: {
				REMOTE_COUNT: '1',
				REMOTE_NAME_0: 'origin',
				REMOTE_URL_0: 'git@example:x',
				REMOTE_PUSH_0: '',
			},
		});
		expect(JSON.parse(result.stdout.join(''))).toEqual([
			{ name: 'origin', url: 'git@example:x', push: '' },
		]);
	});

	it('beats a non-empty default with COUNT=0', async () => {
		const cmd = command('git')
			.flag(
				'config',
				flag
					.custom(configEntries)
					.env(GIT_CONFIG)
					.default([{ key: 'a', value: 'b' }]),
			)
			.action(({ flags, out }) => out.json(flags.config));

		const result = await runCommand(cmd, [], { env: { GIT_CONFIG_COUNT: '0' } });
		expect(JSON.parse(result.stdout.join(''))).toEqual([]);
	});
});

// === args

describe('an indexed family on an arg', () => {
	it('fills a variadic arg, each entry decoded by the arg kind', async () => {
		const cmd = command('sum')
			.arg('nums', arg.number().variadic().env({ count: 'NUM_COUNT', value: 'NUM_{index}' }))
			.action(({ args, sources, out }) => out.json({ nums: args.nums, source: sources.args.nums }));

		const ok = await runCommand(cmd, [], { env: { NUM_COUNT: '2', NUM_0: '1', NUM_1: '2' } });
		const bad = await runCommand(cmd, [], { env: { NUM_COUNT: '1', NUM_0: 'one' } });

		expect(JSON.parse(ok.stdout.join(''))).toEqual({
			nums: [1, 2],
			source: { stage: 'env', via: 'indexed', count: 'NUM_COUNT', envVars: ['NUM_0', 'NUM_1'] },
		});
		expect(bad.error?.message).toBe(
			"Invalid number value 'one' from env NUM_0 for argument <nums>",
		);
	});

	it('hands records to a Standard Schema custom arg and words faults for the arg', async () => {
		const cmd = command('git')
			.arg('config', arg.custom(configEntries).env(GIT_CONFIG))
			.action(({ args, out }) => out.json(args.config));

		const ok = await runCommand(cmd, [], {
			env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'k', GIT_CONFIG_VALUE_0: 'v' },
		});
		const missing = await runCommand(cmd, [], { env: { GIT_CONFIG_COUNT: '1' } });

		expect(JSON.parse(ok.stdout.join(''))).toEqual([{ key: 'k', value: 'v' }]);
		expect(missing.error?.message).toBe(
			'Env GIT_CONFIG_COUNT declares 1 entry for argument <config>, but GIT_CONFIG_KEY_0 is not set',
		);
		expect(missing.error?.details).toMatchObject({ arg: 'config', envVar: 'GIT_CONFIG_KEY_0' });
	});

	it('suggests setting the count when a required arg has no source', async () => {
		const cmd = command('git')
			.arg('config', arg.custom(configEntries).env(GIT_CONFIG))
			.action(() => {});

		const result = await runCommand(cmd, [], { env: {} });
		expect(result.error?.code).toBe('REQUIRED_ARG');
		expect(result.error?.suggest).toContain('set GIT_CONFIG_COUNT and its entries');
	});
});

// === diagnostics around the family

describe('indexed env diagnostics', () => {
	it('suggests setting the count when a required flag has no source', async () => {
		const cmd = command('git')
			.flag('config', flag.custom(configEntries).env(GIT_CONFIG).required())
			.action(() => {});

		const result = await runCommand(cmd, [], { env: {} });

		expect(result.error?.code).toBe('REQUIRED_FLAG');
		expect(result.error?.suggest).toBe(
			'Provide --config <value> or set GIT_CONFIG_COUNT and its entries',
		);
		expect(result.error?.details).toMatchObject({ envIndexed: GIT_CONFIG });
	});

	it('labels each issue of an aggregate with the variable to fix', async () => {
		const cmd = command('both')
			.flag('a', flag.array(flag.string()).env({ count: 'A_COUNT', value: 'A_{index}' }))
			.flag('b', flag.array(flag.number()).env({ count: 'B_COUNT', value: 'B_{index}' }))
			.action(() => {});

		const result = await runCommand(cmd, [], { env: { A_COUNT: '1', B_COUNT: '1', B_0: 'x' } });

		expect(result.error?.message).toContain('flag --a [env A_0]: Env A_COUNT declares 1 entry');
		expect(result.error?.message).toContain("flag --b [env B_0]: Invalid number value 'x'");
	});

	it('redacts the count and every member value of a sensitive input', async () => {
		const cmd = command('secrets')
			.flag(
				'tokens',
				flag.array(flag.number()).env({ count: 'TOKEN_COUNT', value: 'TOKEN_{index}' }).sensitive(),
			)
			.action(() => {});

		const badCount = await runCommand(cmd, [], { env: { TOKEN_COUNT: 'secret-count' } });
		const badMember = await runCommand(cmd, [], {
			env: { TOKEN_COUNT: '1', TOKEN_0: 'sk-live-1' },
		});

		for (const result of [badCount, badMember]) {
			const text = JSON.stringify({
				message: result.error?.message,
				details: result.error?.details,
				stderr: result.stderr,
			});
			expect(result.exitCode).toBe(2);
			expect(text).not.toContain('secret-count');
			expect(text).not.toContain('sk-live-1');
		}
		expect(badMember.error?.message).toContain('from env TOKEN_0');
	});

	it('warns for a deprecated input the family supplied', async () => {
		const cmd = command('old')
			.flag(
				'hosts',
				flag
					.array(flag.string())
					.env({ count: 'HOST_COUNT', value: 'HOST_{index}' })
					.deprecated('use --servers'),
			)
			.action(() => {});

		const supplied = await runCommand(cmd, [], { env: { HOST_COUNT: '0' } });
		const absent = await runCommand(cmd, [], { env: {} });

		expect(supplied.stderr.join('')).toContain('deprecated');
		expect(absent.stderr).toEqual([]);
	});
});

// === help and execution surfaces

describe('indexed env bindings in help and CLI execution', () => {
	it('renders the templates and the count, not a single variable', async () => {
		const app = cli('demo').command(
			command('sync')
				.flag('config', flag.custom(configEntries).env(GIT_CONFIG))
				.arg('files', arg.string().variadic().env({ count: 'FILE_COUNT', value: 'FILE_{index}' }))
				.action(() => {}),
		);

		const help = (await app.execute(['sync', '--help'], { help: { width: 200 } })).stdout.join('');

		expect(help).toContain(
			'[env: GIT_CONFIG_KEY_{index} + GIT_CONFIG_VALUE_{index}, count: GIT_CONFIG_COUNT]',
		);
		expect(help).toContain('[env: FILE_{index}, count: FILE_COUNT]');
	});

	it('resolves the same way through .execute() as through runCommand()', async () => {
		const app = cli('demo').command(servers);
		const env = { SERVER_COUNT: '1', SERVER_0: 'x.example' };

		const viaCli = await app.execute(['servers'], { env });
		const viaTestkit = await runCommand(servers, [], { env });

		expect(viaCli.stdout).toEqual(viaTestkit.stdout);
		expect(JSON.parse(viaCli.stdout.join(''))).toMatchObject({ servers: ['x.example'] });
	});
});
