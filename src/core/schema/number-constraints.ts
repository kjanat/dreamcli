/**
 * Numeric constraints for number-valued flags and args.
 *
 * A single, shared representation and validator so the parse path
 * (`core/parse`) and the resolver coercion path (`core/resolve/coerce`) cannot
 * drift: both import {@link validateNumberConstraints} and apply the checks in
 * the same order (finite → int → min → max).
 *
 * @module dreamcli/core/schema/number-constraints
 */

/**
 * Runtime numeric constraints attached to a number flag/arg schema.
 *
 * Bounds are **inclusive**. All fields are optional; an absent field means "no
 * constraint" except for {@link NumberConstraints.finite | finite}, which
 * defaults to `true` (so `Infinity` / `-Infinity` are rejected unless opted
 * back in).
 */
interface NumberConstraints {
	/**
	 * Inclusive lower bound. Values below this are rejected.
	 * @defaultValue `undefined` (no lower bound)
	 */
	readonly min?: number;
	/**
	 * Inclusive upper bound. Values above this are rejected.
	 * @defaultValue `undefined` (no upper bound)
	 */
	readonly max?: number;
	/**
	 * Require an integer value. Non-integers (e.g. `3.7`) are rejected.
	 * @defaultValue `false`
	 */
	readonly int?: boolean;
	/**
	 * Require a finite value. When `true`, `Infinity` / `-Infinity` are rejected.
	 * @defaultValue `true`
	 */
	readonly finite?: boolean;
}

/**
 * A failed numeric constraint, discriminated by which rule was violated.
 *
 * `min` / `max` carry the offending bound so callers can render it.
 */
type NumberConstraintViolation =
	| { readonly kind: 'finite' }
	| { readonly kind: 'int' }
	| { readonly kind: 'min'; readonly bound: number }
	| { readonly kind: 'max'; readonly bound: number };

/** Default for {@link NumberConstraints.finite} — reject `Infinity` unless opted out. */
const DEFAULT_FINITE = true;

/**
 * Validate a numeric value against constraints.
 *
 * The single source of truth for numeric-constraint checks, shared by the
 * parse and coerce paths. Checks run in a fixed order — **finite → int → min →
 * max** — and the first failure is returned. `NaN` is always rejected as a
 * `finite` violation, regardless of the `finite` option (a non-finite value can
 * otherwise slip past `min`/`max`, since `NaN < x` and `NaN > x` are both false).
 *
 * @param value - The numeric value to validate.
 * @param constraints - Constraints to enforce, or `undefined` for defaults.
 * @returns The first {@link NumberConstraintViolation}, or `undefined` if valid.
 */
function validateNumberConstraints(
	value: number,
	constraints: NumberConstraints | undefined,
): NumberConstraintViolation | undefined {
	if (Number.isNaN(value)) {
		return { kind: 'finite' };
	}
	const finite = constraints?.finite ?? DEFAULT_FINITE;
	if (finite && !Number.isFinite(value)) {
		return { kind: 'finite' };
	}
	if (constraints?.int === true && !Number.isInteger(value)) {
		return { kind: 'int' };
	}
	if (constraints?.min !== undefined && value < constraints.min) {
		return { kind: 'min', bound: constraints.min };
	}
	if (constraints?.max !== undefined && value > constraints.max) {
		return { kind: 'max', bound: constraints.max };
	}
	return undefined;
}

/**
 * Render a terse, human-readable reason for a constraint violation.
 *
 * @param violation - The violation to describe.
 * @returns A message suffix such as `must be an integer` or `must be >= 0`.
 */
function describeNumberConstraintViolation(violation: NumberConstraintViolation): string {
	switch (violation.kind) {
		case 'finite':
			return 'must be a finite number';
		case 'int':
			return 'must be an integer';
		case 'min':
			return `must be >= ${violation.bound}`;
		case 'max':
			return `must be <= ${violation.bound}`;
	}
}

/**
 * Assert that a constraints object is well-formed at schema-construction time.
 *
 * `min` / `max` must be finite — an infinite or `NaN` bound is meaningless (omit
 * the field for "no bound") and would serialize to `null` in the emitted JSON
 * Schema. An inverted range (`min > max`) is also rejected, since it makes the
 * flag/arg permanently unsatisfiable. Throws so the misconfiguration surfaces
 * where the flag/arg is declared, not at parse time.
 *
 * @param constraints - The constraints to validate.
 * @throws RangeError if `min` or `max` is non-finite (`Infinity` / `-Infinity` /
 *   `NaN`), or if `min` exceeds `max`.
 */
function assertNumberConstraints(constraints: NumberConstraints): void {
	if (constraints.min !== undefined && !Number.isFinite(constraints.min)) {
		throw new RangeError(
			`number constraint 'min' must be a finite number (got ${constraints.min}); omit it for no lower bound`,
		);
	}
	if (constraints.max !== undefined && !Number.isFinite(constraints.max)) {
		throw new RangeError(
			`number constraint 'max' must be a finite number (got ${constraints.max}); omit it for no upper bound`,
		);
	}
	if (
		constraints.min !== undefined &&
		constraints.max !== undefined &&
		constraints.min > constraints.max
	) {
		throw new RangeError(
			`number constraint 'min' (${constraints.min}) must not exceed 'max' (${constraints.max})`,
		);
	}
}

export type { NumberConstraints, NumberConstraintViolation };
export {
	assertNumberConstraints,
	DEFAULT_FINITE,
	describeNumberConstraintViolation,
	validateNumberConstraints,
};
