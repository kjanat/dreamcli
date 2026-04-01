import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FlagSchema, InferFlag, InferFlags } from './flag.ts';
import { FlagBuilder, flag } from './flag.ts';

// --- Factory functions — runtime schema

describe('flag.string()', () => {
	it('creates a string flag with optional presence', () => {
		const f = flag.string();
		expect(f).toBeInstanceOf(FlagBuilder);
		expect(f.schema.kind).toBe('string');
		expect(f.schema.presence).toBe('optional');
		expect(f.schema.defaultValue).toBeUndefined();
	});
});

describe('flag.number()', () => {
	it('creates a number flag with optional presence', () => {
		const f = flag.number();
		expect(f.schema.kind).toBe('number');
		expect(f.schema.presence).toBe('optional');
	});
});

describe('flag.boolean()', () => {
	it('creates a boolean flag defaulted to false', () => {
		const f = flag.boolean();
		expect(f.schema.kind).toBe('boolean');
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.defaultValue).toBe(false);
	});
});

describe('flag.enum()', () => {
	it('creates an enum flag with the provided values', () => {
		const f = flag.enum(['us', 'eu', 'ap']);
		expect(f.schema.kind).toBe('enum');
		expect(f.schema.presence).toBe('optional');
		expect(f.schema.enumValues).toEqual(['us', 'eu', 'ap']);
	});
});

describe('flag.array()', () => {
	it('creates an array flag storing the element schema', () => {
		const el = flag.string();
		const f = flag.array(el);
		expect(f.schema.kind).toBe('array');
		expect(f.schema.presence).toBe('optional');
		expect(f.schema.elementSchema).toBe(el.schema);
	});

	it('supports number elements', () => {
		const f = flag.array(flag.number());
		expect(f.schema.elementSchema?.kind).toBe('number');
	});
});

describe('flag.custom()', () => {
	it('creates a custom flag with optional presence', () => {
		const f = flag.custom((raw) => Number.parseInt(String(raw), 16));
		expect(f).toBeInstanceOf(FlagBuilder);
		expect(f.schema.kind).toBe('custom');
		expect(f.schema.presence).toBe('optional');
		expect(f.schema.parseFn).toBeTypeOf('function');
	});

	it('stores the parse function on the schema', () => {
		const parseFn = (raw: unknown) => Number.parseInt(String(raw), 16);
		const f = flag.custom(parseFn);
		expect(f.schema.parseFn).toBeDefined();
		expect(f.schema.parseFn?.('ff')).toBe(255);
	});

	it('infers return type from parse function', () => {
		const f = flag.custom((raw) => Number.parseInt(String(raw), 16));
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number | undefined>();
	});

	it('infers complex return types', () => {
		const f = flag.custom((raw) => {
			const [host, port] = String(raw).split(':');
			return { host: host ?? '', port: Number(port ?? 0) };
		});
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<{ host: string; port: number } | undefined>();
	});
});

// --- Modifiers — runtime schema mutations

describe('.default()', () => {
	it('sets defaultValue and flips presence to defaulted', () => {
		const f = flag.string().default('hello');
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.defaultValue).toBe('hello');
	});

	it('works with number flags', () => {
		const f = flag.number().default(8080);
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.defaultValue).toBe(8080);
	});

	it('works with enum flags', () => {
		const f = flag.enum(['us', 'eu']).default('us');
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.defaultValue).toBe('us');
	});
});

describe('.required()', () => {
	it('sets presence to required', () => {
		const f = flag.string().required();
		expect(f.schema.presence).toBe('required');
	});
});

describe('.alias()', () => {
	it('appends an alias', () => {
		const f = flag.boolean().alias('v');
		expect(f.schema.aliases).toEqual(['v']);
	});

	it('accumulates multiple aliases', () => {
		const f = flag.boolean().alias('v').alias('verbose');
		expect(f.schema.aliases).toEqual(['v', 'verbose']);
	});
});

describe('.env()', () => {
	it('stores the environment variable name', () => {
		const f = flag.string().env('API_KEY');
		expect(f.schema.envVar).toBe('API_KEY');
	});
});

