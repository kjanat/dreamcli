/**
 * Scripted prompt engine for tests.
 *
 * `executeCommand()` loads this module on demand when `RunOptions.answers` is
 * set, and `@kjanat/dreamcli/testkit` re-exports it. The package ships this
 * module, but it stays off the normal production hot path.
 *
 * @module dreamcli/core/prompt/test-prompter
 */

import type { PromptResult } from '#internals/core/schema/prompt.ts';
import type { PromptEngine } from './index.ts';

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

// --- Exports

export type { TestAnswer, TestPrompterOptions };
export { createTestPrompter, PROMPT_CANCEL };
