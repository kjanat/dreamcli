/**
 * The per-source aggregation matrix: how every source fills a `many` or
 * `entries` collection, how a `-` occurrence splices the stdin buffer into
 * occurrence order, and how element and aggregate validation compose.
 *
 * @module dreamcli/core/resolve/resolve-cardinality.test
 */

import { describe, expect, it } from 'vitest';
import type { ValidationError } from '#internals/core/errors/index.ts';
import { isValidationError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { createTestPrompter } from '#internals/core/prompt/test-prompter.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import type { ResolveOptions } from './index.ts';
import { resolve } from './index.ts';

// --- helpers

/** Resolve one flag against the given argv and sources. */
async function resolveFlag(
	builder: FlagBuilder<FlagConfig>,
	argv: readonly string[],
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.flag('value', builder)
		.action(() => {}).schema;
	const result = await resolve(schema, parse(schema, argv), options);
	return result.flags.value;
}

/** Resolve one positional against the given argv and sources. */
async function resolveArg(
	builder: ArgBuilder<ArgConfig>,
	argv: readonly string[],
	options: ResolveOptions = {},
): Promise<unknown> {
	const schema = command('deploy')
		.arg('value', builder)
		.action(() => {}).schema;
	const result = await resolve(schema, parse(schema, argv), options);
	return result.args.value;
}

/** Run a resolution expected to fail, returning the message it reported. */
async function resolutionError(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (error) {
		if (isValidationError(error)) return error.message;
		throw error;
	}
	throw new Error('expected resolution to fail');
}

/** A validator that accepts only the listed values. */
function allowOnly(allowed: readonly unknown[], message: string): StandardSchemaV1 {
	return {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value: unknown) =>
				allowed.includes(value) ? { value } : { issues: [{ message }] },
		},
	};
}

// === many, one source at a time

describe('many, CLI', () => {
	it('collects repeated occurrences in order', async () => {
		expect(await resolveFlag(flag.array(flag.string()), ['--value', 'a', '--value', 'b'])).toEqual([
			'a',
			'b',
		]);
	});

	it('splits each occurrence on the CLI separator', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).separator(','), [
				'--value',
				'a,b',
				'--value',
				'c',
			]),
		).toEqual(['a', 'b', 'c']);
	});

	it('collects the positional tail of a variadic arg', async () => {
		expect(await resolveArg(arg.string().variadic(), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
	});

	it('splits positional tokens when the arg declares a CLI separator', async () => {
		expect(await resolveArg(arg.string().variadic().separator(','), ['a,b', 'c'])).toEqual([
			'a',
			'b',
			'c',
		]);
	});
});

describe('many, env', () => {
	it('splits on commas by default', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).env('TAGS'), [], { env: { TAGS: 'a,b' } }),
		).toEqual(['a', 'b']);
	});

	it('splits on the configured env delimiter', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).env('TAGS').split({ env: '|' }), [], {
				env: { TAGS: 'a|b' },
			}),
		).toEqual(['a', 'b']);
	});

	it('reads JSON only when the binding asks for it', async () => {
		expect(
			await resolveFlag(
				flag
					.array(flag.number())
					.env('PORTS')
					.split({ env: { format: 'json' } }),
				[],
				{ env: { PORTS: '[80, 443]' } },
			),
		).toEqual([80, 443]);
	});

	it('never guesses JSON under the delimiter default', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.array(flag.number()).env('PORTS'), [], { env: { PORTS: '[80, 443]' } }),
		);
		expect(message).toContain('Invalid number value');
	});

	it('reports unparseable JSON', async () => {
		const message = await resolutionError(() =>
			resolveFlag(
				flag
					.array(flag.string())
					.env('TAGS')
					.split({ env: { format: 'json' } }),
				[],
				{
					env: { TAGS: '{' },
				},
			),
		);
		expect(message).toContain('Invalid JSON value');
	});

	it('reports a JSON value that is not an array', async () => {
		const message = await resolutionError(() =>
			resolveFlag(
				flag
					.array(flag.string())
					.env('TAGS')
					.split({ env: { format: 'json' } }),
				[],
				{
					env: { TAGS: '{"a":1}' },
				},
			),
		);
		expect(message).toContain('expected an array');
	});
});

