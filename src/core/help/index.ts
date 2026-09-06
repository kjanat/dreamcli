/**
 * Auto-generated help text from command schemas.
 *
 * Renders usage line, description, positional args, flags table, and
 * examples from a {@linkcode CommandSchema}. Designed for TTY output with
 * configurable width.
 *
 * @module dreamcli/core/help
 */

import type { Colors } from 'ansispeck';
import { formatDisplayValue } from '#internals/core/output/display-value.ts';
import { resolveExampleCommand } from '#internals/core/schema/command.ts';
import { getFlagAliasNames } from '#internals/core/schema/flag.ts';
import type {
	ArgSchema,
	CommandArgEntry,
	CommandExample,
	CommandSchema,
	ExampleMeta,
	FlagSchema,
	StdinBinding,
} from '#internals/core/schema/index.ts';
import { padEnd, visibleWidth, wrapText } from './ansi.ts';
import type { HelpTheme, HelpThemeFactory } from './theme.ts';
import { extendHelpTheme, resolveHelpDescription, resolveHelpTheme } from './theme.ts';

// --- Configuration

/** Options for customising help output. */
interface HelpOptions {
	/** Maximum line width (columns). Defaults to 80. */
	readonly width?: number;
	/** Binary/program name shown in the usage line. Defaults to command name. */
	readonly binName?: string;
	/** Program version passed to function-form examples as `meta.version`. */
	readonly version?: string;
	/**
	 * Order of flags in the `Flags:` table.
	 *
	 * - `'alphabetical'` — short-aliased flags first, then alphabetical by name.
	 * - `'declaration'` — the order `.flag()` was called.
	 *
	 * Ignored when {@link HelpOptions.sortFlags} is set.
	 *
	 * @defaultValue `'alphabetical'`
	 */
	readonly flagOrder?: 'alphabetical' | 'declaration';
	/**
	 * Custom comparator over flag long names for the `Flags:` table. When set,
	 * it wins over {@link HelpOptions.flagOrder}.
	 *
	 * @defaultValue `undefined` (use `flagOrder`)
	 */
	readonly sortFlags?: (a: string, b: string) => number;
	/**
	 * Emit OSC 8 hyperlinks where link metadata is available (currently the
	 * root-help header name/version configured via `CLIBuilder.links()`).
	 * Defaults to `false`; `CLIBuilder.execute()`/`.run()` enable it
	 * automatically when stdout is a TTY.
	 */
	readonly hyperlinks?: boolean;
	/**
	 * Render the default command's arguments and flags inline in root help.
	 *
	 * Only affects root-level help. When `false`, root help lists commands and
	 * defers default-command details to `<bin> --help`-style hints.
	 *
	 * @defaultValue `true`
	 */
	readonly inlineDefault?: boolean;
	/**
	 * List the default command in the root `Commands:` table.
	 *
	 * By default the default command is treated as the root surface and omitted
	 * from the command list (its args/flags render inline instead).
	 *
	 * @defaultValue `false`
	 */
	readonly showDefaultInCommands?: boolean;
	/**
	 * Show the `Run '<bin> <command> --help' for more information.` footer.
	 *
	 * Defaults to showing the hint only when visible subcommands exist; set
	 * explicitly to force it on or off.
	 */
	readonly footer?: boolean;
	/** @internal Whether this usage line is being rendered as merged root/default help. */
	readonly isDefaultHelp?: boolean;
	/**
	 * Gated ANSI palette used to style help output. Identity formatters mean
	 * plain text. `CLIBuilder.execute()`/`.run()` thread the output channel's
	 * `out.color` here automatically, so styling follows the same policy as
	 * handler output (TTY + color support, no `--json`, `NO_COLOR` honored).
	 *
	 * @defaultValue `undefined` (plain text)
	 */
	readonly colors?: Colors;
	/**
	 * Theme overrides merged over the built-in help theme. Receives the gated
	 * palette; never invoked when color is off, so overrides cannot leak
	 * escapes into piped output.
	 *
	 * @defaultValue `undefined` (built-in theme)
	 */
	readonly theme?: HelpThemeFactory;
	/**
	 * Theme overrides used only by function-form flag and argument descriptions.
	 * Merged over the resolved global theme, one role at a time.
	 *
	 * @defaultValue `undefined` (use the global theme)
	 */
	readonly descriptionTheme?: HelpThemeFactory;
}

