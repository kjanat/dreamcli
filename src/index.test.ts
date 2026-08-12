import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = `${import.meta.dirname}/../`;
const publicEntryPoints = ['src/index.ts', 'src/testkit.ts', 'src/runtime.ts'];

function getDocTarget(declaration: ts.Declaration): ts.Node {
	if (
		ts.isVariableDeclaration(declaration) &&
		ts.isVariableDeclarationList(declaration.parent) &&
		ts.isVariableStatement(declaration.parent.parent)
	) {
		return declaration.parent.parent;
	}

	return declaration;
}

function hasJsDoc(node: ts.Node): boolean {
	return ts.getJSDocCommentsAndTags(node).length > 0;
}

interface TypeScriptProject {
	readonly program: ts.Program;
	readonly checker: ts.TypeChecker;
}

function createTypeScriptProject(): TypeScriptProject {
	const configPath = ts.findConfigFile(
		repoRoot,
		(fileName) => ts.sys.fileExists(fileName),
		'tsconfig.json',
	);

	if (configPath === undefined) {
		throw new Error('Expected tsconfig.json at repository root');
	}

	const configFile = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));

	if (configFile.error !== undefined) {
		throw new Error(
			ts.formatDiagnosticsWithColorAndContext([configFile.error], {
				getCanonicalFileName: (fileName) => fileName,
				getCurrentDirectory: () => repoRoot,
				getNewLine: () => '\n',
			}),
		);
	}

	const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot);
	const program = ts.createProgram({
		rootNames: parsedConfig.fileNames,
		options: parsedConfig.options,
	});
	return { program, checker: program.getTypeChecker() };
}

const typescriptProject = createTypeScriptProject();

function sourceFile(file: string): ts.SourceFile {
	const found = typescriptProject.program.getSourceFile(path.join(repoRoot, file));
	if (found === undefined) throw new Error(`Expected source file for ${file}`);
	return found;
}

function moduleExports(file: string): readonly ts.Symbol[] {
	const moduleSymbol = typescriptProject.checker.getSymbolAtLocation(sourceFile(file));
	if (moduleSymbol === undefined) throw new Error(`Expected module symbol for ${file}`);
	return typescriptProject.checker.getExportsOfModule(moduleSymbol);
}

function targetSymbol(symbol: ts.Symbol): ts.Symbol {
	return symbol.flags & ts.SymbolFlags.Alias
		? typescriptProject.checker.getAliasedSymbol(symbol)
		: symbol;
}

function isInternalExport(symbol: ts.Symbol): boolean {
	return (targetSymbol(symbol).getDeclarations() ?? []).some((declaration) =>
		ts.getJSDocTags(getDocTarget(declaration)).some((tag) => tag.tagName.text === 'internal'),
	);
}

function collectPublicExportsWithoutJsDoc(): readonly string[] {
	const { checker } = typescriptProject;
	const missing = new Set<string>();
	const seen = new Set<string>();

	for (const entryPoint of publicEntryPoints) {
		for (const exportedSymbol of moduleExports(entryPoint)) {
			const symbol = targetSymbol(exportedSymbol);
			const key = checker.getFullyQualifiedName(symbol);

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);

			const declarations = (symbol.getDeclarations() ?? []).filter((declaration) => {
				const fileName = declaration.getSourceFile().fileName;
				return fileName.startsWith(path.join(repoRoot, 'src')) && !fileName.includes('.test.');
			});

			if (declarations.length === 0) {
				continue;
			}

			const documented = declarations.some((declaration) => hasJsDoc(getDocTarget(declaration)));

			if (documented) {
				continue;
			}

			const firstDeclaration = declarations[0];

			if (firstDeclaration === undefined) {
				continue;
			}

			const relativePath = path.relative(repoRoot, firstDeclaration.getSourceFile().fileName);
			const line =
				ts.getLineAndCharacterOfPosition(
					firstDeclaration.getSourceFile(),
					firstDeclaration.getStart(),
				).line + 1;

			missing.add(`${symbol.getName()} - ${relativePath}:${line}`);
		}
	}

	return [...missing].sort();
}

