/**
 * Runtime schema string parser.
 *
 * Parses the same string literals as the compile-time {@link Parse} type,
 * producing a runtime AST ({@link SchemaNode}) that mirrors the inferred
 * TypeScript type. The AST can drive JSON Schema generation, validation,
 * and introspection — all from the same source string.
 *
 * Grammar (matches the type-level parser in `parse.ts`):
 * ```
 * value      = union
 * union      = postfix ('|' postfix)*
 * postfix    = primary ('[]')*
 * primary    = object | record | ref | literal | IDENT
 * object     = '{' properties '}'
 * properties = (property ';')* property? ';'?
 * property   = IDENT '?'? ':' value
 * record     = 'Record' '<' value ',' value '>'
 * ref        = '@' IDENT
 * literal    = "'" CHARS "'"
 * ```
 *
 * @module dreamcli/core/schema-dsl/runtime
 */

// === AST node types (discriminated union) ===

/** Discriminated union of all schema AST nodes. */
type SchemaNode =
	| StringNode
	| NumberNode
	| IntegerNode
	| BooleanNode
	| LiteralTrueNode
	| LiteralFalseNode
	| LiteralNullNode
	| LiteralStringNode
	| LiteralUndefinedNode
	| UnknownNode
	| NeverNode
	| ArrayNode
	| ObjectNode
	| UnionNode
	| RefNode
	| RecordNode;

/** String primitive. */
interface StringNode {
	/** Identifies this node as a string type. */
	readonly kind: 'string';
}

/** Number primitive. */
interface NumberNode {
	/** Identifies this node as a number type. */
	readonly kind: 'number';
}

/** Integer primitive (maps to `number` in TS, `integer` in JSON Schema). */
interface IntegerNode {
	/** Identifies this node as an integer type. */
	readonly kind: 'integer';
}

/** Boolean primitive. */
interface BooleanNode {
	/** Identifies this node as a boolean type. */
	readonly kind: 'boolean';
}

/** Literal `true`. */
interface LiteralTrueNode {
	/** Identifies this node as the literal `true` value. */
	readonly kind: 'true';
}

/** Literal `false`. */
interface LiteralFalseNode {
	/** Identifies this node as the literal `false` value. */
	readonly kind: 'false';
}

/** Literal `null`. */
interface LiteralNullNode {
	/** Identifies this node as the literal `null` value. */
	readonly kind: 'null';
}

/** String literal value (e.g. `'confirm'`). */
interface LiteralStringNode {
	/** Identifies this node as a string literal. */
	readonly kind: 'literal';
	/** The exact string value this literal represents. */
	readonly value: string;
}

/** Literal `undefined`. */
interface LiteralUndefinedNode {
	/** Identifies this node as the literal `undefined` value. */
	readonly kind: 'undefined';
}

/** The `unknown` top type. */
interface UnknownNode {
	/** Identifies this node as the `unknown` top type. */
	readonly kind: 'unknown';
}

/** The `never` bottom type. */
interface NeverNode {
	/** Identifies this node as the `never` bottom type. */
	readonly kind: 'never';
}

/** Array of element type. */
interface ArrayNode {
	/** Identifies this node as an array type. */
	readonly kind: 'array';
	/** The type of each array element. */
	readonly element: SchemaNode;
}

/** Object with named properties. */
interface ObjectNode {
	/** Identifies this node as an object type. */
	readonly kind: 'object';
	/** Named properties keyed by field name. */
	readonly properties: Readonly<Record<string, PropertyNode>>;
}

/** Union of two or more member types. */
interface UnionNode {
	/** Identifies this node as a union type. */
	readonly kind: 'union';
	/** The constituent types of this union. */
	readonly members: readonly SchemaNode[];
}

/** Reference to a named definition (e.g. `@flag` → `$ref: '#/$defs/flag'`). */
interface RefNode {
	/** Identifies this node as a `$ref` reference. */
	readonly kind: 'ref';
	/** Name of the referenced definition (without the `@` prefix). */
	readonly target: string;
}

/** Record/dictionary type (e.g. `Record<string, @flag>`). */
interface RecordNode {
	/** Identifies this node as a record/dictionary type. */
	readonly kind: 'record';
	/** The type of each record value (keys are always strings). */
	readonly value: SchemaNode;
}

/** A named property with optionality flag. */
interface PropertyNode {
	/** Whether the property is optional (`?` suffix in the schema DSL). */
	readonly optional: boolean;
	/** The property's value type. */
	readonly schema: SchemaNode;
}

// === Tokenizer ===

/** Token kind discriminator. */
type TokenKind =
	| 'ident'
	| 'string_literal'
	| 'ref'
	| 'lbrace'
	| 'rbrace'
	| 'lbracket'
	| 'rbracket'
	| 'langle'
	| 'rangle'
	| 'comma'
	| 'colon'
	| 'semicolon'
	| 'question'
	| 'pipe';

/** A single token from the schema string. */
interface Token {
	readonly kind: TokenKind;
	readonly value: string;
}

