/**
 * Shared structural type guards.
 *
 * Consolidates the small `isRecord` / `isPlainObject` checks that were
 * previously duplicated across config, json-schema, and resolution modules.
 *
 * @module dreamcli/core/internal/guards
 * @internal
 */

/**
 * Loose object guard — any non-null, non-array `object`.
 *
 * Use when narrowing arbitrary values (error details, JSON walk) where exotic
 * prototypes are acceptable.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strict plain-object guard — a non-null, non-array object whose prototype is
 * `Object.prototype` or `null`.
 *
 * Use when validating parsed external data (config files, package.json) where
 * only structural JSON objects should pass.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

export { isPlainObject, isRecord };
