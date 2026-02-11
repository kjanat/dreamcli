import { describe, expect, it } from 'vitest';

describe('dreamcli', () => {
	it('module loads without error', async () => {
		const mod = await import('./index.ts');
		expect(mod).toBeDefined();
	});
});

// === Subpath exports

describe('dreamcli/testkit — module loads', () => {
	it('module loads without error', async () => {
		const mod = await import('./testkit.ts');
		expect(mod).toBeDefined();
	});
});

// ---

describe('dreamcli/runtime — module loads', () => {
	it('module loads without error', async () => {
		const mod = await import('./runtime.ts');
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
