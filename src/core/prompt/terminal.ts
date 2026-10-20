/**
 * Line-based terminal prompt engine.
 *
 * Loaded on demand by the CLI runtime when stdin is a TTY and no prompter
 * was injected, so programs without prompts never pay for it.
 *
 * @module dreamcli/core/prompt/terminal
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { WriteFn } from '#internals/core/output/index.ts';
import type {
	ConfirmPromptConfig,
	InputPromptConfig,
	PasswordPromptConfig,
	PromptResult,
	SelectChoice,
} from '#internals/core/schema/prompt.ts';
import { PromptCancelledError } from './errors.ts';
import type {
	PromptEngine,
	ReadFn,
	ResolvedMultiselectPromptConfig,
	ResolvedSelectPromptConfig,
} from './index.ts';
import { prepareTextAnswer } from './text.ts';

/** Optional terminal capabilities. Hidden input must never fall back to an ordinary reader. */
export interface TerminalPrompterOptions {
	/** Read without terminal echo; restore terminal state before settling. */
	readonly readSecret?: ReadFn;
}

/**
 * Create a prompt engine backed by line-based terminal I/O.
 *
 * Uses a {@linkcode ReadFn} for input and a {@linkcode WriteFn} for output. This is the
 * built-in renderer — sufficient for most CLI use cases. For richer
 * TUI experiences, users can implement {@linkcode PromptEngine} with a library
 * like `@clack/prompts` or `inquirer`.
 *
 * The prompter does **not** use raw mode — all input is line-based.
 * This keeps the implementation portable across Node, Bun, and Deno
 * without platform-specific stdin configuration.
 *
 * @param read - Line reader function (returns `null` on EOF)
 * @param write - Output writer function
 * @returns A {@linkcode PromptEngine} that prompts via terminal I/O
 *
 * @example
 * ```ts
 * import { createInterface } from 'node:readline';
 *
 * const rl = createInterface({ input: process.stdin, output: process.stdout });
 * let closed = false;
 * rl.once('close', () => {
 *   closed = true;
 * });
 * const read: ReadFn = () =>
 *   new Promise((resolve) => {
 *     if (closed) {
 *       resolve(null);
 *       return;
 *     }
 *     const onClose = (): void => resolve(null);
 *     rl.once('close', onClose);
 *     rl.question('', (answer) => {
 *       rl.off('close', onClose);
 *       resolve(answer);
 *     });
 *   });
 * const write: WriteFn = (s) => process.stdout.write(s);
 *
 * const prompter = createTerminalPrompter(read, write);
 * ```
 */
function createTerminalPrompter(
	read: ReadFn,
	write: WriteFn,
	options?: TerminalPrompterOptions,
): PromptEngine {
	return {
		promptOne(config): Promise<PromptResult> {
			switch (config.kind) {
				case 'confirm':
					return promptConfirm(config, read, write);
				case 'input':
					return promptInput(config, read, write);
				case 'password': {
					const readSecret = options?.readSecret;
					if (readSecret === undefined) {
						return Promise.reject(
							new CLIError('Hidden password input is unavailable', {
								code: 'PROMPT_UNSUPPORTED',
								suggest: 'Use a runtime adapter or prompt engine with hidden-input support',
							}),
						);
					}
					return promptInput(
						config,
						async () => {
							try {
								const value = await readSecret();
								if (value === null) throw new PromptCancelledError('eof');
								return value;
							} finally {
								write('\n');
							}
						},
						write,
					);
				}
				case 'select':
					return promptSelect(config, read, write);
				case 'multiselect':
					return promptMultiselect(config, read, write);
			}
		},
	};
}

// --- Per-kind prompt implementations

/** Maximum attempts before reporting invalid input exhaustion. */
const MAX_RETRIES = 10;

/**
 * Confirm prompt: yes/no question.
 *
 * The hint reflects {@link ConfirmPromptConfig.default}: `(Y/n)` when the
 * default is `true` (or unset), `(y/N)` when `false`. An empty submission
 * resolves to that default. Accepts: y, yes, n, no, empty. Case-insensitive.
 *
 * @param config - {@link ConfirmPromptConfig} with the question message and optional default
 * @param read - {@link ReadFn} for reading a line of user input
 * @param write - {@link WriteFn} for rendering prompt text
 * @returns Resolved {@link PromptResult} — `true`/`false` value, or cancelled on EOF
 */
