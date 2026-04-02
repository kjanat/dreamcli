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

interface OutputWriters {
	readonly stdout: WriteFn;
	readonly stderr: WriteFn;
}

interface SpinnerRenderResult {
	readonly handle: SpinnerHandle;
	readonly cleanup: (() => void) | undefined;
}

interface ProgressRenderResult {
	readonly handle: ProgressHandle;
	readonly cleanup: (() => void) | undefined;
}

function resolveWriterForStream(writers: OutputWriters, stream: OutputStream): WriteFn {
	return stream === 'stderr' ? writers.stderr : writers.stdout;
}

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