describe('many, config, prompt, and defaults', () => {
	it('takes a native config array element by element', async () => {
		expect(
			await resolveFlag(flag.array(flag.number()).config('deploy.ports'), [], {
				config: { deploy: { ports: [80, 443] } },
			}),
		).toEqual([80, 443]);
	});

	it('takes a native config array past the split policy, delimiters and all', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).config('deploy.tags').split({ env: ',' }), [], {
				config: { deploy: { tags: ['a,b', 'c'] } },
			}),
		).toEqual(['a,b', 'c']);
	});

	it('takes a native config array past a JSON policy too', async () => {
		expect(
			await resolveFlag(
				flag
					.array(flag.string())
					.config('deploy.tags')
					.split({ env: { format: 'json' } }),
				[],
				{ config: { deploy: { tags: ['[not json]'] } } },
			),
		).toEqual(['[not json]']);
	});

	it('splits a config string under the env policy', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).config('deploy.tags'), [], {
				config: { deploy: { tags: 'a,b' } },
			}),
		).toEqual(['a', 'b']);
	});

	it('takes a multiselect prompt answer', async () => {
		expect(
			await resolveFlag(
				flag.array(flag.enum(['a', 'b'])).prompt({ kind: 'multiselect', message: 'Which?' }),
				[],
				{ prompter: createTestPrompter([['a', 'b']]) },
			),
		).toEqual(['a', 'b']);
	});

	it('takes a typed array default', async () => {
		expect(await resolveFlag(flag.array(flag.string()).default(['a']), [])).toEqual(['a']);
	});

	it('deduplicates whatever source produced the values', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).separator(',').unique(), ['--value', 'a,a,b']),
		).toEqual(['a', 'b']);
		expect(await resolveArg(arg.string().variadic().unique(), ['a', 'b', 'a'])).toEqual(['a', 'b']);
	});
});

describe('many, stdin', () => {
	const piped = flag.array(flag.string()).stdin();

	it('reads one element per line by default', async () => {
		expect(await resolveFlag(piped, [], { stdinData: 'a\nb\n' })).toEqual(['a', 'b']);
	});

	it('keeps a genuine blank line', async () => {
		expect(await resolveFlag(piped, [], { stdinData: 'a\nb\n\n' })).toEqual(['a', 'b', '']);
	});

	it('reads the whole buffer as one element when asked', async () => {
		expect(
			await resolveFlag(
				flag
					.array(flag.string())
					.stdin()
					.split({ stdin: { format: 'whole' } }),
				[],
				{
					stdinData: 'a\nb\n',
				},
			),
		).toEqual(['a\nb\n']);
	});

	it('reads a delimiter when asked', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).stdin().split({ stdin: ',' }), [], {
				stdinData: 'a,b',
			}),
		).toEqual(['a', 'b']);
	});

	it('reads JSON when asked', async () => {
		expect(
			await resolveFlag(
				flag
					.array(flag.number())
					.stdin()
					.split({ stdin: { format: 'json' } }),
				[],
				{ stdinData: '[1, 2]' },
			),
		).toEqual([1, 2]);
	});
});

// === entries, one source at a time

