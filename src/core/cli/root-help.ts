/**
 * Root-level help formatter for the CLI program.
 *
 * Separate from `help/formatHelp()` which renders per-command help —
 * different concerns, different format.
 *
 * @module dreamcli/core/cli/root-help
 * @internal
 */

import type { HelpOptions } from '../help/index.ts';
import { formatHelpSections } from '../help/index.ts';
import type { CommandSchema } from '../schema/command.ts';
import { resolveRootSurface } from './root-surface.ts';

// Re-use CLISchema inline to avoid circular import through the barrel.
// Only the shape matters — we read `.name`, `.version`, `.description`, `.commands`,
// `.defaultCommand`.
interface CLISchemaLike {
	readonly name: string;
	readonly version: string | undefined;
	readonly description: string | undefined;
	readonly commands: ReadonlyArray<{
		readonly schema: CommandSchema;
	}>;
	readonly defaultCommand: { readonly schema: CommandSchema } | undefined;
}

// ---------------------------------------------------------------------------
// Root help formatter
// ---------------------------------------------------------------------------

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
	const rootSurface = resolveRootSurface(schema);
	if (rootSurface.hasSingleVisibleDefault) {
		const defaultCommand = rootSurface.visibleDefaultCommand;
		if (defaultCommand !== undefined) {
			const sections = buildRootSections(schema, rootSurface.visibleCommands, width);
			const usageIndex = sections.findIndex((section) => section.startsWith('Usage: '));
			const commandSections = [
				...formatHelpSections(defaultCommand, {
					...options,
					binName: schema.name,
				}),
			];
			const commandUsage = commandSections.shift();
			if (usageIndex !== -1 && commandUsage !== undefined) {
				sections[usageIndex] = mergeUsageSections(sections[usageIndex] ?? '', commandUsage);
			}
			if (
				defaultCommand.description !== undefined &&
				commandSections[0] === defaultCommand.description
			) {
				commandSections.shift();
			}
			sections.push(...commandSections);
			return `${sections.join('\n\n')}\n`;
		}
	}

	const sections = buildRootSections(schema, rootSurface.visibleCommands, width);
	sections.push(`Run '${schema.name} ${commandPlaceholder(schema)} --help' for more information.`);

	return `${sections.join('\n\n')}\n`;
}

function buildRootSections(
	schema: CLISchemaLike,
	visibleCommands: readonly CommandSchema[],
	width: number,
): string[] {
	const sections: string[] = [];

	// ---- Header: name + version ---------------------------------------------
	const header = schema.version !== undefined ? `${schema.name} v${schema.version}` : schema.name;
	sections.push(header);

	// ---- Description --------------------------------------------------------
	if (schema.description !== undefined) {
		sections.push(schema.description);
	}

	// ---- Usage line ---------------------------------------------------------
	sections.push(`Usage: ${schema.name} ${commandPlaceholder(schema)} [options]`);

	// ---- Commands list (skip hidden) ----------------------------------------
	if (visibleCommands.length > 0) {
		sections.push(
			formatRootCommandsSection(visibleCommands, schema.defaultCommand?.schema.name, width),
		);
	}

	return sections;
}

function commandPlaceholder(schema: CLISchemaLike): string {
	// `[command]` (optional) when a default command exists; `<command>` (required) otherwise.
	return schema.defaultCommand !== undefined ? '[command]' : '<command>';
}

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

function mergeUsageSections(rootUsage: string, commandUsage: string): string {
	const usagePrefix = 'Usage: ';
	const commandSuffix = commandUsage.startsWith(usagePrefix)
		? commandUsage.slice(usagePrefix.length)
		: commandUsage;
	return `${rootUsage}\n${' '.repeat(usagePrefix.length)}${commandSuffix}`;
}

// ---------------------------------------------------------------------------
// Text helpers (duplicated from help module to avoid coupling)
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
// Exports
// ---------------------------------------------------------------------------

export { formatRootHelp };
