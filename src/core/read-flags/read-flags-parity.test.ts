/**
 * readFlags() against a command action, capability by capability.
 *
 * The argv-shaped parity table lives in read-flags.test.ts. This one walks the
 * rest of the surface: every source, the stdin contract, aggregation, element
 * and aggregate validation, path checks, deprecation notices, and provenance.
 *
 * @module dreamcli/core/read-flags/read-flags-parity.test
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { createTestPrompter } from '#internals/core/prompt/index.ts';
import type { DeprecationWarning } from '#internals/core/resolve/index.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { ResolutionProvenance } from '#internals/core/schema/provenance.ts';
import type { RunOptions } from '#internals/core/schema/run.ts';
import type { StandardSchemaV1 } from '#internals/core/schema/standard.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { readFlags } from './index.ts';

// === helpers

/** Everything one invocation produced, on either entry point. */
interface Outcome {
	readonly value: unknown;
	readonly code: string | undefined;
	readonly source: ResolutionProvenance | undefined;
	readonly deprecations: readonly string[];
}

/** One capability: the flag under test, the argv, and the injected state. */
interface Capability {
	readonly label: string;
	readonly builder: FlagBuilder<FlagConfig>;
	readonly argv: readonly string[];
	readonly options?: RunOptions;
}

/** The wording the command surface writes to stderr for one notice. */
function formatDeprecation(warning: DeprecationWarning): string {
	const entity = warning.kind === 'flag' ? `flag --${warning.name}` : `argument <${warning.name}>`;
	return typeof warning.message === 'string'
		? `Warning: ${entity} is deprecated: ${warning.message}`
		: `Warning: ${entity} is deprecated`;
}

/** Minimal hand-rolled Standard Schema validator. */
function standard<Output>(
	validate: StandardSchemaV1<unknown, Output>['~standard']['validate'],
): StandardSchemaV1<unknown, Output> {
	return { '~standard': { version: 1, vendor: 'test', validate } };
}

/** Accepts only lower-case text, synchronously. */
const lowerOnly = standard<string>((value) =>
	typeof value === 'string' && value === value.toLowerCase()
		? { value }
		: { issues: [{ message: 'must be lower case' }] },
);

/** Accepts a list of at most two elements, asynchronously. */
const atMostTwo = standard<readonly unknown[]>(async (value) =>
	Array.isArray(value) && value.length <= 2 ? { value } : { issues: [{ message: 'too many' }] },
);

/** Run the capability through a command action. */
async function viaCommand(capability: Capability): Promise<Outcome> {
	let value: unknown;
	let source: ResolutionProvenance | undefined;
	const deprecations: string[] = [];
	const cmd = command('parity')
		.flag('value', capability.builder)
		.action(({ flags, sources }) => {
			value = flags.value;
			source = sources.flags.value;
		});

	const result = await runCommand(cmd, [...capability.argv], {
		env: {},
		...capability.options,
	});
	for (const line of result.stderr) {
		if (line.startsWith('Warning:')) deprecations.push(line.trim());
	}

	return { value, code: result.error?.code, source, deprecations };
}

