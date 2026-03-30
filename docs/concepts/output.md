# Output and TTY

CLIs communicate through text. But *where* that text goes and *how* it looks depends on context.

## stdout and stderr

Every program has two output streams:

- **stdout** (standard output) — the main output. Results, data, the stuff you asked for.
- **stderr** (standard error) — side-channel for errors, warnings, progress info.

```bash
# stdout goes to the file, stderr still shows in terminal
mycli process data.json > output.txt
```

Why two streams? So you can capture the useful output without catching error messages too. When you
pipe commands together, only stdout flows through the pipe:

```bash
mycli list | grep "important"
# errors and warnings still show in the terminal
# only the actual list goes to grep
```

### The Rule of Thumb

- **stdout** = the answer to the question the user asked
- **stderr** = everything else (errors, warnings, progress, debug info)

## What's a TTY?

**TTY** stands for "teletypewriter" — a physical terminal from the 1960s. Today it means "is a human
looking at this output in a real terminal?"

Your program can check: *is my stdout connected to a terminal, or to a pipe/file?*

```bash
mycli list              # stdout → terminal (TTY)
mycli list > file.txt   # stdout → file (not a TTY)
mycli list | grep x     # stdout → pipe (not a TTY)
```

Why does this matter? Because the right behavior changes:

| Situation            | What to do                                          |
| -------------------- | --------------------------------------------------- |
| TTY (human watching) | Colors, spinners, progress bars, formatted tables   |
| Piped/redirected     | Plain text, no colors, no animations, stable format |

::: warning
If you pipe colored output to a file, you get garbage like `\x1b[32mSuccess\x1b[0m` instead of
`Success`. Good CLIs detect this and strip colors automatically.
:::

## Colors

Colors make output scannable for humans:

- 🔴 **Red** for errors
- 🟡 **Yellow** for warnings
- 🟢 **Green** for success

But colors are just escape codes — special characters that terminals interpret. They're meaningless
(and ugly) in log files, pipes, or CI output. The convention:

- **TTY** → colors on
- **Not TTY** → colors off
- **`NO_COLOR` env var set** → colors off (it's a [standard](https://no-color.org/))
- **`--no-color` flag** → colors off

## Spinners and Progress Bars

Spinners (`⠋ Loading...`) and progress bars (`[████░░░░] 50%`) make waiting feel faster. But they
only make sense when a human is watching.

In a **TTY**:

```
⠋ Uploading files... 3/10
```

In a **pipe or CI**:

```
Uploading files... done (10 files)
```

The spinner version redraws the same line (using terminal escape codes). The plain version just
prints a line when it's done. Same information, different presentation.

## Tables

Tables are great for listing structured data:

```
NAME       STATUS    UPTIME
web-1      running   3d 2h
web-2      running   1d 5h
worker-1   stopped   -
```

In a TTY, you can align columns nicely. When piped, you might want tab-separated values (TSV) or
JSON instead — something other programs can parse.

## JSON Output

Many CLIs offer a `--json` flag:

```bash
mycli list --json
```

```json
[
	{ "name": "web-1", "status": "running", "uptime": "3d 2h" },
	{ "name": "web-2", "status": "running", "uptime": "1d 5h" }
]
```

### Why Offer JSON?

Scripts and other programs need to read CLI output. Parsing human-formatted tables is fragile — one
column header change breaks everything. JSON is structured, predictable, and every language can
parse it.

### When to Offer JSON

- Your command returns **structured data** (lists, records, status objects)
- Other tools might need to **consume the output** programmatically
- You want to support **automation** (CI pipelines, scripts, cron jobs)

You probably don't need JSON for:

- Pure side-effect commands (`rm`, `mkdir`)
- One-liner outputs (`echo`, `pwd`)

### How JSON Mode Works

When `--json` is active:

- **stdout** = structured JSON (the data)
- **stderr** = human messages, errors, progress (not JSON)

This keeps the JSON output clean and parseable while still letting the user see what's happening.

## What's Next?

- [Exit Codes](/concepts/exit-codes) — how a CLI says "it worked" or "it didn't"
- [Errors](/concepts/errors) — making error messages actually helpful

::: tip Ready to build?
See the [Output guide](/guide/output) for dreamcli's output API — spinners, tables, JSON mode, and
more.
:::
