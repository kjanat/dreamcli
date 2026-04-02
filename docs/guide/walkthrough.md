# Walkthrough: Building a GitHub CLI

Let's build something real.
We're going to recreate a miniature version of `gh` — GitHub's official
CLI — using dreamcli.

By the end, you'll have touched every major feature: commands, groups, flags,
arguments, derive, env vars, per-flag prompts, command-level interactive prompts,
tables, JSON mode, spinners, and error handling.

The full source lives in [`examples/gh/src/main.ts`][gh-main] with supporting
modules under [`examples/gh/src/`][gh-src].

Inside this repo, run it with `bun --cwd=examples/gh src/main.ts ...`.
In a standalone project, you'd install `dreamcli` normally — the Bun workspace wiring here is just repo-local convenience.

## What we're building

```bash
$ gh pr list
#    TITLE                     STATE   AUTHOR
142  Add dark mode toggle      open    alice
141  Fix OAuth redirect loop   open    bob
137  Fix date parsing Safari   open    dave

$ gh pr list --state all --json
[{"#":142,"title":"Add dark mode toggle",...},...]

$ gh issue triage 89 --decision backlog
? Which labels still fit? bug, ui
#89 Login fails on Firefox
Status: open (backlog)
Labels: bug, ui

$ gh auth login
? Paste your GitHub token: ghp_abc123...
Logged in with token ghp_abc1...3def
```

Commands, flags, prompts, spinners, tables, JSON mode — all in one tool.
Let's build it piece by piece.

## Step 1: A single command

Start with the simplest useful thing — listing pull requests:

```ts
import { cli, command } from 'dreamcli';

const prList = command('list')
  .description('List pull requests')
  .action(({ out }) => {
    out.log('PR #142: Add dark mode toggle');
    out.log('PR #141: Fix OAuth redirect loop');
  });

cli('gh').command(prList).run();
```

That's a working CLI. But it's hardcoded and flat. Let's fix both.

## Step 2: Data and flags

Real CLIs filter things.
Let's add mock data and flags to filter by state:

```ts
import { cli, command, flag } from 'dreamcli';

type PR = {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly author: string;
};

const pullRequests: readonly PR[] = [
  {
    number: 142,
    title: 'Add dark mode toggle',
    state: 'open',
    author: 'alice',
  },
  {
    number: 141,
    title: 'Fix OAuth redirect loop',
    state: 'open',
    author: 'bob',
  },
  {
    number: 140,
    title: 'Bump dependencies',
    state: 'merged',
    author: 'dependabot',
  },
  { number: 139, title: 'Add rate limiting', state: 'closed', author: 'carol' },
];

const prList = command('list')
  .description('List pull requests')
  .flag(
    'state',
    flag
      .enum(['open', 'closed', 'merged', 'all'])
      .default('open')
      .alias('s')
      .describe('Filter by state'),
  )
  .flag(
    'limit',
    flag.number().default(10).alias('L').describe('Maximum number of results'),
  )
  .action(({ flags, out }) => {
    let results = [...pullRequests];
    if (flags.state !== 'all') {
      results = results.filter((p) => p.state === flags.state);
    }
    results = results.slice(0, flags.limit);

    for (const p of results) {
      out.log(`#${p.number} ${p.title} (${p.state})`);
    }
  });
```

Three things to notice:

1. `flag.enum([...])` constrains the value — `flags.state` is `'open' | 'closed' | 'merged' | 'all'`,
   not `string`.\
   Try passing `--state bogus` and dreamcli rejects it with a "did you mean?" error.
2. `.default('open')` means `flags.state` is always defined — no `undefined` to check.
3. `flag.number()` parses `--limit 5` into the number `5`, not the string `"5"`.

```bash
$ gh pr list
#142 Add dark mode toggle (open)
#141 Fix OAuth redirect loop (open)

$ gh pr list --state all --limit 2
#142 Add dark mode toggle (open)
#141 Fix OAuth redirect loop (open)
```

## Step 3: Tables and JSON mode

Printing lines is fine, but tabular data deserves a table. And scripts need JSON.

Replace the `for` loop with `out.table()`:

```ts
.action(({ flags, out }) => {
  let results = [...pullRequests];
  if (flags.state !== 'all') {
    results = results.filter(p => p.state === flags.state);
  }
  results = results.slice(0, flags.limit);

  // out.table() renders a formatted table in TTY, JSON array in --json mode
  out.table(
    results.map(p => ({ '#': p.number, title: p.title, state: p.state, author: p.author })),
  );
});
```

Now you get both:

```bash
$ gh pr list
#    TITLE                     STATE   AUTHOR
142  Add dark mode toggle      open    alice
141  Fix OAuth redirect loop   open    bob

