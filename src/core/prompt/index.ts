/**
 * Prompt engine interface and implementations.
 *
 * The prompt engine is the pluggable rendering seam for interactive
 * flag resolution. The framework ships two implementations:
 *
 * - `createTerminalPrompter(read, write)` — line-based terminal I/O
 * - `createTestPrompter(answers)` — pre-configured answers for testing
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
 * Implementations render a single prompt to the user and return the
 * result. The engine is stateless per call — each `promptOne` is
 * independent.
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

// --- Sentinel for cancelled prompts in test prompter

/**
 * Sentinel value representing a cancelled/aborted prompt in the test
 * prompter's answer queue.
 *
 * Uses `Symbol.for()` for cross-bundle safety — the same symbol is
 * returned regardless of which copy of the module is loaded.
 *
 * @example
 * ```ts
 * const prompter = createTestPrompter([
 *   'us',           // first prompt answered 'us'
 *   PROMPT_CANCEL,  // second prompt cancelled
 * ]);
 * ```
 */
const PROMPT_CANCEL: unique symbol = Symbol.for('dreamcli.prompt.cancel') as typeof PROMPT_CANCEL;

/**
 * A queued answer consumed by {@link createTestPrompter}.
 *
 * The test prompter returns these values exactly as provided; it does not
 * coerce them. The one exception mirrors the terminal prompter: a string answer
 * to an `input` prompt is run through the prompt's `validate` function, and a
 * failing answer is rejected as a cancellation (see {@link createTestPrompter}).
 * The normal resolution pipeline performs any later type coercion, so tests can
 * supply values in the same shapes real prompts would yield:
 *
 * - `string` for `input` and `select`
 * - `boolean` for `confirm`
 * - `string[]` for `multiselect`
 * - `PROMPT_CANCEL` to simulate user cancellation
 *
 * Because the type is intentionally `unknown`, tests may also inject malformed
 * answers to exercise downstream validation and error reporting.
 */
type TestAnswer = unknown;

// --- Test prompter

/**
 * Options for `createTestPrompter`.
 */
interface TestPrompterOptions {
	/**
	 * Behavior when all answers have been consumed.
	 *
	 * - `'throw'` (default) — throws an error, making the test fail
	 *   loudly if more prompts fire than expected.
	 * - `'cancel'` — returns `{ answered: false }`, simulating the
	 *   user cancelling all subsequent prompts.
	 */
	readonly onExhausted?: 'throw' | 'cancel';
}

/**
 * Create a prompt engine that returns pre-configured answers.
 *
 * Each call to `promptOne` consumes the next answer from the queue.
 * Pass `PROMPT_CANCEL` as an answer to simulate the user cancelling
 * that prompt.
 *
 * For `input` prompts that declare a `validate` function, a string answer is
 * validated just as the terminal prompter does. An answer that fails validation
 * is rejected as a cancellation (`{ answered: false }`) — mirroring the terminal
 * prompter exhausting its retries — so prompt validation is integration-testable
 * via {@linkcode runCommand} rather than silently accepted as the resolved value.
 *
 * @param answers - Ordered queue of answers. Use `PROMPT_CANCEL` for
 *   cancellation.
 * @param options - Controls behavior when the queue is exhausted.
 * @returns A {@linkcode PromptEngine} suitable for testing.
 *
 * @example
 * ```ts
 * const prompter = createTestPrompter(['eu', true, PROMPT_CANCEL]);
 *
 * // First promptOne → { answered: true, value: 'eu' }
 * // Second promptOne → { answered: true, value: true }
 * // Third promptOne → { answered: false }
 * ```
 */
function createTestPrompter(
	answers: readonly TestAnswer[],
	options?: TestPrompterOptions,
): PromptEngine {
	let index = 0;
	return {
		promptOne(config): Promise<PromptResult> {
			if (index >= answers.length) {
				if (options?.onExhausted === 'cancel') {
					return Promise.resolve({ answered: false });
				}
				return Promise.reject(
					new Error(
						`Test prompter exhausted: expected at most ${answers.length} prompts, got prompt #${index + 1}`,
					),
				);
			}
			const answer = answers[index];
			index += 1;
			if (answer === PROMPT_CANCEL) {
				return Promise.resolve({ answered: false });
			}
			// Mirror the terminal prompter's `input` contract: run `config.validate`
			// against the queued answer so prompt validation is integration-testable
			// (#36). A failing answer is rejected the way the terminal prompter
			// rejects after exhausting its retries — as a cancellation — so the
			// resolution pipeline surfaces it (required-flag error / default
			// fallback) instead of injecting the invalid value verbatim. Only
			// `input` prompts carry a validator and only string answers are the
			// shape the terminal prompter would ever validate; non-string answers
			// stay verbatim so downstream coercion paths remain testable.
			if (config.kind === 'input' && config.validate !== undefined && typeof answer === 'string') {
				if (config.validate(answer) !== true) {
					return Promise.resolve({ answered: false });
				}
			}
			return Promise.resolve({ answered: true, value: answer });
		},
	};
}

// --- Terminal prompter — line-based interactive prompts

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
	TestAnswer,
	TestPrompterOptions,
};
export { createTestPrompter, PROMPT_CANCEL, resolvePromptConfig };
