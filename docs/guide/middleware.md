# Middleware

Middleware wraps downstream execution and can add typed context to the command handler chain.
Use `derive()` when you need typed resolved flags or args before the action. Use middleware when
you need `next()` around the rest of the pipeline.

## Defining Middleware

```ts
import { middleware } from 'dreamcli';

const timing = middleware<{ startTime: number }>(async ({ next }) => {
  const startTime = Date.now();
  await next({ startTime });
});

const trace = middleware<{ traceId: string }>(async ({ next }) =>
  next({ traceId: crypto.randomUUID() }),
);
```

The generic parameter declares the context shape this middleware provides.
The `next()` call passes context downstream and continues the chain.

## Stacking Middleware

```ts
command('deploy')
  .middleware(timing)
  .middleware(trace)
  .action(({ ctx }) => {
    ctx.startTime; // number — typed
    ctx.traceId; // string — typed
  });
```

Context types intersect: `{ user: ... } & { traceId: string }`.
Each middleware only needs to know about its own context shape.

## Middleware Parameters

The middleware handler receives:

```ts
middleware(async ({ flags, args, out, meta, next }) => {
  // flags — resolved flag values (type-erased)
  // args  — resolved argument values (type-erased)
  // out   — output channel
  // meta  — CLI metadata { name, bin, version, command }
  // next  — continue chain, passing context
  return next({});
});
```

If you need typed command-scoped access to resolved inputs, prefer `command(...).derive(...)`.

## Error Handling

Middleware can catch and transform errors:

```ts
const errorBoundary = middleware(async ({ next, out }) => {
  try {
    return await next({});
  } catch (err) {
    if (err instanceof CLIError) {
      out.error(err.message);
    }
    throw err;
  }
});
```

## What's Next?

- [Config Files](/guide/config) — configuration file discovery
- [Testing](/guide/testing) — testing middleware behavior
