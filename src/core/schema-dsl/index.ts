/**
 * Schema DSL — single-source schema definitions with compile-time types
 * and runtime AST.
 *
 * Define a schema once as a string literal. At compile time, the string is
 * parsed into a TypeScript type via {@link Parse}. At runtime, the same
 * string is parsed into an AST ({@link SchemaNode}) for validation,
 * JSON Schema generation, and introspection.
 *
 * ```ts
 * const user = schema('{ name: string; age: number; tags?: string[] }');
 *
 * // Compile-time: inferred as { name: string; age: number; tags?: string[] }
 * const data = user.parse(jsonInput);
 * data.name; // string
 * data.age;  // number
 * ```
 *
 * @module dreamcli/core/schema-dsl
 */

import type { Parse } from './parse.ts';
import type { SchemaNode } from './runtime.ts';
import { parseSchema, validateNode } from './runtime.ts';

// === Schema definition ===

/** The result of calling {@link schema}. Bundles source, AST, guard, and parse. */
interface SchemaDefinition<T extends string> {
	/** The original source string. */
	readonly source: T;
	/** Runtime AST parsed from the source. */
	readonly ast: SchemaNode;
	/**
	 * Type guard — returns `true` if `input` matches the schema.
	 * Narrows the type to `Parse<T>` in the true branch.
	 */
	guard(input: unknown): input is Parse<T>;
	/**
	 * Parse and validate — returns the narrowed value or throws.
	 * @throws {TypeError} if the input does not match the schema.
	 */
	parse(input: unknown): Parse<T>;
}

/**
 * Define a schema from a string literal.
 *
 * @param source - Schema string (e.g. `"{ name: string; age: number }"`).
 * @returns A {@link SchemaDefinition} with compile-time types and runtime validation.
 *
 * @example
 * ```ts
 * const user = schema('{ name: string; age: number; admin?: boolean }');
 *
 * // Type guard
 * if (user.guard(input)) {
 *   input.name; // string
 * }
 *
 * // Parse or throw
 * const data = user.parse(input);
 * data.age; // number
 * ```
 */
function schema<T extends string>(source: T): SchemaDefinition<T> {
	const ast = parseSchema(source);

	function guard(input: unknown): input is Parse<T> {
		return validateNode(ast, input);
	}

	function parse(input: unknown): Parse<T> {
		if (!guard(input)) {
			throw new TypeError(`Value does not match schema: ${source}`);
		}
		return input;
	}

	return { source, ast, guard, parse };
}

// === Re-exports ===

export type { Parse } from './parse.ts';
export type {
	ArrayNode,
	BooleanNode,
	IntegerNode,
	LiteralFalseNode,
	LiteralNullNode,
	LiteralStringNode,
	LiteralTrueNode,
	LiteralUndefinedNode,
	NeverNode,
	NumberNode,
	ObjectNode,
	PropertyNode,
	RecordNode,
	RefNode,
	SchemaNode,
	StringNode,
	UnionNode,
	UnknownNode,
} from './runtime.ts';
export { parseSchema, validateNode } from './runtime.ts';
export { nodeToJsonSchema } from './to-json-schema.ts';
export type { SchemaDefinition };
export { schema };
