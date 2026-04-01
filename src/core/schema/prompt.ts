/**
 * Prompt type definitions for interactive flag resolution.
 *
 * Prompt configuration is stored on `FlagSchema.prompt` and consumed by the
 * resolution chain (v0.3+) when a flag value is missing after CLI/env/config
 * resolution. The prompt engine reads this config to present the appropriate
 * UI to the user.
 *
 * @module dreamcli/core/schema/prompt
 */

// --- Prompt kind discriminator

/**
 * The kind of interactive prompt to present.
 *
 * - `'confirm'`     — yes/no boolean question
 * - `'input'`       — free-text string input
 * - `'select'`      — single selection from a list
 * - `'multiselect'` — multiple selections from a list
 */
type PromptKind = 'confirm' | 'input' | 'select' | 'multiselect';

// --- Per-kind prompt configuration (discriminated union)

/** Shared fields across all prompt kinds. */
interface PromptConfigBase {
	/** The question displayed to the user. */
	readonly message: string;
}

/** Yes/no confirmation prompt — maps to `boolean` flags. */
interface ConfirmPromptConfig extends PromptConfigBase {
	readonly kind: 'confirm';
}

/** Free-text input prompt — maps to `string` and `number` flags. */
interface InputPromptConfig extends PromptConfigBase {
	readonly kind: 'input';
	/** Placeholder text shown before user types (informational only). */
	readonly placeholder?: string;
	/**
	 * Inline validation function. Return `true` if valid, or a string
	 * error message if invalid. Called before coercion to flag kind.
	 */
	readonly validate?: (value: string) => true | string;
}

/** Single-selection prompt — maps to `enum` flags or any flag with choices. */
interface SelectPromptConfig extends PromptConfigBase {
	readonly kind: 'select';
	/**
	 * Available choices. When omitted for `enum` flags, the enum values
	 * from the flag schema are used automatically.
	 */
	readonly choices?: readonly SelectChoice[];
}

/**
 * Multi-selection prompt — maps to `array` flags.
 * Returns an array of selected values.
 */
interface MultiselectPromptConfig extends PromptConfigBase {
	readonly kind: 'multiselect';
	/**
	 * Available choices. When omitted for `array` flags with enum elements,
	 * the enum values from the element schema are used automatically.
	 */
	readonly choices?: readonly SelectChoice[];
	/** Minimum number of selections required (default: 0). */
	readonly min?: number;
	/** Maximum number of selections allowed (default: unlimited). */
	readonly max?: number;
}

// --- Supporting types

/** A selectable option for select/multiselect prompts. */
interface SelectChoice {
	/** The value returned when this choice is selected. */
	readonly value: string;
	/** Display label (defaults to `value` if omitted). */
	readonly label?: string;
	/** Optional description shown alongside the choice. */
	readonly description?: string;
}

/**
 * Discriminated union of all prompt configurations.
 *
 * Use the `kind` field to narrow:
 * ```ts
 * if (config.kind === 'select') {
 *   config.choices // readonly SelectChoice[] | undefined
 * }
 * ```
 */
type PromptConfig =
	| ConfirmPromptConfig
	| InputPromptConfig
	| SelectPromptConfig
	| MultiselectPromptConfig;

// --- Prompt result

/**
 * The raw result returned by a prompt engine for a single prompt.
 *
 * - `answered: true`  — user provided a value
 * - `answered: false` — user cancelled/aborted (Ctrl+C, ESC, etc.)
 *
 * Coercion to the flag's kind is the resolver's responsibility, not the
 * prompt engine's.
 */
type PromptResult =
	| { readonly answered: true; readonly value: unknown }
	| { readonly answered: false };

// --- Exports

export type {
	ConfirmPromptConfig,
	InputPromptConfig,
	MultiselectPromptConfig,
	PromptConfig,
	PromptConfigBase,
	PromptKind,
	PromptResult,
	SelectChoice,
	SelectPromptConfig,
};
