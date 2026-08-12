/**
 * Where a resolved value came from.
 *
 * Resolution records one {@link ResolutionProvenance} per input that produced a
 * value, and the same record reaches a handler through `sources` and a
 * `resolve()` caller through `ResolveResult.provenance`. {@link wasExplicit}
 * derives the explicit-versus-defaulted question from it.
 *
 * @module dreamcli/core/schema/provenance
 */

/**
 * Which stage produced a resolved value, and how.
 *
 * `via` and `trigger` distinguish the two ways stdin delivers bytes. An explicit
 * `-` keeps CLI precedence and reports `{ stage: 'cli', via: 'stdin', trigger:
 * 'dash' }`; an absent input takes the fallback stage between CLI and env and
 * reports `{ stage: 'stdin', via: 'stdin', trigger: 'fallback' }`.
 *
 * @example
 * ```ts
 * command('deploy')
 *   .flag('region', flag.string().env('REGION').default('us'))
 *   .action(({ sources }) => {
 *     const region = sources.flags.region;
 *     if (region?.stage === 'env') console.log(`from ${region.envVar}`);
 *   });
 * ```
 */
type ResolutionProvenance =
	| { readonly stage: 'cli' }
	| { readonly stage: 'cli'; readonly via: 'stdin'; readonly trigger: 'dash' }
	| { readonly stage: 'stdin'; readonly via: 'stdin'; readonly trigger: 'fallback' }
	| { readonly stage: 'env'; readonly envVar: string }
	| { readonly stage: 'config'; readonly configPath: string }
	| { readonly stage: 'prompt' }
	| { readonly stage: 'default' };

/**
 * Provenance of every input of one surface, keyed by input name.
 *
 * An input that resolved no value has no record, so every member is optional in
 * value even though the key set is the surface's own.
 *
 * @typeParam T - The record of flag or arg builders whose keys this mirrors.
 */
type SourcesOf<T> = { readonly [K in keyof T]: ResolutionProvenance | undefined };

/**
 * Where each of a command's resolved values came from.
 *
 * Handed to an action, derive, or middleware handler as `sources`, keyed by the
 * same names as `flags` and `args`.
 *
 * @typeParam F - The command's flag builders.
 * @typeParam A - The command's arg builders.
 */
interface InputSources<F, A> {
	/** Provenance of every declared flag, keyed by flag name. */
	readonly flags: SourcesOf<F>;
	/** Provenance of every declared arg, keyed by arg name. */
	readonly args: SourcesOf<A>;
}

/**
 * Whether a value came from somewhere other than its declared default.
 *
 * Every stage but `'default'` means the value was supplied: typed on the command
 * line, piped, exported, written in a config file, or answered at a prompt. An
 * input that resolved no value at all has no record and is not explicit.
 *
 * Read `stage` directly for a narrower question, such as `stage === 'cli'` for
 * "the user typed it on this command line".
 *
 * @param source - The provenance record of one input, or `undefined`.
 * @returns `true` when a source other than the default produced the value.
 *
 * @example
 * ```ts
 * command('build')
 *   .flag('out', flag.string().default('dist'))
 *   .action(({ sources, out }) => {
 *     if (wasExplicit(sources.flags.out)) out.info('using an overridden output');
 *   });
 * ```
 */
function wasExplicit(source: ResolutionProvenance | undefined): boolean {
	return source !== undefined && source.stage !== 'default';
}

export type { InputSources, ResolutionProvenance, SourcesOf };
export { wasExplicit };