$ gh pr list --json
[{"#":142,"title":"Add dark mode toggle","state":"open","author":"alice"},...]
```

`--json` is handled automatically by `cli()`. `out.table()` renders a formatted table for humans and emits JSON when `--json` is active.
`out.log()` is suppressed in JSON mode.
For single-object responses (like `pr view`), branch on `out.jsonMode`: emit `out.json(data)` in machine mode, or human text otherwise. Don't mix both surfaces in the same response.

## Step 4: Command groups

A flat list of commands doesn't scale.
`gh` organizes commands into groups — `pr list`, `issue triage`, `auth login`. dreamcli has `group()` for this:

```ts
import { cli, command, group, flag } from 'dreamcli';

// Auth commands
const authLogin = command('login')
  .description('Authenticate with GitHub')
  .action(({ out }) => {
    out.log('Logging in...');
  });

const authStatus = command('status')
  .description('Show authentication status')
  .action(({ out }) => {
    out.log('Logged in');
  });

// PR commands
const prList = command('list').description('List pull requests');
// ...flags and action from above...

// Issue commands
const issueList = command('list').description('List issues');
const issueTriage = command('triage').description('Triage an issue');

// Groups
const auth = group('auth')
  .description('Manage authentication')
  .command(authLogin)
  .command(authStatus);

const pr = group('pr').description('Manage pull requests').command(prList);
const issue = group('issue')
  .description('Manage issues')
  .command(issueList)
  .command(issueTriage);

// Assemble
cli('gh')
  .version('0.1.0')
  .description('A minimal GitHub CLI clone')
  .command(auth)
  .command(pr)
  .command(issue)
  .run();
```

```bash
$ gh --help
A minimal GitHub CLI clone

Commands:
  auth    Manage authentication
  pr      Manage pull requests
  issue   Manage issues

$ gh pr --help
Manage pull requests

Commands:
  list    List pull requests
```

Groups are just commands that contain other commands.
You can nest them as deep as you want.

## Step 5: Arguments

`gh pr view 142` takes a PR number as a positional argument — not a flag, not a named value, just the first thing after `view`:

```ts
import { arg, CLIError } from 'dreamcli';

const prView = command('view')
  .description('View a pull request')
  .arg('number', arg.number().describe('PR number'))
  .action(({ args, out }) => {
    const pr = pullRequests.find((p) => p.number === args.number);

    if (!pr) {
      throw new CLIError(`Pull request #${args.number} not found`, {
        code: 'NOT_FOUND',
        exitCode: 1,
        suggest: 'Try: gh pr list',
      });
    }

    if (out.jsonMode) {
      out.json(pr);
      return;
    }

    out.log(`#${pr.number} ${pr.title}`);
    out.log(`State: ${pr.state}  Author: ${pr.author}`);
  });
```

`arg.number()` coerces the shell string to a `number` automatically — `args.number` is typed and validated as numeric at parse time. If someone passes `abc`, they get a parse error before the action ever runs.
The `CLIError` with `suggest` gives the user a helpful nudge when things
go wrong, and in `--json` mode it serializes as structured JSON on stdout so scripts and pipes receive parseable output.
Single-object commands should pick one surface per run: human text by default, JSON when `--json` is active.

## Step 6: Derive Context

Every `pr` and `issue` command needs authentication.
You *could* check for a token in every single action handler, but that's repetitive and error-prone.

`derive()` solves this cleanly:

```ts
import { CLIError } from 'dreamcli';

function requireAuth(token: string | undefined): { token: string } {
  const normalizedToken = token?.trim();
  if (!normalizedToken) {
    throw new CLIError('Authentication required', {
      code: 'AUTH_REQUIRED',
      suggest: 'Run `gh auth login` or set GH_TOKEN',
      exitCode: 1,
    });
  }
  return { token: normalizedToken };
}
```

This assumes each protected command resolves a `token` value first, typically via `flag.string().env('GH_TOKEN')`, so derive can consume resolved input instead of reaching for `process.env` directly.

`derive()` is command-scoped and gets typed resolved flags and args.
Returning `{ token }` merges that value into `ctx` downstream.
Now wire it up:

::: code-group

```ts [derive()]
const prList = command('list')
  .description('List pull requests')
  .flag('token', flag.string().env('GH_TOKEN').describe('GitHub token'))
  .derive(({ flags }) => requireAuth(flags.token))
  .flag('state', ...)
  .action(({ flags, ctx, out }) => {
    // ctx.token is typed as `string` — guaranteed by derive
    out.info(`Authenticated with ${ctx.token.slice(0, 8)}...`);
    // ...list PRs...
  });