/** Run the same capability through readFlags. */
async function viaReadFlags(capability: Capability): Promise<Outcome> {
	let source: ResolutionProvenance | undefined;
	const deprecations: string[] = [];
	const options = capability.options ?? {};
	const prompter =
		options.prompter ??
		(options.answers !== undefined ? createTestPrompter(options.answers) : undefined);

	try {
		const values = await readFlags(
			{ value: capability.builder },
			{
				argv: [...capability.argv],
				env: options.env ?? {},
				adapter: createTestAdapter(),
				...(options.config !== undefined ? { config: options.config } : {}),
				...(options.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
				...(prompter !== undefined ? { prompter } : {}),
				...(options.stat !== undefined ? { stat: options.stat } : {}),
				...(options.mkdir !== undefined ? { mkdir: options.mkdir } : {}),
				onSources: (sources) => {
					source = sources.value;
				},
				onDeprecation: (warning: DeprecationWarning) => {
					deprecations.push(formatDeprecation(warning));
				},
			},
		);
		return { value: values.value, code: undefined, source, deprecations };
	} catch (error: unknown) {
		if (!(error instanceof CLIError)) throw error;
		return {
			value: undefined,
			code: error.code,
			source,
			deprecations,
		};
	}
}

// === the capability matrix

const CAPABILITIES: readonly Capability[] = [
	{ label: 'a typed value', builder: flag.string(), argv: ['--value', 'typed'] },
	{
		label: 'an environment value',
		builder: flag.string().env('VALUE'),
		argv: [],
		options: { env: { VALUE: 'from-env' } },
	},
	{
		label: 'a config value',
		builder: flag.string().config('deploy.value'),
		argv: [],
		options: { config: { deploy: { value: 'from-config' } } },
	},
	{
		label: 'a prompt answer',
		builder: flag.string().prompt({ kind: 'input', message: 'Value?' }),
		argv: [],
		options: { answers: ['answered'] },
	},
	{ label: 'a declared default', builder: flag.string().default('fallback'), argv: [] },
	{
		label: 'a prompt with no prompter falling through',
		builder: flag.string().prompt({ kind: 'input', message: 'Value?' }).default('fallback'),
		argv: [],
	},
	{
		label: 'the stdin fallback',
		builder: flag.string().stdin(),
		argv: [],
		options: { stdinData: 'piped\n' },
	},
	{
		label: 'an explicit dash',
		builder: flag.string().stdin(),
		argv: ['--value', '-'],
		options: { stdinData: 'piped\n' },
	},
	{
		label: 'a trimmed pipe',
		builder: flag.string().stdin({ trim: true }),
		argv: [],
		options: { stdinData: '  piped  \n' },
	},
	{
		label: 'a dash with nothing piped',
		builder: flag.array(flag.string()).stdin(),
		argv: ['--value', 'a', '--value', '-'],
	},
	{
		label: 'stdin outranking the environment',
		builder: flag.string().stdin().env('VALUE'),
		argv: [],
		options: { stdinData: 'piped', env: { VALUE: 'from-env' } },
	},
	{
		label: 'a piped number, terminator dropped',
		builder: flag.number().stdin(),
		argv: [],
		options: { stdinData: '42\n' },
	},
	{
		label: 'an env delimiter split',
		builder: flag.array(flag.string()).env('VALUE'),
		argv: [],
		options: { env: { VALUE: 'a,b' } },
	},
	{
		label: 'an env JSON split',
		builder: flag
			.array(flag.number())
			.env('VALUE')
			.split({ env: { format: 'json' } }),
		argv: [],
		options: { env: { VALUE: '[80,443]' } },
	},
	{
		label: 'a stdin splice into occurrence order',
		builder: flag.array(flag.string()).stdin(),
		argv: ['--value', 'before', '--value', '-', '--value', 'after'],
		options: { stdinData: 'a\nb\n' },
	},
	{
		label: 'a native config array',
		builder: flag.array(flag.string()).config('deploy.tags'),
		argv: [],
		options: { config: { deploy: { tags: ['a,b'] } } },
	},
	{
		label: 'deduplication',
		builder: flag.array(flag.string()).separator(',').unique(),
		argv: ['--value', 'a,a,b'],
	},
	{
		label: 'the last duplicate key',
		builder: flag.keyValue(),
		argv: ['--value', 'A=1', '--value', 'A=2'],
	},
	{
		label: 'the first duplicate key',
		builder: flag.keyValue().duplicateKeys('first'),
		argv: ['--value', 'A=1', '--value', 'A=2'],
	},
	{
		label: 'a rejected duplicate key',
		builder: flag.keyValue().duplicateKeys('error'),
		argv: ['--value', 'A=1', '--value', 'A=2'],
	},
	{
		label: 'an element validator',
		builder: flag.array(flag.string().standard(lowerOnly)),
		argv: ['--value', 'a', '--value', 'B'],
	},
	{
		label: 'an aggregate validator',
		builder: flag.array(flag.string()).standard(atMostTwo),
		argv: ['--value', 'a', '--value', 'b', '--value', 'c'],
	},
	{
		label: 'an async validator on a scalar',
		builder: flag.custom(atMostTwo),
		argv: ['--value', 'x'],
	},
	{
		label: 'a default validated through the pipeline',
		builder: flag.string({ minLength: 2 }).default('ok'),
		argv: [],
	},
	{
		label: 'an env value against string constraints',
		builder: flag.string({ minLength: 5 }).env('VALUE'),
		argv: [],
		options: { env: { VALUE: 'no' } },
	},
	{
		label: 'a missing required flag',
		builder: flag.string().required(),
		argv: [],
	},
	{
		label: 'a path check that passes',
		builder: flag.path({ mustExist: true }),
		argv: ['--value', '/tmp/here'],
		options: { stat: async () => 'file' },
	},
	{
		label: 'a path check that fails',
		builder: flag.path({ mustExist: true }),
		argv: ['--value', '/tmp/gone'],
		options: { stat: async () => null },
	},
	{
		label: 'an array of paths, checked per element',
		builder: flag.array(flag.path({ mustExist: true })),
		argv: ['--value', '/tmp/a', '--value', '/tmp/b'],
		options: { stat: async (path: string) => (path === '/tmp/b' ? null : 'file') },
	},
	{
		label: 'a deprecation notice',
		builder: flag.string().deprecated('use --other'),
		argv: ['--value', 'typed'],
	},
	{
		label: 'an Object.prototype member as the value',
		builder: flag.keyValue(),
		argv: ['--value', '__proto__=x', '--value', 'A=1'],
	},
];

describe('readFlags() capability parity', () => {
	for (const capability of CAPABILITIES) {
		it(`matches the command path for ${capability.label}`, async () => {
			const fromCommand = await viaCommand(capability);
			const fromReadFlags = await viaReadFlags(capability);

			expect(fromReadFlags.code).toBe(fromCommand.code);
			expect(fromReadFlags.value).toEqual(fromCommand.value);
			expect(fromReadFlags.source).toEqual(fromCommand.source);
			expect(fromReadFlags.deprecations).toEqual(fromCommand.deprecations);
		});
	}
});
