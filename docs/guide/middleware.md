# Middleware

Middleware adds typed context to the command handler chain. Context accumulates via type
intersection — no manual interface merging.

## Defining Middleware

```ts
import { middleware, CLIError } from 'dreamcli';

const auth = middleware<{ user: { id: string; role: 'admin' | 'user' } }>(async ({ next }) => {
	const user = await getUser();
	if (!user) {
		throw new CLIError('Not authenticated', {
			code: 'AUTH_REQUIRED',
			suggest: 'Run `mycli login`',
		});
	}
	return next({ user });
});
```

The generic parameter declares the context shape this middleware provides. The `next()` call passes
context downstream.

## Stacking Middleware

```ts
const trace = middleware<{ traceId: string }>(async ({ next }) =>
	next({ traceId: crypto.randomUUID() }),
);

command('deploy')
	.middleware(auth)
	.middleware(trace)
	.action(({ ctx }) => {
		ctx.user.role; // "admin" | "user" — typed
		ctx.traceId; // string — typed
	});
```

Context types intersect: `{ user: ... } & { traceId: string }`. Each middleware only needs to know
about its own context shape.

## Middleware Parameters

The middleware handler receives:

```ts
middleware<Output>(async ({ flags, args, out, next }) => {
	// flags — resolved flag values
	// args  — resolved argument values
	// out   — output channel
	// next  — continue chain, passing context
	return next({ ...context });
});
```

## Error Handling

Middleware can catch and transform errors:

```ts
const errorBoundary = middleware(async ({ next, out }) => {
	try {
		return await next({});
	} catch (err) {
		if (isCLIError(err)) {
			out.error(err.message);
		}
		throw err;
	}
});
```

## What's Next?

- [Config Files](/guide/config) — configuration file discovery
- [Testing](/guide/testing) — testing middleware behavior
