/**
 * Resolve completion callbacks without running command execution.
 *
 * @module dreamcli/core/completion/dynamic
 * @internal
 */

import { BUILTIN_NAMES, BUILTIN_SPECS, builtinEnabled } from '#internals/core/cli/builtins.ts';
import type { CompiledCLI } from '#internals/core/cli/compiled.ts';
import { extractConfigFlag } from '#internals/core/cli/config-flag.ts';
import { dispatch, findClosestCommand } from '#internals/core/cli/dispatch.ts';
import type { CLISchema } from '#internals/core/cli/index.ts';
import {
	buildRootCommandMap,
	canDelegateUnknownRootToDefault,
	invocationArgv,
} from '#internals/core/cli/planner.ts';
import { collectPropagatedFlags } from '#internals/core/cli/propagate.ts';
import { matchRootToken, readRootOutputFlags } from '#internals/core/cli/root-output-flags.ts';
import { resolveRootSurface } from '#internals/core/cli/root-surface.ts';
import { adjacentArgvValue, sliceArgvHead } from '#internals/core/parse/argv-boundaries.ts';
import type { FlagLookupEntry } from '#internals/core/parse/index.ts';
import {
	acceptsVariadicValue,
	buildFlagLookup,
	coerceFlagValue,
	consumesSeparateBoolean,
	flagExpectsValue,
	requestedHelpMode,
	separateFlagValue,
	variadicLongValueCount,
} from '#internals/core/parse/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
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

/** Framework flags that would intercept a suggested, unprotected variadic operand. */
function interceptsCandidate(
	schema: CLISchema,
	token: string,
	configPath: string | undefined,
	topics: CommandSchema['helpTopics'],
): boolean {
	if (!token.startsWith('-') || token === '-') return false;
	if (matchRootToken(token, schema.builtins).kind !== 'unrelated') return true;
	if (
		builtinEnabled(schema.builtins, 'help') &&
		token.startsWith('--help=') &&
		requestedHelpMode([token], topics) !== undefined
	)
		return true;
	if (
		schema.version !== undefined &&
		(token === '--version' || token === `-${schema.versionAlias ?? 'V'}`)
	)
		return true;
	if (
		schema.completionsFlag !== undefined &&
		(token === '--completions' || token.startsWith('--completions='))
	)
		return true;
	return (
		schema.configSettings !== undefined &&
		((schema.configSettings.noConfigFlag === true && token === '--no-config') ||
			(configPath === undefined && token.startsWith('--config=') && token !== '--config='))
	);
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
	let pending: { entry: FlagLookupEntry; accepts: (value: string) => boolean } | undefined;
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
			if (
				builtin ||
				(schema.version !== undefined &&
					(token === '--version' || token === `-${schema.versionAlias ?? 'V'}`))
			)
				continue;
			const match = matchFlag(token, lookup);
			if (match === undefined || (match.entry.negated && match.inline !== undefined))
				return undefined;
			const next = adjacentArgvValue(remaining, index);
			const separate =
				match.inline === undefined &&
				token.startsWith('--') &&
				consumesSeparateBoolean(match.entry, next)
					? next
					: undefined;
			if (activeFlags !== undefined) {
				if (!token.startsWith('--')) {
					for (const ch of token.slice(1)) {
						const entry = lookup.get(ch);
						if (entry === undefined || flagExpectsValue(entry.schema)) break;
						recordActiveFlag(activeFlags, entry, undefined);
					}
				}
				recordActiveFlag(activeFlags, match.entry, match.inline ?? separate);
			}
			if (token.startsWith('--') && match.entry.schema.variadic === true) {
				skip = variadicLongValueCount(remaining, index, lookup, match.inline !== undefined);
				if (
					index + skip === remaining.length - 1 &&
					cursor !== undefined &&
					variadicLongValueCount(remaining, index, lookup, match.inline !== undefined, cursor) >
						skip
				) {
					const first = match.inline === undefined && skip === 0;
					const allowsHyphens = match.entry.schema.allowHyphenValues === true;
					pending = {
						entry: match.entry,
						accepts: (value) =>
							acceptsVariadicValue(value, lookup, first, allowsHyphens) &&
							(allowsHyphens ||
								!interceptsCandidate(schema, value, config?.configPath, command.helpTopics)),
					};
					break;
				}
			} else if (match.inline === undefined) {
				if (separate !== undefined) skip = 1;
				else if (
					flagExpectsValue(match.entry.schema) &&
					separateFlagValue(remaining, index + 1, match.entry.schema, cursor) !== undefined
				) {
					if (index + 1 === remaining.length) {
						pending = {
							entry: match.entry,
							accepts: (value) =>
								separateFlagValue(remaining, index + 1, match.entry.schema, value) !== undefined,
						};
					} else skip = 1;
				}
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
		input = { kind: 'flag', name: pending.entry.name };
		handler = pending.entry.schema.completion;
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
			: completionPosition(schema, compiled, sliceArgvHead(argv, argv.length - 1), argv.at(-1));
	if (position === undefined) return { exitCode: 1, candidates: [] };
	const target = findCompletion(position, argv, env);
	if (target === undefined) {
		const prefix = argv[argv.length - 1] ?? '';
		const blocked = blockedFlagNames(position);
		if (
			mode !== 'all' ||
			position.afterSeparator ||
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
						...(schema.version !== undefined
							? [
									'--version',
									...(schema.versionAlias === undefined ? [] : [`-${schema.versionAlias}`]),
								]
							: []),
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
					value.startsWith(target.context.prefix) &&
					(position.pending?.accepts(value) ?? true),
			)
			.map((value) => (mode === 'value-only' ? value : target.tokenPrefix + value));
		return { exitCode: 0, candidates };
	} catch {
		return {
			exitCode: 0,
			candidates: target.commandCandidates.filter(
				(value) =>
					value.startsWith(target.context.prefix) && (position.pending?.accepts(value) ?? true),
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
	const hasMode =
		request[1] === '--' &&
		['--blocked-flags', '--value-only', '--values'].includes(request[0] ?? '');
	const argv = invocationArgv(
		request.slice(hasMode ? 2 : request[0] === '--' ? 1 : 0),
		compiled,
		schema,
		undefined,
		schema.configSettings !== undefined,
	);
	if (hasMode && request[0] === '--blocked-flags') {
		const position = completionPosition(schema, compiled, argv);
		return {
			exitCode: 0,
			candidates: position === undefined ? [] : [...blockedFlagNames(position)],
		};
	}
	const mode = hasMode && request[0] === '--values' ? 'values' : hasMode ? 'value-only' : 'all';
	return completeValues(schema, compiled, argv, env, mode);
}

export { completeRequest };
