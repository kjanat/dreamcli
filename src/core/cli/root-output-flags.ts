/**
 * The root output-flag layer: `--json` and `--quiet`/`-q`.
 *
 * These flags belong to the CLI root instead of any command schema, so every
 * layer that needs the output mode (planner dispatch, `.execute()`, `.run()`
 * preflight, `resolveRenderContext()`, testkit `runCommand()`) reads and strips
 * them through {@linkcode readRootOutputFlags}. Values follow `flag.boolean()`:
 * bare presence, `=true`/`=1`, `=false`/`=0`, last occurrence wins, and an
 * invalid literal produces the parser's own `INVALID_VALUE` error.
 *
 * A built-in released through `.builtins({ json: 'off' })` is neither read nor
 * stripped here, so its tokens reach normal command parsing (#86).
 *
 * @module dreamcli/core/cli/root-output-flags
 * @internal
 */

import { ParseError } from '#internals/core/errors/index.ts';
import type { Verbosity } from '#internals/core/output/contracts.ts';
import { coerceFlagValue } from '#internals/core/parse/index.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { BuiltinsConfig } from './builtins.ts';
import { BUILTIN_SPECS, builtinEnabled } from './builtins.ts';

/** Canonical name of a root output flag. @internal */
type RootOutputFlagName = 'json' | 'quiet';

/** What argv said about one root output flag. @internal */
type RootFlagSelection = 'absent' | 'on' | 'off';

/** Selections plus the argv the command layer should see. @internal */
interface RootOutputFlagSelections {
	/** Selection for `--json`. */
	readonly json: RootFlagSelection;
	/** Selection for `--quiet`/`-q`. */
	readonly quiet: RootFlagSelection;
	/** Argv with the pre-separator root output flags removed. */
	readonly argv: readonly string[];
}

/** Every root output flag token carried a valid value. @internal */
interface RootOutputFlagsOk extends RootOutputFlagSelections {
	/** Discriminant. */
	readonly kind: 'ok';
}

/** One token carried a value the boolean coercion rejected. @internal */
interface RootOutputFlagsFailed extends RootOutputFlagSelections {
	/** Discriminant. */
	readonly kind: 'failed';
	/** Error from the first rejected token. */
	readonly error: ParseError;
}

/** Result of reading the root output flags out of argv. @internal */
type RootOutputFlags = RootOutputFlagsOk | RootOutputFlagsFailed;

/** One argv token resolved against the root output flags. */
type RootTokenMatch =
	| { readonly kind: 'unrelated' }
	| { readonly kind: 'flag'; readonly name: RootOutputFlagName; readonly selection: 'on' | 'off' }
	| { readonly kind: 'invalid'; readonly error: ParseError };

/** The schema root `--json`/`--quiet` share with a command-level boolean flag. */
const rootBooleanSchema = flag.boolean().schema;

/** The built-ins whose tokens this module reads, in stable order. */
const ROOT_OUTPUT_NAMES: readonly RootOutputFlagName[] = ['json', 'quiet'];

/** Index the spellings of one kind, taken from the shared built-in table. */
function spellingIndex(kind: 'long' | 'short'): ReadonlyMap<string, RootOutputFlagName> {
	const index = new Map<string, RootOutputFlagName>();
	for (const name of ROOT_OUTPUT_NAMES) {
		for (const spelling of BUILTIN_SPECS[name][kind]) index.set(spelling, name);
	}
	return index;
}

/** Long spellings, the only ones the tokenizer lets carry an inline `=value`. */
const ROOT_LONG_SPELLINGS: ReadonlyMap<string, RootOutputFlagName> = spellingIndex('long');

/** Short spellings, which have no inline-value form. */
const ROOT_SHORT_SPELLINGS: ReadonlyMap<string, RootOutputFlagName> = spellingIndex('short');

/** Coerce an inline `=value` the way a command-level boolean flag coerces it. */
function coerceRootValue(name: RootOutputFlagName, spelling: string, raw: string): RootTokenMatch {
	try {
		const value = coerceFlagValue(name, raw, rootBooleanSchema, spelling);
		return { kind: 'flag', name, selection: value === true ? 'on' : 'off' };
	} catch (error: unknown) {
		if (error instanceof ParseError) return { kind: 'invalid', error };
		throw error;
	}
}

