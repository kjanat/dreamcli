/**
 * Internal output renderer factories.
 *
 * Keeps concrete writer and activity-handle construction separate from the
 * semantic output-policy layer.
 *
 * @module dreamcli/core/output/renderers
 * @internal
 */

import type {
	ProgressHandle,
	ProgressOptions,
	SpinnerHandle,
} from '#internals/core/schema/activity.ts';
import {
	noopProgressHandle,
	noopSpinnerHandle,
	StaticProgressHandle,
	StaticSpinnerHandle,
	TTYProgressHandle,
	TTYSpinnerHandle,
} from './activity.ts';
import type { ActivityPolicy, OutputStream } from './contracts.ts';
import type { WriteFn } from './writer.ts';

/**
 * Paired write functions for the two standard output streams.
 *
 * @internal
 */
interface OutputWriters {
	/** Write function targeting standard output. */
	readonly stdout: WriteFn;
	/** Write function targeting standard error. */
	readonly stderr: WriteFn;
}

/**
 * Spinner handle paired with its optional teardown function.
 *
 * @internal
 */
interface SpinnerRenderResult {
	/** The spinner handle exposed to command handlers. */
	readonly handle: SpinnerHandle;
	/** Defined only when the mode requires cleanup (TTY or static); `undefined` for noop. */
	readonly cleanup: (() => void) | undefined;
}

/**
 * Progress handle paired with its optional teardown function.
 *
 * @internal
 */
interface ProgressRenderResult {
	/** The progress handle exposed to command handlers. */
	readonly handle: ProgressHandle;
	/** Defined only when the mode requires cleanup (TTY or static); `undefined` for noop. */
	readonly cleanup: (() => void) | undefined;
}

/** Select the concrete {@linkcode WriteFn} for a given stream label. @internal */
function resolveWriterForStream(writers: OutputWriters, stream: OutputStream): WriteFn {
	return stream === 'stderr' ? writers.stderr : writers.stdout;
}

/** Create a spinner handle matching the resolved {@linkcode ActivityPolicy} mode. @internal */
function createSpinnerHandleFromPolicy(
	policy: ActivityPolicy,
	text: string,
	stderr: WriteFn,
): SpinnerRenderResult {
	if (policy.mode === 'noop') {
		return {
			handle: noopSpinnerHandle,
			cleanup: undefined,
		};
	}

	if (policy.mode === 'tty') {
		const handle = new TTYSpinnerHandle(text, stderr);
		return {
			handle,
			cleanup: () => handle.stop(),
		};
	}

	const handle = new StaticSpinnerHandle(text, stderr);
	return {
		handle,
		cleanup: () => handle.stop(),
	};
}

/** Create a progress handle matching the resolved {@linkcode ActivityPolicy} mode. @internal */
function createProgressHandleFromPolicy(
	policy: ActivityPolicy,
	options: ProgressOptions,
	stderr: WriteFn,
): ProgressRenderResult {
	if (policy.mode === 'noop') {
		return {
			handle: noopProgressHandle,
			cleanup: undefined,
		};
	}

	if (policy.mode === 'tty') {
		const handle = new TTYProgressHandle(options, stderr);
		return {
			handle,
			cleanup: () => handle.done(),
		};
	}

	const handle = new StaticProgressHandle(options.label, stderr);
	return {
		handle,
		cleanup: () => handle.done(),
	};
}

export type { OutputWriters, ProgressRenderResult, SpinnerRenderResult };
export { createProgressHandleFromPolicy, createSpinnerHandleFromPolicy, resolveWriterForStream };
