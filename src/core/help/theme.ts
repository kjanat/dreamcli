/**
 * Semantic color theme for help output.
 *
 * A {@linkcode HelpTheme} maps semantic roles (section titles, flag forms,
 * placeholders, …) to ansispeck formatters. The default theme follows
 * clap/cargo conventions: bold+underlined section headings, cyan literals,
 * dimmed metadata. Users customize via a {@linkcode HelpThemeFactory} that
 * receives the *gated* palette — when color is disabled the factory is never
 * invoked, so themed help can never leak escapes into piped, `--json`, or
 * `NO_COLOR` output.
 *
 * @module dreamcli/core/help/theme
 */

import type { Colors, Formatter } from 'ansispeck';
import { createColors } from 'ansispeck';

/**
 * Semantic styling roles for help output.
 *
 * Roles that appear inside wrap-eligible description text (`defaultValue`,
 * `annotation`, `deprecated`) should stick to foreground colors and `dim` —
 * a styled span may cross a soft-wrap boundary, and while color/dim carry
 * invisibly across the continuation indent, `underline`/`inverse`/background
 * styles would visibly paint it.
 */
interface HelpTheme {
	/** Section headings: `Usage:`, `Arguments:`, `Flags:`, `Commands:`, `Examples:`, `Global options:`. */
	readonly sectionTitle: Formatter;
	/** Binary / command path in the usage line. */
	readonly usageBin: Formatter;
	/** Flag forms in the flags table: `-f, --force`. */
	readonly flag: Formatter;
	/** Grammar tokens: `<string>`, `<command>`, `[flags]`, value hints. */
	readonly placeholder: Formatter;
	/** Command names in `Commands:` tables. */
	readonly command: Formatter;
	/** Positional arg tokens: `<file>`, `[out]...`. */
	readonly arg: Formatter;
	/** Default-value annotations: `(default: 8080)`. */
	readonly defaultValue: Formatter;
	/** Metadata annotations: `[env: X]`, `[config: a.b]`, `[prompt]`, `[required]`, ` (default)`. */
	readonly annotation: Formatter;
	/** Deprecation labels: `[deprecated]`, `[deprecated: use --x]`. */
	readonly deprecated: Formatter;
	/** Program name in the root-help header. */
	readonly headerName: Formatter;
	/** Version (`vX.Y.Z`) in the root-help header. */
	readonly headerVersion: Formatter;
	/** The `$` prompt marker in `Examples:`. */
	readonly examplePrompt: Formatter;
}

/**
 * Help description text, either literal or resolved against the effective
 * description theme at render time.
 */
type HelpDescription = string | ((theme: HelpTheme) => string);

/**
 * User theme customization: receives the gated palette and returns role
 * overrides merged over the default theme.
 *
 * The palette formatters are identity functions when color is disabled, and
 * the factory itself is only invoked when color is enabled — style
 * unconditionally, gating is the framework's job.
 */
type HelpThemeFactory = (colors: Colors) => Partial<HelpTheme>;

/**
 * The built-in help theme (clap/cargo conventions).
 *
 * @param c - Palette to build formatters from (typically the gated `out.color`).
 * @internal
 */
function defaultHelpTheme(c: Colors): HelpTheme {
	return {
		sectionTitle: (input) => c.bold(c.underline(input)),
		usageBin: c.bold,
		flag: c.cyan,
		placeholder: c.dim,
		command: c.cyan,
		arg: c.cyan,
		defaultValue: c.dim,
		annotation: c.dim,
		deprecated: c.yellow,
		headerName: c.bold,
		headerVersion: c.dim,
		examplePrompt: c.dim,
	};
}

/**
 * Resolve the effective help theme from a palette and optional user factory.
 *
 * When the palette renders no styling (color disabled — its formatters are
 * identity functions), the user factory is **never invoked**: even a factory
 * that emits raw escapes cannot leak them into color-off output. When color
 * is enabled, factory overrides merge over {@linkcode defaultHelpTheme}.
 *
 * @param colors - Gated palette, or `undefined` for a color-off theme.
 * @param theme - Optional user overrides factory.
 * @internal
 */
function resolveHelpTheme(
	colors: Colors | undefined,
	theme: HelpThemeFactory | undefined,
): HelpTheme {
	const palette = colors ?? createColors(false);
	const enabled = palette.bold('x') !== 'x';
	if (!enabled || theme === undefined) {
		return defaultHelpTheme(palette);
	}
	return { ...defaultHelpTheme(palette), ...theme(palette) };
}

/**
 * Merge a scoped theme factory over an already-resolved help theme.
 *
 * The scoped factory follows the same color gate as the global factory and is
 * never invoked when the palette is disabled.
 *
 * @internal
 */
function extendHelpTheme(
	theme: HelpTheme,
	colors: Colors | undefined,
	override: HelpThemeFactory | undefined,
): HelpTheme {
	const palette = colors ?? createColors(false);
	const enabled = palette.bold('x') !== 'x';
	return enabled && override !== undefined ? { ...theme, ...override(palette) } : theme;
}

/** Resolve literal or function-form help description text. @internal */
function resolveHelpDescription(description: HelpDescription, theme: HelpTheme): string {
	return typeof description === 'function' ? description(theme) : description;
}

/** Resolve a help description with identity formatters for non-TTY output. @internal */
function resolvePlainHelpDescription(description: HelpDescription): string {
	return resolveHelpDescription(description, defaultHelpTheme(createColors(false)));
}

// --- Exports

export type { HelpDescription, HelpTheme, HelpThemeFactory };
export {
	defaultHelpTheme,
	extendHelpTheme,
	resolveHelpDescription,
	resolveHelpTheme,
	resolvePlainHelpDescription,
};