describe('entries, every source', () => {
	it('merges repeated CLI occurrences', async () => {
		expect(await resolveFlag(flag.keyValue(), ['--value', 'A=1', '--value', 'B=2'])).toEqual({
			A: '1',
			B: '2',
		});
	});

	it('collects a tail of k=v tokens into one record', async () => {
		expect(await resolveArg(arg.keyValue().variadic(), ['A=1', 'B=2'])).toEqual({
			A: '1',
			B: '2',
		});
	});

	it('reads one k=v token into a record for a non-variadic arg', async () => {
		expect(await resolveArg(arg.keyValue(), ['A=1'])).toEqual({ A: '1' });
	});

	it('splits one CLI token on the separator a non-variadic arg declares', async () => {
		expect(await resolveArg(arg.keyValue().separator(','), ['A=1,B=2'])).toEqual({
			A: '1',
			B: '2',
		});
		expect(await resolveArg(arg.keyValue().split({ cli: ';' }), ['A=1;B=2'])).toEqual({
			A: '1',
			B: '2',
		});
	});

	it('splits a CLI token the same way whichever surface and arity declares it', async () => {
		const expected = { A: '1', B: '2' };

		expect(await resolveFlag(flag.keyValue().separator(','), ['--value', 'A=1,B=2'])).toEqual(
			expected,
		);
		expect(await resolveArg(arg.keyValue().separator(','), ['A=1,B=2'])).toEqual(expected);
		expect(await resolveArg(arg.keyValue().variadic().separator(','), ['A=1,B=2'])).toEqual(
			expected,
		);
	});

	it('leaves a CLI token whole when the arg declares no separator', async () => {
		expect(await resolveArg(arg.keyValue(), ['A=1,B=2'])).toEqual({ A: '1,B=2' });
	});

	it('splits env pairs on commas and at the first =', async () => {
		expect(
			await resolveFlag(flag.keyValue().env('VARS'), [], { env: { VARS: 'A=1,B=b=c' } }),
		).toEqual({ A: '1', B: 'b=c' });
	});

	it('reads an env JSON object when asked', async () => {
		expect(
			await resolveFlag(
				flag
					.keyValue()
					.env('VARS')
					.split({ env: { format: 'json' } }),
				[],
				{
					env: { VARS: '{"A":"1"}' },
				},
			),
		).toEqual({ A: '1' });
	});

	it('takes a native config object', async () => {
		expect(
			await resolveFlag(flag.keyValue().config('deploy.vars'), [], {
				config: { deploy: { vars: { A: '1' } } },
			}),
		).toEqual({ A: '1' });
	});

	it('names the expected object shape for a key-value source', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.keyValue().config('deploy.vars'), [], {
				config: { deploy: { vars: 1 } },
			}),
		);
		expect(message).toContain('Invalid object value');
	});

	it('takes a native config object past the split policy, separators and all', async () => {
		expect(
			await resolveFlag(flag.keyValue().config('deploy.vars').split({ env: ',' }), [], {
				config: { deploy: { vars: { A: '1,2', B: 'x=y' } } },
			}),
		).toEqual({ A: '1,2', B: 'x=y' });
	});

	it('reads piped lines as pairs', async () => {
		expect(await resolveFlag(flag.keyValue().stdin(), [], { stdinData: 'A=1\nB=2\n' })).toEqual({
			A: '1',
			B: '2',
		});
	});

	it('takes a typed record default', async () => {
		expect(await resolveFlag(flag.keyValue().default({ A: '1' }), [])).toEqual({ A: '1' });
	});
});

describe('entries, duplicate keys', () => {
	it('lets the last occurrence win by default', async () => {
		expect(await resolveFlag(flag.keyValue(), ['--value', 'A=1', '--value', 'A=2'])).toEqual({
			A: '2',
		});
	});

	it('lets the first occurrence win under first', async () => {
		expect(
			await resolveFlag(flag.keyValue().duplicateKeys('first'), [
				'--value',
				'A=1',
				'--value',
				'A=2',
			]),
		).toEqual({ A: '1' });
	});

	it('rejects a repeat under error', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.keyValue().duplicateKeys('error'), ['--value', 'A=1', '--value', 'A=2']),
		);
		expect(message).toContain("Duplicate key 'A'");
	});

	it('applies the policy to env pairs too', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.keyValue().duplicateKeys('error').env('VARS'), [], {
				env: { VARS: 'A=1,A=2' },
			}),
		);
		expect(message).toBe("Duplicate key 'A' from env VARS for flag --value");
	});
});

// === occurrence splicing

