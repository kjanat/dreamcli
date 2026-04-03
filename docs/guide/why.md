# Why dreamcli

Most TypeScript CLI frameworks treat the type system like decoration.
You define flags in one place, then use parsed values somewhere else as a loosely typed blob.
Env vars, config files, and interactive prompts live in separate universes.
Testing means hacking `process.argv`.

dreamcli collapses all of that into a single typed schema.

## Comparison

Approximate comparison of first-party, built-in support as documented by each project.
Third-party plugins and custom glue can extend the other libraries.

| Capability                                 | Commander           | Yargs                  | Citty           | CAC           | Cleye         | dreamcli                              |
| ------------------------------------------ | ------------------- | ---------------------- | --------------- | ------------- | ------------- | ------------------------------------- |
| Type inference from definition             | Manual `.opts<T>()` | Good                   | Good            | Basic         | Good          | Full — flags, args, context           |
| Built-in value sources                     | CLI, defaults, env  | CLI, env, config       | CLI, defaults   | CLI, defaults | CLI, defaults | CLI, env, config, prompt, default     |
| Schema-driven prompts                      | No                  | No                     | No              | No            | No            | Integrated                            |
| Middleware / hooks                         | Lifecycle hooks     | Middleware             | Plugins / hooks | Events        | No            | Yes — typed middleware                |
| Built-in test harness with output capture  | No                  | No                     | No              | No            | No            | `runCommand()` + capture              |
| Shell completions from command definitions | No                  | Built-in (bash/zsh)    | No              | No            | No            | Built-in (bash/zsh)                   |
| Structured output primitives               | DIY                 | DIY                    | DIY             | DIY           | DIY           | Built-in (`--json`, tables, spinners) |
| Config file support                        | DIY                 | Built-in (`.config()`) | No              | No            | No            | Built-in (XDG discovery, JSON)        |

## The Core Insight

The closest analog is what tRPC did to API routes — the individual pieces existed.
The insight was wiring them so types flow end-to-end.

One flag declaration:

```ts
flag
  .enum(['us', 'eu', 'ap'])
  .alias('r')
  .env('DEPLOY_REGION')
  .config('deploy.region')
  .prompt({ kind: 'select', message: 'Which region?' })
  .default('us');
```

This single chain configures:

- **Parsing** — accepts `--region us` or `-r eu`
- **Type inference** — `flags.region` is `"us" | "eu" | "ap"` in the handler
- **Resolution** — CLI → env var → config file → interactive prompt → default
- **Help text** — flag appears with description, alias, default, and choices
- **Shell completions** — tab-complete suggests `us`, `eu`, `ap`
- **Testing** — override via `env`, `config`, or `answers` in test harness

## Design Principles

1. **Schema is the law.** Everything derives from it: parsing, types, resolution, help, completions.
2. **Progressive disclosure.** A 5-line script stays 5 lines. Complexity scales by composition.
3. **Deterministic behavior.** Resolution rules are explicit and consistent.
4. **Portable by default.** Core avoids runtime-specific APIs; adapters handle the edges.
5. **Ergonomic, not clever.** Predictable DX over type-theory stunts.

## Related Pages

- [Architecture Rationale](/guide/rationale)
- [Limitations And Workarounds](/guide/limitations)
- [CLI Semantics](/guide/semantics)