/** Resolved help options with defaults applied. */
interface ResolvedHelpOptions {
	readonly width: number;
	readonly binName: string | undefined;
	readonly version: string | undefined;
	readonly flagOrder: 'alphabetical' | 'declaration';
	readonly sortFlags: ((a: string, b: string) => number) | undefined;
	readonly isDefaultHelp: boolean;
	readonly theme: HelpTheme;
	readonly descriptionTheme: HelpTheme;
}

const DEFAULT_WIDTH = 80;

/**
 * Apply defaults to optional {@link HelpOptions}.
 *
 * @param options - User-supplied help options, or `undefined` for all defaults.
 * @returns Fully resolved options with defaults applied.
 */
function resolveOptions(options?: HelpOptions): ResolvedHelpOptions {
	const theme = resolveHelpTheme(options?.colors, options?.theme);
	return {
		width: options?.width ?? DEFAULT_WIDTH,
		binName: options?.binName,
		version: options?.version,
		flagOrder: options?.flagOrder ?? 'alphabetical',
		sortFlags: options?.sortFlags,
		isDefaultHelp: options?.isDefaultHelp ?? false,
		theme,
		descriptionTheme: extendHelpTheme(theme, options?.colors, options?.descriptionTheme),
	};
}

// --- Deprecation formatting

/**
 * Format a deprecation annotation for help text.
 *
 * @param deprecated - `true` for a generic marker, or a string explaining the deprecation.
 * @returns Bracketed deprecation label, e.g. `[deprecated]` or `[deprecated: use --foo]`.
 */
function formatDeprecated(deprecated: string | true): string {
	return typeof deprecated === 'string' ? `[deprecated: ${deprecated}]` : '[deprecated]';
}

/** Format a default value for help output, preserving nullish sentinels. */
function formatHelpDefaultValue(value: unknown): string {
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	return formatDisplayValue(value);
}

/** Format one input's default annotation under its presentation and sensitivity policy. */
function formatDefaultAnnotation(
	schema: {
		readonly presence: 'optional' | 'required' | 'defaulted';
		readonly defaultValue: unknown;
		readonly defaultDescription: string | false | undefined;
		readonly sensitive: boolean;
	},
	theme: HelpTheme,
	suppressAutomatic: boolean,
): string | undefined {
	if (schema.defaultDescription === false) return undefined;
	if (typeof schema.defaultDescription === 'string') {
		return theme.defaultValue(`(default: ${schema.defaultDescription})`);
	}
	if (schema.sensitive || suppressAutomatic) return undefined;
	if (schema.presence !== 'defaulted' && schema.defaultValue === undefined) return undefined;
	return theme.defaultValue(`(default: ${formatHelpDefaultValue(schema.defaultValue)})`);
}

// --- Flag formatting

/** Formatted flag entry for the flags table. @internal */
interface FlagEntry {
	/** Preformatted flag names and value hint for the left table column. */
	readonly left: string;
	/** Preformatted help text for the description table column. */
	readonly description: string;
}

/**
 * Format a flag's left column: `-a, --name <type>`.
 *
 * @param name - Long flag name (without `--` prefix).
 * @param schema - The {@link FlagSchema} describing the flag.
 * @param theme - Theme applied to the flag forms and value hint.
 * @returns Formatted left-column string for the flags table.
 */
