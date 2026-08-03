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

- provide the value through CLI, env, config, stdin-backed inputs, or a default;
- in tests, inject answers through `runCommand()` instead of relying on terminal behavior.

References: [Interactive Prompts](/guide/prompts), [CLI Semantics](/guide/semantics)

## Config Values Are Ignored

Symptom:

- a config file exists, but the command still uses env, prompt, or default values;
- a config value works for one flag but not another.

Cause:

- config only participates for inputs wired with `.config(path)`;
- config is lower priority than CLI, stdin, and env on both surfaces.

Check:

- the CLI is configured with `cli().config('<app-name>')`;
- the specific flag or argument uses the expected `.config('a.b.c')` path;
- a higher-priority source did not already win.

Fix:

- add or correct the input's `.config()` path;
- remove the higher-priority value while testing precedence.

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

## Piped Stdin Does Not Reach An Input

Symptom:

- you pipe data into the command, but the flag or argument stays empty or falls through to
  env/default.

Cause:

- a flag or argument reads stdin only when it declared `.stdin()`;
- a `{ when: 'dash' }` binding reads the stream only for an explicit `-`;
- a `{ when: 'missing' }` binding treats a typed `-` as the literal string.

Check:

- the declaration includes `.stdin()`;
- the binding's `when` matches how the value is being passed;
- the CLI token or `--flag value` did not already satisfy the input first.

Fix:

- opt the input into `.stdin()` if piped data is part of the intended contract;
- widen `when` to the default `'dash-or-missing'` to accept both forms;
- otherwise pass the value explicitly on argv.

References: [CLI Semantics](/guide/semantics), [Arguments](/guide/arguments), [Flags](/guide/flags)

## A Piped Value Carries A Trailing Newline

Symptom:

- a piped path fails a `mustExist` check that passes for the same path typed on
  the command line, with the error text broken across two lines;
- a piped string compares unequal to the value you expected.

Cause:

- there is no trim option. A `string` input keeps the stdin buffer byte for
  byte, because for a string the text *is* the value, and truncating it would
  discard data the caller may have meant. `flag.path()` and `arg.path()` resolve
  as strings, so they keep it too.
- every other scalar kind interprets the text rather than keeping it, so it
  drops one trailing `\n`, `\r\n`, or `\r` before decoding. `echo 42` reaches
  `flag.number()` as `42`, and `echo 30s` reaches `flag.duration()` as `30s`.

Check:

- the input's kind. Only `string` and the path kinds keep the terminator.
- whether the producer appends a newline. `echo` does; `printf` without `\n`
  does not.

Fix:

- pipe with `printf './docs'` instead of `echo ./docs`;
- or strip the terminator upstream, for example `... | tr -d '\n' | mycli`;
- or declare the input as a collection, where line splitting treats a final
  terminator as framing and drops it.

References: [CLI Semantics](/guide/semantics), [Flags](/guide/flags#path),
[Arguments](/guide/arguments#path)

## A Piped Collection Loses Or Duplicates Elements

Symptom:

- a `-` occurrence on an array or key-value input produces nothing, or produces
  more elements than the pipe carried;
- the pipe's elements land in the wrong position in the resolved list.

Cause:

- a `-` occurrence stands for the whole stdin source at the position it holds,
  and the decoded elements are spliced in there. Two `-` occurrences therefore
  splice the same buffer twice.
- when every occurrence is `-` and nothing was piped, the input produces no CLI
  value at all, so a later source or the default supplies the result.
- an input that never declared `.stdin()` treats `-` as an ordinary element and
  never reads the stream.
- the buffer decodes under the *stdin* policy, `'lines'` by default, not under
  the CLI separator.

Check:

- the declaration includes `.stdin()`, and its `when` accepts a dash;
- how many `-` occurrences the invocation actually passes;
- whether `.split({ stdin })` matches the shape being piped, for example
  `'json'` for a piped JSON document.

Fix:

- pass `-` once for one splice;
- set `.split({ stdin: 'json' })` or a delimiter when the pipe is not
  line-oriented;
- pass the values on argv when the pipe was not meant to be the source.

References: [Collections](/guide/flags#collections),
[CLI Semantics](/guide/semantics)

## Two Inputs Both Want Stdin

Symptom:

- building the command throws `DUPLICATE_STDIN_INPUT` before any argv is read.

Cause:

- one command has one exclusive stdin consumer, and a second `.stdin()` input of either surface
  claims a stream that is already spoken for.

Fix:

- keep `.stdin()` on a single input;
- or declare every stdin input on that command with `{ consume: 'broadcast' }`, which hands the
  same buffer to each of them.

References: [Arguments](/guide/arguments#stdin-constraints), [Flags](/guide/flags#stdin-constraints)

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
2. Confirm in [Support Matrix](/reference/support-matrix) that the surface is actually shipped.
3. Review [Limitations And Workarounds](/guide/limitations) for intentional constraints.
4. Reduce the command to one failing flag or arg and reproduce it under `runCommand()`.

## Related Pages

- [CLI Semantics](/guide/semantics)
- [Limitations And Workarounds](/guide/limitations)
- [Migration And Adoption](/guide/migration)
- [Testing Commands](/guide/testing)
- [Support Matrix](/reference/support-matrix)
