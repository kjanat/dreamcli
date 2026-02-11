/**
 * Minimal type declarations for web platform APIs used by the Deno adapter.
 *
 * The project's tsconfig uses `lib: ["ES2022"]` which excludes DOM/web APIs.
 * This file provides just enough type information for the Deno adapter to
 * use `TextEncoder`, `TextDecoder`, and `ReadableStream` without depending
 * on the full DOM lib or `@types/deno`.
 *
 * @internal
 */

declare class TextEncoder {
	encode(input?: string): Uint8Array;
}

declare class TextDecoder {
	decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}

interface ReadableStreamReadValueResult<T> {
	readonly done: false;
	readonly value: T;
}

interface ReadableStreamReadDoneResult<T> {
	readonly done: true;
	readonly value?: T;
}

type ReadableStreamReadResult<T> =
	| ReadableStreamReadValueResult<T>
	| ReadableStreamReadDoneResult<T>;

interface ReadableStreamDefaultReader<R> {
	read(): Promise<ReadableStreamReadResult<R>>;
	releaseLock(): void;
}

declare class ReadableStream<R = Uint8Array> {
	getReader(): ReadableStreamDefaultReader<R>;
}
