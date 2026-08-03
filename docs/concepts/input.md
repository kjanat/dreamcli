# Input Sources

A CLI gets its data from all over the place — flags you type, env vars, config files, piped input.
Knowing where values come from (and which one wins) is how you build tools that work on someone's
laptop _and_ in a CI pipeline.

## argv — The Argument Vector

When you type a command, your shell splits it into a list of strings and passes it to the program.
This list is called **argv** (argument vector).

```bash
mycli greet Alice --loud
```

The program receives:

```json
["mycli", "greet", "Alice", "--loud"]
```

That's it. Just strings. The CLI framework's job is to parse these strings into something meaningful
— commands, arguments, flags, values.

::: info Why "vector"?
It's just a fancy word for "ordered list."

The name comes from C, where [`argv`](https://www.gnu.org/software/c-intro-and-ref/manual/html_node/Command_002dline-Parameters.html) was literally an array of character pointers.
You'll see it everywhere in CLI programming.
:::

## Environment Variables

Environment variables are key-value pairs that exist outside your command.
They're set in your shell, your `.bashrc`, your CI config, your Docker setup — all over the place.

```bash
export API_KEY=abc123
mycli upload photo.jpg  # can read API_KEY without you typing it
```

Why use env vars?

- **Secrets** — you don't want passwords in your shell history
- **Configuration** — same command, different behavior per environment
- **CI/CD** — automated systems set env vars instead of typing flags

A well-designed CLI lets you do:

```bash
# These are equivalent:
mycli upload --region eu photo.jpg
MYCLI_UPLOAD_REGION=eu mycli upload photo.jpg
```

Same result, different input source. The flag wins if both are present.

## Config Files

For settings you use every time, typing flags gets old fast. Config files solve this:

For example, in `~/.config/mycli/config.json` on Unix
or `%APPDATA%\\mycli\\config.json` on Windows:

```json
{
  "region": "eu",
  "format": "json"
}
```

Now `mycli upload photo.jpg` reads `region` from the config file automatically. No flag needed.

Common config file locations:

- **Project-local**: `./.mycli.json`, `./mycli.config.json`
- **User-level**: `~/.config/mycli/config.json` (Linux/Mac) or
  `%APPDATA%\\mycli\\config.json` (Windows)
- **System-level**: `/etc/mycli/config.json`

On Linux and Mac, the convention follows **XDG**.
On Windows, the equivalent user config location is usually `%APPDATA%`.
You don't need to memorize it; good CLIs handle the search automatically.

## stdin — Standard Input

Programs can read data piped in from other programs:

```bash
cat file.txt | grep "error"
echo '{"name":"Alice"}' | mycli process
```

The `|` (pipe) connects the output of one program to the input of the next. The receiving program
reads from **stdin** (standard input) — a stream of bytes, like reading from a file that happens to
be another program's output.

This is powerful because it lets you chain small tools together:

```bash
curl -s https://api.example.com/data | jq '.items[]' | sort | head -5
```

Four programs, connected by pipes, each doing one thing well.

A pipe carries bytes, not slots, so a program that accepts several values needs
a way to say *which* one the pipe fills. The convention is a bare `-`, and it
holds the position the piped data takes:

```bash
mycli send --tag before --tag - --tag after
```

The `-` sits between two ordinary values, and what the pipe carried lands
exactly there. The same token works in a positional slot. A program that reads
one value can skip the `-` entirely and let an omitted slot mean the pipe.

The cost of the convention is that a program reading the stream can no longer
take a literal `-` as data, since the token is read as the source first.

One more thing a pipe does that a command line does not: it appends a line
terminator. `echo ./docs` sends `./docs\n`, not `./docs`. For a number or a
date that terminator is framing and gets dropped, but for a string the text
*is* the value, so the newline is part of it unless the program asks for it to
be trimmed. This is the single most common surprise when a piped path fails a
check that the same path typed by hand passes.

## Interactive Prompts

Sometimes a CLI asks you questions:

```bash
$ mycli init
? Project name: my-app
? Language: TypeScript
? Include tests? Yes
```

This is **interactive input** — the program waits for you to type something. It only works when
there's a human at the keyboard. If the program is running in CI or piped input, there's no one to
answer.

Good CLIs handle this gracefully:

- In a terminal → prompt the user
- In CI/piped → use defaults, env vars, or fail with a clear error

## Resolution Order

When a value can come from multiple places, there's a natural priority.

The first source that has a value wins.

Flags and positional arguments share one order:

```text
1. Command line          (highest, you typed it explicitly)
2. Piped stdin           (data another program sent in)
3. Environment variable  (set for this session/environment)
4. Config file           (persistent settings)
5. Interactive prompt    (ask the user)
6. Default value         (fallback)
```

Every step past the command line is opt-in. An input takes part in a step only when it declared
that source, so a flag or argument with nothing declared stays command-line only and is
required-or-optional based on its own declaration.

## One Value Or Many

Some inputs hold one value. Others hold a list, or a set of key-value entries.
That distinction is separate from the type of each value, and it changes what
"the first source wins" means: a list-shaped input collects from the source that
supplies it rather than picking a single winner.

Every source can spell a list, but each one spells it differently, because each
one is a different medium:

```bash
mycli deploy --tag a --tag b     # the command line repeats the flag
TAGS=a,b mycli deploy            # an env var is one string, so it needs a separator
printf 'a\nb\n' | mycli deploy   # a pipe is a stream, so lines are the natural unit
```

```json
{ "tags": ["a", "b"] }
```

A config file has real arrays and objects, so it needs no separator at all.

This is why a list-shaped input carries a decoding rule per source rather than
one rule for all of them. A comma is the right default for an env var and the
wrong one for a pipe. Guessing is worse than either: text that happens to look
like JSON is not a promise that it is JSON, so a source parses JSON only when
the declaration says it should.

Key-value entries add one more question a list does not have: what a repeated
key means. Whether the later entry wins, the earlier one does, or the repeat is
an error is a decision the input declares once and every source obeys.

## What's Next?

- [Output and TTY](/concepts/output) — how CLIs talk back to you
- [Exit Codes](/concepts/exit-codes) — how CLIs signal success or failure
- [Flags guide](/guide/flags) — implementing flags with env var and config resolution in dreamcli
