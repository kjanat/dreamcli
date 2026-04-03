/**
 * Generated docs metadata consumed by VitePress config and wrapper pages.
 *
 * @module
 */

export const generatedExamples = [
  {
    slug: 'basic',
    title: 'Basic single-command CLI.',
    summary: 'Basic single-command CLI.',
    demonstrates: 'positional args, typed flags, default values, aliases.',
    usage: [
      'npx tsx examples/basic.ts Alice',
      'npx tsx examples/basic.ts Alice --loud --times 3',
      'npx tsx examples/basic.ts Alice -l -t 3',
      'npx tsx examples/basic.ts --help',
    ],
    sourcePath: 'examples/basic.ts',
  },
  {
    slug: 'interactive',
    title: 'Interactive prompts with config file fallback.',
    summary: 'Interactive prompts with config file fallback.',
    demonstrates: 'per-flag .prompt(), command-level .interactive(),',
    usage: [
      'npx tsx examples/interactive.ts                    # prompts for everything',
      'npx tsx examples/interactive.ts --region eu        # skips region prompt',
      'DEPLOY_REGION=ap npx tsx examples/interactive.ts   # env resolves region',
      "echo '{}' | npx tsx examples/interactive.ts        # non-interactive: uses defaults / errors",
    ],
    sourcePath: 'examples/interactive.ts',
  },
  {
    slug: 'json-mode',
    title: 'Mixed machine-readable JSON and human-readable side-channel output.',
    summary: 'Mixed machine-readable JSON and human-readable side-channel output.',
    demonstrates: 'always-on `out.json()` machine output to stdout,',
    usage: [
      'npx tsx examples/json-mode.ts list                  # JSON stdout + plain stderr side channel',
      'npx tsx examples/json-mode.ts list --format table   # JSON stdout + table stderr side channel',
      'npx tsx examples/json-mode.ts list --json           # same success output; CLI-managed errors stay JSON-safe',
      'npx tsx examples/json-mode.ts show web-api',
      'npx tsx examples/json-mode.ts show nonexistent     # structured error',
      'npx tsx examples/json-mode.ts show nonexistent --json  # JSON error',
    ],
    sourcePath: 'examples/json-mode.ts',
  },
  {
    slug: 'middleware',
    title: 'Middleware patterns: auth guard, request timing, error handling.',
    summary: 'Middleware patterns: auth guard, request timing, error handling.',
    demonstrates: 'middleware() with typed context, context accumulation,',
    usage: [
      'npx tsx examples/middleware.ts deploy production',
      'npx tsx examples/middleware.ts deploy production --verbose',
    ],
    sourcePath: 'examples/middleware.ts',
  },
  {
    slug: 'multi-command',
    title: 'Multi-command CLI with nested command groups (git-like).',
    summary: 'Multi-command CLI with nested command groups (git-like).',
    demonstrates: 'cli(), command(), group(), subcommand nesting,',
    usage: [
      'npx tsx examples/multi-command.ts deploy production --force',
      'npx tsx examples/multi-command.ts deploy production --region eu',
      'DEPLOY_REGION=ap npx tsx examples/multi-command.ts deploy production',
      'npx tsx examples/multi-command.ts db migrate --steps 3',
      'npx tsx examples/multi-command.ts db seed',
      'npx tsx examples/multi-command.ts login --token abc123',
      'npx tsx examples/multi-command.ts --help',
      'npx tsx examples/multi-command.ts --version',
    ],
    sourcePath: 'examples/multi-command.ts',
  },
  {
    slug: 'spinner-progress',
    title: 'Spinner and progress bar usage.',
    summary: 'Spinner and progress bar usage.',
    demonstrates: 'out.spinner(), out.progress(), auto-disable in',
    usage: [
      'npx tsx examples/spinner-progress.ts',
      'npx tsx examples/spinner-progress.ts --json     # spinners suppressed, JSON output',
      'echo | npx tsx examples/spinner-progress.ts     # non-TTY: spinners silent',
    ],
    sourcePath: 'examples/spinner-progress.ts',
  },
  {
    slug: 'testing',
    title: 'Testing examples using dreamcli/testkit.',
    summary: 'Testing examples using dreamcli/testkit.',
    demonstrates: 'runCommand(), prompt answers, env/config injection,',
    usage: ['bun test examples/testing.ts'],
    sourcePath: 'examples/testing.ts',
  },
];

