/**
 * Runtime preflight helpers for CLIBuilder.run().
 *
 * Separates adapter-driven sourcing work from planner and executor logic:
 * config discovery, package metadata discovery, invocation-scoped stdin reads,
 * prompt auto-wiring, and runtime-derived schema overrides.
 *
 * @module dreamcli/core/cli/runtime-preflight
 * @internal
 */

import type { FormatLoader } from '#internals/core/config/index.ts';
import { discoverConfig } from '#internals/core/config/index.ts';
import { discoverPackageJson, inferCliName } from '#internals/core/config/package-json.ts';
import { CLIError, ParseError } from '#internals/core/errors/index.ts';
import type { Verbosity } from '#internals/core/output/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import type { PromptEngine } from '#internals/core/prompt/index.ts';
import { createTerminalPrompter } from '#internals/core/prompt/index.ts';
import type { CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';
import type { RuntimeAdapter } from '#internals/runtime/adapter.ts';
import { planInvocation } from './planner.ts';
import type { CLIPlugin } from './plugin.ts';

interface RuntimeConfigSettings {
	readonly appName: string;
	readonly loaders: readonly FormatLoader[] | undefined;
}

interface RuntimePackageJsonSettings {
	readonly inferName: boolean;
}

interface RuntimePreflightSchemaLike {
	readonly name: string;
	readonly inheritName: boolean;
	readonly version: string | undefined;
	readonly description: string | undefined;
	readonly commands: readonly ErasedCommand[];
	readonly defaultCommand: ErasedCommand | undefined;
	readonly configSettings: RuntimeConfigSettings | undefined;
	readonly packageJsonSettings: RuntimePackageJsonSettings | undefined;
	readonly plugins: readonly CLIPlugin[];
}

interface RuntimePreflightOptions {
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly config?: Readonly<Record<string, unknown>>;
	readonly stdinData?: string | null;
	readonly prompter?: PromptEngine;
	readonly verbosity?: Verbosity;
	readonly jsonMode?: boolean;
	readonly isTTY?: boolean;
}

interface RuntimeExecutionInputs {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly isTTY: boolean;
	readonly jsonMode: boolean;
	readonly verbosity: Verbosity;
	readonly stdinData?: string | null;
	readonly prompter?: PromptEngine;
	readonly config?: Readonly<Record<string, unknown>>;
}

interface ReadyRuntimePreflight {
	readonly kind: 'ready';
	readonly schema: RuntimePreflightSchemaLike;
	readonly filteredArgv: readonly string[];
	readonly inputs: RuntimeExecutionInputs;
}

interface RuntimeConfigErrorPreflight {
	readonly kind: 'config-error';
	readonly error: CLIError;
	readonly jsonMode: boolean;
}

type RuntimePreflightResult = ReadyRuntimePreflight | RuntimeConfigErrorPreflight;

interface PrepareRuntimePreflightOptions {
	readonly schema: RuntimePreflightSchemaLike;
	readonly adapter: RuntimeAdapter;
	readonly options: RuntimePreflightOptions | undefined;
	readonly inheritedName: string | undefined;
}

const PRECHECK_OUTPUT = {
	jsonMode: false,
	isTTY: false,
	verbosity: 'normal' as const,
};

function extractConfigFlag(argv: readonly string[]): {
	readonly configPath: string | undefined;
	readonly filteredArgv: readonly string[];
} {
	const eqIdx = argv.findIndex((arg) => arg.startsWith('--config='));
	if (eqIdx !== -1) {
		const value = (argv[eqIdx] as string).slice('--config='.length);
		const filteredArgv = [...argv.slice(0, eqIdx), ...argv.slice(eqIdx + 1)];
		return {
			configPath: value.length > 0 ? value : undefined,
			filteredArgv,
		};
	}

	const idx = argv.indexOf('--config');
	const nextArg = idx >= 0 ? argv[idx + 1] : undefined;
	if (idx === -1 || nextArg === undefined) {
		return { configPath: undefined, filteredArgv: argv };
	}

	return {
		configPath: nextArg,
		filteredArgv: [...argv.slice(0, idx), ...argv.slice(idx + 2)],
	};
}

function commandInvocationNeedsStdin(schema: CommandSchema, argv: readonly string[]): boolean {
	if (argv.includes('--help') || argv.includes('-h')) {
		return false;
	}

	try {
		const parsed = parse(schema, argv);
		return schema.args.some(({ name, schema: argSchema }) => {
			const parsedValue = parsed.args[name];
			return argSchema.stdinMode && (parsedValue === undefined || parsedValue === '-');
		});
	} catch (error: unknown) {
		if (error instanceof ParseError) {
			return false;
		}
		throw error;
	}
}

function invocationNeedsStdin(
	schema: RuntimePreflightSchemaLike,
	argv: readonly string[],
): boolean {
	const plan = planInvocation({
		schema,
		argv,
		help: { binName: schema.name },
		output: PRECHECK_OUTPUT,
	});

	switch (plan.kind) {
		case 'match':
			return commandInvocationNeedsStdin(plan.plan.mergedSchema, plan.plan.argv);
		case 'dispatch-error':
		case 'needs-subcommand':
		case 'root-help':
		case 'root-version':
			return false;
	}
}

function isCompletionsInvocation(
	schema: RuntimePreflightSchemaLike,
	argv: readonly string[],
): boolean {
	const plan = planInvocation({
		schema,
		argv,
		help: { binName: schema.name },
		output: PRECHECK_OUTPUT,
	});

	return plan.kind === 'match' && plan.plan.command.schema.name === 'completions';
}

async function applyPackageJsonDiscovery(
	schema: RuntimePreflightSchemaLike,
	adapter: RuntimeAdapter,
	inheritedName: string | undefined,
	isCompletions: boolean,
): Promise<RuntimePreflightSchemaLike> {
	const packageJsonSettings = schema.packageJsonSettings;
	const packageSchema =
		packageJsonSettings !== undefined && !isCompletions
			? await (async (): Promise<RuntimePreflightSchemaLike> => {
					const pkg = await discoverPackageJson(adapter);
					if (pkg === null) return schema;

					const inferredName = packageJsonSettings.inferName ? inferCliName(pkg) : undefined;
					return {
						...schema,
						...(schema.version === undefined && pkg.version !== undefined
							? { version: pkg.version }
							: {}),
						...(schema.description === undefined && pkg.description !== undefined
							? { description: pkg.description }
							: {}),
						...(inferredName !== undefined ? { name: inferredName } : {}),
					};
				})()
			: schema;

	return inheritedName !== undefined ? { ...packageSchema, name: inheritedName } : packageSchema;
}

async function loadRuntimeConfig(
	schema: RuntimePreflightSchemaLike,
	adapter: RuntimeAdapter,
	configPath: string | undefined,
	isCompletions: boolean,
	existingConfig: Readonly<Record<string, unknown>> | undefined,
): Promise<Readonly<Record<string, unknown>> | CLIError | undefined> {
	if (schema.configSettings === undefined || isCompletions || existingConfig !== undefined) {
		return existingConfig;
	}

	try {
		const result = await discoverConfig(schema.configSettings.appName, adapter, {
			...(configPath !== undefined ? { configPath } : {}),
			...(schema.configSettings.loaders !== undefined
				? { loaders: schema.configSettings.loaders }
				: {}),
		});
		return result.found ? result.data : undefined;
	} catch (error: unknown) {
		if (error instanceof CLIError) {
			return error;
		}
		throw error;
	}
}

async function prepareRuntimePreflight(
	options: PrepareRuntimePreflightOptions,
): Promise<RuntimePreflightResult> {
	const rawArgv = options.adapter.argv.slice(2);
	const { configPath, filteredArgv } = extractConfigFlag(rawArgv);
	const hasJsonFlag = filteredArgv.includes('--json');
	const jsonMode = hasJsonFlag || options.options?.jsonMode === true;
	const isCompletions = isCompletionsInvocation(options.schema, filteredArgv);
	const schema = await applyPackageJsonDiscovery(
		options.schema,
		options.adapter,
		options.inheritedName,
		isCompletions,
	);
	const loadedConfig = await loadRuntimeConfig(
		schema,
		options.adapter,
		configPath,
		isCompletions,
		options.options?.config,
	);

	if (loadedConfig instanceof CLIError) {
		return {
			kind: 'config-error',
			error: loadedConfig,
			jsonMode,
		};
	}

	const autoPrompter =
		options.options?.prompter === undefined && options.adapter.stdinIsTTY
			? createTerminalPrompter(options.adapter.stdin, options.adapter.stderr)
			: undefined;
	const stdinData =
		options.options?.stdinData === undefined && invocationNeedsStdin(schema, filteredArgv)
			? await options.adapter.readStdin()
			: options.options?.stdinData;

	return {
		kind: 'ready',
		schema,
		filteredArgv,
		inputs: {
			env: options.options?.env ?? options.adapter.env,
			isTTY: options.options?.isTTY ?? options.adapter.isTTY,
			jsonMode,
			verbosity: options.options?.verbosity ?? 'normal',
			...(stdinData !== undefined ? { stdinData } : {}),
			...(options.options?.prompter !== undefined
				? { prompter: options.options.prompter }
				: autoPrompter !== undefined
					? { prompter: autoPrompter }
					: {}),
			...(loadedConfig !== undefined ? { config: loadedConfig } : {}),
		},
	};
}

export type {
	PrepareRuntimePreflightOptions,
	ReadyRuntimePreflight,
	RuntimeExecutionInputs,
	RuntimePreflightOptions,
	RuntimePreflightResult,
	RuntimePreflightSchemaLike,
};
export {
	commandInvocationNeedsStdin,
	extractConfigFlag,
	invocationNeedsStdin,
	prepareRuntimePreflight,
};
