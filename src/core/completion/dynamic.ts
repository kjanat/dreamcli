/**
 * Resolve completion callbacks without running command execution.
 *
 * @module dreamcli/core/completion/dynamic
 * @internal
 */

import { BUILTIN_NAMES, BUILTIN_SPECS, builtinEnabled } from '#internals/core/cli/builtins.ts';
import type { CompiledCLI } from '#internals/core/cli/compiled.ts';
import { dispatch, findClosestCommand } from '#internals/core/cli/dispatch.ts';
import type { CLISchema } from '#internals/core/cli/index.ts';
import {
	buildRootCommandMap,
	canDelegateUnknownRootToDefault,
} from '#internals/core/cli/planner.ts';
import { collectPropagatedFlags } from '#internals/core/cli/propagate.ts';
import { readRootOutputFlags } from '#internals/core/cli/root-output-flags.ts';
import { resolveRootSurface } from '#internals/core/cli/root-surface.ts';
import { extractConfigFlag } from '#internals/core/cli/runtime-preflight.ts';
import type { FlagLookupEntry } from '#internals/core/parse/index.ts';
import {
	buildFlagLookup,
	coerceFlagValue,
	flagExpectsValue,
	variadicLongValueCount,
} from '#internals/core/parse/index.ts';
import type { CompletionContext, CompletionHandler } from '#internals/core/schema/completion.ts';
import { excludesOtherInputs } from '#internals/core/schema/constraints.ts';
import { getFlagAliasNames, getVisibleNegatedName } from '#internals/core/schema/flag.ts';
import { acceptsArgv } from '#internals/core/schema/stdin.ts';

interface CompletionTarget {
	readonly handler: CompletionHandler;
	readonly context: CompletionContext;
	readonly tokenPrefix: string;
	readonly commandCandidates: readonly string[];
}

function completionPosition(
	schema: CLISchema,
	compiled: CompiledCLI,
	beforeCursor: readonly string[],
	cursor?: string,
) {
	const config =
		schema.configSettings === undefined
			? undefined
			: extractConfigFlag(beforeCursor, schema.configSettings.noConfigFlag);
	const configuredArgv = config?.filteredArgv ?? beforeCursor;
	const completedArgv = readRootOutputFlags(configuredArgv, schema.builtins).argv;
	const visibleDefaultCommand = resolveRootSurface(schema).visibleDefaultCommand;
	const commands =
		schema.defaultCommandRouted && compiled.defaultCommand !== undefined
			? [...compiled.commands, compiled.defaultCommand]
			: compiled.commands;
	const result = dispatch(
		completedArgv,
		buildRootCommandMap(commands),
		[],
		buildFlagLookup(schema.defaultCommand?.flags ?? {}, schema.flagSettings),
		schema.flagSettings,
	);
	if (
		result.kind === 'unknown' &&
		(result.parentPath.length > 0 ||
			visibleDefaultCommand === undefined ||
			compiled.defaultCommand === undefined ||
			!canDelegateUnknownRootToDefault(compiled.defaultCommand, result.input) ||
			(result.input !== '' && findClosestCommand(result.input, result.candidates) !== undefined))
	)
		return undefined;
	const command = result.kind === 'unknown' ? visibleDefaultCommand : result.command.schema;
	if (command === undefined) return undefined;
	const path = result.kind === 'unknown' ? [] : result.commandPath;
	const remaining = result.kind === 'unknown' ? completedArgv : result.remainingArgv;
	const flags = { ...collectPropagatedFlags(path), ...command.flags };
	const args = command.args.filter((entry) => acceptsArgv(entry.schema));
	let positional = 0;
	let afterSeparator = false;
	let pending: FlagLookupEntry | undefined;
	const lookup = buildFlagLookup(flags, schema.flagSettings);
	const activeFlags = command.constraints?.some(excludesOtherInputs)
		? new Map<string, boolean>()
		: undefined;
	let skip = 0;
	for (const [index, token] of remaining.entries()) {
		if (skip > 0) {
			skip--;
			continue;
		}
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
			const match = matchFlag(token, lookup);
			if (match === undefined || (match.entry.negated && match.inline !== undefined))
				return undefined;
			if (activeFlags !== undefined) {
				if (!token.startsWith('--')) {
					for (const ch of token.slice(1)) {
						const entry = lookup.get(ch);
						if (entry === undefined || flagExpectsValue(entry.schema)) break;
						recordActiveFlag(activeFlags, entry, undefined);
					}
				}
				recordActiveFlag(activeFlags, match.entry, match.inline);
			}
			if (token.startsWith('--') && match.entry.schema.variadic === true) {
				skip = variadicLongValueCount(remaining, index, lookup, match.inline !== undefined);
				if (
					index + skip === remaining.length - 1 &&
					cursor !== undefined &&
					!cursor.startsWith('-')
				) {
					pending = match.entry;
					break;
				}
			} else if (match.inline === undefined && flagExpectsValue(match.entry.schema)) {
				pending = match.entry;
			}
			continue;
		}
		if (args[positional] === undefined && !args[args.length - 1]?.schema.variadic) return undefined;
		positional++;
	}
	return {
		command,
		path,
		result,
		flags,
		args,
		positional,
		afterSeparator,
		pending,
		lookup,
		activeFlags,
	};
}

