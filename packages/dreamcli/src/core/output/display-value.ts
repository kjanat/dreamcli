/**
 * Shared runtime-value formatting for human-readable output.
 *
 * Used by help text and table rendering so default values and structured cells
 * stringify consistently across the CLI surface.
 *
 * @module dreamcli/core/output/display-value
 * @internal
 */

/**
 * Format an unknown runtime value for human-readable output.
 *
 * @param value - The value to format (any type).
 * @returns A string representation suitable for table cells and help text.
 */
function formatDisplayValue(value: unknown): string {
	if (value === null || value === undefined) return '';

	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint' ||
		typeof value === 'symbol'
	) {
		return String(value);
	}

	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) {
			return 'Invalid Date';
		}
		return value.toISOString();
	}

	if (typeof value === 'function') {
		return value.name.length > 0 ? `[Function: ${value.name}]` : '[Function]';
	}

	try {
		return JSON.stringify(value) ?? '[unserializable]';
	} catch {
		return '[unserializable]';
	}
}

export { formatDisplayValue };
