/**
 * Prompt engine interface and implementations.
 *
 * The prompt engine is the pluggable rendering seam for interactive
 * flag resolution. The framework ships two implementations, each in its own
 * module so neither sits on the hot path:
 *
 * - `createTerminalPrompter(read, write)` in `terminal.ts` — line-based terminal I/O
 * - `createTestPrompter(answers)` in `test-prompter.ts` — pre-configured answers for testing
 *
 * Custom engines implement the {@linkcode PromptEngine} interface to swap in
 * alternative UI (e.g. web-based, TUI library, etc.).
 *
 * The engine receives a {@linkcode ResolvedPromptConfig} — a variant of
 * {@linkcode PromptConfig} where select/multiselect choices are guaranteed
 * non-empty. The resolution chain handles merging enum values from
 * `FlagSchema` into choices before calling the engine.
 *
 * @module dreamcli/core/prompt
 */

import type {
	ConfirmPromptConfig,
	InputPromptConfig,
	PromptConfig,
	PromptResult,
	SelectChoice,
} from '#internals/core/schema/prompt.ts';

// --- Resolved prompt config — choices guaranteed present for select kinds

/**
 * A select prompt config with choices guaranteed non-empty.
 *
 * The resolution chain populates choices from `FlagSchema.enumValues`
 * when the user's {@linkcode PromptConfig} omits them.
 */
interface ResolvedSelectPromptConfig {
	/** Discriminant — single-choice selection prompt. */
	readonly kind: 'select';
	/** User-facing question text. */
	readonly message: string;
	/** Non-empty list of selectable options (populated from flag enum values when omitted). */
	readonly choices: readonly [SelectChoice, ...SelectChoice[]];
}

/**
 * A multiselect prompt config with choices guaranteed non-empty.
 *
 * Same guarantee as {@linkcode ResolvedSelectPromptConfig} — choices are always
 * present and non-empty.
 */
interface ResolvedMultiselectPromptConfig {
	/** Discriminant — multiple-choice selection prompt. */
	readonly kind: 'multiselect';
	/** User-facing question text. */
	readonly message: string;
	/** Non-empty list of selectable options (populated from flag enum values when omitted). */
	readonly choices: readonly [SelectChoice, ...SelectChoice[]];
	/** Minimum number of selections required (validated after input). */
	readonly min?: number;
	/** Maximum number of selections allowed (validated after input). */
	readonly max?: number;
}

/**
 * Prompt config variant where select/multiselect choices are guaranteed
 * present. The prompt engine receives this (not raw {@linkcode PromptConfig}),
 * so it never needs to merge enum values from `FlagSchema`.
 *
 * confirm and input configs pass through unchanged.
 */
type ResolvedPromptConfig =
	| ConfirmPromptConfig
	| InputPromptConfig
	| ResolvedSelectPromptConfig
	| ResolvedMultiselectPromptConfig;

// --- PromptEngine interface — the pluggable seam

/**
 * Prompt engine interface.
 *
 * Implementations present one prompt per `promptOne()` call and return
 * the result. Engines may retain state across calls, such as an answer queue.
 *
 * The resolution chain calls `promptOne` for each flag that needs
 * interactive input. Engines do not need schema knowledge — all
 * relevant context (message, choices, validation) is in the config.
 *
 * @example
 * ```ts
 * // Custom engine (e.g. wrapping @clack/prompts)
 * const engine: PromptEngine = {
 *   async promptOne(config) {
 *     // ... render with your library
 *     return { answered: true, value: userInput };
 *   }
 * };
 * ```
 */
interface PromptEngine {
	/**
	 * Present a single prompt and return the user's response.
	 *
	 * @param config - The resolved prompt configuration (choices guaranteed
	 *   for select/multiselect).
	 * @returns The user's answer, or `{ answered: false }` if cancelled.
	 */
	promptOne(config: ResolvedPromptConfig): Promise<PromptResult>;
}

// --- ReadFn — the minimal stdin abstraction

/**
 * A function that reads a single line of user input.
 *
 * Returns `null` on EOF (Ctrl+D on Unix, Ctrl+Z on Windows),
 * indicating the user closed the input stream (treated as cancel).
 *
 * The terminal prompter uses this as its sole input seam. The
 * resolution chain (prompt-adapter-1) will wire this to the
 * runtime adapter's stdin.
 */
type ReadFn = () => Promise<string | null>;

// --- Utility: prepare resolved prompt config from raw config + flag schema

/**
 * Prepare a {@linkcode ResolvedPromptConfig} from a raw {@linkcode PromptConfig} and optional
 * enum values from the flag schema.
 *
 * For select/multiselect prompts without explicit choices, this merges
 * the flag's enum values into the choices list. Throws if no choices
 * are available.
 *
 * This function is called by the resolution chain (prompt-resolve-1),
 * not by the engine itself — keeping the engine free of schema knowledge.
 *
 * @param config - Raw prompt config from `FlagSchema.prompt`
 * @param enumValues - Optional enum values from `FlagSchema.enumValues`
 * @returns Resolved config with choices guaranteed for select kinds
 * @throws Error if select/multiselect has no choices and no enum values
 */
function resolvePromptConfig(
	config: PromptConfig,
	enumValues: readonly string[] | undefined,
): ResolvedPromptConfig {
	if (config.kind === 'confirm' || config.kind === 'input') {
		return config;
	}

	// Select or multiselect — ensure choices are present
	const rawChoices: readonly SelectChoice[] =
		config.choices ?? enumValues?.map((v) => ({ value: v })) ?? [];

	if (rawChoices.length === 0) {
		throw new Error(
			`Prompt config (${config.kind}) requires choices but none were provided and no enum values are available`,
		);
	}

	// Non-empty assertion: we just checked length > 0
	const choices = rawChoices as readonly [SelectChoice, ...SelectChoice[]];

	if (config.kind === 'select') {
		return { kind: 'select', message: config.message, choices };
	}

	return {
		kind: 'multiselect',
		message: config.message,
		choices,
		...(config.min !== undefined ? { min: config.min } : {}),
		...(config.max !== undefined ? { max: config.max } : {}),
	};
}

// --- Exports

export type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedPromptConfig,
	ResolvedSelectPromptConfig,
};
export { resolvePromptConfig };
