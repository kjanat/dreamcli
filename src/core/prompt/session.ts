/** Typed prompt sessions for handlers and standalone scripts.
 * @module dreamcli/core/prompt/session
 */
import { CLIError } from '#internals/core/errors/index.ts';
import type { WriteFn } from '#internals/core/output/writer.ts';
import type { PromptConfig } from '#internals/core/schema/prompt.ts';
import type { Ask, InferPrompt } from './definitions.ts';
import { PromptCancelledError } from './errors.ts';
import type { PromptEngine } from './index.ts';
import { resolvePromptConfig } from './index.ts';
import { prepareTextAnswer } from './text.ts';

/** Injectable host for a standalone interaction. No host is opened implicitly. */
export interface PromptSessionOptions {
	/** Engine also used for schema-bound prompts in a command invocation. */
	readonly prompter?: PromptEngine;
	/** Validation feedback writer; CLI sessions use stderr. */
	readonly write?: WriteFn;
}

/** Reusable typed interaction entry point. */
export interface PromptSession {
	/** Ask one question, rejecting on cancellation or unavailable interaction. */
	readonly ask: Ask;
}

/** Create an isolated interaction session over a custom, terminal, or scripted engine. */
export function createPromptSession(options: PromptSessionOptions): PromptSession {
	let active = false;
	const ask: Ask = async <const C extends PromptConfig>(config: C): Promise<InferPrompt<C>> => {
		if (active)
			throw new CLIError('A prompt is already active in this session', { code: 'PROMPT_BUSY' });
		if (options.prompter === undefined) {
			throw new CLIError('Interactive input is unavailable', {
				code: 'PROMPT_UNAVAILABLE',
				suggest:
					'Supply credentials through command arguments, environment, or config, or run in an interactive terminal',
			});
		}
		active = true;
		try {
			const resolved = resolvePromptConfig(config, undefined);
			// Session owns validation so custom and scripted engines follow the same policy.
			const engineConfig = { ...resolved };
			if (engineConfig.kind === 'input' || engineConfig.kind === 'password') {
				delete engineConfig.validate;
				engineConfig.empty = 'accept';
				if (engineConfig.kind === 'input') {
					engineConfig.trim = false;
					// Preserve the hint while applying defaults exactly once to the raw answer.
					if (engineConfig.default !== undefined) {
						if (!engineConfig.sensitive) {
							engineConfig.placeholder = [
								engineConfig.placeholder,
								`default: ${engineConfig.default}`,
							]
								.filter((hint) => hint !== undefined)
								.join(', ');
						}
						delete engineConfig.default;
					}
				}
			}
			for (let attempt = 0; attempt < 10; attempt++) {
				const result = await options.prompter.promptOne(engineConfig);
				if (!result.answered) throw new PromptCancelledError();
				let value = result.value;
				let error: string | undefined;
				if (config.kind === 'input' || config.kind === 'password') {
					if (typeof value !== 'string') error = 'Please enter text.';
					else {
						const prepared = await prepareTextAnswer(config, value);
						if (prepared.ok) value = prepared.value;
						else error = prepared.message;
					}
				} else if (config.kind === 'confirm') {
					if (typeof value !== 'boolean') error = 'Please answer yes or no.';
				} else {
					const choices =
						resolved.kind === 'select' || resolved.kind === 'multiselect' ? resolved.choices : [];
					if (config.kind === 'select') {
						if (!choices.some((choice) => choice.value === value))
							error = 'Please select an available choice.';
					} else if (
						!Array.isArray(value) ||
						!value.every((item) => choices.some((choice) => choice.value === item))
					) {
						error = 'Please select available choices.';
					} else {
						const selected = [...new Set(value)];
						value = selected;
						if (config.min !== undefined && selected.length < config.min)
							error = `Please select at least ${config.min}.`;
						if (config.max !== undefined && selected.length > config.max)
							error = `Please select at most ${config.max}.`;
					}
				}
				if (error === undefined) return value as InferPrompt<C>;
				options.write?.(`${error}\n`);
			}
			throw new CLIError('Too many invalid prompt answers', {
				code: 'PROMPT_INVALID',
				exitCode: 2,
			});
		} finally {
			active = false;
		}
	};
	return { ask };
}
