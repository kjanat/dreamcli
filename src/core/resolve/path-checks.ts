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

import { ValidationError } from '#internals/core/errors/index.ts';
import type { PathChecks } from '#internals/core/schema/index.ts';
import { REDACTED } from './redaction.ts';

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

/**
 * Check a resolved path value against its declared filesystem expectations.
 *
 * @param subject - The flag or arg the value belongs to.
 * @param value - The resolved path.
 * @param checks - Expectations declared by `flag.path()` / `arg.path()`.
 * @param stat - Filesystem probe.
 * @param mkdir - Recursive directory creation, when the caller supplies one.
 * @param echo - Whether the source permits quoting the path, per
 *   `redaction.ts`. A path from stdin, env, config, prompt, or a default is
 *   quoted as `<redacted>` and omitted from `details`.
 * @returns `undefined` when the path satisfies the checks, or a
 *   {@link ValidationError} with code `'CONSTRAINT_VIOLATED'` otherwise.
 */
async function validatePathChecks(
	subject: PathCheckSubject,
	value: string,
	checks: PathChecks,
	stat: StatFn,
	mkdir: MkdirFn | undefined,
	echo: boolean,
): Promise<ValidationError | undefined> {
	const label = subjectLabel(subject);
	const reference = subjectReference(subject);
	const details = subjectDetails(subject);
	const quoted = echo ? value : REDACTED;
	const reported = echo ? { value } : {};

	const found = await stat(value);
	if (found === null) {
		if (checks.create && mkdir !== undefined) {
			try {
				await mkdir(value);
				return undefined;
			} catch (error) {
				return new ValidationError(
					`Failed to create directory '${quoted}' for ${label}: ${
						error instanceof Error ? error.message : String(error)
					}`,
					{
						code: 'CONSTRAINT_VIOLATED',
						details: { ...details, ...reported, constraint: 'create' },
						suggest: `Provide a creatable or existing directory path for ${reference}`,
					},
				);
			}
		}
		if (!checks.mustExist) return undefined;
		return new ValidationError(`Path '${quoted}' for ${label} does not exist`, {
			code: 'CONSTRAINT_VIOLATED',
			details: { ...details, ...reported, constraint: 'mustExist' },
			suggest: `Provide an existing path for ${reference}`,
		});
	}
	if (checks.type !== undefined && found !== checks.type) {
		return new ValidationError(
			`Path '${quoted}' for ${label} is a ${found}, expected a ${checks.type}`,
			{
				code: 'CONSTRAINT_VIOLATED',
				details: { ...details, ...reported, constraint: 'pathType', expected: checks.type },
				suggest: `Provide a ${checks.type} path for ${reference}`,
			},
		);
	}
	return undefined;
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
	if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
	if (typeof value === 'object' && value !== null) {
		return Object.values(value).filter((entry): entry is string => typeof entry === 'string');
	}
	return [];
}

export type { MkdirFn, PathCheckSubject, StatFn };
export { pathValuesOf, validatePathChecks };
