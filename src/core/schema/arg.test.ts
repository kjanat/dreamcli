import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ArgSchema, InferArg, InferArgs } from './arg.js';
import { ArgBuilder, arg } from './arg.js';

/** Test-only wrapper for custom parse validation. */
interface ParsedPath {
	readonly segments: readonly string[];
}
function parsePath(raw: string): ParsedPath {
	return { segments: raw.split('/') };
}

// ---------------------------------------------------------------------------
// Factory functions — runtime schema
// ---------------------------------------------------------------------------

describe('arg.string()', () => {
	it('creates a string arg with required presence', () => {
		const a = arg.string();
		expect(a).toBeInstanceOf(ArgBuilder);
		expect(a.schema.kind).toBe('string');
		expect(a.schema.presence).toBe('required');
		expect(a.schema.variadic).toBe(false);
		expect(a.schema.defaultValue).toBeUndefined();
	});
});

describe('arg.number()', () => {
	it('creates a number arg with required presence', () => {
		const a = arg.number();
		expect(a.schema.kind).toBe('number');
		expect(a.schema.presence).toBe('required');
		expect(a.schema.variadic).toBe(false);
	});
});

describe('arg.custom()', () => {
	it('creates a custom arg with the provided parse function', () => {
		const a = arg.custom(parsePath);
		expect(a.schema.kind).toBe('custom');
		expect(a.schema.presence).toBe('required');
		expect(a.schema.variadic).toBe(false);
		expect(a.schema.parseFn).toBe(parsePath);
	});

	it('stores a number parser', () => {
		const parseFn = (raw: string) => Number.parseInt(raw, 16);
		const a = arg.custom(parseFn);
		expect(a.schema.parseFn).toBe(parseFn);
	});
});

// ---------------------------------------------------------------------------
// Modifiers — runtime schema mutations
// ---------------------------------------------------------------------------

describe('.required()', () => {
	it('sets presence to required (explicit)', () => {
		const a = arg.string().optional().required();
		expect(a.schema.presence).toBe('required');
	});
});

describe('.optional()', () => {
	it('sets presence to optional', () => {
		const a = arg.string().optional();
		expect(a.schema.presence).toBe('optional');
	});
});

describe('.default()', () => {
	it('sets defaultValue and flips presence to defaulted', () => {
		const a = arg.string().default('world');
		expect(a.schema.presence).toBe('defaulted');
		expect(a.schema.defaultValue).toBe('world');
	});

	it('works with number args', () => {
		const a = arg.number().default(80);
		expect(a.schema.presence).toBe('defaulted');
		expect(a.schema.defaultValue).toBe(80);
	});
});

describe('.variadic()', () => {
	it('sets variadic to true', () => {
		const a = arg.string().variadic();
		expect(a.schema.variadic).toBe(true);
	});

	it('preserves presence when going variadic', () => {
		const a = arg.string().optional().variadic();
		expect(a.schema.variadic).toBe(true);
		expect(a.schema.presence).toBe('optional');
	});
});