```

```ts [middleware()]
import { CLIError, middleware } from 'dreamcli';

const requireAuth = middleware<{ token: string }>(({ flags, next }) => {
  if (typeof flags.token !== 'string') {
    throw new CLIError('Authentication required', {
      code: 'AUTH_REQUIRED',
      suggest: 'Run `gh auth login` or set GH_TOKEN',
      exitCode: 1,
    });
  }

  return next({ token: flags.token });
});

const prList = command('list')
  .description('List pull requests')
  .flag('token', flag.string().env('GH_TOKEN').describe('GitHub token'))
  .middleware(requireAuth)
  .flag('state', ...)
  .action(({ flags, ctx, out }) => {
    out.info(`Authenticated with ${ctx.token.slice(0, 8)}...`);
    // ...list PRs...
  });
```

:::

If no token resolves, the derive handler throws before the action runs.
No token check needed in the handler.
The auth commands (`login`, `status`) don't use derive, so they work without a token.

Technically you could also do this with middleware, but it has to narrow `flags.token` itself
because middleware is reusable and command-agnostic.
Use `derive()` when you need typed resolved input.
Use `middleware()` when you need to wrap downstream execution for timing, logging, retries, cleanup, or error boundaries.

## Step 7: Env vars and prompts

The real `gh auth login` lets you paste a token interactively or set `GH_TOKEN` in your environment.

dreamcli's resolution chain handles this naturally:

```ts
const authLogin = command('login')
  .description('Authenticate with GitHub')
  .flag(
    'token',
    flag
      .string()
      .env('GH_TOKEN')
      .describe('Authentication token')
      .prompt({ kind: 'input', message: 'Paste your GitHub token:' }),
  )
  .action(({ flags, out }) => {
    const display = `${flags.token.slice(0, 8)}...${flags.token.slice(-4)}`;
    out.log(`Logged in with token ${display}`);
  });
```

The resolution chain tries each source in order:

1. `--token ghp_abc` (explicit flag) — highest priority
2. `GH_TOKEN=ghp_abc` (env var via `.env()`)
3. Interactive prompt (via `.prompt()`) — only in TTY
4. If none: error (no default, no way to resolve)

So all of these work:

```bash
$ gh auth login --token ghp_abc123        # flag
$ GH_TOKEN=ghp_abc123 gh auth login       # env var
$ gh auth login                           # prompts interactively
? Paste your GitHub token: ghp_abc123...
```

One flag definition. Three ways to provide the value. The user picks what's convenient.
That same `tokenFlag()` helper also powers `auth status` and every protected command, so the example sticks to one input story all the way through.

## Step 8: Guided workflows

Per-flag prompts are great when every command always asks the same question.
`issue triage` needs a different follow-up depending on the primary decision:

- `--decision backlog` should ask which labels still fit
- `--decision close` should ask whether to post a follow-up comment

That's what `.interactive()` is for:

```ts
const issueTriage = authedCommand('triage')
  .description('Triage an issue with guided prompts')
  .arg('number', arg.number().describe('Issue number'))
  .flag(
    'decision',
    flag
      .enum(['backlog', 'close'])
      .required()
      .describe('How to handle the issue'),
  )
  .flag(
    'label',
    flag
      .array(flag.string())
      .describe('Labels to keep when leaving the issue open'),
  )
  .flag('comment', flag.boolean().describe('Post a follow-up comment'))
  .interactive(({ flags }) => {
    const labels = flags.label ?? [];

    return {
      label: flags.decision === 'backlog' &&
        labels.length === 0 && {
          kind: 'multiselect',
          message: 'Which labels still fit?',
          choices: issueLabelChoices,
        },
      comment: flags.decision === 'close' &&
        !flags.comment && {
          kind: 'confirm',
          message: 'Post a follow-up comment?',
        },
    };
  });
```

```bash
$ gh issue triage 89 --decision backlog
? Which labels still fit? bug, ui
#89 Login fails on Firefox
Status: open (backlog)
Labels: bug, ui

