/**
 * Internal flag resolution helpers.
 *
 * @module dreamcli/core/resolve/flags
 * @internal
 */

import { CLIError, ValidationError } from '#internals/core/errors/index.ts';
import {
	pendingFlagErrors,
	pendingFlagReads,
	redactFlagParseError,
} from '#internals/core/parse/index.ts';
import { PromptCancelledError } from '#internals/core/prompt/errors.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { resolvePromptConfig } from '#internals/core/prompt/index.ts';
import { dedupe } from '#internals/core/schema/cardinality.ts';
import type {
	ErasedInteractiveResolver,
	InteractiveResult,
} from '#internals/core/schema/command.ts';
import type { FlagKind, FlagSchema } from '#internals/core/schema/flag.ts';
import type { PromptConfig, PromptKind } from '#internals/core/schema/prompt.ts';
import type { PromptSourceBinding, SourceBinding } from '#internals/core/schema/source.ts';
import {
	bindingsBeforePrompt,
	bindingsFromPrompt,
	sourceBindings,
	withPromptBinding,
} from '#internals/core/schema/source.ts';
import { flagValueSchema, valueEnumValues } from '#internals/core/schema/value.ts';
import { coerceValue, finishCliFlagValue, redactCoercionError } from './coerce.ts';
import type { DeprecationWarning, ResolutionProvenance, SkippedPathCheck } from './contracts.ts';
import { isNonEmpty, throwAggregatedErrors } from './errors.ts';
import type { MkdirFn, StatFn } from './path-checks.ts';
import { checkResolvedPath } from './path-checks.ts';
import type { PromptOutcome, StageInput, StageOutcome, StageState } from './stages.ts';
import { readCliValue, runEarlyStages, runStages } from './stages.ts';

/** External state and collectors one flag-resolution pass shares. */
interface FlagResolutionOptions {
	/** Inputs made sensitive by invocation-specific prompt overrides. */
	readonly sensitiveInputs?: Set<string>;
	/** Environment variable snapshot. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Parsed config file contents. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Pre-read stdin content, or `null`/`undefined` when nothing was piped. */
	readonly stdinData: string | null | undefined;
	/** Interactive prompt engine, absent in non-TTY contexts. */
	readonly prompter: PromptEngine | undefined;
	/** Per-invocation prompt overrides declared by `.interactive()`. */
	readonly interactive: ErasedInteractiveResolver | undefined;
	/** Collector for notices produced by `.deprecated()` flags. */
	readonly deprecations: DeprecationWarning[];
	/** Filesystem probe for `flag.path()` checks. */
	readonly stat: StatFn | undefined;
	/** Directory creation for `flag.path()` `create` checks. */
	readonly mkdir: MkdirFn | undefined;
	/** Collector for `flag.path()` checks that could not run. */
	readonly skippedPathChecks: SkippedPathCheck[];
	/** Receiver for the stage that produced each resolved flag. */
	readonly provenance: Record<string, ResolutionProvenance>;
}

/**
 * Walk every declared flag through the resolution chain
 * (cli -> stdin -> env -> config -> prompt -> default), collecting deprecations
 * and throwing aggregated errors.
 *
 * The chain runs in two passes so `.interactive()` sees what the non-interactive
 * sources produced before it decides which flags to prompt for.
 *
 * @param flagSchemas - Declared flags keyed by canonical name.
 * @param parsedFlags - Values the parser read off argv.
 * @param options - External state and collectors for this pass.
 * @returns Fully resolved flag values keyed by flag name.
 */