describe('@kjanat/dreamcli', () => {
	it('module loads without error', async () => {
		const mod = await import('#dreamcli');
		expect(mod).toBeDefined();
	});

	it('keeps public export JSDoc coverage complete', { timeout: 15_000 }, () => {
		expect(collectPublicExportsWithoutJsDoc()).toEqual([]);
	});

	// A document leaves the process, so every fragment naming part of its shape
	// is a type a consumer writes against. `stability.md` classifies them as one
	// group, and one missing from the barrel is only visible at a consumer's
	// import.
	it('re-exports every version 1 fragment type from the barrel', () => {
		const declared = new Set(
			moduleExports('src/core/json-schema/index.ts')
				.filter((symbol) => symbol.getName().endsWith('FragmentV1') && !isInternalExport(symbol))
				.map((symbol) => symbol.getName()),
		);
		const reExported = new Set(moduleExports('src/index.ts').map((symbol) => symbol.getName()));

		expect([...declared].filter((name) => !reExported.has(name))).toEqual([]);
	});

	// `stability.md` classifies the exports of the four entrypoints, so a type it
	// classifies and no entrypoint exports is a promise a consumer cannot keep.
	// Its own "Internal surface" section is where a name is declared unreachable,
	// so everything above that heading is a claim about the public surface.
	it('exports every type stability.md classifies as public', () => {
		const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

		const entrypoints = new Set(
			['src/index.ts', 'src/runtime.ts', 'src/testkit.ts', 'src/version.ts'].flatMap((file) =>
				moduleExports(file).map((symbol) => symbol.getName()),
			),
		);

		const doc = read('docs/reference/stability.md');
		const publicSection = doc.slice(0, doc.indexOf('## Internal surface'));
		const cited = new Set(
			[...publicSection.matchAll(/`([A-Z][A-Za-z0-9]*)`/g)].map((match) => match[1] ?? ''),
		);

		const declared = collectDeclaredTypeNames();
		const unreachable = [...cited]
			.filter((name) => declared.has(name) && !entrypoints.has(name))
			.sort();

		expect(unreachable).toEqual([]);
	});
});

/** Every type, interface, and class name `src/` declares, outside test files. */
function collectDeclaredTypeNames(): ReadonlySet<string> {
	const names = new Set<string>();
	const sourceRoot = path.join(repoRoot, 'src');

	for (const file of typescriptProject.program.getSourceFiles()) {
		if (!file.fileName.startsWith(sourceRoot) || file.fileName.includes('.test.')) continue;

		const visit = (node: ts.Node): void => {
			if (
				(ts.isTypeAliasDeclaration(node) ||
					ts.isInterfaceDeclaration(node) ||
					ts.isClassDeclaration(node)) &&
				node.name !== undefined
			) {
				const symbol = typescriptProject.checker.getSymbolAtLocation(node.name);
				if (symbol !== undefined) names.add(symbol.getName());
			}
			ts.forEachChild(node, visit);
		};

		visit(file);
	}

	return names;
}

// === @kjanat/dreamcli/runtime

describe('@kjanat/dreamcli/runtime', () => {
	// --- export surface

	describe('export surface', () => {
		it('keeps runtime export surface curated', async () => {
			const mod = await import('#dreamcli/runtime');
			expect(Object.keys(mod).sort()).toEqual(
				[
					'ExitError',
					'RUNTIMES',
					'createAdapter',
					'createDenoAdapter',
					'createNodeAdapter',
					'detectRuntime',
				].sort(),
			);
		});
	});

	// --- module loads

	describe('module loads', () => {
		it('module loads without error', async () => {
			const mod = await import('#dreamcli/runtime');
			expect(mod).toBeDefined();
		});
	});
});

// === Subpath exports

describe('@kjanat/dreamcli/testkit — module loads', () => {
	it('module loads without error', async () => {
		const mod = await import('#dreamcli/testkit');
		expect(mod).toBeDefined();
	});
});

describe('project structure', () => {
	const coreModules = [
		'./core/errors/index.ts',
		'./core/schema/index.ts',
		'./core/parse/index.ts',
		'./core/resolve/index.ts',
		'./core/help/index.ts',
		'./core/completion/index.ts',
		'./core/output/index.ts',
		'./core/testkit/index.ts',
	] as const;

	const runtimeModules = [
		'./runtime/adapter.ts',
		'./runtime/detect.ts',
		'./runtime/node.ts',
		'./runtime/deno.ts',
	] as const;

	for (const path of coreModules) {
		it(`core module loads: ${path}`, async () => {
			const mod = await import(path);
			expect(mod).toBeDefined();
		});
	}

	for (const path of runtimeModules) {
		it(`runtime module loads: ${path}`, async () => {
			const mod = await import(path);
			expect(mod).toBeDefined();
		});
	}
});
