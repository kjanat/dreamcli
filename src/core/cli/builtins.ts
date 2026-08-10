/**
 * Consumer-owned built-in flags: `--help`/`-h`, `--json`, and `--quiet`/`-q`.
 *
 * The root owns these tokens by default. {@linkcode CLIBuilder.builtins} sets a
 * built-in to `'off'`, which releases every spelling it answers to: the root
 * scanner stops reading and stripping it, root help stops advertising it, and
 * the `RESERVED_FLAG` guard stops reserving it, so a command may declare the
 * flag and receive it (#86).
 *
 * This module is the single spelling table behind all three layers. A token
 * added here reaches the scanner, the guard, and the help block in one change.
 *
 * @module dreamcli/core/cli/builtins
 * @internal
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { schemaBrand } from '#internals/core/schema/brand.ts';

/** A built-in flag a consumer can take over. */
type BuiltinName = 'help' | 'json' | 'quiet';

/** Whether the root keeps a built-in or releases it to commands. */
type BuiltinMode = 'on' | 'off';

/**
 * Built-in flag settings accepted by {@linkcode CLIBuilder.builtins} and the
 * `builtins` field of {@link CLIDefinition}.
 *
 * `version` and `completions` are absent by design: `.version()` and
 * `.completions()` are opt-in, so a CLI declines those two by not calling them.
 */
interface BuiltinsConfig {
	/**
	 * Root `--help`/`-h`, command-level `--help`/`-h`, and the bare `help` token.
	 * @defaultValue `'on'`
	 */
	readonly help?: BuiltinMode;
	/**
	 * Root `--json`.
	 * @defaultValue `'on'`
	 */
	readonly json?: BuiltinMode;
	/**
	 * Root `--quiet`/`-q`.
	 * @defaultValue `'on'`
	 */
	readonly quiet?: BuiltinMode;
}

/**
 * Normalized built-in flag state stored on {@link CLISchema}.
 *
 * Sealed by {@link createCLISchema}; every key is present after normalization.
 */
interface Builtins {
	/** Type-only seal produced by {@link createCLISchema}. */
	readonly [schemaBrand]: 'builtins';
	/** Whether the root owns `--help`/`-h` and the bare `help` token. */
	readonly help: BuiltinMode;
	/** Whether the root owns `--json`. */
	readonly json: BuiltinMode;
	/** Whether the root owns `--quiet`/`-q`. */
	readonly quiet: BuiltinMode;
}

/**
 * {@link Builtins} before the type-only seal is applied.
 *
 * @internal
 */
type BuiltinsDraft = Omit<Builtins, typeof schemaBrand>;

/** Everything the framework needs to know about one built-in flag. @internal */
interface BuiltinSpec {
	/** Long spellings, the only forms that carry an inline `=value`. */
	readonly long: readonly string[];
	/** Short spellings, which have no inline-value form. */
	readonly short: readonly string[];
	/** Description shown in the root-help `Global options:` block. */
	readonly description: string;
}

/**
 * The spelling table every built-in-aware layer reads.
 *
 * @internal
 */
const BUILTIN_SPECS: Readonly<Record<BuiltinName, BuiltinSpec>> = {
	help: {
		long: ['--help'],
		short: ['-h'],
		description: 'Show this help message and exit',
	},
	json: {
		long: ['--json'],
		short: [],
		description: 'Emit machine-readable JSON output',
	},
	quiet: {
		long: ['--quiet'],
		short: ['-q'],
		description: 'Suppress informational output',
	},
};

/** Spelling error messages and help entries name a built-in by. @internal */
function builtinSpelling(name: BuiltinName): string {
	return BUILTIN_SPECS[name].long[0] ?? BUILTIN_SPECS[name].short[0] ?? name;
}

/** Built-in names in the order root help advertises them. @internal */
const BUILTIN_NAMES: readonly BuiltinName[] = ['help', 'json', 'quiet'];

/** Every built-in on, the state a CLI starts in. @internal */
const DEFAULT_BUILTINS: BuiltinsDraft = { help: 'on', json: 'on', quiet: 'on' };

/**
 * Whether the root still owns a built-in.
 *
 * @param builtins - Normalized state, or `undefined` for the defaults.
 * @param name - Built-in to check.
 * @returns `true` when the root reads the token, `false` once it is released.
 *
 * @internal
 */
function builtinEnabled(builtins: BuiltinsConfig | undefined, name: BuiltinName): boolean {
	return (builtins?.[name] ?? 'on') === 'on';
}

/**
 * The argv spellings of one built-in, joined for a help entry.
 *
 * @param name - Built-in to render.
 * @returns Short spellings first, e.g. `-h, --help`.
 *
 * @internal
 */
function builtinFlagForms(name: BuiltinName): string {
	const spec = BUILTIN_SPECS[name];
	return [...spec.short, ...spec.long].join(', ');
}

/**
 * The spellings of one built-in as bare tokens, dashes removed.
 *
 * @param name - Built-in to read.
 * @returns Tokens as a command flag would declare them, e.g. `help` and `h`.
 *
 * @internal
 */
function builtinTokens(name: BuiltinName): readonly string[] {
	const spec = BUILTIN_SPECS[name];
	return [...spec.long, ...spec.short].map((spelling) => spelling.replace(/^-+/, ''));
}

/**
 * Read one built-in's mode out of a caller-supplied config.
 *
 * @param config - Caller input, which a JS caller may fill with anything.
 * @param name - Built-in to read.
 * @returns The declared mode, or `'on'` when the key is absent.
 * @throws {@linkcode CLIError} `INVALID_SCHEMA` when the value is neither mode.
 */
function readBuiltinMode(config: BuiltinsConfig, name: BuiltinName): BuiltinMode {
	const mode = config[name];
	if (mode === undefined || mode === 'on' || mode === 'off') return mode ?? 'on';

	throw new CLIError(`Built-in '${name}' must be 'on' or 'off'`, {
		code: 'INVALID_SCHEMA',
		details: { builtin: name, value: mode },
		suggest: `Pass { ${name}: 'off' } to release the flag, or omit the key to keep it on`,
	});
}

/**
 * Normalize built-in settings into the fully populated schema state.
 *
 * Shared by {@link createCLISchema} and {@linkcode CLIBuilder.builtins}, so both
 * construction paths produce identical state. Re-feeding a normalized value
 * returns an equal value.
 *
 * @param config - Caller-supplied settings, or `undefined` for the defaults.
 * @returns Every built-in resolved to a mode.
 * @throws {@linkcode CLIError} `INVALID_SCHEMA` for a value that is neither
 *   `'on'` nor `'off'`.
 *
 * @internal
 */
function normalizeBuiltins(config: BuiltinsConfig | undefined): BuiltinsDraft {
	if (config === undefined) return DEFAULT_BUILTINS;
	return {
		help: readBuiltinMode(config, 'help'),
		json: readBuiltinMode(config, 'json'),
		quiet: readBuiltinMode(config, 'quiet'),
	};
}

export type { BuiltinMode, BuiltinName, BuiltinSpec, Builtins, BuiltinsConfig, BuiltinsDraft };
export {
	BUILTIN_NAMES,
	BUILTIN_SPECS,
	builtinEnabled,
	builtinFlagForms,
	builtinSpelling,
	builtinTokens,
	DEFAULT_BUILTINS,
	normalizeBuiltins,
};
