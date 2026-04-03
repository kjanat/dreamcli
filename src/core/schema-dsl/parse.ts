/**
 * Compile-time schema string parser.
 *
 * Parses a string literal like `"{ name: string; age: number }"` into its
 * corresponding TypeScript type at compile time using template literal types
 * and recursive conditional inference.
 *
 * The compile-time parser and the runtime parser in `runtime.ts` implement
 * the same grammar — the type-level version produces TypeScript types while
 * the runtime version produces an AST.
 *
 * @module dreamcli/core/schema-dsl/parse
 */

// === Whitespace handling ===

/** Whitespace characters recognized by the parser. */
type WS = ' ' | '\n' | '\t' | '\r';

/** Strip leading whitespace. */
type TrimLeft<T extends string> = T extends `${WS}${infer R}` ? TrimLeft<R> : T;

/** Strip trailing whitespace. */
type TrimRight<T extends string> = T extends `${infer R}${WS}` ? TrimRight<R> : T;

/** Strip leading and trailing whitespace. */
type Trim<T extends string> = TrimLeft<TrimRight<T>>;

// === Character counting for bracket balancing ===

/**
 * Single-pass brace depth tracker.
 *
 * Walks the string character by character, pushing to the depth tuple
 * on `{` and popping on `}`. Returns the final depth tuple — an empty
 * tuple means balanced. Returns `false` on underflow (more `}` than `{`).
 *
 * This replaces the Chars + Keep + length approach, which materialized
 * the entire string as a character tuple. Single-pass is O(n) recursion
 * depth instead of O(3n).
 */
type TrackDepth<T extends string, D extends unknown[] = []> = T extends `${infer C}${infer R}`
	? C extends '{'
		? TrackDepth<R, [0, ...D]>
		: C extends '}'
			? D extends [unknown, ...infer Rest]
				? TrackDepth<R, Rest>
				: false
			: TrackDepth<R, D>
	: D;

/** True when braces are balanced (depth returns to zero without underflow). */
type Balanced<T extends string> = TrackDepth<T> extends [] ? true : false;

// === Balanced splitting ===

/**
 * Naively split string T at every occurrence of delimiter D.
 * Does not respect brace nesting — use {@link Rejoin} to rebalance.
 */
type RawSplit<T extends string, D extends string> = T extends `${infer A}${D}${infer B}`
	? [A, ...RawSplit<B, D>]
	: [T];

/**
 * Walk a tuple of fragments, merging adjacent entries whose cumulative
 * brace count is unbalanced. Delimiter D is reinserted when merging.
 *
 * This is the bracket-balancing trick that makes nested-object parsing
 * practical: split greedily, then glue back together where braces don't
 * match.
 */
type Rejoin<T extends string[], D extends string> = T extends [
	infer A extends string,
	infer B extends string,
	...infer R extends string[],
]
	? Balanced<A> extends true
		? [A, ...Rejoin<[B, ...R], D>]
		: Rejoin<[`${A}${D}${B}`, ...R], D>
	: T;

// === Filtering ===

/** Remove entries that are empty or whitespace-only after trimming. */
type NonEmpty<T extends string[]> = T extends [infer H extends string, ...infer R extends string[]]
	? Trim<H> extends ''
		? NonEmpty<R>
		: [H, ...NonEmpty<R>]
	: [];

// === Top-level pipe detection ===

/**
 * True when the string contains `|` outside of `{}` nesting.
 *
 * Splits at `|`, rebalances with {@link Rejoin}, and checks whether
 * two or more fragments remain. If `|` was only inside braces,
 * rebalancing collapses them back to one fragment.
 */
type HasTopLevelPipe<T extends string> =
	Rejoin<RawSplit<T, '|'>, '|'> extends [string, string, ...string[]] ? true : false;

// === Flatten intersection into readable object type ===

/** Collapse an intersection of object types into a single flat object. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

// === Primitive mapping ===

/** Map a primitive type name to its TypeScript type. */
type ParsePrimitive<T extends string> = T extends 'string'
	? string
	: T extends 'number'
		? number
		: T extends 'integer'
			? number
			: T extends 'boolean'
				? boolean
				: T extends 'true'
					? true
					: T extends 'false'
						? false
						: T extends 'null'
							? null
							: T extends 'undefined'
								? undefined
								: T extends 'unknown'
									? unknown
									: T extends 'never'
										? never
										: never;

