// Ambient value declarations for docs twoslash snippets.
// Types resolve automatically via compilerOptions.paths — no re-declarations needed.
// This file only declares VALUES that incomplete snippets reference without importing.

type DocsMain = typeof import('@kjanat/dreamcli');
type DocsRuntime = typeof import('@kjanat/dreamcli/runtime');
type DocsTestkit = typeof import('@kjanat/dreamcli/testkit');

type DocsCommand = ReturnType<DocsMain['command']>;
type DocsCli = ReturnType<DocsMain['cli']>;
type DocsMiddleware = import('@kjanat/dreamcli').Middleware<
  Record<string, unknown>
>;

// @internal types surfaced in contract pages (not part of public API)
type ErasedCommand = Record<string, unknown>;
type OutputPolicy = Record<string, unknown>;
type DispatchResult = Record<string, unknown>;
type BeforeParseParams = import('@kjanat/dreamcli').BeforeParseParams;
type ResolvedCommandParams = import('@kjanat/dreamcli').ResolvedCommandParams;
type PluginCommandContext = import('@kjanat/dreamcli').PluginCommandContext;
interface CommandExecutionPlan {
  readonly command: ErasedCommand;
  readonly mergedSchema: CommandSchema;
  readonly argv: readonly string[];
  readonly meta: import('@kjanat/dreamcli').CommandMeta;
  readonly plugins: readonly import('@kjanat/dreamcli').CLIPlugin[];
  readonly output: OutputPolicy;
  readonly help: import('@kjanat/dreamcli').HelpOptions | undefined;
}

// Ambient types referenced by contract/reference page snippets without imports
type ActivityEvent = import('@kjanat/dreamcli').ActivityEvent;
type CommandSchema = import('@kjanat/dreamcli').CommandSchema;
type ParseResult = import('@kjanat/dreamcli').ParseResult;
type PromptEngine = import('@kjanat/dreamcli').PromptEngine;
type DeprecationWarning = import('@kjanat/dreamcli').DeprecationWarning;
type ResolveOptions = import('@kjanat/dreamcli').ResolveOptions;
type ResolveResult = import('@kjanat/dreamcli').ResolveResult;
type HelpOptions = import('@kjanat/dreamcli').HelpOptions;
type CLIPlugin = import('@kjanat/dreamcli').CLIPlugin;
type CommandMeta = import('@kjanat/dreamcli').CommandMeta;
type Out = import('@kjanat/dreamcli').Out;
type OutputOptions = import('@kjanat/dreamcli').OutputOptions;
type Verbosity = import('@kjanat/dreamcli').Verbosity;
type RuntimeAdapter = import('@kjanat/dreamcli/runtime').RuntimeAdapter;

// --- Library values (for snippets without `import` statements) ---

