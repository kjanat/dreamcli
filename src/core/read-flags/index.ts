/**
 * Standalone typed flag evaluation over the existing builder DSL.
 *
 * {@linkcode readFlags} runs a record of {@linkcode FlagBuilder} definitions through
 * the same command schema, parser, coercion, resolver, and validation that a
 * command uses, and returns the values typed by {@linkcode InferFlags}. There is
 * no command dispatch, output channel, help, or process exit here; parse and
 * resolution failures propagate as the framework's `ParseError` and
 * `ValidationError`.
 *
 * @module dreamcli/core/read-flags
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { ParseOptions } from '#internals/core/parse/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import type { DeprecationWarning, ResolveOptions } from '#internals/core/resolve/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import { createCommandSchema } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig, InferFlags } from '#internals/core/schema/flag.ts';
import type { SourcesOf } from '#internals/core/schema/provenance.ts';
import { invocationSelectsStdin } from '#internals/core/schema/source.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { createAdapter } from '#internals/runtime/auto.ts';

/**
 * A record of flag definitions keyed by canonical flag name.
 *
 * The object key is the `--name` spelling and the key on the resolved record.
 */
type FlagMap = Readonly<Record<string, FlagBuilder<FlagConfig>>>;

/**
 * External state and behavior toggles accepted by {@linkcode readFlags}.
 *
 * Extends {@linkcode ResolveOptions}, so `env`, `config`, `prompter`, `stat`,
 * and `mkdir` carry the meaning they have during command resolution.
 */
interface ReadFlagsOptions<F extends FlagMap = FlagMap> extends ResolveOptions {
	/**
	 * User arguments only, without the binary and script entries.
	 * @defaultValue the runtime adapter's argv past its binary and script entries
	 */
	readonly argv?: readonly string[];

	/**
	 * Runtime source for argv, environment, and filesystem primitives.
	 * @defaultValue {@linkcode createAdapter | createAdapter()}, built on the
	 *   first fact the caller left out
	 */
	readonly adapter?: RuntimeAdapter;

	/**
	 * Parser behavior such as kebab/camel case parity.
	 * @defaultValue `undefined`, which keeps the parser defaults
	 */
	readonly parse?: ParseOptions;

	/**
	 * Receiver for notices produced by `.deprecated()` flags.
	 * @defaultValue `undefined`, which drops the notices
	 */
	readonly onDeprecation?: (warning: DeprecationWarning) => void;

	/**
	 * Receiver for the provenance of the resolved values, keyed by flag name.
	 *
	 * Called once with the whole record, before {@linkcode readFlags} returns the
	 * values. A flag that resolved no value has no record, so the same reader
	 * works for optional flags.
	 * @defaultValue `undefined`, which drops the record
	 */
	readonly onSources?: (sources: SourcesOf<F>) => void;
}

const INTERNAL_COMMAND_NAME = '<standalone>';

/**
 * Reader that yields the injected adapter, or builds one the first time a fact
 * the caller did not supply is actually needed.
 */
function adapterReader(injected: RuntimeAdapter | undefined): () => RuntimeAdapter {
	let adapter = injected;
	return () => {
		adapter ??= createAdapter();
		return adapter;
	};
}

