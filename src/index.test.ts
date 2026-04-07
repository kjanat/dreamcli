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

function collectPublicExportsWithoutJsDoc(): readonly string[] {
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
	const checker = program.getTypeChecker();
	const missing = new Set<string>();
	const seen = new Set<string>();

	for (const entryPoint of publicEntryPoints) {
		const sourceFile = program.getSourceFile(path.join(repoRoot, entryPoint));

		if (sourceFile === undefined) {
			throw new Error(`Expected source file for ${entryPoint}`);
		}

		const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

		if (moduleSymbol === undefined) {
			throw new Error(`Expected module symbol for ${entryPoint}`);
		}

		for (const exportedSymbol of checker.getExportsOfModule(moduleSymbol)) {
			const symbol =
				exportedSymbol.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(exportedSymbol)
					: exportedSymbol;
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
});

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
					'createBunAdapter',
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
		'./runtime/bun.ts',
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
