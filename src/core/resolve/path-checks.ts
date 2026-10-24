/**
 * Internal post-resolution filesystem checks for `flag.path()` and `arg.path()`.
 *
 * The checks run after a value has been resolved, whatever source produced it
 * (CLI, env, config, prompt, stdin, or default), through the caller-injected
 * probe so `src/core` stays free of platform I/O. Flags and args share the
 * checks and differ only in how the subject is named.
 *
 * @module dreamcli/core/resolve/path-checks
 * @internal
 */

import { diagnosticValue } from '#internals/core/errors/diagnostic-value.ts';
import { CLIError, ValidationError } from '#internals/core/errors/index.ts';
import type { PathChecks } from '#internals/core/schema/index.ts';
import type { SkippedPathCheck } from './contracts.ts';

/**
 * Filesystem probe injected by the caller for path checks.
 *
 * Returns what exists at the path, or `null` when nothing does.
 */
type StatFn = (path: string) => Promise<'file' | 'directory' | null>;

/** Recursive directory creation injected by the caller for `create` checks. */
type MkdirFn = (path: string) => Promise<void>;

/** Which surface declared the path, and under what name. */
type PathCheckSubject =
	| { readonly kind: 'flag'; readonly name: string }
	| { readonly kind: 'arg'; readonly name: string };

/** How a subject reads inside a sentence: `flag --out` or `argument <out>`. */
function subjectLabel(subject: PathCheckSubject): string {
	return subject.kind === 'flag' ? `flag --${subject.name}` : `argument <${subject.name}>`;
}

/** How a subject is spelled on the command line: `--out` or `<out>`. */
function subjectReference(subject: PathCheckSubject): string {
	return subject.kind === 'flag' ? `--${subject.name}` : `<${subject.name}>`;
}

/** The key naming the subject in error details: `flag` or `arg`. */
function subjectDetails(subject: PathCheckSubject): Readonly<Record<string, string>> {
	return subject.kind === 'flag' ? { flag: subject.name } : { arg: subject.name };
}

/** What one path value's checks produced. */
interface PathCheckOutcome {
	/** The failed check, or `undefined` when the value passed (or nothing ran). */
	readonly violation: ValidationError | undefined;
	/**
	 * Whether a declared `create` could not run: the path was missing and no
	 * `mkdir` was supplied, so the existence rules decided the outcome instead
	 * of directory creation.
	 */
	readonly createSkipped: boolean;
}

/** The filesystem capabilities the caller injected for path checks. */
interface PathCheckIo {
	/** Filesystem probe, or `undefined` when the caller supplied none. */
	readonly stat: StatFn | undefined;
	/** Recursive directory creation, or `undefined` when the caller supplied none. */
	readonly mkdir: MkdirFn | undefined;
}

/** Where one input's path checks report what they found. */
interface PathCheckCollectors {
	/** Receives one {@link ValidationError} per failing value. */
	readonly errors: ValidationError[];
	/** Receives one entry per input whose checks could not run. */
	readonly skipped: SkippedPathCheck[];
}

/**
 * Check a resolved path value against its declared filesystem expectations.
 *
 * @param subject - The flag or arg the value belongs to.
 * @param value - The resolved path.
 * @param checks - Expectations declared by `flag.path()` / `arg.path()`.
 * @param stat - Filesystem probe.
 * @param mkdir - Recursive directory creation, when the caller supplies one.
 * @param sensitive - Whether the owning schema marks the path as sensitive.
 * @returns The {@link ValidationError} (code `'CONSTRAINT_VIOLATED'`) the value
 *   failed with, if any, and whether a declared `create` had to be skipped.
 */