/**
 * Evaluate a record of flag definitions and return the resolved values.
 *
 * The record is compiled into an anonymous command schema with no positional
 * arguments, parsed once, and run through the CLI, env, config, prompt, default
 * resolution chain. Aliases, negated spellings, duplicate policy, case parity,
 * unknown-flag rejection, coercion, constraints, Standard Schema validators, and
 * `flag.path()` checks behave exactly as they do inside a command.
 *
 * Anything the caller leaves out comes from the runtime adapter, which is built
 * on first use, so a call given `argv` and `env` reads nothing from the host
 * unless a `flag.path()` check needs the adapter's filesystem primitives.
 * `config` has no application name to discover a file from and stays
 * caller-supplied. `prompter` stays caller-supplied as well, so a `.prompt()`
 * flag with no prompter falls through to its default.
 *
 * @param definitions - Flag builders keyed by canonical flag name.
 * @param options - Injected runtime state and behavior toggles.
 * @returns The resolved flag values, typed from the definitions.
 * @throws {ParseError} For unknown flags, missing values, and bad input.
 * @throws {ValidationError} For missing required flags and failed validators.
 * @throws {CLIError} With code `'FLAG_NAME_COLLISION'` when two definitions share
 *   a name, an alias, or a negated spelling.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` for the definition key
 *   `__proto__`, which JavaScript cannot carry as a plain record key, and for a
 *   definitions record whose prototype is replaced, which hides the entries a
 *   key check would read.
 *
 * @example
 * ```ts
 * import { flag, readFlags } from '@kjanat/dreamcli';
 *
 * const options = await readFlags({
 *   watch: flag.boolean().alias('w').env('WATCH').default(false),
 *   minify: flag.boolean().env('MINIFY').default(true),
 *   target: flag.enum(['node', 'browser']).env('TARGET').default('node'),
 * });
 *
 * options.watch; // boolean
 * options.minify; // boolean
 * options.target; // 'node' | 'browser'
 * ```
 *
 * @example
 * ```ts
 * const values = await readFlags(
 *   { watch: flag.boolean().alias('w').env('WATCH') },
 *   { argv: [], env: { WATCH: 'true' } },
 * );
 *
 * values.watch; // true
 * ```
 */
async function readFlags<const F extends FlagMap>(
	definitions: F,
	options?: ReadFlagsOptions<F>,
): Promise<InferFlags<F>> {
	// Only own enumerable keys are read.
	const prototype: unknown = Object.getPrototypeOf(definitions);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new CLIError(
			"Flag definitions record has a replaced prototype. A '__proto__' key sets the prototype instead of adding a definition, and an inherited definition is never read",
			{
				code: 'INVALID_SCHEMA',
				suggest:
					"Pass a plain object with no '__proto__' key, or a record built with Object.create(null)",
			},
		);
	}

	const entries = Object.entries(definitions);
	for (const [name] of entries) {
		if (name === '__proto__') {
			throw new CLIError(`Flag name '${name}' is not usable as a flag`, {
				code: 'INVALID_SCHEMA',
				details: { flag: name },
				suggest: 'Rename the definition key, for example to "proto"',
			});
		}
	}

	const flags = Object.fromEntries(entries.map(([name, builder]) => [name, builder.schema]));
	const schema = createCommandSchema({ name: INTERNAL_COMMAND_NAME, flags });

	const host = adapterReader(options?.adapter);
	const argv = options?.argv ?? host().argv.slice(2);
	const parsed = parse(schema, argv, options?.parse);

	// Stdin is read only when a declared `.stdin()` flag would actually select
	// it, and only through the adapter, so a call that reaches no stdin source
	// never touches the stream.
	const stdinData =
		options?.stdinData === undefined && invocationSelectsStdin(schema.flags, schema.args, parsed)
			? await host().readStdin()
			: options?.stdinData;

	const resolved = await resolve(schema, parsed, {
		env: options?.env ?? host().env,
		stat: options?.stat ?? ((path: string) => host().stat(path)),
		mkdir: options?.mkdir ?? ((path: string) => host().mkdir(path)),
		...(options?.config !== undefined ? { config: options.config } : {}),
		...(options?.prompter !== undefined ? { prompter: options.prompter } : {}),
		...(stdinData !== undefined ? { stdinData } : {}),
	});

	for (const warning of resolved.deprecations) {
		options?.onDeprecation?.(warning);
	}

	options?.onSources?.(resolved.provenance.flags as SourcesOf<F>);

	return resolved.flags as InferFlags<F>;
}

export type { FlagMap, ReadFlagsOptions };
export { readFlags };