function formatFlagLeft(name: string, schema: FlagSchema, theme: HelpTheme): string {
	const visibleShortAliases = getFlagAliasNames(schema, { kind: 'short' });
	const visibleLongAliases = getFlagAliasNames(schema, { kind: 'long' });
	// Negatable booleans render as one logical flag: `--[no-]foo` when the
	// negated spelling is the synthesized default, or an extra `--no-custom`
	// form when a custom alias was set. Hidden negations render nothing.
	const negation =
		schema.negation !== undefined && !schema.negation.hidden ? schema.negation : undefined;
	const canonicalForm =
		negation !== undefined && negation.alias === undefined ? `--[no-]${name}` : `--${name}`;
	const forms = [
		...visibleShortAliases.map((alias) => `-${alias}`),
		canonicalForm,
		...visibleLongAliases.map((alias) => `--${alias}`),
		...(negation?.alias !== undefined ? [`--${negation.alias}`] : []),
	];

	// Value placeholder (skip for kinds that take no value)
	if (schema.kind !== 'boolean' && schema.kind !== 'count') {
		return `${theme.flag(forms.join(', '))} ${theme.placeholder(formatValueHint(schema))}`;
	}

	return theme.flag(forms.join(', '));
}

/**
 * Produce a type hint like `<string>`, `<number>`, `<us|eu|ap>`.
 *
 * A schema-level `valueHint` (set by sugar factories like `flag.url()`)
 * overrides the kind-derived hint.
 *
 * @param schema - The {@link FlagSchema} whose value type determines the hint.
 * @returns Angle-bracketed hint string, or empty string for no-value kinds.
 */
function formatValueHint(schema: FlagSchema): string {
	if (schema.valueHint !== undefined) {
		return `<${schema.valueHint}>`;
	}
	switch (schema.kind) {
		case 'string':
			return '<string>';
		case 'number':
			return '<number>';
		case 'enum': {
			const vals = schema.enumValues ?? [];
			return `<${vals.join('|')}>`;
		}
		case 'array': {
			const elemHint =
				schema.elementSchema !== undefined
					? formatValueHint(schema.elementSchema).slice(1, -1) // strip < >
					: 'value';
			return `<${elemHint}>...`;
		}
		case 'boolean':
		case 'count':
			return '';
		case 'custom':
			return '<value>';
		case 'keyValue':
			return '<key=value>';
	}
}

/**
 * Name what selects the stdin stream for an input, in the `[env: X]` style.
 *
 * `[stdin]` covers the default trigger, where both an explicit `-` and an
 * absent input read the stream. The narrower triggers say which one applies, so
 * a reader knows whether typing `-` is required.
 *
 * @param stdin - The input's stdin axis.
 * @returns The annotation to render beside the description.
 */
function formatStdinAnnotation(stdin: StdinBinding): string {
	switch (stdin.when) {
		case 'dash':
			return "[stdin: '-']";
		case 'missing':
			return '[stdin: when omitted]';
		case 'dash-or-missing':
			return '[stdin]';
	}
}

/**
 * Build description with stdin/env/config/prompt/default/required/deprecated
 * annotations.
 *
 * @param schema - The {@link FlagSchema} to describe.
 * @param theme - Theme applied to the metadata annotations.
 * @param descriptionTheme - Theme passed to a function-form description.
 * @returns Concatenated description string with metadata annotations.
 */
function formatFlagDescription(
	schema: FlagSchema,
	theme: HelpTheme,
	descriptionTheme: HelpTheme,
): string {
	const parts: string[] = [];

	if (schema.description !== undefined) {
		parts.push(resolveHelpDescription(schema.description, descriptionTheme));
	}

	// Deprecation annotation — prominent, before other metadata
	if (schema.deprecated !== undefined) {
		parts.push(theme.deprecated(formatDeprecated(schema.deprecated)));
	}

	// Resolution source annotations — show users where values can come from
	if (schema.stdin !== undefined) {
		parts.push(theme.annotation(formatStdinAnnotation(schema.stdin)));
	}
	if (schema.envVar !== undefined) {
		parts.push(theme.annotation(`[env: ${schema.envVar}]`));
	}
	if (schema.configPath !== undefined) {
		parts.push(theme.annotation(`[config: ${schema.configPath}]`));
	}
	if (schema.prompt !== undefined) {
		parts.push(theme.annotation('[prompt]'));
	}

	// A schema carrying a default resolves one whatever its presence says, so the
	// required stage never reports it missing.
	if (schema.presence === 'required' && schema.defaultValue === undefined) {
		parts.push(theme.annotation('[required]'));
	} else {
		const defaultAnnotation = formatDefaultAnnotation(
			schema,
			theme,
			schema.kind === 'boolean' || schema.kind === 'count',
		);
		if (defaultAnnotation !== undefined) parts.push(defaultAnnotation);
	}

	return parts.join(' ');
}

