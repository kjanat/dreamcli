/**
 * Root-level help formatter for the CLI program.
 *
 * Separate from `help/formatHelp()` which renders per-command help —
 * different concerns, different format.
 *
 * @module dreamcli/core/cli/root-help
 * @internal
 */

import { osc8, padEnd, wrapText } from '#internals/core/help/ansi.ts';
import type { FlagEntry, HelpOptions } from '#internals/core/help/index.ts';
import { formatFlagEntriesBlock, formatHelpSections } from '#internals/core/help/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagSchema } from '#internals/core/schema/flag.ts';
import { resolveRootSurface } from './root-surface.ts';

// Re-use CLISchema inline to avoid circular import through the barrel.
// Only the shape matters — we read `.name`, `.version`, `.description`, `.commands`,
// `.defaultCommand`, `.helpLinks`.
/** Structural subset of `CLISchema` — avoids circular imports through the barrel. */
interface CLISchemaLike {
	readonly name: string;
	readonly version: string | undefined;
	readonly description: string | undefined;
	readonly commands: ReadonlyArray<{
		readonly schema: CommandSchema;
	}>;
	readonly defaultCommand: { readonly schema: CommandSchema } | undefined;
	/** Whether the default is also a named route — listed in `Commands:` when so. */
	readonly defaultCommandRouted?: boolean | undefined;
	readonly helpLinks?:
		| {
				readonly name: string | undefined;
				readonly version: string | undefined;
		  }
		| undefined;
	readonly completionsFlag?: { readonly shells: readonly string[] } | undefined;
	/**
	 * Config discovery settings. Only its presence is read — defined means
	 * `.config()` enabled the built-in `--config <path>` flag, so root help
	 * advertises it in `Global options:`.
	 */
	readonly configSettings?: { readonly appName: string } | undefined;
}

// --- Root help formatter

/**
 * Generate root-level help text for the CLI program.
 *
 * Shows program name, version, description, usage line, and available
 * subcommands. The default command is the CLI's root *surface*: its arguments
 * and flags are rendered inline (unless `inlineDefault` is `false`) and it is
 * omitted from the `Commands:` list unless `showDefaultInCommands` is set. When
 * `.completions({ as: 'flag' })` is active, the eager `--completions <shell>`
 * flag is advertised in the `Flags:` section.
 *
 * @internal
 */
