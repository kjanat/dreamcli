/** Collect Deno's documentation graph and adapt it to DreamCLI's reference model. @module */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { InheritedApiMember, PublicApiEntrypoint } from './api-index.ts';
import { collectInheritedApiMembers } from './api-index.ts';
import type {
	NormalizedApiComment,
	NormalizedApiExport,
	NormalizedApiModel,
	NormalizedApiNode,
	NormalizedApiSource,
	NormalizedApiType,
} from './api-model.ts';
import { gitRef } from './paths.ts';

// Deno doc v2's JSON is a graph of modules, symbols and discriminated declarations.
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown): JsonObject {
	return isObject(value) ? value : {};
}

function items(value: unknown): readonly JsonObject[] {
	return Array.isArray(value) ? value.map(object) : [];
}

function string(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

async function runDeno(args: readonly string[], cwd: string): Promise<string> {
	if (typeof Deno !== 'undefined') {
		const result = await new Deno.Command(Deno.execPath(), {
			args: [...args],
			cwd,
			stdout: 'piped',
			stderr: 'piped',
		}).output();
		const decoder = new TextDecoder();
		if (!result.success) throw new Error(decoder.decode(result.stderr));
		return decoder.decode(result.stdout);
	}
	try {
		const { stdout } = await promisify(execFile)('deno', args, {
			cwd,
			encoding: 'utf8',
			maxBuffer: 32 * 1024 * 1024,
		});
		return stdout;
	} catch (error) {
		if (object(error).code !== 'ENOENT') throw error;
		throw new Error(DENO_DOC_REQUIREMENT, { cause: error });
	}
}

const DENO_DOC_REQUIREMENT =
	'API reference generation requires Deno 2.9.8 or newer on PATH. Install it from https://docs.deno.com/runtime/getting_started/installation/.';

async function collectModules(root: string, entrypoints: readonly PublicApiEntrypoint[]) {
	const manifest = object(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')));
	const imports: Record<string, string> = {};
	for (const [specifier, target] of Object.entries(object(manifest.imports))) {
		if (typeof target !== 'string' || !target.startsWith('./')) continue;
		const key = specifier.replace(/\*$/u, '');
		const path = resolve(root, target.replace(/\*$/u, ''));
		imports[key] = pathToFileURL(key.endsWith('/') ? path + sep : path).href;
	}
	for (const dependency of Object.keys(object(manifest.dependencies))) {
		imports[dependency] = `npm:${dependency}`;
	}
	const importMap = `data:application/json,${encodeURIComponent(JSON.stringify({ imports }))}`;
	const modules = await Promise.all(
		entrypoints.map(async (entry) => {
			if (extname(entry.sourcePath) !== '.ts') return [];
			const url = pathToFileURL(resolve(root, entry.sourcePath)).href;
			const raw = await runDeno(
				[
					'doc',
					'--json',
					'--no-config',
					'--no-remote',
					'--no-lock',
					'--node-modules-dir=manual',
					'--import-map',
					importMap,
					url,
				],
				root,
			);
			const graph = object(JSON.parse(raw));
			const module = object(object(graph.nodes)[url]);
			if (graph.version !== 2)
				throw new Error(`Expected deno doc JSON v2. ${DENO_DOC_REQUIREMENT}`);
			if (!Array.isArray(module.symbols)) {
				throw new Error(`Expected a deno doc v2 graph for ${entry.sourcePath}`);
			}
			return items(module.symbols);
		}),
	);
	return { modules, imports, packageName: string(manifest.name) ?? '@kjanat/dreamcli' };
}

export async function collectDenoDocModel(
	packageJsonFilePath: string,
	publicApi: readonly PublicApiEntrypoint[],
): Promise<NormalizedApiModel> {
	const root = dirname(packageJsonFilePath);
	const { modules, imports, packageName } = await collectModules(root, publicApi);
	const normalize = new DenoDocNormalizer(
		root,
		packageName,
		imports,
		new Map(
			publicApi.map((entry, index) => [
				pathToFileURL(resolve(root, entry.sourcePath)).href,
				modules[index] ?? [],
			]),
		),
	);
	const exports: NormalizedApiExport[] = [];
	const entrypoints = publicApi.map((entry, index) => {
		const module = modules[index] ?? [];
		const byName = new Map(module.map((symbol) => [symbol.name, symbol]));
		const exportIds: string[] = [];
		const missingExports: string[] = [];
		const seen = new Set<string>();
		for (const symbol of entry.kindGroups.flatMap((group) => group.symbols)) {
			if (symbol.kind === 'asset' || seen.has(symbol.name)) continue;
			seen.add(symbol.name);
			const raw = byName.get(symbol.name);
			const reflection = raw === undefined ? undefined : normalize.symbol(symbol.name, raw);
			if (reflection === undefined) {
				missingExports.push(symbol.name);
				continue;
			}
			const id = `${entry.entrypoint}:${symbol.name}`;
			exportIds.push(id);
			exports.push({
				id,
				name: symbol.name,
				entrypoint: entry.entrypoint,
				subpath: entry.subpath,
				publicKind: symbol.kind,
				sourcePath: symbol.sourcePath,
				reflection,
			});
		}
		return {
			entrypoint: entry.entrypoint,
			subpath: entry.subpath,
			sourcePath: entry.sourcePath,
			hasDocumentation: extname(entry.sourcePath) === '.ts',
			exportIds,
			missingExports,
		};
	});
	const missing = entrypoints.flatMap((entry) =>
		entry.missingExports.map((name) => `${entry.entrypoint}:${name}`),
	);
	if (missing.length > 0) throw new Error(`deno doc omitted public exports: ${missing.join(', ')}`);
	const inherited = collectInheritedApiMembers(
		root,
		publicApi,
		new Set(
			exports.filter((entry) => entry.reflection.extendedTypes.length > 0).map((entry) => entry.id),
		),
	);
	for (const entry of exports) {
		const members = inherited.get(entry.id);
		if (members !== undefined) normalize.addInheritedMembers(entry.reflection, members);
	}
	return { schemaVersion: '1', collectorVersion: 2, packageName, entrypoints, exports };
}

class DenoDocNormalizer {
	private nextId = 0;
	private readonly declarations = new Map<string, JsonObject[]>();
	private readonly locations = new Map<string, JsonObject>();
	private readonly referenceResolutions = new WeakMap<NormalizedApiType, JsonObject>();
	private readonly inheritedGenericNodes = new WeakSet<NormalizedApiNode>();

	constructor(
		private readonly root: string,
		private readonly packageName: string,
		private readonly imports: Readonly<Record<string, string>>,
		private readonly modules: ReadonlyMap<string, readonly JsonObject[]>,
	) {
		for (const symbol of Array.from(modules.values()).flat()) {
			const name = string(symbol.name);
			if (name === undefined) continue;
			const declarations = items(symbol.declarations).filter(
				(declaration) => declaration.kind !== 'reference',
			);
			if (declarations.length === 0) continue;
			const entries = this.declarations.get(name) ?? [];
			entries.push(...declarations);
			this.declarations.set(name, entries);
			for (const declaration of declarations) {
				const location = object(declaration.location);
				this.locations.set(this.locationKey(location), declaration);
			}
		}
	}

	private locationKey(location: JsonObject): string {
		return `${location.filename}:${location.line}:${location.col}`;
	}

	addInheritedMembers(reflection: NormalizedApiNode, members: readonly InheritedApiMember[]): void {
		const existing = new Map(
			reflection.children.map((member) => [
				`${member.flags.includes('isStatic')}:${member.name}`,
				member,
			]),
		);
		for (const member of members) {
			const node = existing.get(`${member.isStatic}:${member.name}`);
			if (node === undefined || !this.inheritedGenericNodes.has(node)) continue;
			if (node.kind === 'property') node.type = { kind: 'unknown', name: member.type };
			if (node.getSignature !== null) {
				node.getSignature.type = { kind: 'unknown', name: member.type };
			}
			if (node.signatures.length === member.signatures.length) {
				node.signatures.forEach((signature, index) => {
					const resolved = member.signatures[index];
					if (resolved === undefined) return;
					signature.type = { kind: 'unknown', name: resolved.returnType };
					signature.parameters.forEach((param, paramIndex) => {
						const type = resolved.parameterTypes[paramIndex];
						if (type === undefined) return;
						param.type = { kind: 'unknown', name: type };
					});
				});
			}
		}
		const added = members
			.filter((member) => !existing.has(`${member.isStatic}:${member.name}`))
			.map((member) =>
				this.node(
					member.name,
					'property',
					{},
					{
						flags: [
							...(member.optional ? ['isOptional'] : []),
							...(member.isStatic ? ['isStatic'] : []),
						],
						type: { kind: 'unknown', name: member.type },
						comment:
							member.summary === ''
								? null
								: { summary: member.summary, blockTags: [], modifierTags: [] },
					},
				),
			);
		if (added.length === 0) return;
		reflection.children = [...reflection.children, ...added];
		const children = added.map(({ reflectionId, name }) => ({ reflectionId, name }));
		const propertyGroup = reflection.groups.find((group) => group.title === 'Properties');
		if (propertyGroup !== undefined)
			propertyGroup.children = [...propertyGroup.children, ...children];
		else reflection.groups = [...reflection.groups, { title: 'Properties', children }];
	}

	symbol(name: string, raw: JsonObject): NormalizedApiNode | undefined {
		const declarations = items(raw.declarations).flatMap((declaration) => {
			if (declaration.kind !== 'reference') return [declaration];
			const target = this.locations.get(this.locationKey(object(object(declaration.def).target)));
			return target === undefined ? [] : [target];
		});
		const first = declarations[0];
		if (first === undefined) return undefined;
		const def = object(first.def ?? first.enumDef);
		const kind = first.kind;
		if (kind === 'function') {
			const signatures = publicOverloads(declarations, (declaration) => object(declaration.def));
			return this.node(name, kind, first, {
				signatures: signatures.map((entry) =>
					this.signature(name, 'callSignature', object(entry.def), entry),
				),
			});
		}
		if (
			kind === 'class' ||
			kind === 'interface' ||
			kind === 'typeAlias' ||
			kind === 'enum' ||
			kind === 'variable' ||
			kind === 'namespace'
		) {
			const type = this.optionalType(def.tsType);
			const members = this.members(def, first);
			const nested = declarations
				.flatMap((declaration) => items(object(declaration.def).elements))
				.flatMap((entry) => {
					const name = string(entry.name);
					const node = name === undefined ? undefined : this.symbol(name, entry);
					return node === undefined ? [] : [node];
				});
			const children =
				kind === 'typeAlias'
					? this.aliasMembers(type, first, new Set([first]))
					: [...(members.children ?? []), ...nested];
			return this.node(name, kind, first, {
				...members,
				children,
				type,
				typeParameters: this.typeParameters(def.typeParams),
				defaultValue: typeof def.init === 'string' ? def.init : null,
				extendedTypes:
					typeof def.extends === 'string'
						? [this.reference(def.extends, {}, items(def.superTypeParams))]
						: items(def.extends).map((type) => this.type(type)),
				implementedTypes: items(def.implements).map((type) => this.type(type)),
			});
		}
		return this.node(name, 'unknown', first);
	}

	private aliasMembers(
		type: NormalizedApiType | null,
		origin: JsonObject,
		seen: Set<JsonObject>,
	): readonly NormalizedApiNode[] {
		if (type?.kind === 'reflection') return type.declaration.children;
		if (type?.kind === 'intersection') {
			return [
				...new Map(
					type.types
						.flatMap((part) => this.aliasMembers(part, origin, seen))
						.map((child) => [child.name, child]),
				).values(),
			];
		}
		if (type?.kind === 'reference') {
			const declaration = this.resolveDeclaration(
				type.name,
				origin,
				this.referenceResolutions.get(type),
			);
			if (declaration !== undefined && !seen.has(declaration)) {
				const def = object(declaration.def);
				return declaration.kind === 'typeAlias'
					? this.aliasMembers(
							this.optionalType(def.tsType),
							declaration,
							new Set([...seen, declaration]),
						)
					: (this.members(def, declaration, new Set([...seen, declaration])).children ?? []);
			}
		}
		return [];
	}

	private source(raw: JsonObject): NormalizedApiSource | null {
		const { filename, line, col } = object(raw.location);
		if (typeof filename !== 'string' || !filename.startsWith('file:') || typeof line !== 'number')
			return null;
		const path = relative(this.root, fileURLToPath(filename)).split(sep).join('/');
		const displayLine = line + 1;
		return {
			path,
			line: displayLine,
			character: typeof col === 'number' ? col : 0,
			url: path.startsWith('src/')
				? `https://github.com/kjanat/dreamcli/blob/${gitRef}/${path}#L${displayLine}`
				: null,
		};
	}

	private node(
		name: string,
		kind: NormalizedApiNode['kind'],
		raw: JsonObject = {},
		fields: Partial<NormalizedApiNode> = {},
	): NormalizedApiNode {
		const source = this.source(raw);
		const flags = [
			...(raw.optional === true || raw.isOptional === true ? ['isOptional'] : []),
			...(raw.readonly === true ? ['isReadonly'] : []),
			...(raw.isStatic === true ? ['isStatic'] : []),
			...(raw.accessibility === 'protected' ? ['isProtected'] : []),
			...(kind === 'parameter' && raw.kind === 'rest' ? ['isRest'] : []),
		];
		return {
			reflectionId: this.nextId++,
			name,
			kind,
			flags,
			comment: normalizeComment(raw.jsDoc),
			sourcePath: source?.path ?? null,
			sources: source === null ? [] : [source],
			defaultValue: null,
			type: null,
			signatures: [],
			parameters: [],
			typeParameters: [],
			children: [],
			indexSignatures: [],
			getSignature: null,
			setSignature: null,
			extendedTypes: [],
			implementedTypes: [],
			groups: [],
			...fields,
		};
	}

	private signature(
		name: string,
		kind: NormalizedApiNode['kind'],
		def: JsonObject,
		raw: JsonObject = def,
	): NormalizedApiNode {
		const docs = normalizeComment(raw.jsDoc);
		return this.node(name, kind, raw, {
			type: this.optionalType(def.returnType ?? def.tsType),
			parameters: items(def.params).map((param) => {
				const parameter = this.parameter(param);
				const doc = docs?.blockTags.find(
					(tag) => tag.tag === '@param' && tag.name === parameter.name,
				);
				return doc === undefined
					? parameter
					: {
							...parameter,
							comment: { summary: doc.content, blockTags: [], modifierTags: [] },
						};
			}),
			typeParameters: this.typeParameters(def.typeParams),
		});
	}

	private parameter(raw: JsonObject): NormalizedApiNode {
		const pattern = object(raw.left ?? raw.arg);
		const name =
			string(raw.name) ??
			string(pattern.name) ??
			(raw.kind === 'object' ? 'options' : raw.kind === 'array' ? 'items' : 'value');
		return this.node(name, 'parameter', raw.kind === 'assign' ? { ...raw, optional: true } : raw, {
			defaultValue: string(raw.right) ?? null,
			type: this.optionalType(raw.tsType ?? pattern.tsType),
		});
	}

	private typeParameters(raw: unknown): readonly NormalizedApiNode[] {
		return items(raw).map((param) =>
			this.node(string(param.name) ?? 'T', 'typeParameter', param, {
				type: this.optionalType(param.constraint),
				defaultValue:
					param.default === undefined ? null : (string(object(param.default).repr) ?? null),
			}),
		);
	}

	private members(
		def: JsonObject,
		declaration: JsonObject = {},
		ancestors = new Set<JsonObject>(),
	): Partial<NormalizedApiNode> {
		const properties = items(def.properties).filter(publicMember);
		const children = properties.map((property) =>
			this.node(string(property.name) ?? 'property', 'property', property, {
				type: this.optionalType(property.tsType),
			}),
		);
		const constructors = items(def.constructors).filter(publicMember);
		if (constructors.length > 0) {
			children.push(
				this.node('constructor', 'constructor', constructors[0], {
					signatures: publicOverloads(constructors, (entry) => entry).map((entry) =>
						this.signature('constructor', 'constructorSignature', entry),
					),
				}),
			);
		}
		const methods = new Map<string, JsonObject[]>();
		for (const method of items(def.methods).filter(publicMember)) {
			const name = string(method.name);
			if (name === undefined) continue;
			const key = `${method.isStatic === true}:${name}`;
			const overloads = methods.get(key) ?? [];
			overloads.push(method);
			methods.set(key, overloads);
		}
		for (const overloads of methods.values()) {
			const first = overloads[0];
			if (first === undefined) continue;
			const name = string(first.name) ?? 'method';
			const definition = (entry: JsonObject) => object(entry.functionDef ?? entry.def ?? entry);
			const get = overloads.find((entry) => entry.kind === 'getter');
			const set = overloads.find((entry) => entry.kind === 'setter');
			children.push(
				get !== undefined || set !== undefined
					? this.node(name, 'accessor', first, {
							getSignature:
								get === undefined
									? null
									: this.signature(name, 'getSignature', definition(get), get),
							setSignature:
								set === undefined
									? null
									: this.signature(name, 'setSignature', definition(set), set),
						})
					: this.node(name, 'method', first, {
							signatures: publicOverloads(overloads, definition).map((entry) =>
								this.signature(name, 'callSignature', definition(entry), entry),
							),
						}),
			);
		}
		for (const member of items(def.members).filter(publicMember)) {
			children.push(
				this.node(string(member.name) ?? 'member', 'enumMember', member, {
					defaultValue: string(object(member.init).repr) ?? null,
				}),
			);
		}
		const memberKey = (name: unknown, isStatic: boolean) => `${isStatic}:${name}`;
		const local = new Set(
			[...items(def.properties), ...items(def.methods)].map((member) =>
				memberKey(member.name, member.isStatic === true),
			),
		);
		const bases =
			typeof def.extends === 'string'
				? [{ kind: 'typeRef', value: { typeName: def.extends } }]
				: items(def.extends);
		for (const base of bases) {
			const name = string(object(base.value).typeName);
			const parent =
				name === undefined
					? undefined
					: this.resolveDeclaration(name, declaration, object(object(base.value).resolution));
			if (parent === undefined || ancestors.has(parent)) continue;
			const parentDef = object(parent.def);
			const inherited = this.members(parentDef, parent, new Set([...ancestors, parent]));
			for (const child of inherited.children ?? []) {
				const key = memberKey(child.name, child.flags.includes('isStatic'));
				if (child.kind === 'constructor' || local.has(key)) continue;
				local.add(key);
				if (items(parentDef.typeParams).length > 0) this.inheritedGenericNodes.add(child);
				children.push(child);
			}
		}
		const groups = [
			['Constructors', ['constructor']],
			['Properties', ['property', 'accessor']],
			['Methods', ['method']],
			['Members', ['enumMember']],
		] as const;
		return {
			children,
			groups: groups.flatMap(([title, kinds]) => {
				const members = children.filter((child) => kinds.some((kind) => kind === child.kind));
				return members.length
					? [{ title, children: members.map(({ reflectionId, name }) => ({ reflectionId, name })) }]
					: [];
			}),
			signatures: items(def.callSignatures)
				.filter(publicMember)
				.map((call) => this.signature('', 'callSignature', call)),
			indexSignatures: items(def.indexSignatures)
				.filter(publicMember)
				.map((index) => this.signature('', 'indexSignature', index)),
		};
	}

	private resolveDeclaration(
		name: string,
		origin: JsonObject,
		resolution: JsonObject = {},
	): JsonObject | undefined {
		const filename = string(object(origin.location).filename);
		if (filename === undefined || resolution.kind === 'typeParam') return undefined;
		let module = filename;
		if (resolution.kind === 'import') {
			const specifier = string(resolution.specifier);
			if (specifier === undefined) return undefined;
			const prefix = Object.keys(this.imports)
				.filter((key) => key.endsWith('/') && specifier.startsWith(key))
				.sort((left, right) => right.length - left.length)[0];
			const url = Object.hasOwn(this.imports, specifier)
				? this.imports[specifier]
				: prefix === undefined
					? specifier
					: this.imports[prefix] + specifier.slice(prefix.length);
			if (url === undefined || !/^(?:\.{1,2}\/|\/|[\w-]+:)/u.test(url)) return undefined;
			const resolved = URL.parse(url, filename);
			if (resolved === null) return undefined;
			module = resolved.href;
			name = string(resolution.name) ?? name;
			const exported = this.modules.get(module)?.find((symbol) => symbol.name === name);
			const first = items(exported?.declarations)[0];
			if (first !== undefined) {
				if (first.kind !== 'reference') return first;
				return this.locations.get(this.locationKey(object(object(first.def).target)));
			}
		}
		return this.declarations.get(name)?.find((entry) => object(entry.location).filename === module);
	}

	private optionalType(raw: unknown): NormalizedApiType | null {
		return raw === undefined || raw === null ? null : this.type(object(raw));
	}

	private reference(
		name: string,
		resolution: JsonObject,
		args: readonly JsonObject[],
	): NormalizedApiType {
		const target = this.declarations.get(name)?.[0];
		const reference: NormalizedApiType = {
			kind: 'reference',
			name,
			target: target === undefined ? null : this.locationKey(object(target.location)),
			packageName: target === undefined ? null : this.packageName,
			qualifiedName: null,
			externalUrl: null,
			refersToTypeParameter: resolution.kind === 'typeParam',
			typeArguments: args.map((entry) => this.type(entry)),
		};
		this.referenceResolutions.set(reference, resolution);
		return reference;
	}

	private type(raw: JsonObject): NormalizedApiType {
		const value = object(raw.value);
		const type = (part: unknown) => this.type(object(part));
		const types = (parts: unknown) => items(parts).map((item) => this.type(item));
		switch (raw.kind) {
			case 'keyword':
				return raw.value === 'null'
					? { kind: 'literal', value: null }
					: { kind: 'intrinsic', name: string(raw.value) ?? 'unknown' };
			case 'literal': {
				if (value.kind === 'template') {
					const parts = items(value.tsTypes);
					const text = (part: JsonObject | undefined) => string(part?.repr) ?? '';
					return {
						kind: 'templateLiteral',
						head: text(parts[0]),
						tail: parts.flatMap((part, index) =>
							index % 2 === 1 ? [{ type: this.type(part), text: text(parts[index + 1]) }] : [],
						),
					};
				}
				const literal = value.string ?? value.number ?? value.boolean;
				if (
					typeof literal === 'string' ||
					typeof literal === 'number' ||
					typeof literal === 'boolean'
				) {
					return { kind: 'literal', value: literal };
				}
				return { kind: 'unknown', name: string(raw.repr) ?? 'unknown' };
			}
			case 'typeRef':
				return this.reference(
					string(value.typeName) ?? 'unknown',
					object(value.resolution),
					items(value.typeParams),
				);
			case 'array':
			case 'optional':
			case 'rest':
				return { kind: raw.kind, elementType: type(raw.value) };
			case 'union':
			case 'intersection':
				return { kind: raw.kind, types: types(raw.value) };
			case 'tuple':
				return { kind: 'tuple', elements: types(raw.value) };
			case 'parenthesized':
				return type(raw.value);
			case 'indexedAccess':
				return {
					kind: 'indexedAccess',
					objectType: type(value.objType),
					indexType: type(value.indexType),
				};
			case 'conditional':
				return {
					kind: 'conditional',
					checkType: type(value.checkType),
					extendsType: type(value.extendsType),
					trueType: type(value.trueType),
					falseType: type(value.falseType),
				};
			case 'typeOperator':
				return {
					kind: 'typeOperator',
					operator: string(value.operator) ?? 'keyof',
					target: type(value.tsType),
				};
			case 'typeQuery':
				return {
					kind: 'query',
					queryType: { kind: 'unknown', name: string(raw.value) ?? 'unknown' },
				};
			case 'typePredicate':
				return {
					kind: 'predicate',
					name: string(object(value.param).name) ?? 'this',
					asserts: value.asserts === true,
					targetType: this.optionalType(value.type),
				};
			case 'infer': {
				const param = object(value.typeParam);
				return {
					kind: 'inferred',
					name: string(param.name) ?? 'T',
					constraint: this.optionalType(param.constraint),
				};
			}
			case 'mapped': {
				const param = object(value.typeParam);
				return {
					kind: 'mapped',
					parameter: string(param.name) ?? 'K',
					parameterType: this.optionalType(param.constraint),
					templateType: this.optionalType(value.tsType),
					readonlyModifier: modifier(value.readonly, 'readonly'),
					optionalModifier: modifier(value.optional, '?'),
					nameType: this.optionalType(value.nameType),
				};
			}
			case 'typeLiteral':
				return {
					kind: 'reflection',
					declaration: this.node('', 'typeLiteral', {}, this.members(value)),
				};
			case 'fnOrConstructor': {
				const isConstructor = value['constructor'] === true;
				return {
					kind: 'reflection',
					declaration: this.node(
						'',
						'typeLiteral',
						{},
						{
							signatures: [
								this.signature('', isConstructor ? 'constructorSignature' : 'callSignature', value),
							],
						},
					),
				};
			}
			default:
				return { kind: 'unknown', name: string(raw.repr) ?? 'unknown' };
		}
	}
}

function modifier(value: unknown, text: string): string | null {
	if (value === true) return text;
	return value === '+' || value === '-' ? value + text : null;
}

function publicMember(member: JsonObject): boolean {
	return (
		member.accessibility !== 'private' &&
		!items(object(member.jsDoc).tags).some((tag) => tag.kind === 'internal')
	);
}

function publicOverloads(
	declarations: readonly JsonObject[],
	definition: (entry: JsonObject) => JsonObject,
) {
	const signatures = declarations.filter((entry) => definition(entry).hasBody !== true);
	return signatures.length > 0 ? signatures : declarations;
}

function normalizeComment(raw: unknown): NormalizedApiComment | null {
	if (raw === undefined) return null;
	const comment = object(raw);
	const tags = items(comment.tags);
	return {
		summary: string(comment.doc) ?? '',
		blockTags: tags.flatMap((tag) => {
			if (tag.kind === 'unsupported') {
				const match = /^(@[\w-]+)\s*([\s\S]*)$/u.exec(string(tag.value) ?? '');
				return match?.[1] === undefined
					? []
					: [{ tag: match[1], content: match[2] ?? '', name: null }];
			}
			const kind = string(tag.kind);
			if (kind === undefined) return [];
			return [
				{
					tag: kind === 'return' ? '@returns' : `@${kind}`,
					content: string(tag.doc) ?? '',
					name: string(tag.name) ?? null,
				},
			];
		}),
		modifierTags: tags
			.filter((tag) => tag.kind === 'internal' || tag.kind === 'deprecated')
			.map((tag) => `@${tag.kind}`),
	};
}
