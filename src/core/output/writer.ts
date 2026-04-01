/**
 * Minimal I/O seam — the only write primitive the output module depends on.
 *
 * Extracted to its own file so that both `index.ts` (OutputChannel) and
 * `activity.ts` (handle classes) can import it without a circular dependency.
 *
 * @module dreamcli/core/output/writer
 * @internal
 */

// --- Writer abstraction

/**
 * A function that writes a string somewhere.
 *
 * This is the only write primitive the output layer depends on.
 * In production it usually wraps `process.stdout.write` or
 * `process.stderr.write`; in tests it is often a simple string accumulator.
 *
 * The contract is intentionally tiny:
 * - writes are synchronous fire-and-forget
 * - callers decide whether to append a trailing newline
 * - there is no backpressure or flush signal
 *
 * @example
 * ```ts
 * const lines: string[] = [];
 * const write: WriteFn = (data) => {
 *   lines.push(data);
 * };
 * ```
 */
type WriteFn = (data: string) => void;

/**
 * Write a message followed by a newline.
 *
 * @param write   - The underlying write function.
 * @param message - The text to write.
 */
function writeLine(write: WriteFn, message: string): void {
	write(`${message}\n`);
}

export type { WriteFn };
export { writeLine };
