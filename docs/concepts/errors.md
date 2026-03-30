# Errors

Every CLI will eventually fail. The difference between a good CLI and a frustrating one is what
happens when it does.

## What Makes a Good Error?

Compare these:

**Bad:**

```
Error: ENOENT
```

**Better:**

```
Error: File not found: config.json
```

**Best:**

```
Error: Config file not found: ./config.json

  Looked in:
    ./config.json
    ~/.config/mycli/config.json

  Try: mycli init --config to create one
```

A good error tells you:

1. **What** went wrong
2. **Where** it went wrong (which file, which flag, which step)
3. **What to do** about it

That third part — the suggestion — is what separates tools people love from tools people dread.

## Categories of Errors

### User Errors

The user typed something wrong:

```
Error: Unknown flag '--region'. Did you mean '--remote'?
Error: Missing required argument: <filename>
Error: Invalid value for --port: "abc" is not a number
```

These should:

- Reference the exact flag/argument that's wrong
- Suggest corrections ("did you mean?")
- Exit with code **2** (misuse)
- Never print stack traces

### Runtime Errors

Something failed during execution:

```
Error: Connection refused: https://api.example.com
Error: Permission denied: /etc/secrets
```

These should:

- Describe what the program was trying to do
- Include relevant context (URL, file path, etc.)
- Suggest a fix when possible ("check your network", "run with sudo")
- Exit with code **1**

### Internal Errors

Bugs in the program itself:

```
Internal error: unexpected null in parseConfig
Please report this at: https://github.com/...
```

These are rare in production but should:

- Clearly say it's a bug, not the user's fault
- Include enough info to file a bug report
- Not swallow the actual error

## "Did You Mean?"

One of the highest-value features in a CLI: fuzzy matching for typos.

```bash
$ mycli delpoy
Error: Unknown command 'delpoy'. Did you mean 'deploy'?
```

This catches the most common user error — typos — and gives an instant fix. Most users will retype
the command correctly without even reading the rest of the error message.

This works for:

- Command names
- Flag names
- Enum values

## Errors in JSON Mode

When a CLI has `--json` mode, errors should also be structured:

```bash
$ mycli check --json
```

```json
{
  "error": {
    "message": "Config file not found",
    "code": "CONFIG_NOT_FOUND",
    "suggest": "Run `mycli init` to create a config file"
  }
}
```

Scripts parsing JSON output can check for the `error` field instead of parsing human-readable text.

## stderr, Not stdout

::: tip
Errors go to **stderr**, not stdout. This seems minor but matters when piping:
:::

```bash
mycli list | jq '.[]'
```

If the error went to stdout, `jq` would try to parse `Error: something` as JSON and fail with a
confusing error of its own. With errors on stderr, they show up in the terminal while stdout stays
clean.

## Error Codes

A string error code (`CONFIG_NOT_FOUND`, `AUTH_REQUIRED`) is more useful than a number for
programmatic handling:

```ts
// Scripts can match on the code
if (result.error.code === 'AUTH_REQUIRED') {
  // refresh token and retry
}
```

Human messages change between versions. Error codes are stable identifiers that scripts can rely on.

## What's Next?

- [Testing CLIs](/concepts/testing) — how to test all these error paths
- [Error Handling guide](/guide/errors) — implementing error handling in dreamcli
