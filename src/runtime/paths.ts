/**
 * Shared env-based path resolution for runtime adapters.
 *
 * Node, Bun, and Deno all need the same user home/config directory behavior.
 * These helpers keep the fallback chain identical across runtimes while
 * letting each adapter supply its own platform detection.
 *
 * @module @kjanat/dreamcli/runtime/paths
 */

/**
 * Resolve the user's home directory from environment variables.
 *
 * @param env - Environment variable map.
 * @param isWindows - Whether the platform is Windows.
 * @returns Absolute path to the home directory.
 * @internal
 */
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

/**
 * Resolve the user's config directory (`XDG_CONFIG_HOME` / `APPDATA`).
 *
 * @param env - Environment variable map.
 * @param isWindows - Whether the platform is Windows.
 * @param homedir - Pre-resolved home directory (from {@link resolveHomeDirectory}).
 * @returns Absolute path to the config directory.
 * @internal
 */
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
