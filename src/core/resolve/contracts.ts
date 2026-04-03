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
	readonly stdinData?: string | null;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly config?: Readonly<Record<string, unknown>>;
	readonly prompter?: PromptEngine;
}

/** Structured deprecation notice emitted for explicitly sourced values. */
interface DeprecationWarning {
	readonly kind: 'flag' | 'arg';
	readonly name: string;
	readonly message: string | true;
}

/** Fully resolved command input handed to the executor layer. */
interface ResolveResult {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly deprecations: readonly DeprecationWarning[];
}

/** Explicit invocation boundary between parser output and resolved values. */
interface ResolverInvocation {
	readonly schema: CommandSchema;
	readonly parsed: ParseResult;
	readonly options?: ResolveOptions;
}

/**
 * Stable resolver facts the re-foundation workstream is treating as contract.
 *
 * These are intended to anchor focused contract tests before larger module
 * extraction and diagnostic redesign work lands.
 */
interface ResolverContract {
	readonly flagPrecedence: readonly FlagResolutionStage[];
	readonly argPrecedence: readonly ArgResolutionStage[];
	readonly promptRunsAfterFlagConfig: true;
	readonly aggregatesValidationErrors: true;
	readonly aggregateDiagnosticsIncludePerIssueSummary: true;
	readonly hardCoercionErrorsStopFallback: true;
	readonly collectsDeprecationsFromExplicitSources: true;
}

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
