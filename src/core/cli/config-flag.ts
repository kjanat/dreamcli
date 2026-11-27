/** Shared argv handling for config discovery and completion. @module dreamcli/core/cli/config-flag */
import type { CLIError } from '#internals/core/errors/index.ts';
import { ParseError } from '#internals/core/errors/index.ts';
import {
	hasArgvBoundary,
	isHyphenOperand,
	markArgvBoundaries,
	pushArgvToken,
} from '#internals/core/parse/argv-boundaries.ts';

/** Extract runtime config flags and report conflicts before dispatch or completion. @internal */
function extractConfigFlag(
	argv: readonly string[],
	noConfigFlag = false,
): {
	readonly configPath: string | undefined;
	readonly filteredArgv: readonly string[];
	readonly skipDiscovery?: true;
	readonly error?: CLIError;
} {
	const filteredArgv: string[] = [];
	const boundaries = new Set<number>();
	let configPath: string | undefined;
	let skipDiscovery = false;

	for (let i = 0; i < argv.length; i += 1) {
		if (hasArgvBoundary(argv, i)) boundaries.add(filteredArgv.length);
		const arg = argv[i];
		if (arg === undefined) {
			continue;
		}

		if (isHyphenOperand(argv, i)) {
			pushArgvToken(filteredArgv, argv, i, arg);
			continue;
		}
		if (arg === '--') {
			filteredArgv.push(...argv.slice(i));
			break;
		}
		if (noConfigFlag && arg === '--no-config') {
			boundaries.add(filteredArgv.length);
			skipDiscovery = true;
			continue;
		}

		if (configPath === undefined && arg.startsWith('--config=')) {
			const value = arg.slice('--config='.length);
			if (value.length > 0) {
				configPath = value;
				boundaries.add(filteredArgv.length);
				continue;
			}

			pushArgvToken(filteredArgv, argv, i, arg);
			continue;
		}

		if (configPath === undefined && arg === '--config') {
			const nextArg = argv[i + 1];
			if (nextArg !== undefined && !nextArg.startsWith('-') && nextArg !== '--') {
				configPath = nextArg;
				boundaries.add(filteredArgv.length);
				i += 1;
				continue;
			}

			pushArgvToken(filteredArgv, argv, i, arg);
			continue;
		}

		pushArgvToken(filteredArgv, argv, i, arg);
	}

	if (hasArgvBoundary(argv, argv.length)) boundaries.add(filteredArgv.length);
	markArgvBoundaries(filteredArgv, boundaries);
	return {
		configPath,
		filteredArgv,
		...(skipDiscovery ? { skipDiscovery: true } : {}),
		...(skipDiscovery && configPath !== undefined
			? { error: new ParseError('Cannot use --config with --no-config', { code: 'INVALID_VALUE' }) }
			: {}),
	};
}

export { extractConfigFlag };