/**
 * Default flag order: short-aliased flags first, then alphabetical by name.
 */
function defaultFlagOrder(
	a: string,
	b: string,
	flags: Readonly<Record<string, FlagSchema>>,
): number {
	const aSchema = flags[a];
	const bSchema = flags[b];
	if (aSchema === undefined || bSchema === undefined) return 0;
	const aHasShort = getFlagAliasNames(aSchema, { kind: 'short' }).length > 0;
	const bHasShort = getFlagAliasNames(bSchema, { kind: 'short' }).length > 0;
	if (aHasShort && !bHasShort) return -1;
	if (!aHasShort && bHasShort) return 1;
	return a.localeCompare(b);
}

/**
 * Order flag names for the table: an explicit `sortFlags` comparator wins,
 * then `'declaration'` preserves `.flag()` call order, otherwise the default
 * short-first alphabetical order.
 */
function orderFlagNames(
	names: readonly string[],
	flags: Readonly<Record<string, FlagSchema>>,
	opts: ResolvedHelpOptions,
): readonly string[] {
	if (opts.sortFlags !== undefined) return [...names].sort(opts.sortFlags);
	if (opts.flagOrder === 'declaration') return names;
	return [...names].sort((a, b) => defaultFlagOrder(a, b, flags));
}

/**
 * Build the flag entries in the configured order.
 *
 * @param flags - Map of flag names to {@link FlagSchema} definitions.
 * @param opts - Resolved help options (theme + flag ordering).
 * @returns Array of {@link FlagEntry} objects for the flags table.
 */
function buildFlagEntries(
	flags: Readonly<Record<string, FlagSchema>>,
	opts: ResolvedHelpOptions,
): readonly FlagEntry[] {
	const names = Object.keys(flags);
	if (names.length === 0) return [];

	const entries: FlagEntry[] = [];
	for (const name of orderFlagNames(names, flags, opts)) {
		const schema = flags[name];
		if (schema === undefined) continue;
		entries.push({
			left: formatFlagLeft(name, schema, opts.theme),
			description: formatFlagDescription(schema, opts.theme, opts.descriptionTheme),
		});
	}
	return entries;
}

// --- Arg formatting

/**
 * Format a positional arg for the usage line.
 *
 * @param entry - The {@link CommandArgEntry} containing name and schema.
 * @param maxWidth - Width available for inline choices before using the argument name.
 * @returns Bracketed arg token, e.g. `<file>` or `[output]...`.
 */
function formatArgUsage(entry: CommandArgEntry, maxWidth = Infinity): string {
	const { name, schema } = entry;
	let label =
		schema.kind === 'enum' && schema.enumValues !== undefined ? schema.enumValues.join('|') : name;
	const variadicSuffix = schema.variadic ? '...' : '';
	if (visibleWidth(label) + 2 + variadicSuffix.length > maxWidth) label = name;
	// A positional carrying a default resolves one whatever its presence says, so
	// the usage line does not demand a token for it.
	if (schema.presence === 'required' && schema.defaultValue === undefined) {
		return `<${label}>${variadicSuffix}`;
	}
	return `[${label}]${variadicSuffix}`;
}

/**
 * Format arg description with stdin/env/config/prompt/default/deprecated
 * annotations.
 *
 * @param schema - The {@link ArgSchema} to describe.
 * @param theme - Theme applied to the metadata annotations.
 * @param descriptionTheme - Theme passed to a function-form description.
 * @returns Concatenated description string with metadata annotations.
 */
