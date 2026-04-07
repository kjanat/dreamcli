/**
 * Convert schema DSL AST nodes to JSON Schema (draft 2020-12) fragments.
 *
 * This bridges the schema DSL and JSON Schema generation: define a shape
 * once as a DSL string, parse it to an AST, then convert to JSON Schema
 * properties — no manual override maps or probe fixtures needed.
 *
 * @module dreamcli/core/schema-dsl/to-json-schema
 */

import type { SchemaNode } from './runtime.ts';

/**
 * Convert a {@link SchemaNode} AST node to a JSON Schema fragment.
 *
 * Mapping:
 * - `string`    → `{ type: 'string' }`
 * - `number`    → `{ type: 'number' }`
 * - `integer`   → `{ type: 'integer' }`
 * - `boolean`   → `{ type: 'boolean' }`
 * - `true`      → `{ const: true }`
 * - `false`     → `{ const: false }`
 * - `null`      → `{ type: 'null' }`
 * - `undefined` → throws (JSON Schema has no `undefined` type)
 * - `unknown`   → `{}` (accepts any value)
 * - `never`     → `{ not: {} }` (rejects all values)
 * - `'literal'` → `{ const: 'literal' }`
 * - `@ref`      → `{ $ref: '#/$defs/ref' }`
 * - `T[]`       → `{ type: 'array', items: convert(T) }`
 * - `Record<K,V>` → `{ type: 'object', additionalProperties: convert(V) }`
 * - `{...}`     → `{ type: 'object', properties: ..., required: [...] }`
 * - `A | B`     → `{ enum: [...] }` if all literals, else `{ oneOf: [...] }`
 *
 * @param node - The AST node to convert.
 * @returns A plain JSON Schema fragment.
 */
function nodeToJsonSchema(node: SchemaNode): Record<string, unknown> {
	switch (node.kind) {
		case 'string':
			return { type: 'string' };
		case 'number':
			return { type: 'number' };
		case 'integer':
			return { type: 'integer' };
		case 'boolean':
			return { type: 'boolean' };
		case 'true':
			return { const: true };
		case 'false':
			return { const: false };
		case 'null':
			return { type: 'null' };
		case 'literal':
			return { const: node.value };
		case 'undefined':
			throw new Error(
				"Cannot convert 'undefined' type to JSON Schema; model optionality at the parent level",
			);
		case 'unknown':
			return {};
		case 'never':
			return { not: {} };
		case 'ref':
			return { $ref: `#/$defs/${node.target}` };
		case 'array':
			return { type: 'array', items: nodeToJsonSchema(node.element) };
		case 'record':
			return { type: 'object', additionalProperties: nodeToJsonSchema(node.value) };
		case 'object': {
			const properties: Record<string, Record<string, unknown>> = {};
			const required: string[] = [];
			for (const [key, prop] of Object.entries(node.properties)) {
				properties[key] = nodeToJsonSchema(prop.schema);
				if (!prop.optional) required.push(key);
			}
			const result: Record<string, unknown> = {
				type: 'object',
				additionalProperties: false,
				properties,
			};
			if (required.length > 0) result.required = required;
			return result;
		}
		case 'union': {
			// Union of all string literals → { enum: [...] }
			const literalValues: string[] = [];
			let allLiteral = true;
			for (const member of node.members) {
				if (member.kind === 'literal') {
					literalValues.push(member.value);
				} else {
					allLiteral = false;
				}
			}
			if (allLiteral) return { enum: literalValues };
			// Mixed union → oneOf
			return { oneOf: node.members.map(nodeToJsonSchema) };
		}
	}
}

export { nodeToJsonSchema };
