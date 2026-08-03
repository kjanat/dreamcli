# Stability Policy

This page classifies every exported type and value by the compatibility contract
it carries. Version numbers follow [SemVer](https://semver.org).

"Breaking" is not one rule. It depends on who constructs a value, who reads it,
and whether the value crosses a serialization boundary. Adding a readonly member
to [`Out`](#sealed-framework-values) is a minor release because only the
framework constructs one. Adding a required member to
[`RuntimeAdapter`](#implementer-ports) is a major release because consumers
implement it; adding an optional member is a minor release. Adding a variant to
[`Shell`](#closed-unions-and-discriminated-results)
is a major release because consumers switch exhaustively over it, while adding
one to [`ErrorCode`](#open-unions) is a patch because the union is open by
construction.

Three questions place a symbol in a category.

1. Who constructs values of this type, the framework or the consumer?
2. Who reads them, and are they expected to enumerate the members?
3. Does the value survive `JSON.stringify` and get read by something outside
   this package?

A symbol not named on this page falls into the category whose shape it matches.
When the match is ambiguous, the stricter contract applies.

## Categories

| Category                             | Examples                                                  | Minor releases may                              |
| ------------------------------------ | --------------------------------------------------------- | ----------------------------------------------- |
| Sealed framework values              | `Out`, `RenderContext`, `CommandSchema`, `ConfigSettings`  | add readonly members                            |
| Consumer input options               | `RunOptions`, `CLIExecuteOptions`, `OutputOptions`         | add optional fields                             |
| Transparent input definitions        | `FlagDefinition`, `CLIDefinition`, `PackageJsonData`       | add optional fields                             |
| Implementer ports                    | `RuntimeAdapter`, `PromptEngine`, `FormatLoader`           | add optional members only                       |
| Externally governed protocols        | `StandardSchemaV1` family                                  | track the upstream specification                |
| Structural consumer configuration    | `CLIPlugin`, `CLIPluginHooks`                              | add optional hooks                              |
| Closed unions, discriminated results | `Verbosity`, `Shell`, `FlagKind`, `ConfigDiscoveryResult`  | change nothing                                  |
| Open unions                          | `ErrorCode`                                                | add members in any release                      |
| Framework-produced callback payloads | `BeforeParseParams`, `DeprecationWarning`                  | add readonly members, required ones included    |
| Closed constructible DTOs            | `RunResult`, `CommandMeta`                                 | change nothing                                  |
| Serialized formats                   | `DefinitionDocumentV1` family, `CLIErrorJSON`              | add optional fields at the same `schemaVersion` |
| Classes and functions                | `CLIBuilder`, `cli()`, `parse()`                           | add optional trailing parameters                |
| Internal surface                     | underscore members, `Internal*` types, brand symbols       | change anything, any release                    |

## Sealed framework values

`Out`, `RenderContext`, `FlagSchema`, `ArgSchema`, `CommandSchema`, `CLISchema`,
`ConfigSettings`, and `Builtins`.

Each carries a brand a consumer cannot spell. `Out` and `RenderContext` carry a
`unique symbol` that no entrypoint exports. The schema family carries a
type-only brand established by its factory. Implementing or structurally
constructing any of them outside the framework fails to type-check.

Obtain instances from the framework:

- `Out` from action parameters, `createOutput()`, or `createCaptureOutput()`.
- `RenderContext` from `resolveRenderContext()`.
- `FlagSchema`, `ArgSchema`, `CommandSchema` from `createFlagSchema()`,
  `createArgSchema()`, `createCommandSchema()`, or the corresponding builders.
- `CLISchema` with its nested `ConfigSettings` and `Builtins` from
  `createCLISchema()`, or from `cli(...).schema`.

The guarantee is one-directional. New readonly members may appear in a minor
release, and code that reads documented members keeps compiling. Code that
enumerates keys (`Record<keyof Out, string>`) breaks when a member arrives, so
enumeration is outside the contract.

Factories take a plain definition and return the sealed value:

```ts twoslash
import { createCommandSchema } from '@kjanat/dreamcli';
// ---cut---
const deploy = createCommandSchema({
	name: 'deploy',
	flags: { force: { kind: 'boolean' } },
	args: [{ name: 'target', schema: { kind: 'string' } }],
});
```

The brand rides along on a spread, which is the escape hatch for building a
variant of an existing schema:

```ts twoslash
import { createCommandSchema, type CommandSchema } from '@kjanat/dreamcli';

const deploy = createCommandSchema({ name: 'deploy' });
// ---cut---
const internalDeploy: CommandSchema = { ...deploy, hidden: true };
```

A hand-written object literal has no brand to carry, so it is rejected:

```ts twoslash
// @errors: 2741
import type { CommandSchema } from '@kjanat/dreamcli';
// ---cut---
const fake: CommandSchema = {
	name: 'deploy',
	description: undefined,
	aliases: [],
	hidden: false,
	examples: [],
	flags: {},
	args: [],
	hasAction: true,
	interactive: undefined,
	commands: [],
};
```

Two further properties hold for the schema family. Feeding a built schema back
through its factory produces a deep-equal schema, so normalization is
idempotent. A field belonging to another kind (`enumValues` on a `boolean` flag)
fails to compile and throws `INVALID_SCHEMA` at runtime for JavaScript callers.

Helpers that need part of a sealed value should accept a capability type built
with `Pick`, which stays correct as members are added:

```ts twoslash
import type { Out } from '@kjanat/dreamcli';
// ---cut---
type InformationalOutput = Pick<Out, 'info' | 'status'>;

function renderRows(out: InformationalOutput, rows: readonly string[]) {
	for (const row of rows) out.info(row);
}
```

For test doubles, take a real channel from the testkit and spy on it:

```ts
const [out] = createCaptureOutput();
vi.spyOn(out, 'info');
```

`Builtins` is the normalized built-in-flag state stored on `CLISchema.builtins`.
Every key is present and typed `BuiltinMode` after normalization, whatever
subset of them the caller supplied. The consumer-facing input form is
`BuiltinsConfig`, which is a
[transparent input definition](#transparent-input-definitions).

The compiled execution graph behind a program is not in this category because it
is not exported at all. See [Internal surface](#internal-surface).

## Consumer input options

Option objects the caller constructs and passes in.

Program and execution options: `CLIOptions`, `CLIExecuteOptions`, `CLIRunOptions`,
`RunOptions` and `RunCommandOptions` (both from `@kjanat/dreamcli/testkit`),
`DefaultCommandOptions`, `ManifestSettings` with its name-inference value type
`InferNameOption`, `ManifestDiscoveryOptions`, `ConfigDiscoveryOptions`, and
`PackageRepositoryUrlOptions`.

Pipeline and rendering options: `ParseOptions`, `ResolveOptions`,
`ReadFlagsOptions`, `OutputOptions`, `RenderContextOptions`, `HelpOptions`,
`HelpTheme`, `CompletionOptions`, and `JsonSchemaOptions`.

Per-call output options: `SpinnerOptions`, `ProgressOptions`, `TableOptions`, and
`TableColumn`.

Value options accepted by the flag and arg factories: `StringConstraints`,
`NumberConstraints`, `PathFlagOptions`, `UrlFlagOptions`, and `DateFlagOptions`.
All five describe the value rather than flag syntax, so `flag.path()` and
`arg.path()` take one `PathFlagOptions`, `flag.url()` and `arg.url()` take one
`UrlFlagOptions`, and `flag.date()` and `arg.date()` take one `DateFlagOptions`.

Prompt configuration: `PromptConfig`, `PromptConfigBase`, `InputPromptConfig`,
`ConfirmPromptConfig`, `SelectPromptConfig`, `MultiselectPromptConfig`, and the
choice entry `SelectChoice`.

Error constructor options: `CLIErrorOptions`, `ParseErrorOptions`, and
`ValidationErrorOptions`.

Testkit inputs: `TestAdapterOptions`, `TestPrompterOptions`, the queued answer
type `TestAnswer`, and the cancellation sentinel value `PROMPT_CANCEL`.

Every field is optional apart from the discriminants and identifiers each type
needs: `code` on `CLIErrorOptions`, `ParseErrorOptions`, and
`ValidationErrorOptions`; `message` on `PromptConfigBase` and `kind` on each
concrete prompt config; `format` on the `'json'` and `'text'` arms of
`TableOptions`; `type` on the directory arm of `PathFlagOptions`; `value` on
`SelectChoice`; and `key` on `TableColumn`. Minor releases may add optional
fields. They never add a required field, remove a field, or change what an
existing field means. Defaults are part of the contract and change only in a
major release.

`CLIExecuteOptions` and `CLIRunOptions` sit on top of `RunOptions`.
`CLIExecuteOptions` is the process-free surface with every input injected
explicitly. `CLIRunOptions` adds the runtime adapter that `.run()` uses to reach
the process. `RunCommandOptions` extends `RunOptions` the same way for
`runCommand()`, adding the `builtins` state the testkit harness mirrors from
the CLI a command is registered on. The field stays off `RunOptions` itself,
where the CLI schema is authoritative.

`ReadFlagsOptions` takes an optional type parameter, the definitions record
`readFlags()` is evaluating, which types its `onSources` receiver against the
caller's own flag names. It defaults to `FlagMap`, so `ReadFlagsOptions` written
without an argument keeps meaning what it did.

`HelpTheme` is the one entry whose every member is required. A theme reaches the
framework as the `Partial<HelpTheme>` returned by a `HelpThemeFactory`, so a new
semantic role added to `HelpTheme` in a minor release leaves existing factories
compiling. The factory form is the supported way to supply one.

## Transparent input definitions

Plain object types a consumer writes by hand or a code generator emits.

`FlagDefinition`, `ArgDefinition`, `CommandDefinition`, `CLIDefinition`,
`ConfigSettingsDefinition`, and `BuiltinsConfig`; the shared bases
`FlagDefinitionBase` and `ArgDefinitionBase`; the per-kind variants
`StringFlagDefinition`, `NumberFlagDefinition`, `BooleanFlagDefinition`,
`EnumFlagDefinition`, `ArrayFlagDefinition`, `CustomFlagDefinition`,
`CountFlagDefinition`, `KeyValueFlagDefinition`, `StringArgDefinition`,
`NumberArgDefinition`, `BooleanArgDefinition`, `EnumArgDefinition`,
`CustomArgDefinition`, `KeyValueArgDefinition`; the
kind-indexed maps
`FlagDefinitionByKind` and `ArgDefinitionByKind`; the override forms
`FlagDefinitionOverrides` and `ArgDefinitionOverrides`; the entry type
`CommandArgEntryDefinition`; the values a definition embeds, `PathChecks`,
`FlagNegation`, `StdinOptions`, `SplitOptions`, `SplitSetting`,
`SourceSplitBinding`, `SplitBinding`, `CommandExample`, and its `ExampleCommand`
field type; and the consumer input data types `PackageJsonData` and
`PackageRepository`.

These have no brand, and structural construction is the point. They take the
same additive contract as consumer input options. Optional fields may arrive in
a minor release, required fields only in a major.

`PathChecks`, `FlagNegation`, and `CommandExample` are stored verbatim on the
built schema, so the same type serves as consumer input and as a member of a
sealed value. The input contract is the one that governs them. `StdinOptions`
splits the two roles instead: a caller writes the partial form and the schema
stores the fully populated `StdinBinding`, which takes the same input contract.
The binding has three axes, `when`, `consume`, and `trim`. Every
`StdinOptions` member is optional, so a fourth axis may arrive in a minor
release. Every `StdinBinding` member is required, so the stored form gains one
only in a major.
`SplitOptions` splits them the same way: a caller writes the per-source settings
and the schema stores the CLI delimiter on `separator` and the rest on
`SourceSplitBinding`, which `SplitBinding` resolves with the defaults filled in.
`PathChecks`
appears on both `StringFlagDefinition` and `StringArgDefinition`, alongside
`StringConstraints` on each and `valueHint` on `FlagDefinitionBase` and
`ArgDefinitionBase`.

Two properties are load-bearing for code generators. Definitions are recursive
and accept either rung, so `CommandDefinition.flags` takes a `FlagDefinition` or
an already-built `FlagSchema`, and `CLIDefinition.commands` takes a
`CommandDefinition` or a `CommandSchema`. A generator can therefore emit one
complete structural tree and hand it to `createCLISchema()`. Second, each
definition is a discriminated union indexed by `kind`, so a field belonging to
another kind is unrepresentable rather than silently ignored.

`BuiltinsConfig` is the input to `CLIBuilder.builtins()` and to the `builtins`
field of `CLIDefinition`. Its keys are the members of `BuiltinName`, all
optional, each taking a `BuiltinMode`. An absent key leaves that built-in
`'on'`, so `{}` and an omitted `builtins` field mean the same thing. A new key
arrives with a new `BuiltinName` member, which is a major release under
[Closed unions](#closed-unions-and-discriminated-results).

Adding a member to `FlagKind` or `ArgKind` widens these unions and is a major
release. See [Closed unions](#closed-unions-and-discriminated-results).

## Implementer ports

Interfaces designed to be implemented outside the framework.

`RuntimeAdapter` (from `@kjanat/dreamcli/runtime`) with its `TerminalSize` return
type, `PromptEngine`, `ConfigAdapter`, `PackageJsonAdapter`, `FormatLoader`,
`ReadFn`, and `WriteFn`.

The required surface is frozen within a major version. New capability arrives as
an optional member, so an existing implementation keeps compiling. A redesign
ships as a new interface with the old one supported until the next major.

`ConfigAdapter` and `PackageJsonAdapter` are subsets of `RuntimeAdapter` built
with `Pick`. `PackageJsonAdapter` requires `readFile` and `cwd`.
`ConfigAdapter` requires those plus `configDir`, and takes `userConfigDirs` and
`systemConfigDirs` as optional members. Adding a required key to either subset
breaks every implementer that passes a hand-built object, so the required key
sets are frozen alongside the port's own required surface. An optional member
added to `RuntimeAdapter` reaches these subsets only if the subset picks it.

`TerminalSize` is built by the adapter implementation and read by the framework.
Its two members are required and frozen with the port.

`NodeProcess`, `DenoNamespace`, and `GlobalForDetect` (all from
`@kjanat/dreamcli/runtime`) describe the host objects the built-in adapters
read, and each is the optional parameter of the function that reads it:
`createNodeAdapter(proc?)`, `createDenoAdapter(ns?)`, and
`detectRuntime(globals?)`. A caller supplies one to inject a host, so they take
the implementer-port contract in the reading direction: the framework reads
members it names, and a new required member is a major release. They describe
what the framework needs from a host, not the full API of any runtime.

The function-typed ports are the handler and parser signatures a consumer writes
and the framework calls: `ActionHandler`, `DeriveHandler`, `MiddlewareHandler`,
`InteractiveResolver` with its `InteractiveResult` return type, `ArgParseFn`,
`FlagParseFn`, and `HelpThemeFactory`. Their parameter and return types are
frozen within a major version. The payload object a handler receives grows
instead, under
[Framework-produced callback payloads](#framework-produced-callback-payloads).
A handler that destructures the members it needs keeps compiling when a new one
arrives.

The supported low-level output seam is the injected `stdout` and `stderr` writer
pair on `OutputOptions`, both of type `WriteFn`. Reimplementing `Out` is sealed
off and is not a supported extension point.

## Externally governed protocols

`StandardSchemaV1` and its namespace members `StandardSchemaV1Props`,
`StandardSchemaV1Result`, `StandardSchemaV1SuccessResult`,
`StandardSchemaV1FailureResult`, `StandardSchemaV1Issue`,
`StandardSchemaV1PathSegment`, `StandardSchemaV1Options`, and
`StandardSchemaV1Types`.

DreamCLI vendors these as types only, mirroring the specification at
[standardschema.dev](https://standardschema.dev), so validators from zod,
valibot, arktype, and any other conforming library can be passed to
`flag.custom()` and `arg.custom()` without a runtime dependency.

The contract belongs to that specification. DreamCLI tracks it and does not
extend it. When the upstream spec revises, the vendored types follow, and the
release carrying that change is labelled by the impact the upstream revision has
on DreamCLI consumers.

`Colors` takes the same treatment. It is the palette type behind `out.color` and
`HelpThemeFactory`, re-exported from
[ansispeck](https://www.npmjs.com/package/ansispeck) so a handler can type a
color-aware helper without adding that dependency. Its shape is governed by the
ansispeck version this package depends on, and a DreamCLI release that changes
which palette members exist is labelled by the impact on consumers.

## Structural consumer configuration

`CLIPlugin` and `CLIPluginHooks`.

The consumer constructs these, the framework consumes them. Every hook on
`CLIPluginHooks` is optional, so a new lifecycle hook can arrive in a minor
release without breaking an existing plugin. Adding a required field to
`CLIPlugin` is a major release.

`plugin()` is the recommended constructor. It freezes the hooks object and fills
`name`, and it keeps a plugin compiling when `CLIPlugin` gains a field that the
factory can default. A hand-built object literal has to spell every required
field itself.

The payload types the hooks receive are covered under
[Framework-produced callback payloads](#framework-produced-callback-payloads).

## Closed unions and discriminated results

The kind and mode unions `Verbosity`, `Shell`, `ArgKind`, `FlagKind`,
`PromptKind`, `BuiltinName`, `BuiltinMode`, `ArgPresence`, `FlagPresence`,
`DuplicatePolicy`, `DuplicateKeys`, `SplitFormat`, `StdinWhen`,
`StdinConsume`, `Fallback`, `TableFormat`, `TableStream`, `ParseErrorCode`,
`ValidationErrorCode`, and `Runtime` (from `@kjanat/dreamcli/runtime`).

The discriminated record `ResolutionProvenance`, whose `stage` narrows to the
source that produced a value.

The discriminated results `ActivityEvent`, `Token`, `PromptResult`,
`SplitPolicy`, `NumberConstraintViolation`, `StringConstraintViolation`, and
`ConfigDiscoveryResult` with its members `ConfigFound` and `ConfigNotFound`.

The runtime value forms `SHELLS` and `RUNTIMES` (the latter from
`@kjanat/dreamcli/runtime`), which are the frozen tuples behind `Shell` and
`Runtime`.

These are closed. A consumer may switch exhaustively over them and rely on the
compiler to flag an unhandled case. Adding a variant is a breaking change and
ships in a major release. The same rule covers the value forms, which tooling
iterates to emit one artifact per member.

`ValidationErrorCode` gained `MISSING_STDIN` in 4.0 under that rule: a `-` typed
beside other occurrences of a collection with nothing piped now carries its own
code instead of `REQUIRED_FLAG` or `REQUIRED_ARG`. It also reaches the open
[`ErrorCode`](#open-unions) union, so a consumer with a fallback branch needed no
change.

`ResolutionProvenance` narrows on `stage`, and the `'cli'` arm is two records:
one for a typed token and one for an explicit `-`, which carries `via` and
`trigger`. Both stay at `stage: 'cli'` because both keep CLI precedence, so a
reader that only asks about precedence tests `stage` and a reader that cares
about the pipe tests `via`. Adding a stage is a breaking change; the runtime
tuples `STDIN_WHENS` and `STDIN_CONSUMES` behind `StdinWhen` and `StdinConsume`
are deliberately not exported from any entrypoint, so the types are the contract
and the arrays stay the framework's own.

```ts twoslash
import type { Shell } from '@kjanat/dreamcli';
// ---cut---
function scriptFileName(shell: Shell): string {
	switch (shell) {
		case 'bash':
			return 'mycli.bash';
		case 'zsh':
			return '_mycli';
		case 'fish':
			return 'mycli.fish';
		case 'powershell':
			return 'mycli.ps1';
		default:
			return shell satisfies never;
	}
}
```

`ConfigDiscoveryResult` narrows on its `found` discriminant. The `false` branch
carries no other members, so reading `result.path` before narrowing is a type
error rather than a runtime `undefined`.

## Open unions

`ErrorCode`.

`ErrorCode` is `ParseErrorCode | ValidationErrorCode | (string & {})`. The
literal members drive autocomplete, and the `string` arm keeps the union open.
The framework emits codes outside the two closed unions (`CONFIG_NOT_FOUND`,
`CONFIG_PARSE_ERROR`, `CONFIG_UNKNOWN_FORMAT`, `DUPLICATE_COMMAND`,
`DUPLICATE_DEFAULT`, `RESERVED_FLAG`, `NO_ACTION`, and others), and may add
codes in any release including a patch.

Handle it with a fallback branch rather than an exhaustive switch:

```ts twoslash
import type { ErrorCode } from '@kjanat/dreamcli';
// ---cut---
function exitCodeFor(code: ErrorCode): number {
	if (code === 'UNKNOWN_FLAG' || code === 'MISSING_VALUE') return 2;
	if (code === 'REQUIRED_FLAG' || code === 'REQUIRED_ARG') return 2;
	return 1;
}
```

A consumer may also emit its own codes through `CLIError`, which is why the
union stays open rather than growing a variant per framework release.

## Framework-produced callback payloads

The bags handed to a consumer callback: `ActionParams`, `DeriveParams`,
`MiddlewareParams`, `InteractiveParams`, `BeforeParseParams`,
`PluginCommandContext`, `ResolvedCommandParams`, `ExampleMeta`, and
`ResolvedPromptConfig` with its members `ResolvedSelectPromptConfig` and
`ResolvedMultiselectPromptConfig`.

The values a framework call returns: `SpinnerHandle`, `ProgressHandle`,
`ResolveResult` with its `ResolutionProvenanceRecord`, `DeprecationWarning`,
`Middleware`, and `CapturedOutput` (from `@kjanat/dreamcli/testkit`).

The provenance bag a handler receives, `InputSources`, and the per-surface map
`SourcesOf` behind it. Both are keyed by the caller's own flag and arg names, so
a new stage arrives as a new `ResolutionProvenance` member rather than as a new
key here.

The normalized state a sealed schema carries: `ResolvedManifestSettings`,
`HelpLinks`, and `CommandArgEntry`.

The framework builds all of these. They carry no brand, so a test can assemble
one, but constructibility is not part of the contract. A minor release may add a
required readonly member. Every reader keeps compiling; an object literal that
spells the type exhaustively does not.

Destructure the members a callback needs and let the rest pass through. Code
that builds one of these types by hand should treat that as a
version-pinned convenience rather than a supported surface.

`ResolvedManifestSettings` is the normalized manifest-discovery state stored on
`CLISchema.packageJsonSettings`. The consumer-facing input form is
`ManifestSettings`, which is a
[consumer input option](#consumer-input-options).

`Middleware` comes from `middleware()` and is passed straight to
`CommandBuilder.middleware()`. Its `_handler` and `_output` members belong to the
[internal surface](#internal-surface), so the value is opaque in practice.

`SpinnerHandle` and `ProgressHandle` gain lifecycle methods the same way these
types gain members. Calling code keeps working; a hand-written test double that
implements the interface exhaustively does not.

## Closed constructible DTOs

`RunResult`, `CommandMeta`, and `ParseResult`.

The framework produces these, and consumers construct them on purpose. None
carries a brand and every member is required, so a hand-built object is
assignable. `RunResult` comes out of `runCommand()` and `.execute()`, and a
test fixture standing in for a run builds one. `CommandMeta` reaches a handler
as `meta`, and the [planner contract](/reference/planner-contract) carries it
on the execution plan, so tooling reproducing that seam builds one.
`ParseResult` comes out of `parse()` and goes into `resolve()`, so tooling
driving the low-level pipeline builds one directly.

Every member is required, and the set is closed. Adding a member is a breaking
change and ships in a major release. That is the price of guaranteeing
constructibility in both directions.

Consumers that only read a `RunResult` should still narrow with `Pick` where a
helper needs part of it, which keeps the helper honest about what it depends on.

## Serialized formats

`DefinitionDocumentV1` and its alias `DefinitionDocument`;
`CommandDefinitionDocumentV1` and its alias `CommandDefinitionDocument`; the
fragment types `CommandDefinitionFragmentV1`, `FlagDefinitionFragmentV1`,
`ArgDefinitionFragmentV1`, `ExampleDefinitionFragmentV1`,
`FlagNegationFragmentV1`, `FlagPathChecksFragmentV1`,
`FlagStringConstraintsFragmentV1`, `PromptChoiceFragmentV1`,
`PromptDefinitionFragmentV1`, `SourceSplitFragmentV1`, `SplitPolicyFragmentV1`,
`StdinBindingFragmentV1`, and `ArgElementFragmentV1`; and the error envelope
`CLIErrorJSON`.

`ArgElementFragmentV1` is the value half of a positional entry, which is what an
entries argument's `elementSchema` holds: everything `ArgDefinitionFragmentV1`
carries except the `name` a position supplies. The meta-schema hoists it as
`$defs.argElement` and the named `$defs.arg` spreads the same properties, so the
two cannot drift. A definition document never carries provenance: that is what
one invocation did, not what a schema declares.

`FlagStringConstraintsFragmentV1` and `FlagPathChecksFragmentV1` are the value
fragments of both `FlagDefinitionFragmentV1` and `ArgDefinitionFragmentV1`. Their
names are frozen with the version 1 format and carry no claim about which of the
two embeds them; the meta-schema hoists one definition per fragment and both
parents `$ref` it.

`StdinBindingFragmentV1` carries `when`, `consume`, and `trim`, all three
required and all three always written, so a reader never has to know the
builder's defaults. The meta-schema lists them under `$defs.stdin` with
`additionalProperties: false` and the same three in `required`.

These values leave the process. The package version does not govern their shape.
`schemaVersion` does.

Every standalone definition document carries `schemaVersion: 1`. Fragments carry no
`schemaVersion` and inherit the version of the document they sit in. A change
that breaks a reader of version 1 increments the format to `schemaVersion: 2`
and ships as `DefinitionDocumentV2` alongside `DefinitionDocumentV1`, whatever
the package major happens to be at that time. Additive changes that a version 1
reader can ignore stay at version 1.

```ts twoslash
import { createCLISchema, generateSchema } from '@kjanat/dreamcli';
// ---cut---
const document = generateSchema(createCLISchema({ name: 'mycli', version: '1.0.0' }));

console.log(document.schemaVersion);
// 1
console.log(document.$schema);
// https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json
```

The canonical meta-schema URL is
`https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json`. It is permanent.
Once published it keeps serving the version 1 meta-schema for as long as the
domain resolves, and it is never repointed at a later format. A version 2 format
would be served at `/schemas/definition/v2.schema.json`.

Two mirrors carry identical bytes for offline and local-first workflows:

- `./node_modules/@kjanat/dreamcli/dreamcli.schema.json`
- `https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json`

The `definitionMetaSchema` export is the same document as a value, for tooling
that validates definition documents without a network round-trip.

`CLIErrorJSON` is the `--json` error envelope. `name`, `code`, `message`, and
`exitCode` are always present; `suggest` and `details` appear when set. Its
`code` field is the open [`ErrorCode`](#open-unions) union, so a consumer
reading the envelope needs a fallback branch.

`generateInputSchema()` produces standard JSON Schema draft 2020-12, typed as
`InputSchemaDocument`, `InputSchemaBranch`, and `InputSchemaProperty`. That
output is governed by the JSON Schema draft it declares rather than by
`schemaVersion`, and it sits outside the definition-format family.

## Classes and functions

The callable surface, plus the exported type-level operators and constants in the
two subsections below.

Exported classes: `CLIBuilder`, `CommandBuilder`, `FlagBuilder`, `ArgBuilder`,
`CLIError`, `ParseError`, `ValidationError`, and `ExitError` (from
`@kjanat/dreamcli/runtime`).

Exported functions, by area:

- Program construction: `cli`, `command`, `group`, `flag`, `arg`, `middleware`,
  `plugin`.
- Schema normalization: `createFlagSchema`, `createArgSchema`,
  `createCommandSchema`, `createCLISchema`.
- Low-level pipeline: `tokenize`, `parse`, `resolve`, `readFlags`, `formatHelp`,
  `resolveRenderContext`, `resolvePromptConfig`, `includesBeforeSeparator`,
  `stripBeforeSeparator`, `getFlagNegatedName`, `resolveExampleCommand`,
  `wasExplicit`.
- Serialization: `generateSchema`, `generateCommandSchema`, `generateInputSchema`.
- Discovery: `discoverConfig`, `discoverManifest`, `inferCliName`,
  `buildConfigSearchPaths`, `configFormat`, `packageRepositoryUrl`.
- Output and terminal: `createOutput`, `createTerminalPrompter`, `osc8`,
  `visibleWidth`.
- Completion generation: `generateCompletion`, `generateBashCompletion`,
  `generateZshCompletion`, `generateFishCompletion`,
  `generatePowerShellCompletion`.
- Error narrowing: `isCLIError`, `isParseError`, `isValidationError`.
- Host integration: `isMainModule`, and from `@kjanat/dreamcli/runtime`
  `createAdapter`, `createNodeAdapter`, `createDenoAdapter`, `detectRuntime`.
- Testkit, from `@kjanat/dreamcli/testkit`: `runCommand`, `createCaptureOutput`,
  `createTestPrompter`, `createTestAdapter`.

The [API reference](/reference/api) lists their signatures.

`flag` and `arg` are callable namespaces typed by `FlagFactory` and `ArgFactory`.
A new factory method on either is a new function and ships in a minor release.
`FlagFactory` holds `string`, `number`, `boolean`, `enum`, `array`, `custom`,
`url`, `path`, `date`, `duration`, `bytes`, `count`, and `keyValue`.
`ArgFactory` holds `string`, `number`, `boolean`, `enum`, `custom`, `keyValue`,
`url`, `path`, `date`, `duration`, and `bytes`; the two it does not carry,
`array` and `count`, are documented under
[what the arg factory does not have](/guide/arguments#flag-only-surface).

Builder modifier methods follow the same rule. `FlagBuilder` and `ArgBuilder`
both carry `.int()`, `.min()`, `.max()`, and `.finite()` on number-kind
builders, and `.nonEmpty()`, `.minLength()`, `.maxLength()`, and `.pattern()` on
string-kind builders. A modifier guarded by a `this` parameter is callable only
on the kinds it names, so widening one to another kind is additive and ships in
a minor release.

A function may gain optional trailing parameters in a minor release, and its
return type may gain members subject to the category that return type belongs
to. Removing an overload, adding a required parameter, reordering parameters, or
narrowing a return type is a major release. Throwing a new error code from an
existing call path is a minor release, since `ErrorCode` is open.

Class constructors follow the same rule as functions, with one exception.
`CLIBuilder` has no public constructor. `cli()` builds an executable program and
`createCLISchema()` builds a description; there is no third way to obtain one.

### Type-level operators

`InferFlag`, `InferFlags`, `InferArg`, `InferArgs`, `InferStandardInput`,
`InferStandardOutput`, `ResolvedValue`, `ResolvedArgValue`, `ArgDefaultValue`,
`WithPresence`, `WithArgPresence`, `WithVariadic`,
`WithoutArgElementEligibility`, the builder state types `FlagConfig`,
`ArgConfig`, `StringElementConfig`, and `StringArgElementConfig`, the element
configs a collection factory assumes when given no element builder, and
`FlagMap`, the record of flag builders `readFlags()` evaluates.

These compute a type from another type. Most code reaches them through inference
and never names one. `InferFlags<typeof flags>` in an extracted handler signature
is the common exception.

The mapping each performs is frozen within a major version. The type it produces
carries the contract of whatever category that type belongs to. `FlagConfig` and
`ArgConfig` are the compile-time state threaded through a builder chain, and a
tracked property may be added to either in a minor release, since builders are
obtained from `flag` and `arg` rather than written by hand. `ArgConfig` gained
`elementEligible` in 4.0 under that rule, which is what lets `arg.keyValue()`
accept an element builder and refuse one already described as a positional.

`FlagMap` constrains the type parameter of `readFlags()` rather than computing a
type. It is a record of `FlagBuilder` values keyed by flag name, and the caller
writes the record. Accepting more as a member is a minor release; accepting less
is a major.

### Constants

`DREAMCLI_VERSION` and `DREAMCLI_REVISION`, both from
`@kjanat/dreamcli/version`, identify the framework build for diagnostics and bug
reports. They are typed `string` and their values change every release. They are
unrelated to the app version configured through `cli().version(...)`.

## Internal surface

Members prefixed with an underscore (`_from`, `_subcommands`, `_executionSteps`,
`_flags`, `_args`, `_ctx`, `_config`, `_output`), types named `Internal*`
(`InternalRunOptions`, `InternalCLIExecuteOptions`), and the brand symbols
behind sealed values exist for the framework's own layering and for in-repo
tests. They may change or disappear in any release, including a patch. The
`@internal` TSDoc tag marks the same boundary on individual members.

The compiled execution graph is internal in the strongest available sense.
`CompiledCLI` and `CompiledCommand` are not exported from any entrypoint and do
not appear in the generated declarations. A `CLIBuilder` holds its compiled
graph in module-private state, which is why `cli(...).schema` describes the
program while only the builder can execute it.
