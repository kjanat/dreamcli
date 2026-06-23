/**
 * Internal string utilities shared across runtime and core modules.
 *
 * @module dreamcli/strings
 */

/** Character code for `/` (forward slash). */
const SLASH = 0x2f;
/** Character code for `\` (backslash). */
const BACKSLASH = 0x5c;

/**
 * Remove trailing characters whose code points appear in `codes`.
 *
 * Linear-time replacement for trailing-character regexes such as
 * `/[\\/]+$/`. Those patterns are polynomial-ReDoS prone: the engine
 * greedily consumes the run, fails the end anchor, backtracks one
 * character at a time, and repeats that work from every start position —
 * O(n²) on adversarial input. This scan is O(n) with no backtracking.
 *
 * @param input - Source string.
 * @param codes - Character codes to strip from the end of `input`.
 * @returns `input` with all trailing matching characters removed.
 * @internal
 */
function stripTrailing(input: string, codes: readonly number[]): string {
	let end = input.length;
	while (end > 0 && codes.includes(input.charCodeAt(end - 1))) {
		end -= 1;
	}
	return end === input.length ? input : input.slice(0, end);
}

export { BACKSLASH, SLASH, stripTrailing };