describe('.describe()', () => {
	it('stores the description', () => {
		const a = arg.string().describe('Target environment');
		expect(a.schema.description).toBe('Target environment');
	});
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
	it('each modifier returns a new builder', () => {
		const a = arg.string();
		const b = a.describe('x');
		expect(a).not.toBe(b);
		expect(a.schema.description).toBeUndefined();
		expect(b.schema.description).toBe('x');
	});

	it('chaining does not mutate prior builders', () => {
		const base = arg.string();
		const withDesc = base.describe('name');
		const withOptional = base.optional();

		expect(base.schema.description).toBeUndefined();
		expect(base.schema.presence).toBe('required');
		expect(withDesc.schema.description).toBe('name');
		expect(withDesc.schema.presence).toBe('required');
		expect(withOptional.schema.description).toBeUndefined();
		expect(withOptional.schema.presence).toBe('optional');
	});

	it('default does not mutate original', () => {
		const base = arg.number();
		const withDefault = base.default(42);
		expect(base.schema.presence).toBe('required');
		expect(base.schema.defaultValue).toBeUndefined();
		expect(withDefault.schema.presence).toBe('defaulted');
		expect(withDefault.schema.defaultValue).toBe(42);
	});

	it('variadic does not mutate original', () => {
		const base = arg.string();
		const variadic = base.variadic();
		expect(base.schema.variadic).toBe(false);
		expect(variadic.schema.variadic).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Chaining — complex builder chains
// ---------------------------------------------------------------------------

describe('chaining', () => {
	it('supports PRD deploy target example', () => {
		const a = arg.string().describe('Deploy target');
		expect(a.schema.kind).toBe('string');
		expect(a.schema.description).toBe('Deploy target');
		expect(a.schema.presence).toBe('required');
		expect(a.schema.variadic).toBe(false);
	});

	it('optional variadic with description', () => {
		const a = arg.string().optional().variadic().describe('Input files');
		expect(a.schema.kind).toBe('string');
		expect(a.schema.presence).toBe('optional');
		expect(a.schema.variadic).toBe(true);
		expect(a.schema.description).toBe('Input files');
	});

	it('number with default and description', () => {
		const a = arg.number().default(8080).describe('Port number');
		expect(a.schema.presence).toBe('defaulted');
		expect(a.schema.defaultValue).toBe(8080);
		expect(a.schema.description).toBe('Port number');
	});

	it('custom with optional', () => {
		const a = arg.custom(parsePath).optional().describe('Config path');
		expect(a.schema.kind).toBe('custom');
		expect(a.schema.presence).toBe('optional');
		expect(a.schema.description).toBe('Config path');
	});
});

// ---------------------------------------------------------------------------
// Schema data defaults
// ---------------------------------------------------------------------------

describe('schema defaults', () => {
	it('all optional fields default to undefined or sensible values', () => {
		const s: ArgSchema = arg.string().schema;
		expect(s.kind).toBe('string');
		expect(s.presence).toBe('required');
		expect(s.variadic).toBe(false);
		expect(s.defaultValue).toBeUndefined();
		expect(s.description).toBeUndefined();
		expect(s.parseFn).toBeUndefined();
	});

	it('custom arg has parseFn, others do not', () => {
		expect(arg.string().schema.parseFn).toBeUndefined();
		expect(arg.number().schema.parseFn).toBeUndefined();
		expect(arg.custom(() => 'x').schema.parseFn).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Type inference — compile-time checks via expectTypeOf
// ---------------------------------------------------------------------------

describe('type inference', () => {
	it('string arg: string (required by default)', () => {
		const a = arg.string();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});

	it('number arg: number (required by default)', () => {
		const a = arg.number();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<number>();
	});

	it('custom arg: inferred return type (required by default)', () => {
		const a = arg.custom(parsePath);
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<ParsedPath>();
	});

	it('.optional() adds undefined', () => {
		const a = arg.string().optional();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string | undefined>();
	});

	it('.optional() on number adds undefined', () => {
		const a = arg.number().optional();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<number | undefined>();
	});

	it('.optional() on custom adds undefined', () => {
		const a = arg.custom(parsePath).optional();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<ParsedPath | undefined>();
	});

	it('.default() removes undefined (string)', () => {
		const a = arg.string().default('hi');
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});

	it('.default() on optional makes it defaulted (no undefined)', () => {
		const a = arg.string().optional().default('fallback');
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});

	it('.required() removes undefined', () => {
		const a = arg.string().optional().required();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});

	it('.variadic() wraps in array', () => {
		const a = arg.string().variadic();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string[]>();
	});

	it('.variadic() on number produces number[]', () => {
		const a = arg.number().variadic();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<number[]>();
	});

	it('optional variadic still produces array (variadic overrides)', () => {
		const a = arg.string().optional().variadic();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string[]>();
	});

	it('custom variadic produces custom[]', () => {
		const a = arg.custom(parsePath).variadic();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<ParsedPath[]>();
	});

	it('InferArgs maps a record of builders', () => {
		const defs = {
			target: arg.string().describe('Deploy target'),
			count: arg.number().optional(),
			files: arg.string().variadic(),
		};

		type Args = InferArgs<typeof defs>;

		expectTypeOf<Args>().toEqualTypeOf<{
			target: string;
			count: number | undefined;
			files: string[];
		}>();
	});

	it('InferArgs with custom and default', () => {
		const defs = {
			path: arg.custom(parsePath),
			name: arg.string().default('unnamed'),
		};

		type Args = InferArgs<typeof defs>;

		expectTypeOf<Args>().toEqualTypeOf<{
			path: ParsedPath;
			name: string;
		}>();
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
	it('overriding default replaces the value', () => {
		const a = arg.string().default('a').default('b');
		expect(a.schema.defaultValue).toBe('b');
	});

	it('required after default resets to required', () => {
		const a = arg.string().default('x').required();
		expect(a.schema.presence).toBe('required');
		// defaultValue remains in schema (runtime can still use it)
		expect(a.schema.defaultValue).toBe('x');
	});

	it('optional after required sets optional', () => {
		const a = arg.string().required().optional();
		expect(a.schema.presence).toBe('optional');
	});

	it('variadic preserves kind', () => {
		const a = arg.number().variadic();
		expect(a.schema.kind).toBe('number');
		expect(a.schema.variadic).toBe(true);
	});

	it('describe after variadic preserves both', () => {
		const a = arg.string().variadic().describe('files');
		expect(a.schema.variadic).toBe(true);
		expect(a.schema.description).toBe('files');
	});

	it('custom with identity parse', () => {
		const identity = (raw: string) => raw;
		const a = arg.custom(identity);
		expect(a.schema.parseFn).toBe(identity);
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});
});

// ---------------------------------------------------------------------------
// .deprecated() modifier
// ---------------------------------------------------------------------------

describe('.deprecated()', () => {
	it('sets deprecated to true when called with no argument', () => {
		const a = arg.string().deprecated();
		expect(a.schema.deprecated).toBe(true);
	});

	it('sets deprecated to the message when called with a string', () => {
		const a = arg.string().deprecated('use --target flag instead');
		expect(a.schema.deprecated).toBe('use --target flag instead');
	});

	it('does not change presence', () => {
		const a = arg.string().optional().deprecated();
		expect(a.schema.presence).toBe('optional');
	});

	it('does not change kind', () => {
		const a = arg.number().deprecated();
		expect(a.schema.kind).toBe('number');
	});

	it('preserves type inference — required stays required', () => {
		const a = arg.string().deprecated();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string>();
	});

	it('preserves type inference — optional stays optional', () => {
		const a = arg.string().optional().deprecated();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string | undefined>();
	});

	it('preserves type inference — variadic stays variadic', () => {
		const a = arg.string().variadic().deprecated();
		expectTypeOf<InferArg<typeof a>>().toEqualTypeOf<string[]>();
	});

	it('chains with other modifiers', () => {
		const a = arg.string().optional().deprecated('use flag instead').describe('Target');
		expect(a.schema.presence).toBe('optional');
		expect(a.schema.deprecated).toBe('use flag instead');
		expect(a.schema.description).toBe('Target');
	});

	it('returns a new builder (immutable)', () => {
		const a = arg.string();
		const b = a.deprecated();
		expect(a.schema.deprecated).toBeUndefined();
		expect(b.schema.deprecated).toBe(true);
	});

	it('defaults to undefined when not called', () => {
		const a = arg.string();
		expect(a.schema.deprecated).toBeUndefined();
	});
});