async function resolveFlags(
	flagSchemas: Readonly<Record<string, FlagSchema>>,
	parsedFlags: Readonly<Record<string, unknown>>,
	options: FlagResolutionOptions,
): Promise<Readonly<Record<string, unknown>>> {
	const resolved: Record<string, unknown> = {};
	const errors: ValidationError[] = [];
	const hardErrorFlags = new Set<string>();
	const effectiveSchemas = new Map<string, FlagSchema>();
	const firstPassErrors = new Map<string, number>();
	const parseErrors = pendingFlagErrors(parsedFlags);
	const pendingReads = pendingFlagReads(parsedFlags);
	const lazyValues = new Map<PropertyKey, () => unknown>();
	let uncertainSensitivity = false;
	const state: StageState = {
		env: options.env,
		config: options.config,
		stdinData: options.stdinData,
		canPrompt: options.prompter !== undefined,
	};

	for (const [name, schema] of Object.entries(flagSchemas)) {
		if (parseErrors?.has(name)) continue;
		const bindings = sourceBindings(schema);
		if (parseErrors?.size && flagValueSchema(schema).codec.name === 'custom') {
			// Do not run unrelated user parsers after failure. Resolve only callback reads.
			let done = false;
			let value: unknown;
			Object.defineProperty(resolved, name, {
				enumerable: true,
				configurable: true,
				get: () => {
					if (!done) {
						done = true;
						try {
							const read = pendingReads?.get(name);
							const parsed = read === undefined ? parsedFlags : { [name]: read() };
							const outcome = runEarlyStages(
								bindingsBeforePrompt(bindings),
								stageInput(name, schema, parsed, bindings, options.prompter),
								state,
							);
							if (outcome.kind === 'value') value = outcome.value;
							if (outcome.kind === 'absent') delete resolved[name];
							if (outcome.kind === 'error') uncertainSensitivity = true;
						} catch {
							uncertainSensitivity = true;
						}
					}
					return value;
				},
			});
			lazyValues.set(name, () => resolved[name]);
			continue;
		}
		const outcome = await runStages(
			bindingsBeforePrompt(bindings),
			stageInput(name, schema, parsedFlags, bindings, options.prompter),
			state,
		);
		if (outcome.kind === 'error') firstPassErrors.set(name, errors.length);
		record(name, schema, outcome, resolved, errors, hardErrorFlags, options);
	}

	let interactiveConfigs: InteractiveResult | undefined;
	try {
		const partial = lazyValues.size
			? new Proxy(resolved, {
					ownKeys: (target) => {
						for (const read of lazyValues.values()) read();
						return Reflect.ownKeys(target);
					},
					has: (target, key) => {
						lazyValues.get(key)?.();
						return Reflect.has(target, key);
					},
					getOwnPropertyDescriptor: (target, key) => {
						lazyValues.get(key)?.();
						return Reflect.getOwnPropertyDescriptor(target, key);
					},
				})
			: resolved;
		interactiveConfigs = options.interactive?.({ flags: partial });
	} catch (error) {
		if (!parseErrors?.size) throw error;
		uncertainSensitivity = true;
	}

	if (parseErrors !== undefined) {
		for (const [name, error] of parseErrors) {
			const schema = flagSchemas[name];
			if (schema === undefined) throw error;
			const config = effectivePromptConfig(name, schema, interactiveConfigs);
			throw uncertainSensitivity ||
				schema.sensitive ||
				config?.kind === 'password' ||
				config?.sensitive === true
				? redactFlagParseError(error)
				: error;
		}
	}

	for (const [name, originalSchema] of Object.entries(flagSchemas)) {
		const config = effectivePromptConfig(name, originalSchema, interactiveConfigs);
		const sensitive =
			originalSchema.sensitive || config?.kind === 'password' || config?.sensitive === true;
		const schema = sensitive ? { ...originalSchema, sensitive: true } : originalSchema;
		if (sensitive) options.sensitiveInputs?.add(name);
		effectiveSchemas.set(name, schema);
		const errorIndex = firstPassErrors.get(name);
		const firstPassError = errorIndex === undefined ? undefined : errors[errorIndex];
		if (sensitive && errorIndex !== undefined && firstPassError !== undefined) {
			errors[errorIndex] = redactCoercionError(firstPassError);
		}

		if (Object.hasOwn(resolved, name) || hardErrorFlags.has(name)) {
			continue;
		}

		const bindings = withPromptBinding(schema, sourceBindings(schema), config);
		const outcome = await runStages(
			bindingsFromPrompt(bindings),
			stageInput(name, schema, parsedFlags, bindings, options.prompter),
			state,
		);
		record(name, schema, outcome, resolved, errors, hardErrorFlags, options);

		if (Object.hasOwn(resolved, name) || hardErrorFlags.has(name)) {
			continue;
		}

		if (schema.kind === 'array' && schema.presence !== 'required') {
			resolved[name] = [];
			options.provenance[name] = { stage: 'default' };
			continue;
		}

		if (schema.kind === 'keyValue' && schema.presence !== 'required') {
			resolved[name] = {};
			options.provenance[name] = { stage: 'default' };
			continue;
		}

		if (schema.presence === 'required') {
			const details: Record<string, unknown> = { flag: name, kind: schema.kind };
			if (schema.envVar !== undefined) details.envVar = schema.envVar;
			if (schema.configPath !== undefined) details.configPath = schema.configPath;
			errors.push(
				new ValidationError(`Missing required flag --${name}`, {
					code: 'REQUIRED_FLAG',
					details,
					suggest: buildRequiredFlagSuggest(name, schema),
				}),
			);
			continue;
		}

		resolved[name] = undefined;
	}

	// Post-resolution pass — rules that apply to the final value regardless
	// of which source produced it.
	for (const [name, originalSchema] of Object.entries(flagSchemas)) {
		const schema = effectiveSchemas.get(name) ?? originalSchema;
		// A flag whose resolution threw has no entry here, and a flag named
		// after an Object.prototype member would otherwise read that inherited
		// method as its resolved value.
		const value = Object.hasOwn(resolved, name) ? resolved[name] : undefined;
		const checks = flagValueSchema(schema).pathChecks;

		if (schema.kind === 'array' && schema.unique && Array.isArray(value)) {
			resolved[name] = [...dedupe(value)];
		}

		if (checks === undefined) continue;

		await checkResolvedPath(
			{ kind: 'flag', name },
			Object.hasOwn(resolved, name) ? resolved[name] : undefined,
			checks,
			schema.sensitive,
			{ stat: options.stat, mkdir: options.mkdir },
			{ errors, skipped: options.skippedPathChecks },
		);
	}

	if (isNonEmpty(errors)) {
		throwAggregatedErrors(errors);
	}

	return resolved;
}

