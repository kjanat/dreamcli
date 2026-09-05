/**
 * Sensitivity-aware representation of a raw value used in diagnostics.
 *
 * Callers branch on the schema's sensitivity before this module formats the
 * value. The redacted branch cannot carry the raw value, which prevents later
 * message and details construction from reading it accidentally.
 *
 * @module dreamcli/core/errors/diagnostic-value
 * @internal
 */

/** Stable placeholder used wherever a sensitive value would otherwise appear. */
const REDACTED = '<redacted>';

/** A value safe to report, or a redacted marker that cannot retain the value. */
type DiagnosticValue<T> =
	| { readonly kind: 'visible'; readonly value: T; readonly text: string }
	| { readonly kind: 'redacted'; readonly text: typeof REDACTED };

/** Format a visible value without assuming it is already a string. */
function formatDiagnosticValue(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		const json = JSON.stringify(value);
		if (json !== undefined) return json;
	} catch {
		// Fall through to String() for values JSON cannot represent.
	}
	try {
		return String(value);
	} catch {
		return '<unprintable>';
	}
}

/**
 * Build the only representation diagnostic construction should consume.
 *
 * Formatting runs only in the visible branch. The redacted branch contains no
 * raw value, including when the value has a custom `toJSON()` or `toString()`.
 */
function diagnosticValue<T>(sensitive: boolean, value: T): DiagnosticValue<T> {
	if (sensitive) return { kind: 'redacted', text: REDACTED };
	return { kind: 'visible', value, text: formatDiagnosticValue(value) };
}

export type { DiagnosticValue };
export { diagnosticValue, REDACTED };
