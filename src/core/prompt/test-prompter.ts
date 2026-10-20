/**
 * Scripted prompt engine for tests.
 *
 * `executeCommand()` loads this module on demand when `RunOptions.answers` is
 * set, and `@kjanat/dreamcli/testkit` re-exports it. The package ships this
 * module, but it stays off the normal production hot path.
 *
 * @module dreamcli/core/prompt/test-prompter
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { PromptResult } from '#internals/core/schema/prompt.ts';
import { PromptCancelledError } from './errors.ts';
import type { PromptEngine } from './index.ts';
import { prepareTextAnswer } from './text.ts';

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
 * The test prompter leaves malformed non-string values intact for resolver
 * error tests. Text answers use the same whitespace, empty-answer, default,
 * and validation policy as the terminal prompter. Passwords retry invalid
 * answers; ordinary input retains its cancellation fallback (see {@link createTestPrompter}).
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
 * Password prompts instead consume further queued answers on validation failure,
 * and reject with `PROMPT_INVALID` after ten invalid attempts. `PROMPT_CANCEL`
 * remains a distinct user cancellation.
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
		async promptOne(config): Promise<PromptResult> {
			for (let attempt = 0; attempt < 10; attempt++) {
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
					if (config.kind === 'password') throw new PromptCancelledError();
					return Promise.resolve({ answered: false });
				}
				// Passwords retry from the shared queue. Ordinary input retains its
				// cancellation fallback; malformed values remain available to resolver tests.
				if ((config.kind === 'input' || config.kind === 'password') && typeof answer === 'string') {
					const prepared = await prepareTextAnswer(config, answer);
					if (!prepared.ok && config.kind === 'password') continue;
					return prepared.ok ? { answered: true, value: prepared.value } : { answered: false };
				}
				return Promise.resolve({ answered: true, value: answer });
			}
			throw new CLIError('Too many invalid prompt answers', {
				code: 'PROMPT_INVALID',
				exitCode: 2,
			});
		},
	};
}

// --- Exports

export type { TestAnswer, TestPrompterOptions };
export { createTestPrompter, PROMPT_CANCEL };
