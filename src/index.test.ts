import { describe, expect, it } from 'vitest';

describe('dreamcli', () => {
	it('module loads without error', async () => {
		const mod = await import('./index.js');
		expect(mod).toBeDefined();
	});
});

// === Subpath exports

describe('dreamcli/testkit — module loads', () => {
	it('module loads without error', async () => {
		const mod = await import('./testkit.js');
		expect(mod).toBeDefined();
	});
});

// ---

describe('dreamcli/runtime — module loads', () => {
	it('module loads without error', async () => {
		const mod = await import('./runtime.js');
		expect(mod).toBeDefined();
	});
});

describe('project structure', () => {
	const coreModules = [
		'./core/errors/index.js',
		'./core/schema/index.js',
		'./core/parse/index.js',
		'./core/resolve/index.js',
		'./core/help/index.js',
		'./core/completion/index.js',
		'./core/output/index.js',
		'./core/testkit/index.js',
	] as const;

	const runtimeModules = [
		'./runtime/adapter.js',
		'./runtime/detect.js',
		'./runtime/node.js',
		'./runtime/bun.js',
		'./runtime/deno.js',
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
