/**
 * Runtime value completion callbacks.
 *
 * @module dreamcli/core/schema/completion
 */

/** The input and partial command line being completed. */
interface CompletionContext {
	/** The value prefix typed before the cursor. */
	readonly prefix: string;
	/** Canonical command names, excluding the executable. Empty for a default command. */
	readonly commandPath: readonly string[];
	/** The input whose value is being completed. */
	readonly input: { readonly kind: 'flag' | 'arg'; readonly name: string };
	/** Arguments before the cursor, including the current partial token. */
	readonly argv: readonly string[];
	/** Environment supplied to this execution. */
	readonly env: Readonly<Record<string, string | undefined>>;
}

/** Return complete candidate values. DreamCLI filters them by prefix. */
type CompletionHandler = (
	context: CompletionContext,
) => readonly string[] | Promise<readonly string[]>;

export type { CompletionContext, CompletionHandler };
