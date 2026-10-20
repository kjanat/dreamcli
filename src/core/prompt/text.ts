/** Shared text normalization and validation for terminal, scripted, and hosted prompts.
 * @module dreamcli/core/prompt/text
 * @internal
 */
import type { InputPromptConfig, PasswordPromptConfig } from '#internals/core/schema/prompt.ts';

/** An accepted value or a reason to request another answer. */
type TextAnswer =
	| { readonly ok: true; readonly value: string }
	| { readonly ok: false; readonly message: string };

/** Apply prompt text policy without touching password whitespace. */
export async function prepareTextAnswer(
	config: InputPromptConfig | PasswordPromptConfig,
	answer: string,
): Promise<TextAnswer> {
	const value = config.kind === 'input' && config.trim !== false ? answer.trim() : answer;
	if (value === '') {
		if (config.kind === 'input' && config.default !== undefined) {
			return { ok: true, value: config.default };
		}
		if ((config.empty ?? (config.kind === 'password' ? 'retry' : 'skip')) === 'retry') {
			return { ok: false, message: 'Please enter a value.' };
		}
		if (config.kind === 'input' && (config.empty ?? 'skip') === 'skip') return { ok: true, value };
	}
	const result = await config.validate?.(value);
	return result === undefined || result === true
		? { ok: true, value }
		: { ok: false, message: result };
}
