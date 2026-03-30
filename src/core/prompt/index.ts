/**
 * Prompt engine interface and implementations.
 *
 * The prompt engine is the pluggable rendering seam for interactive
 * flag resolution. The framework ships two implementations:
 *
 * - `createTerminalPrompter(read, write)` — line-based terminal I/O
 * - `createTestPrompter(answers)` — pre-configured answers for testing
 *
 * Custom engines implement the `PromptEngine` interface to swap in
 * alternative UI (e.g. web-based, TUI library, etc.).
 *
 * The engine receives a `ResolvedPromptConfig` — a variant of
 * `PromptConfig` where select/multiselect choices are guaranteed
 * non-empty. The resolution chain handles merging enum values from
 * `FlagSchema` into choices before calling the engine.
 *
 * @module dreamcli/core/prompt
 */

import type { WriteFn } from '../output/index.ts';
import type {
	ConfirmPromptConfig,
	InputPromptConfig,
	PromptConfig,
	PromptResult,
	SelectChoice,
} from '../schema/prompt.ts';

// ---------------------------------------------------------------------------
// Resolved prompt config — choices guaranteed present for select kinds
// ---------------------------------------------------------------------------

/**
 * A select prompt config with choices guaranteed non-empty.
 *
 * The resolution chain populates choices from `FlagSchema.enumValues`
 * when the user's `PromptConfig` omits them.
 */
interface ResolvedSelectPromptConfig {
	readonly kind: 'select';
	readonly message: string;
	readonly choices: readonly [SelectChoice, ...SelectChoice[]];
}

/**
 * A multiselect prompt config with choices guaranteed non-empty.
 *
 * Same guarantee as `ResolvedSelectPromptConfig` — choices are always
 * present and non-empty.
 */
interface ResolvedMultiselectPromptConfig {
	readonly kind: 'multiselect';
	readonly message: string;
	readonly choices: readonly [SelectChoice, ...SelectChoice[]];
	readonly min?: number;
	readonly max?: number;
}

/**
 * Prompt config variant where select/multiselect choices are guaranteed
 * present. The prompt engine receives this (not raw `PromptConfig`),
 * so it never needs to merge enum values from `FlagSchema`.
 *
 * confirm and input configs pass through unchanged.
 */
type ResolvedPromptConfig =
	| ConfirmPromptConfig
	| InputPromptConfig
	| ResolvedSelectPromptConfig
	| ResolvedMultiselectPromptConfig;

// ---------------------------------------------------------------------------
// PromptEngine interface — the pluggable seam
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ReadFn — the minimal stdin abstraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sentinel for cancelled prompts in test prompter
// ---------------------------------------------------------------------------

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
 * coerce or validate them. The normal resolution pipeline performs any later
 * type coercion, so tests can supply values in the same shapes real prompts
 * would yield:
 *
 * - `string` for `input` and `select`
 * - `boolean` for `confirm`
 * - `string[]` for `multiselect`
 * - {@link PROMPT_CANCEL} to simulate user cancellation
 *
 * Because the type is intentionally `unknown`, tests may also inject malformed
 * answers to exercise downstream validation and error reporting.
 */
type TestAnswer = unknown;

// ---------------------------------------------------------------------------
// Test prompter
// ---------------------------------------------------------------------------

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
 * @param answers - Ordered queue of answers. Use `PROMPT_CANCEL` for
 *   cancellation.
 * @param options - Controls behavior when the queue is exhausted.
 * @returns A `PromptEngine` suitable for testing.
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
		promptOne(): Promise<PromptResult> {
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
			return Promise.resolve({ answered: true, value: answer });
		},
	};
}

// ---------------------------------------------------------------------------
// Terminal prompter — line-based interactive prompts
// ---------------------------------------------------------------------------

