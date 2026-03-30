# Exit Codes

When a program finishes, it returns a number. That number is the **exit code**, and it's how a CLI
tells the calling process whether things went well.

## The Basics

- **0** = success
- **anything else** = failure

That's the entire convention. Zero means "it worked." Non-zero means "something went wrong."

```bash
ls /tmp
echo $?          # 0 — it worked

ls /nonexistent
echo $?          # 2 — that folder doesn't exist
```

`$?` is a shell variable that holds the exit code of the last command.

## Why Exit Codes Matter

Scripts use them to make decisions:

```bash
if mycli check; then
  echo "All good"
else
  echo "Something's wrong"
fi
```

The `if` doesn't look at the output text. It only checks the exit code.

::: warning A tool that prints "error" but exits with `0` will silently pass in scripts. Get your
exit codes right. :::

CI systems work the same way. A build step that exits non-zero fails the pipeline.

## Common Exit Codes

There's no universal standard, but common conventions:

| Code    | Meaning                                                       |
| ------- | ------------------------------------------------------------- |
| `0`     | Success                                                       |
| `1`     | General error                                                 |
| `2`     | Misuse (wrong arguments, bad flags)                           |
| `126`   | Command found but not executable                              |
| `127`   | Command not found                                             |
| `128+N` | Killed by signal N — shell reports 128+N (e.g., 130 = Ctrl+C) |

Most CLIs only care about 0, 1, and 2. If you're building a CLI:

- **0** when the command does what the user asked
- **1** when something goes wrong at runtime (network error, file not found)
- **2** when the user gave bad input (unknown flag, missing required argument)

## Signals

When you press **Ctrl+C**, you're not typing a character — you're sending a **signal** called
`SIGINT` (interrupt). The program can catch it and clean up, or just die.

Common signals:

| Key / Event     | Signal    | Exit Code             |
| --------------- | --------- | --------------------- |
| Ctrl+C          | `SIGINT`  | 130                   |
| Ctrl+\\         | `SIGQUIT` | 131                   |
| `kill <pid>`    | `SIGTERM` | 143                   |
| `kill -9 <pid>` | `SIGKILL` | 137 (can't be caught) |

A well-behaved CLI catches `SIGINT` and exits cleanly — closing files, printing a brief message,
returning exit code 130. A badly-behaved one leaves temp files around and corrupts state.

## Chaining Commands

Shells use exit codes to chain commands:

```bash
# && = run next only if previous succeeded (exit 0)
npm install && npm test && npm build

# || = run next only if previous failed (exit non-zero)
mycli check || echo "Check failed!"

# ; = run next regardless of exit code
cleanup; echo "Done"
```

`&&` is the most common. It's why a single failing step stops a CI pipeline — each `&&` checks the
exit code before continuing.

## What's Next?

- [Errors](/concepts/errors) — writing error messages people can actually use
- [Testing CLIs](/concepts/testing) — verifying your CLI works correctly