describe('stdin splices into occurrence order', () => {
	const tags = flag.array(flag.string()).stdin({ when: 'dash' });

	it('replaces the dash occurrence with what the buffer decodes to', async () => {
		expect(
			await resolveFlag(tags, ['--value', 'before', '--value', '-', '--value', 'after'], {
				stdinData: 'a\nb\n',
			}),
		).toEqual(['before', 'a', 'b', 'after']);
	});

	it('splices at the front and the back', async () => {
		expect(
			await resolveFlag(tags, ['--value', '-', '--value', 'last'], { stdinData: 'a\n' }),
		).toEqual(['a', 'last']);
		expect(
			await resolveFlag(tags, ['--value', 'first', '--value', '-'], { stdinData: 'a\n' }),
		).toEqual(['first', 'a']);
	});

	it('decodes the same elements the implicit fallback would', async () => {
		const explicit = await resolveFlag(flag.array(flag.string()).stdin(), ['--value', '-'], {
			stdinData: 'a\nb\n',
		});
		const implicit = await resolveFlag(flag.array(flag.string()).stdin(), [], {
			stdinData: 'a\nb\n',
		});
		expect(explicit).toEqual(implicit);
	});

	it('splices entries and applies the duplicate policy across the whole order', async () => {
		expect(
			await resolveFlag(
				flag.keyValue().stdin({ when: 'dash' }),
				['--value', 'A=1', '--value', '-'],
				{
					stdinData: 'A=2\nB=3\n',
				},
			),
		).toEqual({ A: '2', B: '3' });

		expect(
			await resolveFlag(
				flag.keyValue().stdin({ when: 'dash' }).duplicateKeys('first'),
				['--value', 'A=1', '--value', '-'],
				{ stdinData: 'A=2\n' },
			),
		).toEqual({ A: '1' });

		const message = await resolutionError(() =>
			resolveFlag(
				flag.keyValue().stdin({ when: 'dash' }).duplicateKeys('error'),
				['--value', 'A=1', '--value', '-'],
				{ stdinData: 'A=2\n' },
			),
		);
		expect(message).toBe("Duplicate key 'A' from stdin for flag --value");
	});

	it('decodes each spliced element through the element value axis', async () => {
		expect(
			await resolveFlag(flag.array(flag.number()).stdin({ when: 'dash' }), ['--value', '-'], {
				stdinData: '1\n2\n',
			}),
		).toEqual([1, 2]);

		const message = await resolutionError(() =>
			resolveFlag(flag.array(flag.number()).stdin({ when: 'dash' }), ['--value', '-'], {
				stdinData: '1\nnope\n',
			}),
		);
		expect(message).toContain('Invalid number value');
	});

	it('falls through to a later source when only a dash was given and nothing was piped', async () => {
		expect(
			await resolveFlag(
				flag.array(flag.string()).stdin({ when: 'dash' }).env('TAGS'),
				['--value', '-'],
				{
					env: { TAGS: 'from-env' },
				},
			),
		).toEqual(['from-env']);
	});

	it('keeps a literal dash when the flag never reads stdin', async () => {
		expect(await resolveFlag(flag.array(flag.string()), ['--value', '-'])).toEqual(['-']);
	});
});

// === broadcast consumers

describe('broadcast consumers decode the same buffer per binding', () => {
	it('gives each consumer the elements its own binding asks for', async () => {
		const schema = command('run')
			.flag('lines', flag.array(flag.string()).stdin({ consume: 'broadcast' }))
			.flag('whole', flag.string().stdin({ consume: 'broadcast' }))
			.flag(
				'pairs',
				flag
					.keyValue()
					.stdin({ consume: 'broadcast' })
					.split({ stdin: { format: 'json' } }),
			)
			.action(() => {}).schema;

		const result = await resolve(schema, parse(schema, []), { stdinData: '{"A":"1"}' });

		expect(result.flags.lines).toEqual(['{"A":"1"}']);
		expect(result.flags.whole).toBe('{"A":"1"}');
		expect(result.flags.pairs).toEqual({ A: '1' });
	});
});

// === element-level rules on collections