/** Assemble what one flag contributes to its own resolution. */
function stageInput(
	name: string,
	schema: FlagSchema,
	parsedFlags: Readonly<Record<string, unknown>>,
	bindings: readonly SourceBinding[],
	prompter: PromptEngine | undefined,
): StageInput {
	// A flag named after an Object.prototype member would otherwise read that
	// inherited method as a parsed value.
	const present = Object.hasOwn(parsedFlags, name);
	return {
		cli: readCliValue(present, present ? parsedFlags[name] : undefined, bindings),
		coerce: (binding, raw) => coerceValue(name, binding, raw, schema),
		finishCli: (value, stdinData, stdin) =>
			finishCliFlagValue(name, schema, value, stdinData, stdin),
		runPrompt: async (binding) =>
			prompter === undefined
				? { ok: false, error: undefined }
				: resolvePromptValueWithConfig(name, schema, binding, prompter),
	};
}

/** Apply one stage walk's outcome to the resolution state. */
function record(
	name: string,
	schema: FlagSchema,
	outcome: StageOutcome,
	resolved: Record<string, unknown>,
	errors: ValidationError[],
	hardErrorFlags: Set<string>,
	options: FlagResolutionOptions,
): void {
	if (outcome.kind === 'error') {
		errors.push(outcome.error);
		hardErrorFlags.add(name);
		return;
	}
	if (outcome.kind === 'absent') return;

	if (schema.deprecated !== undefined && outcome.provenance.stage !== 'default') {
		options.deprecations.push({ kind: 'flag', name, message: schema.deprecated });
	}
	resolved[name] = outcome.value;
	options.provenance[name] = outcome.provenance;
}

/**
 * Pick the prompt config this invocation uses for a flag.
 *
 * `.interactive()` returning `false` disables the prompt outright; any other
 * falsy value means "no override" and leaves the schema's own config in place.
 */
function effectivePromptConfig(
	name: string,
	schema: FlagSchema,
	interactiveConfigs: InteractiveResult | undefined,
): PromptConfig | undefined {
	// A flag named after an Object.prototype member would otherwise read that
	// inherited method as an override.
	const override =
		interactiveConfigs !== undefined && Object.hasOwn(interactiveConfigs, name)
			? interactiveConfigs[name]
			: undefined;

	if (override === false) return undefined;
	if (override === undefined || override === null || override === 0 || override === '') {
		return schema.prompt;
	}
	return override;
}

/** Maps each flag kind to the prompt kinds that produce compatible values. */
const COMPATIBLE_PROMPT_KINDS: Record<FlagKind, readonly PromptKind[]> = {
	boolean: ['confirm'],
	string: ['input', 'password', 'select'],
	number: ['input'],
	enum: ['select', 'input'],
	array: ['multiselect'],
	custom: ['input', 'password', 'select', 'confirm', 'multiselect'],
	count: [],
	keyValue: [],
};

