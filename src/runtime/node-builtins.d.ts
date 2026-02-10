/**
 * Minimal type declarations for Node.js built-in modules.
 *
 * This file provides just enough type information for the runtime
 * adapter to dynamically import `readline` without depending on
 * `@types/node`. Only the subset actually used is declared.
 *
 * @internal
 */

declare module 'node:readline' {
	interface ReadlineInterface {
		once(event: 'line', listener: (line: string) => void): void;
		once(event: 'close', listener: () => void): void;
		close(): void;
	}

	function createInterface(options: { input: unknown; terminal: boolean }): ReadlineInterface;
}

declare module 'node:fs/promises' {
	function readFile(path: string, encoding: 'utf8'): Promise<string>;
}
