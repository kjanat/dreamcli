/**
 * String constraints for string-valued flags.
 *
 * A single, shared representation and validator so the parse path
 * (`core/parse`) and the resolver coercion path (`core/resolve/coerce`) cannot
 * drift: both import {@link validateStringConstraints} and apply the checks in
 * the same order (nonEmpty → minLength → maxLength → pattern).
 *
 * @module dreamcli/core/schema/string-constraints
 */

/**
 * Runtime string constraints attached to a string flag/arg schema.
 *
 * Length bounds are **inclusive** and measured in UTF-16 code units
 * (`String.prototype.length`). All fields are optional; an absent field means
 * "no constraint".
 */
interface StringConstraints {
	/**
	 * Reject empty strings (`''`). Whitespace-only strings are still accepted;
	 * combine with {@link StringConstraints.pattern | pattern} for stricter rules.
	 * @defaultValue `false`
	 */
	readonly nonEmpty?: boolean;
	/**
	 * Inclusive minimum length. Shorter values are rejected.
	 * @defaultValue `undefined` (no minimum)
	 */
	readonly minLength?: number;
	/**
	 * Inclusive maximum length. Longer values are rejected.
	 * @defaultValue `undefined` (no maximum)
	 */
	readonly maxLength?: number;
	/**
	 * Regular expression the value must match. Tested with
	 * `RegExp.prototype.test`; anchor with `^`/`$` for full-string matching.
	 * @defaultValue `undefined` (no pattern)
	 */
	readonly pattern?: RegExp;
}

/**
 * A failed string constraint, discriminated by which rule was violated.
 *
 * `minLength` / `maxLength` carry the offending bound and `pattern` carries
 * the source so callers can render them.
 */
type StringConstraintViolation =
	| { readonly kind: 'nonEmpty' }
	| { readonly kind: 'minLength'; readonly bound: number }
	| { readonly kind: 'maxLength'; readonly bound: number }
	| { readonly kind: 'pattern'; readonly pattern: string };

/**
 * Validate a string value against constraints.
 *
 * The single source of truth for string-constraint checks, shared by the
 * parse and coerce paths. Checks run in a fixed order — **nonEmpty →
 * minLength → maxLength → pattern** — and the first failure is returned.
 * Stateful regexes (`g` / `y` flags) are tested from index 0 every time, so
 * repeated validations cannot flip-flop on `lastIndex`.
 *
 * @param value - The string value to validate.
 * @param constraints - Constraints to enforce, or `undefined` for none.
 * @returns The first {@link StringConstraintViolation}, or `undefined` if valid.
 */
function validateStringConstraints(
	value: string,
	constraints: StringConstraints | undefined,
): StringConstraintViolation | undefined {
	if (constraints === undefined) {
		return undefined;
	}
	if (constraints.nonEmpty === true && value.length === 0) {
		return { kind: 'nonEmpty' };
	}
	if (constraints.minLength !== undefined && value.length < constraints.minLength) {
		return { kind: 'minLength', bound: constraints.minLength };
	}
	if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
		return { kind: 'maxLength', bound: constraints.maxLength };
	}
	if (constraints.pattern !== undefined) {
		constraints.pattern.lastIndex = 0;
		if (!constraints.pattern.test(value)) {
			return { kind: 'pattern', pattern: String(constraints.pattern) };
		}
	}
	return undefined;
}

/**
 * Render a terse, human-readable reason for a constraint violation.
 *
 * @param violation - The violation to describe.
 * @returns A message suffix such as `must not be empty` or `must match /^ghp_/`.
 */
function describeStringConstraintViolation(violation: StringConstraintViolation): string {
	switch (violation.kind) {
		case 'nonEmpty':
			return 'must not be empty';
		case 'minLength':
			return `must be at least ${violation.bound} characters`;
		case 'maxLength':
			return `must be at most ${violation.bound} characters`;
		case 'pattern':
			return `must match ${violation.pattern}`;
	}
}

/**
 * Assert that a constraints object is well-formed at schema-construction time.
 *
 * Length bounds must be non-negative integers — a fractional or negative
 * length is meaningless (omit the field for "no bound"). An inverted range
 * (`minLength > maxLength`) is also rejected, since it makes the flag/arg
 * permanently unsatisfiable. Throws so the misconfiguration surfaces where
 * the flag/arg is declared, not at parse time.
 *
 * @param constraints - The constraints to validate.
 * @throws RangeError if `minLength` or `maxLength` is negative, fractional, or
 *   non-finite, or if `minLength` exceeds `maxLength`.
 */
function assertStringConstraints(constraints: StringConstraints): void {
	for (const field of ['minLength', 'maxLength'] as const) {
		const bound = constraints[field];
		if (bound !== undefined && (!Number.isInteger(bound) || bound < 0)) {
			throw new RangeError(
				`string constraint '${field}' must be a non-negative integer (got ${bound}); omit it for no bound`,
			);
		}
	}
	if (
		constraints.minLength !== undefined &&
		constraints.maxLength !== undefined &&
		constraints.minLength > constraints.maxLength
	) {
		throw new RangeError(
			`string constraint 'minLength' (${constraints.minLength}) must not exceed 'maxLength' (${constraints.maxLength})`,
		);
	}
}

export type { StringConstraints, StringConstraintViolation };
export { assertStringConstraints, describeStringConstraintViolation, validateStringConstraints };
