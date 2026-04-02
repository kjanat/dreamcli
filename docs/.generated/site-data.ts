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
    title: 'Generated Public Export Inventory',
    artifactPath: 'docs/.generated/api/public-exports.json',
    sourceInputs: ['package.json'],
    status: 'prepared',
    notes:
      'The foundation emits a stable export manifest before later API-index and TypeDoc normalization tasks add richer rendering.',
  },
];

export const generatedPublicExports = [
  {
    subpath: '.',
    entrypoint: 'dreamcli',
  },
  {
    subpath: './runtime',
    entrypoint: 'dreamcli/runtime',
  },
  {
    subpath: './testkit',
    entrypoint: 'dreamcli/testkit',
  },
];

export const docsHealthSnapshot = {
  authoredPageCount: 33,
  generatedArtifactCount: 4,
  exampleCount: 7,
  publicExportCount: 3,
};
