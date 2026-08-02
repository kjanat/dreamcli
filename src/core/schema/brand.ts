/**
 * Type-only seal for framework-normalized schema values.
 *
 * The symbol has no runtime value: schema objects never carry the key, so
 * spreads, `structuredClone`, and JSON round-trips are unaffected. The brand
 * exists purely in the type system — consumers cannot spell the key, so a
 * structural literal is never assignable to a sealed schema type, and the
 * normalization factories are the only construction path.
 *
 * @module dreamcli/core/schema/brand
 * @internal
 */

declare const schemaBrand: unique symbol;

/** Discriminator literals carried by the sealed schema types. */
type SchemaBrandKind = 'flag' | 'arg' | 'command' | 'cli' | 'config';

export type { SchemaBrandKind, schemaBrand };
