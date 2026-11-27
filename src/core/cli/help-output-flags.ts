/** Explicit color and hyperlink modes used by native help. @internal @module */

import {
	adjacentArgvValue,
	hasArgvBoundary,
	isHyphenOperand,
	markArgvBoundaries,
	pushArgvToken,
} from '#internals/core/parse/argv-boundaries.ts';

interface HelpOutputFlags {
	/** Long flag name, without the leading dashes, that sets help color. */
	readonly color?: string;
	/** Long flag name, without the leading dashes, that sets help hyperlinks. */
	readonly hyperlinks?: string;
}

type HelpOutputMode = 'always' | 'never' | 'auto';

interface HelpOutputSelection {
	readonly argv: readonly string[];
	readonly fallbackArgv: readonly string[];
	readonly color: HelpOutputMode | undefined;
	readonly hyperlinks: HelpOutputMode | undefined;
}

/** Read explicitly bound long flags before `--`, keeping value tokens together for help routing. */
function readHelpOutputFlags(argv: readonly string[], flags: HelpOutputFlags): HelpOutputSelection {
	const normalized: string[] = [];
	const fallbackArgv: string[] = [];
	const normalizedBoundaries = new Set<number>();
	const fallbackBoundaries = new Set<number>();
	let color: HelpOutputMode | undefined;
	let hyperlinks: HelpOutputMode | undefined;
	let changed = false;
	for (let i = 0; i < argv.length; i += 1) {
		if (hasArgvBoundary(argv, i)) {
			normalizedBoundaries.add(normalized.length);
			fallbackBoundaries.add(fallbackArgv.length);
		}
		const token = argv[i];
		if (token === undefined) continue;
		if (token === '--') {
			normalized.push(...argv.slice(i));
			fallbackArgv.push(...argv.slice(i));
			break;
		}
		const equals = token.indexOf('=');
		const name = token.startsWith('--') ? token.slice(2, equals < 0 ? undefined : equals) : '';
		const value = equals < 0 ? adjacentArgvValue(argv, i) : token.slice(equals + 1);
		if (
			isHyphenOperand(argv, i) ||
			name.length === 0 ||
			(name !== flags.color && name !== flags.hyperlinks) ||
			(value !== 'always' && value !== 'never' && value !== 'auto')
		) {
			pushArgvToken(normalized, argv, i, token);
			pushArgvToken(fallbackArgv, argv, i, token);
			continue;
		}
		if (name === flags.color) color = value;
		if (name === flags.hyperlinks) hyperlinks = value;
		normalized.push(`--${name}=${value}`);
		fallbackBoundaries.add(fallbackArgv.length);
		if (equals < 0) {
			i += 1;
			changed = true;
		}
	}
	if (hasArgvBoundary(argv, argv.length)) {
		normalizedBoundaries.add(normalized.length);
		fallbackBoundaries.add(fallbackArgv.length);
	}
	markArgvBoundaries(normalized, normalizedBoundaries);
	markArgvBoundaries(fallbackArgv, fallbackBoundaries);
	return { argv: changed ? normalized : argv, fallbackArgv, color, hyperlinks };
}

export type { HelpOutputFlags };
export { readHelpOutputFlags };
