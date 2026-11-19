# Migrating command-line syntax

Suppose your notes CLI used `--from-stdin` to read a note from a pipe. The new command accepts
`--body TEXT` for a literal and `--body -` for piped text. Existing shell scripts still need
to work, and their authors need to know what to change.

Declare the current `body` flag once. Register a plugin with `transformArgv` to expand the old
switch into the two new tokens. The parser, stdin reader, and duplicate checks then see the same
invocation as a user typing `--body -`. For a second spelling that takes exactly the same value,
a flag alias is sufficient.

## Try the migration

From a DreamCLI checkout, run the old and new commands with the same input:

```console
$ printf 'Released\n' | bun examples/argv-transforms.ts add changelog --from-stdin
Use --body - in place of --from-stdin.
changelog: Released
$ printf 'Released\n' | bun examples/argv-transforms.ts add changelog --body -
changelog: Released
$ bun examples/argv-transforms.ts add --body 'Literal title' -- --from-stdin
--from-stdin: Literal title
```

The first command writes the migration hint to stderr. Both piped commands write the same note
to stdout, so a script that redirects the note keeps working. In the third command, `--` ends
option parsing and the title is literally `--from-stdin`.

[Read the runnable notes CLI](/examples/argv-transforms).

## Where each hook fits

1. DreamCLI selects the command and handles built-in help. A `beforeParse` observer can inspect
   the original arguments for the selected command. Its return value is ignored.
2. DreamCLI awaits each registered `transformArgv` in order. The notes plugin handles only
   `add`, rewrites tokens before `--`, and returns `metadata: { usedFromStdin: true }`.
   Returning nothing leaves both arguments and metadata alone.
3. DreamCLI parses the final arguments. In the action, `parse.flag('body')` reports `--body` for
   either piped command. Read `parse.metadata.usedFromStdin` to decide whether to warn. Use
   `flags.body` for the resolved note text.

When chaining plugins, give each plugin its own metadata key. A later transform can read earlier
entries and replace a top-level key. Each invocation starts with an empty metadata object.

## Test the CLI boundary

Register the plugin on your CLI and call `app.execute(argv, { stdinData })`. Run the legacy and
current forms with the same input. Assert that both succeed and produce identical stdout, then
check that only the legacy form emits the migration hint on stderr. Include a literal after
`--` to catch rewrites that accidentally change user data.