/** How one surface spells the input a prompt-compatibility failure names. */
interface PromptSubject {
	/** How the input is written on the command line: `--out` or `<out>`. */
	readonly reference: string;
	/** What a diagnostic calls one of them: `flag` or `argument`. */
	readonly singular: string;
	/** What a diagnostic calls several: `flags` or `arguments`. */
	readonly plural: string;
	/** Identification fields the surface contributes to `details`. */
	readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Word an incompatible prompt config for the surface that declared it.
 *
 * A kind with no compatible prompt at all is a different diagnostic from one
 * whose prompt is merely the wrong sort, so the empty list gets its own message
 * on both surfaces.
 *
 * @param subject - How the surface spells the input.
 * @param kind - The input's declared kind.
 * @param promptKind - The prompt kind the config asked for.
 * @param allowed - The prompt kinds that kind accepts.
 * @returns The error to report.
 * @internal
 */
function promptCompatibilityError(
	subject: PromptSubject,
	kind: string,
	promptKind: PromptKind,
	allowed: readonly PromptKind[],
): ValidationError {
	const details = { ...subject.details, promptKind, allowed };
	const headline = `Prompt kind '${promptKind}' is not compatible with ${kind} ${subject.singular} ${subject.reference}.`;
	const first = allowed[0];

	if (first === undefined) {
		return new ValidationError(`${headline} ${kind} ${subject.plural} are not promptable`, {
			code: 'CONSTRAINT_VIOLATED',
			details,
			suggest: `Remove the prompt config for ${subject.reference}`,
		});
	}

	return new ValidationError(`${headline} Use '${first}' instead`, {
		code: 'CONSTRAINT_VIOLATED',
		details,
		suggest: `Change the prompt to { kind: '${first}' } for ${subject.reference}`,
	});
}

/**
 * Check whether a prompt kind is compatible with the flag's declared kind.
 *
 * @returns `undefined` when compatible, or a {@link ValidationError} with
 * code `'CONSTRAINT_VIOLATED'` and an actionable `suggest` message when not.
 * @internal
 */
function validatePromptFlagCompatibility(
	flagName: string,
	flagKind: FlagKind,
	promptKind: PromptKind,
): ValidationError | undefined {
	const allowed = COMPATIBLE_PROMPT_KINDS[flagKind];
	if (allowed.includes(promptKind)) return undefined;

	return promptCompatibilityError(
		{
			reference: `--${flagName}`,
			singular: 'flag',
			plural: 'flags',
			details: { flag: flagName, flagKind },
		},
		flagKind,
		promptKind,
		allowed,
	);
}

/**
 * Validate prompt/flag compatibility, run the prompt engine, and coerce the result.
 *
 * Returns early with a {@link ValidationError} if the prompt kind is
 * incompatible with the flag kind (checked via {@link COMPATIBLE_PROMPT_KINDS}
 * before the prompter is invoked).
 * @internal
 */
async function resolvePromptValueWithConfig(
	flagName: string,
	schema: FlagSchema,
	binding: PromptSourceBinding,
	prompter: PromptEngine,
): Promise<PromptOutcome> {
	const promptConfig = {
		...binding.prompt,
		sensitive:
			schema.sensitive || binding.prompt.sensitive === true || binding.prompt.kind === 'password',
	};
	const mismatch = validatePromptFlagCompatibility(flagName, schema.kind, promptConfig.kind);
	if (mismatch !== undefined) {
		return { ok: false, error: mismatch };
	}

	const resolvedConfig = resolvePromptConfig(
		promptConfig,
		valueEnumValues(flagValueSchema(schema)),
	);
	const result = await prompter.promptOne(resolvedConfig);

	if (!result.answered) {
		if (promptConfig.kind === 'password' && result.reason === 'invalid')
			throw new CLIError('Too many invalid prompt answers', {
				code: 'PROMPT_INVALID',
				exitCode: 2,
			});
		if (promptConfig.kind === 'password') throw new PromptCancelledError();
		return { ok: false, error: undefined };
	}

	// An empty/blank `input` answer with no prompt-level default is not a real
	// answer — fall through (ok: false) so resolution reaches the flag's
	// `.default()`. When a prompt-level default exists, the prompt engine has
	// already applied it (so the value is the default, not blank), giving it
	// precedence over the flag default.
	if (
		promptConfig.kind === 'input' &&
		promptConfig.default === undefined &&
		(promptConfig.empty ?? 'skip') === 'skip' &&
		typeof result.value === 'string' &&
		(promptConfig.trim === false ? result.value : result.value.trim()) === ''
	) {
		return { ok: false, error: undefined };
	}

	return coerceValue(
		flagName,
		binding,
		result.value,
		promptConfig.sensitive ? { ...schema, sensitive: true } : schema,
	);
}

/** Build a human-readable suggestion listing all available sources for a required flag. @internal */
function buildRequiredFlagSuggest(name: string, schema: FlagSchema): string {
	const sources: string[] = [];
	const takesValue = schema.kind !== 'boolean' && schema.kind !== 'count';
	sources.push(`Provide --${name}${takesValue ? ' <value>' : ''}`);

	const stdin = schema.stdin;
	if (stdin !== undefined) {
		sources.push(
			stdin.when === 'dash'
				? `pass --${name} - to read stdin`
				: stdin.when === 'missing'
					? `pipe a value to stdin`
					: `pipe a value to stdin or pass --${name} -`,
		);
	}

	if (schema.envVar !== undefined) {
		sources.push(`set ${schema.envVar}`);
	}

	if (schema.configPath !== undefined) {
		sources.push(`add ${schema.configPath} to config`);
	}

	if (sources.length <= 1) {
		return sources.join('');
	}

	const rest = sources.slice(0, -1);
	const last = sources.slice(-1).join('');
	return sources.length === 2 ? `${rest.join('')} or ${last}` : `${rest.join(', ')}, or ${last}`;
}

export type { FlagResolutionOptions };
export { COMPATIBLE_PROMPT_KINDS, promptCompatibilityError, resolveFlags };
