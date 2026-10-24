/**
 * Explaining why an environment variable reads as unset.
 *
 * A runtime adapter whose env view cannot see every variable, such as Deno
 * under a scoped `--allow-env` grant, attaches an access hint to the view
 * under {@link ENV_ACCESS_HINT}. Missing-input diagnostics append the hint,
 * so they name the grant to add without ever reading a value.
 *
 * @module dreamcli/core/resolve/env-access
 * @internal
 */

/**
 * Where an env view keeps its access hint. A registered symbol, so a view
 * built by one copy of the package is understood by another.
 */
const ENV_ACCESS_HINT: unique symbol = Symbol.for('@kjanat/dreamcli/env-access-hint');

/** Explains why `name` may read as unset, or `undefined` when it is readable. */
type EnvAccessHint = (name: string) => string | undefined;

/**
 * The access hint an env view carries for one variable.
 *
 * @param env - The env view resolution reads.
 * @param name - The concrete variable name.
 * @returns The hint, or `undefined` when the view has none for `name`.
 */
function envAccessHint(
	env: Readonly<Record<string, string | undefined>>,
	name: string,
): string | undefined {
	const hint: unknown = Reflect.get(env, ENV_ACCESS_HINT);
	if (typeof hint !== 'function') return undefined;
	const text: unknown = hint(name);
	return typeof text === 'string' ? text : undefined;
}

export type { EnvAccessHint };
export { ENV_ACCESS_HINT, envAccessHint };