describe('.config()', () => {
	it('stores the config path', () => {
		const f = flag.string().config('deploy.region');
		expect(f.schema.configPath).toBe('deploy.region');
	});
});

describe('.describe()', () => {
	it('stores the description', () => {
		const f = flag.string().describe('API key for auth');
		expect(f.schema.description).toBe('API key for auth');
	});
});

// --- Immutability

describe('immutability', () => {
	it('each modifier returns a new builder', () => {
		const a = flag.string();
		const b = a.describe('x');
		expect(a).not.toBe(b);
		expect(a.schema.description).toBeUndefined();
		expect(b.schema.description).toBe('x');
	});

	it('chaining does not mutate prior builders', () => {
		const base = flag.string();
		const withAlias = base.alias('n');
		const withDesc = base.describe('name');

		expect(base.schema.aliases).toEqual([]);
		expect(base.schema.description).toBeUndefined();
		expect(withAlias.schema.aliases).toEqual(['n']);
		expect(withAlias.schema.description).toBeUndefined();
		expect(withDesc.schema.aliases).toEqual([]);
		expect(withDesc.schema.description).toBe('name');
	});

	it('default does not mutate original', () => {
		const base = flag.number();
		const withDefault = base.default(3000);
		expect(base.schema.presence).toBe('optional');
		expect(base.schema.defaultValue).toBeUndefined();
		expect(withDefault.schema.presence).toBe('defaulted');
		expect(withDefault.schema.defaultValue).toBe(3000);
	});
});

// --- Chaining — complex builder chains

describe('chaining', () => {
	it('supports full PRD deploy example', () => {
		const f = flag
			.enum(['us', 'eu', 'ap'])
			.env('DEPLOY_REGION')
			.config('deploy.region')
			.describe('Target region');

		expect(f.schema.kind).toBe('enum');
		expect(f.schema.enumValues).toEqual(['us', 'eu', 'ap']);
		expect(f.schema.envVar).toBe('DEPLOY_REGION');
		expect(f.schema.configPath).toBe('deploy.region');
		expect(f.schema.description).toBe('Target region');
		expect(f.schema.presence).toBe('optional');
	});

	it('supports boolean with alias', () => {
		const f = flag.boolean().alias('f').describe('Force deploy');
		expect(f.schema.kind).toBe('boolean');
		expect(f.schema.aliases).toEqual(['f']);
		expect(f.schema.description).toBe('Force deploy');
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.defaultValue).toBe(false);
	});

	it('required string with description', () => {
		const f = flag.string().required().describe('API key').env('API_KEY');
		expect(f.schema.presence).toBe('required');
		expect(f.schema.description).toBe('API key');
		expect(f.schema.envVar).toBe('API_KEY');
	});
});

// --- Schema data defaults

describe('schema defaults', () => {
	it('all optional fields default to undefined or empty', () => {
		const s: FlagSchema = flag.string().schema;
		expect(s.aliases).toEqual([]);
		expect(s.envVar).toBeUndefined();
		expect(s.configPath).toBeUndefined();
		expect(s.description).toBeUndefined();
		expect(s.enumValues).toBeUndefined();
		expect(s.elementSchema).toBeUndefined();
	});
});

// --- Type inference — compile-time checks via expectTypeOf

