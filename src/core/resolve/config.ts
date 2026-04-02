/**
 * Internal resolver config helpers.
 *
 * @module dreamcli/core/resolve/config
 * @internal
 */

function resolveConfigPath(config: Readonly<Record<string, unknown>>, path: string): unknown {
	const segments = path.split('.');
	let current: unknown = config;

	for (const segment of segments) {
		if (current === null || current === undefined || typeof current !== 'object') {
			return undefined;
		}
		if (!Object.hasOwn(current, segment)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}

	return current;
}

export { resolveConfigPath };
