/**
 * Runtime compatibility matrix and version guard helpers.
 *
 * Keeps the supported runtime story in one place so adapter guards,
 * package engines, and docs can stay aligned.
 *
 * @internal
 * @module dreamcli/runtime/support
 */

type SupportedRuntime = 'node' | 'bun' | 'deno';

interface RuntimeSupportEntry {
	readonly runtime: SupportedRuntime;
	readonly displayName: string;
	readonly minimum: string;
	readonly engineRange: string;
	readonly packageName: string;
	readonly adapterName: string;
}

const SUPPORTED_RUNTIMES: readonly RuntimeSupportEntry[] = [
	{
		runtime: 'node',
		displayName: 'Node.js',
		minimum: '22.22.2',
		engineRange: '>=22.22.2',
		packageName: 'dreamcli',
		adapterName: 'NodeAdapter',
	},
	{
		runtime: 'bun',
		displayName: 'Bun',
		minimum: '1.3.11',
		engineRange: '>=1.3.11',
		packageName: 'dreamcli',
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

function formatRuntimeRequirement(runtime: SupportedRuntime): string {
	const support = getRuntimeSupport(runtime);
	return `${support.displayName} >= ${support.minimum}`;
}

function isRuntimeVersionSupported(runtime: SupportedRuntime, version: string): boolean {
	const parsedVersion = parseVersion(version);
	const minimumVersion = parseVersion(getRuntimeSupport(runtime).minimum);
	if (parsedVersion === undefined || minimumVersion === undefined) return false;
	return compareVersions(parsedVersion, minimumVersion) >= 0;
}

function assertRuntimeVersionSupported(
	runtime: SupportedRuntime,
	version: string | undefined,
): void {
	if (version === undefined) return;
	if (isRuntimeVersionSupported(runtime, version)) return;

	throw new Error(
		`dreamcli requires ${formatRuntimeRequirement(runtime)}. Detected ${getRuntimeSupport(runtime).displayName} ${version}.`,
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
