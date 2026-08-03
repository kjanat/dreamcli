/**
 * The stdin binding shared by the `flag` and `arg` factories.
 *
 * A {@link StdinBinding} says when an input reads the stdin stream, whether it
 * consumes the stream alone, and whether a single value drops the terminator a
 * pipe appends. Both factories store one of these under their `stdin` field, and
 * the parse, preflight, and resolve pipelines read the stdin axis through it.
 *
 * @module dreamcli/core/schema/stdin
 */

import { CLIError } from '#internals/core/errors/index.ts';

/** All stdin trigger modes as a runtime array. */
const STDIN_WHENS = ['dash', 'missing', 'dash-or-missing'] as const;

/**
 * When a stdin-enabled input reads the stdin stream.
 *
 * - `'dash'` — only an explicit `-` selects stdin; an absent input falls
 *   through to the later sources
 * - `'missing'` — only an absent input selects stdin; a `-` stays the literal
 *   string `'-'`
 * - `'dash-or-missing'` — both select stdin
 */
type StdinWhen = (typeof STDIN_WHENS)[number];

/** All stdin consumption modes as a runtime array. */
const STDIN_CONSUMES = ['exclusive', 'broadcast'] as const;

/**
 * How a stdin-enabled input shares the stream with the command's other inputs.
 *
 * - `'exclusive'` — this input is the command's only stdin consumer, and a
 *   second exclusive consumer is a schema error
 * - `'broadcast'` — every broadcast consumer on the command receives the same
 *   buffer
 */
type StdinConsume = (typeof STDIN_CONSUMES)[number];

/** The normalized stdin axis of a flag or an arg. */
interface StdinBinding {
	/** When this input reads the stdin stream. */
	readonly when: StdinWhen;
	/** Whether this input consumes the stream alone. */
	readonly consume: StdinConsume;
	/** Whether one trailing line terminator is dropped from a single value. */
	readonly trim: boolean;
}

/** Stdin settings accepted by `.stdin()` and by the schema definitions. */
interface StdinOptions {
	/**
	 * When this input reads the stdin stream.
	 * @defaultValue `'dash-or-missing'`
	 */
	readonly when?: StdinWhen | undefined;
	/**
	 * Whether this input consumes the stream alone.
	 * @defaultValue `'exclusive'`
	 */
	readonly consume?: StdinConsume | undefined;
	/**
	 * Drop one trailing `\n`, `\r\n`, or `\r` from a single value read off the
	 * stream, so `echo ./dir | mycli` delivers `'./dir'`. A string is the one
	 * kind that still carries the terminator at that point; every other kind
	 * drops it while decoding and is unaffected.
	 * @defaultValue `false`
	 */
	readonly trim?: boolean | undefined;
}

/** The binding `.stdin()` produces when called without options. */
const DEFAULT_STDIN_BINDING: StdinBinding = {
	when: 'dash-or-missing',
	consume: 'exclusive',
	trim: false,
};

/**
 * Reject stdin settings that name a mode outside the declared unions.
 *
 * @param options - Stdin settings from a builder call or a schema definition.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on an unknown mode.
 */
function assertStdinOptions(options: StdinOptions): void {
	if (options.when !== undefined && !STDIN_WHENS.includes(options.when)) {
		throw new CLIError(`Unknown stdin mode '${String(options.when)}'`, {
			code: 'INVALID_SCHEMA',
			details: { when: options.when, allowed: [...STDIN_WHENS] },
			suggest: `Use one of: ${STDIN_WHENS.join(', ')}`,
		});
	}
	if (options.consume !== undefined && !STDIN_CONSUMES.includes(options.consume)) {
		throw new CLIError(`Unknown stdin consumption mode '${String(options.consume)}'`, {
			code: 'INVALID_SCHEMA',
			details: { consume: options.consume, allowed: [...STDIN_CONSUMES] },
			suggest: `Use one of: ${STDIN_CONSUMES.join(', ')}`,
		});
	}
	if (options.trim !== undefined && typeof options.trim !== 'boolean') {
		throw new CLIError(`Stdin trim must be a boolean, received '${String(options.trim)}'`, {
			code: 'INVALID_SCHEMA',
			details: { trim: options.trim },
			suggest: 'Pass trim: true or trim: false',
		});
	}
}

/**
 * Normalize stdin settings into the binding a schema stores.
 *
 * @param options - Stdin settings, or `undefined` for every default.
 * @returns A fully populated {@link StdinBinding}.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on an unknown mode.
 */
function normalizeStdinBinding(options?: StdinOptions): StdinBinding {
	if (options === undefined) return DEFAULT_STDIN_BINDING;
	assertStdinOptions(options);
	return {
		when: options.when ?? DEFAULT_STDIN_BINDING.when,
		consume: options.consume ?? DEFAULT_STDIN_BINDING.consume,
		trim: options.trim ?? DEFAULT_STDIN_BINDING.trim,
	};
}

/**
 * Whether an explicit `-` selects stdin for this binding.
 *
 * @param binding - Anything carrying the stdin trigger.
 * @returns `true` for `'dash'` and `'dash-or-missing'`.
 */
function stdinReadsOnDash(binding: Pick<StdinBinding, 'when'>): boolean {
	return binding.when === 'dash' || binding.when === 'dash-or-missing';
}

/**
 * Whether an absent CLI value selects stdin for this binding.
 *
 * @param binding - Anything carrying the stdin trigger.
 * @returns `true` for `'missing'` and `'dash-or-missing'`.
 */
function stdinReadsWhenMissing(binding: Pick<StdinBinding, 'when'>): boolean {
	return binding.when === 'missing' || binding.when === 'dash-or-missing';
}

export type { StdinBinding, StdinConsume, StdinOptions, StdinWhen };
export {
	assertStdinOptions,
	DEFAULT_STDIN_BINDING,
	normalizeStdinBinding,
	STDIN_CONSUMES,
	STDIN_WHENS,
	stdinReadsOnDash,
	stdinReadsWhenMissing,
};