export const generatedReferenceSurfaces = [
  {
    id: 'generated-changelog',
    title: 'Generated Changelog Mirror',
    artifactPath: 'docs/.generated/reference/changelog.md',
    sourceInputs: ['CHANGELOG.md'],
    status: 'prepared',
    notes:
      'Foundation mirror only. Public navigation still lands on the authored wrapper until later tasks render the final surface.',
  },
  {
    id: 'generated-docs-health',
    title: 'Generated Docs Health Snapshot',
    artifactPath: 'docs/.generated/reference/docs-health.md',
    sourceInputs: ['docs/**/*.md', 'docs/.generated/**/*'],
    status: 'prepared',
    notes:
      'Current output is factual counts only so later health work can extend the same artifact path.',
  },
  {
    id: 'generated-api-index',
    title: 'Generated API Index',
    artifactPath: 'docs/.generated/api/index.md',
    sourceInputs: ['package.json', 'src/index.ts', 'src/runtime.ts', 'src/testkit.ts'],
    status: 'prepared',
    notes:
      'The generated markdown index is backed by a structured JSON inventory at `docs/.generated/api/public-exports.json` so later TypeDoc normalization can reuse the same public-entrypoint model.',
  },
];

export const generatedPublicApi = [
  {
    subpath: '.',
    entrypoint: 'dreamcli',
    sourcePath: 'src/index.ts',
    symbolCount: 138,
    kindGroups: [
      {
        kind: 'function',
        title: 'Functions',
        symbols: [
          {
            name: 'buildConfigSearchPaths',
            kind: 'function',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'cli',
            kind: 'function',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'command',
            kind: 'function',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'configFormat',
            kind: 'function',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'createArgSchema',
            kind: 'function',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'createOutput',
            kind: 'function',
            sourcePath: 'src/core/output/index.ts',
          },
          {
            name: 'createSchema',
            kind: 'function',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'createTerminalPrompter',
            kind: 'function',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'discoverConfig',
            kind: 'function',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'discoverPackageJson',
            kind: 'function',
            sourcePath: 'src/core/config/package-json.ts',
          },
          {
            name: 'formatHelp',
            kind: 'function',
            sourcePath: 'src/core/help/index.ts',
          },
          {
            name: 'generateBashCompletion',
            kind: 'function',
            sourcePath: 'src/core/completion/shells/bash.ts',
          },
          {
            name: 'generateCompletion',
            kind: 'function',
            sourcePath: 'src/core/completion/index.ts',
          },
          {
            name: 'generateInputSchema',
            kind: 'function',
            sourcePath: 'src/core/json-schema/index.ts',
          },
          {
            name: 'generateSchema',
            kind: 'function',
            sourcePath: 'src/core/json-schema/index.ts',
          },
          {
            name: 'generateZshCompletion',
            kind: 'function',
            sourcePath: 'src/core/completion/shells/zsh.ts',
          },
          {
            name: 'group',
            kind: 'function',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'inferCliName',
            kind: 'function',
            sourcePath: 'src/core/config/package-json.ts',
          },
          {
            name: 'isCLIError',
            kind: 'function',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'isParseError',
            kind: 'function',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'isValidationError',
            kind: 'function',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'middleware',
            kind: 'function',
            sourcePath: 'src/core/schema/middleware.ts',
          },
          {
            name: 'parse',
            kind: 'function',
            sourcePath: 'src/core/parse/index.ts',
          },
          {
            name: 'plugin',
            kind: 'function',
            sourcePath: 'src/core/cli/plugin.ts',
          },
          {
            name: 'resolve',
            kind: 'function',
            sourcePath: 'src/core/resolve/index.ts',
          },
          {
            name: 'resolvePromptConfig',
            kind: 'function',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'tokenize',
            kind: 'function',
            sourcePath: 'src/core/parse/index.ts',
          },
        ],
      },
      {
        kind: 'class',
        title: 'Classes',
        symbols: [
          {
            name: 'ArgBuilder',
            kind: 'class',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'CLIBuilder',
            kind: 'class',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'CLIError',
            kind: 'class',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'CommandBuilder',
            kind: 'class',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'FlagBuilder',
            kind: 'class',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'ParseError',
            kind: 'class',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'ValidationError',
            kind: 'class',
            sourcePath: 'src/core/errors/index.ts',
          },
        ],
      },
      {
        kind: 'constant',
        title: 'Constants',
        symbols: [
          {
            name: 'arg',
            kind: 'constant',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'definitionMetaSchema',
            kind: 'constant',
            sourcePath: 'src/core/json-schema/index.ts',
          },
          {
            name: 'flag',
            kind: 'constant',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'SHELLS',
            kind: 'constant',
            sourcePath: 'src/core/completion/index.ts',
          },
        ],
      },
      {
        kind: 'interface',
        title: 'Interfaces',
        symbols: [
          {
            name: 'ActionParams',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'ArgConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'ArgFactory',
            kind: 'interface',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'ArgSchema',
            kind: 'interface',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'BeforeParseParams',
            kind: 'interface',
            sourcePath: 'src/core/cli/plugin.ts',
          },
          {
            name: 'CLIErrorJSON',
            kind: 'interface',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'CLIErrorOptions',
            kind: 'interface',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'CLIOptions',
            kind: 'interface',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'CLIPlugin',
            kind: 'interface',
            sourcePath: 'src/core/cli/plugin.ts',
          },
          {
            name: 'CLIPluginHooks',
            kind: 'interface',
            sourcePath: 'src/core/cli/plugin.ts',
          },
          {
            name: 'CLIRunOptions',
            kind: 'interface',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'CLISchema',
            kind: 'interface',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'CommandArgEntry',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'CommandConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'CommandExample',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'CommandMeta',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'CommandSchema',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'CompletionOptions',
            kind: 'interface',
            sourcePath: 'src/core/completion/shells/shared.ts',
          },
          {
            name: 'ConfigDiscoveryOptions',
            kind: 'interface',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'ConfigFound',
            kind: 'interface',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'ConfigNotFound',
            kind: 'interface',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'ConfigSettings',
            kind: 'interface',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'ConfirmPromptConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'DeprecationWarning',
            kind: 'interface',
            sourcePath: 'src/core/resolve/contracts.ts',
          },
          {
            name: 'FlagConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'FlagFactory',
            kind: 'interface',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'FlagSchema',
            kind: 'interface',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'FormatLoader',
            kind: 'interface',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'HelpOptions',
            kind: 'interface',
            sourcePath: 'src/core/help/index.ts',
          },
          {
            name: 'InputPromptConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'InteractiveParams',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'JsonSchemaOptions',
            kind: 'interface',
            sourcePath: 'src/core/json-schema/index.ts',
          },
          {
            name: 'MiddlewareParams',
            kind: 'interface',
            sourcePath: 'src/core/schema/middleware.ts',
          },
          {
            name: 'MultiselectPromptConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'Out',
            kind: 'interface',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'OutputOptions',
            kind: 'interface',
            sourcePath: 'src/core/output/index.ts',
          },
          {
            name: 'PackageJsonData',
            kind: 'interface',
            sourcePath: 'src/core/config/package-json.ts',
          },
          {
            name: 'PackageJsonSettings',
            kind: 'interface',
            sourcePath: 'src/core/cli/index.ts',
          },
          {
            name: 'ParseErrorOptions',
            kind: 'interface',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'ParseResult',
            kind: 'interface',
            sourcePath: 'src/core/parse/index.ts',
          },
          {
            name: 'PluginCommandContext',
            kind: 'interface',
            sourcePath: 'src/core/cli/plugin.ts',
          },
          {
            name: 'ProgressHandle',
            kind: 'interface',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'ProgressOptions',
            kind: 'interface',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'PromptConfigBase',
            kind: 'interface',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'PromptEngine',
            kind: 'interface',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'ResolvedCommandParams',
            kind: 'interface',
            sourcePath: 'src/core/cli/plugin.ts',
          },
          {
            name: 'ResolvedMultiselectPromptConfig',
            kind: 'interface',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'ResolvedSelectPromptConfig',
            kind: 'interface',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'ResolveOptions',
            kind: 'interface',
            sourcePath: 'src/core/resolve/contracts.ts',
          },
          {
            name: 'ResolveResult',
            kind: 'interface',
            sourcePath: 'src/core/resolve/contracts.ts',
          },
          {
            name: 'RunResult',
            kind: 'interface',
            sourcePath: 'src/core/schema/run.ts',
          },
          {
            name: 'SelectChoice',
            kind: 'interface',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'SelectPromptConfig',
            kind: 'interface',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'SpinnerHandle',
            kind: 'interface',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'SpinnerOptions',
            kind: 'interface',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'TableColumn',
            kind: 'interface',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'ValidationErrorOptions',
            kind: 'interface',
            sourcePath: 'src/core/errors/index.ts',
          },
        ],
      },
      {
        kind: 'type',
        title: 'Types',
        symbols: [
          {
            name: 'ActionHandler',
            kind: 'type',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'ActivityEvent',
            kind: 'type',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'AnyCommandBuilder',
            kind: 'type',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'ArgKind',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'ArgParseFn',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'ArgPresence',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'ConfigAdapter',
            kind: 'type',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'ConfigDiscoveryResult',
            kind: 'type',
            sourcePath: 'src/core/config/index.ts',
          },
          {
            name: 'DeriveHandler',
            kind: 'type',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'DeriveParams',
            kind: 'type',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'ErrorCode',
            kind: 'type',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'Fallback',
            kind: 'type',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'FlagKind',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'FlagParseFn',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'FlagPresence',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'InferArg',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'InferArgs',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'InferFlag',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'InferFlags',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'InteractiveResolver',
            kind: 'type',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'InteractiveResult',
            kind: 'type',
            sourcePath: 'src/core/schema/command.ts',
          },
          {
            name: 'Middleware',
            kind: 'type',
            sourcePath: 'src/core/schema/middleware.ts',
          },
          {
            name: 'MiddlewareHandler',
            kind: 'type',
            sourcePath: 'src/core/schema/middleware.ts',
          },
          {
            name: 'PackageJsonAdapter',
            kind: 'type',
            sourcePath: 'src/core/config/package-json.ts',
          },
          {
            name: 'ParseErrorCode',
            kind: 'type',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'PromptConfig',
            kind: 'type',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'PromptKind',
            kind: 'type',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'PromptResult',
            kind: 'type',
            sourcePath: 'src/core/schema/prompt.ts',
          },
          {
            name: 'ReadFn',
            kind: 'type',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'ResolvedArgValue',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'ResolvedPromptConfig',
            kind: 'type',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'ResolvedValue',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'Shell',
            kind: 'type',
            sourcePath: 'src/core/completion/index.ts',
          },
          {
            name: 'TableFormat',
            kind: 'type',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'TableOptions',
            kind: 'type',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'TableStream',
            kind: 'type',
            sourcePath: 'src/core/schema/activity.ts',
          },
          {
            name: 'Token',
            kind: 'type',
            sourcePath: 'src/core/parse/index.ts',
          },
          {
            name: 'ValidationErrorCode',
            kind: 'type',
            sourcePath: 'src/core/errors/index.ts',
          },
          {
            name: 'Verbosity',
            kind: 'type',
            sourcePath: 'src/core/output/contracts.ts',
          },
          {
            name: 'WithArgPresence',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'WithPresence',
            kind: 'type',
            sourcePath: 'src/core/schema/flag.ts',
          },
          {
            name: 'WithVariadic',
            kind: 'type',
            sourcePath: 'src/core/schema/arg.ts',
          },
          {
            name: 'WriteFn',
            kind: 'type',
            sourcePath: 'src/core/output/writer.ts',
          },
        ],
      },
    ],
  },
  {
    subpath: './runtime',
    entrypoint: 'dreamcli/runtime',
    sourcePath: 'src/runtime.ts',
    symbolCount: 9,
    kindGroups: [
      {
        kind: 'function',
        title: 'Functions',
        symbols: [
          {
            name: 'createAdapter',
            kind: 'function',
            sourcePath: 'src/runtime/auto.ts',
          },
          {
            name: 'createBunAdapter',
            kind: 'function',
            sourcePath: 'src/runtime/bun.ts',
          },
          {
            name: 'createDenoAdapter',
            kind: 'function',
            sourcePath: 'src/runtime/deno.ts',
          },
          {
            name: 'createNodeAdapter',
            kind: 'function',
            sourcePath: 'src/runtime/node.ts',
          },
          {
            name: 'detectRuntime',
            kind: 'function',
            sourcePath: 'src/runtime/detect.ts',
          },
        ],
      },
      {
        kind: 'class',
        title: 'Classes',
        symbols: [
          {
            name: 'ExitError',
            kind: 'class',
            sourcePath: 'src/runtime/adapter.ts',
          },
        ],
      },
      {
        kind: 'constant',
        title: 'Constants',
        symbols: [
          {
            name: 'RUNTIMES',
            kind: 'constant',
            sourcePath: 'src/runtime/detect.ts',
          },
        ],
      },
      {
        kind: 'interface',
        title: 'Interfaces',
        symbols: [
          {
            name: 'RuntimeAdapter',
            kind: 'interface',
            sourcePath: 'src/runtime/adapter.ts',
          },
        ],
      },
      {
        kind: 'type',
        title: 'Types',
        symbols: [
          {
            name: 'Runtime',
            kind: 'type',
            sourcePath: 'src/runtime/detect.ts',
          },
        ],
      },
    ],
  },
  {
    subpath: './schema',
    entrypoint: 'dreamcli/schema',
    sourcePath: 'dreamcli.schema.json',
    symbolCount: 1,
    kindGroups: [
      {
        kind: 'asset',
        title: 'Assets',
        symbols: [
          {
            name: 'schema',
            kind: 'asset',
            sourcePath: 'dreamcli.schema.json',
          },
        ],
      },
    ],
  },
  {
    subpath: './testkit',
    entrypoint: 'dreamcli/testkit',
    sourcePath: 'src/testkit.ts',
    symbolCount: 11,
    kindGroups: [
      {
        kind: 'function',
        title: 'Functions',
        symbols: [
          {
            name: 'createCaptureOutput',
            kind: 'function',
            sourcePath: 'src/core/output/index.ts',
          },
          {
            name: 'createTestAdapter',
            kind: 'function',
            sourcePath: 'src/runtime/adapter.ts',
          },
          {
            name: 'createTestPrompter',
            kind: 'function',
            sourcePath: 'src/core/prompt/index.ts',
          },
          {
            name: 'runCommand',
            kind: 'function',
            sourcePath: 'src/core/testkit/index.ts',
          },
        ],
      },
      {
        kind: 'constant',
        title: 'Constants',
        symbols: [
          {
            name: 'PROMPT_CANCEL',
            kind: 'constant',
            sourcePath: 'src/core/prompt/index.ts',
          },
        ],
      },
      {
        kind: 'interface',
        title: 'Interfaces',
        symbols: [
          {
            name: 'CapturedOutput',
            kind: 'interface',
            sourcePath: 'src/core/output/index.ts',
          },
          {
            name: 'RunOptions',
            kind: 'interface',
            sourcePath: 'src/core/schema/run.ts',
          },
          {
            name: 'RunResult',
            kind: 'interface',
            sourcePath: 'src/core/schema/run.ts',
          },
          {
            name: 'TestAdapterOptions',
            kind: 'interface',
            sourcePath: 'src/runtime/adapter.ts',
          },
          {
            name: 'TestPrompterOptions',
            kind: 'interface',
            sourcePath: 'src/core/prompt/index.ts',
          },
        ],
      },
      {
        kind: 'type',
        title: 'Types',
        symbols: [
          {
            name: 'TestAnswer',
            kind: 'type',
            sourcePath: 'src/core/prompt/index.ts',
          },
        ],
      },
    ],
  },
];

export const docsHealthSnapshot = {
  authoredPageCount: 33,
  generatedArtifactCount: 5,
  exampleCount: 7,
  publicEntrypointCount: 4,
  publicSymbolCount: 159,
};
