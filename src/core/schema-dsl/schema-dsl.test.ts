import { describe, expect, expectTypeOf, it } from 'vitest';
import { nodeToJsonSchema, schema } from './index.ts';
import type { Parse } from './parse.ts';
import type { SchemaNode } from './runtime.ts';
import { parseSchema, validateNode } from './runtime.ts';

// ── Compile-time type parser ────────────────────────────────────────

describe('Parse<T> — compile-time type parser', () => {
	// --- Primitives ---

	it('parses string', () => {
		expectTypeOf<Parse<'string'>>().toEqualTypeOf<string>();
	});

	it('parses number', () => {
		expectTypeOf<Parse<'number'>>().toEqualTypeOf<number>();
	});

	it('parses boolean', () => {
		expectTypeOf<Parse<'boolean'>>().toEqualTypeOf<boolean>();
	});

	it('parses literal true', () => {
		expectTypeOf<Parse<'true'>>().toEqualTypeOf<true>();
	});

	it('parses literal false', () => {
		expectTypeOf<Parse<'false'>>().toEqualTypeOf<false>();
	});

	it('parses null', () => {
		expectTypeOf<Parse<'null'>>().toEqualTypeOf<null>();
	});

	it('parses unknown', () => {
		expectTypeOf<Parse<'unknown'>>().toEqualTypeOf<unknown>();
	});

	// --- Arrays ---

	it('parses string[]', () => {
		expectTypeOf<Parse<'string[]'>>().toEqualTypeOf<string[]>();
	});

	it('parses number[][]', () => {
		expectTypeOf<Parse<'number[][]'>>().toEqualTypeOf<number[][]>();
	});

	// --- Objects ---

	it('parses flat object', () => {
		expectTypeOf<Parse<'{ name: string; age: number }'>>().toEqualTypeOf<{
			name: string;
			age: number;
		}>();
	});

	it('parses object with optional property', () => {
		type Result = Parse<'{ name: string; bio?: string }'>;
		expectTypeOf<Result>().toEqualTypeOf<{ name: string; bio?: string }>();
	});

	it('parses nested object', () => {
		type Result = Parse<'{ user: { name: string; age: number } }'>;
		expectTypeOf<Result>().toEqualTypeOf<{ user: { name: string; age: number } }>();
	});

	it('parses object with array property', () => {
		type Result = Parse<'{ tags: string[]; scores: number[] }'>;
		expectTypeOf<Result>().toEqualTypeOf<{ tags: string[]; scores: number[] }>();
	});

	it('handles trailing semicolon', () => {
		type Result = Parse<'{ name: string; }'>;
		expectTypeOf<Result>().toEqualTypeOf<{ name: string }>();
	});

	// --- Unions ---

	it('parses two-member union', () => {
		type Result = Parse<'string | number'>;
		expectTypeOf<Result>().toEqualTypeOf<string | number>();
	});

	it('parses union with literal true', () => {
		type Result = Parse<'string | true'>;
		expectTypeOf<Result>().toEqualTypeOf<string | true>();
	});

	it('parses union with array (array binds tighter)', () => {
		type Result = Parse<'string | number[]'>;
		expectTypeOf<Result>().toEqualTypeOf<string | number[]>();
	});

	// --- Whitespace tolerance ---

	it('handles extra whitespace', () => {
		type Result = Parse<'  {  name : string ;  age : number  }  '>;
		expectTypeOf<Result>().toEqualTypeOf<{ name: string; age: number }>();
	});

	// --- Complex combinations ---

	it('parses deeply nested structure', () => {
		type Result = Parse<'{ user: { profile: { email: string; age: number }; tags?: string[] } }'>;
		expectTypeOf<Result>().toEqualTypeOf<{
			user: { profile: { email: string; age: number }; tags?: string[] };
		}>();
	});

	it('parses object array', () => {
		type Result = Parse<'{ name: string }[]'>;
		expectTypeOf<Result>().toEqualTypeOf<{ name: string }[]>();
	});

	it('parses union inside object property', () => {
		type Result = Parse<'{ deprecated?: string | true }'>;
		expectTypeOf<Result>().toEqualTypeOf<{ deprecated?: string | true }>();
	});
});

// ── Runtime parser ──────────────────────────────────────────────────