function formatArgDescription(
	schema: ArgSchema,
	theme: HelpTheme,
	descriptionTheme: HelpTheme,
): string {
	const parts: string[] = [];

	if (schema.description !== undefined) {
		parts.push(resolveHelpDescription(schema.description, descriptionTheme));
	}

	if (schema.deprecated !== undefined) {
		parts.push(theme.deprecated(formatDeprecated(schema.deprecated)));
	}

	if (schema.stdin !== undefined) {
		parts.push(theme.annotation(formatStdinAnnotation(schema.stdin)));
	}
	if (schema.envVar !== undefined) {
		parts.push(theme.annotation(`[env: ${schema.envVar}]`));
	}
	if (schema.configPath !== undefined) {
		parts.push(theme.annotation(`[config: ${schema.configPath}]`));
	}
	if (schema.prompt !== undefined) {
		parts.push(theme.annotation('[prompt]'));
	}

	const defaultAnnotation = formatDefaultAnnotation(schema, theme, false);
	if (defaultAnnotation !== undefined) parts.push(defaultAnnotation);

	return parts.join(' ');
}

// --- Main generator

/**
 * Build the ordered help sections without joining them.
 *
 * @internal
 * @param schema - The {@link CommandSchema} to render.
 * @param options - Optional {@link HelpOptions} for width/bin name.
 * @returns Array of section strings (usage, description, commands, args, flags, examples).
 */
function formatHelpSections(schema: CommandSchema, options?: HelpOptions): readonly string[] {
	const opts = resolveOptions(options);
	const sections: string[] = [];

	// ---- Usage line ---------------------------------------------------------
	sections.push(formatUsageLine(schema, opts));

	// ---- Description --------------------------------------------------------
	if (schema.description !== undefined) {
		sections.push(schema.description);
	}

	// ---- Commands (subcommands) ---------------------------------------------
	const visibleCommands = schema.commands.filter((c) => !c.hidden);
	if (visibleCommands.length > 0) {
		sections.push(formatCommandsSection(visibleCommands, opts));
	}

	// ---- Arguments ----------------------------------------------------------
	if (schema.args.length > 0) {
		sections.push(formatArgsSection(schema.args, opts));
	}

	// ---- Flags --------------------------------------------------------------
	const flagNames = Object.keys(schema.flags);
	if (flagNames.length > 0) {
		sections.push(formatFlagsSection(schema.flags, opts));
	}

	// ---- Examples -----------------------------------------------------------
	if (schema.examples.length > 0) {
		const meta: ExampleMeta = { name: opts.binName ?? schema.name, version: opts.version };
		sections.push(formatExamplesSection(schema.examples, opts.theme, meta));
	}

	return sections;
}

/**
 * Generate help text from a command schema.
 *
 * Low-level formatter: most applications reach this through `--help`,
 * `help <command>`, or root help rendering in `CLIBuilder`. Call
 * `formatHelp()` directly when embedding DreamCLI help text into custom UIs,
 * tests, or generated docs.
 *
 * Sections rendered (in order):
 * 1. **Usage** line — `program <command> [flags] <args>`
 * 2. **Description** — the command's `.description()` text
 * 3. **Commands** — subcommands table (if any, skips hidden)
 * 4. **Arguments** — positional args table (if any)
 * 5. **Flags** — flags table with type hints and defaults
 * 6. **Examples** — usage examples (if any)
 *
 * @param schema - The command schema to render help for.
 * @param options - Formatting options (width, binary name).
 * @returns The formatted help string.
 *
 * @example
 * ```ts
 * const text = formatHelp(deploy.schema, { binName: 'mycli' });
 * ```
 */
function formatHelp(schema: CommandSchema, options?: HelpOptions): string {
	return `${formatHelpSections(schema, options).join('\n\n')}\n`;
}

// --- Section renderers

/**
 * Render the `Usage:` line for a command.
 *
 * @param schema - The {@link CommandSchema} to summarize.
 * @param opts - Resolved help options (bin name, default-help flag).
 * @returns Usage string with indented continuation lines when needed.
 */
