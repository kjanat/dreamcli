/**
 * Resolve completion callbacks without running command execution.
 *
 * @module dreamcli/core/completion/dynamic
 * @internal
 */

import { BUILTIN_NAMES, BUILTIN_SPECS, builtinEnabled } from '#internals/core/cli/builtins.ts';
import type { CLISchema } from '#internals/core/cli/index.ts';
import { collectPropagatedFlags } from '#internals/core/cli/propagate.ts';
import type { FlagLookupEntry } from '#internals/core/parse/index.ts';
import { buildFlagLookup, flagExpectsValue } from '#internals/core/parse/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import type { CompletionContext, CompletionHandler } from '#internals/core/schema/completion.ts';
import { acceptsArgv } from '#internals/core/schema/stdin.ts';

interface CompletionTarget {
	readonly handler: CompletionHandler;
	readonly context: CompletionContext;
	readonly tokenPrefix: string;
}

function findCompletion(
	schema: CLISchema,
	argv: readonly string[],
	env: CompletionContext['env'],
): CompletionTarget | undefined {
	if (argv.length === 0) return undefined;
	const path: CommandSchema[] = [];
	let command = schema.defaultCommand;
	let children = schema.commands;
	if (schema.defaultCommandRouted && schema.defaultCommand !== undefined) {
		children = [...children, schema.defaultCommand];
	}
	let positional = 0;
	let afterSeparator = false;
	let pending: FlagLookupEntry | undefined;
	const lookup = () =>
		buildFlagLookup(
			command === undefined ? {} : { ...collectPropagatedFlags(path), ...command.flags },
			schema.flagSettings,
		);
	for (let index = 0; index < argv.length - 1; index++) {
		const token = argv[index];
		if (token === undefined) continue;
		if (pending !== undefined) {
			pending = undefined;
			continue;
		}
		if (!afterSeparator && token === '--') {
			afterSeparator = true;
			continue;
		}
		if (!afterSeparator && token.startsWith('-') && token !== '-') {
			const builtin = BUILTIN_NAMES.some(
				(name) =>
					builtinEnabled(schema.builtins, name) &&
					(BUILTIN_SPECS[name].short.includes(token) ||
						BUILTIN_SPECS[name].long.some(
							(form) => token === form || token.startsWith(`${form}=`),
						)),
			);
			if (builtin || (schema.version !== undefined && (token === '--version' || token === '-V')))
				continue;
			const match = matchFlag(token, lookup());
			if (match === undefined) return undefined;
			if (match.inline === undefined && flagExpectsValue(match.entry.schema)) pending = match.entry;
			continue;
		}
		if (!afterSeparator && positional === 0) {
			const child = children.find(
				(candidate) => candidate.name === token || candidate.aliases.includes(token),
			);
			if (child !== undefined) {
				path.push(child);
				command = child;
				children = child.commands;
				continue;
			}
		}
		const args = command?.args.filter((entry) => acceptsArgv(entry.schema)) ?? [];
		if (args[positional] === undefined && !args[args.length - 1]?.schema.variadic) return undefined;
		positional++;
	}
	let prefix = argv[argv.length - 1] ?? '';
	let tokenPrefix = '';
	let input: CompletionContext['input'];
	let handler: CompletionHandler | undefined;
	if (pending !== undefined) {
		input = { kind: 'flag', name: pending.name };
		handler = pending.schema.completion;
	} else if (!afterSeparator && prefix.startsWith('-')) {
		const match = matchFlag(prefix, lookup());
		if (match?.inline === undefined || !flagExpectsValue(match.entry.schema)) return undefined;
		input = { kind: 'flag', name: match.entry.name };
		handler = match.entry.schema.completion;
		tokenPrefix = prefix.slice(0, prefix.length - match.inline.length);
		prefix = match.inline;
	} else {
		const args = command?.args.filter((entry) => acceptsArgv(entry.schema)) ?? [];
		const entry =
			args[positional] ??
			(args[args.length - 1]?.schema.variadic ? args[args.length - 1] : undefined);
		if (entry === undefined) return undefined;
		input = { kind: 'arg', name: entry.name };
		handler = entry.schema.completion;
	}
	if (handler === undefined) return undefined;
	return {
		handler,
		tokenPrefix,
		context: { prefix, commandPath: path.map((item) => item.name), input, argv, env },
	};
}

function matchFlag(
	token: string,
	lookup: ReadonlyMap<string, FlagLookupEntry>,
): { readonly entry: FlagLookupEntry; readonly inline: string | undefined } | undefined {
	if (token.startsWith('--')) {
		const equals = token.indexOf('=');
		const entry = lookup.get(token.slice(2, equals < 0 ? undefined : equals));
		return entry === undefined
			? undefined
			: { entry, inline: equals < 0 ? undefined : token.slice(equals + 1) };
	}
	for (let index = 1; index < token.length; index++) {
		const entry = lookup.get(token[index] ?? '');
		if (entry === undefined) return undefined;
		if (flagExpectsValue(entry.schema) || index === token.length - 1) {
			return { entry, inline: index === token.length - 1 ? undefined : token.slice(index + 1) };
		}
	}
	return undefined;
}

/** Status 1 lets generated scripts fall back to static completion. */
async function completeValues(
	schema: CLISchema,
	argv: readonly string[],
	env: CompletionContext['env'],
	valueOnly = false,
): Promise<{ readonly exitCode: number; readonly candidates: readonly string[] }> {
	const target = findCompletion(schema, argv, env);
	if (target === undefined) return { exitCode: 1, candidates: [] };
	try {
		const values = await target.handler(target.context);
		const candidates = [...new Set(values)]
			.filter(
				(value) =>
					typeof value === 'string' &&
					value.length > 0 &&
					!/\p{Cc}/u.test(value) &&
					value.startsWith(target.context.prefix),
			)
			.map((value) => (valueOnly ? value : target.tokenPrefix + value));
		return { exitCode: 0, candidates };
	} catch {
		return { exitCode: 0, candidates: [] };
	}
}

export { completeValues };
