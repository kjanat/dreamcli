# Troubleshooting

This page covers the most likely real failure modes when building or evaluating a DreamCLI app.

Use it alongside [CLI Semantics](/guide/semantics) and the [Support Matrix](/reference/support-matrix):
those pages describe product truth and exact rules; this page translates the common failure cases into
quick diagnosis steps.

## Prompts Never Appear

Symptom:

- a flag has `.prompt()` configured, but the CLI errors instead of asking;
- the same command prompts locally but not in CI or when piped.

Cause:

- DreamCLI only auto-prompts when a prompter exists and `stdinIsTTY` is `true`.

Check:

- are you running in CI, a pipe, or redirected stdin context;
- did an earlier source already resolve the value from CLI, env, or config.

Fix:

- provide the value through CLI, env, config, stdin-backed args, or a default;
- in tests, inject answers through `runCommand()` instead of relying on terminal behavior.

References: [Interactive Prompts](/guide/prompts), [CLI Semantics](/guide/semantics)

## Config Values Are Ignored

Symptom:

- a config file exists, but the command still uses env, prompt, or default values;
- a config value works for one flag but not another.

Cause:

- config only participates for flags wired with `.config(path)`;
- config is lower priority than CLI and env for flags;
- args do not read config at all.

Check:

- the CLI is configured with `cli().config('<app-name>')`;
- the specific flag uses the expected `.config('a.b.c')` path;
- a higher-priority source did not already win.

Fix:

- add or correct the flag's `.config()` path;
- remove the higher-priority value while testing precedence;
- use flags rather than args when config-backed input is part of the command design.

References: [Config Files](/guide/config), [CLI Semantics](/guide/semantics)

## Config Parsing Fails For YAML Or TOML

Symptom:

- DreamCLI reports a config parse or load error for a non-JSON file.

Cause:

- built-in config discovery is JSON-only.

Fix:

- stay on JSON for the default path;
- or register a custom loader with `configFormat()` and `configLoader()`.

References: [Config Files](/guide/config), [Limitations And Workarounds](/guide/limitations)

## Piped Stdin Does Not Reach An Argument

Symptom:

- you pipe data into the command, but the argument stays empty or falls through to env/default.

Cause:

- positional args use stdin only when that arg opted into `.stdin()`.

Check:

- the argument declaration includes `.stdin()`;
- the CLI token did not already satisfy the argument first.

Fix:

- opt the arg into `.stdin()` if piped data is part of the intended contract;
- otherwise pass the value explicitly on argv.

References: [CLI Semantics](/guide/semantics), [Arguments](/guide/arguments)

## `--json` Changes The Output Shape

Symptom:

- spinner or progress output disappears;
- decorative output does not show up when stdout is piped;
- logs look different in tests than in an interactive terminal.

Cause:

- DreamCLI intentionally changes output policy in JSON mode and non-TTY contexts.

Fix:

- treat JSON mode as a machine-readable surface, not a styled terminal surface;
- test interactive and non-interactive output separately when both matter;
- use the captured `stdout`, `stderr`, and `activity` arrays from `runCommand()` to assert exact behavior.

References: [Output](/guide/output), [Testing Commands](/guide/testing), [Output Contract](/reference/output-contract)

## Completion Script Installs, But Suggestions Look Wrong

Symptom:

- the generated completion script loads, but expected commands or flags are missing;
- root-level completion behaves differently than expected.

Cause:

- hidden commands stay executable but are omitted from help and completions;
- root completion behavior depends on default-command visibility and root mode;
- the wrong shell script may have been installed for the active shell.

Check:

- which shell script you generated and installed;
- whether the command or flag is intentionally hidden;
- whether root behavior depends on a visible default command.

Fix:

- regenerate completions for the exact target shell;
- confirm the command-tree visibility rules in your schema;
- review root/default-command completion semantics before assuming generation is broken.

References: [Shell Completions](/guide/completions), [CLI Semantics](/guide/semantics)

## Tests Behave Differently From Real CLI Runs

Symptom:

- a command passes in `runCommand()` but behaves differently from manual terminal usage;
- prompt or TTY-sensitive behavior does not line up.

Cause:

- the test harness is in-process and fully controlled by `RunOptions`.

Check:

- whether the test set `jsonMode`, `isTTY`, `stdinData`, `env`, `config`, or `answers`;
- whether the real CLI run has different stdin or terminal conditions.

Fix:

- make the test conditions explicit instead of relying on defaults;
- add separate cases for interactive TTY and non-interactive execution when behavior diverges by design.

References: [Testing Commands](/guide/testing), [Runtime Support](/guide/runtime)

## Still Stuck?

Use this order:

1. Check [CLI Semantics](/guide/semantics) for precedence or root-surface rules.
2. Check [Support Matrix](/reference/support-matrix) to confirm the surface is actually shipped.
3. Check [Limitations And Workarounds](/guide/limitations) for intentional constraints.
4. Reduce the command to one failing flag or arg and reproduce it under `runCommand()`.

## Related Pages

- [CLI Semantics](/guide/semantics)
- [Limitations And Workarounds](/guide/limitations)
- [Migration And Adoption](/guide/migration)
- [Testing Commands](/guide/testing)
- [Support Matrix](/reference/support-matrix)
