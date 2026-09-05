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

import { diagnosticValue } from '#internals/core/errors/diagnostic-value.ts';
import { ValidationError } from '#internals/core/errors/index.ts';
import {
	argCardinality,
	flagCardinality,
	isCollection,
} from '#internals/core/schema/cardinality.ts';
import type { CommandSchema } from '#internals/core/schema/index.ts';
import type {
	StandardSchemaV1,
	StandardSchemaV1Issue,
	StandardSchemaV1PathSegment,
} from '#internals/core/schema/standard.ts';
import {
	argAggregateStandard,
	argValueSchema,
	flagAggregateStandard,
	flagValueSchema,
} from '#internals/core/schema/value.ts';

/** Resolved values after the Standard Schema pass, plus any issues found. */
interface StandardValidationResult {
	readonly flags: Readonly<Record<string, unknown>>;
	readonly args: Readonly<Record<string, unknown>>;
	readonly errors: readonly ValidationError[];
}

/** Render an issue path (e.g. `['a', 0]` → `a.0`), or `undefined` when empty. */
function formatIssuePath(
	path: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined,
	sensitive: boolean,
): string | undefined {
	if (sensitive || path === undefined || path.length === 0) {
		return undefined;
	}
	return path
		.map((segment) => {
			const key = typeof segment === 'object' ? segment.key : segment;
			return typeof key === 'number' ? String(key) : diagnosticValue(false, key).text;
		})
		.join('.');
}

/** Build a `CONSTRAINT_VIOLATED` message from a validator's issues. */
function issuesMessage(
	label: string,
	issues: ReadonlyArray<StandardSchemaV1Issue>,
	sensitive: boolean,
): string {
	const rendered = issues.map((issue) => {
		const path = formatIssuePath(issue.path, sensitive);
		return path === undefined ? issue.message : `${path}: ${issue.message}`;
	});
	return `${label} failed validation: ${rendered.join('; ')}`;
}

/** Await a validator against a single value, mapping failure to a typed error. */
async function validateValue(
	label: string,
	value: unknown,
	validator: StandardSchemaV1,
	sensitive: boolean,
): Promise<
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ValidationError }
> {
	let result: StandardSchemaV1.Result<unknown>;
	try {
		result = await validator['~standard'].validate(value);
	} catch (cause) {
		// Validator-authored text is an explicit trust boundary and stays verbatim.
		const message = cause instanceof Error ? cause.message : String(cause);
		const report = diagnosticValue(sensitive, value);
		return {
			ok: false,
			error: new ValidationError(`${label} validator threw: ${message}`, {
				code: 'CONSTRAINT_VIOLATED',
				...(report.kind === 'visible' ? { details: { value: report.value, cause: message } } : {}),
				suggest: `Fix the validator for ${label}, or provide a value it can process`,
			}),
		};
	}
	if (result.issues !== undefined) {
		const report = diagnosticValue(sensitive, value);
		return {
			ok: false,
			error: new ValidationError(issuesMessage(label, result.issues, sensitive), {
				code: 'CONSTRAINT_VIOLATED',
				details: {
					...(report.kind === 'visible' ? { value: report.value } : {}),
					issues: result.issues.map((issue) => issue.message),
				},
				suggest: `Provide a value for ${label} that satisfies its validator`,
			}),
		};
	}
	return { ok: true, value: result.value };
}

/**
 * Read one resolved value by name.
 *
 * `resolve()` runs this pass even after a resolver threw, so the record may be
 * missing a declared name, and a name such as `toString` reads back the
 * inherited `Object.prototype` method from a bare lookup.
 *
 * @param values - Resolved flag or arg record.
 * @param name - Flag or arg name to read.
 * @returns The resolved value, or `undefined` when the record does not carry it.
 */
