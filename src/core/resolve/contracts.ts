/**
 * Internal resolver contract for precedence, diagnostics, and I/O shape.
 *
 * Captures the stable seam between parsed command input and resolved command
 * values before the larger resolver module is split by concern.
 *
 * @module dreamcli/core/resolve/contracts
 * @internal
 */

import type { ParseResult } from '#internals/core/parse/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import type { CommandSchema, PathChecks } from '#internals/core/schema/index.ts';
import type { ResolutionProvenance } from '#internals/core/schema/provenance.ts';
import type { ResolutionStage } from '#internals/core/schema/source.ts';
import { RESOLUTION_ORDER } from '#internals/core/schema/source.ts';

/**
 * Source-aware diagnostic context for a resolution failure.
 *
 * `'cli'` covers the tokens the user typed, which a message names by the input
 * alone; the other stages each carry what a message needs to point at the value
 * they produced. Both surfaces read the same set.
 */
type ResolutionDiagnosticSource =
	| { readonly kind: 'cli' }
	| { readonly kind: 'stdin' }
	| { readonly kind: 'env'; readonly envVar: string }
	| {
			/**
			 * Several variables of an indexed env family at once: one record entry
			 * (`index` set) or the whole family (`index` undefined). A value family's
			 * single member is named as a plain `'env'` source instead.
			 */
			readonly kind: 'env-indexed';
			readonly count: string;
			readonly index: number | undefined;
			readonly envVars: readonly string[];
	  }
	| { readonly kind: 'config'; readonly configPath: string }
	| { readonly kind: 'prompt' };

/**
 * The sources whose raw values a resolution stage decodes.
 *
 * A CLI token is decoded at the parse boundary, so it never reaches the
 * coercion diagnostics these name.
 */
type DecodedDiagnosticSource = Exclude<ResolutionDiagnosticSource, { readonly kind: 'cli' }>;

/** Source-aware diagnostic context for flag resolution failures. */
type FlagDiagnosticSource = DecodedDiagnosticSource;

/** Source-aware diagnostic context for arg resolution failures. */
type ArgDiagnosticSource = DecodedDiagnosticSource;

/**
 * External state the resolver may consult after parsing.
 *
 * The resolver never reaches into `process`, files, or terminal APIs directly;
 * callers inject those facts through this contract.
 */
interface ResolveOptions {
	/** Pre-read stdin content, or `null` when stdin was not piped. */
	readonly stdinData?: string | null;
	/** Environment variable snapshot injected by the caller. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** Parsed config file contents keyed by dotted path segments. */
	readonly config?: Readonly<Record<string, unknown>>;
	/** Interactive prompt engine; absent in non-TTY / CI contexts. */
	readonly prompter?: PromptEngine;
	/**
	 * Filesystem probe for `flag.path()` and `arg.path()` checks: what exists
	 * at the path, or `null` when nothing does. When absent, path checks are
	 * skipped.
	 */
	readonly stat?: (path: string) => Promise<'file' | 'directory' | null>;
	/**
	 * Recursive directory creation for `flag.path()` and `arg.path()` `create`
	 * checks. When absent, missing paths are not created and existence rules
	 * apply as-is.
	 */
	readonly mkdir?: (path: string) => Promise<void>;
	/**
	 * What happens to a declared filesystem check that cannot run because
	 * {@link ResolveOptions.stat} (or {@link ResolveOptions.mkdir} for `create`)
	 * is absent.
	 *
	 * - `'lenient'` — the check is skipped and recorded in
	 *   {@link ResolveResult.skippedPathChecks}, so a result can still report
	 *   that it was never exercised.
	 * - `'strict'` — resolution fails with a `CLIError` of code
	 *   `'PATH_CHECK_SKIPPED'` (exit code `1`) naming every skipped input, for
	 *   tests that must exercise each declared check.
	 *
	 * Only inputs that resolved a path value are affected: an unset optional
	 * path has nothing to check in production either.
	 *
	 * @defaultValue `'lenient'`
	 */
	readonly pathChecks?: 'lenient' | 'strict';
}

/**
 * A declared `flag.path()` / `arg.path()` check that resolution had no means
 * to run.
 *
 * Recorded instead of raised when {@link ResolveOptions.pathChecks} is
 * `'lenient'` (the default): the value resolved and the handler ran, but the
 * filesystem was never consulted, so a passing result does not prove the real
 * CLI would accept the same path.
 */
interface SkippedPathCheck {
	/** Whether the path belongs to a flag or a positional arg. */
	readonly kind: 'flag' | 'arg';
	/** Name of the flag or arg. */
	readonly name: string;
	/** The checks the schema declared (`mustExist`, `type`, `create`). */
	readonly checks: PathChecks;
	/**
	 * The capability resolution lacked: `'stat'` when no probe was supplied so
	 * no check ran, or `'mkdir'` when the path was missing, `create` was
	 * declared, and nothing could create it.
	 */
	readonly missing: 'stat' | 'mkdir';
}

