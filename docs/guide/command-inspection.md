# Inspect a command before executing it

Use `await app.inspect(argv, options)` when a host needs resolved inputs before deciding whether
to run a command. A job runner can preview a report, ask for approval in its own UI, and resume
the invocation the operator reviewed.

## Try a preview

Keep the input fixed and change only approval. The spinner shows the matched command, the
source of the format, and its resolved value.

```console
$ bun examples/command-inspection.ts export --format csv
inspect() matched export.
Matched --format in argv.
Resolved format = "csv".

$ EXPORT_APPROVED=yes bun examples/command-inspection.ts export --format csv
inspect() matched export.
Matched --format in argv.
Resolved format = "csv".
package,version
demo,1.0.0
```

With `REPORT_FORMAT=tsv bun examples/command-inspection.ts export`, the second line names the
environment variable and the final line shows `"tsv"`. In a terminal the spinner
holds each observation for five seconds before replacing it. The final observation stays on screen.
Redirecting stderr gives you the plain transcript immediately.
The observations go to stderr and the report goes to stdout.
[Read the runnable report example](/examples/command-inspection).

## Inspect and resume

```ts twoslash
import { cli, command, flag } from '@kjanat/dreamcli';

const app = cli('reports').command(
  command('export')
    .flag('limit', flag.number({ int: true, min: 1 }).default(20))
    .action(({ flags, out }) => out.log(`Exporting ${flags.limit} rows`)),
);

const result = await app.inspect(['export', '--limit', '5']);
if (result.kind === 'match' && result.flags.limit === 5) {
  const run = await result.execute();
  // run.stdout contains "Exporting 5 rows\n".
}
```

Inspection uses the same command routing, argv transforms, parsers, and input resolution as
`.execute()`. A match identifies the canonical route in `path` (for example, `['repo', 'list']`) and contains the flags, positionals, their provenance, flag occurrences,
deprecations, and skipped filesystem checks. Treat resolved values as read-only, including
objects returned by custom parsers.

The handle resumes with these values. It runs `afterResolve`, command constraints and validators,
deprecation warnings, `beforeAction`, derives, middleware, the action, and `afterAction` in their
usual order. Validation and action failures appear in the returned `RunResult`. Concurrent calls
and later calls share one promise, including a failed result. Inspect again for a fresh run.
Dropping a match leaves its action unexecuted.

## Prompts, output, and I/O

Inspection uses the inputs you supply. Pass `env`, `config`, or `stdinData` to preview a run with
those sources. It does not discover config files, read the terminal, or create a runtime adapter.
Resolution may use injected `answers` or a `prompter`, and explicitly supplied filesystem callbacks
such as `stat` and `mkdir` can perform I/O. Required unresolved inputs produce a structured error.
A prompt issued by the action waits for the execute handle, which reuses the invocation's prompter.

Custom transforms, parsers, and resolution callbacks run during inspection. Their own side effects
are their responsibility. Writes through a plugin's DreamCLI output channel are captured in memory
and are included in the resumed result. Inspection itself emits no help text or error messages.

## Handle other outcomes

| Result kind | What the host receives |
| --- | --- |
| `root-help` | The CLI schema and the short or full help request. |
| `command-help` | The matched command schema and the short, full, or topic help request. A group awaiting a subcommand also produces command help. |
| `root-version` | The version string. |
| `root-completions` | The shell selected by the eager completions flag. |
| `dynamic-completion` | The completion protocol arguments. The host can choose whether to run providers. |
| `dispatch-error` | A structured routing error with its code, message, and exit code. |
| `command-error` | A parse or resolution error. Once parsing has produced a context, it is available as `result.parse`. |

Use the result kind to select your host's help view or error response. To display ordinary
terminal help, the host can delegate the help request to the CLI's existing execution path.
