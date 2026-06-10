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
import type { HelpOptions } from '#internals/core/help/index.ts';
import { formatHelpSections } from '#internals/core/help/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
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
	readonly helpLinks?:
		| {
				readonly name: string | undefined;
				readonly version: string | undefined;
		  }
		| undefined;
}

// --- Root help formatter

/**
 * Generate root-level help text for the CLI program.
 *
 * Shows program name, version, description, usage line, and available
 * commands. When the default command is the only visible top-level
 * command, merges the root summary with that command's detailed help.
 *
 * @internal
 */
function formatRootHelp(schema: CLISchemaLike, options?: HelpOptions): string {
	const width = options?.width ?? 80;
	const hyperlinks = options?.hyperlinks === true;
	const rootSurface = resolveRootSurface(schema);
	if (rootSurface.hasSingleVisibleDefault) {
		const defaultCommand = rootSurface.visibleDefaultCommand;
		if (defaultCommand !== undefined) {
			const sections = buildRootSections(
				schema,
				rootSurface.visibleCommands,
				rootSurface.visibleDefaultCommand,
				width,
				hyperlinks,
			);
			const usageIndex = sections.findIndex((section) => section.startsWith('Usage: '));
			const commandSections = [
				...formatHelpSections(defaultCommand, {
					...options,
					binName: schema.name,
					isDefaultHelp: true,
				}),
			];
			const commandUsage = commandSections.shift();
			if (usageIndex !== -1 && commandUsage !== undefined) {
				sections[usageIndex] = mergeUsageSections(sections[usageIndex] ?? '', commandUsage);
			}
			if (
				defaultCommand.description !== undefined &&
				schema.description !== undefined &&
				defaultCommand.description === schema.description
			) {
				commandSections.shift();
			}
			sections.push(...commandSections);
			return `${sections.join('\n\n')}\n`;
		}
	}

	const sections = buildRootSections(
		schema,
		rootSurface.visibleCommands,
		rootSurface.visibleDefaultCommand,
		width,
		hyperlinks,
	);
	const placeholder = commandPlaceholder(
		rootSurface.visibleCommands,
		rootSurface.visibleDefaultCommand,
	);
	sections.push(
		placeholder.length > 0
			? `Run '${schema.name} ${placeholder} --help' for more information.`
			: `Run '${schema.name} --help' for more information.`,
	);

	return `${sections.join('\n\n')}\n`;
}

/**
 * Assemble the header, description, usage, and commands sections for root help.
 *
 * @param schema - The CLI schema.
 * @param visibleCommands - Non-hidden top-level commands.
 * @param width - Terminal width for text wrapping.
 * @param hyperlinks - Whether to emit OSC 8 hyperlinks in the header.
 * @returns Ordered help sections (joined later with blank lines).
 * @internal
 */
function buildRootSections(
	schema: CLISchemaLike,
	visibleCommands: readonly CommandSchema[],
	visibleDefaultCommand: CommandSchema | undefined,
	width: number,
	hyperlinks: boolean,
): string[] {
	const sections: string[] = [];

	// ---- Header: name + version ---------------------------------------------
	sections.push(formatHeader(schema, hyperlinks));

	// ---- Description --------------------------------------------------------
	if (schema.description !== undefined) {
		sections.push(schema.description);
	}

	// ---- Usage line ---------------------------------------------------------
	const placeholder = commandPlaceholder(visibleCommands, visibleDefaultCommand);
	sections.push(
		placeholder.length > 0
			? `Usage: ${schema.name} ${placeholder} [options]`
			: `Usage: ${schema.name} [options]`,
	);

	// ---- Commands list (skip hidden) ----------------------------------------
	if (visibleCommands.length > 0) {
		sections.push(formatRootCommandsSection(visibleCommands, visibleDefaultCommand?.name, width));
	}

	return sections;
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
 * Return the usage-line placeholder for commands (`<command>`, `[command]`, or empty).
 *
 * @param visibleCommands - Non-hidden top-level commands.
 * @param defaultCommand - The default command, if any.
 * @returns Placeholder string for the usage line.
 * @internal
 */
function commandPlaceholder(
	visibleCommands: readonly CommandSchema[],
	defaultCommand: CommandSchema | undefined,
): string {
	if (visibleCommands.length === 0 && defaultCommand === undefined) {
		return '';
	}

	return defaultCommand !== undefined ? '[command]' : '<command>';
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
