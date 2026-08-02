# Pattern Cookbook

Copy-ready snippets for DreamCLI 3.x. Every snippet type-checks against the
published types.

## Values

### Flag precedence chain

```ts
flag
	.enum(['us', 'eu', 'ap'])
	.env('DEPLOY_REGION')
	.config('deploy.region')
	.prompt({ kind: 'select', message: 'Which region?' })
	.default('us');
```

Resolution order is fixed: CLI argv, env, config, prompt, default. Declare the
sources a value may come from; never merge them by hand in the action.

### Rich flag types

```ts
flag.url({ protocols: ['https'] }); //  URL
flag.path({ type: 'directory', create: true }); //  string, mkdir -p when missing
flag.date({ min: new Date('2020-01-01') }); //  Date, strict ISO-8601
flag.duration(); //  number (ms) — '30s', '1h30m', '250ms'
flag.bytes(); //  number — '512mb', '1.5gb'
flag.count().alias('v'); //  number — -vvv is 3
flag.keyValue(); //  Record<string, string> — repeated KEY=VALUE
```

Prefer these over `flag.string()` plus hand-rolled parsing: they validate at
every source, feed help placeholders, and land in the exported JSON Schema.

`flag.path()` checks run through the runtime adapter after resolution. In
process-free execution pass `stat` (and `mkdir` for `create`) via run options,
or the checks are skipped.

### Rich arg types

```ts
arg.url({ protocols: ['https'] }); //  URL
arg.path({ mustExist: true }); //  string, checked after resolution
arg.date({ min: new Date('2020-01-01') }); //  Date, strict ISO-8601
arg.duration(); //  number (ms)
arg.bytes(); //  number
arg.url().variadic(); //  URL[], each value validated
```

Same option objects, parsers, and error codes as the flag kinds above. Required
by default; add `.optional()` or `.default()` to change that. `arg.path()` needs
the same `stat`/`mkdir` injection as `flag.path()`, and a variadic path arg
checks every value it collects.

There is no `arg.array()` (use `.variadic()`), no `arg.boolean()`,
`arg.count()`, or `arg.keyValue()`, and no `.prompt()` or `.config()` on an
argument. Parse those with `arg.custom()`, or declare the value as a flag.

### Constraints instead of hand-written validation

```ts
flag.number({ int: true, min: 1, max: 65535 }); // port
flag.string({ nonEmpty: true, pattern: /^[a-z][a-z0-9-]*$/ }); // slug
flag.number().finite(false); // opt back into Infinity
arg.string({ nonEmpty: true, pattern: /^[a-z][a-z0-9-]*$/ }); // same on positionals
arg.number().int().min(1); // chainable, same as flag
```

Constraints are enforced on CLI parse (`INVALID_VALUE`) and on
env/config/prompt/stdin resolution (`CONSTRAINT_VIOLATED`), both exit code 2.
A `.default()` value is trusted as declared and is not re-checked. `finite`
defaults to `true`, so `Infinity` is rejected unless you opt out.

### Standard Schema validation

```ts
import { z } from 'zod';

flag.custom(z.coerce.number().int().positive());
```

Any Standard Schema v1 validator works (Zod, Valibot, ArkType) with the output
type inferred. Validation runs after source resolution, so every source is
checked identically; array flags validate per element.

### Array flags

```ts
flag
	.array(flag.enum(['us', 'eu', 'ap']))
	.separator(',')
	.unique();
```

`--region us,eu --region ap` and repetition both work. Put flag-level modifiers
(`.env()`, `.default()`, …) on the array, never on the element — that is a
compile error.

## Parser behavior

### Negatable booleans

```ts
flag.boolean().default(true).negatable(); // --sandbox / --no-sandbox
```

One logical flag with two spellings; help renders `--[no-]sandbox`. The negated
spelling is presence-only (`--no-sandbox=false` errors).

### Duplicate policy

```ts
flag.enum(['session', 'worktree']).duplicates('error');
```

Config-style flags should reject repeats rather than silently taking the last
value. `'error'` throws `ParseError` code `DUPLICATE_FLAG`; `'first'` keeps the
first. Counted per logical flag, including aliases and negated spellings.

### Cross-flag rules

```ts
command('serve')
	.flag('port', flag.number({ int: true }))
	.flag('socket', flag.string())
	.derive(({ flags }) => {
		if (flags.port !== undefined && flags.socket !== undefined) {
			throw new CLIError('--port and --socket are mutually exclusive', {
				code: 'INVALID_FLAG_COMBINATION',
			});
		}
		return { mode: flags.socket !== undefined ? 'socket' : 'tcp' } as const;
	})
	.action(({ ctx }) => {
		ctx.mode; // typed, available to the action
	});
```

