# cli: CLIBuilder, dispatch, plugins, inspection

Root orchestration. Handlers and the compiled graph live beside the public `CLISchema`, not inside it.

## FILES

| File                                               | Role                                              |
| -------------------------------------------------- | ------------------------------------------------- |
| `index.ts`                                         | `cli()`, `CLIBuilder`, `executeCLI()`             |
| `compiled.ts`                                      | `CompiledCLI` / `CompiledCommand`                 |
| `planner.ts`                                       | `planInvocation()`, command map, plan kinds       |
| `dispatch.ts`                                      | nested command match, unknown-command suggestions |
| `runtime-preflight.ts`                             | adapter, env, config, stdin, before dispatch      |
| `builtins.ts`                                      | spelling table for `help` / `json` / `quiet`      |
| `reserved-flags.ts`                                | root-owned token guard                            |
| `root-output-flags.ts`                             | `--json` / `--quiet` reader                       |
| `root-help.ts`, `root-surface.ts`, `help-links.ts` | root help and version surface                     |
| `help-output-flags.ts`                             | help color and hyperlink modes                    |
| `config-flag.ts`                                   | `--config` / `--no-config` extraction             |
| `propagate.ts`                                     | ancestor flags on descendant commands             |
| `plugin.ts`                                        | plugin hooks                                      |
| `inspection.ts`                                    | `inspect()` result, execution stages on demand    |

## WHERE TO LOOK

| Task                                      | Location                                         |
| ----------------------------------------- | ------------------------------------------------ |
| A builder method drops handlers           | `rebuild()` / `CLIBuilder._from()` in `index.ts` |
| Root `--json` or `--quiet`                | `readRootOutputFlags()`                          |
| A command flag collides with a root token | `reserved-flags.ts`                              |
| Unknown token vs default command          | `planner.ts`                                     |
| Stdin read before dispatch                | `runtime-preflight.ts`                           |
| Completion or config or schema load       | `../feature-loaders.ts`, dynamic `import()`      |

## CONVENTIONS

- `CLISchema` is the public descriptor. Handlers, steps, subcommands, and plugins live in a module-private `WeakMap` of `CompiledCLI`
- A new `CLIBuilder` goes through `rebuild()` or `_from()`. A bare `new` has no compiled entry
- `BUILTIN_SPECS` is the spelling table. Root output flags, the reserved-token set, root help, and completion all read it
- `version` / `V` is opt-in via `.version()`, not a built-in
- Membership tests on flag and arg records use `Object.hasOwn()`

## ANTI-PATTERNS

- Do not import `schema/command.ts`, `schema/flag.ts`, or `schema/arg.ts` through the schema barrel
- Do not value-import `completion/index.ts`, `config/index.ts`, `json-schema/index.ts`, or `prompt/terminal.ts`. Load them through `feature-loaders.ts`. Type imports stay
- Do not put `CompiledCommand.schema` and `plan.mergedSchema` on the same object when a propagated flag caused a spread

## NOTES

- `executeCLI()` renders plan kinds `root-version`, `root-completions`, `root-help`, `dispatch-error`, `needs-subcommand`, and `match`
- `--json` is stripped only before `--`
- `.builtins({ name: 'off' })` releases that token to commands. Call it before `.command()` declares the flag
- `planner.ts` and testkit share `../execution/`
