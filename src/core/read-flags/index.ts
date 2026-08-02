/**
 * Standalone typed flag evaluation over the existing builder DSL.
 *
 * {@linkcode readFlags} runs a record of {@linkcode FlagBuilder} definitions through
 * the same command schema, parser, coercion, resolver, and validation that a
 * command uses, and returns the values typed by {@linkcode InferFlags}. There is
 * no command dispatch here; parse and resolution failures propagate as the
 * framework's `ParseError` and `ValidationError`. The one output surface is the
 * built-in `--help`: while it is on and no definition claims its spellings, a
 * pre-separator `--help` or `-h` prints generated help to the adapter's stdout
 * and exits the process with code 0.
 *
 * @module dreamcli/core/read-flags
 */

import { CLIError } from '#internals/core/errors/index.ts';
import { formatHelp } from '#internals/core/help/index.ts';
import type { FlagLookupEntry, ParseOptions } from '#internals/core/parse/index.ts';
import {
	buildFlagLookup,
	flagExpectsValue,
	parse,
	requestsHelp,
	tokenize,
} from '#internals/core/parse/index.ts';
import type { DeprecationWarning, ResolveOptions } from '#internals/core/resolve/index.ts';
import { resolve } from '#internals/core/resolve/index.ts';
import { createCommandSchema } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig, InferFlags } from '#internals/core/schema/flag.ts';
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
interface ReadFlagsOptions extends ResolveOptions {
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
	 * Reject argv content the definitions do not declare.
	 *
	 * `false` drops undeclared input from argv before parsing: unknown long
	 * flags together with their inline `=value`, unknown characters inside a
	 * short group, positional arguments, and the `--` separator, which can only
	 * introduce positionals here. A value token of a declared flag is kept by
	 * walking the same consumption rules the parser applies. Misuse of a
	 * declared flag still fails: a missing value, a bad coercion, or a violated
	 * duplicate policy throws in either mode.
	 * @defaultValue `true`
	 */
	readonly strict?: boolean;

	/**
	 * The built-in `--help`/`-h` handling.
	 *
	 * While `'on'`, a pre-separator `--help` or `-h` prints generated help for
	 * the definitions to the adapter's stdout and exits the process with
	 * code 0. The built-in yields automatically when any definition claims the
	 * `help` or `h` spelling through its name, an alias, a negated form, or a
	 * case-parity counterpart; those spellings then parse as the definition's
	 * own. `'off'` removes the built-in, and the spellings parse like any other
	 * token.
	 * @defaultValue `'on'`
	 */
	readonly help?: 'on' | 'off';

	/**
	 * Receiver for notices produced by `.deprecated()` flags.
	 * @defaultValue `undefined`, which drops the notices
	 */
	readonly onDeprecation?: (warning: DeprecationWarning) => void;
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
 * The final path segment of the adapter's script entry, for the help usage
 * line. Falls back to `script` when the adapter carries no script path.
 */
function scriptName(adapter: RuntimeAdapter): string {
	const path = adapter.argv[1] ?? '';
	const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
	return base === '' ? 'script' : base;
}

/**
 * Drop argv entries the lookup does not declare: unknown long flags with their
 * inline value, unknown characters inside a short group, positional arguments,
 * and the `--` separator. The walk mirrors the parser's value consumption, so
 * the token after a declared value-expecting flag survives as that flag's
 * value while the token after an unknown flag is dropped as a positional.
 */
function withoutUndeclaredTokens(
	argv: readonly string[],
	lookup: ReadonlyMap<string, FlagLookupEntry>,
): readonly string[] {
	const tokens = tokenize(argv);
	const kept: string[] = [];
	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		const raw = argv[i];
		if (token === undefined || raw === undefined) break;

		if (token.kind === 'positional' || token.kind === 'separator') {
			i++;
			continue;
		}

		if (token.kind === 'long-flag') {
			const entry = lookup.get(token.name);
			i++;
			if (entry === undefined) continue;
			kept.push(raw);
			if (!entry.negated && token.value === undefined && flagExpectsValue(entry.schema)) {
				const nextRaw = argv[i];
				if (tokens[i]?.kind === 'positional' && nextRaw !== undefined) {
					kept.push(nextRaw);
					i++;
				}
			}
			continue;
		}

		let declared = '';
		let awaitsValue = false;
		for (let ci = 0; ci < token.chars.length; ci++) {
			const ch = token.chars.charAt(ci);
			const entry = lookup.get(ch);
			if (entry === undefined) continue;
			declared += ch;
			if (flagExpectsValue(entry.schema)) {
				const inline = token.chars.slice(ci + 1);
				if (inline.length > 0) declared += inline;
				else awaitsValue = true;
				break;
			}
		}
		i++;
		if (declared.length === 0) continue;
		kept.push(`-${declared}`);
		if (awaitsValue) {
			const nextRaw = argv[i];
			if (tokens[i]?.kind === 'positional' && nextRaw !== undefined) {
				kept.push(nextRaw);
				i++;
			}
		}
	}
	return kept;
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
 * A pre-separator `--help` or `-h` prints generated help to the adapter's
 * stdout and exits with code 0, unless {@linkcode ReadFlagsOptions.help} is
 * `'off'` or a definition claims either spelling. With
 * {@linkcode ReadFlagsOptions.strict} set to `false`, undeclared argv content
 * is dropped instead of rejected, so a script can read its own flags out of an
 * argv it shares with another consumer.
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
 *   `__proto__`, which JavaScript cannot carry as a plain record key.
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
 *
 * @example
 * ```ts
 * const values = await readFlags(
 *   { watch: flag.boolean() },
 *   { argv: ['build', '--watch', '--unknown'], env: {}, strict: false },
 * );
 *
 * values.watch; // true, with 'build' and '--unknown' dropped
 * ```
 */
async function readFlags<const F extends FlagMap>(
	definitions: F,
	options?: ReadFlagsOptions,
): Promise<InferFlags<F>> {
	for (const key of Reflect.ownKeys(definitions)) {
		if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(definitions, key)) {
			throw new CLIError('Flag definitions must use enumerable string keys', {
				code: 'INVALID_SCHEMA',
			});
		}
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
	const lookup = buildFlagLookup(schema.flags, options?.parse);

	if (
		(options?.help ?? 'on') === 'on' &&
		!lookup.has('help') &&
		!lookup.has('h') &&
		requestsHelp(argv)
	) {
		host().stdout(formatHelp(schema, { binName: scriptName(host()), isDefaultHelp: true }));
		host().exit(0);
	}

	const parsed = parse(
		schema,
		options?.strict === false ? withoutUndeclaredTokens(argv, lookup) : argv,
		options?.parse,
	);

	const resolved = await resolve(schema, parsed, {
		env: options?.env ?? host().env,
		stat: options?.stat ?? ((path: string) => host().stat(path)),
		mkdir: options?.mkdir ?? ((path: string) => host().mkdir(path)),
		...(options?.config !== undefined ? { config: options.config } : {}),
		...(options?.prompter !== undefined ? { prompter: options.prompter } : {}),
		...(options?.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
	});

	for (const warning of resolved.deprecations) {
		options?.onDeprecation?.(warning);
	}

	return resolved.flags as InferFlags<F>;
}

export type { FlagMap, ReadFlagsOptions };
export { readFlags };