async function validatePathChecks(
	subject: PathCheckSubject,
	value: string,
	checks: PathChecks,
	stat: StatFn,
	mkdir: MkdirFn | undefined,
	sensitive: boolean,
): Promise<PathCheckOutcome> {
	const label = subjectLabel(subject);
	const reference = subjectReference(subject);
	const details = subjectDetails(subject);
	const report = diagnosticValue(sensitive, value);
	const passed: PathCheckOutcome = { violation: undefined, createSkipped: false };
	const failed = (violation: ValidationError, createSkipped = false): PathCheckOutcome => ({
		violation,
		createSkipped,
	});

	let found: 'file' | 'directory' | null;
	try {
		found = await stat(value);
	} catch (error) {
		if (report.kind === 'redacted') {
			return failed(
				new ValidationError(`Failed to inspect path '${report.text}' for ${label}`, {
					code: 'CONSTRAINT_VIOLATED',
					details: { ...details, constraint: 'stat' },
					suggest: `Provide an accessible path for ${reference}`,
				}),
			);
		}
		const cause = error instanceof Error ? error.message : String(error);
		return failed(
			new ValidationError(`Failed to inspect path '${report.text}' for ${label}: ${cause}`, {
				code: 'CONSTRAINT_VIOLATED',
				details: { ...details, value: report.value, constraint: 'stat', cause },
				suggest: `Provide an accessible path for ${reference}`,
				cause: error,
			}),
		);
	}
	if (found === null) {
		if (checks.create && mkdir !== undefined) {
			try {
				await mkdir(value);
				return passed;
			} catch (error) {
				if (report.kind === 'redacted') {
					return failed(
						new ValidationError(`Failed to create directory '${report.text}' for ${label}`, {
							code: 'CONSTRAINT_VIOLATED',
							details: { ...details, constraint: 'create' },
							suggest: `Provide a creatable or existing directory path for ${reference}`,
						}),
					);
				}
				const cause = error instanceof Error ? error.message : String(error);
				return failed(
					new ValidationError(
						`Failed to create directory '${report.text}' for ${label}: ${cause}`,
						{
							code: 'CONSTRAINT_VIOLATED',
							details: { ...details, value: report.value, constraint: 'create', cause },
							suggest: `Provide a creatable or existing directory path for ${reference}`,
							cause: error,
						},
					),
				);
			}
		}
		// A declared `create` with no `mkdir` falls back to the existence rules;
		// the caller records that the creation never ran.
		const createSkipped = checks.create;
		if (!checks.mustExist) return { violation: undefined, createSkipped };
		return failed(
			new ValidationError(`Path '${report.text}' for ${label} does not exist`, {
				code: 'CONSTRAINT_VIOLATED',
				details: {
					...details,
					...(report.kind === 'visible' ? { value: report.value } : {}),
					constraint: 'mustExist',
				},
				suggest: `Provide an existing path for ${reference}`,
			}),
			createSkipped,
		);
	}
	if (checks.type !== undefined && found !== checks.type) {
		return failed(
			new ValidationError(
				`Path '${report.text}' for ${label} is a ${found}, expected a ${checks.type}`,
				{
					code: 'CONSTRAINT_VIOLATED',
					details: {
						...details,
						...(report.kind === 'visible' ? { value: report.value } : {}),
						constraint: 'pathType',
						expected: checks.type,
					},
					suggest: `Provide a ${checks.type} path for ${reference}`,
				},
			),
		);
	}
	return passed;
}

/**
 * Run one input's declared path checks over its resolved value.
 *
 * Shared by the flag and arg passes. Every path string the value carries is
 * checked when a `stat` probe is available; without one, nothing is probed and
 * the input is recorded as skipped instead, so the caller can report (or, in
 * strict mode, reject) a result whose checks never ran. A declared `create`
 * that found no `mkdir` for a missing path is recorded the same way.
 *
 * An input that resolved no path value records nothing: there was nothing a
 * production run would have checked either.
 *
 * @param subject - The flag or arg the value belongs to.
 * @param resolvedValue - The resolved value (string, array, or record).
 * @param checks - Expectations declared by `flag.path()` / `arg.path()`.
 * @param sensitive - Whether the owning schema marks the path as sensitive.
 * @param io - The injected filesystem capabilities.
 * @param collect - Where violations and skipped checks are reported.
 */