// === Union parsing ===

/** Parse each tuple entry as a value, producing a tuple of types. */
type ParseEach<T extends string[]> = T extends [infer H extends string, ...infer R extends string[]]
	? [ParseValue<H>, ...ParseEach<R>]
	: [];

/** Collapse a tuple of types into a TypeScript union. */
type TupleToUnion<T extends unknown[]> = T extends [infer H, ...infer R]
	? H | TupleToUnion<R>
	: never;

/** Split at top-level `|`, parse each branch, collapse to union. */
type ParseUnion<T extends string> = TupleToUnion<
	ParseEach<NonEmpty<Rejoin<RawSplit<T, '|'>, '|'>>>
>;

// === Value parsing ===

/**
 * Parse a value type: object, union, array, literal, ref, Record, or primitive.
 *
 * Precedence (highest to lowest):
 * 1. Object — `{...}` wrapping
 * 2. Union — top-level `|` (outside braces)
 * 3. Array — trailing `[]` suffix
 * 4. String literal — `'...'` (maps to literal string type)
 * 5. Reference — `@name` (maps to `unknown` at type level; resolved at runtime)
 * 6. Record — `Record<K, V>` (maps to `Record<string, V>`)
 * 7. Primitive — identifier lookup
 *
 * Union is checked before array so `string | number[]` parses as
 * `string | number[]`, not `(string | number)[]`.
 */
type ParseValue<T extends string, V extends string = Trim<T>> = V extends `{${infer Content}}`
	? Prettify<ParseObject<Content>>
	: HasTopLevelPipe<V> extends true
		? ParseUnion<V>
		: V extends `${infer Inner}[]`
			? ParseValue<Inner>[]
			: V extends `'${infer Literal}'`
				? Literal
				: V extends `@${string}`
					? unknown
					: V extends `Record<${string},${infer Val}>`
						? Record<string, ParseValue<Trim<Val>>>
						: ParsePrimitive<V>;

// === Property parsing ===

/**
 * Parse a single property string like `"name: string"` or `"age?: number"`.
 *
 * Matches the first `:` (leftmost), then checks whether the key ends
 * with `?` to determine optionality. This avoids the trap of matching
 * `?:` inside nested values.
 */
type ParseProperty<T extends string> =
	Trim<T> extends `${infer K}:${infer V}`
		? Trim<K> extends `${infer Key}?`
			? { [P in Trim<Key>]?: ParseValue<V> }
			: { [P in Trim<K>]: ParseValue<V> }
		: {};

/** Recursively parse a tuple of property strings and intersect results. */
type ParseProperties<T extends string[]> = T extends [
	infer H extends string,
	...infer R extends string[],
]
	? ParseProperty<H> & ParseProperties<R>
	: {};

// === Object parsing ===

/**
 * Split content by `;` with bracket balancing, filter empties,
 * parse each property, and intersect into a single object type.
 */
type ParseObject<T extends string> = Prettify<
	ParseProperties<NonEmpty<Rejoin<RawSplit<T, ';'>, ';'>>>
>;

// === Entry point ===

/**
 * Parse a schema string literal into its TypeScript type.
 *
 * Supports primitives (`string`, `number`, `boolean`, `true`, `false`,
 * `null`, `undefined`, `unknown`, `never`), arrays (`T[]`), objects
 * (`{ key: T; ... }`), optional properties (`key?: T`), unions
 * (`T | U`), and arbitrary nesting.
 *
 * @example
 * ```ts
 * type User = Parse<'{ name: string; age: number; tags?: string[] }'>;
 * //   ^? { name: string; age: number; tags?: string[] | undefined }
 *
 * type Status = Parse<'string | true'>;
 * //   ^? string | true
 * ```
 */
type Parse<T extends string, V extends string = Trim<T>> = V extends `{${infer Content}}`
	? Prettify<ParseObject<Content>>
	: ParseValue<V>;

export type { Parse, ParseObject, ParsePrimitive, ParseProperty, ParseValue, Prettify, Trim };