describe('element rules apply to every collected element', () => {
	it('runs element path checks per element of an array', async () => {
		const seen: string[] = [];
		const stat = async (path: string) => {
			seen.push(path);
			return 'file' as const;
		};

		expect(
			await resolveFlag(
				flag.array(flag.path({ mustExist: true })).separator(','),
				['--value', '/a.txt,/b.txt'],
				{ stat },
			),
		).toEqual(['/a.txt', '/b.txt']);
		expect(seen).toEqual(['/a.txt', '/b.txt']);
	});

	it('runs element path checks per value of a record', async () => {
		const seen: string[] = [];
		const stat = async (path: string) => {
			seen.push(path);
			return 'file' as const;
		};

		await resolveFlag(flag.keyValue(flag.path({ mustExist: true })), ['--value', 'a=/a.txt'], {
			stat,
		});
		expect(seen).toEqual(['/a.txt']);
	});

	it('reports the element a path check rejected', async () => {
		const stat = async (path: string) => (path === '/a.txt' ? ('file' as const) : null);

		const message = await resolutionError(() =>
			resolveFlag(
				flag.array(flag.path({ mustExist: true })).separator(','),
				['--value', '/a.txt,/b.txt'],
				{
					stat,
				},
			),
		);
		expect(message).toContain("Path '/b.txt'");
	});

	it('applies element string constraints to every element at the parse boundary', async () => {
		await expect(
			resolveFlag(flag.array(flag.string({ minLength: 2 })).separator(','), ['--value', 'ab,c']),
		).rejects.toThrow(/must be at least 2 characters/);
	});

	it('applies element string constraints to an env-sourced element', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.array(flag.string({ minLength: 2 })).env('TAGS'), [], {
				env: { TAGS: 'ab,c' },
			}),
		);
		expect(message).toContain('at least 2');
	});
});

// === element versus aggregate Standard Schema

describe('element and aggregate validation', () => {
	it('validates each element with the element validator', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.array(flag.string().standard(allowOnly(['a'], 'only a'))).separator(','), [
				'--value',
				'a,b',
			]),
		);
		expect(message).toContain('--value[1]');
		expect(message).toContain('only a');
	});

	it('validates the completed array with the aggregate validator', async () => {
		const nonEmpty: StandardSchemaV1 = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) =>
					Array.isArray(value) && value.length > 1
						? { value }
						: { issues: [{ message: 'need two' }] },
			},
		};

		expect(
			await resolveFlag(flag.array(flag.string()).standard(nonEmpty).separator(','), [
				'--value',
				'a,b',
			]),
		).toEqual(['a', 'b']);

		const message = await resolutionError(() =>
			resolveFlag(flag.array(flag.string()).standard(nonEmpty).separator(','), ['--value', 'a']),
		);
		expect(message).toContain('need two');
	});

	it('skips aggregate validation after an element fails', async () => {
		let aggregateCalls = 0;
		const aggregate: StandardSchemaV1 = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: (value: unknown) => {
					aggregateCalls += 1;
					return { value };
				},
			},
		};

		const message = await resolutionError(() =>
			resolveFlag(
				flag.array(flag.string().standard(allowOnly(['a'], 'only a'))).standard(aggregate),
				['--value', 'b'],
			),
		);
		expect(message).toContain('only a');
		expect(aggregateCalls).toBe(0);
	});

	it('validates the implicit count value with its scalar validator', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.count().standard(allowOnly([1], 'count must be one')), []),
		);
		expect(message).toContain('count must be one');
	});

	it('validates each entry value and then the completed record', async () => {
		const message = await resolutionError(() =>
			resolveFlag(flag.keyValue(flag.string().standard(allowOnly(['1'], 'only 1'))), [
				'--value',
				'A=2',
			]),
		);
		expect(message).toContain('--value.A');
	});

	it('awaits an asynchronous validator', async () => {
		const asyncOnlyA: StandardSchemaV1 = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: async (value: unknown) =>
					value === 'a' ? { value } : { issues: [{ message: 'only a' }] },
			},
		};

		const message = await resolutionError(() =>
			resolveFlag(flag.array(flag.string().standard(asyncOnlyA)).separator(','), [
				'--value',
				'a,b',
			]),
		);
		expect(message).toContain('only a');
	});

	it('validates a default through the same pipeline', async () => {
		const message = await resolutionError(() =>
			resolveFlag(
				flag
					.array(flag.string())
					.standard({
						'~standard': {
							version: 1,
							vendor: 'test',
							validate: async () => ({ issues: [{ message: 'never valid' }] }),
						},
					})
					.default(['a']),
				[],
			),
		);
		expect(message).toContain('never valid');
	});

	it('validates a variadic arg element by element', async () => {
		const message = await resolutionError(() =>
			resolveArg(arg.custom(allowOnly(['a'], 'only a')).variadic(), ['a', 'b']),
		);
		expect(message).toContain('<value>[1]');
	});

	it('validates a variadic arg as a whole when the validator rides the collection', async () => {
		const message = await resolutionError(() =>
			resolveArg(
				arg
					.string()
					.variadic()
					.standard({
						'~standard': {
							version: 1,
							vendor: 'test',
							validate: (value: unknown) =>
								Array.isArray(value) && value.length > 1
									? { value }
									: { issues: [{ message: 'need two' }] },
						},
					}),
				['a'],
			),
		);
		expect(message).toContain('need two');
	});
});