/** Map single characters to their token kinds. */
const SINGLE_CHAR_TOKENS: Readonly<Record<string, TokenKind>> = {
	'{': 'lbrace',
	'}': 'rbrace',
	'[': 'lbracket',
	']': 'rbracket',
	'<': 'langle',
	'>': 'rangle',
	',': 'comma',
	':': 'colon',
	';': 'semicolon',
	'?': 'question',
	'|': 'pipe',
};

/** Whitespace characters to skip. */
function isWhitespace(c: string): boolean {
	return c === ' ' || c === '\n' || c === '\t' || c === '\r';
}

/** Identifier-valid characters (a-z, A-Z, 0-9, _, $). */
function isIdentChar(c: string): boolean {
	return (
		(c >= 'a' && c <= 'z') ||
		(c >= 'A' && c <= 'Z') ||
		(c >= '0' && c <= '9') ||
		c === '_' ||
		c === '$'
	);
}

/** Identifier start characters (a-z, A-Z, _, $). */
function isIdentStart(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

/**
 * Tokenize a schema source string.
 *
 * Produces a flat array of tokens: identifiers (`string`, `number`, etc.),
 * punctuation (`{`, `}`, `[`, `]`, `:`, `;`, `?`, `|`), and skips
 * whitespace. Throws on unrecognized characters.
 */
function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < source.length) {
		const c = source[i] ?? '';

		if (isWhitespace(c)) {
			i++;
			continue;
		}

		const singleKind = SINGLE_CHAR_TOKENS[c];
		if (singleKind !== undefined) {
			tokens.push({ kind: singleKind, value: c });
			i++;
			continue;
		}

		// String literal: 'foo'
		if (c === "'") {
			let lit = '';
			i++; // skip opening quote
			while (i < source.length && source[i] !== "'") {
				lit += source[i];
				i++;
			}
			if (i >= source.length) throw new SyntaxError('Unterminated string literal');
			i++; // skip closing quote
			tokens.push({ kind: 'string_literal', value: lit });
			continue;
		}

		// Reference: @name
		if (c === '@') {
			i++; // skip @
			let ref = '';
			while (i < source.length) {
				const ch = source[i] ?? '';
				if (!isIdentChar(ch)) break;
				ref += ch;
				i++;
			}
			if (ref.length === 0)
				throw new SyntaxError(`Expected identifier after '@' at position ${String(i)}`);
			tokens.push({ kind: 'ref', value: ref });
			continue;
		}

		if (isIdentStart(c)) {
			let ident = '';
			while (i < source.length) {
				const ch = source[i] ?? '';
				if (!isIdentChar(ch)) break;
				ident += ch;
				i++;
			}
			tokens.push({ kind: 'ident', value: ident });
			continue;
		}

		throw new SyntaxError(`Unexpected character '${c}' at position ${String(i)}`);
	}

	return tokens;
}

// === Primitive lookup ===

/** Primitive type names recognized by the parser. */
const PRIMITIVES: ReadonlySet<string> = new Set([
	'string',
	'number',
	'integer',
	'boolean',
	'true',
	'false',
	'null',
	'undefined',
	'unknown',
	'never',
]);

/** Map a primitive name to its AST node. */
function primitiveNode(name: string): SchemaNode {
	switch (name) {
		case 'string':
			return { kind: 'string' };
		case 'number':
			return { kind: 'number' };
		case 'integer':
			return { kind: 'integer' };
		case 'boolean':
			return { kind: 'boolean' };
		case 'true':
			return { kind: 'true' };
		case 'false':
			return { kind: 'false' };
		case 'null':
			return { kind: 'null' };
		case 'undefined':
			return { kind: 'undefined' };
		case 'unknown':
			return { kind: 'unknown' };
		case 'never':
			return { kind: 'never' };
		default:
			throw new SyntaxError(`Unknown type '${name}'`);
	}
}

// === Recursive descent parser ===

/**
 * Parse a token stream into a {@link SchemaNode} AST.
 *
 * Implements the grammar documented at the module level using standard
 * recursive descent. Each grammar rule maps to one `parse*` method.
 */
class SchemaParser {
	private pos = 0;

	constructor(private readonly tokens: readonly Token[]) {}

	/** Parse the full token stream, asserting all tokens are consumed. */
	parseRoot(): SchemaNode {
		const result = this.parseValue();
		if (this.pos < this.tokens.length) {
			const leftover = this.peek();
			throw new SyntaxError(
				`Unexpected token '${leftover?.value ?? '?'}' at position ${String(this.pos)}`,
			);
		}
		return result;
	}

	// --- Grammar rules ---

	/** value = union */
	private parseValue(): SchemaNode {
		return this.parseUnion();
	}

	/** union = postfix ('|' postfix)* */
	private parseUnion(): SchemaNode {
		const first = this.parsePostfix();

		if (!this.check('pipe')) return first;

		const members: SchemaNode[] = [first];
		while (this.match('pipe')) {
			members.push(this.parsePostfix());
		}
		return { kind: 'union', members };
	}