`.derive()` runs after resolution and before the action. It is the home for
rules DreamCLI cannot express declaratively, and its return value widens `ctx`.

## Output

### Channels

```ts
.action(({ out }) => {
	out.log('primary result');       // stdout (stderr in --json)
	out.status('working on it');     // stderr, hidden by --quiet
	out.warn('deprecated flag used');// stderr, always shown
	out.error('could not reach api');// stderr, always shown
});
```

Keep stdout free of progress chatter so pipes stay clean. `--quiet`/`-q` is a
global flag; it silences `status` and `info` but never warnings or errors.

### JSON mode branching

```ts
.action(({ out }) => {
	const data = { service: 'api', healthy: true };

	if (out.jsonMode) {
		out.json(data);
		return;
	}

	out.log('Service api is healthy');
});
```

Never mix human text into stdout in the same branch as `out.json()`.

### Tables

```ts
out.table(rows, [
	{ key: 'name', header: 'Service' },
	{ key: 'status', header: 'Status' },
]);
```

Text table for humans, array for `--json`. Columns are optional
(`out.table(rows)` infers them); pass `{ format: 'text', stream: 'stderr' }` to
force a human table alongside JSON stdout.

### Colors and hyperlinks

```ts
.action(({ out }) => {
	out.log(out.color.green('✔ done'));
	if (out.isHyperlinkSupported) out.log(osc8('https://example.com', 'docs'));
});
```

Every `out.color` formatter is an identity function when color is off (piped,
`NO_COLOR`, `--json`), so no branching is needed. Hyperlinks garble piped
output, so gate them on `out.isHyperlinkSupported`.

### Exit code without an error

```ts
.action(({ out }) => {
	out.log('3 of 5 checks failed');
	out.setExitCode(1);
});
```

For check/status commands: keeps normal output, avoids an error payload in
`--json`, still signals scripts.

### Structured errors

```ts
throw new CLIError('Deployment target not found', {
	code: 'NOT_FOUND',
	exitCode: 1,
	suggest: 'Run: mycli deploy --help',
	details: { requested: name },
});
```

Serializes cleanly in `--json` mode and prints a suggestion line otherwise.

## Surface

### Help configuration

```ts
cli('mycli').help({
	flagOrder: 'declaration', // or a sortFlags comparator
	theme: (c) => ({ sectionTitle: c.magenta }),
	footer: false,
});
```

The theme factory receives the gated palette and never runs when color is off,
so a custom theme cannot leak escapes into piped output.

### Examples that know the program name

```ts
command('deploy').example(({ name }) => `${name} deploy production --force`, 'Force a deploy');
```

The builder form resolves at render time, so examples stay truthful under
symlinks, `inheritName`, and `npx` versus a global install.

### Default command

```ts
cli('mycli').default(serve); // root surface only: `mycli --port 80`
cli('mycli').default(serve, { route: true }); // also `mycli serve`
```

A plain `.default()` is the root surface and is not routable by name; the token
would be read as its first positional.

### Completions

```ts
cli('mycli').completions(); // mycli completions <shell>
cli('mycli').completions({ as: 'flag' }); // mycli --completions (shell auto-detected)
```

### Config discovery

```ts
cli('mycli')
	.config('mycli')
	.configLoader(configFormat(['yaml', 'yml'], parseYaml));
```

Discovery probes project scope (cwd and every ancestor: `.mycli.json`,
`mycli.config.json`, `.config/mycli.json`), then user scope (XDG/AppData, plus
`~/Library/Application Support` on macOS), then `/etc`. First match wins; files
are never merged. `--config <path>` overrides everything.

## Testing

### In-process command test

```ts
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(deploy, ['production', '--force']);
expect(result.exitCode).toBe(0);
expect(result.stdout).toEqual(['Deploying production to us\n']);
```

Prefer `runCommand()` over subprocess tests: faster, deterministic, and it
captures stdout/stderr as arrays of written chunks — assert trailing newlines.

### Injecting the environment

```ts
await runCommand(deploy, ['--json'], {
	env: { DEPLOY_REGION: 'eu' },
	config: { deploy: { region: 'ap' } },
	answers: ['production'], // queued prompt answers
	stat: async (p) => (p === '/data' ? 'directory' : null),
});
```

Prompts are skipped in non-interactive contexts, so queue `answers` when a test
exercises one. Without `stat`, `flag.path()` checks are skipped entirely.

### Asserting JSON output

```ts
const result = await runCommand(status, ['--json']);
expect(JSON.parse(result.stdout.join(''))).toEqual({ healthy: true });
```
