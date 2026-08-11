/**
 * End-to-end tests for the arg kinds the cardinality axis made coherent:
 * `arg.boolean()` and `arg.keyValue()`, plus the collection surface of
 * `readFlags()` and the testkit.
 *
 * @module dreamcli/core/schema/arg-collection-kinds.test
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { generateSchema } from '#internals/core/json-schema/index.ts';
import { readFlags } from '#internals/core/read-flags/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { InferArg } from './arg.ts';
import { arg, createArgSchema } from './arg.ts';
import { command } from './command.ts';
import { flag } from './flag.ts';

// === arg.boolean()

describe('arg.boolean()', () => {
	function booleanCommand(onValue: (value: boolean) => void) {
		return command('feature')
			.arg('enabled', arg.boolean().describe('Whether the feature is on'))
			.action(({ args }) => {
				onValue(args.enabled);
			});
	}

	it('infers boolean', () => {
		const a = arg.boolean();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<boolean>();
	});

	it('consumes an explicit true token', async () => {
		let received: boolean | undefined;
		const result = await runCommand(
			booleanCommand((value) => {
				received = value;
			}),
			['true'],
		);

		expect(result.exitCode).toBe(0);
		expect(received).toBe(true);
	});

	it('consumes 0 as false', async () => {
		let received: boolean | undefined;
		const result = await runCommand(
			booleanCommand((value) => {
				received = value;
			}),
			['0'],
		);

		expect(result.exitCode).toBe(0);
		expect(received).toBe(false);
	});

	it('never takes presence for a value', async () => {
		const result = await runCommand(
			booleanCommand(() => {}),
			[],
		);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('REQUIRED_ARG');
	});

	it('rejects a token that spells no boolean', async () => {
		const result = await runCommand(
			booleanCommand(() => {}),
			['nope'],
		);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
		expect(result.error?.message).toContain('Invalid boolean value');
	});

	it('accepts the wider spellings from env', async () => {
		let received: boolean | undefined;
		const cmd = command('feature')
			.arg('enabled', arg.boolean().env('FEATURE_ENABLED'))
			.action(({ args }) => {
				received = args.enabled;
			});

		const result = await runCommand(cmd, [], { env: { FEATURE_ENABLED: 'yes' } });
		expect(result.exitCode).toBe(0);
		expect(received).toBe(true);
	});

	it('runs through .execute() the same way', async () => {
		let received: boolean | undefined;
		const app = cli('mycli').default(
			booleanCommand((value) => {
				received = value;
			}),
		);

		const result = await app.execute(['false']);
		expect(result.exitCode).toBe(0);
		expect(received).toBe(false);
	});
});

// === arg.keyValue()

describe('arg.keyValue()', () => {
	function varsCommand(onValue: (value: Record<string, string>) => void) {
		return command('run')
			.arg('vars', arg.keyValue().variadic().describe('Template variables'))
			.action(({ args }) => {
				onValue(args.vars);
			});
	}

	it('infers a record whether or not it is variadic', () => {
		const one = arg.keyValue();
		const many = arg.keyValue().variadic();
		expectTypeOf<InferArg<typeof one>>().toEqualTypeOf<Record<string, string>>();
		expectTypeOf<InferArg<typeof many>>().toEqualTypeOf<Record<string, string>>();
	});

	it('aggregates the positional tail', async () => {
		let received: Record<string, string> | undefined;
		const result = await runCommand(
			varsCommand((value) => {
				received = value;
			}),
			['A=1', 'B=2'],
		);

		expect(result.exitCode).toBe(0);
		expect(received).toEqual({ A: '1', B: '2' });
	});

	it('splits at the first = so values may contain =', async () => {
		let received: Record<string, string> | undefined;
		await runCommand(
			varsCommand((value) => {
				received = value;
			}),
			['A=b=c'],
		);

		expect(received).toEqual({ A: 'b=c' });
	});

	it('rejects a token with no =', async () => {
		const result = await runCommand(
			varsCommand(() => {}),
			['nope'],
		);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
	});

	it('honours the duplicate-key policy', async () => {
		const cmd = command('run')
			.arg('vars', arg.keyValue().variadic().duplicateKeys('error'))
			.action(() => {});

		const result = await runCommand(cmd, ['A=1', 'A=2']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toContain("Duplicate key 'A'");
	});

	it('resolves to an empty record when optional and absent', async () => {
		let received: Record<string, string> | undefined;
		const cmd = command('run')
			.arg('vars', arg.keyValue().variadic().optional())
			.action(({ args }) => {
				received = args.vars;
			});

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual({});
	});

	it('reads delimited pairs from env', async () => {
		let received: Record<string, string> | undefined;
		const cmd = command('run')
			.arg('vars', arg.keyValue().variadic().env('VARS'))
			.action(({ args }) => {
				received = args.vars;
			});

		const result = await runCommand(cmd, [], { env: { VARS: 'A=1,B=2' } });
		expect(result.exitCode).toBe(0);
		expect(received).toEqual({ A: '1', B: '2' });
	});

	it('runs through .execute() the same way', async () => {
		let received: Record<string, string> | undefined;
		const app = cli('mycli').default(
			varsCommand((value) => {
				received = value;
			}),
		);

		const result = await app.execute(['A=1']);
		expect(result.exitCode).toBe(0);
		expect(received).toEqual({ A: '1' });
	});
});

// === arg.keyValue(element)

describe('arg.keyValue(element) — element codec', () => {
	function replicasCommand(onValue: (value: Record<string, number>) => void) {
		return command('scale')
			.arg('replicas', arg.keyValue(arg.number().int().min(0)).variadic())
			.action(({ args }) => {
				onValue(args.replicas);
			});
	}

	it('infers a record of the element type', () => {
		const numbers = arg.keyValue(arg.number());
		const strings = arg.keyValue();
		expectTypeOf<InferArg<typeof numbers>>().toEqualTypeOf<Record<string, number>>();
		expectTypeOf<InferArg<typeof strings>>().toEqualTypeOf<Record<string, string>>();
	});

	it('rejects positional-only fields in a definition element', () => {
		expect(() =>
			createArgSchema('keyValue', {
				elementSchema: { kind: 'string', envVar: 'VALUE' },
			}),
		).toThrowError(/element schema field 'envVar' is not supported/);
		expect(() =>
			createArgSchema('keyValue', {
				elementSchema: { kind: 'keyValue' },
			}),
		).toThrowError(/element schema kind 'keyValue' is not supported/);
	});

	it('validates schema-shaped element inputs before preserving identity', () => {
		const valid = arg.number().int().schema;
		expect(createArgSchema('keyValue', { elementSchema: valid }).elementSchema).toBe(valid);

		const invalid = { ...arg.string().schema, numberConstraints: { min: 1 } };
		expect(() => createArgSchema('keyValue', { elementSchema: invalid })).toThrowError(
			/field 'numberConstraints' requires kind 'number'/,
		);
	});

	it('decodes each entry value through the element codec', async () => {
		let received: Record<string, number> | undefined;
		const result = await runCommand(
			replicasCommand((value) => {
				received = value;
			}),
			['web=3', 'api=2'],
		);

		expect(result.exitCode).toBe(0);
		expect(received).toEqual({ web: 3, api: 2 });
	});

	it('applies the element constraints to a typed CLI token', async () => {
		const result = await runCommand(
			replicasCommand(() => {}),
			['web=-1'],
		);

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toContain('must be >= 0');
	});

	it('applies the element constraints to an env-sourced entry, redacted', async () => {
		const cmd = command('scale')
			.arg('replicas', arg.keyValue(arg.number().int()).variadic().env('REPLICAS'))
			.action(() => {});

		const result = await runCommand(cmd, [], { env: { REPLICAS: 'web=1.5' } });

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toContain("'<redacted>'");
		expect(result.error?.message).toContain('must be an integer');
	});

	it('checks every entry value of a path element on disk', async () => {
		const cmd = command('link')
			.arg('paths', arg.keyValue(arg.path({ mustExist: true })).variadic())
			.action(() => {});

		const result = await runCommand(cmd, ['a=/present', 'b=/missing'], {
			stat: async (path: string) => (path === '/present' ? 'file' : null),
		});

		expect(result.exitCode).toBe(2);
		expect(result.error?.message).toContain('/missing');
	});

	it('serializes the element into the definition document', () => {
		const app = cli('mycli').default(
			command('scale')
				.arg('replicas', arg.keyValue(arg.number()).variadic())
				.action(() => {}),
		);

		expect(generateSchema(app.schema)).toHaveProperty(
			['defaultCommand', 'args', 0, 'elementSchema'],
			{ kind: 'number', presence: 'required' },
		);
	});

	it('keeps entry values as strings when no element is given', async () => {
		let received: Record<string, string> | undefined;
		const cmd = command('run')
			.arg('vars', arg.keyValue().variadic())
			.action(({ args }) => {
				received = args.vars;
			});

		await runCommand(cmd, ['A=1']);
		expect(received).toEqual({ A: '1' });
	});
});

// === readFlags() parity

describe('readFlags() collections', () => {
	it('aggregates repeated CLI occurrences and splits them', async () => {
		const values = await readFlags(
			{ tag: flag.array(flag.string()).separator(',') },
			{ argv: ['--tag', 'a,b', '--tag', 'c'], env: {} },
		);

		expect(values.tag).toEqual(['a', 'b', 'c']);
	});

	it('reads env under the env policy', async () => {
		const values = await readFlags(
			{
				ports: flag
					.array(flag.number())
					.env('PORTS')
					.split({ env: { format: 'json' } }),
			},
			{ argv: [], env: { PORTS: '[80,443]' } },
		);

		expect(values.ports).toEqual([80, 443]);
	});

	it('splices the stdin buffer into occurrence order', async () => {
		const values = await readFlags(
			{ tag: flag.array(flag.string()).stdin({ when: 'dash' }) },
			{ argv: ['--tag', 'before', '--tag', '-', '--tag', 'after'], env: {}, stdinData: 'a\nb\n' },
		);

		expect(values.tag).toEqual(['before', 'a', 'b', 'after']);
	});

	it('merges key-value pairs under the duplicate policy', async () => {
		const values = await readFlags(
			{ env: flag.keyValue().duplicateKeys('first') },
			{ argv: ['--env', 'A=1', '--env', 'A=2'], env: {} },
		);

		expect(values.env).toEqual({ A: '1' });
	});
});