function formatRootHelp(schema: CLISchemaLike, options?: HelpOptions): string {
	const width = options?.width ?? 80;
	const binName = options?.binName ?? schema.name;
	const hyperlinks = options?.hyperlinks === true;
	const inlineDefault = options?.inlineDefault ?? true;
	const showDefaultInCommands = options?.showDefaultInCommands ?? false;

	const surface = resolveRootSurface(schema);
	const defaultCommand = surface.visibleDefaultCommand;
	// `inlineDefault: false` hides the default command's args/flags, but the eager
	// `--completions` flag is a root-level option that must still be advertised, so
	// a synthetic completions-only surface is rendered even then.
	//
	// Exception: when the default command is the *only* surface — no visible
	// subcommands AND no eager `--completions` flag to advertise — suppressing it
	// would collapse root help to a bare `Usage: <bin> [options]` with no
	// discoverable interface at all. In that case the default is always rendered
	// inline regardless of `inlineDefault`. (With a completions flag the synthetic
	// surface still gives a discoverable path, so `inlineDefault: false` is honored.)
	const defaultIsSoleSurface =
		!surface.hasVisibleSubcommands && schema.completionsFlag === undefined;
	const renderDefaultInline = inlineDefault || defaultIsSoleSurface;
	const inlineDefaultCommand = renderDefaultInline ? defaultCommand : undefined;
	const surfaceCommand = resolveSurfaceCommand(schema, inlineDefaultCommand);
	const inline = surfaceCommand !== undefined;

	const sections: string[] = [formatHeader(schema, hyperlinks)];
	if (schema.description !== undefined) {
		sections.push(schema.description);
	}

	// ---- Usage --------------------------------------------------------------
	// A real default makes the command optional (`[command]`); without one a
	// command must be chosen (`<command>`). With no subcommands at all, the
	// default command's own usage stands alone.
	const placeholder = surface.hasVisibleSubcommands
		? defaultCommand !== undefined
			? '[command]'
			: '<command>'
		: '';
	const rootUsage =
		placeholder.length > 0
			? `Usage: ${binName} ${placeholder} [options]`
			: `Usage: ${binName} [options]`;

	let surfaceSections: string[] = [];
	if (inline && surfaceCommand !== undefined) {
		surfaceSections = [
			...formatHelpSections(surfaceCommand, {
				...options,
				binName,
				isDefaultHelp: true,
			}),
		];
	}
	const surfaceUsage = surfaceSections.shift();
	// Merge the surface usage into the root usage only when the default command is
	// actually inlined; a completions-only synthetic surface keeps the root usage.
	if (inline && surfaceUsage !== undefined && inlineDefaultCommand !== undefined) {
		sections.push(
			surface.hasVisibleSubcommands ? mergeUsageSections(rootUsage, surfaceUsage) : surfaceUsage,
		);
	} else {
		sections.push(rootUsage);
	}

	// ---- Commands -----------------------------------------------------------
	// A routed default (`.default(cmd, { route: true })`) is listed beside its
	// siblings even without `showDefaultInCommands`, since it is a real named
	// route; a surface-only default is listed only when explicitly opted in.
	const listDefaultInCommands =
		defaultCommand !== undefined && (surface.defaultRouted || showDefaultInCommands);
	const listedCommands = listDefaultInCommands
		? [...surface.visibleSubcommands, defaultCommand]
		: surface.visibleSubcommands;
	if (listedCommands.length > 0) {
		sections.push(
			formatRootCommandsSection(
				listedCommands,
				listDefaultInCommands ? defaultCommand?.name : undefined,
				width,
			),
		);
	}

	// ---- Inline default surface (args/flags) --------------------------------
	if (inline && surfaceCommand !== undefined) {
		// Drop the surface command's description when it duplicates the program
		// description already printed at the top.
		if (
			surfaceCommand.description !== undefined &&
			surfaceCommand.description === schema.description &&
			surfaceSections[0] === surfaceCommand.description
		) {
			surfaceSections.shift();
		}
		sections.push(...surfaceSections);
	}

	// ---- Global options (active built-in flags) -----------------------------
	// Built-ins are framework-provided and never appear in any command schema, so
	// they are advertised here for discoverability (#32). `--completions` is not
	// listed: when active it is already injected into the inline surface's flags.
	const globalOptions = formatGlobalOptionsSection(schema, width);
	if (globalOptions.length > 0) {
		sections.push(globalOptions);
	}

	// ---- Footer -------------------------------------------------------------
	const footerVisible = options?.footer ?? surface.hasVisibleSubcommands;
	if (footerVisible) {
		const footerPlaceholder = surface.hasVisibleSubcommands
			? defaultCommand !== undefined
				? ' [command]'
				: ' <command>'
			: '';
		sections.push(`Run '${binName}${footerPlaceholder} --help' for more information.`);
	}

	return `${sections.join('\n\n')}\n`;
}

/**
 * Resolve the command rendered inline as the CLI's root surface.
 *
 * Returns the default command, augmented with the eager `--completions <shell>`
 * flag when `.completions({ as: 'flag' })` is active. When there is no default
 * command but the completions flag is configured, a synthetic surface carrying
 * just that flag is returned so the flag is still advertised. Returns
 * `undefined` when there is nothing to render inline.
 *
 * @internal
 */
function resolveSurfaceCommand(
	schema: CLISchemaLike,
	defaultCommand: CommandSchema | undefined,
): CommandSchema | undefined {
	if (schema.completionsFlag === undefined) return defaultCommand;
	const base = defaultCommand ?? command(schema.name).schema;
	return {
		...base,
		flags: { completions: completionsFlagSchema(schema.completionsFlag.shells), ...base.flags },
	};
}

/**
 * Build the synthetic, render-only flag schema for the eager `--completions`
 * flag. It never participates in parsing (the planner intercepts the flag
 * directly); it exists purely so root help can list
 * `--completions <bash|zsh|…>` in its `Flags:` section.
 *
 * @internal
 */
function completionsFlagSchema(shells: readonly string[]): FlagSchema {
	return {
		kind: 'enum',
		presence: 'optional',
		defaultValue: undefined,
		aliases: [],
		envVar: undefined,
		configPath: undefined,
		description: 'Print a shell completion script and exit',
		enumValues: shells,
		elementSchema: undefined,
		numberConstraints: undefined,
		prompt: undefined,
		parseFn: undefined,
		deprecated: undefined,
		propagate: false,
	};
}