/** Track only presence and boolean enablement, without running value callbacks. */
function recordActiveFlag(
	flags: Map<string, boolean>,
	entry: FlagLookupEntry,
	inline: string | undefined,
): void {
	const { name, schema, negated } = entry;
	if (schema.duplicates === 'first' && flags.has(name)) return;
	let active = !negated;
	if (schema.kind === 'boolean' && inline !== undefined) {
		try {
			active = coerceFlagValue(name, inline, schema) === true;
		} catch {
			return;
		}
	}
	flags.set(name, active);
}

type CompletionPosition = NonNullable<ReturnType<typeof completionPosition>>;

function blockedFlagNames(position: CompletionPosition): ReadonlySet<string> {
	const blocked = new Set<string>();
	if (position.activeFlags === undefined || position.afterSeparator) return blocked;
	const activeArgs = new Set(position.args.slice(0, position.positional).map(({ name }) => name));
	for (const rule of position.command.constraints ?? []) {
		if (!excludesOtherInputs(rule)) continue;
		const active = rule.inputs.filter(({ kind, name }) =>
			kind === 'flag' ? position.activeFlags?.get(name) === true : activeArgs.has(name),
		);
		for (const input of rule.inputs) {
			if (input.kind === 'flag' && active.some((member) => member !== input))
				blocked.add(input.name);
		}
	}
	return blocked;
}

