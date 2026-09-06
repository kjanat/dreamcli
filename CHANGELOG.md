# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Explicit sensitive-input diagnostics** (https://github.com/kjanat/dreamcli/issues/120).\
  `flag.*().sensitive()` and `arg.*().sensitive()` redact framework-controlled values across argv parsing, source resolution, collections, Standard Schema validation, filesystem checks, structured details, construction-time `INVALID_DEFAULT` locations, and automatic default help. A sensitive input's `INVALID_DEFAULT` omits the record key of a rejected key-value default while keeping array indices. Sensitive definition fragments serialize `sensitive: true`; a safe `.default(..., { description })` remains visible in help. Developer-authored parser and validator messages remain verbatim.

### Changed

- **Breaking: non-sensitive diagnostics show rejected values from every source** (https://github.com/kjanat/dreamcli/issues/120).\
  Stdin, environment, config, prompt, default, and argv failures now follow the same schema-controlled policy instead of treating non-argv sources as secret. Messages and structured details retain non-sensitive values, collection keys, validator paths, filesystem paths, and adapter causes. Mark every secret-bearing input `.sensitive()`; its raw-derived fields are omitted while source, type, constraint, and allowed-value metadata remains. `CLIError.toJSON()` projects `details` onto JSON-representable values so `--json` reporting cannot throw on a retained runtime value: bigints serialize as decimal digits and entries JSON cannot carry, such as cyclic references, are omitted. The error object keeps the runtime value.
- **Smaller npm package, faster startup** (https://github.com/kjanat/dreamcli/issues/130).\
  The unpacked package shrinks from 1.5 MB to about 0.7 MB. Runtime JavaScript is bundled into the public entrypoints plus shared chunks and minified with module-level names kept, so stack traces still name framework functions. Emitted JavaScript no longer carries a copy of the API documentation; the declaration files keep it. Declarations are generated for the public entrypoints only. The tarball no longer ships `examples/` or `CHANGELOG.md`; both remain in the repository and the docs site. `package.json` declares `sideEffects: false` so bundlers drop unused framework modules. `runner run package:check` enforces tarball, unpacked, declaration, and hot-path budgets, caps the root hot path at two dist modules, and allows only `ansispeck` as an external. The size ceilings are deliberately tight: future growth must fit them or include a reviewed budget increase. `runner run lazy:check` runs the built package under a Node loader hook and asserts exact chunk sets for all ten scenarios, including required support chunks (`rolldown-runtime` for feature loads and `version` for completions). Plain commands, preloaded manifests, and TTY runs without a prompt load only the entry and core. Both run as part of `runner run bd`.
- **Breaking: optional features moved to subpath entries and load on demand** (https://github.com/kjanat/dreamcli/issues/130).\
  The root entry no longer exports the completion generators, `generateSchema()`, `generateCommandSchema()`, `generateInputSchema()`, `definitionMetaSchema`, config and manifest discovery, or `createTerminalPrompter()`. Import them from `@kjanat/dreamcli/completion`, `@kjanat/dreamcli/json-schema`, `@kjanat/dreamcli/config`, and `@kjanat/dreamcli/prompt`. Every type stays on the root entry, as do `SHELLS`, `DEFINITION_SCHEMA_URL`, `DEFINITION_SCHEMA_VERSION`, and `resolvePromptConfig()`; `ConfigSearchPathOptions` is now exported from the root and `@kjanat/dreamcli/config`. `cli()` loads each feature with a dynamic import when a run needs it, so importing the root entry pulls in about a quarter less code and a program that never renders a completion script, serializes `--help --json`, discovers config, or prompts never loads that code. The terminal prompter loads on the first prompt rather than on every interactive run, `.manifest(data)` no longer loads manifest discovery, and `createTestPrompter()` loads only for `RunOptions.answers` and `@kjanat/dreamcli/testkit`. `.completions()` now takes `CompletionRegistrationOptions`, which adds `as` to the generator's `CompletionOptions`; the generators never read `as`, so `CompletionOptions` no longer declares it. See the v4 upgrade guide for the import table.

### Fixed

- **Completion script headers name the program version** (https://github.com/kjanat/dreamcli/issues/131).\
  The first comment line of every generated script now reads `<name> v<version>` when the CLI declares a version, so an installed script records which release of the program it completes, alongside the existing DreamCLI build tag.

### Release checklist

- [ ] Set the intended version in `package.json` and `deno.json`, add the dated changelog section, and update every comparison link.
- [ ] Update first-party DreamCLI pins in documentation and import-map configuration; do not rewrite versions that belong to transitive lockfile metadata.
- [ ] Run `runner run -s schema:emit version:check ci smoke`.
- [ ] Pack with `bun pm pack --quiet --ignore-scripts` and inspect the tarball's files and version.
- [ ] Confirm generators and formatters leave no unexpected worktree changes.
- [ ] Commit and push the release preparation, then verify the target commit is signed, `master` matches the remote, and every required check is green.
- [ ] Confirm the exact `v<version>` tag does not already exist and npm and JSR do not already contain that version before publishing the GitHub release.

## [4.0.0-rc.3] - 2026-09-05

### Added

- Let `flag.*().describe()` and `arg.*().describe()` accept a function that receives the resolved help theme, keeping semantic highlighting inside prose on the framework's color gate. Add `.help({ descriptionTheme })` for scoped role overrides that merge over the global theme (https://github.com/kjanat/dreamcli/issues/93).

### Fixed

- **Published archives exclude generated workspace dependencies and Python bytecode.**\
  npm tarballs no longer include nested `node_modules` trees or `__pycache__` files from packaged examples and skills.
- **Completion scripts no longer offer surface-only defaults as named commands** (https://github.com/kjanat/dreamcli/pull/127).\
  A command registered with `.default(command)` now exposes its flags only at the root instead of also suggesting a command name that cannot be invoked. Defaults registered with `.default(command, { route: true })` remain available by name in Bash, Zsh, Fish, and PowerShell completions.
- **Explicit hyperlink flags override environment defaults** (https://github.com/kjanat/dreamcli/issues/126).\
  `--hyperlinks` now overrides `NO_HYPERLINKS`, while `--no-hyperlinks` overrides `FORCE_HYPERLINKS`. Without an explicit flag, `NO_HYPERLINKS` still wins over `FORCE_HYPERLINKS`.

## [4.0.0-rc.2] - 2026-08-17

### Fixed

- **Published testkit declarations accept command builders again** (https://github.com/kjanat/dreamcli/issues/122).\
  `runCommand()` now exposes a declaration-safe generic `CommandBuilder` parameter while keeping its execution pipeline type-erased internally. Package builds also compile the public testing example against the emitted declarations so internal-member stripping cannot silently break this contract again.

## [4.0.0-rc.1] - 2026-08-12

### Added

- **Handlers can see where each value came from** (https://github.com/kjanat/dreamcli/issues/90).\
  `ActionParams`, `DeriveParams`, and `MiddlewareParams` gain `sources`, keyed like `flags` and `args`, holding the full record resolution already produced: `{ stage: 'cli' }`, `{ stage: 'cli', via: 'stdin', trigger: 'dash' }`, `{ stage: 'stdin', via: 'stdin', trigger: 'fallback' }`, `{ stage: 'env', envVar }`, `{ stage: 'config', configPath }`, `{ stage: 'prompt' }`, or `{ stage: 'default' }`. An input that resolved no value has no record. `wasExplicit(record)` derives the explicit-versus-defaulted question from it without dropping `.default()`, which would also drop `defaultValue` from the definition document. `ResolveResult.provenance` carries the same records for a direct `resolve()` caller, and `readFlags()` hands them to a new `onSources` receiver, typed against the definitions record. `ResolutionProvenance`, `ResolutionProvenanceRecord`, `InputSources`, `SourcesOf`, and `wasExplicit` are exported from the package root. The existing `ResolutionProvenance` name continues to describe one input's winning stage; `ResolutionProvenanceRecord` names the complete `ResolveResult.provenance` object.

- **`arg.keyValue()` takes an element builder** (https://github.com/kjanat/dreamcli/issues/87).\
  Entry values used to be strings on the positional surface while `flag.keyValue(element)` gave them a codec. `arg.keyValue(arg.number().int().min(0))` now resolves `mycli scale web=3` to `{ web: 3 }`, with the element's constraints, path checks, and Standard Schema validator applied to every entry, from every source. The element is guarded the same way flags guard theirs: `ArgConfig` gains `elementEligible`, so a builder already described as a positional (`.optional()`, `.env()`, `.stdin()`, `.describe()`, …) is refused in element position at compile time. `ArgSchema` gains `elementSchema`, which serializes into definition documents under the new `ArgElementFragmentV1` shape and the `$defs.argElement` meta-schema definition.

- **Help names the stdin source.**\
  An input that declares `.stdin()` renders `[stdin]` beside the existing `[env: X]`, `[config: y]`, and `[prompt]` annotations, on the flag table and the argument table alike. The narrower triggers say which one applies: `[stdin: '-']` for `{ when: 'dash' }` and `[stdin: when omitted]` for `{ when: 'missing' }`. Completion scripts are unchanged; they carry the plain description.

- **A dedicated error code for a dash with nothing piped.**\
  `ValidationErrorCode` gains `MISSING_STDIN`, which replaces the borrowed `REQUIRED_FLAG` / `REQUIRED_ARG` on the one failure that is neither: a `-` typed beside other occurrences of a collection when the stream is empty. Those two keep their own meaning, a required input no source filled.

- **A variadic argument reads stdin from its tail.**\
  `.stdin()` and `.variadic()` now compose. A `-` among the tail tokens stands for the whole stdin source at that position, so `printf 'x\ny\n' | mycli build a - b` collects `['a', 'x', 'y', 'b']`, and an empty tail under a binding that covers a missing input takes the whole buffer. `arg.keyValue().variadic().stdin()` aggregates entries across the typed tokens and the pipe under its `.duplicateKeys()` policy. Each `-` stands for all of the buffer, so two of them splice it twice, and the stream is still read at most once per invocation. The preflight that decides whether to read stdin counts an empty tail as an absent input, which is what makes `printf 'x\ny\n' | mycli build` reach the fallback stage under `.run()`.

- **`.stdin({ trim: true })` drops the terminator a pipe appends.**\
  Codecs that preserve text terminators, including `string` and `path`, keep the buffer byte for byte by default. `trim` drops one trailing `\n`, `\r\n`, or `\r` from a single value before anything decodes or checks it, so `echo ./dist | mycli clean` satisfies `arg.path({ mustExist: true })`. It applies to both surfaces, to an explicit `-` and to the implicit fallback, and to `readFlags()` and `runCommand()`. Other decoding codecs already remove one framing terminator and are unaffected, so no value ever loses two. A collection's terminators separate its elements, so `.split({ stdin })` still decides those. The binding serializes as `stdin.trim` in definition documents, alongside `when` and `consume`.

- **Stability policy and a 4.0 upgrade guide**\
  The [stability page](https://dreamcli.kjanat.dev/reference/stability) now places every export of the root, `/testkit`, `/runtime`, and `/version` entrypoints in one of thirteen categories, each with the rules it carries into a minor release: sealed framework values, consumer input options, transparent input definitions, implementer ports, externally governed protocols, structural consumer configuration, closed unions and discriminated results, open unions, framework-produced callback payloads, closed constructible DTOs, serialized formats, classes and functions, and internal surface.\
  [Upgrading From 3.x To 4.0](https://dreamcli.kjanat.dev/guide/upgrading-v4) walks the breaking changes below with before and after code.

- **Definition types and normalization factories for flags, args, commands, and the CLI**\
  `createFlagSchema()`, `createCommandSchema()`, and `createCLISchema()` join the existing `createArgSchema()`. The flag and arg factories take a plain definition object, or a kind plus that kind's fields; the command and CLI factories take complete definition objects. Each returns the normalized schema; feeding a built schema back in produces a deep-equal schema, and a field belonging to another kind throws `INVALID_SCHEMA`. `createCommandSchema()` normalizes nested flags, args, and subcommands, and `createCLISchema()` normalizes commands and config settings for a description of a program with no execution graph attached.\
  Each level ships its definition types: `FlagDefinition`, `FlagDefinitionBase`, `FlagDefinitionByKind`, `FlagDefinitionOverrides`, and the per-kind members `StringFlagDefinition`, `NumberFlagDefinition`, `BooleanFlagDefinition`, `EnumFlagDefinition`, `ArrayFlagDefinition`, `CustomFlagDefinition`, `CountFlagDefinition`, `KeyValueFlagDefinition`; `ArgDefinition`, `ArgDefinitionBase`, `ArgDefinitionByKind`, `ArgDefinitionOverrides`, `StringArgDefinition`, `NumberArgDefinition`, `EnumArgDefinition`, `CustomArgDefinition`; `CommandDefinition` with `CommandArgEntryDefinition`; and `CLIDefinition` with `ConfigSettingsDefinition`.\
  All of them are exported from the package root.

- **`.builtins()` takes `--help`, `--json`, or `--quiet` over to the commands** (https://github.com/kjanat/dreamcli/issues/86).\
  A CLI whose `--json` names the document it operates on, whose `-q` means something domain-specific, or whose `--help` is a routable topic browser can now claim the token. `cli('mycli').builtins({ json: 'off' })` releases every spelling that built-in answers to. The root stops reading and stripping it from argv, root help stops listing it under `Global options:`, the `RESERVED_FLAG` guard stops reserving it, and a command may declare it as an ordinary flag that parses and reaches the handler. Releasing `help` also disables command-level `--help`/`-h`, the bare `help` token, the `--help` footer hint, the `Run '<bin> --help' for available commands` suggestion on dispatch errors, and the synthetic `--help` in generated completion scripts. `version` and `completions` have no entry, since `.version()` and `.completions()` are opt-in and a CLI declines those by omission. Every built-in defaults to `'on'`, repeated calls merge with the last mode per built-in winning, and `RunOptions.jsonMode` / `RunOptions.verbosity` keep working regardless, since only argv-driven activation is disabled. The state is normalized onto `CLISchema.builtins` by both `.builtins()` and the `builtins` field of `createCLISchema()`, an invalid mode throws `INVALID_SCHEMA`, and `BuiltinsConfig`, `Builtins`, `BuiltinName`, and `BuiltinMode` are exported from the package root. `runCommand()` from `/testkit` takes the same `builtins` option so a command owning a released flag can be tested; its options type is now `RunCommandOptions`. The `RESERVED_FLAG` error offers `.builtins({ <name>: 'off' })` alongside renaming, and a version discovered by `.manifest()` filesystem walking now runs the same guard at `.run()` time instead of silently shadowing a command's `version` flag. That startup failure is reported the way every other `.run()` startup failure is: the message and its suggestion go to stderr, `--json` puts the serialized error on stdout, and the process exits with the error's exit code rather than rejecting the `.run()` promise.

- **Definition format v1 — versioned, typed documents**\
  `generateSchema()` and `generateCommandSchema()` now emit `schemaVersion: 1`, so a consumer can tell which format it is reading before parsing the rest. Both return typed documents instead of `Record<string, unknown>`: `DefinitionDocumentV1` for a whole CLI, `CommandDefinitionDocumentV1` for a single command, with `DefinitionDocument` and `CommandDefinitionDocument` aliasing the current version. Documents are distinct from the fragments nested inside them. `CommandDefinitionFragmentV1`, `FlagDefinitionFragmentV1`, `ArgDefinitionFragmentV1`, `ExampleDefinitionFragmentV1`, `PromptDefinitionFragmentV1`, `PromptChoiceFragmentV1`, `FlagNegationFragmentV1`, `FlagStringConstraintsFragmentV1`, and `FlagPathChecksFragmentV1` carry no `schemaVersion` and take the version of the document they sit in. `generateInputSchema()` is standard JSON Schema and stays outside the family, typed as `InputSchemaDocument` with `InputSchemaBranch` and `InputSchemaProperty`. Every one of these is exported from the package root, and the returned documents remain assignable to `Record<string, unknown>`. `--help` in `--json` mode serializes through `generateCommandSchema()`, so that output gains `schemaVersion: 1` as its first key.

- **`readFlags()` evaluates a record of flag builders outside a CLI** (https://github.com/kjanat/dreamcli/issues/107).\
  A build script or a small tool that wants typed options without commands, handlers, or output channels hands its flags straight to `readFlags()` and awaits the resolved values, typed by `InferFlags`:

  ```ts
  const options = await readFlags({
  	watch: flag.boolean().alias('w').env('WATCH'),
  	minify: flag.boolean().env('MINIFY').default(true),
  	target: flag.enum(['node', 'browser']).env('TARGET').default('node'),
  });

  options.watch; // boolean
  options.target; // 'node' | 'browser'
  ```

  Each object key is the canonical flag name, and evaluation runs through the same command schema, parser, coercion, resolver, and validation a command uses. Aliases, negated spellings, duplicate policy, case parity, unknown-flag rejection, collisions between names, aliases and negated forms, the CLI, stdin, env, config, prompt, default precedence, constraints, Standard Schema validators, and `flag.path()` checks all behave as they do inside `.action()`. `argv`, `env`, `stdinData`, `stat`, and `mkdir` fall back to the detected `RuntimeAdapter`, while `config` and `prompter` stay caller-supplied, since standalone flag reading has no application name to discover a file from and opens no terminal session. `ReadFlagsOptions` extends `ResolveOptions` with `argv`, `adapter`, `parse`, `strict`, `help`, and `onDeprecation`. The adapter is built on the first fact the caller left out, so a call given `argv` and `env` reads nothing from the host unless a `flag.path()` check needs the adapter's filesystem primitives. Failures throw `ParseError` and `ValidationError` instead of exiting, a colliding record, the definition key `__proto__`, and a record whose prototype is replaced (an object-literal `__proto__` key, or `Object.create(base)`, whose inherited definitions are never read) each throw `CLIError` before argv is read, and `.deprecated()` notices reach `onDeprecation` rather than a warning stream, since there is no output channel on this path.

  A pre-separator `--help` or `-h` prints generated help for the record to the adapter's stdout and exits with code 0, with the script named from the adapter's argv in the usage line. The built-in yields to a definition that claims the `help` or `h` spelling through a name, alias, negated form, or case-parity counterpart, and `help: 'off'` removes it entirely; `json` and `quiet` are never reserved, so a record may declare them as ordinary flags. `strict: false` drops undeclared argv content instead of rejecting it: unknown long flags with their inline `=value`, unknown short-group characters, positional arguments, and the `--` separator, while value tokens of declared flags survive under the parser's own consumption rules and misuse of a declared flag keeps its diagnostics.

  Positional arguments are not part of this API, and there is no synchronous variant: prompts, async validators, and filesystem checks make the result a promise. `readFlags`, `ReadFlagsOptions`, and `FlagMap` are exported from the package root, and [Standalone Flag Evaluation](https://dreamcli.kjanat.dev/guide/read-flags) walks the API with the build-script case it was added for.

- **Purpose-built positional argument kinds and string constraints** (https://github.com/kjanat/dreamcli/issues/87).\
  A base URL, an input file, or a cutoff date reads naturally as a positional, and until now the only route was `arg.custom()` re-implementing what `flag.url()` already did. `arg.url(options?)`, `arg.path(options?)`, `arg.date(options?)`, `arg.duration()`, and `arg.bytes()` mirror their flag counterparts: same value types, same option objects (`UrlFlagOptions`, `PathFlagOptions`, `DateFlagOptions`), same parsers. `arg.string()` takes a `StringConstraints` object, and string-kind `ArgBuilder`s carry `.nonEmpty()`, `.minLength()`, `.maxLength()`, and `.pattern()` alongside the numeric `.int()`, `.min()`, `.max()`, and `.finite()` they already had. Both factories run the same parse functions and the same constraint validator, so a value a flag accepts an argument accepts, and a rejection carries the same code and the same reason, differing in the subject: `for flag --x` versus `for argument <x>`.

  String constraints are enforced on CLI parse (`INVALID_VALUE`) and on stdin, env, config, and prompt resolution (`CONSTRAINT_VIOLATED`), both exit code `2`; as with flags, a `.default()` value is checked where it is declared and a violation throws `INVALID_DEFAULT`. `arg.path()` checks run after resolution through the runtime adapter's `stat`/`mkdir`, the same seam `flag.path()` uses, so a piped, env-sourced, config-sourced, prompted, or defaulted path is checked like one typed on the command line. A variadic argument validates every value it collects, path checks included. Argument values sourced from anywhere but argv stay redacted in the message, as in `Invalid value '<redacted>' from stdin for argument <x>` and `Invalid number value '<redacted>' from config deploy.port for argument <x>`, so the flag and argument messages are equivalent apart from their subjects.

  `ArgSchema` and the arg definition types carry `stringConstraints`, `pathChecks`, and `valueHint`. The first two are string-kind gated the way the flag schema gates them. Args serialize `numberConstraints`, `stringConstraints`, `pathChecks`, and `valueHint` into the definition document, which previously emitted none of them, and `generateInputSchema()` now surfaces arg string constraints as `minLength` / `maxLength` / `pattern`. The meta-schema hoists the `numberConstraints`, `stringConstraints`, and `pathChecks` fragments into `$defs` so the flag and arg definitions reference one copy. All of it is additive at `schemaVersion: 1`. Help still renders a positional by its own name rather than its `valueHint`, so `mycli copy <src> <dst>` does not collapse into `<path> <path>`.

  The flag-only surface stays flag-only, and [the arguments guide](https://dreamcli.kjanat.dev/guide/arguments#flag-only-surface) lists it with the reason for each entry. `boolean`, `count`, `negatable`, `alias`, `duplicates`, `separator`, `unique`, and `propagate` are bound to flag syntax; `array` is served by `.variadic()`. `keyValue` merges repeated occurrences into one record, which a positional slot cannot express, and `arg.custom()` with a Standard Schema validator is the documented route. `.config()` and `.prompt()` are no longer among them: both surfaces now declare the same sources, described in the unified source model entry below.

- **A unified source model — every input uses the same source order**\
  Flags and args now declare sources from the same set and resolve declared sources through one ordered chain: `CLI -> stdin -> env -> config -> prompt -> default`. `arg.config(path)` and `arg.prompt(config)` join `arg.env()`, so a positional reads a dotted config key and asks the user exactly as a flag does; the arg prompt table mirrors the flag one (`PromptConfigByArgKind`, `AllowedArgPromptConfig`), and an incompatible pairing throws `CONSTRAINT_VIOLATED` naming `<arg>`. Help annotates a positional with `[config: PATH]` and `[prompt]` beside the `[env: VAR]` it already showed. `flag.string().stdin()` becomes legal on `string`, `number`, `boolean`, `enum`, and `custom` flags, giving `echo hi | mycli send` and `mycli send --body -` the meaning `arg.stdin()` already had. `.stdin()` takes `{ when: 'dash' | 'missing' | 'dash-or-missing', consume: 'exclusive' | 'broadcast' }` on both surfaces, defaulting to `dash-or-missing` and `exclusive`. `StdinBinding`, `StdinOptions`, `StdinWhen`, and `StdinConsume` are exported from the package root, and `StdinBindingFragmentV1` names the serialized form.

  An explicit `-` is CLI-sourced with bytes from stdin and keeps CLI precedence; an absent input takes the stdin fallback stage, which sits ahead of env, so a flag set in the environment still reads a pipe and the pipe wins. The `-` sentinel now survives the parse boundary for every kind, so `flag.number().stdin()` accepts `--port -` where it used to reject `-` as a malformed number. `readFlags()` carries the same contract and reads stdin only through the adapter, only when a declared `.stdin()` flag would actually select it; `runCommand()` feeds the identical path from its `stdinData` option. Stdin is read at most once per invocation, and only when resolution will select it: `when: 'dash'` reads on `-` alone, `when: 'missing'` reads on an absent input alone, and env, config, prompt, and a default never suppress the read.

  One command has one exclusive stdin consumer. Declaring a second stdin input of any kind, flag or arg, throws `DUPLICATE_STDIN_INPUT` on both construction paths; `{ consume: 'broadcast' }` on every stdin input opts into sharing one buffer among them. The definition document carries the binding as `stdin: { when, consume }` on flags and args, with a `stdin` entry in the meta-schema `$defs`, and the arg fragment gains `configPath` and `prompt`.

- **Cardinality is its own axis, with per-source splitting.**\
  How many values an input carries (`one`, `many`, `entries`, `count`) is now decided separately from what each value means, so every source fills a collection by the same rules. `.split({ cli, env, stdin })` on `flag.array()`, `flag.keyValue()`, and the arg builders sets each source's decoding independently: a delimiter or `'whole'` for CLI tokens, a delimiter, `'whole'`, or `{ format: 'json' }` for env values, and `'lines'`, `'whole'`, a delimiter, or `{ format: 'json' }` for the stdin buffer. Defaults are whole CLI tokens (or the `.separator()` delimiter), comma-delimited env values, and line-delimited stdin; a config value stays a native array or object, and a config string decodes under the env policy. JSON is never guessed. `SplitOptions`, `SplitSetting`, `SplitPolicy`, `SplitBinding`, `SourceSplitBinding`, and `SplitFormat` are exported from the package root, and the definition document carries `split` on flag and arg fragments as `SourceSplitFragmentV1` / `SplitPolicyFragmentV1`.

- **Collections read stdin, and `-` splices into occurrence order.**\
  `flag.array()` and `flag.keyValue()` accept `.stdin()`, and a `-` occurrence stands for the whole stdin source at the position it holds: `--tag before --tag - --tag after` over `a\nb\n` resolves to `['before', 'a', 'b', 'after']`. An explicit `-` and the implicit fallback decode identically, entries splice the same way, and the duplicate-key policy applies across the whole spliced order. Broadcast consumers each decode the one shared buffer under their own binding, so a line-split array flag and a JSON key-value flag can read the same pipe.

- **`.duplicateKeys()` on key-value inputs.**\
  `'last'` (the default), `'first'`, or `'error'` decides what a repeated key means, on every source rather than only on repeated CLI occurrences. A repeat under `'error'` reports `CONSTRAINT_VIOLATED` naming the key. `DuplicateKeys` is exported from the package root and the policy is serialized as `duplicateKeys`.

- **`arg.boolean()` and `arg.keyValue()`.**\
  A positional carries no presence semantics, so `arg.boolean()` consumes an explicit `true`/`false` (or `1`/`0`) token through the shared boolean codec, widening to `yes`/`no` and an empty string only for env, config, stdin, and prompt values. `arg.keyValue()` consumes `KEY=VALUE` tokens and resolves to `Record<string, string>`, splitting at the first `=`; the variadic form aggregates the whole tail into one record. `BooleanArgDefinition` and `KeyValueArgDefinition` join the definition types, and `ArgKind` gains `'boolean'` and `'keyValue'`.

- **Element-level sugar inside collections.**\
  Path checks and constraints belong to the element, so `flag.array(flag.path({ mustExist: true }))` checks every collected element and `flag.keyValue(flag.path())` checks every entry value. `flag.keyValue()` takes an optional element builder, and `flag.path()` is now element-eligible.

- **`.standard()` on both builders, split into element and aggregate validation.**\
  A validator declared on an element builder (`flag.array(flag.string().standard(s))`) validates each item or entry value; one declared on a builder that already aggregates (`flag.array(flag.string()).standard(s)`, `arg.string().variadic().standard(s)`) validates the completed array or record after every element passed. Element issues name the element (`--tag[1]`, `--vars.KEY`). Sync and async validators are both awaited, and every source runs the same pipeline.

- **`.unique()` and `.separator()` on args.**\
  A variadic arg deduplicates with the same `SameValueZero` semantics an array flag uses, and splits each positional token on the CLI separator it declares.

### Changed

- **Breaking: flag diagnostics redact every value resolved outside a literal CLI value.**\
  A stdin, environment, config, or prompt value that failed to coerce used to be printed and stored under `details.value` on the flag surface, while the argument surface already redacted it. Both surfaces now report `Invalid value '<redacted>' from env API_TOKEN for flag --token: must match /^ghp_/` and omit `value` from `details`. Everything that identifies the failure stays: the input name, the source, the expected type, the constraint that failed with its bound or pattern, the allowed enum values, and a custom parse function's own message. A Standard Schema validator's `CONSTRAINT_VIOLATED` failure follows the same rule: `details.value` is recorded only for a value typed on the command line, and omitted for one a pipe, an explicit `-`, the environment, a config file, or a prompt supplied. A literal CLI value is untouched, since it is already on the user's screen. Every coercion failure now also carries `source: 'env' | 'config' | 'stdin' | 'prompt'` in `details`, which is what labels an issue `[env API_TOKEN]` in an aggregate error and what now gives the argument surface the same label the flag surface had. The `flag.path()` and `arg.path()` filesystem checks read the same rule, so a path a pipe, an explicit `-`, the environment, a config file, a prompt, or a declared default supplied reports `Path '<redacted>' for flag --key does not exist` and omits `value` from `details`; a path typed on the command line is still quoted in full. Every element of a collection of paths is checked and redacted individually.

- **Breaking: a positional declared after a variadic one is a build error.**\
  A variadic argument consumes every remaining positional, so anything registered behind it could never be filled and a second variadic one had nothing left to collect. Both silently produced an argument that stayed empty. `.arg()` and `createCommandSchema()` now throw `INVALID_BUILDER_STATE` (`Argument <target> comes after variadic argument <files>, which consumes every remaining positional`), with the command under `command`, the offending argument under `arg`, and the greedy one under `variadicArg`, so a definition tree names the nested command that declared the pair. Move the variadic argument last.

- **Breaking: an explicit `-` with nothing piped is an error inside a collection.**\
  `--tag a --tag - --tag b` with an empty pipe used to resolve to `['a', 'b']`, dropping the occurrence the user typed. It now fails with `MISSING_STDIN` and the message `No piped stdin for the '-' occurrence of flag --tag`. Occurrences of nothing but `-` are unchanged: they are the whole value, so they still fall through to env, config, prompt, and the default, exactly as an absent input does, and the implicit `when: 'missing'` fallback that simply does not fire stays silent. A scalar `-` falls through for the same reason. Only a collection could be silently shortened, so only a collection errors.

- **Breaking: the arg collection modifiers require a collection.**\
  `createArgSchema('string', { unique: true })` and its siblings used to build, storing a field nothing would read. They now state their requirement to the compiler and throw `INVALID_SCHEMA` from `createArgSchema()`: `separator` and `split` want a variadic argument or `arg.keyValue()`, `unique` a variadic argument of a list kind, and `duplicateKeys` `arg.keyValue()`. The values a schema already stores as its own default, `unique: false` and `duplicateKeys: 'last'`, stay accepted on any kind, so a built `ArgSchema` fed back through the factory round-trips. This mirrors the `array | keyValue` restriction the flag surface already had. Drop the field, or add `variadic: true` alongside it. The matching builder methods are new in 4.0, so only definitions composed as data change.

- **Breaking: `.stdin()` and `.variadic()` on one argument is now legal.**\
  The pairing threw `INVALID_BUILDER_STATE`; the tail-splicing entry under Added describes what it does instead. Code that relied on the throw has nothing to catch.

- **Breaking: declared defaults are validated.**\
  A `.default()` value is already the typed value, so it is validated rather than decoded: the codec's own domain, string and number constraints, element and aggregate Standard Schema validators, the shape the cardinality requires, and the collection rules all apply to it. Purely synchronous violations throw `INVALID_DEFAULT` where the chain declares them, so `flag.string({ minLength: 3 }).default('ab')` and `flag.number().default(Number.POSITIVE_INFINITY)` now fail at construction instead of reaching a handler; a constraint added after the default (`flag.string().default('ab').minLength(3)`) is checked too, as is a validator (`.standard()`). On the definition path, where no compiler stands in the way, the domain check also rejects a default of the wrong primitive type and an `enum` default outside `enumValues`. Asynchronous validators and `flag.path()` filesystem checks stay at resolution time, where command resolution awaits the validator or probes the path. Code relying on a default that violates its own declaration either fixes the default or widens the constraint (`flag.number({ finite: false })` still accepts `Infinity`).

- **Breaking: `.separator()` sets the CLI delimiter alone.**\
  Env and config string values used to inherit it, so `.separator('|')` silently changed how an env var decoded. Env values split on `','` unless `.split({ env })` says otherwise. The stdin buffer splits on line terminators by default; `.split({ stdin })` can select `'whole'`, `'json'`, or a delimiter instead. Config arrays and objects remain native; config strings use the env split policy. `.separator('|')` becomes `.split({ cli: '|', env: '|' })` where the old coupling was intended.

- **Breaking: `FlagSchema` and `ArgSchema` carry the cardinality axis.**\
  `FlagSchema` gains `split`, `duplicateKeys`, and `aggregateStandard`; `ArgSchema` gains `separator`, `split`, `duplicateKeys`, `unique`, and `aggregateStandard`. `elementSchema` and `separator` are valid on `keyValue` as well as `array` flags, `standard` is valid on every kind, `aggregateStandard` only on a kind that aggregates, and `stdin` is valid on scalar and collection kinds. Definition documents serialize the new fields additively at `schemaVersion: 1`, which has not shipped, with `split` and `splitPolicy` entries in the meta-schema `$defs`.

- **Breaking: `.default()` on a variadic arg takes the array.**\
  The type parameter followed the element type, so the only value that compiled was a single element, which is not what a variadic arg resolves to. It now follows `ArgDefaultValue`, the value the arg actually produces: `arg.string().variadic().default(['a', 'b'])`, and a record for `arg.keyValue()`. `ArgDefaultValue` is exported from the package root.

- **Breaking: `ArgSchema.stdinMode` is now `ArgSchema.stdin`**\
  The boolean carried no room for the trigger and sharing modes the unified source model needs, so it is replaced by `stdin: StdinBinding | undefined`. `.stdin()` is unchanged for callers who pass no options and keeps its exact resolution behavior. Code reading the schema directly reads `schema.stdin !== undefined` where `schema.stdinMode` used to be, and a definition passed to `createArgSchema()` or `createCommandSchema()` writes `stdin: {}` instead of `stdinMode: true`. The definition document changes to match: the arg fragment emits `stdin: { when, consume }` in place of `stdinMode: true`, at `schemaVersion: 1`, which has not shipped.

- **Breaking: `DUPLICATE_STDIN_ARG` is now `DUPLICATE_STDIN_INPUT`**\
  The rule covers flags as well as args, and a flag-versus-flag conflict reporting an arg-shaped code would be a lie. The message reads `Only one input may consume stdin exclusively; <name> already consumes stdin`, naming the input that was declared first. `details` names the offending input under `flag` or `arg` and the existing one under `existingFlag` or `existingArg`.

- **Breaking: stdin values reach non-string codecs without their trailing line terminator**\
  The stdin source hands the whole buffer over byte for byte, so `echo hi | mycli` still gives a `string` input `'hi\n'`. Every other codec interprets the text, where a terminator a pipe appended is framing rather than value, so one trailing `\n`, `\r\n`, or `\r` is dropped before decoding. `echo true | mycli` now resolves a boolean input to `true`, `echo 1h30m` to a duration, and `echo eu` to an enum member; all three used to fail. A number input is unaffected, since `Number()` already ignored the terminator. Stdin also stops borrowing the prompt widening table: it accepts exactly what an env value accepts, so the prompt-only `y` and `n` boolean spellings are rejected.

- **Breaking: a number input rejects blank text instead of reading it as zero.**\
  `Number('')` and `Number('  ')` are both `0`, so `PORT= mycli serve`, `printf '\n' | mycli serve`, and a config key holding `""` all resolved a number input to `0` without a word. All three now fail with `TYPE_MISMATCH` and the same `Invalid number value '<redacted>' from …` diagnostic any other unreadable value gets, and `mycli serve --port ''` fails at the parse boundary where it quotes the token. Whitespace around a real number is still ignored, so `' 42 '` and `'42\n'` are unaffected. A `count` flag already guarded this; the number codec now does too. Set the variable, or drop it and let the default apply.

- **Breaking: `CLISchema.commands` and `CLISchema.defaultCommand` hold `CommandSchema`**\
  Both used to hold `ErasedCommand` wrappers carrying the action handler and an `_execute` function. The execution graph now lives beside the schema instead of inside it, so `app.schema.commands[0]` is the command schema itself: read `app.schema.commands[0].name` where `app.schema.commands[0].schema.name` used to be needed. `ErasedCommand` is gone.

- **Breaking: `CLISchema.plugins` removed**\
  Plugins are execution state, not a description of the program, and `.plugin()` no longer writes to the schema. Registration, order, and hook behavior are unchanged.

- **Breaking: `CLIBuilder` is factory-only**\
  Its constructor is private, so `new CLIBuilder(schema)` no longer compiles. Call `cli(name)` or `cli({ ... })`; every builder method still returns a new builder.

- **Breaking: `CommandSchema.middleware` removed** — the executor builds the handler chain from the builder's ordered execution steps, so registration order, handler identity, and runtime behavior are unchanged. `CommandDefinition` no longer accepts a `middleware` key, and `createCommandSchema()` no longer emits one.

- **Breaking: `FlagSchema`, `ArgSchema`, and `CommandSchema` are sealed** — all three carry a private brand, so an object literal assembled by hand no longer type-checks where a schema is expected. Call `createFlagSchema()`, `createArgSchema()`, or `createCommandSchema()` with a definition object to obtain one; spreading a built schema keeps the brand, so `{ ...schema, description }` still type-checks. `createSchema()` was renamed to `createFlagSchema()`, which validates its fields against the kind and normalizes a nested `elementSchema`.

- **Breaking: `createCommandSchema()` validates what the builder validates** — a definition whose flags share a name, an alias, or a negated spelling on one command now throws `FLAG_NAME_COLLISION`, and a flag spelled the same way as one propagated from an ancestor command throws `PROPAGATED_FLAG_COLLISION`. The whole tree is checked, nested subcommands included. Commands built with `command()` already refused these at `.flag()` and `.command()`; a definition composed as data used to build without complaint and then answer the shared spelling with one flag only. Two flags both aliased `v` still parsed under `--verbose` and `--version`, help listed `-v` on both, and `-v` set the second. The arg invariants moved with them, so a definition declaring a positional after a variadic one throws `INVALID_BUILDER_STATE`, and a second stdin-backed input throws `DUPLICATE_STDIN_INPUT`, matching `.arg()`. Previously, both combinations built without complaint. Two stdin-backed args each resolved to the whole of stdin, and a positional behind a variadic one silently never filled. Every arg error names the command in `details`, since a definition tree reaches them at any depth and the arg name alone does not say which command declared it. A flag or arg named `__proto__` now throws `INVALID_SCHEMA` from both the factory and the builder, the check `readFlags()` already applied to its definitions record. The factory and `.arg()` used to accept the key, which sets a prototype rather than an entry, so the flag or the value the user typed disappeared; `.flag()` used to report `FLAG_NAME_COLLISION` against a flag the command never declared. A flag record whose prototype is replaced throws `INVALID_SCHEMA` too, since only its own keys are read: an object-literal `__proto__` key lands there, and so does `Object.create(base)`, whose inherited flags the factory silently dropped. `createCLISchema()` normalizes its commands through the same factory and inherits every check, and `readFlags()` reports the same errors it always did.

- **Breaking: `CLISchema` and `ConfigSettings` are sealed** — both carry a private brand, so an object literal assembled by hand no longer type-checks where either is expected. Call `cli()` for an executable program or `createCLISchema()` for a description; spreading a built schema keeps the brand, so `{ ...app.schema, name }` still type-checks. `createCLISchema()` throws `INVALID_SCHEMA` on an empty name, which `cli('')` now does too.

- **Breaking: `createArgSchema()` validates its fields against the kind** — the second parameter is now `ArgDefinitionOverrides<K>` rather than `Partial<ArgSchema>`, so `enumValues` on a `string` arg (and the other kind-scoped fields) stops compiling and throws `INVALID_SCHEMA` at runtime. `enumValues` is required on an `enum` arg. A single definition object (`createArgSchema({ kind: 'enum', enumValues })`) is accepted as well.

- **Breaking: `Out` gained a required `verbosity` member** — action handlers can read `out.verbosity`, and `resolveRenderContext()` exposes the same `verbosity` decision for custom content built before `.run()` (including `--`-aware `--quiet`/`-q` detection). A hand-rolled `Out` object literal stops compiling until it declares one; migrate to a real channel from the testkit and spy on it instead:

  ```ts
  const [out] = createCaptureOutput();
  vi.spyOn(out, 'info');
  ```

  Do not spread a channel (`{ ...out, info: vi.fn() }`) — its methods are non-enumerable bound copies, so the spread result has none of them.

- **Breaking: `Out` and `RenderContext` are sealed** — both interfaces now carry a private brand, so implementing or structurally constructing them outside the framework no longer type-checks. They are framework-created, non-exhaustive values: obtain instances from action parameters, `createOutput()`, `createCaptureOutput()`, or `resolveRenderContext()`, and expect new readonly members in minor releases. Helpers that only need a subset can accept `Pick<Out, 'info' | 'status'>`-style capability types.

- **Breaking: internal execution fields left `RunOptions` and `CLIRunOptions`** — `out`, `captured`, `mergedSchema`, `meta`, and `plugins` were framework-populated fields marked `@internal` yet shipped on the public option types. They now live on unexported internal execution options; code passing them to `runCommand()` or `.execute()` stops compiling. Inject writers via `createCaptureOutput()` options or `OutputOptions.stdout`/ `stderr` instead of replacing the channel wholesale.

- **Breaking: `.execute()` takes `CLIExecuteOptions`**. The new root export carries the process-free option surface and has no `adapter` member; passing one to `.execute()` stops compiling. `CLIRunOptions` now extends `CLIExecuteOptions` with `adapter`, and `.run()` remains the only method that accepts it.

- **Breaking: `CommandConfig` and the root `AnyCommandBuilder` export removed**. `CommandConfig` described the builder's type-level accumulator shape but no signature referenced it. `AnyCommandBuilder` is `@internal` erasure machinery that appears only on `CommandBuilder`'s underscore members, so the package root no longer exports the name.

- **Breaking: the canonical `$schema`/`$id` for definition documents is self-hosted and format-versioned**\
  <https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json> replaces the jsDelivr URL in `generateSchema()` output and in `definitionMetaSchema.$id`. The `v1` segment tracks the definition format, so it stays valid for every package release that emits `schemaVersion: 1`, and it is permanent once published. The `@kjanat/dreamcli/schema` subpath and the jsDelivr URL keep serving the same bytes as mirrors. Documents pinned to the old URL still validate against a local copy but no longer match the meta-schema's `$schema` constant.

- **Breaking: a command flag spelled like a root-owned flag now throws `RESERVED_FLAG` at build time** (https://github.com/kjanat/dreamcli/issues/84).\
  The root removes `--json` and `--quiet`/`-q` from argv before dispatch, intercepts `--version`/`-V` once a version is configured, and renders help for `--help`/`-h` before a command's flags are parsed. A command declaring one of those spellings used to build, run, and render help while its flag stayed permanently at its default value. `.command()`, `.default()`, `.version()`, `.manifest(data)`, and `createCLISchema()` now reject it with `CLIError` code `RESERVED_FLAG`, checking each flag's canonical name, its aliases (hidden ones included), and its custom negated spelling (`.negatable({ alias: 'quiet' })`) through the whole nested subcommand tree. The error names the colliding flag and the root flag that shadows it, and suggests renaming, or `out.status()` for output that root `--quiet` suppresses. Near misses such as `jsonOutput` or `quietMode` stay legal, the default `--no-<name>` spelling never collides, and `version`/`V` stay available to a CLI that declares no version.

- **`--completions` collision detection now covers negated spellings and the definition path.**\
  `.negatable({ alias: 'completions' })` and a `createCLISchema()` definition carrying `completionsFlag` both used to build a CLI whose command flag the planner intercepted. Both now throw `CLIError` code `RESERVED_FLAG`, matching what `.completions({ as: 'flag' })` already rejected on the builder.

### Removed

- **Breaking: `.packageJson()`** — deprecated since [2.5](#250---2026-06-28).\
  Use `.manifest()`, which defaults to `files: ['package.json']` and accepts the same pre-loaded data object.

- **Breaking: `.denoJson()`** — deprecated since [2.5](#250---2026-06-28).\
  Use `.manifest({ files: ['deno.json', 'deno.jsonc', 'jsr.json'] })`.

- **Breaking: `ManifestPresetSettings`**\
  The settings type of the two removed presets. Use `ManifestSettings`, which adds `files`.

- **Breaking: `PackageJsonSettings`**\
  The deprecated alias for `ResolvedManifestSettings`, the shape stored in `CLISchema.packageJsonSettings`. The schema field itself is unchanged.

- **Breaking: `discoverPackageJson()`** — deprecated since [2.5](#250---2026-06-28).\
  Use `discoverManifest(adapter, { startDir, files: ['package.json'] })`; `files` already defaults to `['package.json']`.

### Fixed

- **A variadic argument could not take the prompt its flag twin takes.** The argument prompt gate read the kind discriminator alone, so `arg.string().variadic().prompt({ kind: 'multiselect' })` was rejected with `Prompt kind 'multiselect' is not compatible with string argument <files>` while `flag.array(flag.string()).prompt({ kind: 'multiselect' })` resolved, and the scalar `input` and `select` kinds the flag surface rejects were accepted, resolving a one-element array. The gate now reads the cardinality: an argument that collects several values takes `multiselect`, and names itself `variadic string argument <files>` when it reports a mismatch. `AllowedArgPromptConfig<C>` follows the same rule, so the compiler agrees.

- **A collection given a config value of the wrong shape said less on the argument surface.** `flag.array(...).config('p')` over `{ p: 5 }` reported `Invalid array value from config p for flag --tags`; the positional twin reported `Invalid value '<redacted>' from config p for argument <tags>`, naming neither the shape nor a value it actually held. Both surfaces now word it `Invalid array value` / `Invalid object value`, so the byte-for-byte wording rule in [Diagnostics and redaction](https://dreamcli.kjanat.dev/guide/semantics#diagnostics-and-redaction) holds for the collection faults too.

- **A builder could produce a schema its own factory refuses.** Each modifier states the kinds it belongs to through a `this` constraint, which the compiler enforces and a JavaScript caller does not see, so `flag.string().separator(',')` built a string flag carrying a CLI delimiter and emitted a definition document `createFlagSchema()` then rejected with `INVALID_SCHEMA`. Twelve modifiers on the flag surface and eleven on the argument surface behaved this way. Every builder modifier now runs the same check `createFlagSchema()` / `createArgSchema()` run, so what a builder produces is always a definition the framework reads back. A test calling such a modifier through `@ts-expect-error` and expecting it to build needs `expect(...).toThrow()`.

- **The normalization factories accepted a kind they have no arm for.** `createFlagSchema('nope')` and `createArgSchema('count')` built a schema whose discriminator is outside `FLAG_KINDS` / `ARG_KINDS`, which every exhaustive `switch (schema.kind)` downstream falls through. The types forbid the call, but a JavaScript caller reached it, and the keyValue prompt gate showed such a schema can reach a shipped diagnostic. Both factories now throw `INVALID_SCHEMA` with `Unknown flag kind 'nope'` / `Unknown arg kind 'count'`, listing the allowed kinds in `details.allowed`, on the two-argument path, the definition path, and a nested `elementSchema`.

- **`flag.array()` with no element threw a raw `TypeError`.** The factory read `.schema` off the element it was handed, so a JavaScript caller omitting it got `Cannot read properties of undefined` instead of a framework error. It now throws `INVALID_SCHEMA` with `flag.array() requires an element builder`. `flag.keyValue()` and `arg.keyValue()`, whose element is optional, apply the same check to an element that is supplied.

- **A positional cut a parse function's message at its last colon.** Off argv, the argument surface rebuilt the reason for a failure by scanning the message the flag surface had already written, keeping only the text after the final `": "`. Anything a parse function put before a colon was lost, and a reason whose own tail held a colon was dropped whole: `arg.url({ protocols: ['https'] })` reported `Invalid value '<redacted>' from env ENDPOINT for argument <endpoint>: https`, and `arg.date()` reported no reason at all. `arg.duration()`, `arg.bytes()`, and every `arg.custom()` whose error text carries a colon were affected the same way. Each surface now words its own diagnostic from the value layer's verdict, so the reason reaches the argument surface whole.

  A parse-function failure off argv is also worded the way the flag surface and the command line already word it, so `Failed to parse env ENDPOINT for argument <endpoint>: URL protocol 'http' is not allowed. Allowed: https` replaces the `Invalid value '<redacted>' …` opening, which announced a redaction in the same sentence that printed the parse function's own text. A test asserting the old opening for a non-argv `arg.url()`, `arg.date()`, `arg.duration()`, `arg.bytes()`, or `arg.custom()` message needs the new one.

- **A positional withheld what a type mismatch expected.** For a value no boolean codec could read, the flag surface reported `Invalid boolean value '<redacted>' …` and suggested `Set VAR to true/false, 1/0, or yes/no`, while the argument surface reported `Invalid value '<redacted>' …` and suggested only `Set VAR to a valid boolean`, which is the question rather than the answer. A string a config object could not fill carried no `expected` field and no suggestion at all on the argument surface. Both now match the flag surface: the message names the type, the details carry `expected`, and the suggestion names what the codec reads.

- **An argument kind with no compatible prompt was told to use `undefined`.** `createArgSchema({ kind: 'keyValue', prompt: … })` reached the prompt gate, which took the first allowed prompt kind from an empty list and reported `Prompt kind 'input' is not compatible with keyValue argument <vars>. Use 'undefined' instead` with `Change the prompt to { kind: 'undefined' }`. The flag surface already had a branch for a kind that is not promptable at all; both surfaces now share it and report `keyValue arguments are not promptable` with `Remove the prompt config for <vars>`.

- **A key-value input told the user to write an array.** A config value of the wrong shape for `flag.keyValue()` or `arg.keyValue()` reported `Invalid array value from config c for flag --vars` with `expected: 'array'` and `Set c to an array in your config`, which is not what an entries input accepts and, for a config value that already was an array, not even a change. The fault now carries the shape the cardinality wants: an entries input reads `Invalid object value …` with `expected: 'object'` and `Set c to an object in your config` on the flag surface and `Use KEY=VALUE for <vars>` on the argument surface. A list input is unchanged.

- **Five types the stability page classified as public were exported from nowhere.** `NodeProcess`, `DenoNamespace`, and `GlobalForDetect` are the host objects `createNodeAdapter()`, `createDenoAdapter()`, and `detectRuntime()` accept, and the page attributes all three to `@kjanat/dreamcli/runtime`, which exported none of them; a caller injecting a host could not name the parameter type. `StringArgElementConfig` and `WithoutArgElementEligibility` sat in the same sentence as `StringElementConfig`, which the root entrypoint does export. All five are now exported, along with the flag-side `WithoutElementEligibility` its argument twin mirrors.

- **A definition document, its input schema, and help all dropped a default the schema still resolved.** `generateSchema()`, `generateInputSchema()`, and `formatHelp()` each reported a default only for `presence: 'defaulted'`, but resolution uses any `defaultValue` a schema carries, and `createFlagSchema({ kind: 'string', defaultValue: 'dist' })` keeps `presence: 'optional'`. A document emitted from such a schema decoded back to a flag with no default, so a round trip through the format changed behavior; the input schema omitted `default`, and help omitted `(default: dist)` for a flag that does resolve one. All three now report the default whenever the schema carries one, on both surfaces, whatever the presence. Builder-authored schemas are unaffected, since `.default()` sets the defaulted presence.

  Help no longer calls such an input required either. A default binding always produces a value, so neither `REQUIRED_FLAG` nor `REQUIRED_ARG` can fire for a schema carrying a `defaultValue`, yet `flag.string().default('dist').required()` rendered `[required]` and hid its own default while the positional twin rendered `(default: prod)` and still demanded a token as `<target>`. A `defaultValue` now suppresses the `[required]` marker and the angle brackets on both surfaces; an input without one is unchanged.

- **A duplicate key leaked its text from every non-argv source.** Under `.duplicateKeys('error')`, `Duplicate key 'DB_PASSWORD' from env VARS for flag --vars` quoted the key in the message, in `details.key`, and in `suggest`, whatever source carried it. A key is half of a `KEY=VALUE` pair, so it is value text from that source, and the same pair reported `Invalid key-value pair '<redacted>'` when it failed to split instead. The key is now quoted only for occurrences the user typed on the command line; stdin, env, config, and prompt read `Duplicate key '<redacted>'`, carry no `key` in `details`, and suggest `Set the repeated key once`. Both surfaces follow the rule.

- **A flag reported a JSON shape fault in the wrong order.** `Invalid JSON value, expected an object from env VARS for flag --vars` put the expectation between the fault and the source that carried it. The flag surface now words it as the argument surface already did: `Invalid JSON value from env VARS for flag --vars, expected an object`.

- **`ArgElementFragmentV1` was documented as public but exported from nowhere.** `stability.md` classifies it with the other version 1 fragment types and `schema-export.md` names it as the shape of an arg `elementSchema`, but the type never reached `@kjanat/dreamcli`. It is exported now, alongside its siblings.

- **A default rejected on a vowel-initial kind read `a array`.** The construction-time `INVALID_DEFAULT` message built its subject with a fixed article, so `createFlagSchema('array', …)` and `createFlagSchema('enum', …)` produced `Default value for a array flag` and `Default value for a enum flag`. Both now read `an`.

- **A duplicate key the user typed said it came from stdin.** Under `.duplicateKeys('error')`, a repeat among CLI occurrences was worded `Duplicate key 'A' from stdin for flag --v`, naming a source the value never had, on a command with no pipe at all. CLI occurrences now name no source (`Duplicate key 'A' for flag --v`), and a key a `-` occurrence spliced in still reads `from stdin`. Each occurrence carries its own source through aggregation, so a collection filled from both names whichever one carried the repeat. `details` no longer claims `source: 'stdin'` for a typed token, and the arg surface follows the same rule with `for argument <vars>`.

- **`flag.count().stdin()` threw only on the definition path.** The builder method is blocked by its `this` constraint at compile time and `createFlagSchema('count', { stdin: {} })` throws `INVALID_SCHEMA`, but a JavaScript caller reaching the builder got a count flag carrying a stdin binding no stage would ever read. The builder now throws the same error, with the same message and code. In 3.x neither path complained: `createSchema()` stored `stdinMode: true` on a count flag and `.stdin()` did not exist on the count builder at all.

- **Flags named after `Object.prototype` members were rejected as duplicates** — `.flag('constructor')`, `.flag('toString')`, `.flag('valueOf')`, and every other `Object.prototype` member name failed with a `FLAG_NAME_COLLISION` claiming the command already declared the flag, on commands that declared no flags at all. `collectPropagatedFlags()` read its descendant records the same way, so a propagated flag with one of those names would have stopped at every intermediate subcommand, and `resolveFlags()` read an `.interactive()` resolver's override record the same way, so the inherited method reached the prompt gate as a config and failed the command with `CONSTRAINT_VIOLATED`. `.flag()` refused the name first, so no 3.x CLI ever got that far. Every one of those reads now tests own keys only, so all eleven of those names behave like any other and `createCommandSchema()` accepts the schemas `command()` produces. `__proto__` is the one `Object.prototype` name still rejected, with `INVALID_SCHEMA` on both construction paths, listed under Changed above.

- **An env var named after an `Object.prototype` member always read as set** — `.env('toString')` on a flag, or on an arg, looked the name up on the env record without checking own keys, so an unset variable resolved to the inherited method and failed coercion instead of falling through to config, prompt, or default. Both lookups now test own keys.

- **`.run()` never read stdin for an arg named after an `Object.prototype` member** — the precheck that decides whether to read stdin looked the arg name up on the parsed positionals without checking own keys, so an arg such as `.arg('toString', arg.string().stdin())` looked already supplied. `.run()` skipped the read and the command failed with `Missing required argument` however much was piped to it. The lookup now tests own keys. `.execute()` and the testkit take `stdinData` from the caller and were never affected.

- **`out.table()` printed a native method for a column key named after an `Object.prototype` member** — a column keyed `toString`, `constructor`, or any other member name read the row with a bare lookup, so a row that carried no such key rendered `[Function: toString]` in place of the empty cell every other missing key produces. Dynamic rows typed as `Record<string, unknown>` are the reachable case, including columns inferred from a first row that does carry the key. Both the text renderer and the JSON projection now treat a key that only `Object.prototype` carries as absent. A key held anywhere earlier in the row's prototype chain still renders, so a class getter and an `Object.create(defaults)` fallback reach the table as before.

- **A Standard Schema validator ran against a native method on a failed resolution** — when a required flag or arg was missing, `resolve()` still ran the Standard Schema pass before rethrowing, over a values record the failed resolver had left empty. The pass read each declared name without checking own keys, so a flag or arg named after an `Object.prototype` member handed its `flag.custom()` / `arg.custom()` validator the inherited method. The user saw a second, invented `CONSTRAINT_VIOLATED` beside the real error. The pass now tests own keys.

- **Quiet mode leaked spinner and progress output** — activity handles now resolve to no-ops under quiet verbosity, including interactive TTYs and explicit static fallbacks. Consumers can route informational rows through `out.info()` and rely on DreamCLI to suppress the complete presentation layer without reading private output policy state.

- **`--json=true` and `--quiet=true` failed as unknown flags** (https://github.com/kjanat/dreamcli/issues/85). Both root flags now take a value the way `flag.boolean()` does. `true` and `1` enable, `false` and `0` disable, the last occurrence wins, and an invalid literal fails with the parser's `INVALID_VALUE` error and exit code 2 instead of `Unknown flag`. `--help`, `-h`, and `--version` still render ahead of that error, so a mistyped value never hides the text that documents the flag. Short `-q` keeps its presence-only form, matching short boolean flags at the command level. `runCommand()` from `/testkit` reads the same layer, and tokens after `--` still reach the command untouched.

## [3.0.1] - 2026-07-21

No library code changed; this release ships agent-facing material that was being built but never published.

### Added

- **The `cli-creation` skill now ships in the package** — `skills/` was absent from npm's `files` and JSR's `publish.include`, so consumers installing from either registry never received it.
- **Documentation lookup paths in the `cli-creation` skill** — `deno doc` against JSR (works whether the consumer installed from npm or JSR, including subpaths, `--json`, and `--filter`), plus the site's `llms.txt`, `llms-full.txt`, and `/raw/` markdown endpoints, so API shapes are read from the published package rather than recalled.

## [3.0.0] - 2026-07-21

The stable 3.0.0 release. It ships the code of 3.0.0-rc.20 plus the fix and documentation below; the complete v3 feature record lives in the rc.1 - rc.20 sections that follow. Upgrading from 2.x is covered by the new [upgrade guide](https://dreamcli.kjanat.dev/guide/upgrading-v3).

### Fixed

- **`runCommand()` rejected `--quiet`/`-q`** — the testkit gained the root-flag layer for `--json` in rc.1, but `--quiet` (added in rc.17) was never taught to it, so copying a real `mycli --quiet …` invocation into a test failed with `Unknown flag` (exit 2). Both spellings are now detected before the `--` separator, set quiet verbosity, and are stripped before parsing; a literal post-separator `--quiet` still reaches the command.
- **Mobile documentation hovers** — the twoslash bottom sheet collapsed to a 2px sliver (a transformed popper ancestor became the containing block for the fixed sheet), its backdrop stayed over the page after dismissal, and closing a popup disabled it permanently via an inline `display: none`.

### Added

- **Upgrade guide** — `docs/guide/upgrading-v3.md` documents every 2.5.0 → 3.0.0 breaking and behavioral change with before/after code.
- **Five new examples** covering the v3 surface: `flag-types.ts` (url, path with `create`, date, duration, bytes, count, keyValue, constraints, array separator/unique), `parser-control.ts` (negatable, duplicates, spelling parity), `standard-schema.ts` (Standard Schema v1 interop), `help-config.ts` (themes, `flagOrder`, routable default, JSON help), `output-extras.ts` (`out.color`, hyperlink gating, `setExitCode`).

### Changed

- **Examples modernized** — `basic.ts` uses function-form `.example()`, `json-mode.ts` and `middleware.ts` use `out.status()` and document `--quiet`, `transport-launcher.ts` replaces its hand-rolled port check with declarative numeric constraints.
- **`skills/cli-creation` rewritten for v3** — corrected stale grounding paths (`examples/standalone/`, `apps/docs/` no longer exist), rebuilt the pattern cookbook around the v3 surface with every snippet type-checked against the published types, and modernized the scaffolder templates (function-form examples, declarative numeric constraints instead of hand-clamping, `out.status()`, a `--quiet` test).
- **README refreshed** — the flag-types block lists the full v3 family (dropping the `flag.custom` URL sample that `flag.url()` superseded), the output sample shows `out.status()` / `out.setExitCode()` / `--quiet`, the completions sample covers the eager-flag form and fixes a `completion`/`completions` typo.

## [3.0.0-rc.20] - 2026-07-21

### Changed

- **ansispeck `^0.4.1`** — bumped from `^0.2.0` (npm dependency and JSR import map).

## [3.0.0-rc.19] - 2026-07-21

### Added

- **Expanded config discovery** (#61) — the default search now covers three scopes, first match wins, no merging:
  1. **Project**: the base directory (default `cwd`) and every ancestor up to the filesystem root, nearest first, each probed for `.{appName}.{ext}`, `{appName}.config.{ext}`, and the new `.config/{appName}.{ext}` convention.
  2. **User**: XDG / AppData as before, plus `~/Library/Application Support/{appName}/config.{ext}` on macOS.
  3. **System**: `/etc/{appName}/config.{ext}` on Linux and macOS.
- **`baseDir` discovery option** — `discoverConfig()` accepts a base directory to anchor the project-scope walk somewhere other than `cwd`.
- **`RuntimeAdapter.userConfigDirs` / `systemConfigDirs`** — optional ordered config roots supplied by the runtime adapters; discovery falls back to `[configDir]` / `[]` when a custom adapter omits them.

### Changed

- **Breaking**: `buildConfigSearchPaths(appName, options)` replaces the positional `(appName, cwd, configDir, loaders?)` signature; options carry `baseDir`, `userConfigDirs`, `systemConfigDirs`, and `loaders`.

## [3.0.0-rc.18] - 2026-07-21

### Added

- **`flag.path({ type: 'directory', create: true })`** — creates the directory (recursively) at resolution time when nothing exists at the path. Only available with `type: 'directory'`, enforced at the type level. Creation runs through a new `mkdir` seam: `RuntimeAdapter.mkdir`, overridable via run options, noop in the test adapter, so `src/core` stays process-free.

### Fixed

- **`flag.path({ type, mustExist: false })` rejected missing paths** — the builder recorded the explicit `mustExist: false`, but resolution errored on any missing path whenever path checks were active, making an optional to-be-created path (e.g. an `--outdir` that the command itself creates) impossible to declare. A missing path now passes when `mustExist` is `false`; an existing path is still type-checked.

## [3.0.0-rc.17] - 2026-07-20

### Added

- **`out.status()`** — a success/status line channel that writes to **stderr** (stdout stays clean for piping) and is suppressed under quiet verbosity. `info` remains stdout-bound; `warn`/`error` remain always-emitted.
- **Global `--quiet`/`-q` flag** — sets quiet verbosity on every CLI, wired like `--json`: detected and stripped at the root before dispatch (command schemas never see it), honoring the `--` separator so a literal `-q` positional reaches the command unchanged. Listed under root help's `Global options:`.

### Fixed

- **`.run()` misread a post-separator `--json`** — runtime preflight used a naive `includes('--json')`, so `mycli cmd -- --json` entered JSON mode via the adapter path even though `.execute()` correctly treats it as a positional. Preflight now uses the `--`-aware detection.

## [3.0.0-rc.16] - 2026-07-20

### Added

- **`resolveRenderContext(argv, options?)`** — pre-`run()` probe returning the output decisions the framework will make for a given argv: `jsonMode` (`--`-aware `--json` detection), `isTTY`, the gated `color` palette, and `isHyperlinkSupported`. Computed with the same composition `.execute()`/ `.run()` feed into the output channel, so content styled before `run()` — banners, hand-rendered help — matches the channel that will actually render, with zero argv re-parsing.
- **`includesBeforeSeparator` / `stripBeforeSeparator`** exported from the package root — the `--`-aware root-flag primitives, for consumers who only need correct flag detection.

## [3.0.0-rc.15] - 2026-07-20

### Added

- **Configurable flag order in help** — `.help({ flagOrder })` controls the `Flags:` table order: `'alphabetical'` (default, short-aliased flags first then alphabetical) or `'declaration'` (the order `.flag()` was called). For full control, `.help({ sortFlags: (a, b) => number })` supplies a custom comparator over flag names that wins over `flagOrder`. Both are also accepted at runtime via `execute`/`run` `help` options.

## [3.0.0-rc.14] - 2026-07-20

### Added

- **Function-form examples** — `.example()` now accepts a `(meta) => string` builder alongside the literal string. `meta` carries the invoked program `name` (`help.binName`, falling back to the command name) and `version`, resolved at render time, so examples reference the real program name instead of hardcoding it and stay truthful under symlinks, `inheritName`, and `npx x` vs a global install. The thunk resolves in both `--help` text (composing with example highlighting) and `--json`/definition-schema output.
- **`ExampleMeta`** and **`ExampleCommand`** public types for annotating function-form example builders.

## [3.0.0-rc.13] - 2026-07-20

### Changed

- **Syntax-highlighted example commands** — the `Examples:` help section now highlights each command per token: the leading binary via `usageBin` (bold) and flag tokens (`-x`, `--long`) via `flag` (cyan), with values left plain. Tokenizing is quote-aware so `--scope './a b'` stays one token, and the existing color gate is respected (identity formatters when `NO_COLOR` or non-TTY), so `stripAnsi(colored)` still equals the plain rendering.

## [3.0.0-rc.12] - 2026-07-20

### Added

- **`out.isHyperlinkSupported`** — resolved OSC 8 hyperlink gate on the output channel. Honors `NO_HYPERLINKS`/`FORCE_HYPERLINKS` and the `--no-hyperlinks`/`--hyperlinks` flags, falling back to `isTTY`. Consumers rendering their own `out.color.link(...)` output can gate on it to keep OSC 8 escapes out of piped or opted-out contexts.
- **Standard Schema v1 validation** — `flag.custom(schema)` and `arg.custom(schema)` accept any conforming validator (including callable, sync, and async schemas) with inferred output types and no runtime dependency. Validation runs after source resolution, so argv, env, config, prompt, stdin, and default values behave consistently; array flags and variadic args validate each element.
- **`isMainModule(import.meta)`**: Compatibility helper for consumers whose ambient `ImportMeta` interface omits `main`. Projects with normal Node, Bun, or Deno runtime typings can keep using the conventional `if (import.meta.main)` guard directly.

### Changed

- **`.manifest({ from: import.meta })` compatibility form**: Anchored manifest discovery now also accepts the calling module's complete `import.meta` object and extracts its URL internally. The conventional `{ from: import.meta.url }` form remains supported and preferred when runtime typings expose `url`. Together with `isMainModule(import.meta)`, the new forms avoid global `ImportMeta` augmentation, allowing consumers with an empty ambient `ImportMeta` interface to pass both TypeScript/Deno checks and JSR publish validation.

### Removed

- **Internal schema DSL** — the private template-literal parser, validator, and JSON Schema converter were replaced by direct definition-schema objects, removing roughly 1,500 lines without changing the generated schema.

### Fixed

- **`NO_HYPERLINKS` ignored in the help header** — root-help header hyperlinks gated on raw TTY status, so `NO_HYPERLINKS=1` (and `--no-hyperlinks`) still emitted OSC 8 links in the header. The gate now consults `out.isHyperlinkSupported`, which respects the standard hyperlink overrides.

## [3.0.0-rc.11] - 2026-07-15

### Fixed

- **JSR publish** — the Deno import map pinned `ansispeck` below `0.2.0`, so the JSR build resolved an ansispeck whose `createColors` rejected `osc8`'s two-argument call and failed type checking. The map now tracks `^0.2.0` alongside the npm dependency. (rc.10 published to npm only.)

## [3.0.0-rc.10] - 2026-07-15

### Changed

- **`osc8()` link text is optional** — it now defaults to the link target, so `osc8('https://x.dev')` renders as a hyperlink displaying its own URL. Terminals without OSC 8 support still show a usable address. Passing an explicit label is unchanged.
- **`osc8()` now delegates to `ansispeck`'s hyperlink constructor** — it emits the **ST** (`ESC \`) terminator instead of **BEL** (`\x07`). Both are valid OSC 8 terminators supported by modern terminals; the rendered link is unchanged. This removes dreamcli's last hand-rolled escape-sequence code.

## [3.0.0-rc.9] - 2026-07-11

### Added

- **JSON help** — `--help` with `--json` emits the CLI's definition document (the `generateSchema()` shape, `$schema`-tagged) on stdout instead of help text, for root help, `help <command>`, and `<command> --help` alike. New `generateCommandSchema(schema)` export produces the per-command document.

### Changed

- **`generateSchema()` emits the default command's full definition** — the `defaultCommand` field was a name-only string reference while the default command's flags/args appeared nowhere in the document (it never lists in `commands`). It is now the complete serialized command.

- **`flag.array()` rejects non-element builders at compile time** — the element position now requires a builder carrying only value-shape settings (kind, constraints, enum values, `parseFn`). Flag-level modifiers (`.alias()`, `.env()`, `.default()`, `.prompt()`, `.describe()`, …) were silently ignored on elements before; passing them is now a type error, as is `flag.path()` / `flag.count()` / `flag.keyValue()` / nested arrays. Type-level only — no runtime behavior change.

## [3.0.0-rc.8] - 2026-07-11

### Added

- **Themed help output** — root and per-command help render with a semantic color theme (bold+underlined section titles, cyan literals, dimmed metadata, yellow deprecations) whenever color is enabled, using the same gate as `out.color` (TTY + color support, no `--json`, `NO_COLOR`/`FORCE_COLOR` honored). Piped and JSON output stays byte-clean. Customize via `.help({ theme: (c) => ({ sectionTitle: c.magenta }) })` — the factory receives the gated ansispeck palette and is never invoked when color is off, so custom themes cannot leak escapes. New public types: `HelpTheme`, `HelpThemeFactory`.
- **Negatable booleans** — `flag.boolean().negatable()` accepts `--no-<name>` as `false`. Both spellings are one logical flag (last CLI occurrence wins, shared duplicate policy); the negated spelling is presence-only (`--no-foo=x` errors) and renders as `--[no-]foo` in help. Custom spelling via `{ alias }`, unadvertised via `{ hidden }`. Env/config/prompt/default resolution is unchanged.
- **Duplicate policy** — `.duplicates('last' | 'first' | 'error')` on singleton flags controls repeated CLI occurrences. `'error'` throws `ParseError` code `DUPLICATE_FLAG` with `{ flag, count, values }` details; `'first'` keeps the first value while still consuming later value tokens. Counted per logical flag (aliases + negated + parity spellings); env/config precedence is never a duplicate.
- **`packageRepositoryUrl(pkg, { require: true })`** — narrows the return type to `string`, throwing a `CLIError` (code `INVALID_REPOSITORY`) at the call site when the `repository` field is missing or not a recognisable locator. Removes the `!` assertion for manifests known to carry a valid repository, with the guarantee enforced at runtime rather than assumed.
- **Flag spelling parity (kebab ↔ camel)** — `--doThis` matches a flag named `do-this` and vice versa, for names and long aliases, on by default. Handler keys, help, completions, and suggestions stay canonical. Automatically disabled per pair when both spellings are declared explicitly; globally via `cli('mycli', { flags: { caseParity: false } })` (new `cli(name, options)` overload) or `RunOptions.flags`.

### Fixed

- `execute(argv, { flags })` overrides now reach the planner's dispatch arity scanning, not just command parsing.
- Generated meta-schema descriptions render `@defaultValue` tags as a `Default: <value>` paragraph instead of silently dropping them.

## [3.0.0-rc.7] - 2026-07-10

### Added

- **`.derive()` handlers may omit the return** — a validation-only derive with no `return` statement (sync or async) now typechecks; previously `void` / `Promise<void>` failed the `Output` constraint and forced an explicit `return undefined`.
- **String constraints** — `flag.string({ nonEmpty, minLength, maxLength, pattern })` plus chained `.nonEmpty()` / `.minLength()` / `.maxLength()` / `.pattern()`, mirroring the numeric-constraint model. Checked in fixed order (nonEmpty → minLength → maxLength → pattern) at both the CLI parse boundary (`INVALID_VALUE`) and env/config/prompt resolution (`CONSTRAINT_VIOLATED`), and emitted into the exported JSON Schema as `minLength` / `maxLength` / `pattern`.
- **`.separator()` and `.unique()` on array flags** — `.separator(',')` splits each CLI occurrence before element coercion, so `--region us,eu --region ap` works alongside repetition and errors name the offending element. Env/config string values use the same separator (default remains `','`). `.unique()` deduplicates the final resolved array (first-seen order) regardless of source.
- **`flag.url()`** — parses into a `URL`, with optional `{ protocols: ['https'] }` allowlist. Help shows `<url>`.
- **`flag.path()`** — path string with opt-in filesystem checks (`{ mustExist: true }`, `{ type: 'file' | 'directory' }`) validated after resolution through the runtime adapter, so CLI/env/config values are checked identically. `RuntimeAdapter` gained a `stat()` primitive (Node/Bun via `node:fs/promises`, Deno via `Deno.stat`; test adapters default to "nothing exists"), and `RunOptions` / `ResolveOptions` accept a `stat` injection for process-free execution — without one, checks are skipped.
- **`flag.date()`** — strict ISO-8601 → `Date` with optional inclusive `min` / `max` bounds. Rejects lenient `Date.parse` inputs (`'0'`, `'March 5'`) and calendar-invalid dates (`2026-02-31`).
- **`flag.duration()`** — `'30s'`, `'5m'`, `'1.5h'`, `'250ms'`, `'2d'`, compounds (`'1h30m'`), or bare milliseconds → milliseconds.
- **`flag.bytes()`** — `'512mb'`, `'1.5gb'`, `'64kb'` or bare bytes → bytes (binary units, case-insensitive).
- **`flag.count()`** — occurrence counter (`-vvv` → `3`, absent → `0`, explicit `--verbose=2` supported). Takes no value token, not promptable, and joins boolean flags in help (no `<value>` placeholder) and shell completions.
- **`flag.keyValue()`** — repeated `KEY=VALUE` merges into `Record<string, string>` (split at the first `=`, later keys win, unset resolves to `{}`). Env accepts comma-separated pairs; config accepts a plain object. New `'empty-object'` optional fallback joins arrays' `[]` as the kinds that resolve to a value when unset.

## [3.0.0-rc.6] - 2026-07-09

### Added

- **Runtime terminal sizing hooks** — `RuntimeAdapter` now exposes `getTerminalSize()` and `onTerminalResize()`. Node/Bun read `process.stdout.getWindowSize()` (falling back to `columns` / `rows`) and subscribe to stdout `resize`; Deno uses native `Deno.consoleSize()` and `SIGWINCH` on non-Windows platforms.

### Changed

- **Help output now fits the live terminal in `.run()`** — root and command help use runtime terminal columns when no explicit `.help({ width })` or runtime `help.width` is provided. Non-TTY or unavailable sizes still fall back to 80, and `.execute()` remains deterministic for tests.

## [3.0.0-rc.5] - 2026-07-08

### Removed

- **`createBunAdapter` export** (from `@kjanat/dreamcli/runtime`). Bun exposes a Node-compatible `process`, so the Bun adapter had been a pure passthrough to the Node adapter since the runtime version hard-fail was dropped — it blessed a runtime rather than abstracting distinct I/O. Auto-detection now maps Bun to the Node adapter directly and `src/runtime/bun.ts` is gone. Runtime detection is unchanged: `detectRuntime()` still reports `'bun'` and `RUNTIMES` still lists it. Callers that selected the Bun adapter explicitly should use `createNodeAdapter` (identical behavior) or rely on `createAdapter()` auto-detection (#51).

## [3.0.0-rc.4] - 2026-07-06

### Added

- **`.default(cmd, { route: true })`** — expose a default command under its own name as a routable top-level command, in addition to the bare/flags-only root surface. `mycli` and `mycli <name>` then run the same command object, and it is listed in the root `Commands:` section (tagged `(default)`) beside its siblings. Lets CLIs keep both a short root shorthand and an explicit, documented named command without duplicating the builder (#55). Opt-in only — the surface-only default remains the default behavior. With `route: true` the name wins over positional interpretation, so a positional value equal to the command's own name must be passed after `--`.

## [3.0.0-rc.3] - 2026-07-06

### Added

- **`@kjanat/dreamcli/version` subpath** — exposes the framework's own build identity as `DREAMCLI_VERSION` and `DREAMCLI_REVISION` (git short SHA) for diagnostics and bug reports. Deliberately a subpath rather than root exports so the constants stay out of root-import IDE completions; both report `'dev'` when running unbundled source.

## [3.0.0-rc.2] - 2026-07-06

### Added

- **`out.color` — context-aware ANSI colors** — every handler's `out` now carries a color palette powered by [`ansispeck`](https://github.com/kjanat/ansispeck). Colors auto-enable only when stdout is a TTY, JSON mode is off, and the environment supports color (`NO_COLOR`, `FORCE_COLOR`, `--no-color`, `--color`, `CI` respected); otherwise every formatter is an identity function, so handlers can write `out.log(out.color.green('✔ done'))` unconditionally. `createOutput({ color })` forces the palette on/off (useful for asserting colored output in tests), and the `Colors` type is re-exported from the root entrypoint. First runtime dependency — kept external in `dist` (~1 kB gzipped install).

### Changed

- **npm package now resolves built `dist` on every runtime** — the `bun`/`deno` → `src/*.ts` export conditions are gone and `src` is no longer published to npm (JSR still ships source). Bun and Deno consumers previously loaded raw source where build-time defines never ran, so `version` reported `'dev'`; they now get the same tested output as Node, with the real version. The export map is generated by tsdown at build time instead of hand-maintained.

## [3.0.0-rc.1] - 2026-07-02

### Added

- **`.completions({ as: 'flag' })`**\
  Expose shell completion as an eager `--completions <shell>` flag on the CLI root instead of a `completions` subcommand. The planner intercepts the flag before dispatch, prints the script, and exits; root help advertises `--completions <bash|zsh|fish|powershell>` in its `Flags:` section. `.completions()` still defaults to `{ as: 'command' }`. Because the eager flag is intercepted before dispatch, the `--completions` name is reserved in flag mode — declaring a command/default flag of that name throws at build time.
- **Shell auto-detection** — `--completions` with no value (flag form) resolves the target shell from the environment: `$SHELL` (parsed as an interpreter path) wins when it names a supported shell, otherwise the presence of `$PSModulePath` selects PowerShell — the reliable signal for `pwsh`, which never sets `$SHELL`.
- **`detectShell(env)` / `normalizeShell(raw)`** — exported helpers behind the detection above; `normalizeShell` accepts bare names, `$SHELL` paths, and the `pwsh`/`powershell` pair.
- **`.help(config)` builder + extended `HelpOptions`** — configure root-help rendering: `inlineDefault`, `showDefaultInCommands`, and `footer` (plus the existing `width` / `hyperlinks`). Builder config is merged under runtime `options.help` (runtime wins).
- **Numeric constraints for number flags and args** — `flag.number()` and `arg.number()` now accept `{ min?, max?, int?, finite? }` (bounds inclusive), and the same constraints compose via chained `.int()` / `.min(n)` / `.max(n)` / `.finite(allow?)` methods (a later call overrides an earlier value, including one set in the options object). The chained methods are compile-time guarded to number-kind builders only. Constraints are enforced identically across the parse path and the env/config/prompt resolution path (order: finite → int → min → max): parse-time (CLI) violations throw `INVALID_VALUE`, while env/config/prompt coercion reports `CONSTRAINT_VIOLATED` (both exit code `2`). They are also surfaced in the exported JSON Schema as `minimum` / `maximum` and `type: "integer"` when `int` is set. `min` / `max` must be finite — a non-finite bound (`Infinity` / `-Infinity` / `NaN`) throws at construction. The resolved TypeScript value type stays `number`.
- **Prompt-level defaults for `confirm` and `input` prompts** — `confirm` prompts accept `default?: boolean` (drives the `(Y/n)` vs `(y/N)` hint and the empty-line result, so a confirm can default to **No**), and `input` prompts accept `default?: string` (shown in the hint as `(default: <value>)` and used when the user presses Enter, skipping `validate`). Precedence among defaults is prompt-level `default` > flag `.default()`. Unset `confirm` default stays backward compatible (`true`).

### Changed

- **BREAKING — the default command is now the root _surface_, not a named subcommand.** `.default(cmd)` registers the command only as the default; it is no longer added to `schema.commands`. Consequences:
  - It can no longer be invoked by its own name (`mycli mycmd` does not route to it; the token is treated as input to the default command).
  - It is omitted from the root `Commands:` list by default (re-enable with `.help({ showDefaultInCommands: true })`).
  - Root `--help` renders the default command's `Arguments:`/`Flags:` inline even when sibling commands exist (previously only when it was the sole command), and a sole default with no subcommands shows its own usage line directly instead of a `[command]` placeholder.
- **`finite` defaults to `true` (behavior change)** — `flag.number()` / `arg.number()` now **reject `Infinity` and `-Infinity`**, which previously passed straight through to handlers (`Number("Infinity")` is not `NaN`). Pass `{ finite: false }` (or `.finite(false)`) to opt back into accepting non-finite values. `NaN` continues to be rejected as before.
- **BREAKING — the runtime no longer hard-fails the host CLI on its version.** Adapter construction previously threw (a bare, uncaught `Error`) when the detected Node/Bun/Deno version was below DreamCLI's declared minimum, crashing the consumer's CLI — including on `--help`. That check is removed: as a dependency the consumer's package manager already enforces the `engines` range at install time (and more softly), and when DreamCLI is bundled/inlined the consumer — not us — owns their CLI's supported-runtime policy. `SUPPORTED_RUNTIMES` and the generated `engines` minimums are unchanged and remain the source of truth for docs and packaging.

### Fixed

- **Empty `input`-prompt answer no longer clobbers a flag's `.default()`** — a flag declared with both `.default(...)` and an `input` prompt previously resolved to `""` when the user submitted an empty line, because empty input was treated as a real answer that short-circuited the default fallback. An empty or blank `input` answer with no prompt-level `default` is now treated as "no answer", so resolution falls through to the flag's `.default()` (or, for a required flag, the standard missing-flag error).

### Fixed

- **Root `--help` now matches consistently with `--version`** (#29) — previously `--help` / `-h` were intercepted at the root only when they were the very first token, while `--version` / `-V` matched anywhere before `--`. A help flag preceded only by flags (e.g. `mycli --verbose --help`) now shows root help, mirroring `mycli --verbose --version`. A help flag that follows a subcommand token still scopes to that subcommand (`mycli deploy --help` → `deploy` help); `--version` remains a global, position-independent flag by design (there is no per-command version). The bare `help` token now triggers root help from the same position as `--help`, and the `--` end-of-options separator is respected for both.
- **Generated `--help` now advertises the active built-in global flags** (#32) — root help renders a `Global options:` block listing `--help, -h` and `--json` (always), `--version, -V` (when a version is set), and `--config <path>` (when `.config()` enabled config discovery). Previously these framework-provided flags were invisible in help even though they worked. `--completions` is unchanged (still advertised via the inline surface when active).
- **Root usage no longer prints the default command's name** — the merged/sole-default usage line rendered `Usage: <bin> <default-name> …`, teaching an invocation that does not route (`.default()` is not a named command, so the token is consumed as the default's first positional). It now renders under the bin name only (`Usage: <bin> [flags] <args>`).
- **`inlineDefault: false` no longer hides a sole default command's interface** — when the default command is the only surface (no visible subcommands and no eager `--completions` flag), root help would collapse to a bare `Usage: <bin> [options]` with no discoverable args/flags. The default is now always rendered inline in that case, since suppressing it leaves no other path to its interface.

### Fixed

- **`runCommand()` now honors a CLI-level `--json` passed in `argv`** — the testkit gained the same root-flag layer as the real CLI: a `--json` before the `--` separator enables JSON mode and is stripped before parsing, instead of failing with `Unknown flag --json` (exit 2). A literal `--json` after `--` still reaches the command unchanged. The existing `{ jsonMode: true }` option keeps working — either source enables JSON mode. Copying a real `mycli --json …` invocation into a test now works verbatim.
- **`createTestPrompter()` now runs an `input` prompt's `validate`** — a queued string answer to an `input` prompt is validated exactly as the terminal prompter does; an answer that fails validation is rejected as a cancellation rather than injected verbatim as the resolved value, so prompt validation is integration-testable through `runCommand(cmd, argv, { answers })`. Non-string answers stay verbatim so downstream coercion paths remain testable.

## [2.5.0] - 2026-06-28

### Added

- **`.manifest()` — runtime-agnostic manifest discovery** — discover CLI metadata from any manifest file, not just `package.json`. Pass `files` to choose candidate filenames in priority order (e.g. `['deno.json', 'jsr.json']`); discovery walks up from `cwd` (or `from`) and the nearest manifest directory wins. Files are parsed as JSON with a JSONC fallback, so `package.json`, `deno.json`, `jsr.json`, and `deno.jsonc` all work — including manifests with `//` / block comments or trailing commas (a dependency-free, string-aware strip that leaves `//` inside string values such as URLs untouched).
- **`discoverManifest()`** — the generalized discovery helper behind `.manifest()`, accepting `{ startDir, files }`.
- **Optional scope retention in name inference** — `inferName` now accepts `{ scope: 'keep' | 'strip' }` (and `inferCliName(pkg, { stripScope })`) so a scoped `name` like `@scope/mycli` can be kept verbatim instead of always stripping to `mycli`. Relevant for `deno.json` / `jsr.json`, which have no `bin` field.
- **`.denoJson()`** — deprecated convenience preset for `.manifest({ files: ['deno.json', 'deno.jsonc', 'jsr.json'] })` (see Deprecated below).

### Changed

- **Manifest discovery now requires recognized metadata to count as a hit** — a parseable but metadata-less manifest (`{}`, or one carrying only non-metadata fields such as `dependencies` / `scripts` / `type`, or a config-only `deno.json` with just `tasks` / `imports`) is no longer treated as a match. Discovery now walks up to parent directories and tries the remaining candidate files instead of halting. This also changes the deprecated `discoverPackageJson()` / `.packageJson()`: where a metadata-less `package.json` previously halted the walk-up and resolved to `{}`, the walk-up now continues, so an ancestor's version can surface (relevant in monorepos). Pass pre-loaded `data` or an explicit `from` / `startDir` to pin discovery to one directory.

### Deprecated

- **`.packageJson()`, `.denoJson()`, and `discoverPackageJson()`** — superseded by `.manifest()` / `discoverManifest()`, whose defaults (`['package.json']`) match the old behavior. All still work, delegating to the generalized path.

## [2.4.1] - 2026-06-27

### Fixed

- **Destructuring `out` and activity handles** — `Out` methods and the spinner/progress activity handle methods are now bound to their instance, so pulling them off via destructuring (e.g. `const { done } = handle`) no longer breaks `this`-dependent behaviour and cleanup (https://github.com/kjanat/dreamcli/pull/40).

## [2.4.0] - 2026-06-23

### Added

- **`out.setExitCode(code)` for normal-output status exits** — command handlers can now request a process exit code without throwing or emitting error-shaped output, covering status/check CLIs that should print their normal report while still signalling degraded state to scripts (https://github.com/kjanat/dreamcli/issues/27).

### Fixed

- **Unknown root commands under no-arg defaults now report `UNKNOWN_COMMAND`** — when a CLI has a `.default()` command with no positional args, an unknown root token no longer falls through to the default parser as an unexpected positional. Defaults that declare positional args still receive those root tokens as before (https://github.com/kjanat/dreamcli/issues/26).

### Security

- **Hardened trailing-separator trimming against polynomial ReDoS** — the home/config path resolution, `package.json` repository-URL normalization, and runtime-binary `basename` helpers previously stripped trailing slashes with backtracking regexes (`/[\\/]+$/`, `/\/+$/`) that CodeQL flagged as polynomial regular expressions (`js/polynomial-redos`). They now route through a shared linear-time `stripTrailing` scan, so adversarial slash-heavy input can no longer trigger quadratic matching. No behavior change for valid inputs.

## [2.3.0] - 2026-06-20

### Fixed

- **Command dispatch now respects flag value-arity** — a space-separated value-flag value (e.g. `--source anthropic`) is no longer mistaken for a command name when it collides with a registered command, so the default-command fallback runs as intended (https://github.com/kjanat/dreamcli/issues/25). The command-name scan now skips the token a space-separated value-flag consumes (mirroring the parser's own value-consumption rules); the inline `--source=anthropic` form already worked, and both forms are now consistent.
- **Root `--version`/`--json` interception now respects the `--` end-of-options separator** (https://github.com/kjanat/dreamcli/issues/28). A `--version` or `--json` token after `--` is treated as a literal positional instead of triggering version output or JSON mode.

## [2.2.1] - 2026-06-10

### Added

- **`.links()` — OSC 8 hyperlinks in the root-help header** — the program name and version on the first line of root `--help` output can now carry [OSC 8 hyperlinks](https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda) in supporting terminals (https://github.com/kjanat/dreamcli/issues/20). Pass explicit URLs (`.links({ name, version })`) or call `.links()` with no arguments to derive them from `package.json` metadata when `.packageJson()` is active: the name links to the normalized `repository` URL (falling back to `homepage`), and the version links to the forge release tag (`{repo}/releases/tag/v{version}` on GitHub, `{repo}/-/releases/v{version}` on GitLab). Escapes are emitted only when stdout is a TTY (overridable via the new `help.hyperlinks` option) and only on the header line — usage lines, the `--help` hint, the commands table, `--version` output, and completion scripts stay plain.
- **ANSI/OSC-aware help width helpers** — help padding and wrapping now measure _visible_ width: the shared `padEnd()`/`wrapText()` helpers strip ANSI CSI (colors) and OSC (hyperlink) escape sequences before counting columns, so escape-bearing text no longer mangles `--help` alignment. New public exports `osc8(url, text)` (wrap text in an OSC 8 hyperlink) and `visibleWidth(text)` (escape-aware width measurement) support custom help rendering.
- **`packageRepositoryUrl(pkg)`** — new public helper that normalizes a package's `repository` field to a browsable `https://` URL, handling the locator formats npm accepts (`{ type, url }` object form, `git+`/`.git` affixes, scp-style `git@host:u/r.git`, and the `github:`/`gitlab:`/`bitbucket:`/bare `u/r` shorthands). `PackageJsonData` now also parses the `homepage` and `repository` fields.

## [2.2.0] - 2026-06-09

### Added

- **`.packageJson(data)` — pre-loaded metadata** — `CLIBuilder.packageJson()` now accepts an already-imported `package.json` object (e.g. `import pkg from './package.json' with { type: 'json' }`), skipping filesystem discovery entirely. The data is detected via field shape (`name`/`version`/ `description`/`bin`), and its `version`/`description` are merged into the CLI schema at builder time so the data form works in **both** `.run()` and `.execute()` (the filesystem-free path that previously couldn't consume `.packageJson()` at all). Explicit `.version()`/`.description()` still win; an empty `{}` or a settings-shaped object falls through to the settings overload, so this is a non-breaking addition.
- **`.packageJson({ from })` — anchored discovery** — discovery can now be anchored to an explicit location instead of the runtime cwd. Pass `{ from: import.meta.url }` (also accepts path strings, `file:` URL strings, or `URL` instances) so installable CLIs (`npm i -g`, `bunx`, `npx`) report their OWN version from any working directory. `discoverPackageJson(adapter, startDir?)` gained a matching optional anchor parameter.

## [2.1.0] - 2026-04-16

### Added

- **Prompt — flag kind compatibility validation** — `FlagBuilder.prompt()` now rejects incompatible prompt/flag combinations at compile time via `AllowedPromptConfig<C>` (e.g., `flag.enum([…]).prompt({ kind: 'multiselect' })` is a TypeScript error). A runtime validation gate in `resolvePromptValueWithConfig()` catches mismatches before the prompter is invoked, throwing a `CONSTRAINT_VIOLATED` `ValidationError` with an actionable `suggest` message.
- **`flagKind` phantom discriminator** — `FlagConfig` now carries a `flagKind` field (phantom — never read at runtime) so the type system can distinguish all six flag kinds. `AllowedPromptConfig` uses an indexed-access map (`PromptConfigByFlagKind`) for union-safe resolution.
- **PowerShell completion playground** — added a Windows-friendly `pwsh-demo` workspace with a `.cmd` launcher, native `Register-ArgumentCompleter` registration, README install steps, and an end-to-end smoke test so PowerShell completions can be exercised outside unit tests.

### Changed

- **Meta-descriptions build** — `scripts/build-meta-descriptions.ts` pipes generated source through `dprint fmt --stdin ts` instead of writing/reading a temp file and formatting in-place.
- **PowerShell install guidance** — current-session docs and generated script headers now use `Out-String | Invoke-Expression`, matching the PowerShell flow that reliably evaluates multiline completion output.
- **Bun support floor** — relaxed the documented and enforced Bun minimum from `>= 1.3.11` to `>= 1.3` across package metadata, runtime support checks, examples, and docs.

### Fixed

- **PowerShell completions** — enum values now complete while the active token is still in progress, stop suggesting flags after `--`, and quote accepted values when spaces or quotes would otherwise produce invalid PowerShell input.
- **PowerShell playground launcher** — fixed the Windows `pwsh-demo.cmd` shim so the example runs reliably from PowerShell and Command Prompt.
- **Package metadata** — moved `vite` from `optionalDependencies` to `devDependencies` so consumer installs do not see it as a runtime dependency.
- **Docs deploy** — remove dead Workers runtime vars (`BUN_VERSION`, `NODE_OPTIONS`) that had no effect on the static assets Worker, and add `html_handling: "drop-trailing-slash"` so clean URLs resolve correctly instead of 404ing on trailing slashes.

## [2.0.1] - 2026-04-07

### Fixed

- **Schema URL resolution** — `$schema` in emitted definition documents now points at `dreamcli.schema.json` instead of the `/schema` subpath export, which doesn't resolve on the jsdelivr CDN.
- **GitHub Pages deploy** — use `env` import from `node:process` for env access and set VitePress `base` to `/dreamcli/` so assets and links resolve correctly on GitHub Pages.\
  This allows for the old github pages deploy to work as an alternative to the cf workers.
- **Publish pipeline** — split build and publish into separate jobs, run build before pack with `--ignore-scripts` to prevent prepack output from breaking `GITHUB_OUTPUT` parsing, hardcode the npm CDN schema URL instead of the unreliable jsr.io esm.sh path, replace `actions/setup-node` with bun's native registry auth, and switch internal imports to `#dreamcli/*` subpath imports.
- **Package exports map** — moved conditional exports from `publishConfig` into top-level `exports` so local resolution matches what consumers see after install.

## [2.0.0] - 2026-04-07

### Added

- **String-literal schema DSL** — added a single-source schema surface that parses definitions at compile time and runtime, then reuses the same model for JSON Schema generation.
- **Published definition schema export** — added `@kjanat/dreamcli/schema` so tooling and docs consumers can import the generated definition schema locally instead of relying on the CDN URL.
- **Fish and PowerShell shell completions** — expanded completion support beyond Bash and Zsh.
- **Source-backed docs surfaces** — added generated API inventory pages, per-entrypoint symbol routes, source-backed example pages with related symbol links, and reference guides for planner, resolver, output, schema, support, migration, troubleshooting, and semantic deltas.
- **`gh-project` workflow helper** — added a DreamCLI-powered project tool for syncing the re-foundation task board and PRD state.

### Changed

- **Package identity and build pipeline** — the package is now published as `@kjanat/dreamcli`, ships ESM-only, emits the definition schema during the tsdown prepare hook, tightens published exports for runtime-specific consumers, and hardens npm, JSR, and docs release checks.
- **Docs app architecture** — VitePress now builds reference and example pages from data loaders instead of static generated files, adds runtime/twoslash settings UI, improves mobile twoslash UX, and copies root artifacts into deployed docs output.
- **Examples and walkthroughs** — the `gh` example grew into a multi-file workspace canary, and the example set now doubles as richer docs source with broader JSDoc coverage and better walkthrough material.

### Fixed

- **Completion and alias handling** — hidden compatibility aliases now parse correctly, Bash and Zsh completion behavior is safer and more consistent, and shell completion edge cases were tightened.
- **Aggregate validation diagnostics** — mixed flag and arg validation failures now surface clearer per-issue labels plus value-source labels such as `env ...` and `stdin`.
- **Schema and docs integration** — schema URLs, generated meta descriptions, twoslash rendering, and source-backed docs pages now build reliably across local, CI, and Cloudflare deploys.
- **CLI and runtime edge cases** — unresolved schema references now fail closed, runtime/support checks were hardened, and several dispatch/output/runtime regressions were corrected.

## [1.0.0] - 2026-04-02

### Added

#### Release Automation

- **GitHub Actions npm publish workflow** (`.github/workflows/publish-npm.yml`) — publishes the package to npm on GitHub release with provenance enabled, bringing npm release automation in line with the existing JSR publish flow.

#### Canonical Semantics Guide

- **`docs/guide/semantics.md`** — centralized reference for parser and resolver behavior, including repeated flags, short-flag stacking, `--` separator rules, `--no-*` alias behavior, value-source precedence, non-interactive prompt skipping, propagated-flag masking, and default-command root help/completion semantics.

#### Plugin Lifecycle Hooks

- **`plugin(hooks, name?)`** and **`.plugin(definition)`** expose a typed extension surface around command execution.
- **Lifecycle phases** — `beforeParse`, `afterResolve`, `beforeAction`, and `afterAction` let plugins observe or instrument execution without reaching into CLI internals.

#### `derive()` Command Context

- **`command(...).derive(handler)`** adds typed command-scoped pre-action context derived from fully resolved flags and args.
- **Derived context merges into `ctx`** so commands can validate once and consume typed values in the action handler.

#### Schema Export and Validation

- **`generateInputSchema()`** exports JSON Schema from CLI definitions for machine validation and tooling.
- **Schema export docs and reference coverage** now document export formats, discriminator behavior, and default/hidden command handling.

#### Runtime Surface and Execution Options

- **Runtime support matrix and version guards** added around adapter creation.
- **`run()` accepts `jsonMode`** in options, letting callers force structured output without shell-level flags.
- **`out.table()` format and stream overrides** expose finer control over tabular output.

### Changed

- **Docs navigation and entrypoints** — guide pages now link to the canonical semantics guide, the API reference landing page includes quick import guidance and key factories per subpath export, and the VitePress sidebar surfaces the semantics page under the Advanced guide section.
- **Public API surface tightened** — runtime exports were pruned and guarded, explicit `require` conditions were added to package exports, and self-referencing package imports were hardened.
- **Docs and examples expanded** — JSDoc/reference coverage grew across exported symbols, schema export/testing/runtime docs were added, and the `gh` walkthrough became a multi-file example package.
- **CI and packaging hardened** — version-sync checks, supported Node pinning, preview publish verification, and Bun-pack package validation were added around the release surface.

### Fixed

- **Default-command UX** — single-command root help is merged correctly, root completions surface default-command flags, unknown root flags are rejected cleanly, and schema discriminator handling matches the actual default-command surface.
- **Stdin and runtime behavior** — stdin reads defer until dispatch needs them, empty pipes are distinguished from no pipe, and test adapters now match real runtime behavior more closely.
- **Parser/help/completion/output edge cases** — optional array flags resolve to `[]`, variadic help formatting is corrected, bash/zsh completion edge cases are hardened, non-finite JSON values are rejected, and table options are preserved correctly.

## [0.9.2] - 2026-03-30

### Added

#### Stdin-Backed Positional Arguments

- **`ArgBuilder.stdin()`** lets positional args consume piped stdin when no CLI token is provided.
- **`RuntimeAdapter.readStdin()`** adds full stdin reads to the runtime contract across Node, Bun, and Deno adapters.
- **`RunOptions.stdinData` and testkit plumbing** let in-process tests feed stdin-backed commands without touching real process state.
- **Comprehensive stdin coverage** added across schema, resolver, runtime, and testkit tests.

### Changed

- Positional-arg resolution for stdin-enabled args expanded from **CLI → env → default** to **CLI → stdin → env → default**.
- Scripts now separate **`lint`** from **`format`**, so linting no longer doubles as a rewrite step.

## [0.9.1] - 2026-03-30

### Added

#### Default Command Support

- **`CLIBuilder.default(command)`** lets a CLI run a fallback command when no subcommand is specified.
- **Root args and flags flow through the default command** while explicit subcommands still take precedence.

#### Package.json Auto-Discovery

- **`CLIBuilder.packageJson(settings?)`** — opt-in builder method that enables automatic `package.json` discovery at `.run()` time. Walks up from `cwd` to find the nearest `package.json` and merges `version` and `description` into the CLI schema. Explicit `.version()` and `.description()` calls always take precedence over discovered values.
- **`PackageJsonSettings.inferName`** — when `true`, infers the CLI binary name from the `bin` key (first key of the object) or the package `name` field (scope stripped). Defaults to `false`.
- **`discoverPackageJson(adapter)`** — pure function that walks up from `adapter.cwd` to find and parse the nearest `package.json`. Returns `PackageJsonData | null`. All I/O flows through the adapter — fully testable with virtual filesystems.
- **`inferCliName(pkg)`** — resolves CLI name from `PackageJsonData` with priority: bin key → scoped name (stripped) → `undefined`.
- **Silent error handling** — malformed JSON, non-object roots, and missing `package.json` all return `null` (not errors). Deno permission denials degrade gracefully via the adapter's existing `readFile` contract.
- **Completions skip** — package.json discovery is skipped for the `completions` subcommand, matching the existing config discovery skip pattern.
- **43 new tests** — `package-json.test.ts` (24 unit tests: walk-up resolution, field extraction, error resilience, Windows path termination) and `cli-package-json.test.ts` (19 integration tests: version/description fill, name inference, precedence, walk-up, completions skip, combined with config, error resilience).

#### `help` Virtual Subcommand

- **`BINARY help <command>`** produces the same output as `BINARY <command> --help`. Rewrites argv via recursive `execute()` — no dispatch duplication.
- **Nested support** — `help db migrate` works like `db migrate --help`.
- **Bare `help`** shows root help.
- **Defers to real commands** — if the user registers a command named `help` (or aliased as `help`), it takes priority over the virtual subcommand.
- **`--json` propagation** — `help --json <command>` correctly preserves json mode (help text routes to stderr, stdout reserved for data).
- **10 new tests** across `cli.test.ts` (7), `cli-nesting.test.ts` (2), `cli-json.test.ts` (1).

#### Arg Environment Variable Resolution

- **`ArgBuilder.env(varName)`** binds a positional argument to an environment variable. When the CLI value is absent, the resolver reads the env var and coerces the string to the arg's declared kind (passthrough for strings, `Number()` with NaN guard for numbers, `parseFn` invocation for custom args). Resolution order: **CLI → env → default**.
- **`ArgSchema.envVar`** field (`string | undefined`) stores the env var name on the runtime schema descriptor.
- **Env coercion for args** via `coerceArgEnvValue()` in the resolver. Handles `string` (passthrough), `number` (parse + NaN guard), and `custom` (delegates to `parseFn`, wraps thrown errors).
- **`[env: VAR]` annotation** in help output for args with env bindings, matching the existing flag annotation style.
- **Actionable required-arg error hints** — `buildRequiredArgSuggest()` generates suggestions including the env var when configured (e.g. "Provide a value for \<target\> or set DEPLOY_TARGET").
- **16 new tests** — `resolve-arg-env.test.ts` (15 tests covering string/number/custom coercion, CLI > env > default precedence, deprecation warnings, error cases) and 1 help output test for the `[env: VAR]` annotation.

#### Command Metadata

- **`CommandMeta`** added to action handlers and middleware, carrying the CLI name, invoked binary, version, and resolved leaf command name.

#### Documentation Site, README, and Examples

- **README** added with project pitch, usage, install guidance, and comparison table.
- **Examples directory** added with seven implementation examples.
- **VitePress documentation site** added with concepts, guide, and reference sections.
- **GitHub Pages deploy workflow and sitemap** added for hosted docs.
- **Walkthrough guide** added for a GitHub CLI-style example application.

### Changed

- Completion generation was reorganized into shell-specific generators and the package/tooling surface was refreshed for the `0.9.1` milestone.
- Comprehensive public-facing JSDoc examples were added to the builder APIs.

### Fixed

- Default commands no longer swallow nested unknown-command errors.

## [0.9.0] - 2026-02-11

### Added

#### Deno Adapter

- **`createDenoAdapter(ns?)`** — full `RuntimeAdapter` implementation for Deno. Reads argv from `Deno.args` (prepends synthetic `['deno', 'run']` for parity), env from `Deno.env.toObject()`, cwd from `Deno.cwd()`, stdout/stderr via `TextEncoder` → `Deno.stdout.write`/`Deno.stderr.write`, stdin via `Deno.stdin.readable` stream with line-buffered reader, TTY detection via `isTerminal()`, `readFile` via `Deno.readTextFile`, and homedir/configDir from env vars.
- **Permission-safe** — `PermissionDenied` errors gracefully degrade: env falls back to `{}`, cwd to `/`, readFile to `null`. Non-permission errors propagate.
- **`deno-builtins.d.ts`** — ambient type declarations for `TextEncoder`, `TextDecoder`, and `ReadableStream` (needed because `lib: ["ES2022"]` excludes web platform APIs).
- **`createAdapter()` auto-detection** now handles Deno runtime via `globalThis.Deno` feature probing.
- Re-exported `createDenoAdapter` and `DenoNamespace` from `@kjanat/dreamcli/runtime` subpath.

#### Cross-Runtime CI

- **GitHub Actions CI workflow** (`.github/workflows/ci.yml`) — lint+typecheck (Bun), test matrix (Node LTS + Bun stable), Deno smoke test, build with publint+attw.
- **Deno smoke test** (`scripts/deno-smoke-test.ts`) — runs on real Deno runtime after build, exercising `createDenoAdapter()` against actual Deno APIs.

#### JSR Publishing

- **`deno.json`** with JSR package config (`@kjanat/dreamcli`), three subpath exports, publish include/exclude rules.
- **GitHub Actions publish workflow** (`.github/workflows/publish-jsr.yml`) — publishes to JSR on GitHub release with OIDC provenance.

### Changed

- **`.ts` import extensions** — all import specifiers switched from `.js` to `.ts` via `allowImportingTsExtensions`. tsconfig updated: `noEmit: true` + `allowImportingTsExtensions: true` replace `declaration`/`declarationMap`/`sourceMap`/`outDir` (all handled by tsdown). Removes the need for Deno's `unstable: ["sloppy-imports"]`.
- `detectRuntime()` updated with Deno detection via `globalThis.Deno?.version?.deno`.
- `createAdapter()` switch now covers `'deno'` case alongside `'node'` and `'bun'`.
- Completion generator: `typeof` check on `globalThis` narrowed to avoid Deno type errors.
- `runtime/deno.ts` expanded from empty stub (~5 lines) to full implementation (~318 lines).
- Test count: 1695 tests across 47 test files (up from 1658 in v0.8.0).

## [0.8.0] - 2026-02-11

### Breaking

- **Subpath exports** — single `"."` entry split into `"."`, `"./testkit"`, `"./runtime"`. Test utilities (`runCommand`, `createCaptureOutput`, `createTestPrompter`, `createTestAdapter`, `PROMPT_CANCEL`) moved to `@kjanat/dreamcli/testkit`. Runtime adapters (`createAdapter`, `createNodeAdapter`, `createBunAdapter`, `detectRuntime`, `ExitError`, `RUNTIMES`, `RuntimeAdapter`) moved to `@kjanat/dreamcli/runtime`. `createTestAdapter`/`TestAdapterOptions` exported only from `@kjanat/dreamcli/testkit`.

### Added

#### Spinner & Progress Bar

- **`out.spinner(text, options?)`** creates a spinner handle for indeterminate progress feedback. Returns a `SpinnerHandle` with `update(text)`, `succeed(text?)`, `fail(text?)`, `stop()`, and `wrap(promise, options?)` for auto-succeed/fail on promise settlement.
- **`out.progress(options)`** creates a progress bar handle. Pass `total` for determinate mode (percentage bar); omit for indeterminate (pulsing animation). Returns a `ProgressHandle` with `increment(n?)`, `update(value)`, `done(text?)`, and `fail(text?)`.
- **Four rendering modes** with automatic dispatch:
  - **TTY** — animated braille spinner (80ms frames) and bar rendering with ANSI cursor control. Hides cursor during animation, restores on terminal methods.
  - **Static** (`fallback: 'static'`) — plain text at lifecycle boundaries (start, succeed, fail). No ANSI codes. For CI and piped output.
  - **Noop** (`fallback: 'silent'`, default) — all methods are no-ops. Silent in non-TTY.
  - **JSON mode** — always noop (structured output only).
- **Active handle tracking** — at most one spinner or progress may be active at a time. Creating a new one implicitly stops the previous to avoid garbled terminal output.
- **`ActivityEvent` discriminated union** — 10-variant DU capturing spinner and progress lifecycle events (`spinner:start`, `spinner:update`, `spinner:succeed`, `spinner:fail`, `spinner:stop`, `progress:start`, `progress:increment`, `progress:update`, `progress:done`, `progress:fail`).
- **Testkit capture handles** — `CaptureOutputChannel` subclass overrides `spinner()` and `progress()` to record `ActivityEvent[]` for assertion. `CapturedOutput.activity` array added.
- **New public types** exported from barrel: `ActivityEvent`, `Fallback`, `SpinnerHandle`, `SpinnerOptions`, `ProgressHandle`, `ProgressOptions`.
- **`out.stopActive()`** public method on `Out` to clean up active spinner/progress timers. Prevents process hangs when a handler throws before reaching a terminal method (`stop`, `succeed`, `fail`, `done`). `runCommand()` calls it automatically in a `finally` block; direct `createOutput()` users call it themselves.
- **`progress:increment` activity event** — 10th `ActivityEvent` variant `{ type: 'progress:increment', delta }`. `increment()` now emits this instead of reusing `progress:update`, making capture events unambiguous for testing.

### Changed

- `Out` interface extended with `spinner()` and `progress()` methods.
- `CapturedOutput` extended with `activity: ActivityEvent[]` field.
- `createCaptureOutput` now returns a `CaptureOutputChannel` that records activity events separately from stdout/stderr.
- `FlagParseFn<T>` widened from `(raw: string) => T` to `(raw: unknown) => T`. Config files carry structured JSON data — `parseFn` now receives the raw value directly and is responsible for narrowing. CLI/env still pass strings; config passes the JSON value as-is.
- `Out` interface extended with `stopActive()` method for explicit timer cleanup.
- `ActivityEvent` union widened from 9 to 10 variants (added `progress:increment`).
- `OutputChannel` refactored: activity handle implementations extracted to `activity.ts` (~581 lines), `WriteFn` type and `writeLine` helper extracted to `writer.ts` (~30 lines). `index.ts` reduced from 1156 to 589 lines. No public API changes.
- All activity handle output (static and TTY) now routes to stderr. Previously static mode used a `StaticWriters` pair routing some output to stdout; the dual-writer abstraction is removed.
- `runCommand()` calls `out.stopActive()` in a `finally` block, ensuring timer cleanup on handler exceptions.
- **Resolve coercion unified** — three near-identical functions (`coerceEnvValue` ~105 lines, `coerceConfigValue` ~120 lines, `coercePromptValue` ~120 lines) replaced by single `coerceValue()` using `CoerceSource` discriminated union (`'env' | 'config' | 'prompt'`). Error messages parameterized via `sourceLabel()`/`sourceDetails()`/`coercionError()` helpers. `resolve/index.ts` reduced from ~1115 to ~940 lines.
- **Activity types extracted** — 7 activity/output types (`Fallback`, `SpinnerOptions`, `SpinnerHandle`, `ProgressOptions`, `ProgressHandle`, `ActivityEvent`, `TableColumn`) moved from `schema/command.ts` to `schema/activity.ts` (~150 lines). `command.ts` reduced from 898 to 784 lines.
- **Root help extracted** — `formatRootHelp()` + `padEnd()` + `wrapText()` moved from `cli/index.ts` to `cli/root-help.ts` (~133 lines). Uses structural `CLISchemaLike` interface to avoid circular imports. `cli/index.ts` reduced from 901 to 793 lines.
- **`infer/` stub deleted** — removed empty `src/core/infer/index.ts`.
- **Source files in published package** — `"src"` added to `files` array in package.json.
- **Package manager migrated** — pnpm → bun. `packageManager` set to `bun@1.3.9`.
- **Build config** — `tsdown.config.ts` changed to multi-entry build with `minify: true`.
- Test count: 1658 tests across 46 test files (up from 1518 in v0.7.0).

### Fixed

- `--config=<path>` equals form now correctly parsed and stripped from argv before dispatch.
- Zsh completion: multi-alias flags use all short aliases in the exclusion group, not just the first.
- Bash completion: `escapeForSingleQuote()` sanitizes `compgen -W` words to prevent shell injection.
- Win32 `resolveConfigDir`: strip trailing separator from homedir to avoid doubled backslashes on drive roots (e.g. `C:\`).
- Win32 `resolveConfigDir`: treat empty `APPDATA` as unset, falling back to homedir-based path.
- Win32 `homedir`: add `HOMEDRIVE`+`HOMEPATH` fallback; never use `HOMEPATH` alone.
- Levenshtein distance: replace 2D array with `Uint16Array` rolling buffer, drop defensive `undefined` guards.
- Completions command detection via schema lookup instead of raw `argv[0]` string match.
- Child flag with `propagate: false` correctly masks ancestor's propagated flag of the same name.
- Dispatch: exhaustiveness guard on `subResult` switch in nested command resolution.
- Nested group help: `binName` built from full command path, not just root.
- Config loader: lowercase extensions in `buildExtensionList`/`buildLoaderMap` for case-insensitive matching.
- Empty-string env var fallbacks in runtime adapter treated as unset.
- `ProgressHandle.increment()` was emitting `progress:update` events indistinguishable from `update()` calls. Now emits `progress:increment` with `delta` field.
- **Prompt number coercion** — `coercePromptValue` was missing NaN guard for number flags; now handled by unified `coerceValue()`.

## [0.7.0] - 2026-02-10

### Added

#### Subcommand Nesting

- **`CommandBuilder.command(sub)`** registers nested subcommands, building recursive command trees of unlimited depth. Parent commands store children as type-erased `ErasedCommand` entries — the parent doesn't need the child's generic types.
- **`group(name)`** factory as a semantic alias for `command()`. Communicates intent: groups organise subcommands, leaf commands have actions. A group may also have its own `.action()` (e.g. `git remote` lists remotes, `git remote add` dispatches to a child).
- **`flag.propagate()`** modifier marks a flag for automatic inheritance by all descendant commands. Propagated flags are collected from the ancestor chain at dispatch time. Child commands override a propagated flag by redeclaring the same name — child definition wins completely.
- **Recursive dispatch** in `CLIBuilder.execute()`. Walks argv segments matching command names at each tree level. Handles hybrid commands (action + subcommands): subcommand match takes priority, else falls through to the parent handler. Groups without handlers show help.
- **Nested help** — `formatHelp()` renders a "Commands:" section listing available subcommands for group commands. Usage line adapts to show `<command>` placeholder when subcommands exist.
- **Nested completions** — bash and zsh generators traverse the full command tree depth. Propagated flags included at each nesting level. Bash uses path-keyed case statements; zsh generates per-group helper functions.
- **Scoped "did you mean?"** — typo suggestions search within the current command scope, not the global command list. Help hint shows scoped path (e.g. `Run 'myapp db --help'`).

### Changed

- `CommandSchema` extended with `commands: readonly CommandSchema[]` for nested subcommand schemas.
- `ErasedCommand` extended with `subcommands: ReadonlyMap<string, ErasedCommand>` for dispatch.
- `ErasedCommand` interface moved from `cli/index.ts` to `schema/command.ts` (shared location).
- `FlagSchema` extended with `propagate: boolean` (default `false`).
- `RunOptions` extended with `mergedSchema` internal field for propagated flag injection.
- Dispatch logic extracted to `cli/dispatch.ts` (~285 lines) and flag propagation to `cli/propagate.ts` (~87 lines), reducing `cli/index.ts` by ~220 lines.
- Test count: 1518 tests across 43 test files (up from 1300 in v0.6.0).

### Fixed

- Completion generator no longer recurses into hidden command subtrees.
- Dispatch respects `--` end-of-flags sentinel before command names.

## [0.6.0] - 2026-02-10

### Added

#### Config File Discovery

- **`CLIBuilder.config(appName)`** enables config file discovery with XDG-compliant search paths. Searches `.{app}.json` and `{app}.config.json` in cwd, then `{configDir}/{app}/config.json`. JSON loader built-in.
- **`--config <path>` global flag** overrides config file discovery path. Extracted from argv before command dispatch.
- **`CLIBuilder.configLoader(loader)`** plugin hook for registering custom config format loaders (YAML, TOML, etc.). `configFormat(extensions, parseFn)` convenience factory.

#### Schema Additions

- **`flag.custom(parseFn)`** — new flag kind accepting an arbitrary parse function with full return-type inference from `parseFn`. Wired through parser coercion, all three resolve coercions (env, config, prompt), and help formatter.
- **`.deprecated(message?)`** modifier on `FlagBuilder` and `ArgBuilder`. Emits structured `DeprecationWarning` during resolution when a deprecated flag/arg is explicitly provided (CLI, env, config, prompt — not for default fallthrough). Renders `[deprecated]` or `[deprecated: <reason>]` in help text.

#### RuntimeAdapter Extensions

- **`readFile`** — async file read returning `null` for ENOENT, throws on other errors. Uses lazy `import('node:fs/promises')`.
- **`homedir`** — computed from env vars (`HOME`/`USERPROFILE`) + `platform`; avoids `node:os`.
- **`configDir`** — `XDG_CONFIG_HOME` on Unix, `APPDATA` on Windows; falls back to `~/.config` or `~\AppData\Roaming`.

### Changed

- `RuntimeAdapter` interface extended with `readFile`, `homedir`, `configDir`.
- `NodeProcess` interface extended with `platform` field.
- `FlagSchema` extended with `parseFn: FlagParseFn<unknown> | undefined`.
- `FlagSchema` extended with `deprecated: string | true | undefined`.
- `ArgSchema` extended with `deprecated: string | true | undefined`.
- `ResolveResult` extended with `warnings: readonly DeprecationWarning[]`.
- `CLISchema` extended with `configSettings` for config file discovery.
- `FlagParseFn<T>`, `DeprecationWarning`, `ConfigResult`, `FormatLoader`, `configFormat` exported from public API.
- Test count: ~1300 tests (up from 1198 in v0.5.0).

## [0.5.0] - 2026-02-10

### Added

#### Shell Completions

- **Bash completion generator** — produces self-contained bash scripts with `COMP_WORDS`/`COMP_CWORD` scanning, per-command case branches with flag and enum value completions, and `complete -F` registration.
- **Zsh completion generator** — produces `#compdef` scripts with `_arguments` flag specs, `_describe` subcommand lists, and enum value completions via `->state` dispatch.
- **`CLIBuilder.completions()`** adds a built-in `completions --shell <bash|zsh>` subcommand that outputs a ready-to-eval completion script. In `--json` mode, emits `{ script }` JSON object. Fish/PowerShell accepted in the enum with descriptive "not yet supported" errors.

#### Runtime Portability

- **`detectRuntime()`** via `globalThis` feature detection — identifies Node, Bun, Deno, or unknown. Exported `Runtime` type and `RUNTIMES` constant.
- **`createAdapter()`** auto-detecting adapter factory — calls `detectRuntime()` and returns the appropriate `RuntimeAdapter`. `CLIBuilder.run()` uses it as default when no adapter is provided.
- **Bun adapter** implementing `RuntimeAdapter` by delegating to the Node adapter (Bun's Node-compatible APIs).

### Fixed

- Completion: cross-command enum collision — `collectEnumCases()` scoped per-command to prevent enum values from one command leaking into another's completions.
- Completion: shell injection safety — `quoteShellArg()` escapes `schema.name` and enum values in generated scripts.
- Completion: conditional `--version` — bash generator omits `--version` from completions when `schema.version` is undefined, matching zsh behavior.
- CLI: `--json` mode completions output `{ script }` JSON instead of raw script text.
- CLI: guard against double `.completions()` call.
- Runtime: `NodeProcess` type exported from main barrel.
- Runtime: `@internal` removed from `GlobalForDetect` (contradicted public export).
- Runtime: `createAdapter()` switch uses `default: never` exhaustiveness guard.

### Changed

- Shell completion types, generator stubs, and barrel exports added to `src/core/completion/`.
- Test count: 1198 tests across 35 test files (up from 1010 in v0.4.0).

## [0.4.0] - 2026-02-09

### Added

#### Typed Middleware

- **`middleware<Output>(handler)`** factory creating phantom-branded `Middleware<Output>` values. Handler receives `{ args, flags, ctx, out, next }` — call `next(additions)` to continue the chain with typed context, omit `next()` to short-circuit (auth guards), or await `next()` for wrap-around patterns (timing, try/catch).
- **`CommandBuilder.middleware(m)`** registers middleware in execution order. Each call widens the context type parameter `C` via `WidenContext<C, Output>` intersection — `Record<string, never>` (the default) is replaced entirely on the first call, preventing `never` collapse. Adding middleware drops the current handler (type signature changed).
- **Context type parameter `C`** on `CommandBuilder<F, A, C>`, `ActionParams<F, A, C>`, and `ActionHandler<F, A, C>`. `ctx` in the action handler is `Readonly<C>` — property access is a type error until middleware extends it.
- **Middleware chain execution** (`executeWithMiddleware`) in testkit. Builds a continuation chain from back to front; context accumulates via `{ ...ctx, ...additions }` at each step. Replaces the former `invokeHandler` bridge.

#### Structured Output

- **`out.json(value)`** emits `JSON.stringify(value)` to stdout. Always targets stdout regardless of JSON mode. Handlers should prefer this over `out.log(JSON.stringify(...))`.
- **`out.table(rows, columns?)`** renders tabular data. In JSON mode: emits rows as JSON array. In text mode: pretty-prints aligned columns with headers (auto-inferred from first row when `columns` omitted). `TableColumn<T>` descriptor type with `key` and optional `header`.
- **`out.jsonMode`** and **`out.isTTY`** readonly properties on `Out` interface. Handlers check these to skip decorative output (spinners, ANSI codes) when machine-readable output is expected or stdout is piped.
- **`--json` global flag** detection in `CLIBuilder.execute()`. Strips `--json` from argv before command dispatch. CLI-level dispatch errors (unknown command, no action) rendered as JSON when active.
- **`jsonMode`** and **`isTTY`** options on `RunOptions`, `CLIRunOptions`, and `OutputOptions`. `CLIBuilder.run()` auto-sources `isTTY` from `adapter.isTTY`.

### Changed

- `ActionParams<F, A>` → `ActionParams<F, A, C>` with `ctx: Readonly<C>` (was `Readonly<Record<string, unknown>>`).
- `CommandBuilder` carries third type parameter `C` (default `Record<string, never>`). All metadata/builder methods preserve `C` in return type.
- `CommandSchema.middleware` added as `readonly ErasedMiddlewareHandler[]`.
- `Out` interface extended with `json()`, `table()`, `jsonMode`, and `isTTY`.
- `OutputChannel` constructor accepts `isTTY` and `jsonMode` from resolved options. `log`/`info` redirect to stderr writer in JSON mode.
- `runCommand` and `CLIBuilder.execute` error paths render JSON when `jsonMode` active.
- `createCaptureOutput` accepts `jsonMode` and `isTTY` options.
- Test count: 1010 tests across 31 test files (up from 797 in v0.3.0).

## [0.3.0] - 2026-02-09

### Added

#### Interactive Prompting

- **Prompt type definitions** (`PromptConfig`) as a discriminated union with four kinds: `confirm`, `input`, `select`, `multiselect`. Each kind has specialized fields — `InputPromptConfig` supports `placeholder` and `validate`, select/multiselect support `SelectChoice` arrays with optional labels and descriptions.
- **`FlagBuilder.prompt(config)`** metadata modifier for declaring prompt configuration on flags, following the same immutable builder pattern as `.env()` and `.config()`.
- **Prompt engine interface** (`PromptEngine`) with `promptOne(config) → Promise<PromptResult>` as a pluggable renderer seam. `ResolvedPromptConfig` variant guarantees non-empty choices for select/multiselect after merging from `FlagSchema.enumValues`.
- **Built-in terminal prompter** (`createTerminalPrompter(read, write)`) with line-based I/O for confirm (y/n), input (with validation and placeholder), select (numbered list), and multiselect (comma-separated numbers with min/max). All prompts have a `MAX_RETRIES = 10` safety valve.
- **Test prompter** (`createTestPrompter(answers, options?)`) with queue-based answers for deterministic testing. `PROMPT_CANCEL` symbol sentinel for simulating cancellation. `onExhausted: 'throw' | 'cancel'` controls behavior when answer queue is empty.
- **Prompt resolution in the resolver**. Resolution chain expanded from CLI > env > config > default to CLI > env > config > **prompt** > default. Flags with prompt config and no value from prior sources trigger `prompter.promptOne()`. Cancelled prompts fall through to default/required. Non-interactive mode (no prompter) skips prompts entirely.
- **`ReadFn`** (`() => Promise<string | null>`) as the minimal stdin abstraction. `null` signals EOF/cancel. `RuntimeAdapter` extended with `stdin: ReadFn` and `stdinIsTTY: boolean`.
- **Node adapter stdin** wraps `process.stdin` via dynamic `import('node:readline')` with lazy per-call readline interfaces. Minimal `node:readline` type declarations in `node-builtins.d.ts` avoid `@types/node` dependency.
- **Automatic prompt gating** in `CLIBuilder.run()`: when `stdinIsTTY=true` and no explicit prompter provided, auto-creates `createTerminalPrompter(adapter.stdin, adapter.stderr)`. Prompt output routed to stderr to avoid interfering with piped stdout.
- **Command-level `.interactive(resolver)`** API on `CommandBuilder`. Resolver receives partially resolved flags (after CLI/env/config), returns `Record<string, PromptConfig | false | undefined>` controlling which flags get prompted. Truthy `PromptConfig` overrides per-flag prompt; `false` explicitly suppresses; absent falls back to per-flag `.prompt()` config.
- **Testkit `answers` convenience** on `RunOptions`. Accepts `Record<string, TestAnswer>` to auto-create a test prompter. `prompter` field also available for explicit engine injection. `CLIRunOptions` mirrors both fields.

### Changed

- `resolve()` is now **async** (`Promise<ResolveResult>`). All callers (`runCommand`, `CLIBuilder.execute`, `CLIBuilder.run`) updated to await.
- Resolution chain expanded from CLI > env > config > default to CLI > env > config > prompt > default.
- `ResolveOptions` extended with optional `prompter: PromptEngine` field.
- `RunOptions` extended with `prompter` and `answers` fields.
- `CLIRunOptions` extended with `prompter` and `answers` fields.
- `RuntimeAdapter` extended with `stdin: ReadFn` and `stdinIsTTY: boolean`.
- `createTestAdapter` defaults to EOF-returning stdin and `stdinIsTTY: false`.
- Test count: 797 tests across 21 test files (up from 599 in v0.2.0).

## [0.2.0] - 2026-02-09

### Added

#### Resolution Chain

- **Environment variable resolution** in the resolver. Flags with `.env('VAR')` now resolve from the `env` record after CLI and before default. String, number, boolean (lenient: `true/false/1/0/yes/no`), enum, and array (comma-separated) coercion. Invalid env values produce `ValidationError` with `TYPE_MISMATCH` or `INVALID_ENUM` codes.
- **Config object resolution** in the resolver. Flags with `.config('dotted.path')` resolve from a plain `Record<string, unknown>` after env and before default. `resolveConfigPath()` walks nested objects segment-by-segment. Config values may already be typed from JSON — coercion is lenient for matching types. Full chain: CLI > env > config > default.
- **Resolution source annotations** in help text. Flags with env or config declarations now display `[env: VAR]` and `[config: path]` in `formatHelp()` output, ordered between description text and presence indicators.
- **Actionable required-flag error hints**. When a required flag is missing after full resolution, `ValidationError.suggest` lists all configured sources (e.g. "Provide --region, set DEPLOY_REGION, or add deploy.region to config"). CI-friendly error messages with `envVar`/`configPath` in details.
- **Env/config wiring through testkit and CLI builder**. `RunOptions` and `CLIRunOptions` accept `env` and `config` fields. `runCommand()` threads them into `resolve()`. `CLIBuilder.run()` auto-sources `adapter.env` when no explicit env option is provided.

### Changed

- Resolution chain expanded from CLI > default (v0.1) to CLI > env > config > default.
- `resolve()` now accepts optional `ResolveOptions` parameter with `env` and `config` fields.
- `ResolveOptions` exported from public API surface.

## [0.1.0] - 2026-02-09

### Added

#### Core Framework

- **Structured errors** (`CLIError`, `ParseError`, `ValidationError`) with stable error codes, `toJSON()` serialization, type guard functions (`isCLIError`, `isParseError`, `isValidationError`), and actionable `suggest` hints.
- **Flag builder** (`flag`) with full type inference for boolean, string, number, enum, and array kinds. Supports `.alias()`, `.default()`, `.required()`, `.describe()`, `.hidden()`, `.deprecated()`, `.env()`, and `.config()` declarations.
- **Arg builder** (`arg`) with type inference for string, number, custom parse functions, and variadic args. Supports `.default()`, `.required()`, `.optional()`, and `.describe()`.
- **Command builder** (`command`) with `.flag()`, `.arg()`, `.description()`, `.example()`, `.hidden()`, `.alias()`, and `.action()`. Accumulates phantom types so handler receives fully inferred `flags` and `args`.
- **Argv parser** with tokenizer (`tokenize`) and schema-aware parser (`parse`). Handles long/short flags, `=` syntax, boolean negation (`--no-*`), flag stacking (`-abc`), `--` separator, and type coercion against the schema.
- **Resolution chain** (CLI parsed value → schema default). Validates all required flags/args, aggregates multiple errors into a single throw, and provides per-field suggestions.
- **Auto-generated help text** (`formatHelp`) from command schema, including usage line, description, positional args, flags with types/defaults/aliases, examples section, and subcommand listing.
- **Output channel** (`createOutput`) with `log`/`info`/`warn`/`error` methods, `WriteFn` abstraction, verbosity levels (normal/quiet), and TTY detection. Includes `createCaptureOutput()` test helper.
- **Test harness** (`runCommand`) for running commands as pure functions with injected argv, env, and captured output. Returns `RunResult` with `exitCode`, `stdout`, `stderr`, and `error`.
- **CLI builder** (`cli`) with `.command()` registration, `.version()`, subcommand dispatch, automatic `--help`/`--version` flag handling, and unknown-command error with suggestions.
- **RuntimeAdapter interface** defining the platform abstraction boundary (argv, env, cwd, stdout/stderr, isTTY, exit). Includes `createTestAdapter()` for injectable test stubs and `ExitError` for testable process exits.
- **Node.js adapter** (`createNodeAdapter`) wiring `process.argv`, `process.env`, `process.cwd()`, `process.stdout`/`stderr`, and TTY detection.
- Stub files for Bun adapter, Deno adapter, runtime auto-detection, and shell completion generation.

#### Project Infrastructure

- Project scaffold with `src/` structure, TypeScript strict config, and ESM + CJS dual build via tsdown.
- Vitest test framework with 464 passing tests across 12 test files.
- Biome linter and dprint formatter configuration.
- `@vitest/coverage-v8` for test coverage reporting.
- `@arethetypeswrong/cli` and `publint` for package quality checks.
- CI script (`pnpm run ci`) running typecheck, lint, test, and build in sequence.
- PRD.md with full product requirements document.
- MIT License.
- Markdownlint configuration.

[Unreleased]: https://github.com/kjanat/dreamcli/compare/v4.0.0-rc.3...HEAD
[4.0.0-rc.3]: https://github.com/kjanat/dreamcli/compare/v4.0.0-rc.2...v4.0.0-rc.3
[4.0.0-rc.2]: https://github.com/kjanat/dreamcli/compare/v4.0.0-rc.1...v4.0.0-rc.2
[4.0.0-rc.1]: https://github.com/kjanat/dreamcli/compare/v3.0.1...v4.0.0-rc.1
[3.0.1]: https://github.com/kjanat/dreamcli/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.20...v3.0.0
[3.0.0-rc.20]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.19...v3.0.0-rc.20
[3.0.0-rc.19]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.18...v3.0.0-rc.19
[3.0.0-rc.18]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.17...v3.0.0-rc.18
[3.0.0-rc.17]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.16...v3.0.0-rc.17
[3.0.0-rc.16]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.15...v3.0.0-rc.16
[3.0.0-rc.15]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.14...v3.0.0-rc.15
[3.0.0-rc.14]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.13...v3.0.0-rc.14
[3.0.0-rc.13]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.12...v3.0.0-rc.13
[3.0.0-rc.12]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.11...v3.0.0-rc.12
[3.0.0-rc.11]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.10...v3.0.0-rc.11
[3.0.0-rc.10]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.9...v3.0.0-rc.10
[3.0.0-rc.9]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.8...v3.0.0-rc.9
[3.0.0-rc.8]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.7...v3.0.0-rc.8
[3.0.0-rc.7]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.6...v3.0.0-rc.7
[3.0.0-rc.6]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.5...v3.0.0-rc.6
[3.0.0-rc.5]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.4...v3.0.0-rc.5
[3.0.0-rc.4]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.3...v3.0.0-rc.4
[3.0.0-rc.3]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.2...v3.0.0-rc.3
[3.0.0-rc.2]: https://github.com/kjanat/dreamcli/compare/v3.0.0-rc.1...v3.0.0-rc.2
[3.0.0-rc.1]: https://github.com/kjanat/dreamcli/compare/v2.5.0...v3.0.0-rc.1
[2.5.0]: https://github.com/kjanat/dreamcli/compare/v2.4.1...v2.5.0
[2.4.1]: https://github.com/kjanat/dreamcli/compare/v2.4.0...v2.4.1
[2.4.0]: https://github.com/kjanat/dreamcli/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/kjanat/dreamcli/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/kjanat/dreamcli/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/kjanat/dreamcli/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/kjanat/dreamcli/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/kjanat/dreamcli/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/kjanat/dreamcli/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/kjanat/dreamcli/compare/5b86f72...v1.0.0
[0.9.2]: https://github.com/kjanat/dreamcli/compare/b26f2d8...5b86f72
[0.9.1]: https://github.com/kjanat/dreamcli/compare/v0.9.0...b26f2d8
[0.9.0]: https://github.com/kjanat/dreamcli/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/kjanat/dreamcli/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kjanat/dreamcli/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/kjanat/dreamcli/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kjanat/dreamcli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kjanat/dreamcli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kjanat/dreamcli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kjanat/dreamcli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kjanat/dreamcli/releases/tag/v0.1.0

<!-- markdownlint-disable-file line-length no-duplicate-heading no-bare-urls -->
