# Input Sources

A CLI can get its data from several places. Understanding these is key to building tools that work
everywhere — on someone's laptop, in a CI pipeline, in a Docker container.

## argv — The Argument Vector

When you type a command, your shell splits it into a list of strings and passes it to the program.
This list is called **argv** (argument vector).

```bash
mycli greet Alice --loud
```

The program receives:

```
["mycli", "greet", "Alice", "--loud"]
```

That's it. Just strings. The CLI framework's job is to parse these strings into something meaningful
— commands, arguments, flags, values.

::: info Why "vector"? It's just a fancy word for "ordered list." The name comes from C, where
`argv` was literally an array of character pointers. You'll see it everywhere in CLI programming.
:::

## Environment Variables

Environment variables are key-value pairs that exist outside your command. They're set in your
shell, your `.bashrc`, your CI config, your Docker setup — all over the place.

```bash
export API_KEY=abc123
mycli upload photo.jpg    # can read API_KEY without you typing it
```

Why use env vars?

- **Secrets** — you don't want passwords in your shell history
- **Configuration** — same command, different behavior per environment
- **CI/CD** — automated systems set env vars instead of typing flags

A well-designed CLI lets you do:

```bash
# These are equivalent:
mycli upload --region eu photo.jpg
UPLOAD_REGION=eu mycli upload photo.jpg
```

Same result, different input source. The flag wins if both are present.

## Config Files

For settings you use every time, typing flags gets old fast. Config files solve this:

```json
// ~/.config/mycli/config.json
{
	"region": "eu",
	"format": "json"
}
```

Now `mycli upload photo.jpg` reads `region` from the config file automatically. No flag needed.

Common config file locations:

- **Project-local**: `./mycli.json`, `./.myclirc`
- **User-level**: `~/.config/mycli/config.json` (Linux/Mac)
- **System-level**: `/etc/mycli/config.json`

The convention on Linux and Mac follows **XDG** — a standard for where config files should live. You
don't need to memorize it; good CLIs handle the search automatically.

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

When a value can come from multiple places, there's a natural priority:

```
1. Command-line flag       (highest — you typed it explicitly)
2. Environment variable    (set for this session/environment)
3. Config file             (persistent settings)
4. Interactive prompt      (ask the user)
5. Default value           (fallback)
```

The first source that has a value wins. This way, you can set defaults in a config file but override
them per-command or per-environment.

## What's Next?

- [Output and TTY](/concepts/output) — how CLIs talk back to you
- [Exit Codes](/concepts/exit-codes) — how CLIs signal success or failure