/**
 * Create a prompt engine backed by line-based terminal I/O.
 *
 * Uses a `ReadFn` for input and a `WriteFn` for output. This is the
 * built-in renderer — sufficient for most CLI use cases. For richer
 * TUI experiences, users can implement `PromptEngine` with a library
 * like `@clack/prompts` or `inquirer`.
 *
 * The prompter does **not** use raw mode — all input is line-based.
 * This keeps the implementation portable across Node, Bun, and Deno
 * without platform-specific stdin configuration.
 *
 * @param read - Line reader function (returns `null` on EOF)
 * @param write - Output writer function
 * @returns A `PromptEngine` that prompts via terminal I/O
 *
 * @example
 * ```ts
 * import { createInterface } from 'readline';
 *
 * const rl = createInterface({ input: process.stdin, output: process.stdout });
 * const read = () => new Promise<string | null>((resolve) => {
 *   rl.question('', (answer) => resolve(answer));
 * });
 * const write: WriteFn = (s) => process.stdout.write(s);
 *
 * const prompter = createTerminalPrompter(read, write);
 * ```
 */
function createTerminalPrompter(read: ReadFn, write: WriteFn): PromptEngine {
	return {
		async promptOne(config): Promise<PromptResult> {
			switch (config.kind) {
				case 'confirm':
					return promptConfirm(config, read, write);
				case 'input':
					return promptInput(config, read, write);
				case 'select':
					return promptSelect(config, read, write);
				case 'multiselect':
					return promptMultiselect(config, read, write);
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Per-kind prompt implementations
// ---------------------------------------------------------------------------

/** Maximum retries for invalid input before treating as cancel. */
const MAX_RETRIES = 10;

/**
 * Confirm prompt: yes/no question.
 *
 * Displays `(Y/n)` or `(y/N)` depending on the default (if any).
 * Accepts: y, yes, n, no, empty (uses default). Case-insensitive.
 */
async function promptConfirm(
	config: ConfirmPromptConfig,
	read: ReadFn,
	write: WriteFn,
): Promise<PromptResult> {
	const hint = '(y/n)';
	write(`${config.message} ${hint} `);

	const line = await read();
	if (line === null) return { answered: false };

	const lower = line.trim().toLowerCase();
	if (lower === '' || lower === 'y' || lower === 'yes') {
		return { answered: true, value: true };
	}
	if (lower === 'n' || lower === 'no') {
		return { answered: true, value: false };
	}

	// Invalid input — treat as true for leniency (matches common CLI convention)
	// Note: the resolver will handle type coercion if needed
	write('Please answer y or n.\n');
	return promptConfirm(config, read, write);
}

/**
 * Input prompt: free-text string entry.
 *
 * Displays the message, reads a line, and optionally validates via
 * `config.validate`. Loops on invalid input up to `MAX_RETRIES`.
 */
async function promptInput(
	config: InputPromptConfig,
	read: ReadFn,
	write: WriteFn,
): Promise<PromptResult> {
	let retries = 0;

	while (retries < MAX_RETRIES) {
		const placeholder = config.placeholder !== undefined ? ` (${config.placeholder})` : '';
		write(`${config.message}${placeholder}: `);

		const line = await read();
		if (line === null) return { answered: false };

		const trimmed = line.trim();

		if (config.validate !== undefined) {
			const result = config.validate(trimmed);
			if (result !== true) {
				write(`${result}\n`);
				retries += 1;
				continue;
			}
		}

		return { answered: true, value: trimmed };
	}

	// Exhausted retries — cancel
	write('Too many invalid attempts.\n');
	return { answered: false };
}

/**
 * Select prompt: single choice from a numbered list.
 *
 * Displays choices with 1-based indices. User enters the number of
 * their selection.
 */
async function promptSelect(
	config: ResolvedSelectPromptConfig,
	read: ReadFn,
	write: WriteFn,
): Promise<PromptResult> {
	let retries = 0;

	while (retries < MAX_RETRIES) {
		write(`${config.message}\n`);
		for (let i = 0; i < config.choices.length; i += 1) {
			const choice = config.choices[i];
			// Choice always defined — guaranteed non-empty tuple and i < length
			if (choice === undefined) continue;
			const label = choice.label ?? choice.value;
			const desc = choice.description !== undefined ? ` - ${choice.description}` : '';
			write(`  ${i + 1}) ${label}${desc}\n`);
		}
		write('Enter number: ');

		const line = await read();
		if (line === null) return { answered: false };

		const num = Number(line.trim());
		if (Number.isNaN(num) || !Number.isInteger(num) || num < 1 || num > config.choices.length) {
			write(`Please enter a number between 1 and ${config.choices.length}.\n`);
			retries += 1;
			continue;
		}

		const selected = config.choices[num - 1];
		if (selected === undefined) {
			// Should not happen given bounds check, but satisfies noUncheckedIndexedAccess
			retries += 1;
			continue;
		}
		return { answered: true, value: selected.value };
	}

	write('Too many invalid attempts.\n');
	return { answered: false };
}

/**
 * Multiselect prompt: multiple choices from a numbered list.
 *
 * Displays choices with 1-based indices. User enters comma-separated
 * numbers of their selections (e.g. `1,3,5`).
 *
 * Validates against `min`/`max` constraints if configured.
 */
async function promptMultiselect(
	config: ResolvedMultiselectPromptConfig,
	read: ReadFn,
	write: WriteFn,
): Promise<PromptResult> {
	let retries = 0;

	while (retries < MAX_RETRIES) {
		write(`${config.message}\n`);
		for (let i = 0; i < config.choices.length; i += 1) {
			const choice = config.choices[i];
			if (choice === undefined) continue;
			const label = choice.label ?? choice.value;
			const desc = choice.description !== undefined ? ` - ${choice.description}` : '';
			write(`  ${i + 1}) ${label}${desc}\n`);
		}

		const minHint = config.min !== undefined ? `, min: ${config.min}` : '';
		const maxHint = config.max !== undefined ? `, max: ${config.max}` : '';
		write(`Enter numbers separated by commas (e.g. 1,3${minHint}${maxHint}): `);

		const line = await read();
		if (line === null) return { answered: false };

		const trimmed = line.trim();
		if (trimmed === '') {
			// Empty = no selection
			if (config.min !== undefined && config.min > 0) {
				write(`Please select at least ${config.min}.\n`);
				retries += 1;
				continue;
			}
			return { answered: true, value: [] };
		}

		const parts = trimmed.split(',').map((s) => s.trim());
		const indices: number[] = [];
		let valid = true;

		for (const part of parts) {
			const num = Number(part);
			if (Number.isNaN(num) || !Number.isInteger(num) || num < 1 || num > config.choices.length) {
				write(`Invalid selection '${part}'. Use numbers between 1 and ${config.choices.length}.\n`);
				valid = false;
				break;
			}
			indices.push(num);
		}

		if (!valid) {
			retries += 1;
			continue;
		}

		// Deduplicate
		const unique = [...new Set(indices)];

		if (config.min !== undefined && unique.length < config.min) {
			write(`Please select at least ${config.min}.\n`);
			retries += 1;
			continue;
		}

		if (config.max !== undefined && unique.length > config.max) {
			write(`Please select at most ${config.max}.\n`);
			retries += 1;
			continue;
		}

		const selected = unique.map((n) => {
			const choice = config.choices[n - 1];
			// Bounds already validated above; satisfies noUncheckedIndexedAccess
			return choice?.value ?? '';
		});

		return { answered: true, value: selected };
	}

	write('Too many invalid attempts.\n');
	return { answered: false };
}

// ---------------------------------------------------------------------------
// Utility: prepare resolved prompt config from raw config + flag schema
// ---------------------------------------------------------------------------

/**
 * Prepare a `ResolvedPromptConfig` from a raw `PromptConfig` and optional
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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedPromptConfig,
	ResolvedSelectPromptConfig,
	TestAnswer,
	TestPrompterOptions,
};
export { createTerminalPrompter, createTestPrompter, PROMPT_CANCEL, resolvePromptConfig };
