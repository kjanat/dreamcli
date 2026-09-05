/**
 * Projection of structured error details onto values `JSON.stringify` can
 * represent without throwing.
 *
 * @module dreamcli/core/errors/json-safe
 * @internal
 */

/** Marker for a value that has no JSON projection. */
const OMIT: unique symbol = Symbol('omit');

/** Project one value, or report that it has no JSON representation. */
function project(value: unknown, ancestors: WeakSet<object>): unknown {
	switch (typeof value) {
		case 'string':
		case 'number':
		case 'boolean':
			return value;
		case 'bigint':
			return String(value);
		case 'undefined':
		case 'function':
		case 'symbol':
			return OMIT;
		case 'object':
			break;
	}
	if (value === null) return null;
	if (ancestors.has(value)) return OMIT;

	const toJSON: unknown = Reflect.get(value, 'toJSON');
	if (typeof toJSON === 'function') {
		let replaced: unknown;
		try {
			replaced = Reflect.apply(toJSON, value, []);
		} catch {
			return OMIT;
		}
		return replaced === value ? projectStructure(value, ancestors) : project(replaced, ancestors);
	}

	return projectStructure(value, ancestors);
}

/** Project an array or plain object entry by entry. */
function projectStructure(value: object, ancestors: WeakSet<object>): unknown {
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.map((entry: unknown) => {
				const projected = project(entry, ancestors);
				return projected === OMIT ? null : projected;
			});
		}
		return projectRecord(value, ancestors);
	} finally {
		ancestors.delete(value);
	}
}

/** Project an object's own enumerable string-keyed entries, dropping any without a projection. */
function projectRecord(value: object, ancestors: WeakSet<object>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		const projected = project(entry, ancestors);
		if (projected !== OMIT) out[key] = projected;
	}
	return out;
}

/**
 * Project a record of error details onto JSON-representable values.
 *
 * Bigints become their decimal digits. Entries that JSON cannot carry, such as
 * functions, symbols, `undefined`, and cyclic references, are omitted. Values
 * with a `toJSON()` method are projected through it, as `JSON.stringify` would.
 *
 * @param details - The structured details as an error object holds them.
 * @returns A record `JSON.stringify` accepts without throwing.
 */
function toJsonSafeRecord(
	details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return projectRecord(details, new WeakSet());
}

export { toJsonSafeRecord };