	/** postfix = primary ('[]')* */
	private parsePostfix(): SchemaNode {
		let node = this.parsePrimary();

		while (this.check('lbracket') && this.checkAt(this.pos + 1, 'rbracket')) {
			this.advance(); // [
			this.advance(); // ]
			node = { kind: 'array', element: node };
		}

		return node;
	}

	/** primary = object | record | ref | literal | IDENT */
	private parsePrimary(): SchemaNode {
		if (this.check('lbrace')) {
			return this.parseObject();
		}

		if (this.check('string_literal')) {
			const token = this.advance();
			return { kind: 'literal', value: token.value };
		}

		if (this.check('ref')) {
			const token = this.advance();
			return { kind: 'ref', target: token.value };
		}

		const name = this.expectIdent();

		// Record<K, V>
		if (name === 'Record') {
			this.expect('langle');
			const keySchema = this.parseValue();
			if (keySchema.kind !== 'string') {
				throw new SyntaxError(
					"Record key type must be 'string' because JSON object keys are always strings",
				);
			}
			this.expect('comma');
			const valueSchema = this.parseValue();
			this.expect('rangle');
			return { kind: 'record', value: valueSchema };
		}

		if (!PRIMITIVES.has(name)) {
			throw new SyntaxError(`Unknown type '${name}' at position ${String(this.pos - 1)}`);
		}
		return primitiveNode(name);
	}

	/** object = '{' properties '}' */
	private parseObject(): ObjectNode {
		this.expect('lbrace');

		const properties: Record<string, PropertyNode> = {};

		while (!this.check('rbrace')) {
			const name = this.expectIdent();
			if (Object.hasOwn(properties, name)) {
				throw new SyntaxError(`Duplicate property '${name}' at position ${String(this.pos - 1)}`);
			}
			const optional = this.match('question');
			this.expect('colon');
			const schema = this.parseValue();

			properties[name] = { optional, schema };

			this.match('semicolon'); // optional trailing semicolon
		}

		this.expect('rbrace');
		return { kind: 'object', properties };
	}

	// --- Token helpers ---

	private peek(): Token | undefined {
		return this.tokens[this.pos];
	}

	private check(kind: TokenKind): boolean {
		return this.peek()?.kind === kind;
	}

	private checkAt(pos: number, kind: TokenKind): boolean {
		return this.tokens[pos]?.kind === kind;
	}

	private advance(): Token {
		const token = this.tokens[this.pos];
		if (token === undefined) {
			throw new SyntaxError('Unexpected end of input');
		}
		this.pos++;
		return token;
	}

	private match(kind: TokenKind): boolean {
		if (this.check(kind)) {
			this.pos++;
			return true;
		}
		return false;
	}

	private expect(kind: TokenKind): Token {
		if (!this.check(kind)) {
			const got = this.peek();
			throw new SyntaxError(
				got
					? `Expected '${kind}' but got '${got.kind}' ('${got.value}') at position ${String(this.pos)}`
					: `Expected '${kind}' but reached end of input`,
			);
		}
		return this.advance();
	}

	private expectIdent(): string {
		return this.expect('ident').value;
	}
}

/**
 * Parse a schema source string into a runtime AST.
 *
 * @param source - Schema string (e.g. `"{ name: string; age: number }"`).
 * @returns The root {@link SchemaNode}.
 * @throws {@link SyntaxError} on malformed input.
 */
function parseSchema(source: string): SchemaNode {
	const tokens = tokenize(source);
	return new SchemaParser(tokens).parseRoot();
}

// === Validation ===

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate that `input` conforms to the given AST node.
 *
 * @param node - The schema AST to validate against.
 * @param input - The value to check.
 * @returns `true` if the value matches the schema.
 */
function validateNode(node: SchemaNode, input: unknown): boolean {
	switch (node.kind) {
		case 'string':
			return typeof input === 'string';
		case 'number':
			return typeof input === 'number';
		case 'integer':
			return typeof input === 'number' && Number.isInteger(input);
		case 'boolean':
			return typeof input === 'boolean';
		case 'true':
			return input === true;
		case 'false':
			return input === false;
		case 'null':
			return input === null;
		case 'literal':
			return input === node.value;
		case 'undefined':
			return input === undefined;
		case 'unknown':
			return true;
		case 'never':
			return false;
		case 'ref':
			return false; // fail closed until refs can be resolved against a definition map
		case 'array':
			return Array.isArray(input) && input.every((el) => validateNode(node.element, el));
		case 'object': {
			if (!isRecord(input)) return false;
			for (const key of Object.keys(input)) {
				if (!Object.hasOwn(node.properties, key)) return false;
			}
			for (const [key, prop] of Object.entries(node.properties)) {
				if (!Object.hasOwn(input, key)) {
					if (!prop.optional) return false;
					continue;
				}
				if (!validateNode(prop.schema, input[key])) return false;
			}
			return true;
		}
		case 'record': {
			if (!isRecord(input)) return false;
			return Object.values(input).every((v) => validateNode(node.value, v));
		}
		case 'union':
			return node.members.some((member) => validateNode(member, input));
	}
}

// === Exports ===

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
};
export { parseSchema, validateNode };