function resolvedValue(values: Readonly<Record<string, unknown>>, name: string): unknown {
	return Object.hasOwn(values, name) ? values[name] : undefined;
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
		const value = resolvedValue(flags, name);
		if (value === undefined) continue;
		const validated = await validateInput(
			`--${name}`,
			value,
			isCollection(flagCardinality(flagSchema)),
			flagValueSchema(flagSchema).standard,
			flagAggregateStandard(flagSchema),
			errors,
			flagSchema.sensitive,
		);
		if (validated.changed) nextFlags[name] = validated.value;
	}

	const nextArgs: Record<string, unknown> = { ...args };
	for (const entry of schema.args) {
		const value = resolvedValue(args, entry.name);
		if (value === undefined) continue;
		const validated = await validateInput(
			`<${entry.name}>`,
			value,
			isCollection(argCardinality(entry.schema)),
			argValueSchema(entry.schema).standard,
			argAggregateStandard(entry.schema),
			errors,
			entry.schema.sensitive,
		);
		if (validated.changed) nextArgs[entry.name] = validated.value;
	}

	return { flags: nextFlags, args: nextArgs, errors };
}

/**
 * Run the element pass and then the aggregate pass over one resolved value.
 *
 * A collection validates every element before the completed array or record
 * reaches the aggregate validator, so an element issue names the element.
 *
 * @param label - How the input is spelled in diagnostics.
 * @param value - The resolved value.
 * @param collection - Whether the input's cardinality aggregates values.
 * @param element - Validator for each element, or for the value itself.
 * @param aggregate - Validator for the completed collection.
 * @param errors - Collector for the issues found.
 * @param sensitive - Whether the owning input hides framework-controlled value data.
 * @returns The value to store, and whether validation replaced it.
 */
async function validateInput(
	label: string,
	value: unknown,
	collection: boolean,
	element: StandardSchemaV1 | undefined,
	aggregate: StandardSchemaV1 | undefined,
	errors: ValidationError[],
	sensitive: boolean,
): Promise<{ readonly changed: boolean; readonly value: unknown }> {
	let current = value;
	let changed = false;
	const errorCount = errors.length;

	if (element !== undefined) {
		const validated = collection
			? await validateElements(label, current, element, errors, sensitive)
			: await validateOne(label, current, element, errors, sensitive);
		current = validated.value;
		changed = changed || validated.changed;
	}

	if (aggregate !== undefined && errors.length === errorCount) {
		const result = await validateValue(label, current, aggregate, sensitive);
		if (result.ok) {
			current = result.value;
			changed = true;
		} else {
			errors.push(result.error);
		}
	}

	return { changed, value: current };
}

/** Apply the element validator to a value, entry by entry when it is a collection. */
async function validateElements(
	label: string,
	value: unknown,
	validator: StandardSchemaV1,
	errors: ValidationError[],
	sensitive: boolean,
): Promise<{ readonly changed: boolean; readonly value: unknown }> {
	if (Array.isArray(value)) {
		const next: unknown[] = [];
		for (const [index, element] of value.entries()) {
			const result = await validateValue(`${label}[${index}]`, element, validator, sensitive);
			if (result.ok) {
				next.push(result.value);
			} else {
				next.push(element);
				errors.push(result.error);
			}
		}
		return { changed: true, value: next };
	}

	if (isPlainRecord(value)) {
		// Object.fromEntries defines own data properties, so a '__proto__' key is
		// rebuilt verbatim instead of reaching the prototype setter.
		const next = new Map<string, unknown>();
		for (const [key, entry] of Object.entries(value)) {
			const entryLabel = sensitive ? label : `${label}.${diagnosticValue(false, key).text}`;
			const result = await validateValue(entryLabel, entry, validator, sensitive);
			next.set(key, result.ok ? result.value : entry);
			if (!result.ok) errors.push(result.error);
		}
		return { changed: true, value: Object.fromEntries(next) };
	}

	return validateOne(label, value, validator, errors, sensitive);
}

/** Apply a validator to one value. */
async function validateOne(
	label: string,
	value: unknown,
	validator: StandardSchemaV1,
	errors: ValidationError[],
	sensitive: boolean,
): Promise<{ readonly changed: boolean; readonly value: unknown }> {
	const result = await validateValue(label, value, validator, sensitive);
	if (result.ok) return { changed: true, value: result.value };
	errors.push(result.error);
	return { changed: false, value };
}

/** Whether a resolved value is the record an entries collection produces. */
function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export { applyStandardValidators };