$ gh issue triage 89 --decision close
? Post a follow-up comment? yes
#89 Login fails on Firefox
Status: closed
```

The key difference from `.prompt()` is timing.
`.interactive()` runs after CLI/env/config resolution and only decides which prompts to show for the still-missing flags.
Use `.prompt()` for unconditional fallback input.
Use `.interactive()` when the set of prompts itself depends on earlier resolved flags.
That's also why `issue` stays smaller than `pr`: `pr` teaches the core API-shaped commands, and `issue triage` teaches the guided-workflow pattern without repeating `view` and `create` all over again.

## Step 9: Spinners

Creating a PR involves an API call. In a real terminal, you'd show a spinner:

```ts
const prCreate = command('create')
  .description('Create a pull request')
  .flag('token', flag.string().env('GH_TOKEN').describe('GitHub token'))
  .derive(({ flags }) => requireAuth(flags.token))
  .flag(
    'title',
    flag
      .string()
      .alias('t')
      .describe('PR title')
      .prompt({ kind: 'input', message: 'Title:' }),
  )
  .flag(
    'body',
    flag
      .string()
      .alias('b')
      .describe('PR body')
      .prompt({ kind: 'input', message: 'Body:' }),
  )
  .flag(
    'draft',
    flag.boolean().alias('d').default(false).describe('Create as draft'),
  )
  .action(async ({ flags, out }) => {
    const spinner = out.spinner('Creating pull request...');

    // Simulate API call
    await new Promise((r) => setTimeout(r, 1500));

    spinner.succeed('Pull request created');

    const createdPr = {
      number: 143,
      title: flags.title,
      url: 'https://github.com/you/repo/pull/143',
    };

    if (out.jsonMode) {
      out.json(createdPr);
      return;
    }

    out.log(`#${createdPr.number} ${createdPr.title}`);
    out.log(createdPr.url);
  });
```

`out.spinner()` returns a handle with `.update()`, `.succeed()`, `.stop()`, and `.wrap()`.
In a TTY, you get an animated spinner.
When piped or in `--json` mode, spinners are suppressed automatically — no garbage escape codes in your logs.

## Step 10: Testing

This is where it gets interesting.
You don't want to spawn subprocesses to test a CLI. dreamcli's testkit lets you run commands in-process with full control:

```ts
import { runCommand } from 'dreamcli/testkit';

// Test that pr list returns open PRs by default
const result = await runCommand(prList, ['--state', 'open']);
expect(result.exitCode).toBe(0);
expect(result.stdout.join('')).toContain('dark mode');
```

You can inject env vars, config, and prompt answers:

```ts
// Test that derive blocks unauthenticated access
const noAuth = await runCommand(prList, []);
expect(noAuth.exitCode).toBe(1);
expect(noAuth.stderr.join('')).toContain('Authentication required');

// Test with a token
const withAuth = await runCommand(prList, [], {
  env: { GH_TOKEN: 'ghp_test_token' },
});
expect(withAuth.exitCode).toBe(0);

// Test guided prompts
const triage = await runCommand(issueTriage, ['89', '--decision', 'backlog'], {
  env: { GH_TOKEN: 'ghp_test_token' },
  answers: [['bug', 'ui']],
});
expect(triage.exitCode).toBe(0);
expect(triage.stdout.join('')).toContain('Labels: bug, ui');
```

No subprocesses. No `process.argv` mutation. No shell scripts.
Each test is isolated — inject what you need, assert what you expect.

## Putting it together

Here's the final assembly — all the commands wired into groups:

```ts
import { cli, command, group, flag, arg, CLIError } from 'dreamcli';

// ...commands defined above...

const auth = group('auth')
  .description('Manage authentication')
  .command(authLogin)
  .command(authStatus);

const pr = group('pr')
  .description('Manage pull requests')
  .command(prList)
  .command(prView)
  .command(prCreate);

const issue = group('issue')
  .description('Manage issues')
  .command(issueList)
  .command(issueTriage);

cli('gh')
  .version('0.1.0')
  .description('A minimal GitHub CLI clone')
  .command(auth)
  .command(pr)
  .command(issue)
  .run();
```

That's a CLI with:

- 7 commands across 3 groups
- Enum, string, number, and boolean flags
- Array flags with multiselect prompts
- Positional arguments
- Auth derive with typed context
- Env var resolution (`GH_TOKEN`)
- Interactive prompts with resolution chain fallback
- Command-level interactive resolver for guided follow-up questions
- Table output with automatic JSON mode
- Spinners with TTY-aware suppression
- Structured errors with suggestions and error codes
- Full testability via in-process test harness

The complete source lives in [`examples/gh/src/main.ts`][gh-main] with the rest
of the example package under [`examples/gh/src/`][gh-src].

## What's next?

- [Commands](/guide/commands) — everything about command builders, nesting, and groups
- [Flags](/guide/flags) — all flag types, modifiers, and the resolution chain in detail
- [Middleware](/guide/middleware) — context accumulation, short-circuit, onion model
- [Testing](/guide/testing) — the full testkit API

[gh-main]: https://github.com/kjanat/dreamcli/blob/master/examples/gh/src/main.ts
[gh-src]: https://github.com/kjanat/dreamcli/tree/master/examples/gh/src
