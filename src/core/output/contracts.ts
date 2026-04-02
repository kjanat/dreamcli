/**
 * Internal output policy contract for mode selection and cleanup semantics.
 *
 * Captures the stable seam between semantic output decisions and the concrete
 * rendering layer before the output module is split more aggressively.
 *
 * @module dreamcli/core/output/contracts
 * @internal
 */

import type { Fallback, TableOptions } from '#internals/core/schema/activity.ts';

/** Ordered output verbosity levels owned by the output policy layer. */
const OUTPUT_VERBOSITY_LEVELS = ['normal', 'quiet'] as const;

/** Stable output text streams. */
const OUTPUT_STREAMS = ['stdout', 'stderr'] as const;

/** Stable activity rendering modes. */
const ACTIVITY_RENDER_MODES = ['noop', 'static', 'tty', 'capture'] as const;

/** Stable activity cleanup actions. */
const ACTIVITY_CLEANUP_KINDS = ['none', 'stop', 'done'] as const;

/** Stable text verbosity labels. */
type Verbosity = (typeof OUTPUT_VERBOSITY_LEVELS)[number];

/** Stable output stream labels. */
type OutputStream = (typeof OUTPUT_STREAMS)[number];

/** Stable activity-render labels. */
type ActivityRenderMode = (typeof ACTIVITY_RENDER_MODES)[number];

/** Stable cleanup labels for tracked activity handles. */
type ActivityCleanupKind = (typeof ACTIVITY_CLEANUP_KINDS)[number];

/** Semantic output facts chosen before concrete rendering begins. */
interface OutputPolicy {
	readonly jsonMode: boolean;
	readonly isTTY: boolean;
	readonly verbosity: Verbosity;
}

interface ResolveOutputPolicyOptions {
	readonly jsonMode: boolean;
	readonly isTTY: boolean;
	readonly verbosity: Verbosity;
}

/** Concrete activity policy chosen for spinner/progress creation. */
interface ActivityPolicy {
	readonly mode: Exclude<ActivityRenderMode, 'capture'>;
	readonly stream: 'stderr';
	readonly cleanup: ActivityCleanupKind;
}

/** Stable output-policy facts the re-foundation workstream is freezing. */
interface OutputContract {
	readonly jsonReservesStdoutForStructuredData: true;
	readonly quietSuppressesInfo: true;
	readonly activityUsesStderrOutsideCapture: true;
	readonly ttyActivityRequiresTTYAndNonJson: true;
	readonly spinnerCleanupUsesStop: true;
	readonly progressCleanupUsesDone: true;
}

const outputContract = {
	jsonReservesStdoutForStructuredData: true,
	quietSuppressesInfo: true,
	activityUsesStderrOutsideCapture: true,
	ttyActivityRequiresTTYAndNonJson: true,
	spinnerCleanupUsesStop: true,
	progressCleanupUsesDone: true,
} satisfies OutputContract;

/** Build the stable output-policy snapshot for one channel instance. */
function resolveOutputPolicy(options: ResolveOutputPolicyOptions): OutputPolicy {
	return {
		jsonMode: options.jsonMode,
		isTTY: options.isTTY,
		verbosity: options.verbosity,
	};
}

/** Resolve the default text stream for non-JSON structured output. */
function resolveTextStream(policy: OutputPolicy): OutputStream {
	return policy.jsonMode ? 'stderr' : 'stdout';
}

/** Whether `info()` messages should be emitted under the current policy. */
function shouldEmitInfo(policy: OutputPolicy): boolean {
	return policy.verbosity !== 'quiet';
}

/** Resolve the concrete table format under the current policy. */
function resolveTableFormat(policy: OutputPolicy, options?: TableOptions): 'text' | 'json' {
	switch (options?.format) {
		case 'json':
			return 'json';
		case 'text':
			return 'text';
		case 'auto':
		case undefined:
			return policy.jsonMode ? 'json' : 'text';
	}
}

/** Resolve the text-table stream after table-format selection. */
function resolveTableTextStream(policy: OutputPolicy, options?: TableOptions): OutputStream {
	if (options?.format === 'text' && 'stream' in options && options.stream !== undefined) {
		return options.stream;
	}

	return resolveTextStream(policy);
}

/** Resolve the non-capture activity mode shared by spinner and progress. */
function resolveActivityRenderMode(
	policy: OutputPolicy,
	fallback: Fallback,
): ActivityPolicy['mode'] {
	if (policy.jsonMode) {
		return 'noop';
	}

	if (policy.isTTY) {
		return 'tty';
	}

	return fallback === 'static' ? 'static' : 'noop';
}

/** Resolve spinner activity policy including cleanup ownership. */
function resolveSpinnerPolicy(policy: OutputPolicy, fallback: Fallback): ActivityPolicy {
	const mode = resolveActivityRenderMode(policy, fallback);
	return {
		mode,
		stream: 'stderr',
		cleanup: mode === 'noop' ? 'none' : 'stop',
	};
}

/** Resolve progress activity policy including cleanup ownership. */
function resolveProgressPolicy(policy: OutputPolicy, fallback: Fallback): ActivityPolicy {
	const mode = resolveActivityRenderMode(policy, fallback);
	return {
		mode,
		stream: 'stderr',
		cleanup: mode === 'noop' ? 'none' : 'done',
	};
}

export type {
	ActivityCleanupKind,
	ActivityPolicy,
	ActivityRenderMode,
	OutputContract,
	OutputPolicy,
	OutputStream,
	ResolveOutputPolicyOptions,
	Verbosity,
};
export {
	ACTIVITY_CLEANUP_KINDS,
	ACTIVITY_RENDER_MODES,
	OUTPUT_STREAMS,
	OUTPUT_VERBOSITY_LEVELS,
	outputContract,
	resolveActivityRenderMode,
	resolveOutputPolicy,
	resolveProgressPolicy,
	resolveSpinnerPolicy,
	resolveTableFormat,
	resolveTableTextStream,
	resolveTextStream,
	shouldEmitInfo,
};