function formatUsageLine(schema: CommandSchema, opts: ResolvedHelpOptions): string {
	const { theme } = opts;
	const parts: string[] = [theme.sectionTitle('Usage:')];
	// For the default command rendered as the root surface (`isDefaultHelp`), the
	// command name is NOT a route — `.default()` does not register a named command,
	// so `mycli <name>` would be consumed as the default's first positional, not a
	// dispatch. Render usage with only the bin name to avoid teaching a fake form.
	const cmdName =
		opts.binName === undefined
			? schema.name
			: opts.isDefaultHelp
				? opts.binName
				: `${opts.binName} ${schema.name}`;
	parts.push(theme.usageBin(cmdName));

	// Subcommand placeholder — groups show <command> before flags/args
	if (schema.commands.length > 0) {
		parts.push(theme.placeholder('<command>'));
	}

	// Flags placeholder
	const flagNames = Object.keys(schema.flags);
	if (flagNames.length > 0) {
		parts.push(theme.placeholder('[flags]'));
	}

	// Positional args
	for (const entry of schema.args) {
		parts.push(theme.arg(formatArgUsage(entry, opts.width - 7)));
	}

	return `${parts[0]} ${wrapText(parts.slice(1).join(' '), opts.width, 7)}`;
}

/**
 * Render the `Arguments:` help section.
 *
 * @param args - Positional arg entries from the {@link CommandSchema}.
 * @param opts - Resolved help options for line-width wrapping.
 * @returns Multi-line arguments section string.
 */
function formatArgsSection(args: readonly CommandArgEntry[], opts: ResolvedHelpOptions): string {
	const { theme } = opts;
	const lines: string[] = [theme.sectionTitle('Arguments:')];
	const GAP = 2;

	// Compute max left width (visible columns — the left column may carry SGR escapes)
	let maxLeft = 0;
	const entries: Array<{ left: string; desc: string; choices?: readonly string[] }> = [];
	for (const entry of args) {
		const token = formatArgUsage(entry, Math.floor(opts.width / 2) - 4);
		const left = `  ${theme.arg(token)}`;
		const desc = formatArgDescription(entry.schema, theme, opts.descriptionTheme);
		entries.push({
			left,
			desc,
			...(token !== formatArgUsage(entry) && entry.schema.enumValues !== undefined
				? { choices: entry.schema.enumValues }
				: {}),
		});
		const leftWidth = visibleWidth(left);
		if (leftWidth > maxLeft) maxLeft = leftWidth;
	}

	const descCol = maxLeft + GAP;
	for (const { left, desc, choices } of entries) {
		if (desc.length === 0) {
			lines.push(left);
		} else if (
			descCol >= opts.width / 2 ||
			desc.split(' ').some((word) => visibleWidth(word) > opts.width - descCol)
		) {
			lines.push(left, `    ${wrapText(desc, opts.width, 4)}`);
		} else {
			const padded = padEnd(left, descCol);
			const wrapped = wrapText(desc, opts.width, descCol);
			lines.push(`${padded}${wrapped}`);
		}
		if (choices !== undefined) {
			lines.push(
				`    ${wrapText(`Choices: ${choices.map((choice) => theme.arg(choice)).join(', ')}`, opts.width, 4)}`,
			);
		}
	}

	return lines.join('\n');
}

/**
 * Render the `Flags:` help section.
 *
 * @param flags - Map of flag names to {@link FlagSchema} definitions.
 * @param opts - Resolved help options for line-width wrapping.
 * @returns Multi-line flags section string.
 */
function formatFlagsSection(
	flags: Readonly<Record<string, FlagSchema>>,
	opts: ResolvedHelpOptions,
): string {
	return formatFlagEntriesBlock(
		opts.theme.sectionTitle('Flags:'),
		buildFlagEntries(flags, opts),
		opts.width,
	);
}

/**
 * Render a titled two-column flag block from pre-built {@link FlagEntry} rows.
 *
 * Shared by the per-command `Flags:` section and the root-help `Global options:`
 * block (built-in flags), so column alignment and description wrapping stay
 * identical across both. Returns `''` when there are no entries.
 *
 * @param title - Section heading (e.g. `'Flags:'`, `'Global options:'`), pre-styled by the caller.
 * @param entries - Formatted left/description rows.
 * @param width - Terminal width for description wrapping.
 * @returns Multi-line block string, or `''` when `entries` is empty.
 * @internal
 */