async function promptConfirm(
	config: ConfirmPromptConfig,
	read: ReadFn,
	write: WriteFn,
): Promise<PromptResult> {
	const defaultValue = config.default ?? true;
	let retries = 0;

	while (retries < MAX_RETRIES) {
		const hint = defaultValue ? '(Y/n)' : '(y/N)';
		write(`${config.message} ${hint} `);

		const line = await read();
		if (line === null) return { answered: false };

		const lower = line.trim().toLowerCase();
		if (lower === '') {
			return { answered: true, value: defaultValue };
		}
		if (lower === 'y' || lower === 'yes') {
			return { answered: true, value: true };
		}
		if (lower === 'n' || lower === 'no') {
			return { answered: true, value: false };
		}

		write('Please answer y or n.\n');
		retries += 1;
	}

	write('Too many invalid attempts.\n');
	return { answered: false, reason: 'invalid' };
}

/**
 * Input prompt: free-text string entry.
 *
 * Displays the message and a hint listing the placeholder and/or
 * {@link InputPromptConfig.default | default}, reads a line, and optionally
 * validates via {@link InputPromptConfig.validate | validate}. When a default
 * is configured, an empty submission resolves to it without running validation;
 * otherwise an empty submission is returned verbatim (and treated as "no answer"
 * by the resolver). Loops on invalid input up to `MAX_RETRIES`.
 *
 * @param config - {@link InputPromptConfig} with message, optional placeholder, default, and validator
 * @param read - {@link ReadFn} for reading a line of user input
 * @param write - {@link WriteFn} for rendering prompt text and validation errors
 * @returns Resolved {@link PromptResult} — trimmed string value (or default), or unanswered on EOF/retry exhaustion
 */
async function promptInput(
	config: InputPromptConfig | PasswordPromptConfig,
	read: ReadFn,
	write: WriteFn,
): Promise<PromptResult> {
	let retries = 0;

	const hints: string[] = [];
	if (config.kind === 'input' && config.placeholder !== undefined) hints.push(config.placeholder);
	if (config.kind === 'input' && config.default !== undefined && !config.sensitive)
		hints.push(`default: ${config.default}`);
	const hint = hints.length > 0 ? ` (${hints.join(', ')})` : '';

	while (retries < MAX_RETRIES) {
		write(`${config.message}${hint}: `);

		const line = await read();
		if (line === null) return { answered: false };

		const result = await prepareTextAnswer(config, line);
		if (result.ok) return { answered: true, value: result.value };
		write(`${result.message}\n`);
		retries += 1;
	}

	if (config.kind === 'password')
		throw new CLIError('Too many invalid prompt answers', { code: 'PROMPT_INVALID', exitCode: 2 });
	// Preserve schema-bound fallback while exposing exhaustion to sessions.
	write('Too many invalid attempts.\n');
	return { answered: false, reason: 'invalid' };
}

/**
 * Select prompt: single choice from a numbered list.
 *
 * Displays choices with 1-based indices. User enters the number of
 * their selection.
 *
 * @param config - {@link ResolvedSelectPromptConfig} with message and guaranteed non-empty choices
 * @param read - {@link ReadFn} for reading a line of user input
 * @param write - {@link WriteFn} for rendering the choice list and validation errors
 * @returns Resolved {@link PromptResult} — selected {@link SelectChoice.value}, or unanswered on EOF/retry exhaustion
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
	return { answered: false, reason: 'invalid' };
}

/**
 * Multiselect prompt: multiple choices from a numbered list.
 *
 * Displays choices with 1-based indices. User enters comma-separated
 * numbers of their selections (e.g. `1,3,5`).
 *
 * Validates against `min`/`max` constraints if configured.
 *
 * @param config - {@link ResolvedMultiselectPromptConfig} with message, guaranteed non-empty choices, and optional min/max
 * @param read - {@link ReadFn} for reading a line of user input
 * @param write - {@link WriteFn} for rendering the choice list, hints, and validation errors
 * @returns Resolved {@link PromptResult} — array of selected {@link SelectChoice.value} strings, or unanswered on EOF/retry exhaustion
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
	return { answered: false, reason: 'invalid' };
}

// --- Exports

export { createTerminalPrompter };
