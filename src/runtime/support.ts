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
		minimum: '1.3.11',
		engineRange: '>=1.3.11',
		packageName: '@kjanat/dreamcli',
		adapterName: 'BunAdapter',
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

interface ParsedVersion {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
}

const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/** Look up the support entry for a given runtime. Throws on unknown runtime. @internal */
function getRuntimeSupport(runtime: SupportedRuntime): RuntimeSupportEntry {
	for (const entry of SUPPORTED_RUNTIMES) {
		if (entry.runtime === runtime) return entry;
	}

	throw new Error(`Unknown supported runtime '${runtime}'`);
}

function parseVersion(version: string): ParsedVersion | undefined {
	const match = VERSION_PATTERN.exec(version);
	if (match === null) return undefined;

	const major = Number.parseInt(match[1] ?? '', 10);
	const minorText = match[2];
	const minor = minorText === undefined ? 0 : Number.parseInt(minorText, 10);
	const patchText = match[3];
	const patch = patchText === undefined ? 0 : Number.parseInt(patchText, 10);

	if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
		return undefined;
	}

	return { major, minor, patch };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	return left.patch - right.patch;
}

/** Format a human-readable version requirement string (e.g. `'Node.js >= 22.22.2'`). @internal */
function formatRuntimeRequirement(runtime: SupportedRuntime): string {
	const support = getRuntimeSupport(runtime);
	return `${support.displayName} >= ${support.minimum}`;
}

/** Check whether a version string meets the minimum for the given runtime. @internal */
function isRuntimeVersionSupported(runtime: SupportedRuntime, version: string): boolean {
	const parsedVersion = parseVersion(version);
	const minimumVersion = parseVersion(getRuntimeSupport(runtime).minimum);
	if (parsedVersion === undefined || minimumVersion === undefined) return false;
	return compareVersions(parsedVersion, minimumVersion) >= 0;
}

/** Throw if the detected version is below the minimum. No-op when version is undefined. @internal */
function assertRuntimeVersionSupported(
	runtime: SupportedRuntime,
	version: string | undefined,
): void {
	if (version === undefined) return;
	if (isRuntimeVersionSupported(runtime, version)) return;

	throw new Error(
		`@kjanat/dreamcli requires ${formatRuntimeRequirement(runtime)}. Detected ${getRuntimeSupport(runtime).displayName} ${version}.`,
	);
}

export type { RuntimeSupportEntry, SupportedRuntime };
export {
	assertRuntimeVersionSupported,
	formatRuntimeRequirement,
	getRuntimeSupport,
	isRuntimeVersionSupported,
	SUPPORTED_RUNTIMES,
};
