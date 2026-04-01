/**
 * Auto-generated help text from command schemas.
 *
 * Renders usage line, description, positional args, flags table, and
 * examples from a `CommandSchema`. Designed for TTY output with
 * configurable width.
 *
 * @module dreamcli/core/help
 */

import type {
	ArgSchema,
	CommandArgEntry,
	CommandExample,
	CommandSchema,
	FlagSchema,
} from '#internals/core/schema/index.ts';
import { formatDisplayValue } from '#internals/core/output/display-value.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Options for customising help output. */
interface HelpOptions {
	/** Maximum line width (columns). Defaults to 80. */
	readonly width?: number;
	/** Binary/program name shown in the usage line. Defaults to command name. */
	readonly binName?: string;
	/** @internal Whether this usage line is being rendered as merged root/default help. */
	readonly isDefaultHelp?: boolean;
}

/** Resolved help options with defaults applied. */
interface ResolvedHelpOptions {
	readonly width: number;
	readonly binName: string | undefined;
	readonly isDefaultHelp: boolean;
}

const DEFAULT_WIDTH = 80;

function resolveOptions(options?: HelpOptions): ResolvedHelpOptions {
	return {
		width: options?.width ?? DEFAULT_WIDTH,
		binName: options?.binName,
		isDefaultHelp: options?.isDefaultHelp ?? false,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Pad `text` to `length` with trailing spaces. */
function padEnd(text: string, length: number): string {
	if (text.length >= length) return text;
	return text + ' '.repeat(length - text.length);
}

/** Wrap text to `width`, preserving leading indent on continuation lines. */
function wrapText(text: string, width: number, indent: number): string {
	if (text.length + indent <= width) return text;

	const maxLen = width - indent;
	if (maxLen <= 0) return text;

	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		if (current.length === 0) {
			current = word;
		} else if (current.length + 1 + word.length <= maxLen) {
			current += ` ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current.length > 0) {
		lines.push(current);
	}

	const pad = ' '.repeat(indent);
	return lines.map((line, i) => (i === 0 ? line : `${pad}${line}`)).join('\n');
}

// ---------------------------------------------------------------------------
// Deprecation formatting
// ---------------------------------------------------------------------------

/** Format a deprecation annotation for help text. */
function formatDeprecated(deprecated: string | true): string {
	return typeof deprecated === 'string' ? `[deprecated: ${deprecated}]` : '[deprecated]';
}

// ---------------------------------------------------------------------------
// Flag formatting
// ---------------------------------------------------------------------------

/** Formatted flag entry for the flags table. */
interface FlagEntry {
	readonly left: string;
	readonly description: string;
}

/** Format a flag's left column: `-a, --name <type>` */
function formatFlagLeft(name: string, schema: FlagSchema): string {
	const parts: string[] = [];

	// Short alias first (single-char)
	const shortAlias = schema.aliases.find((a) => a.length === 1);
	if (shortAlias !== undefined) {
		parts.push(`-${shortAlias},`);
	}

	// Long flag name
	parts.push(`--${name}`);

	// Value placeholder (skip for boolean)
	if (schema.kind !== 'boolean') {
		parts.push(formatValueHint(schema));
	}

	return parts.join(' ');
}

/** Produce a type hint like `<string>`, `<number>`, `<us|eu|ap>`. */
function formatValueHint(schema: FlagSchema): string {
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
			return '';
		case 'custom':
			return '<value>';
	}
}

/** Build description with env/config/prompt/default/required/deprecated annotations. */
function formatFlagDescription(schema: FlagSchema): string {
	const parts: string[] = [];

	if (schema.description !== undefined) {
		parts.push(schema.description);
	}

	// Deprecation annotation — prominent, before other metadata
	if (schema.deprecated !== undefined) {
		parts.push(formatDeprecated(schema.deprecated));
	}

	// Resolution source annotations — show users where values can come from
	if (schema.envVar !== undefined) {
		parts.push(`[env: ${schema.envVar}]`);
	}
	if (schema.configPath !== undefined) {
		parts.push(`[config: ${schema.configPath}]`);
	}
	if (schema.prompt !== undefined) {
		parts.push('[prompt]');
	}

	if (schema.presence === 'required') {
		parts.push('[required]');
	} else if (schema.presence === 'defaulted' && schema.kind !== 'boolean') {
		// Don't show "(default: false)" for boolean — it's obvious
		parts.push(`(default: ${formatDisplayValue(schema.defaultValue)})`);
	}

	return parts.join(' ');
}

/** Build the flag entries sorted: short-aliased first, then alphabetical. */
function buildFlagEntries(flags: Readonly<Record<string, FlagSchema>>): readonly FlagEntry[] {
	const names = Object.keys(flags);
	if (names.length === 0) return [];

	// Sort: flags with short aliases first, then alphabetically by name
	const sorted = [...names].sort((a, b) => {
		const aSchema = flags[a];
		const bSchema = flags[b];
		if (aSchema === undefined || bSchema === undefined) return 0;
		const aHasShort = aSchema.aliases.some((al) => al.length === 1);
		const bHasShort = bSchema.aliases.some((al) => al.length === 1);
		if (aHasShort && !bHasShort) return -1;
		if (!aHasShort && bHasShort) return 1;
		return a.localeCompare(b);
	});

	const entries: FlagEntry[] = [];
	for (const name of sorted) {
		const schema = flags[name];
		if (schema === undefined) continue;
		entries.push({
			left: formatFlagLeft(name, schema),
			description: formatFlagDescription(schema),
		});
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Arg formatting
// ---------------------------------------------------------------------------

/** Format a positional arg for the usage line. */
function formatArgUsage(entry: CommandArgEntry): string {
	const { name, schema } = entry;
	const label =
		schema.kind === 'enum' && schema.enumValues !== undefined ? schema.enumValues.join('|') : name;
	const variadicSuffix = schema.variadic ? '...' : '';
	if (schema.presence === 'required') {
		return `<${label}>${variadicSuffix}`;
	}
	return `[${label}]${variadicSuffix}`;
}

/** Format arg description with annotations. */
function formatArgDescription(schema: ArgSchema): string {
	const parts: string[] = [];

	if (schema.description !== undefined) {
		parts.push(schema.description);
	}

	if (schema.deprecated !== undefined) {
		parts.push(formatDeprecated(schema.deprecated));
	}

	if (schema.envVar !== undefined) {
		parts.push(`[env: ${schema.envVar}]`);
	}

	if (schema.presence === 'defaulted' && schema.defaultValue !== undefined) {
		parts.push(`(default: ${formatDisplayValue(schema.defaultValue)})`);
	}

	return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * @internal
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
		sections.push(formatExamplesSection(schema.examples));
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

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function formatUsageLine(schema: CommandSchema, opts: ResolvedHelpOptions): string {
	const parts: string[] = ['Usage:'];
	const cmdName =
		opts.binName === undefined
			? schema.name
			: opts.isDefaultHelp && opts.binName === schema.name
				? schema.name
				: `${opts.binName} ${schema.name}`;
	parts.push(cmdName);

	// Subcommand placeholder — groups show <command> before flags/args
	if (schema.commands.length > 0) {
		parts.push('<command>');
	}

	// Flags placeholder
	const flagNames = Object.keys(schema.flags);
	if (flagNames.length > 0) {
		parts.push('[flags]');
	}

	// Positional args
	for (const entry of schema.args) {
		parts.push(formatArgUsage(entry));
	}

	return parts.join(' ');
}

function formatArgsSection(args: readonly CommandArgEntry[], opts: ResolvedHelpOptions): string {
	const lines: string[] = ['Arguments:'];
	const GAP = 2;

	// Compute max left width
	let maxLeft = 0;
	const entries: Array<{ left: string; desc: string }> = [];
	for (const entry of args) {
		const left = `  ${formatArgUsage(entry)}`;
		const desc = formatArgDescription(entry.schema);
		entries.push({ left, desc });
		if (left.length > maxLeft) maxLeft = left.length;
	}

	const descCol = maxLeft + GAP;
	for (const { left, desc } of entries) {
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

function formatFlagsSection(
	flags: Readonly<Record<string, FlagSchema>>,
	opts: ResolvedHelpOptions,
): string {
	const lines: string[] = ['Flags:'];
	const GAP = 2;

	const entries = buildFlagEntries(flags);
	if (entries.length === 0) return '';

	// Compute max left width
	let maxLeft = 0;
	for (const entry of entries) {
		const indented = `  ${entry.left}`;
		if (indented.length > maxLeft) maxLeft = indented.length;
	}

	const descCol = maxLeft + GAP;
	for (const entry of entries) {
		const left = `  ${entry.left}`;
		if (entry.description.length === 0) {
			lines.push(left);
		} else {
			const padded = padEnd(left, descCol);
			const wrapped = wrapText(entry.description, opts.width, descCol);
			lines.push(`${padded}${wrapped}`);
		}
	}

	return lines.join('\n');
}

function formatCommandsSection(
	commands: readonly CommandSchema[],
	opts: ResolvedHelpOptions,
): string {
	const lines: string[] = ['Commands:'];
	const GAP = 2;

	// Compute max name length for alignment
	let maxNameLen = 0;
	for (const cmd of commands) {
		if (cmd.name.length > maxNameLen) {
			maxNameLen = cmd.name.length;
		}
	}

	const descCol = 2 + maxNameLen + GAP; // 2 for indent
	for (const cmd of commands) {
		const left = `  ${cmd.name}`;
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

function formatExamplesSection(examples: readonly CommandExample[]): string {
	const lines: string[] = ['Examples:'];

	for (const example of examples) {
		if (example.description !== undefined) {
			lines.push(`  ${example.description}:`);
			lines.push(`    $ ${example.command}`);
		} else {
			lines.push(`  $ ${example.command}`);
		}
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { HelpOptions };
export { formatHelp, formatHelpSections };