/**
 * Render the header line (`name vX.Y.Z`).
 *
 * When `hyperlinks` is enabled and the schema carries link URLs (via
 * `CLIBuilder.links()`, possibly derived from package.json metadata), the
 * name and version are wrapped in OSC 8 hyperlinks. The header is the only
 * place links are emitted — usage lines, hints, and the commands table stay
 * plain.
 *
 * @param schema - The CLI schema.
 * @param hyperlinks - Whether OSC 8 hyperlinks may be emitted.
 * @returns The header line.
 * @internal
 */
function formatHeader(schema: CLISchemaLike, hyperlinks: boolean): string {
	const links = hyperlinks ? schema.helpLinks : undefined;
	const name = links?.name !== undefined ? osc8(links.name, schema.name) : schema.name;
	if (schema.version === undefined) return name;
	const version = `v${schema.version}`;
	return `${name} ${links?.version !== undefined ? osc8(links.version, version) : version}`;
}

/**
 * Format the "Commands:" section with aligned names and descriptions.
 *
 * @param visibleCommands - Non-hidden top-level commands.
 * @param defaultName - Name of the default command (appends " (default)" tag).
 * @param width - Terminal width for description wrapping.
 * @returns Formatted commands block.
 * @internal
 */
function formatRootCommandsSection(
	visibleCommands: readonly CommandSchema[],
	defaultName: string | undefined,
	width: number,
): string {
	const lines: string[] = ['Commands:'];
	const GAP = 2;
	const DEFAULT_TAG = ' (default)';

	// Compute max command name length for alignment (account for default tag)
	let maxNameLen = 0;
	for (const cmd of visibleCommands) {
		const tagLen = cmd.name === defaultName ? DEFAULT_TAG.length : 0;
		const nameLen = cmd.name.length + tagLen;
		if (nameLen > maxNameLen) {
			maxNameLen = nameLen;
		}
	}

	const descCol = 2 + maxNameLen + GAP; // 2 for indent
	for (const cmd of visibleCommands) {
		const isDefault = cmd.name === defaultName;
		const label = isDefault ? `${cmd.name}${DEFAULT_TAG}` : cmd.name;
		const padded = padEnd(`  ${label}`, descCol);
		const desc = cmd.description ?? '';
		if (desc.length === 0) {
			lines.push(padded.trimEnd());
		} else {
			lines.push(`${padded}${wrapText(desc, width, descCol)}`);
		}
	}

	return lines.join('\n');
}

/**
 * Build the `Global options:` section advertising the active built-in flags.
 *
 * `--help, -h` and `--json` are always available; `--version, -V` is shown only
 * when the program declares a version; `--config <path>` only when `.config()`
 * enabled config discovery. The eager `--completions` flag is intentionally
 * omitted — it is advertised via the inline surface when active.
 *
 * @param schema - The CLI schema (read for `version` and `configSettings`).
 * @param width - Terminal width for description wrapping.
 * @returns Formatted `Global options:` block (always non-empty).
 * @internal
 */
function formatGlobalOptionsSection(schema: CLISchemaLike, width: number): string {
	const entries: FlagEntry[] = [
		{ left: '-h, --help', description: 'Show this help message and exit' },
	];
	if (schema.version !== undefined) {
		entries.push({ left: '-V, --version', description: 'Print the version number and exit' });
	}
	entries.push({ left: '--json', description: 'Emit machine-readable JSON output' });
	if (schema.configSettings !== undefined) {
		entries.push({
			left: '--config <path>',
			description: 'Load configuration from the given file',
		});
	}
	return formatFlagEntriesBlock('Global options:', entries, width);
}

/**
 * Merge root and default-command usage lines into a single block.
 *
 * @param rootUsage - The root usage line (e.g. `Usage: mycli [command] [options]`).
 * @param commandUsage - The default command's usage line.
 * @returns Combined usage block with aligned continuation.
 * @internal
 */
function mergeUsageSections(rootUsage: string, commandUsage: string): string {
	const usagePrefix = 'Usage: ';
	const commandSuffix = commandUsage.startsWith(usagePrefix)
		? commandUsage.slice(usagePrefix.length)
		: commandUsage;
	return `${rootUsage}\n${' '.repeat(usagePrefix.length)}${commandSuffix}`;
}

// --- Exports

export { formatRootHelp };