// === provenance of a spliced collection

describe('collection provenance', () => {
	/** Resolve one flag and return the record naming where its value came from. */
	async function flagProvenance(
		builder: FlagBuilder<FlagConfig>,
		argv: readonly string[],
		options: ResolveOptions = {},
	): Promise<unknown> {
		const schema = command('deploy')
			.flag('value', builder)
			.action(() => {}).schema;
		const result = await resolve(schema, parse(schema, argv), options);
		return result.provenance.flags.value;
	}

	it('names stdin for a collection that spliced the buffer', async () => {
		expect(
			await flagProvenance(flag.array(flag.string()).stdin(), ['--value', 'a', '--value', '-'], {
				stdinData: 'b\n',
			}),
		).toEqual({ stage: 'cli', via: 'stdin', trigger: 'dash' });
	});

	it('names the CLI alone for a literal dash element', async () => {
		expect(await flagProvenance(flag.array(flag.string()), ['--value', '-'])).toEqual({
			stage: 'cli',
		});
	});

	it('names the CLI alone when every occurrence was typed', async () => {
		expect(
			await flagProvenance(flag.array(flag.string()).stdin(), ['--value', 'a', '--value', 'b']),
		).toEqual({ stage: 'cli' });
	});
});

// === an explicit dash with nothing piped

describe("a '-' occurrence beside typed ones and no pipe", () => {
	it('fails for a flag rather than dropping the occurrence', async () => {
		const error = await resolutionError(() =>
			resolveFlag(flag.array(flag.string()).stdin(), [
				'--value',
				'a',
				'--value',
				'-',
				'--value',
				'b',
			]),
		);
		expect(error).toContain("No piped stdin for the '-' occurrence of flag --value");
	});

	it('fails for an entries flag the same way', async () => {
		const error = await resolutionError(() =>
			resolveFlag(flag.keyValue().stdin(), ['--value', 'A=1', '--value', '-']),
		);
		expect(error).toContain("No piped stdin for the '-' occurrence of flag --value");
	});

	it('still falls through when nothing but a dash was given', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).stdin().env('TAGS'), ['--value', '-'], {
				env: { TAGS: 'from-env' },
			}),
		).toEqual(['from-env']);
	});
});

// === Object.prototype member names survive every entries pass

describe('entries keyed by an Object.prototype member', () => {
	/** A validator that accepts every value it sees. */
	const acceptAll: StandardSchemaV1 = {
		'~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
	};

	it('keeps a __proto__ entry through aggregation alone', async () => {
		const value = await resolveFlag(flag.keyValue(), ['--value', '__proto__=x', '--value', 'A=1']);
		expect(Object.keys(value as object)).toEqual(['__proto__', 'A']);
	});

	it('keeps a __proto__ entry through the element validator pass', async () => {
		const value = await resolveFlag(flag.keyValue(flag.string().standard(acceptAll)), [
			'--value',
			'__proto__=x',
			'--value',
			'A=1',
		]);
		expect(Object.keys(value as object)).toEqual(['__proto__', 'A']);
	});

	it('keeps a __proto__ entry read from env', async () => {
		const value = await resolveFlag(flag.keyValue(flag.string().standard(acceptAll)).env('E'), [], {
			env: { E: '__proto__=x,A=1' },
		});
		expect(Object.keys(value as object)).toEqual(['__proto__', 'A']);
	});
});

