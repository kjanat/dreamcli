/** Reusable prompt factories and answer inference.
 * @module dreamcli/core/prompt/definitions
 */
import type {
	ConfirmPromptConfig,
	InputPromptConfig,
	MultiselectPromptConfig,
	PasswordPromptConfig,
	PromptConfig,
	SelectChoice,
	SelectPromptConfig,
} from '#internals/core/schema/prompt.ts';

/** Infer an answer, preserving literal choice values. */
export type InferPrompt<C extends PromptConfig> = C extends ConfirmPromptConfig
	? boolean
	: C extends {
				readonly kind: 'multiselect';
				readonly choices: readonly (infer Choice extends SelectChoice)[];
			}
		? Choice['value'][]
		: C extends {
					readonly kind: 'select';
					readonly choices: readonly (infer Choice extends SelectChoice)[];
				}
			? Choice['value']
			: C extends MultiselectPromptConfig
				? string[]
				: string;

/** Standalone selections cannot inherit choices from a flag or argument schema. */
type StandalonePromptConfig =
	| InputPromptConfig
	| PasswordPromptConfig
	| ConfirmPromptConfig
	| ((SelectPromptConfig | MultiselectPromptConfig) & {
			readonly choices: readonly [SelectChoice, ...SelectChoice[]];
	  });

/** Ask one question with explicit, non-empty selection choices. Cancellation rejects with `PromptCancelledError`. */
export type Ask = <const C extends StandalonePromptConfig>(config: C) => Promise<InferPrompt<C>>;

/** Build reusable definitions for schemas, handler-level `ask`, and standalone sessions. */
export const prompt: {
	/** Text input; empty answers retry unless an explicit policy/default is supplied. */
	input(options: Omit<InputPromptConfig, 'kind'>): InputPromptConfig;
	/** Hidden input, preserving all surrounding whitespace. */
	password(options: Omit<PasswordPromptConfig, 'kind'>): PasswordPromptConfig;
	/** Yes/no question. */
	confirm(options: Omit<ConfirmPromptConfig, 'kind'>): ConfirmPromptConfig;
	/** Select one typed string value. Standalone definitions require explicit choices. */
	select<const C extends Omit<SelectPromptConfig, 'kind'>>(options: C): C & { kind: 'select' };
	/** Select several typed string values. */
	multiselect<const C extends Omit<MultiselectPromptConfig, 'kind'>>(
		options: C,
	): C & { kind: 'multiselect' };
} = {
	input(options) {
		return { empty: 'retry', ...options, kind: 'input' };
	},
	password(options) {
		return { ...options, kind: 'password', sensitive: true };
	},
	confirm(options) {
		return { ...options, kind: 'confirm' };
	},
	select(options) {
		return { ...options, kind: 'select' as const };
	},
	multiselect(options) {
		return { ...options, kind: 'multiselect' as const };
	},
};
