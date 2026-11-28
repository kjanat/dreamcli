/** Verify starter generation and destination safeguards. @module */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaffold } from './create.ts';

function withProject(test: (directory: string) => void): void {
	const directory = mkdtempSync(join(tmpdir(), 'dreamcli-create-'));
	try {
		test(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe('scaffold', () => {
	it('creates a runnable npm project by default without touching an existing directory', () => {
		withProject((directory) => {
			const run = (options: { name: string; test?: boolean; force?: boolean }) =>
				execFileSync(
					process.execPath,
					[
						...(typeof Deno === 'undefined' ? ['-e'] : ['eval', '--ext=mjs']),
						`import { scaffold } from ${JSON.stringify(new URL('./create.ts', import.meta.url).href)}; scaffold(${JSON.stringify(options)});`,
					],
					{ cwd: directory, stdio: 'pipe' },
				);

			run({ name: 'My CLI' });
			const packageFile = join(directory, 'my-cli', 'package.json');
			const manifest = readFileSync(packageFile, 'utf8');
			expect(JSON.parse(manifest)).toMatchObject({
				name: 'my-cli',
				type: 'module',
				scripts: { start: 'node src/cli.ts', typecheck: 'tsc --noEmit', test: 'vitest run' },
				dependencies: { '@kjanat/dreamcli': expect.any(String) },
				devDependencies: { vitest: expect.any(String) },
			});
			expect(existsSync(join(directory, 'my-cli', 'src/commands/hello.test.ts'))).toBe(true);
			expect(() => run({ name: 'my-cli', force: true })).toThrow(/not empty/);
			expect(readFileSync(packageFile, 'utf8')).toBe(manifest);

			run({ name: 'no-test', test: false });
			const withoutTests = JSON.parse(
				readFileSync(join(directory, 'no-test', 'package.json'), 'utf8'),
			);
			expect(withoutTests.scripts).toEqual({ start: 'node src/cli.ts', typecheck: 'tsc --noEmit' });
			expect(withoutTests.devDependencies.vitest).toBeUndefined();
			expect(existsSync(join(directory, 'no-test', 'src/commands/hello.test.ts'))).toBe(false);
		});
	});

	it('uses an explicit project directory and keeps its existing parents', () => {
		withProject((directory) => {
			const target = join(directory, 'nested', 'My CLI');
			mkdirSync(target, { recursive: true });
			const result = scaffold({ name: 'My CLI', directory: target, test: false });
			expect(result.entry).toBe(join(target, 'src/cli.ts'));
			expect(readFileSync(join(target, '.gitignore'), 'utf8')).toBe('node_modules/\ncoverage/\n');
			expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name).toBe('my-cli');
		});
	});

	it('adds starter files under a nested destination in a Bun project', () => {
		withProject((directory) => {
			writeFileSync(join(directory, 'bun.lock'), '{}');
			const out = join(directory, 'src', 'cli');
			const result = scaffold({ name: ' My CLI! ', out });

			expect(result).toEqual({
				name: 'my-cli',
				entry: join(out, 'my-cli.ts'),
				test: join(out, 'my-cli.test.ts'),
				files: [join(out, 'my-cli.ts'), join(out, 'my-cli.test.ts')],
				testRunner: 'bun:test',
			});
			expect(readFileSync(result.entry, 'utf8')).toContain("cli('my-cli').command(hello)");
			expect(readFileSync(join(out, 'my-cli.test.ts'), 'utf8')).toContain("from 'bun:test'");
		});
	});

	it('uses Vitest for starter files when declared in a Bun workspace', () => {
		withProject((directory) => {
			writeFileSync(
				join(directory, 'package.json'),
				JSON.stringify({ packageManager: 'bun@1.4.5', devDependencies: { vitest: '^5.0.0' } }),
			);
			const result = scaffold({ name: 'my-cli', out: directory });

			expect(result.testRunner).toBe('vitest');
			expect(readFileSync(result.entry, 'utf8')).toContain("command('hello')");
			const test = readFileSync(join(directory, 'my-cli.test.ts'), 'utf8');
			expect(test).toContain("from 'vitest'");
			expect(test).toContain("import { hello } from './my-cli.ts'");
		});
	});

	it('leaves the directory untouched when only the test file exists', () => {
		withProject((directory) => {
			const existing = join(directory, 'my-cli.test.ts');
			writeFileSync(existing, 'keep this');
			expect(() => scaffold({ name: 'my-cli', out: directory })).toThrow(
				/--force|Refusing to overwrite/,
			);
			expect(existsSync(join(directory, 'my-cli.ts'))).toBe(false);
			expect(readFileSync(existing, 'utf8')).toBe('keep this');
		});
	});

	it('replaces the entry with force and leaves the test alone when tests are disabled', () => {
		withProject((directory) => {
			const entry = join(directory, 'my-cli.ts');
			const test = join(directory, 'my-cli.test.ts');
			writeFileSync(entry, 'old entry');
			writeFileSync(test, 'keep this');
			const result = scaffold({ name: 'my-cli', out: directory, test: false, force: true });
			expect(result).toEqual({ name: 'my-cli', entry, files: [entry] });
			expect(readFileSync(entry, 'utf8')).toContain("cli('my-cli')");
			expect(readFileSync(test, 'utf8')).toBe('keep this');
		});
	});

	it('refuses to replace directories even with force', () => {
		withProject((directory) => {
			mkdirSync(join(directory, 'my-cli.test.ts'));
			expect(() => scaffold({ name: 'my-cli', out: directory, force: true })).toThrow(
				/regular file/,
			);
			expect(existsSync(join(directory, 'my-cli.ts'))).toBe(false);
		});
	});
});