// === a repeated stdin sentinel on one input

describe('two `-` occurrences on one collection', () => {
	it('splices the buffer once per occurrence', async () => {
		expect(
			await resolveFlag(flag.array(flag.string()).stdin(), ['--value', '-', '--value', '-'], {
				stdinData: 'a\nb\n',
			}),
		).toEqual(['a', 'b', 'a', 'b']);
	});

	it('folds a repeated key across both splices under the duplicate policy', async () => {
		expect(
			await resolveFlag(flag.keyValue().stdin(), ['--value', '-', '--value', '-'], {
				stdinData: 'A=1\n',
			}),
		).toEqual({ A: '1' });
		expect(
			await resolutionError(() =>
				resolveFlag(
					flag.keyValue().stdin().duplicateKeys('error'),
					['--value', '-', '--value', '-'],
					{
						stdinData: 'A=1\n',
					},
				),
			),
		).toBe("Duplicate key 'A' from stdin for flag --value");
	});
});

// === the shape a source value must have to fill a collection

describe('a source value of the wrong shape names the shape the collection wants', () => {
	/** Run a resolution expected to fail, returning the failure it reported. */
	async function failure(run: () => Promise<unknown>): Promise<ValidationError> {
		try {
			await run();
		} catch (error) {
			if (isValidationError(error)) return error;
			throw error;
		}
		throw new Error('expected resolution to fail');
	}

	it('asks a key-value flag for an object', async () => {
		for (const raw of [5, [1, 2], true]) {
			const error = await failure(() =>
				resolveFlag(flag.keyValue().config('deploy.value'), [], {
					config: { deploy: { value: raw } },
				}),
			);
			expect(error.message).toBe(
				`Invalid object value '${JSON.stringify(raw)}' from config deploy.value for flag --value`,
			);
			expect(error.details).toEqual({
				flag: 'value',
				source: 'config',
				configPath: 'deploy.value',
				value: raw,
				expected: 'object',
			});
			expect(error.suggest).toBe('Set deploy.value to an object in your config');
		}
	});

	it('asks a key-value arg for an object', async () => {
		const error = await failure(() =>
			resolveArg(arg.keyValue().config('deploy.value'), [], { config: { deploy: { value: 5 } } }),
		);
		expect(error.message).toBe(
			"Invalid object value '5' from config deploy.value for argument <value>",
		);
		expect(error.details).toEqual({
			arg: 'value',
			source: 'config',
			configPath: 'deploy.value',
			value: 5,
			expected: 'object',
		});
		expect(error.suggest).toBe('Use KEY=VALUE for <value>');
	});

	it('still asks a list flag for an array', async () => {
		const error = await failure(() =>
			resolveFlag(flag.array(flag.string()).config('deploy.value'), [], {
				config: { deploy: { value: 5 } },
			}),
		);
		expect(error.message).toBe("Invalid array value '5' from config deploy.value for flag --value");
		expect(error.details).toEqual({
			flag: 'value',
			source: 'config',
			configPath: 'deploy.value',
			value: 5,
			expected: 'array',
		});
		expect(error.suggest).toBe('Set deploy.value to an array in your config');
	});

	it('still asks a list arg for an array', async () => {
		const error = await failure(() =>
			resolveArg(arg.string().variadic().config('deploy.value'), [], {
				config: { deploy: { value: 5 } },
			}),
		);
		expect(error.message).toBe(
			"Invalid array value '5' from config deploy.value for argument <value>",
		);
		expect(error.details).toEqual({
			arg: 'value',
			source: 'config',
			configPath: 'deploy.value',
			value: 5,
			expected: 'array',
		});
		expect(error.suggest).toBe('Provide values for <value>');
	});
});
