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
import type { CommandSchema } from '#internals/core/schema/index.ts';

/** Ordered flag resolution stages owned by the resolver. */
const FLAG_RESOLUTION_ORDER = ['cli', 'env', 'config', 'prompt', 'default'] as const;

/** Ordered arg resolution stages owned by the resolver. */
const ARG_RESOLUTION_ORDER = ['cli', 'stdin', 'env', 'default'] as const;

/** Stable flag-source labels for precedence and diagnostics. */
type FlagResolutionStage = (typeof FLAG_RESOLUTION_ORDER)[number];

/** Stable arg-source labels for precedence and diagnostics. */
type ArgResolutionStage = (typeof ARG_RESOLUTION_ORDER)[number];

/**
 * Source-aware diagnostic context for flag resolution failures.
 *
 * CLI/default failures currently surface as missing-value validation errors,
 * so only env/config/prompt need explicit source payloads here.
 */
type FlagDiagnosticSource =
	| { readonly kind: 'env'; readonly envVar: string }
	| { readonly kind: 'config'; readonly configPath: string }
	| { readonly kind: 'prompt' };

/** Source-aware diagnostic context for arg resolution failures. */
type ArgDiagnosticSource =
	| { readonly kind: 'env'; readonly envVar: string }
	| { readonly kind: 'stdin' };

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

/** Fully resolved command input handed to the executor layer. */
interface ResolveResult {
	/** Fully resolved flag values keyed by flag name. */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Fully resolved positional arg values keyed by arg name. */
	readonly args: Readonly<Record<string, unknown>>;
	/** Deprecation notices collected during resolution (may be empty). */
	readonly deprecations: readonly DeprecationWarning[];
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
	/** Ordered stages for flag resolution: cli -> env -> config -> prompt -> default. */
	readonly flagPrecedence: readonly FlagResolutionStage[];
	/** Ordered stages for arg resolution: cli -> stdin -> env -> default. */
	readonly argPrecedence: readonly ArgResolutionStage[];
	/** Prompt stage runs only after env and config have been attempted. */
	readonly promptRunsAfterFlagConfig: true;
	/** All validation errors are collected before throwing a single aggregate. */
	readonly aggregatesValidationErrors: true;
	/** Aggregate error details include per-issue structured summaries. */
	readonly aggregateDiagnosticsIncludePerIssueSummary: true;
	/** A coercion failure at env/config stops fallback to later stages for that flag. */
	readonly hardCoercionErrorsStopFallback: true;
	/** Deprecation warnings are emitted only when a value was actually sourced. */
	readonly collectsDeprecationsFromExplicitSources: true;
}

/** Runtime-accessible resolution contract — documents the resolver's invariants for tests and diagnostics. */
const resolverContract = {
	flagPrecedence: FLAG_RESOLUTION_ORDER,
	argPrecedence: ARG_RESOLUTION_ORDER,
	promptRunsAfterFlagConfig: true,
	aggregatesValidationErrors: true,
	aggregateDiagnosticsIncludePerIssueSummary: true,
	hardCoercionErrorsStopFallback: true,
	collectsDeprecationsFromExplicitSources: true,
} satisfies ResolverContract;

export type {
	ArgDiagnosticSource,
	ArgResolutionStage,
	DeprecationWarning,
	FlagDiagnosticSource,
	FlagResolutionStage,
	ResolveOptions,
	ResolveResult,
	ResolverContract,
	ResolverInvocation,
};
export { ARG_RESOLUTION_ORDER, FLAG_RESOLUTION_ORDER, resolverContract };
