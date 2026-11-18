/** Explicit color and hyperlink modes used by native help. @internal @module */

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
	let color: HelpOutputMode | undefined;
	let hyperlinks: HelpOutputMode | undefined;
	let changed = false;
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === undefined) continue;
		if (token === '--') {
			normalized.push(...argv.slice(i));
			fallbackArgv.push(...argv.slice(i));
			break;
		}
		const equals = token.indexOf('=');
		const name = token.startsWith('--') ? token.slice(2, equals < 0 ? undefined : equals) : '';
		const value = equals < 0 ? argv[i + 1] : token.slice(equals + 1);
		if (
			name.length === 0 ||
			(name !== flags.color && name !== flags.hyperlinks) ||
			(value !== 'always' && value !== 'never' && value !== 'auto')
		) {
			normalized.push(token);
			fallbackArgv.push(token);
			continue;
		}
		if (name === flags.color) color = value;
		if (name === flags.hyperlinks) hyperlinks = value;
		normalized.push(`--${name}=${value}`);
		if (equals < 0) {
			i += 1;
			changed = true;
		}
	}
	return { argv: changed ? normalized : argv, fallbackArgv, color, hyperlinks };
}

export type { HelpOutputFlags };
export { readHelpOutputFlags };
