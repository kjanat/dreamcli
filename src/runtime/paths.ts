/**
 * Shared env-based path resolution for runtime adapters.
 *
 * Node, Bun, and Deno all need the same user home/config directory behavior,
 * but only Node can reliably inspect the platform directly without extra
 * permissions. These helpers keep the fallback chain identical across
 * runtimes while letting each adapter choose how to detect Windows.
 *
 * @module dreamcli/runtime/paths
 */

/** @internal */
function isWindowsEnv(env: Readonly<Record<string, string | undefined>>): boolean {
	return (
		(env.APPDATA !== undefined && env.APPDATA !== '') ||
		env.USERPROFILE !== undefined ||
		(env.HOMEDRIVE !== undefined && env.HOMEPATH !== undefined)
	);
}

/** @internal */
function resolveHomeDirectory(
	env: Readonly<Record<string, string | undefined>>,
	isWindows: boolean,
): string {
	if (isWindows) {
		if (env.USERPROFILE) return env.USERPROFILE;
		if (env.HOMEDRIVE && env.HOMEPATH) {
			return env.HOMEDRIVE + env.HOMEPATH;
		}
		return env.HOME || 'C:\\';
	}
	return env.HOME || '/';
}

/** @internal */
function resolveConfigDirectory(
	env: Readonly<Record<string, string | undefined>>,
	isWindows: boolean,
	homedir: string,
): string {
	if (isWindows) {
		if (env.APPDATA !== undefined && env.APPDATA !== '') return env.APPDATA;
		const normalizedHome = homedir.replace(/[\\/]+$/, '') || homedir;
		return `${normalizedHome}\\AppData\\Roaming`;
	}
	return env.XDG_CONFIG_HOME || `${homedir}/.config`;
}

export { isWindowsEnv, resolveConfigDirectory, resolveHomeDirectory };