function formatFlagEntriesBlock(
	title: string,
	entries: readonly FlagEntry[],
	width: number,
): string {
	if (entries.length === 0) return '';
	const lines: string[] = [title];
	const GAP = 2;

	// Visible columns — left columns may carry SGR escapes when themed.
	let maxLeft = 0;
	for (const entry of entries) {
		const indentedWidth = visibleWidth(entry.left) + 2;
		if (indentedWidth > maxLeft) maxLeft = indentedWidth;
	}

	const descCol = maxLeft + GAP;
	for (const entry of entries) {
		const left = `  ${entry.left}`;
		if (entry.description.length === 0) {
			lines.push(left);
		} else {
			const padded = padEnd(left, descCol);
			const wrapped = wrapText(entry.description, width, descCol);
			lines.push(`${padded}${wrapped}`);
		}
	}

	return lines.join('\n');
}

/**
 * Render the `Commands:` help section.
 *
 * @param commands - Visible subcommand schemas (hidden commands pre-filtered).
 * @param opts - Resolved help options for line-width wrapping.
 * @returns Multi-line commands section string.
 */
function formatCommandsSection(
	commands: readonly CommandSchema[],
	opts: ResolvedHelpOptions,
): string {
	const { theme } = opts;
	const lines: string[] = [theme.sectionTitle('Commands:')];
	const GAP = 2;

	// Compute max name length for alignment (plain names — styling happens at emit)
	let maxNameLen = 0;
	for (const cmd of commands) {
		if (cmd.name.length > maxNameLen) {
			maxNameLen = cmd.name.length;
		}
	}

	const descCol = 2 + maxNameLen + GAP; // 2 for indent
	for (const cmd of commands) {
		const left = `  ${theme.command(cmd.name)}`;
		const desc = cmd.description ?? '';
		if (desc.length === 0) {
			lines.push(left);
		} else {
			const padded = padEnd(left, descCol);
			const wrapped = wrapText(desc, opts.width, descCol);
			lines.push(`${padded}${wrapped}`);
		}
	}

	return lines.join('\n');
}

/**
 * One shell token: a single- or double-quoted span (kept whole so internal
 * spaces don't split it) or a run of non-whitespace characters.
 */
const EXAMPLE_TOKEN = /(?:'[^']*'|"[^"]*"|\S)+/g;

/**
 * Highlight an example command per token: the leading binary via `usageBin`,
 * flag tokens (`-x`, `--long`) via `flag`, everything else plain.
 *
 * Uses `replace` so only the token spans are wrapped and the whitespace
 * between them is preserved verbatim — with the color gate off (identity
 * formatters) the result equals `command`, so `stripAnsi(highlighted)` stays
 * equal to the plain rendering.
 */
function highlightExampleCommand(command: string, theme: HelpTheme): string {
	let index = 0;
	return command.replace(EXAMPLE_TOKEN, (token) => {
		const styled =
			index === 0 ? theme.usageBin(token) : token.startsWith('-') ? theme.flag(token) : token;
		index += 1;
		return styled;
	});
}

/**
 * Render the `Examples:` help section.
 *
 * @param examples - Array of {@link CommandExample} entries.
 * @param theme - Theme applied to the section title, `$` prompt marker, and
 *   per-token command highlighting.
 * @param meta - Program name/version passed to function-form example commands.
 * @returns Multi-line examples section string.
 */
function formatExamplesSection(
	examples: readonly CommandExample[],
	theme: HelpTheme,
	meta: ExampleMeta,
): string {
	const lines: string[] = [theme.sectionTitle('Examples:')];
	const prompt = theme.examplePrompt('$');

	for (const example of examples) {
		const command = highlightExampleCommand(resolveExampleCommand(example.command, meta), theme);
		if (example.description !== undefined) {
			lines.push(`  ${example.description}:`);
			lines.push(`    ${prompt} ${command}`);
		} else {
			lines.push(`  ${prompt} ${command}`);
		}
	}

	return lines.join('\n');
}

// --- Exports

export { osc8, visibleWidth } from './ansi.ts';
export type { HelpDescription, HelpTheme, HelpThemeFactory } from './theme.ts';
export type { FlagEntry, HelpOptions };
export { formatFlagEntriesBlock, formatHelp, formatHelpSections };
