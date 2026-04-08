# Pattern Cookbook

## 1) Flag precedence chain

```ts
flag
	.enum(['us', 'eu', 'ap'])
	.env('DEPLOY_REGION')
	.config('deploy.region')
	.prompt({ kind: 'select', message: 'Which region?' })
	.default('us');
```

Use this when a value can come from CLI args, environment, config, or prompts.

## 2) JSON mode branching

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

Avoid mixing `out.log(...)` with JSON output in the same branch.

## 3) Tabular list output

```ts
.action(({ out }) => {
	out.table([
		{ id: 1, name: 'alice', role: 'admin' },
		{ id: 2, name: 'bob', role: 'viewer' },
	]);
});
```

`out.table()` renders pretty tables for humans and arrays in `--json` mode.

## 4) Structured CLIError for guidance

```ts
import { CLIError } from '@kjanat/dreamcli';

throw new CLIError('Deployment target not found', {
	code: 'NOT_FOUND',
	exitCode: 1,
	suggest: 'Try: mycli deploy --help',
});
```

Use this for actionable failures instead of generic thrown errors.

## 5) In-process command test

```ts
import { runCommand } from '@kjanat/dreamcli/testkit';

const result = await runCommand(deploy, ['production', '--force']);
expect(result.exitCode).toBe(0);
expect(result.stdout).toEqual(['Deploying production to us\n']);
```

Prefer `runCommand()` over subprocess tests for speed and deterministic assertions.