describe('parseSchema — runtime parser', () => {
	// --- Primitives ---

	it('parses string', () => {
		expect(parseSchema('string')).toEqual({ kind: 'string' });
	});

	it('parses number', () => {
		expect(parseSchema('number')).toEqual({ kind: 'number' });
	});

	it('parses boolean', () => {
		expect(parseSchema('boolean')).toEqual({ kind: 'boolean' });
	});

	it('parses literal true', () => {
		expect(parseSchema('true')).toEqual({ kind: 'true' });
	});

	it('parses literal false', () => {
		expect(parseSchema('false')).toEqual({ kind: 'false' });
	});

	it('parses null', () => {
		expect(parseSchema('null')).toEqual({ kind: 'null' });
	});

	it('parses unknown', () => {
		expect(parseSchema('unknown')).toEqual({ kind: 'unknown' });
	});

	// --- Arrays ---

	it('parses string[]', () => {
		expect(parseSchema('string[]')).toEqual({
			kind: 'array',
			element: { kind: 'string' },
		});
	});

	it('parses number[][]', () => {
		expect(parseSchema('number[][]')).toEqual({
			kind: 'array',
			element: { kind: 'array', element: { kind: 'number' } },
		});
	});

	// --- Objects ---

	it('parses flat object', () => {
		const ast = parseSchema('{ name: string; age: number }');
		expect(ast).toEqual({
			kind: 'object',
			properties: {
				name: { optional: false, schema: { kind: 'string' } },
				age: { optional: false, schema: { kind: 'number' } },
			},
		});
	});

	it('parses optional property', () => {
		const ast = parseSchema('{ bio?: string }');
		expect(ast).toEqual({
			kind: 'object',
			properties: {
				bio: { optional: true, schema: { kind: 'string' } },
			},
		});
	});

	it('parses nested object', () => {
		const ast = parseSchema('{ user: { name: string } }');
		expect(ast).toEqual({
			kind: 'object',
			properties: {
				user: {
					optional: false,
					schema: {
						kind: 'object',
						properties: {
							name: { optional: false, schema: { kind: 'string' } },
						},
					},
				},
			},
		});
	});

	// --- Unions ---

	it('parses union', () => {
		expect(parseSchema('string | number')).toEqual({
			kind: 'union',
			members: [{ kind: 'string' }, { kind: 'number' }],
		});
	});

	it('parses union with literal true', () => {
		expect(parseSchema('string | true')).toEqual({
			kind: 'union',
			members: [{ kind: 'string' }, { kind: 'true' }],
		});
	});

	it('parses union where array binds tighter than pipe', () => {
		expect(parseSchema('string | number[]')).toEqual({
			kind: 'union',
			members: [{ kind: 'string' }, { kind: 'array', element: { kind: 'number' } }],
		});
	});

	// --- Complex ---

	it('parses object array', () => {
		expect(parseSchema('{ name: string }[]')).toEqual({
			kind: 'array',
			element: {
				kind: 'object',
				properties: {
					name: { optional: false, schema: { kind: 'string' } },
				},
			},
		});
	});

	it('parses union inside object property', () => {
		const ast = parseSchema('{ deprecated?: string | true }');
		expect(ast).toEqual({
			kind: 'object',
			properties: {
				deprecated: {
					optional: true,
					schema: {
						kind: 'union',
						members: [{ kind: 'string' }, { kind: 'true' }],
					},
				},
			},
		});
	});

	// --- Errors ---

	it('throws on unknown type', () => {
		expect(() => parseSchema('Widget')).toThrow(SyntaxError);
	});

	it('throws on unexpected character', () => {
		expect(() => parseSchema('string!')).toThrow(SyntaxError);
	});

	it('throws on duplicate object property names', () => {
		expect(() => parseSchema('{ name: string; name: number }')).toThrow(SyntaxError);
	});
});

// ── Validation ──────────────────────────────────────────────────────