/** Structured deprecation notice emitted for explicitly sourced values. */
interface DeprecationWarning {
	/** Whether this deprecation targets a flag or a positional arg. */
	readonly kind: 'flag' | 'arg';
	/** Name of the deprecated flag or arg. */
	readonly name: string;
	/** Custom deprecation message, or `true` for the generic warning. */
	readonly message: string | true;
}

/**
 * Which stage produced each resolved value of one command.
 *
 * The erased form of {@link InputSources}: same records, keyed by plain strings
 * because `resolve()` takes a `CommandSchema` rather than typed builders.
 */
interface ResolutionProvenanceRecord {
	/** Provenance of every declared flag, keyed by flag name. */
	readonly flags: Readonly<Record<string, ResolutionProvenance>>;
	/** Provenance of every declared arg, keyed by arg name. */
	readonly args: Readonly<Record<string, ResolutionProvenance>>;
}

/** Fully resolved command input handed to the executor layer. */
interface ResolveResult {
	/** Fully resolved flag values keyed by flag name. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Fully resolved positional arg values keyed by arg name. */
	readonly args: Readonly<Record<string, unknown>>;
	/** Deprecation notices collected during resolution (may be empty). */
	readonly deprecations: readonly DeprecationWarning[];
	/**
	 * Declared filesystem checks that did not run because no `stat` probe (or
	 * no `mkdir` for `create`) was supplied. Empty when every declared check
	 * ran, or when no resolved value had a check to run.
	 */
	readonly skippedPathChecks: readonly SkippedPathCheck[];
	/**
	 * Which stage produced each value. Present only for inputs that resolved a
	 * value, so an unset optional input has no entry.
	 */
	readonly provenance: ResolutionProvenanceRecord;
}

/** Explicit invocation boundary between parser output and resolved values. */
interface ResolverInvocation {
	/** Command schema that declares flags, args, and resolution metadata. */
	readonly schema: CommandSchema;
	/** Raw parse result from the tokenizer/parser layer. */
	readonly parsed: ParseResult;
	/** Optional external state (env, config, stdin, prompter). */
	readonly options?: ResolveOptions;
}

/**
 * Stable resolver facts the re-foundation workstream is treating as contract.
 *
 * These are intended to anchor focused contract tests before larger module
 * extraction and diagnostic redesign work lands.
 */
interface ResolverContract {
	/** Ordered stages both surfaces walk: cli -> stdin -> env -> config -> prompt -> default. */
	readonly precedence: readonly ResolutionStage[];
	/** Flags and args resolve through the same ordered stages. */
	readonly flagPrecedence: readonly ResolutionStage[];
	/** Flags and args resolve through the same ordered stages. */
	readonly argPrecedence: readonly ResolutionStage[];
	/** Prompt stage runs only after env and config have been attempted. */
	readonly promptRunsAfterFlagConfig: true;
	/** The implicit stdin fallback runs before env, so stdin outranks the environment. */
	readonly stdinFallbackRunsBeforeEnv: true;
	/** An explicit `-` is CLI-sourced with bytes from stdin and keeps CLI precedence. */
	readonly dashIsCliSourced: true;
	/** All validation errors are collected before throwing a single aggregate. */
	readonly aggregatesValidationErrors: true;
	/** Aggregate error details include per-issue structured summaries. */
	readonly aggregateDiagnosticsIncludePerIssueSummary: true;
	/** A coercion failure at any sourced stage stops fallback to later stages for that input. */
	readonly hardCoercionErrorsStopFallback: true;
	/** Deprecation warnings are emitted only when a value was actually sourced. */
	readonly collectsDeprecationsFromExplicitSources: true;
	/** Every resolved value records the stage that produced it. */
	readonly recordsProvenancePerInput: true;
}

/** Runtime-accessible resolution contract — documents the resolver's invariants for tests and diagnostics. */
const resolverContract: ResolverContract = {
	precedence: RESOLUTION_ORDER,
	flagPrecedence: RESOLUTION_ORDER,
	argPrecedence: RESOLUTION_ORDER,
	promptRunsAfterFlagConfig: true,
	stdinFallbackRunsBeforeEnv: true,
	dashIsCliSourced: true,
	aggregatesValidationErrors: true,
	aggregateDiagnosticsIncludePerIssueSummary: true,
	hardCoercionErrorsStopFallback: true,
	collectsDeprecationsFromExplicitSources: true,
	recordsProvenancePerInput: true,
};

export type { ResolutionProvenance } from '#internals/core/schema/provenance.ts';
export type {
	ArgDiagnosticSource,
	DecodedDiagnosticSource,
	DeprecationWarning,
	FlagDiagnosticSource,
	ResolutionDiagnosticSource,
	ResolutionProvenanceRecord,
	ResolveOptions,
	ResolveResult,
	ResolverContract,
	ResolverInvocation,
	SkippedPathCheck,
};
export { RESOLUTION_ORDER, resolverContract };