async function checkResolvedPath(
	subject: PathCheckSubject,
	resolvedValue: unknown,
	checks: PathChecks,
	sensitive: boolean,
	io: PathCheckIo,
	collect: PathCheckCollectors,
): Promise<void> {
	const values = pathValuesOf(resolvedValue);
	if (values.length === 0) return;

	if (io.stat === undefined) {
		collect.skipped.push({ kind: subject.kind, name: subject.name, checks, missing: 'stat' });
		return;
	}

	let createSkipped = false;
	for (const value of values) {
		const outcome = await validatePathChecks(subject, value, checks, io.stat, io.mkdir, sensitive);
		if (outcome.violation !== undefined) collect.errors.push(outcome.violation);
		createSkipped ||= outcome.createSkipped;
	}
	if (createSkipped) {
		collect.skipped.push({ kind: subject.kind, name: subject.name, checks, missing: 'mkdir' });
	}
}

/** One line of a `PATH_CHECK_SKIPPED` message, naming the input and what it lacked. */
function describeSkippedPathCheck(skipped: SkippedPathCheck): string {
	const label = subjectLabel(skipped);
	return skipped.missing === 'stat'
		? `${label}: no stat probe was supplied`
		: `${label}: no mkdir was supplied for create`;
}

/**
 * Build the error strict mode raises for checks that could not run.
 *
 * A `CLIError` rather than a `ValidationError`: the input may be perfectly
 * valid, and the closed `ValidationErrorCode` union is reserved for failures
 * the end user can fix. This one is for the caller that ran the command
 * without the filesystem capabilities its schema needs.
 *
 * @param skipped - Every skipped check resolution recorded (at least one).
 * @returns A `CLIError` with code `'PATH_CHECK_SKIPPED'` and exit code `1`.
 */
function pathChecksSkippedError(
	skipped: readonly [SkippedPathCheck, ...SkippedPathCheck[]],
): CLIError {
	const suggest =
		"Pass stat (and mkdir for create) in run options to exercise the checks, or drop pathChecks: 'strict'";
	const details = {
		skipped: skipped.map((entry) => ({
			kind: entry.kind,
			name: entry.name,
			missing: entry.missing,
			checks: {
				mustExist: entry.checks.mustExist,
				...(entry.checks.type !== undefined ? { type: entry.checks.type } : {}),
				create: entry.checks.create,
			},
		})),
	};
	if (skipped.length === 1) {
		return new CLIError(
			`Filesystem checks were skipped for ${describeSkippedPathCheck(skipped[0])}`,
			{
				code: 'PATH_CHECK_SKIPPED',
				details,
				suggest,
			},
		);
	}
	const lines = skipped.map((entry) => `  - ${describeSkippedPathCheck(entry)}`);
	return new CLIError(
		`Filesystem checks were skipped for ${skipped.length} inputs:\n${lines.join('\n')}`,
		{ code: 'PATH_CHECK_SKIPPED', details, suggest },
	);
}

/**
 * List the path strings a resolved value carries.
 *
 * Path checks belong to the element, so a collection is checked entry by entry:
 * an array yields its string elements and a record its string values. A value
 * of another type belongs to another codec and is skipped.
 *
 * @param value - The resolved flag or arg value.
 * @returns Every path string to check, possibly none.
 */
function pathValuesOf(value: unknown): readonly string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) {
		return value.filter((entry): entry is string => typeof entry === 'string');
	}
	if (typeof value === 'object' && value !== null) {
		return Object.values(value).filter((entry): entry is string => typeof entry === 'string');
	}
	return [];
}

export type {
	MkdirFn,
	PathCheckCollectors,
	PathCheckIo,
	PathCheckOutcome,
	PathCheckSubject,
	StatFn,
};
export { checkResolvedPath, pathChecksSkippedError, pathValuesOf, validatePathChecks };