describe('validateNode — runtime validation', () => {
	it('validates string', () => {
		const node: SchemaNode = { kind: 'string' };
		expect(validateNode(node, 'hello')).toBe(true);
		expect(validateNode(node, 42)).toBe(false);
	});

	it('validates number', () => {
		const node: SchemaNode = { kind: 'number' };
		expect(validateNode(node, 42)).toBe(true);
		expect(validateNode(node, 'hello')).toBe(false);
	});

	it('validates literal true', () => {
		const node: SchemaNode = { kind: 'true' };
		expect(validateNode(node, true)).toBe(true);
		expect(validateNode(node, false)).toBe(false);
		expect(validateNode(node, 'true')).toBe(false);
	});

	it('validates array', () => {
		const node: SchemaNode = { kind: 'array', element: { kind: 'string' } };
		expect(validateNode(node, ['a', 'b'])).toBe(true);
		expect(validateNode(node, [1])).toBe(false);
		expect(validateNode(node, 'not-array')).toBe(false);
	});

	it('validates object with required and optional properties', () => {
		const node: SchemaNode = {
			kind: 'object',
			properties: {
				name: { optional: false, schema: { kind: 'string' } },
				bio: { optional: true, schema: { kind: 'string' } },
			},
		};
		expect(validateNode(node, { name: 'Alice' })).toBe(true);
		expect(validateNode(node, { name: 'Alice', bio: 'dev' })).toBe(true);
		expect(validateNode(node, {})).toBe(false);
		expect(validateNode(node, { name: 42 })).toBe(false);
	});

	it('does not accept prototype-inherited required properties', () => {
		const node: SchemaNode = {
			kind: 'object',
			properties: {
				name: { optional: false, schema: { kind: 'string' } },
			},
		};
		const inherited: Record<string, unknown> = {};
		Object.setPrototypeOf(inherited, { name: 'Alice' });
		expect(validateNode(node, inherited)).toBe(false);
	});

	it('validates union', () => {
		const node: SchemaNode = {
			kind: 'union',
			members: [{ kind: 'string' }, { kind: 'true' }],
		};
		expect(validateNode(node, 'hello')).toBe(true);
		expect(validateNode(node, true)).toBe(true);
		expect(validateNode(node, false)).toBe(false);
		expect(validateNode(node, 42)).toBe(false);
	});

	it('fails unresolved refs closed', () => {
		const node: SchemaNode = { kind: 'ref', target: 'flag' };
		expect(validateNode(node, 42)).toBe(false);
		expect(validateNode(node, { anything: 'goes' })).toBe(false);
	});
});

// ── JSON Schema conversion ──────────────────────────────────────────

describe('nodeToJsonSchema — JSON Schema conversion', () => {
	it('throws on undefined nodes', () => {
		expect(() => nodeToJsonSchema({ kind: 'undefined' })).toThrow(
			"Cannot convert 'undefined' type to JSON Schema; model optionality at the parent level",
		);
	});
});

// ── Integration — schema() ties both layers together ────────────────

describe('schema() — integrated compile-time + runtime', () => {
	it('infers flat object type and validates at runtime', () => {
		const user = schema('{ name: string; age: number }');

		// Compile-time: the parse return type is { name: string; age: number }
		const data = user.parse({ name: 'Alice', age: 30 });
		expectTypeOf(data).toEqualTypeOf<{ name: string; age: number }>();
		expect(data.name).toBe('Alice');
		expect(data.age).toBe(30);
	});

	it('infers optional properties', () => {
		const s = schema('{ name: string; bio?: string }');
		const data = s.parse({ name: 'Bob' });
		expectTypeOf(data).toEqualTypeOf<{ name: string; bio?: string }>();
		expect(data.name).toBe('Bob');
	});

	it('infers union type (string | true)', () => {
		const s = schema('string | true');
		expect(s.guard('hello')).toBe(true);
		expect(s.guard(true)).toBe(true);
		expect(s.guard(false)).toBe(false);
	});

	it('throws on invalid input', () => {
		const s = schema('{ name: string }');
		expect(() => s.parse({ name: 42 })).toThrow(TypeError);
	});

	it('guard narrows type', () => {
		const s = schema('{ value: number }');
		const input: unknown = { value: 5 };

		if (s.guard(input)) {
			expectTypeOf(input).toEqualTypeOf<{ value: number }>();
			expect(input.value).toBe(5);
		}
	});

	it('rejects unresolved refs at runtime', () => {
		const s = schema('@flag');
		expect(s.guard(42)).toBe(false);
		expect(() => s.parse(42)).toThrow(TypeError);
	});
});
