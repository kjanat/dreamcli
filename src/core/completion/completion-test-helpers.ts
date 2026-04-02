/**
 * Shared test helpers for extracting structure from generated completion scripts.
 *
 * @module dreamcli/core/completion/completion-test-helpers
 * @internal
 */

/**
 * @internal
 * Extract the root-level completion words from a bash completion script.
 *
 * Finds the last `compgen -W '...' -- "$cur"` block and returns the
 * space-separated words as an array.
 *
 * @param script - The full generated bash completion script.
 * @returns The root-level completion words.
 */
function extractBashRootWords(script: string): readonly string[] {
	const matches = [...script.matchAll(/compgen -W '([^']*)' -- "\$cur"/g)];
	const words = matches[matches.length - 1]?.[1];
	if (words === undefined) {
		throw new Error('Could not find root bash completion words');
	}
	return words.split(' ').filter(Boolean);
}

/**
 * @internal
 * Extract the body of the root zsh completion function from a zsh
 * completion script.
 *
 * @param script - The full generated zsh completion script.
 * @param funcName - The function name to locate (e.g. `'_mycli'`).
 * @returns The function body (from signature through closing brace).
 */
function extractZshRootFunction(script: string, funcName: string): string {
	const start = script.indexOf(`${funcName}() {`);
	if (start === -1) {
		throw new Error(`Could not find zsh root function '${funcName}'`);
	}
	const end = script.indexOf(`\n}\n\n${funcName} "$@"`, start);
	if (end === -1) {
		throw new Error(`Could not find end of zsh root function '${funcName}'`);
	}
	return script.slice(start, end + 2);
}

export { extractBashRootWords, extractZshRootFunction };