function findCompletion(
	position: CompletionPosition,
	argv: readonly string[],
	env: CompletionContext['env'],
): CompletionTarget | undefined {
	const { args, path, result, positional, afterSeparator, pending, lookup } = position;
	let prefix = argv[argv.length - 1] ?? '';
	let tokenPrefix = '';
	let input: CompletionContext['input'];
	let handler: CompletionHandler | undefined;
	let commandCandidates: readonly string[] = [];
	if (pending !== undefined) {
		input = { kind: 'flag', name: pending.name };
		handler = pending.schema.completion;
	} else if (!afterSeparator && prefix.startsWith('-')) {
		const match = matchFlag(prefix, lookup);
		if (match?.inline === undefined || match.entry.negated) return undefined;
		input = { kind: 'flag', name: match.entry.name };
		handler = match.entry.schema.completion;
		tokenPrefix = prefix.slice(0, prefix.length - match.inline.length);
		prefix = match.inline;
	} else {
		const entry =
			args[positional] ??
			(args[args.length - 1]?.schema.variadic ? args[args.length - 1] : undefined);
		if (entry === undefined) return undefined;
		if (positional === 0 && !afterSeparator) {
			const candidates =
				result.kind === 'unknown'
					? result.candidates
					: [...new Set(result.command.subcommands.values())];
			commandCandidates = candidates
				.filter((candidate) => !candidate.schema.hidden)
				.flatMap((candidate) => [candidate.schema.name, ...candidate.schema.aliases]);
		}
		input = { kind: 'arg', name: entry.name };
		handler = entry.schema.completion;
	}
	if (handler === undefined) return undefined;
	return {
		handler,
		tokenPrefix,
		commandCandidates,
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
	compiled: CompiledCLI,
	argv: readonly string[],
	env: CompletionContext['env'],
	mode: 'all' | 'values' | 'value-only',
): Promise<{ readonly exitCode: number; readonly candidates: readonly string[] }> {
	// Check the complete argv, including a config path at the cursor. A successful
	// empty response suppresses static fallback. Fish still queries blocked flags
	// independently from value completion.
	if (
		schema.configSettings?.noConfigFlag === true &&
		extractConfigFlag(argv, true).error !== undefined
	) {
		return { exitCode: 0, candidates: [] };
	}
	const position =
		argv.length === 0
			? undefined
			: completionPosition(schema, compiled, argv.slice(0, -1), argv.at(-1));
	if (position === undefined) return { exitCode: 1, candidates: [] };
	const target = findCompletion(position, argv, env);
	if (target === undefined) {
		const prefix = argv[argv.length - 1] ?? '';
		const blocked = blockedFlagNames(position);
		if (
			mode !== 'all' ||
			blocked.size === 0 ||
			position.pending !== undefined ||
			(prefix !== '' && !prefix.startsWith('-')) ||
			prefix.includes('=')
		) {
			return { exitCode: 1, candidates: [] };
		}
		const flags = Object.entries(position.flags).flatMap(([name, flag]) => {
			if (!acceptsArgv(flag)) return [];
			const negated = getVisibleNegatedName(name, flag);
			return [
				...(blocked.has(name)
					? []
					: [
							`--${name}`,
							...getFlagAliasNames(flag).map((alias) =>
								alias.length === 1 ? `-${alias}` : `--${alias}`,
							),
						]),
				...(negated !== undefined ? [`--${negated}`] : []),
			];
		});
		const children =
			position.result.kind === 'unknown'
				? position.result.candidates
				: [...new Set(position.result.command.subcommands.values())];
		const commands =
			position.positional === 0
				? children
						.filter((child) => !child.schema.hidden)
						.flatMap(({ schema }) => [schema.name, ...schema.aliases])
				: [];
		const root =
			position.result.kind === 'unknown'
				? [
						...(builtinEnabled(schema.builtins, 'help') ? ['--help'] : []),
						...(schema.version !== undefined ? ['--version'] : []),
					]
				: [];
		return {
			exitCode: 0,
			candidates: [...new Set([...commands, ...root, ...flags])].filter(
				(candidate) => !/\p{Cc}/u.test(candidate) && candidate.startsWith(prefix),
			),
		};
	}
	try {
		const values = await target.handler(target.context);
		const candidates = [...new Set([...target.commandCandidates, ...values])]
			.filter(
				(value) =>
					typeof value === 'string' &&
					value.length > 0 &&
					!/\p{Cc}/u.test(value) &&
					value.startsWith(target.context.prefix),
			)
			.map((value) => (mode === 'value-only' ? value : target.tokenPrefix + value));
		return { exitCode: 0, candidates };
	} catch {
		return {
			exitCode: 0,
			candidates: target.commandCandidates.filter((value) =>
				value.startsWith(target.context.prefix),
			),
		};
	}
}

/** Parse generator options before the application argv separator. */
async function completeRequest(
	schema: CLISchema,
	compiled: CompiledCLI,
	request: readonly string[],
	env: CompletionContext['env'],
): ReturnType<typeof completeValues> {
	if (request[0] === '--blocked-flags' && request[1] === '--') {
		const position = completionPosition(schema, compiled, request.slice(2));
		return {
			exitCode: 0,
			candidates: position === undefined ? [] : [...blockedFlagNames(position)],
		};
	}
	if (request[1] === '--') {
		if (request[0] === '--value-only')
			return completeValues(schema, compiled, request.slice(2), env, 'value-only');
		if (request[0] === '--values')
			return completeValues(schema, compiled, request.slice(2), env, 'values');
	}
	return completeValues(schema, compiled, request.slice(request[0] === '--' ? 1 : 0), env, 'all');
}

export { completeRequest };
