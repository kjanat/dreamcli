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
    routePath: '/examples/basic',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/basic.ts',
    relatedGuides: [
      {
        label: 'Commands guide',
        href: '/guide/commands',
      },
      {
        label: 'Flags guide',
        href: '/guide/flags',
      },
      {
        label: 'Arguments guide',
        href: '/guide/arguments',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`arg`',
        href: '/reference/symbols/main/arg',
      },
      {
        label: '`cli`',
        href: '/reference/symbols/main/cli',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
    ],
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
    routePath: '/examples/interactive',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/interactive.ts',
    relatedGuides: [
      {
        label: 'Interactive Prompts',
        href: '/guide/prompts',
      },
      {
        label: 'Config Files',
        href: '/guide/config',
      },
      {
        label: 'CLI Semantics',
        href: '/guide/semantics',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`arg`',
        href: '/reference/symbols/main/arg',
      },
      {
        label: '`cli`',
        href: '/reference/symbols/main/cli',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
    ],
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
    routePath: '/examples/json-mode',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/json-mode.ts',
    relatedGuides: [
      {
        label: 'Output',
        href: '/guide/output',
      },
      {
        label: 'Errors',
        href: '/guide/errors',
      },
      {
        label: 'CLI Semantics',
        href: '/guide/semantics',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`arg`',
        href: '/reference/symbols/main/arg',
      },
      {
        label: '`cli`',
        href: '/reference/symbols/main/cli',
      },
      {
        label: '`CLIError`',
        href: '/reference/symbols/main/CLIError',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
    ],
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
    routePath: '/examples/middleware',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/middleware.ts',
    relatedGuides: [
      {
        label: 'Middleware',
        href: '/guide/middleware',
      },
      {
        label: 'Testing',
        href: '/guide/testing',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`arg`',
        href: '/reference/symbols/main/arg',
      },
      {
        label: '`cli`',
        href: '/reference/symbols/main/cli',
      },
      {
        label: '`CLIError`',
        href: '/reference/symbols/main/CLIError',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
      {
        label: '`middleware`',
        href: '/reference/symbols/main/middleware',
      },
    ],
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
    routePath: '/examples/multi-command',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/multi-command.ts',
    relatedGuides: [
      {
        label: 'Commands guide',
        href: '/guide/commands',
      },
      {
        label: 'Shell Completions',
        href: '/guide/completions',
      },
      {
        label: 'CLI Semantics',
        href: '/guide/semantics',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`arg`',
        href: '/reference/symbols/main/arg',
      },
      {
        label: '`cli`',
        href: '/reference/symbols/main/cli',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
      {
        label: '`group`',
        href: '/reference/symbols/main/group',
      },
    ],
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
    routePath: '/examples/spinner-progress',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/spinner-progress.ts',
    relatedGuides: [
      {
        label: 'Output',
        href: '/guide/output',
      },
      {
        label: 'Testing',
        href: '/guide/testing',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`cli`',
        href: '/reference/symbols/main/cli',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
    ],
  },
  {
    slug: 'testing',
    title: 'Testing examples using @kjanat/dreamcli/testkit.',
    summary: 'Testing examples using @kjanat/dreamcli/testkit.',
    demonstrates: 'runCommand(), prompt answers, env/config injection,',
    usage: ['bun test examples/testing.ts'],
    sourcePath: 'examples/testing.ts',
    routePath: '/examples/testing',
    sourceUrl: 'https://github.com/kjanat/dreamcli/blob/master/examples/testing.ts',
    relatedGuides: [
      {
        label: 'Testing',
        href: '/guide/testing',
      },
      {
        label: 'Interactive Prompts',
        href: '/guide/prompts',
      },
      {
        label: 'Output',
        href: '/guide/output',
      },
    ],
    relatedLinks: [
      {
        label: 'Examples overview',
        href: '/examples/',
      },
      {
        label: 'API overview',
        href: '/reference/api',
      },
      {
        label: '`arg`',
        href: '/reference/symbols/main/arg',
      },
      {
        label: '`command`',
        href: '/reference/symbols/main/command',
      },
      {
        label: '`createTestPrompter`',
        href: '/reference/symbols/testkit/createTestPrompter',
      },
      {
        label: '`flag`',
        href: '/reference/symbols/main/flag',
      },
      {
        label: '`middleware`',
        href: '/reference/symbols/main/middleware',
      },
      {
        label: '`PROMPT_CANCEL`',
        href: '/reference/symbols/testkit/PROMPT_CANCEL',
      },
      {
        label: '`runCommand`',
        href: '/reference/symbols/testkit/runCommand',
      },
    ],
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
      'Feeds the public `/reference/changelog` page from the repository changelog without reading project-root files at VitePress render time.',
  },
  {
    id: 'generated-docs-health',
    title: 'Generated Docs Health Snapshot',
    artifactPath: 'docs/.generated/reference/docs-health.md',
    sourceInputs: ['docs/**/*.md', 'docs/.generated/**/*'],
    status: 'prepared',
    notes:
      'Feeds the public `/reference/docs-health` page with factual docs-surface counts rebuilt during `bun run docs:prepare`.',
  },
  {
    id: 'generated-api-index',
    title: 'Generated API Index',
    artifactPath: 'docs/.generated/api/index.md',
    sourceInputs: ['package.json', 'src/index.ts', 'src/runtime.ts', 'src/testkit.ts'],
    status: 'prepared',
    notes:
      'The generated markdown index is backed by `docs/.generated/api/public-exports.json`; full signature work now flows through the raw `typedoc.json` artifact and the normalized `typedoc-normalized.json` model beside it.',
  },
  {
    id: 'generated-typedoc-model',
    title: 'Normalized TypeDoc Model',
    artifactPath: 'docs/.generated/api/typedoc-normalized.json',
    sourceInputs: [
      'package.json',
      'tsconfig.json',
      'src/index.ts',
      'src/runtime.ts',
      'src/testkit.ts',
    ],
    status: 'prepared',
    notes:
      'This DreamCLI-owned JSON model is derived from TypeDoc output so later symbol pages and schema-description enrichment do not depend on raw TypeDoc shape.',
  },
  {
    id: 'generated-symbol-pages',
    title: 'Rendered Symbol Pages',
    artifactPath: 'docs/reference/symbols/**/*.md',
    sourceInputs: ['docs/.generated/api/typedoc-normalized.json'],
    status: 'prepared',
    notes: 'Public symbol reference pages rendered from the normalized model. Current count: 158.',
  },
];

export const generatedPublicApi = [
  {
    subpath: '.',
    entrypoint: '@kjanat/dreamcli',
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
    entrypoint: '@kjanat/dreamcli/runtime',
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
    entrypoint: '@kjanat/dreamcli/schema',
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
    entrypoint: '@kjanat/dreamcli/testkit',
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

export const generatedSymbolPages = [
  {
    id: '@kjanat/dreamcli:ActionHandler',
    name: 'ActionHandler',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ActionHandler',
    summary:
      'Action handler function signature.\n\nMay be sync or async — the framework will `await` the return value\nregardless. The `C` parameter carries the accumulated middleware\ncontext type (defaults to empty).',
  },
  {
    id: '@kjanat/dreamcli:ActionParams',
    name: 'ActionParams',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ActionParams',
    summary:
      'The bag of values received by an action handler.\n\n- `args`  — fully resolved positional arguments\n- `flags` — fully resolved flags\n- `ctx`   — derive/middleware-provided context\n- `out`   — output channel\n- `meta`  — CLI program metadata (name, bin, version, command)\n\nThe `C` parameter defaults to `Record<string, never>`, making `ctx`\nproperty access a type error until derive or middleware extends it.',
  },
  {
    id: '@kjanat/dreamcli:ActivityEvent',
    name: 'ActivityEvent',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ActivityEvent',
    summary:
      'Discriminated union of spinner and progress lifecycle events.\n\nCaptured by testkit in RunResult.activity for assertion\nwithout polluting stdout/stderr arrays.',
  },
  {
    id: '@kjanat/dreamcli:AnyCommandBuilder',
    name: 'AnyCommandBuilder',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/AnyCommandBuilder',
    summary:
      "Type-erased CommandBuilder for heterogeneous subcommand storage.\n\nAdvanced helper alias: useful only when working on DreamCLI internals or\ncustom tooling that mirrors the framework's type-erasure boundary.\n\nUses widest possible generic bounds so any `CommandBuilder<F, A, C>` is\nassignable. The CLI layer's `eraseCommand()` traverses these to build\nthe execution tree.",
  },
  {
    id: '@kjanat/dreamcli:arg',
    name: 'arg',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/arg',
    summary:
      'Positional argument schema factory.\n\nEntry point for defining args on a command. Use `arg.<kind>()` to create\nan `ArgBuilder`, then chain modifiers and pass the result to\n`command().arg(name, builder)`.\n\nFour kinds are available:\n- `arg.string()` — raw string (most common)\n- `arg.number()` — parsed to number, errors on NaN\n- `arg.enum(values)` — constrained to listed literals\n- `arg.custom(fn)` — arbitrary parse function, infers return type',
  },
  {
    id: '@kjanat/dreamcli:ArgBuilder',
    name: 'ArgBuilder',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgBuilder',
    summary:
      'Immutable positional argument schema builder.\n\nThe type parameter `C` is a phantom that tracks the value type, presence,\nand variadic state through the fluent chain. Each modifier returns a **new**\nbuilder — the original is never mutated.',
  },
  {
    id: '@kjanat/dreamcli:ArgConfig',
    name: 'ArgConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgConfig',
    summary: 'Compile-time state carried through the builder chain.',
  },
  {
    id: '@kjanat/dreamcli:ArgFactory',
    name: 'ArgFactory',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgFactory',
    summary:
      'Arg factory functions — the public API for creating positional arguments.\n\nEach method returns an `ArgBuilder` seeded with the correct `ArgKind`\nand initial type-level config. Chain modifiers (`.optional()`, `.env()`,\n`.default()`, `.variadic()`, `.stdin()`, `.describe()`, `.deprecated()`) to refine.\n\nAll args are **required** by default. Resolution order when extra\nsources are configured: **CLI → stdin → env → default**.',
  },
  {
    id: '@kjanat/dreamcli:ArgKind',
    name: 'ArgKind',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgKind',
    summary: 'Discriminator for the kind of value an arg accepts.',
  },
  {
    id: '@kjanat/dreamcli:ArgParseFn',
    name: 'ArgParseFn',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgParseFn',
    summary: 'Custom parse function for `arg.custom()`.',
  },
  {
    id: '@kjanat/dreamcli:ArgPresence',
    name: 'ArgPresence',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgPresence',
    summary:
      "Presence describes whether a positional arg is guaranteed to exist when the\naction handler runs:\n\n- `'required'`  — must be supplied; error if missing (default)\n- `'optional'`  — may be `undefined` if not supplied\n- `'defaulted'` — always present (falls back to default value)",
  },
  {
    id: '@kjanat/dreamcli:ArgSchema',
    name: 'ArgSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ArgSchema',
    summary:
      "The runtime descriptor stored inside every `ArgBuilder`. Consumers (parser,\nhelp generator) read this to understand the arg's shape without touching\ngenerics.",
  },
  {
    id: '@kjanat/dreamcli:BeforeParseParams',
    name: 'BeforeParseParams',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/BeforeParseParams',
    summary: 'Payload for `beforeParse`.',
  },
  {
    id: '@kjanat/dreamcli:buildConfigSearchPaths',
    name: 'buildConfigSearchPaths',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/buildConfigSearchPaths',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:cli',
    name: 'cli',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/cli',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:CLIBuilder',
    name: 'CLIBuilder',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIBuilder',
    summary:
      'Immutable CLI program builder.\n\nRegisters commands, handles root-level `--help`/`--version`, and\ndispatches to the matched command based on argv.\n\nTwo execution paths:\n- `.execute(argv, options?)` — testable, returns `RunResult`\n- `.run(options?)` — production entry, reads `process.argv`, exits process',
  },
  {
    id: '@kjanat/dreamcli:CLIError',
    name: 'CLIError',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIError',
    summary:
      'Base structured error for DreamCLI.\n\nEvery error surfaced by the framework extends this class, ensuring a\nconsistent shape for rendering (TTY pretty-print, `--json`, test assertions).',
  },
  {
    id: '@kjanat/dreamcli:CLIErrorJSON',
    name: 'CLIErrorJSON',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIErrorJSON',
    summary: 'Shape returned by `CLIError.toJSON()`.',
  },
  {
    id: '@kjanat/dreamcli:CLIErrorOptions',
    name: 'CLIErrorOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIErrorOptions',
    summary: 'Options accepted by the `CLIError` constructor.',
  },
  {
    id: '@kjanat/dreamcli:CLIOptions',
    name: 'CLIOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIOptions',
    summary:
      'Options for the `cli({...})` factory form.\n\nThis form is useful when the displayed CLI name should be inferred from the\ncurrent runtime invocation instead of always being hard-coded.',
  },
  {
    id: '@kjanat/dreamcli:CLIPlugin',
    name: 'CLIPlugin',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIPlugin',
    summary:
      'Immutable plugin definition registered via `CLIBuilder.plugin()`.\n\nUse plugin to construct values of this shape instead of manually\nassembling the object.',
  },
  {
    id: '@kjanat/dreamcli:CLIPluginHooks',
    name: 'CLIPluginHooks',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIPluginHooks',
    summary:
      'Individual lifecycle hooks that a plugin may implement.\n\nHook order for a successful command run is:\n`beforeParse` → `afterResolve` → `beforeAction` → middleware/action → `afterAction`.\n\nHooks are awaited serially and run in plugin registration order at each\nstage. Throwing from any hook aborts the command just like throwing from\nmiddleware or the action handler. `afterAction` runs only after the\nmiddleware chain and action complete successfully.',
  },
  {
    id: '@kjanat/dreamcli:CLIRunOptions',
    name: 'CLIRunOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLIRunOptions',
    summary:
      'Options for `CLIBuilder.execute()` and `CLIBuilder.run()`.\n\nMirrors `RunOptions` from testkit but adds CLI-level concerns\n(version display, root help formatting, runtime adapter).',
  },
  {
    id: '@kjanat/dreamcli:CLISchema',
    name: 'CLISchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CLISchema',
    summary:
      'Runtime descriptor for the CLI program.\n\nStores the program name, version, description, and registered commands.\nBuilt incrementally by `CLIBuilder`.',
  },
  {
    id: '@kjanat/dreamcli:command',
    name: 'command',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/command',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:CommandArgEntry',
    name: 'CommandArgEntry',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CommandArgEntry',
    summary:
      'A named positional argument entry in the command schema.\n\nPairs a user-facing arg name with its ArgSchema descriptor.\nThe array ordering in CommandSchema.args determines CLI position.',
  },
  {
    id: '@kjanat/dreamcli:CommandBuilder',
    name: 'CommandBuilder',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CommandBuilder',
    summary:
      'Immutable command schema builder.\n\nThe type parameters `F` (flags), `A` (args), and `C` (context) are\nphantom types that accumulate builder types as `.flag()`, `.arg()`,\n`.derive()`, and `.middleware()` are chained. The `.action()` handler receives\nfully typed `ActionParams<F, A, C>`.\n\n`C` defaults to `Record<string, never>`, making `ctx` property\naccess a type error until derive or middleware extends it.',
  },
  {
    id: '@kjanat/dreamcli:CommandConfig',
    name: 'CommandConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CommandConfig',
    summary:
      'Compile-time state carried through the command builder chain.\n\n`F` accumulates named flag builders; `A` accumulates named arg builders.\nBoth start empty (`{}`) and grow as `.flag()` / `.arg()` are called.',
  },
  {
    id: '@kjanat/dreamcli:CommandExample',
    name: 'CommandExample',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CommandExample',
    summary: 'A single usage example shown in help text.',
  },
  {
    id: '@kjanat/dreamcli:CommandMeta',
    name: 'CommandMeta',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CommandMeta',
    summary:
      "Runtime metadata about the CLI program and current command execution.\n\nAvailable to action handlers and middleware.\n\nPopulated by the CLI dispatch layer from CLISchema and\nCommandSchema. For standalone `runCommand()` calls without\na CLI wrapper, a minimal meta is constructed from the command's own schema.",
  },
  {
    id: '@kjanat/dreamcli:CommandSchema',
    name: 'CommandSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CommandSchema',
    summary:
      "Runtime descriptor produced by CommandBuilder.\n\nConsumers (parser, help generator, CLI dispatcher) read this to\nunderstand the command's shape — flags, args, aliases, subcommands,\nmiddleware, and interactive resolver.",
  },
  {
    id: '@kjanat/dreamcli:CompletionOptions',
    name: 'CompletionOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/CompletionOptions',
    summary:
      'Options for completion script generation.\n\nPassed to individual shell generators alongside the CLI schema.\n\nThese options affect the generated script text, not runtime completion\nbehavior after installation.',
  },
  {
    id: '@kjanat/dreamcli:ConfigAdapter',
    name: 'ConfigAdapter',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfigAdapter',
    summary:
      'The subset of RuntimeAdapter needed for config discovery.\n\nExported so custom hosts and tests can type the minimal adapter required by\ndiscoverConfig without depending on the full runtime adapter shape.',
  },
  {
    id: '@kjanat/dreamcli:ConfigDiscoveryOptions',
    name: 'ConfigDiscoveryOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfigDiscoveryOptions',
    summary: 'Options for discoverConfig.',
  },
  {
    id: '@kjanat/dreamcli:ConfigDiscoveryResult',
    name: 'ConfigDiscoveryResult',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfigDiscoveryResult',
    summary: 'Discriminated result of config discovery.',
  },
  {
    id: '@kjanat/dreamcli:configFormat',
    name: 'configFormat',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/configFormat',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:ConfigFound',
    name: 'ConfigFound',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfigFound',
    summary: 'Successful config discovery — file found and parsed.',
  },
  {
    id: '@kjanat/dreamcli:ConfigNotFound',
    name: 'ConfigNotFound',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfigNotFound',
    summary: 'No config file found at any candidate path (not an error).',
  },
  {
    id: '@kjanat/dreamcli:ConfigSettings',
    name: 'ConfigSettings',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfigSettings',
    summary:
      'Config discovery settings for automatic config file loading.\n\nStored in CLISchema and consumed by `CLIBuilder.run()` to\ncall discoverConfig before dispatching to a command.',
  },
  {
    id: '@kjanat/dreamcli:ConfirmPromptConfig',
    name: 'ConfirmPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ConfirmPromptConfig',
    summary: 'Yes/no confirmation prompt — maps to `boolean` flags. Part of PromptConfig.',
  },
  {
    id: '@kjanat/dreamcli:createArgSchema',
    name: 'createArgSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/createArgSchema',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:createOutput',
    name: 'createOutput',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/createOutput',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:createSchema',
    name: 'createSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/createSchema',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:createTerminalPrompter',
    name: 'createTerminalPrompter',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/createTerminalPrompter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:definitionMetaSchema',
    name: 'definitionMetaSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/definitionMetaSchema',
    summary:
      'JSON Schema (draft 2020-12) that validates the output of generateSchema.\n\nEach `$defs` entry is defined once as a schema DSL string — the DSL\nparser produces a runtime AST, and nodeToJsonSchema converts\nthat AST to a JSON Schema fragment. No probe fixtures, no override\nmaps, no manually maintained type definitions.\n\nHosted at DEFINITION_SCHEMA_URL for `$schema` resolution. Also\nexported so tooling can validate definition documents without a network\nround-trip.',
  },
  {
    id: '@kjanat/dreamcli:DeprecationWarning',
    name: 'DeprecationWarning',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/DeprecationWarning',
    summary: 'Structured deprecation notice emitted for explicitly sourced values.',
  },
  {
    id: '@kjanat/dreamcli:DeriveHandler',
    name: 'DeriveHandler',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/DeriveHandler',
    summary:
      'Command-scoped typed pre-action handler.\n\nDerive handlers may:\n- validate resolved input and throw `CLIError`\n- return `undefined` to continue without changing context\n- return an object whose properties merge into `ctx` downstream\n\nThey cannot wrap downstream execution; use `middleware()` for that.',
  },
  {
    id: '@kjanat/dreamcli:DeriveParams',
    name: 'DeriveParams',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/DeriveParams',
    summary:
      'The bag of values received by a derive handler.\n\nIdentical to ActionParams: derives run after full resolution and\nbefore the action handler, with typed args/flags/current context plus `out`\nand `meta`.',
  },
  {
    id: '@kjanat/dreamcli:discoverConfig',
    name: 'discoverConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/discoverConfig',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:discoverPackageJson',
    name: 'discoverPackageJson',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/discoverPackageJson',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:ErrorCode',
    name: 'ErrorCode',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ErrorCode',
    summary: 'Any framework error code (extensible via `string & {}`).',
  },
  {
    id: '@kjanat/dreamcli:Fallback',
    name: 'Fallback',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/Fallback',
    summary:
      "Non-TTY fallback strategy for spinners and progress bars.\n\n- `'silent'` — no output at all (default). Ideal for CI where decorative\n  output is noise.\n- `'static'` — emit plain text via `out.log()` / `out.error()` at\n  lifecycle boundaries (start, succeed, fail). No animation.",
  },
  {
    id: '@kjanat/dreamcli:flag',
    name: 'flag',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/flag',
    summary:
      'Flag schema factory. Call `flag.<kind>()` to create an immutable\nFlagBuilder with full type inference and safe modifier chaining.',
  },
  {
    id: '@kjanat/dreamcli:FlagBuilder',
    name: 'FlagBuilder',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagBuilder',
    summary:
      'Immutable flag schema builder.\n\nThe type parameter `C` is a phantom that tracks the value type and presence\nthrough the fluent chain. Each modifier returns a **new** builder — the\noriginal is never mutated.',
  },
  {
    id: '@kjanat/dreamcli:FlagConfig',
    name: 'FlagConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagConfig',
    summary:
      'Compile-time state carried through the builder chain.\n\nAdding new tracked properties only requires extending this interface — no\nbuilder signature changes.',
  },
  {
    id: '@kjanat/dreamcli:FlagFactory',
    name: 'FlagFactory',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagFactory',
    summary:
      'Factory that creates FlagBuilder instances seeded with the correct\nFlagKind and initial type-level config.',
  },
  {
    id: '@kjanat/dreamcli:FlagKind',
    name: 'FlagKind',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagKind',
    summary: 'Discriminator for the kind of value a flag accepts.',
  },
  {
    id: '@kjanat/dreamcli:FlagParseFn',
    name: 'FlagParseFn',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagParseFn',
    summary:
      'Custom parse function for `flag.custom()`.\n\nReceives `string` from CLI argv and env vars, or any JSON-representable\nvalue from config files. Narrow inside the function as needed.',
  },
  {
    id: '@kjanat/dreamcli:FlagPresence',
    name: 'FlagPresence',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagPresence',
    summary:
      "Presence describes whether a flag value is guaranteed to exist when the\naction handler runs:\n\n- `'optional'`  — not required; unresolved value follows the kind-specific\n  optional fallback (`undefined` for most flags, `[]` for arrays)\n- `'required'`  — must be supplied; error if missing\n- `'defaulted'` — always present (falls back to default value)",
  },
  {
    id: '@kjanat/dreamcli:FlagSchema',
    name: 'FlagSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FlagSchema',
    summary:
      "The runtime descriptor stored inside every `FlagBuilder`. Consumers (parser,\nhelp generator, resolution chain) read this to understand the flag's shape\nwithout touching generics.",
  },
  {
    id: '@kjanat/dreamcli:formatHelp',
    name: 'formatHelp',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/formatHelp',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:FormatLoader',
    name: 'FormatLoader',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/FormatLoader',
    summary:
      'Format loader — parses file content into a config object.\n\nRegister custom config formats by providing file extensions and a parser.\nParsers may return any parsed value; discoverConfig validates that\nthe result is a plain object before feeding it into the resolution chain.\n\nImplementations should throw on syntax or shape errors; the caller wraps\nthose failures as CLIError with code `CONFIG_PARSE_ERROR`.',
  },
  {
    id: '@kjanat/dreamcli:generateBashCompletion',
    name: 'generateBashCompletion',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/generateBashCompletion',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:generateCompletion',
    name: 'generateCompletion',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/generateCompletion',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:generateInputSchema',
    name: 'generateInputSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/generateInputSchema',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:generateSchema',
    name: 'generateSchema',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/generateSchema',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:generateZshCompletion',
    name: 'generateZshCompletion',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/generateZshCompletion',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:group',
    name: 'group',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/group',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:HelpOptions',
    name: 'HelpOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/HelpOptions',
    summary: 'Options for customising help output.',
  },
  {
    id: '@kjanat/dreamcli:InferArg',
    name: 'InferArg',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InferArg',
    summary: 'Extract the resolved value type from an `ArgBuilder`.',
  },
  {
    id: '@kjanat/dreamcli:InferArgs',
    name: 'InferArgs',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InferArgs',
    summary: 'Extract resolved value types from a record of builders.',
  },
  {
    id: '@kjanat/dreamcli:inferCliName',
    name: 'inferCliName',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/inferCliName',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:InferFlag',
    name: 'InferFlag',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InferFlag',
    summary: 'Extract the resolved value type from a `FlagBuilder`.',
  },
  {
    id: '@kjanat/dreamcli:InferFlags',
    name: 'InferFlags',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InferFlags',
    summary: 'Extract resolved value types from a record of builders.',
  },
  {
    id: '@kjanat/dreamcli:InputPromptConfig',
    name: 'InputPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InputPromptConfig',
    summary: 'Free-text input prompt — maps to `string` and `number` flags. Part of PromptConfig.',
  },
  {
    id: '@kjanat/dreamcli:InteractiveParams',
    name: 'InteractiveParams',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InteractiveParams',
    summary:
      'Parameters received by the interactive resolver function.\n\n`flags` contains partially resolved values — present for flags resolved\nvia CLI, env, or config, `undefined` for unresolved flags. The resolver\nuses this to decide which prompts to show based on current state.',
  },
  {
    id: '@kjanat/dreamcli:InteractiveResolver',
    name: 'InteractiveResolver',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InteractiveResolver',
    summary:
      'Interactive resolver function for command-level prompt control.\n\nCalled after CLI/env/config resolution but before per-flag prompts fire.\nReceives partially resolved values and returns a prompt schema for\nflags that should be prompted. Commands without `.interactive()` use\nper-flag prompt configs directly.',
  },
  {
    id: '@kjanat/dreamcli:InteractiveResult',
    name: 'InteractiveResult',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/InteractiveResult',
    summary:
      "A record mapping flag names to prompt configs or falsy values.\n\n- `PromptConfig` — show this prompt for the flag\n- `false | undefined | null | 0 | ''` — skip prompting for this flag\n\nOnly flag names that need prompting should have truthy values.\nFlags not mentioned are handled by their per-flag `.prompt()` config.",
  },
  {
    id: '@kjanat/dreamcli:isCLIError',
    name: 'isCLIError',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/isCLIError',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:isParseError',
    name: 'isParseError',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/isParseError',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:isValidationError',
    name: 'isValidationError',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/isValidationError',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:JsonSchemaOptions',
    name: 'JsonSchemaOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/JsonSchemaOptions',
    summary:
      'Options for JSON Schema generation.\n\nBoth generateSchema and generateInputSchema accept these\noptions to control which parts of the CLI schema are included in the output.',
  },
  {
    id: '@kjanat/dreamcli:middleware',
    name: 'middleware',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/middleware',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:Middleware',
    name: 'Middleware',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/middleware-type',
    summary:
      'Middleware with phantom output type.\n\nThe `Output` parameter tracks what this middleware adds to context at\ncompile time. The `_output` brand is phantom — it exists only in the\ntype system for inference, not at runtime.\n\nCreated via the `middleware()` factory. Attached to commands via\n`CommandBuilder.middleware()`.',
  },
  {
    id: '@kjanat/dreamcli:MiddlewareHandler',
    name: 'MiddlewareHandler',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/MiddlewareHandler',
    summary:
      'Middleware handler function with typed `next()` parameter.\n\nThe `Output` generic constrains what properties must be passed to\n`next()`, ensuring type-safe context additions at the call site.',
  },
  {
    id: '@kjanat/dreamcli:MiddlewareParams',
    name: 'MiddlewareParams',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/MiddlewareParams',
    summary:
      "Parameters received by a middleware function at runtime.\n\nMiddleware receives erased args/flags (since it's defined independently\nof commands) plus the accumulated context from prior middleware and a\n`next` function to continue the chain.",
  },
  {
    id: '@kjanat/dreamcli:MultiselectPromptConfig',
    name: 'MultiselectPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/MultiselectPromptConfig',
    summary:
      'Multi-selection prompt — maps to `array` flags.\nReturns an array of selected SelectChoice values. Part of PromptConfig.',
  },
  {
    id: '@kjanat/dreamcli:Out',
    name: 'Out',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/Out',
    summary:
      'Output channel available inside action handlers.\n\nProvides structured methods for stdout/stderr, JSON output,\nspinners, progress bars, and tables. The real implementation lives in\n`src/core/output/`; this interface defines the shape that handlers consume.',
  },
  {
    id: '@kjanat/dreamcli:OutputOptions',
    name: 'OutputOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/OutputOptions',
    summary:
      'Configuration for creating an output channel.\n\nEvery field is optional — sensible defaults are applied when omitted.',
  },
  {
    id: '@kjanat/dreamcli:PackageJsonAdapter',
    name: 'PackageJsonAdapter',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PackageJsonAdapter',
    summary:
      'The subset of RuntimeAdapter needed for package.json discovery.\n\nUsing a narrow pick keeps the function easy to test and makes the\ndependency explicit.',
  },
  {
    id: '@kjanat/dreamcli:PackageJsonData',
    name: 'PackageJsonData',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PackageJsonData',
    summary:
      'Subset of package.json fields relevant to CLI metadata.\n\nAll fields are optional — a valid package.json may omit any of them.',
  },
  {
    id: '@kjanat/dreamcli:PackageJsonSettings',
    name: 'PackageJsonSettings',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PackageJsonSettings',
    summary:
      'Package.json auto-discovery settings.\n\nStored in CLISchema and consumed by `CLIBuilder.run()` to\ncall discoverPackageJson before dispatching to a command.',
  },
  {
    id: '@kjanat/dreamcli:parse',
    name: 'parse',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/parse',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:ParseError',
    name: 'ParseError',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ParseError',
    summary:
      'Error thrown when argv tokenization / parsing fails.\n\nExit code defaults to `2` (standard for CLI usage errors).',
  },
  {
    id: '@kjanat/dreamcli:ParseErrorCode',
    name: 'ParseErrorCode',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ParseErrorCode',
    summary: 'Codes emitted during argv parsing.',
  },
  {
    id: '@kjanat/dreamcli:ParseErrorOptions',
    name: 'ParseErrorOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ParseErrorOptions',
    summary: 'Options for `ParseError`. Code is narrowed to parse-specific codes.',
  },
  {
    id: '@kjanat/dreamcli:ParseResult',
    name: 'ParseResult',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ParseResult',
    summary:
      'Raw parsed values before resolution (defaults, env, config, etc.).\n\nFlag values are `unknown` because type coercion happens here but the\ngeneric type info lives in the schema builders, not at runtime.',
  },
  {
    id: '@kjanat/dreamcli:plugin',
    name: 'plugin',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/plugin',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:PluginCommandContext',
    name: 'PluginCommandContext',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PluginCommandContext',
    summary: 'Shared hook payload for a concrete command execution.',
  },
  {
    id: '@kjanat/dreamcli:ProgressHandle',
    name: 'ProgressHandle',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ProgressHandle',
    summary:
      'Handle returned by Out.progress for lifecycle control.\n\nTerminal methods (`done`, `fail`) are idempotent — calling any\nof them after the handle is already stopped is a no-op.',
  },
  {
    id: '@kjanat/dreamcli:ProgressOptions',
    name: 'ProgressOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ProgressOptions',
    summary: 'Options for Out.progress.',
  },
  {
    id: '@kjanat/dreamcli:PromptConfig',
    name: 'PromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PromptConfig',
    summary:
      "Discriminated union of all prompt configurations.\n\nUse the `kind` field to narrow:\n```ts\nif (config.kind === 'select') {\n  config.choices // readonly SelectChoice[] | undefined\n}\n```",
  },
  {
    id: '@kjanat/dreamcli:PromptConfigBase',
    name: 'PromptConfigBase',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PromptConfigBase',
    summary: 'Shared fields across all prompt kinds.',
  },
  {
    id: '@kjanat/dreamcli:PromptEngine',
    name: 'PromptEngine',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PromptEngine',
    summary:
      'Prompt engine interface.\n\nImplementations render a single prompt to the user and return the\nresult. The engine is stateless per call — each `promptOne` is\nindependent.\n\nThe resolution chain calls `promptOne` for each flag that needs\ninteractive input. Engines do not need schema knowledge — all\nrelevant context (message, choices, validation) is in the config.',
  },
  {
    id: '@kjanat/dreamcli:PromptKind',
    name: 'PromptKind',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PromptKind',
    summary:
      "The kind of interactive prompt to present.\n\n- `'confirm'`     — yes/no boolean question\n- `'input'`       — free-text string input\n- `'select'`      — single selection from a list\n- `'multiselect'` — multiple selections from a list",
  },
  {
    id: '@kjanat/dreamcli:PromptResult',
    name: 'PromptResult',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/PromptResult',
    summary:
      "The raw result returned by a prompt engine for a single prompt.\n\n- `answered: true`  — user provided a value\n- `answered: false` — user cancelled/aborted (Ctrl+C, ESC, etc.)\n\nCoercion to the flag's kind is the resolver's responsibility, not the\nprompt engine's.",
  },
  {
    id: '@kjanat/dreamcli:ReadFn',
    name: 'ReadFn',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ReadFn',
    summary:
      "A function that reads a single line of user input.\n\nReturns `null` on EOF (Ctrl+D on Unix, Ctrl+Z on Windows),\nindicating the user closed the input stream (treated as cancel).\n\nThe terminal prompter uses this as its sole input seam. The\nresolution chain (prompt-adapter-1) will wire this to the\nruntime adapter's stdin.",
  },
  {
    id: '@kjanat/dreamcli:resolve',
    name: 'resolve',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/resolve',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:ResolvedArgValue',
    name: 'ResolvedArgValue',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolvedArgValue',
    summary:
      "Compute the final value type from config — this is what handlers receive.\n\nAdvanced type helper: this powers InferArg and action-handler\ninference. Most apps do not need to mention it explicitly.\n\nVariadic args always produce an array. Non-variadic:\n- `'optional'`  → `T | undefined`\n- `'required'`  → `T`\n- `'defaulted'` → `T`",
  },
  {
    id: '@kjanat/dreamcli:ResolvedCommandParams',
    name: 'ResolvedCommandParams',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolvedCommandParams',
    summary: 'Payload for hooks that observe resolved inputs.',
  },
  {
    id: '@kjanat/dreamcli:ResolvedMultiselectPromptConfig',
    name: 'ResolvedMultiselectPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolvedMultiselectPromptConfig',
    summary:
      'A multiselect prompt config with choices guaranteed non-empty.\n\nSame guarantee as `ResolvedSelectPromptConfig` — choices are always\npresent and non-empty.',
  },
  {
    id: '@kjanat/dreamcli:ResolvedPromptConfig',
    name: 'ResolvedPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolvedPromptConfig',
    summary:
      'Prompt config variant where select/multiselect choices are guaranteed\npresent. The prompt engine receives this (not raw `PromptConfig`),\nso it never needs to merge enum values from `FlagSchema`.\n\nconfirm and input configs pass through unchanged.',
  },
  {
    id: '@kjanat/dreamcli:ResolvedSelectPromptConfig',
    name: 'ResolvedSelectPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolvedSelectPromptConfig',
    summary:
      "A select prompt config with choices guaranteed non-empty.\n\nThe resolution chain populates choices from `FlagSchema.enumValues`\nwhen the user's `PromptConfig` omits them.",
  },
  {
    id: '@kjanat/dreamcli:ResolvedValue',
    name: 'ResolvedValue',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolvedValue',
    summary:
      "Compute the final value type from config — this is what handlers receive.\n\nAdvanced type helper: this powers InferFlag and action-handler\ninference. Most apps do not need to mention it explicitly.\n\n- `'optional'` + `'undefined'` fallback  → `T | undefined`\n- `'optional'` + `'empty-array'` fallback → `T`\n- `'required'`   → `T`\n- `'defaulted'`  → `T`",
  },
  {
    id: '@kjanat/dreamcli:ResolveOptions',
    name: 'ResolveOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolveOptions',
    summary:
      'External state the resolver may consult after parsing.\n\nThe resolver never reaches into `process`, files, or terminal APIs directly;\ncallers inject those facts through this contract.',
  },
  {
    id: '@kjanat/dreamcli:resolvePromptConfig',
    name: 'resolvePromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/resolvePromptConfig',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:ResolveResult',
    name: 'ResolveResult',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ResolveResult',
    summary: 'Fully resolved command input handed to the executor layer.',
  },
  {
    id: '@kjanat/dreamcli:RunResult',
    name: 'RunResult',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/RunResult',
    summary:
      'Structured result from running a command.\n\nContains the exit code, captured stdout/stderr output, and an `error`\nfield that is `undefined` on success and populated on failure.',
  },
  {
    id: '@kjanat/dreamcli:SelectChoice',
    name: 'SelectChoice',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/SelectChoice',
    summary: 'A selectable option for SelectPromptConfig and MultiselectPromptConfig prompts.',
  },
  {
    id: '@kjanat/dreamcli:SelectPromptConfig',
    name: 'SelectPromptConfig',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/SelectPromptConfig',
    summary:
      'Single-selection prompt — maps to `enum` flags or any flag with choices. Part of PromptConfig.',
  },
  {
    id: '@kjanat/dreamcli:Shell',
    name: 'Shell',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/Shell',
    summary:
      'Supported shell targets for completion script generation.\n\n`bash`, `zsh`, `fish`, and `powershell` are implemented today.',
  },
  {
    id: '@kjanat/dreamcli:SHELLS',
    name: 'SHELLS',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/SHELLS',
    summary:
      'Implemented shell values as a frozen readonly non-empty tuple.\n\nUse this tuple for user-facing validation and shell selection UIs.\nIt intentionally matches the shipped Shell union exactly so docs,\nhelp output, and completion generation advertise the same support surface.',
  },
  {
    id: '@kjanat/dreamcli:SpinnerHandle',
    name: 'SpinnerHandle',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/SpinnerHandle',
    summary:
      'Handle returned by Out.spinner for lifecycle control.\n\nTerminal methods (`succeed`, `fail`, `stop`) are idempotent — calling any\nof them after the handle is already stopped is a no-op, not an error.',
  },
  {
    id: '@kjanat/dreamcli:SpinnerOptions',
    name: 'SpinnerOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/SpinnerOptions',
    summary: 'Options for Out.spinner.',
  },
  {
    id: '@kjanat/dreamcli:TableColumn',
    name: 'TableColumn',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/TableColumn',
    summary: 'Describes a single column in table output.',
  },
  {
    id: '@kjanat/dreamcli:TableFormat',
    name: 'TableFormat',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/TableFormat',
    summary: 'Render format override for Out.table.',
  },
  {
    id: '@kjanat/dreamcli:TableOptions',
    name: 'TableOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/TableOptions',
    summary: 'Per-call rendering options for Out.table.',
  },
  {
    id: '@kjanat/dreamcli:TableStream',
    name: 'TableStream',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/TableStream',
    summary: 'Output stream override for text table rendering.',
  },
  {
    id: '@kjanat/dreamcli:Token',
    name: 'Token',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/Token',
    summary:
      'Token discriminated union.\n\nThe tokenizer produces these from raw argv strings. The parser then\ninterprets them against a command schema.',
  },
  {
    id: '@kjanat/dreamcli:tokenize',
    name: 'tokenize',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/tokenize',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli:ValidationError',
    name: 'ValidationError',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ValidationError',
    summary:
      'Error thrown when resolved values fail validation constraints.\n\nExit code defaults to `2` (standard for CLI usage errors).',
  },
  {
    id: '@kjanat/dreamcli:ValidationErrorCode',
    name: 'ValidationErrorCode',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ValidationErrorCode',
    summary: 'Codes emitted during post-parse validation / resolution.',
  },
  {
    id: '@kjanat/dreamcli:ValidationErrorOptions',
    name: 'ValidationErrorOptions',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/ValidationErrorOptions',
    summary: 'Options for `ValidationError`. Code is narrowed to validation-specific codes.',
  },
  {
    id: '@kjanat/dreamcli:Verbosity',
    name: 'Verbosity',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/Verbosity',
    summary: 'Stable text verbosity labels.',
  },
  {
    id: '@kjanat/dreamcli:WithArgPresence',
    name: 'WithArgPresence',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/WithArgPresence',
    summary:
      'Advanced type helper used by `ArgBuilder` modifiers to replace presence.\nMost consumers rely on inference and never reference this directly.',
  },
  {
    id: '@kjanat/dreamcli:WithPresence',
    name: 'WithPresence',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/WithPresence',
    summary:
      'Advanced type helper used by `FlagBuilder` modifiers to replace presence.\nMost consumers rely on inference and never reference this directly.',
  },
  {
    id: '@kjanat/dreamcli:WithVariadic',
    name: 'WithVariadic',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/WithVariadic',
    summary:
      'Advanced type helper used by `ArgBuilder.variadic()`.\nMost consumers rely on inference and never reference this directly.',
  },
  {
    id: '@kjanat/dreamcli:WriteFn',
    name: 'WriteFn',
    entrypoint: '@kjanat/dreamcli',
    routePath: '/reference/symbols/main/WriteFn',
    summary:
      'A function that writes a string somewhere.\n\nThis is the only write primitive the output layer depends on.\nIn production it usually wraps `process.stdout.write` or\n`process.stderr.write`; in tests it is often a simple string accumulator.\n\nThe contract is intentionally tiny:\n- writes are synchronous fire-and-forget\n- callers decide whether to append a trailing newline\n- there is no backpressure or flush signal',
  },
  {
    id: '@kjanat/dreamcli/runtime:createAdapter',
    name: 'createAdapter',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/createAdapter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/runtime:createBunAdapter',
    name: 'createBunAdapter',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/createBunAdapter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/runtime:createDenoAdapter',
    name: 'createDenoAdapter',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/createDenoAdapter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/runtime:createNodeAdapter',
    name: 'createNodeAdapter',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/createNodeAdapter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/runtime:detectRuntime',
    name: 'detectRuntime',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/detectRuntime',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/runtime:ExitError',
    name: 'ExitError',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/ExitError',
    summary:
      'Error thrown by the default test adapter exit function.\n\nIn tests, `process.exit` would kill the test runner. Instead, the test\nadapter throws this error, allowing tests to assert on exit codes:\n\n```ts\ntry {\n  await cli.run({ adapter: createTestAdapter() });\n} catch (e) {\n  if (e instanceof ExitError) expect(e.code).toBe(0);\n}\n```',
  },
  {
    id: '@kjanat/dreamcli/runtime:Runtime',
    name: 'Runtime',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/Runtime',
    summary:
      "Known JavaScript runtime environments.\n\n- `'node'` — Node.js\n- `'bun'` — Bun\n- `'deno'` — Deno\n- `'unknown'` — Unrecognized environment",
  },
  {
    id: '@kjanat/dreamcli/runtime:RuntimeAdapter',
    name: 'RuntimeAdapter',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/RuntimeAdapter',
    summary:
      'Runtime adapter interface.\n\nDefines the minimal contract between the platform-agnostic core and\nthe host runtime (Node.js, Bun, Deno). Every platform-dependent\noperation flows through this interface — the core never calls\n`process.*`, `Deno.*`, or `Bun.*` directly.\n\nAdapters are designed to be:\n- **Immutable in shape:** all properties are readonly\n- **Minimal:** only the operations the framework actually needs\n- **Testable:** easily stubbed in tests via `createTestAdapter()`',
  },
  {
    id: '@kjanat/dreamcli/runtime:RUNTIMES',
    name: 'RUNTIMES',
    entrypoint: '@kjanat/dreamcli/runtime',
    routePath: '/reference/symbols/runtime/RUNTIMES',
    summary:
      'All known runtime values as a readonly tuple.\n\nUseful for validation, iteration, and exhaustiveness checks.',
  },
  {
    id: '@kjanat/dreamcli/testkit:CapturedOutput',
    name: 'CapturedOutput',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/CapturedOutput',
    summary: 'Captured output from a `createCaptureOutput` instance.',
  },
  {
    id: '@kjanat/dreamcli/testkit:createCaptureOutput',
    name: 'createCaptureOutput',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/createCaptureOutput',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/testkit:createTestAdapter',
    name: 'createTestAdapter',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/createTestAdapter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/testkit:createTestPrompter',
    name: 'createTestPrompter',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/createTestPrompter',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/testkit:PROMPT_CANCEL',
    name: 'PROMPT_CANCEL',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/PROMPT_CANCEL',
    summary:
      "Sentinel value representing a cancelled/aborted prompt in the test\nprompter's answer queue.\n\nUses `Symbol.for()` for cross-bundle safety — the same symbol is\nreturned regardless of which copy of the module is loaded.",
  },
  {
    id: '@kjanat/dreamcli/testkit:runCommand',
    name: 'runCommand',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/runCommand',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/testkit:RunOptions',
    name: 'RunOptions',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/RunOptions',
    summary:
      'Options accepted by `runCommand()` and internal command execution paths.\n\nEvery field is optional — sensible defaults are applied. This is the\nprimary process-free execution seam: inject env, config, prompt I/O, and\ndispatch-layer metadata without touching process state.',
  },
  {
    id: '@kjanat/dreamcli/testkit:RunResult',
    name: 'RunResult',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/RunResult',
    summary: null,
  },
  {
    id: '@kjanat/dreamcli/testkit:TestAdapterOptions',
    name: 'TestAdapterOptions',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/TestAdapterOptions',
    summary:
      'Options for creating a test adapter.\n\nAll fields are optional — sensible defaults are applied for testing\nscenarios (empty argv, empty env, noop stdout/stderr, non-TTY, exit\nthrows instead of killing the process).',
  },
  {
    id: '@kjanat/dreamcli/testkit:TestAnswer',
    name: 'TestAnswer',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/TestAnswer',
    summary:
      'A queued answer consumed by createTestPrompter.\n\nThe test prompter returns these values exactly as provided; it does not\ncoerce or validate them. The normal resolution pipeline performs any later\ntype coercion, so tests can supply values in the same shapes real prompts\nwould yield:\n\n- `string` for `input` and `select`\n- `boolean` for `confirm`\n- `string[]` for `multiselect`\n- PROMPT_CANCEL to simulate user cancellation\n\nBecause the type is intentionally `unknown`, tests may also inject malformed\nanswers to exercise downstream validation and error reporting.',
  },
  {
    id: '@kjanat/dreamcli/testkit:TestPrompterOptions',
    name: 'TestPrompterOptions',
    entrypoint: '@kjanat/dreamcli/testkit',
    routePath: '/reference/symbols/testkit/TestPrompterOptions',
    summary: 'Options for `createTestPrompter`.',
  },
];

export const docsHealthSnapshot = {
  authoredPageCount: 39,
  generatedArtifactCount: 175,
  exampleCount: 7,
  publicEntrypointCount: 4,
  publicSymbolCount: 159,
  symbolPageCount: 158,
};
