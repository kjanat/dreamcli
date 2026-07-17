/**
 * Standard Schema v1 validation pass.
 *
 * Runs after CLI/env/config/prompt/default resolution so a validator attached
 * via `flag.custom()` / `arg.custom()` sees the final value regardless of its
 * source. `~standard.validate` may be sync or async; both are awaited here.
 * Issues become `CONSTRAINT_VIOLATED` validation errors; a successful result
 * replaces the value with the validator's (possibly transformed) output.
 *
 * @module dreamcli/core/resolve/standard
 */

import { ValidationError } from '#internals/core/errors/index.ts';
import type { CommandSchema } from '#internals/core/schema/index.ts';
import type {
	StandardSchemaV1,
	StandardSchemaV1Issue,
	StandardSchemaV1PathSegment,
} from '#internals/core/schema/standard.ts';

/** Resolved values after the Standard Schema pass, plus any issues found. */
interface StandardValidationResult {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly errors: readonly ValidationError[];
}

/** Render an issue path (e.g. `['a', 0]` → `a.0`), or `undefined` when empty. */
function formatIssuePath(
	path: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined,
): string | undefined {
	if (path === undefined || path.length === 0) {
		return undefined;
	}
	return path
		.map((segment) => {
			const key = typeof segment === 'object' ? segment.key : segment;
			return typeof key === 'symbol' ? key.toString() : String(key);
		})
		.join('.');
}

/** Build a `CONSTRAINT_VIOLATED` message from a validator's issues. */
function issuesMessage(label: string, issues: ReadonlyArray<StandardSchemaV1Issue>): string {
	const rendered = issues.map((issue) => {
		const path = formatIssuePath(issue.path);
		return path === undefined ? issue.message : `${path}: ${issue.message}`;
	});
	return `${label} failed validation: ${rendered.join('; ')}`;
}

/** Await a validator against a single value, mapping failure to a typed error. */
async function validateValue(
	label: string,
	value: unknown,
	validator: StandardSchemaV1,
): Promise<
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError }
> {
	const result = await validator['~standard'].validate(value);
	if (result.issues !== undefined) {
		return {
			ok: false,
			error: new ValidationError(issuesMessage(label, result.issues), {
				code: 'CONSTRAINT_VIOLATED',
				details: { value, issues: result.issues.map((issue) => issue.message) },
				suggest: `Provide a value for ${label} that satisfies its validator`,
			}),
		};
	}
	return { ok: true, value: result.value };
}

/**
 * Validate resolved flag and arg values against any attached Standard Schema
 * validators. Values without a validator, or resolved to `undefined`, pass
 * through untouched.
 *
 * @param schema - The command schema carrying per-flag/arg validators.
 * @param flags - Resolved flag values, keyed by flag name.
 * @param args - Resolved arg values, keyed by arg name.
 * @returns The (possibly transformed) values and any constraint violations.
 * @internal
 */
async function applyStandardValidators(
	schema: CommandSchema,
	flags: Readonly<Record<string, unknown>>,
	args: Readonly<Record<string, unknown>>,
): Promise<StandardValidationResult> {
	const errors: ValidationError[] = [];
	const nextFlags: Record<string, unknown> = { ...flags };
	for (const [name, flagSchema] of Object.entries(schema.flags)) {
		const value = flags[name];
		if (value === undefined) {
			continue;
		}
		const elementValidator =
			flagSchema.kind === 'array' ? flagSchema.elementSchema?.standard : undefined;
		if (elementValidator !== undefined && Array.isArray(value)) {
			const nextValue: unknown[] = [];
			for (const [index, element] of value.entries()) {
				const result = await validateValue(`--${name}[${index}]`, element, elementValidator);
				if (result.ok) {
					nextValue.push(result.value);
				} else {
					nextValue.push(element);
					errors.push(result.error);
				}
			}
			nextFlags[name] = nextValue;
			continue;
		}

		const validator = flagSchema.standard;
		if (validator === undefined) {
			continue;
		}
		const result = await validateValue(`--${name}`, value, validator);
		if (result.ok) {
			nextFlags[name] = result.value;
		} else {
			errors.push(result.error);
		}
	}

	const nextArgs: Record<string, unknown> = { ...args };
	for (const entry of schema.args) {
		const validator = entry.schema.standard;
		const value = args[entry.name];
		if (validator === undefined || value === undefined) {
			continue;
		}
		if (entry.schema.variadic && Array.isArray(value)) {
			const nextValue: unknown[] = [];
			for (const [index, element] of value.entries()) {
				const result = await validateValue(`<${entry.name}>[${index}]`, element, validator);
				if (result.ok) {
					nextValue.push(result.value);
				} else {
					nextValue.push(element);
					errors.push(result.error);
				}
			}
			nextArgs[entry.name] = nextValue;
			continue;
		}

		const result = await validateValue(`<${entry.name}>`, value, validator);
		if (result.ok) {
			nextArgs[entry.name] = result.value;
		} else {
			errors.push(result.error);
		}
	}

	return { flags: nextFlags, args: nextArgs, errors };
}

export { applyStandardValidators };
