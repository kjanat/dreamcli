/** Verify starter generation and destination safeguards. @module */

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
	it('creates a single-command starter under a nested destination in a Bun project', () => {
		withProject((directory) => {
			writeFileSync(join(directory, 'bun.lock'), '{}');
			const out = join(directory, 'src', 'cli');
			const result = scaffold({ name: ' My CLI! ', out });

			expect(result).toEqual({
				name: 'my-cli',
				entry: join(out, 'my-cli.ts'),
				test: join(out, 'my-cli.test.ts'),
				testRunner: 'bun:test',
			});
			expect(readFileSync(result.entry, 'utf8')).toContain("cli('my-cli').default(hello)");
			expect(readFileSync(join(out, 'my-cli.test.ts'), 'utf8')).toContain("from 'bun:test'");
		});
	});

	it('uses Vitest for a multi-command starter when declared in a Bun workspace', () => {
		withProject((directory) => {
			writeFileSync(
				join(directory, 'package.json'),
				JSON.stringify({ packageManager: 'bun@1.4.5', devDependencies: { vitest: '^5.0.0' } }),
			);
			const result = scaffold({ name: 'my-cli', mode: 'multi', out: directory });

			expect(result.testRunner).toBe('vitest');
			expect(readFileSync(result.entry, 'utf8')).toContain("group('party')");
			const test = readFileSync(join(directory, 'my-cli.test.ts'), 'utf8');
			expect(test).toContain("from 'vitest'");
			expect(test).toContain("import { partyStart } from './my-cli.ts'");
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
			expect(result).toEqual({ name: 'my-cli', entry });
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
