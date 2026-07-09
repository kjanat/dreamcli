/**
 * Runtime compatibility matrix and version guard helpers.
 *
 * Keeps the supported runtime story in one place so adapter guards,
 * package engines, and docs can stay aligned.
 *
 * @internal
 * @module @kjanat/dreamcli/runtime/support
 */

type SupportedRuntime = 'node' | 'bun' | 'deno';

/**
 * Support entry for a single runtime: version bounds, display names, and adapter mapping.
 *
 * @internal
 */
interface RuntimeSupportEntry {
	/** Runtime identifier key. */
	readonly runtime: SupportedRuntime;
	/** Human-readable name (e.g. `'Node.js'`, `'Bun'`). */
	readonly displayName: string;
	/** Minimum supported version (semver, e.g. `'22.22.2'`). */
	readonly minimum: string;
	/** `engines` range string for package.json (e.g. `'>=22.22.2'`). */
	readonly engineRange: string;
	/** npm/JSR package name that ships this adapter. */
	readonly packageName: string;
	/** Adapter factory function name (e.g. `'NodeAdapter'`). */
	readonly adapterName: string;
}

/** All supported runtimes with their version bounds and adapter metadata. @internal */
const SUPPORTED_RUNTIMES: readonly RuntimeSupportEntry[] = [
	{
		runtime: 'node',
		displayName: 'Node.js',
		minimum: '22.22.2',
		engineRange: '>=22.22.2',
		packageName: '@kjanat/dreamcli',
		adapterName: 'NodeAdapter',
	},
	{
		runtime: 'bun',
		displayName: 'Bun',
		minimum: '1.3',
		engineRange: '>=1.3',
		packageName: '@kjanat/dreamcli',
		adapterName: 'NodeAdapter',
	},
	{
		runtime: 'deno',
		displayName: 'Deno',
		minimum: '2.6.0',
		engineRange: '>=2.6.0',
		packageName: '@kjanat/dreamcli',
		adapterName: 'DenoAdapter',
	},
];

/** Look up the support entry for a given runtime. Throws on unknown runtime. @internal */
function getRuntimeSupport(runtime: SupportedRuntime): RuntimeSupportEntry {
	for (const entry of SUPPORTED_RUNTIMES) {
		if (entry.runtime === runtime) return entry;
	}

	throw new Error(`Unknown supported runtime '${runtime}'`);
}

/** Format a human-readable version requirement string (e.g. `'Node.js >= 22.22.2'`). @internal */
function formatRuntimeRequirement(runtime: SupportedRuntime): string {
	const support = getRuntimeSupport(runtime);
	return `${support.displayName} >= ${support.minimum}`;
}

export type { RuntimeSupportEntry, SupportedRuntime };
export { formatRuntimeRequirement, getRuntimeSupport, SUPPORTED_RUNTIMES };