declare const ArgBuilder: DocsMain['ArgBuilder'];
declare const CLIBuilder: DocsMain['CLIBuilder'];
declare const CLIError: DocsMain['CLIError'];
type CLIError = InstanceType<DocsMain['CLIError']>;
declare const CommandBuilder: DocsMain['CommandBuilder'];
declare const FlagBuilder: DocsMain['FlagBuilder'];
declare const ParseError: DocsMain['ParseError'];
declare const ValidationError: DocsMain['ValidationError'];
declare const arg: DocsMain['arg'];
declare const buildConfigSearchPaths: DocsMain['buildConfigSearchPaths'];
declare const cli: DocsMain['cli'];
declare const command: DocsMain['command'];
declare const configFormat: DocsMain['configFormat'];
declare const createArgSchema: DocsMain['createArgSchema'];
declare const createOutput: DocsMain['createOutput'];
declare const createSchema: DocsMain['createSchema'];
declare const createTerminalPrompter: DocsMain['createTerminalPrompter'];
declare const definitionMetaSchema: DocsMain['definitionMetaSchema'];
declare const discoverConfig: DocsMain['discoverConfig'];
declare const discoverPackageJson: DocsMain['discoverPackageJson'];
declare const flag: DocsMain['flag'];
declare const formatHelp: DocsMain['formatHelp'];
declare const generateBashCompletion: DocsMain['generateBashCompletion'];
declare const generateCompletion: DocsMain['generateCompletion'];
declare const generateInputSchema: DocsMain['generateInputSchema'];
declare const generateSchema: DocsMain['generateSchema'];
declare const generateZshCompletion: DocsMain['generateZshCompletion'];
declare const group: DocsMain['group'];
declare const inferCliName: DocsMain['inferCliName'];
declare const isCLIError: DocsMain['isCLIError'];
declare const isParseError: DocsMain['isParseError'];
declare const isValidationError: DocsMain['isValidationError'];
declare const middleware: DocsMain['middleware'];
declare const parse: DocsMain['parse'];
declare const plugin: DocsMain['plugin'];
declare const resolve: DocsMain['resolve'];
declare const resolvePromptConfig: DocsMain['resolvePromptConfig'];
declare const SHELLS: DocsMain['SHELLS'];
declare const tokenize: DocsMain['tokenize'];
declare const createAdapter: DocsRuntime['createAdapter'];
declare const createBunAdapter: DocsRuntime['createBunAdapter'];
declare const createDenoAdapter: DocsRuntime['createDenoAdapter'];
declare const createNodeAdapter: DocsRuntime['createNodeAdapter'];
declare const detectRuntime: DocsRuntime['detectRuntime'];
declare const ExitError: DocsRuntime['ExitError'];
declare const RUNTIMES: DocsRuntime['RUNTIMES'];
declare const createCaptureOutput: DocsTestkit['createCaptureOutput'];
declare const createTestAdapter: DocsTestkit['createTestAdapter'];
declare const createTestPrompter: DocsTestkit['createTestPrompter'];
declare const PROMPT_CANCEL: DocsTestkit['PROMPT_CANCEL'];
declare const runCommand: DocsTestkit['runCommand'];

// --- Walkthrough / example ambient variables ---

interface DocsUser {
  id: string;
  name: string;
}

declare const adapter: import('@kjanat/dreamcli/runtime').RuntimeAdapter;
declare const auth: DocsCommand;
declare const authLogin: DocsCommand;
declare const authStatus: DocsCommand;
declare const authedCommand: DocsMain['command'];
declare const cmd: DocsCommand;
declare const deploy: DocsCommand &
  ((target?: string, flags?: unknown) => Promise<unknown>);
declare const errorBoundary: DocsMiddleware;
declare const getAuthenticatedUser: () => Promise<DocsUser | undefined>;
declare const getUser: () => Promise<DocsUser | undefined>;
declare const greet: DocsCommand;
declare const issue: DocsCommand;
declare const issueLabelChoices: readonly { value: string; label?: string }[];
declare const issueList: DocsCommand;
declare const issueTriage: DocsCommand;
declare const mainCmd: DocsCommand;
declare const mainCommand: DocsCommand;
declare const migrate: DocsCommand;
declare const migrateCmd: DocsCommand;
declare const myCli: DocsCli & {
  run(): Promise<void>;
  schema: import('@kjanat/dreamcli').CLISchema;
};
declare const noAuth: DocsCommand;
declare const other: DocsCommand;
declare const out: import('@kjanat/dreamcli').Out;
declare const pr: DocsCommand;
declare const prCreate: DocsCommand;
declare const prList: DocsCommand;
declare const prView: DocsCommand;
declare const region: string;
declare const requireAuth: (token: string | undefined) => { token: string };
declare const result: import('@kjanat/dreamcli/testkit').RunResult;
declare const rows: readonly { name: string; status: string; uptime: number }[];
declare const seed: DocsCommand;
declare const seedCmd: DocsCommand;
declare const serve: DocsCommand;
declare const status: DocsCommand;
declare const target: string;
declare const tick: () => Promise<void>;
declare const timing: DocsMiddleware;
declare const tokenFlag: (
  description?: string,
) => ReturnType<DocsMain['flag']['string']>;
declare const trace: DocsMiddleware;
declare const tracePlugin: import('@kjanat/dreamcli').CLIPlugin;
declare const withAuth: DocsCommand;
declare const writeFileSync: (path: string, data: string) => void;

// --- Test assertion ambient ---

declare function expect(value: unknown): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toContainEqual(expected: unknown): void;
  toBeInstanceOf(expected: unknown): void;
  toBeUndefined(): void;
  not: {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toContainEqual(expected: unknown): void;
    toBeInstanceOf(expected: unknown): void;
    toBeUndefined(): void;
  };
};
declare namespace expect {
  function objectContaining(expected: Record<string, unknown>): unknown;
}