describe('type inference', () => {
	it('string flag: string | undefined', () => {
		const f = flag.string();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string | undefined>();
	});

	it('number flag: number | undefined', () => {
		const f = flag.number();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number | undefined>();
	});

	it('boolean flag: boolean (defaulted, never undefined)', () => {
		const f = flag.boolean();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<boolean>();
	});

	it('enum flag: literal union | undefined', () => {
		const f = flag.enum(['us', 'eu', 'ap']);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'us' | 'eu' | 'ap' | undefined>();
	});

	it('array flag: element[]', () => {
		const f = flag.array(flag.string());
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string[]>();
	});

	it('.default() removes undefined from string', () => {
		const f = flag.string().default('hi');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('.default() removes undefined from number', () => {
		const f = flag.number().default(42);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number>();
	});

	it('.default() removes undefined from enum', () => {
		const f = flag.enum(['us', 'eu']).default('us');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'us' | 'eu'>();
	});

	it('.required() removes undefined from string', () => {
		const f = flag.string().required();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('.required() removes undefined from enum', () => {
		const f = flag.enum(['a', 'b']).required();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'a' | 'b'>();
	});

	it('.alias() preserves type', () => {
		const f = flag.boolean().alias('v');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<boolean>();
	});

	it('.env() preserves type', () => {
		const f = flag.string().env('FOO');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string | undefined>();
	});

	it('.describe() preserves type', () => {
		const f = flag.number().describe('port');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number | undefined>();
	});

	it('InferFlags maps a record of builders', () => {
		const defs = {
			verbose: flag.boolean().alias('v'),
			region: flag.enum(['us', 'eu', 'ap']).env('REGION'),
			port: flag.number().default(8080),
			name: flag.string().required(),
			tags: flag.array(flag.string()),
		};

		type Flags = InferFlags<typeof defs>;

		expectTypeOf<Flags>().toEqualTypeOf<{
			verbose: boolean;
			region: 'us' | 'eu' | 'ap' | undefined;
			port: number;
			name: string;
			tags: string[];
		}>();
	});

	it('array of number elements infers number[]', () => {
		const f = flag.array(flag.number());
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number[]>();
	});

	it('required array removes undefined', () => {
		const f = flag.array(flag.string()).required();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string[]>();
	});

	it('defaulted array removes undefined', () => {
		const f = flag.array(flag.number()).default([]);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number[]>();
	});

	it('custom flag: T | undefined', () => {
		const f = flag.custom((raw) => String(raw).split(','));
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string[] | undefined>();
	});

	it('.default() removes undefined from custom', () => {
		const f = flag.custom((raw) => String(raw).split(',')).default([]);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string[]>();
	});

	it('.required() removes undefined from custom', () => {
		const f = flag.custom((raw) => String(raw).split(',')).required();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string[]>();
	});

	it('InferFlags includes custom flags', () => {
		const defs = {
			hex: flag.custom((raw) => Number.parseInt(String(raw), 16)).required(),
			name: flag.string(),
		};

		type Flags = InferFlags<typeof defs>;

		expectTypeOf<Flags>().toEqualTypeOf<{
			hex: number;
			name: string | undefined;
		}>();
	});
});

// --- Edge cases

describe('edge cases', () => {
	it('boolean with explicit default(true) stays defaulted', () => {
		const f = flag.boolean().default(true);
		expect(f.schema.defaultValue).toBe(true);
		expect(f.schema.presence).toBe('defaulted');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<boolean>();
	});

	it('overriding default replaces the value', () => {
		const f = flag.string().default('a').default('b');
		expect(f.schema.defaultValue).toBe('b');
	});

	it('env after required preserves required', () => {
		const f = flag.string().required().env('X');
		expect(f.schema.presence).toBe('required');
		expect(f.schema.envVar).toBe('X');
	});

	it('config after default preserves defaulted', () => {
		const f = flag.number().default(80).config('port');
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.configPath).toBe('port');
	});

	it('enum with single value', () => {
		const f = flag.enum(['only']);
		expect(f.schema.enumValues).toEqual(['only']);
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'only' | undefined>();
	});

	it('custom with .default() preserves defaulted presence', () => {
		const f = flag.custom((raw) => Number.parseInt(String(raw), 16)).default(255);
		expect(f.schema.presence).toBe('defaulted');
		expect(f.schema.defaultValue).toBe(255);
	});

	it('custom with .env() preserves type', () => {
		const f = flag.custom((raw) => Number.parseInt(String(raw), 16)).env('HEX_VALUE');
		expect(f.schema.envVar).toBe('HEX_VALUE');
		expect(f.schema.kind).toBe('custom');
	});

	it('custom with .config() preserves type', () => {
		const f = flag.custom((raw) => Number.parseInt(String(raw), 16)).config('hex.value');
		expect(f.schema.configPath).toBe('hex.value');
		expect(f.schema.kind).toBe('custom');
	});
});

// --- .deprecated() modifier

describe('.deprecated()', () => {
	it('sets deprecated to true when called with no argument', () => {
		const f = flag.string().deprecated();
		expect(f.schema.deprecated).toBe(true);
	});

	it('sets deprecated to the message when called with a string', () => {
		const f = flag.string().deprecated('use --target instead');
		expect(f.schema.deprecated).toBe('use --target instead');
	});

	it('does not change presence', () => {
		const f = flag.string().required().deprecated();
		expect(f.schema.presence).toBe('required');
	});

	it('does not change kind', () => {
		const f = flag.number().deprecated();
		expect(f.schema.kind).toBe('number');
	});

	it('preserves type inference — optional stays optional', () => {
		const f = flag.string().deprecated();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string | undefined>();
	});

	it('preserves type inference — defaulted stays defaulted', () => {
		const f = flag.number().default(80).deprecated();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number>();
	});

	it('preserves type inference — required stays required', () => {
		const f = flag.string().required().deprecated();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('preserves type inference — enum stays enum', () => {
		const f = flag.enum(['a', 'b']).deprecated();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'a' | 'b' | undefined>();
	});

	it('chains with other modifiers', () => {
		const f = flag.string().alias('o').env('OUTPUT').deprecated('use --target').describe('Output');
		expect(f.schema.aliases).toEqual(['o']);
		expect(f.schema.envVar).toBe('OUTPUT');
		expect(f.schema.deprecated).toBe('use --target');
		expect(f.schema.description).toBe('Output');
	});

	it('returns a new builder (immutable)', () => {
		const a = flag.string();
		const b = a.deprecated();
		expect(a.schema.deprecated).toBeUndefined();
		expect(b.schema.deprecated).toBe(true);
	});

	it('defaults to undefined when not called', () => {
		const f = flag.string();
		expect(f.schema.deprecated).toBeUndefined();
	});
});

// --- .propagate() modifier

describe('.propagate()', () => {
	it('sets propagate to true', () => {
		const f = flag.string().propagate();
		expect(f.schema.propagate).toBe(true);
	});

	it('defaults to false when not called', () => {
		const f = flag.string();
		expect(f.schema.propagate).toBe(false);
	});

	it('does not change presence', () => {
		const f = flag.string().required().propagate();
		expect(f.schema.presence).toBe('required');
	});

	it('does not change kind', () => {
		const f = flag.number().propagate();
		expect(f.schema.kind).toBe('number');
	});

	it('preserves type inference — optional stays optional', () => {
		const f = flag.string().propagate();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string | undefined>();
	});

	it('preserves type inference — defaulted stays defaulted', () => {
		const f = flag.number().default(80).propagate();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number>();
	});

	it('preserves type inference — required stays required', () => {
		const f = flag.string().required().propagate();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	it('preserves type inference — enum stays enum', () => {
		const f = flag.enum(['a', 'b']).propagate();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<'a' | 'b' | undefined>();
	});

	it('chains with other modifiers', () => {
		const f = flag.string().alias('v').env('VERBOSE').propagate().describe('Verbose output');
		expect(f.schema.aliases).toEqual(['v']);
		expect(f.schema.envVar).toBe('VERBOSE');
		expect(f.schema.propagate).toBe(true);
		expect(f.schema.description).toBe('Verbose output');
	});

	it('chains with deprecated', () => {
		const f = flag.string().propagate().deprecated('use --log-level');
		expect(f.schema.propagate).toBe(true);
		expect(f.schema.deprecated).toBe('use --log-level');
	});

	it('returns a new builder (immutable)', () => {
		const a = flag.string();
		const b = a.propagate();
		expect(a.schema.propagate).toBe(false);
		expect(b.schema.propagate).toBe(true);
	});

	it('works on boolean flags', () => {
		const f = flag.boolean().propagate();
		expect(f.schema.propagate).toBe(true);
		expect(f.schema.kind).toBe('boolean');
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<boolean>();
	});
});
