/**
 * Middleware type definitions and factory function.
 *
 * Middleware runs before the action handler and can:
 * - Add typed context via `next({ key: value })`
 * - Short-circuit by throwing `CLIError` (or not calling `next`)
 * - Wrap downstream execution (timing, logging) by awaiting `next()`
 *
 * The `Middleware<Output>` type uses a phantom generic to track what
 * context properties this middleware adds. At runtime, middleware is
 * type-erased — the phantom type is only used for compile-time inference
 * when `.middleware()` is chained on `CommandBuilder`.
 *
 * @module dreamcli/core/schema/middleware
 */

import type { Out } from './command.ts';

// ---------------------------------------------------------------------------
// Middleware parameter types
// ---------------------------------------------------------------------------

/**
 * Parameters received by a middleware function at runtime.
 *
 * Middleware receives erased args/flags (since it's defined independently
 * of commands) plus the accumulated context from prior middleware and a
 * `next` function to continue the chain.
 */
interface MiddlewareParams {
	/** Fully resolved positional arguments (type-erased). */
	readonly args: Readonly<Record<string, unknown>>;
	/** Fully resolved flags (type-erased). */
	readonly flags: Readonly<Record<string, unknown>>;
	/** Context accumulated from previous middleware in the chain. */
	readonly ctx: Readonly<Record<string, unknown>>;
	/** Output channel. */
	readonly out: Out;
	/**
	 * Continue to the next middleware or action handler.
	 *
	 * Call with context additions that merge into `ctx` for downstream.
	 * Returns when the entire downstream chain completes — enabling
	 * wrap-around patterns (timing, try/catch, cleanup).
	 */
	readonly next: (additions: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/**
 * Type-erased middleware handler stored on `CommandSchema`.
 *
 * At runtime, all middleware handlers have this signature. The phantom
 * `Output` type on `Middleware<O>` is erased.
 *
 * @internal
 */
type ErasedMiddlewareHandler = (params: MiddlewareParams) => void | Promise<void>;

/**
 * Middleware handler function with typed `next()` parameter.
 *
 * The `Output` generic constrains what properties must be passed to
 * `next()`, ensuring type-safe context additions at the call site.
 */
type MiddlewareHandler<Output extends Record<string, unknown>> = (params: {
	readonly args: Readonly<Record<string, unknown>>;
	readonly flags: Readonly<Record<string, unknown>>;
	readonly ctx: Readonly<Record<string, unknown>>;
	readonly out: Out;
	/** Pass context additions downstream. Must include all `Output` properties. */
	readonly next: (additions: Output) => Promise<void>;
}) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Middleware type — phantom-branded
// ---------------------------------------------------------------------------

/**
 * Internal runtime representation of middleware.
 * @internal
 */
interface MiddlewareImpl {
	readonly _handler: ErasedMiddlewareHandler;
}

/**
 * Middleware with phantom output type.
 *
 * The `Output` parameter tracks what this middleware adds to context at
 * compile time. The `_output` brand is phantom — it exists only in the
 * type system for inference, not at runtime.
 *
 * Created via the `middleware()` factory. Attached to commands via
 * `CommandBuilder.middleware()`.
 *
 * @example
 * ```ts
 * interface User { id: string; name: string }
 *
 * const auth = middleware<{ user: User }>(async ({ next }) => {
 *   const user = await getUser();
 *   if (!user) throw new CLIError('Not authenticated', { code: 'AUTH_REQUIRED' });
 *   return next({ user });
 * });
 * ```
 */
type Middleware<Output extends Record<string, unknown>> = MiddlewareImpl & {
	/** @internal Phantom type brand — compile-time only. */
	readonly _output: Output;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a middleware definition.
 *
 * Middleware runs before the action handler and can add typed context,
 * short-circuit execution, or wrap downstream processing.
 *
 * @param handler - Function receiving `{ args, flags, ctx, out, next }`.
 *   Call `next(additions)` to continue the chain with added context.
 *   Omitting the `next()` call short-circuits (e.g., for auth guards).
 * @returns Middleware to attach via `CommandBuilder.middleware()`.
 *
 * @example
 * ```ts
 * // Auth guard — adds user to context or throws
 * const auth = middleware(async ({ next }) => {
 *   const user = await getUser();
 *   if (!user) throw new CLIError('Not authenticated', { code: 'AUTH_REQUIRED' });
 *   return next({ user });
 * });
 *
 * // Timing wrapper — measures downstream execution
 * const timing = middleware(async ({ out, next }) => {
 *   const start = Date.now();
 *   await next({});
 *   out.info(`Done in ${Date.now() - start}ms`);
 * });
 *
 * command('deploy')
 *   .middleware(timing)
 *   .middleware(auth)
 *   .action(({ ctx }) => {
 *     console.log(ctx.user.name); // typed!
 *   });
 * ```
 */
function middleware<Output extends Record<string, unknown>>(
	handler: MiddlewareHandler<Output>,
): Middleware<Output> {
	// Runtime representation is just { _handler }.
	// The type assertion establishes the phantom _output brand —
	// no runtime property is created. handler's Output-constrained
	// next() is compatible with the erased (Record<string, unknown>)
	// signature at runtime.
	const impl: MiddlewareImpl = { _handler: handler as ErasedMiddlewareHandler };
	return impl as Middleware<Output>;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { middleware };
export type {
	ErasedMiddlewareHandler,
	Middleware,
	MiddlewareHandler,
	MiddlewareImpl,
	MiddlewareParams,
};
