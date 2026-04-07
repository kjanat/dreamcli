# Anatomy of a CLI

You open a terminal. You type something. Something happens. That's a CLI.

**CLI** stands for command-line interface. Instead of clicking buttons, you type words. It sounds
old-fashioned, but it's how most developer tools actually work — `git`, `npm`, `docker`, `curl`. If
you've ever typed `npm install`, you've used a CLI.

## Breaking Down a Command

Here's a command:

```bash
git commit -m "fix the bug"
```

Let's break it apart:

```bash
git           # → the program
commit        # → the command (what to do)
-m            # → a flag (modifier)
"fix the bug" # → the value for that flag
```

Your shell (the thing running in the terminal) splits this into pieces and hands them to the program
as a list of strings. The program figures out what you meant.

## What's a Command?

A command is the verb — the thing you're asking the program to do.

Some programs only do one thing:

```bash
cat readme.txt   # just reads a file
ping google.com  # just pings a host
```

Others have many commands:

```bash
git status            # check what changed
git add .             # stage changes
git commit -m "done"  # save changes
```

And some go deeper with **subcommands** — commands inside commands:

```bash
docker container ls   # list containers
docker image build .  # build an image
```

Think of it like a menu. `docker` is the restaurant. `container` is the section. `ls` is what you're
ordering.

## What's an Argument?

An argument is a value you pass by position — no name, just order.

```bash
cp source.txt backup.txt
```

The program knows `source.txt` is the thing to copy and `backup.txt` is where to put it, purely
because of the order you typed them. First thing = source. Second thing = destination. That's it.

Arguments are usually the main _thing_ the command works on:

```bash
cat readme.txt    # "read THIS file"
mkdir my-project  # "create THIS folder"
rm old-stuff.log  # "delete THIS file"
```

## What's a Flag?

A flag changes _how_ the command works. Arguments are the what, flags are the how.

Flags come in two flavors:

**Long flags** start with `--` and are readable:

```bash
ls --all       # show hidden files too
curl --silent  # don't show the progress bar
```

**Short flags** are one letter with a single `-`:

```bash
ls -a    # same as --all
curl -s  # same as --silent
```

Short flags can be mashed together:

```bash
ls -la  # same as ls -l -a
```

### Boolean Flags

Some flags are just on/off switches. If you include them, they're on:

```bash
rm --force  # don't ask, just delete
npm install --save-dev
```

### Flags with Values

Other flags need a value:

```bash
curl --output page.html https://example.com
#    ^^^^^^^^ ^^^^^^^^^
#    flag     value

timeout --signal KILL 5 sleep 100
```

### Flags vs Arguments — a Cheat Sheet

```bash
grep "hello" file.txt --ignore-case --count
#    ^^^^^^^ ^^^^^^^^ ^^^^^^^^^^^^^ ^^^^^^^
#    arg 1   arg 2    flag          flag
```

- **Arguments** = the _things_ (what to search, where to search)
- **Flags** = the _tweaks_ (ignore case? just count matches?)

## The Double Dash `--`

This one trips people up. `--` by itself means "everything after this is an argument, even if it
looks like a flag."

Why does this exist? What if you need to delete a file literally named `-f`?

```bash
rm -- -f  # deletes the file named "-f"
rm -f     # would mean "force delete" — not what you want
```

## Help

Good CLIs tell you how to use them. Add `--help` (or `-h`) to basically any command:

```bash
git commit --help
npm --help
docker run --help
```

You get a summary of what the command does, what arguments it takes, and what flags are available.
If you're ever stuck, `--help` is your friend.

## Version

`--version` (sometimes `-V` or `-v`) tells you what version is installed:

```bash
node --version  # v22.0.0
git --version   # git version 2.43.0
```

Useful when something breaks and you need to know if you're on an old version.

## What's Next?

- [Input Sources](/concepts/input) — all the places a CLI gets its data
- [Output and TTY](/concepts/output) — what stdout, stderr, and TTY actually mean

::: tip Ready to build?
Jump to the [Getting Started](/guide/getting-started) guide to build your first command.
:::
