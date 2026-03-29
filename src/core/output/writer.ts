/**
 * Minimal I/O seam — the only write primitive the output module depends on.
 *
 * Extracted to its own file so that both `index.ts` (OutputChannel) and
 * `activity.ts` (handle classes) can import it without a circular dependency.
 *
 * @module dreamcli/core/output/writer
 * @internal
 */

// ---------------------------------------------------------------------------
// Writer abstraction
// ---------------------------------------------------------------------------

/**
 * A function that writes a string somewhere.
 *
 * This is the only I/O primitive the output channel depends on.
 * In production it wraps `process.stdout.write` / `process.stderr.write`;
 * in tests it can be a simple string accumulator.
 */
type WriteFn = (data: string) => void;

/** Write a message followed by a newline. */
function writeLine(write: WriteFn, message: string): void {
	write(`${message}\n`);
}

export type { WriteFn };
export { writeLine };