/** Look up a spelling, skipping built-ins the CLI released to its commands. */
function ownedName(
	index: ReadonlyMap<string, RootOutputFlagName>,
	spelling: string,
	builtins: BuiltinsConfig | undefined,
): RootOutputFlagName | undefined {
	const name = index.get(spelling);
	if (name === undefined || !builtinEnabled(builtins, name)) return undefined;
	return name;
}

/** Resolve one pre-separator argv token against the root output flags. */
function matchRootToken(token: string, builtins: BuiltinsConfig | undefined): RootTokenMatch {
	const shortName = ownedName(ROOT_SHORT_SPELLINGS, token, builtins);
	if (shortName !== undefined) return { kind: 'flag', name: shortName, selection: 'on' };

	const bareName = ownedName(ROOT_LONG_SPELLINGS, token, builtins);
	if (bareName !== undefined) return { kind: 'flag', name: bareName, selection: 'on' };

	const equals = token.indexOf('=');
	if (equals === -1) return { kind: 'unrelated' };

	const spelling = token.slice(0, equals);
	const valuedName = ownedName(ROOT_LONG_SPELLINGS, spelling, builtins);
	if (valuedName === undefined) return { kind: 'unrelated' };

	return coerceRootValue(valuedName, spelling, token.slice(equals + 1));
}

/**
 * Read and strip the root output flags from argv.
 *
 * Only tokens before the `--` end-of-options separator are read or stripped, so
 * a literal after `--` reaches the command unchanged (#28). Repeated
 * occurrences follow the `'last'` duplicate policy `flag.boolean()` defaults to.
 *
 * A `'failed'` result still carries the selections and the stripped argv, so a
 * valid `--json` governs how the failure renders and a help or version request
 * can still be honoured ahead of it.
 *
 * @param argv - Raw argv tokens (excluding the binary/script path).
 * @param builtins - Built-in state; a released built-in's tokens are left in
 *   argv untouched. `undefined` keeps both built-ins on.
 * @returns The selections, the stripped argv, and the first invalid value's
 *   error when one occurred.
 * @internal
 */
function readRootOutputFlags(argv: readonly string[], builtins?: BuiltinsConfig): RootOutputFlags {
	const separatorIndex = argv.indexOf('--');
	const head = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);

	const selections: Record<RootOutputFlagName, RootFlagSelection> = {
		json: 'absent',
		quiet: 'absent',
	};
	const keptHead: string[] = [];
	let error: ParseError | undefined;
	let stripped = false;

	for (const token of head) {
		const match = matchRootToken(token, builtins);
		if (match.kind === 'unrelated') {
			keptHead.push(token);
			continue;
		}
		stripped = true;
		if (match.kind === 'invalid') {
			error ??= match.error;
			continue;
		}
		selections[match.name] = match.selection;
	}

	const strippedArgv = !stripped
		? argv
		: separatorIndex === -1
			? keptHead
			: [...keptHead, ...argv.slice(separatorIndex)];
	const resolved = { json: selections.json, quiet: selections.quiet, argv: strippedArgv };

	return error !== undefined ? { kind: 'failed', ...resolved, error } : { kind: 'ok', ...resolved };
}

/**
 * Resolve JSON mode from the argv selection and an explicit override.
 *
 * An explicit `--json=false` wins over the override; the override applies when
 * argv says nothing.
 *
 * @param flags - Result of {@linkcode readRootOutputFlags}.
 * @param override - Caller-supplied `jsonMode`.
 * @returns Whether the run renders JSON.
 * @internal
 */
function resolveRootJsonMode(flags: RootOutputFlags, override: boolean | undefined): boolean {
	if (flags.json === 'absent') return override === true;
	return flags.json === 'on';
}

/**
 * Resolve verbosity from the argv selection and an explicit override.
 *
 * @param flags - Result of {@linkcode readRootOutputFlags}.
 * @param override - Caller-supplied verbosity.
 * @returns `'quiet'` for `--quiet`, `'normal'` for `--quiet=false`, and the
 *   override when argv says nothing.
 * @internal
 */
function resolveRootVerbosity(
	flags: RootOutputFlags,
	override: Verbosity | undefined,
): Verbosity | undefined {
	if (flags.quiet === 'on') return 'quiet';
	if (flags.quiet === 'off') return 'normal';
	return override;
}

export type { RootOutputFlagName, RootOutputFlags };
export { readRootOutputFlags, resolveRootJsonMode, resolveRootVerbosity };
