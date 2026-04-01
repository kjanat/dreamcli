/**
 * Shared env-based path resolution for runtime adapters.
 *
 * Node, Bun, and Deno all need the same user home/config directory behavior.
 * These helpers keep the fallback chain identical across runtimes while
 * letting each adapter supply its own platform detection.
 *
 * @module dreamcli/runtime/paths
 */

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
	const normalizedHome = homedir.replace(/\/+$/, '') || homedir;
	return env.XDG_CONFIG_HOME || `${normalizedHome}/.config`;
}

export { resolveConfigDirectory, resolveHomeDirectory };
