import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeChanges } from './autofix-pr.ts';

describe('maintenance PR metadata', () => {
	it('does not propose changes on a clean checkout', () => {
		const plugins = ['npm:@dprint/biome@0.15.7'];
		expect(describeChanges(plugins, plugins, [])).toEqual({ changed: false, title: '', body: '' });
	});

	it('lists version updates, additions, removals, and changed paths', () => {
		const before = ['npm:@dprint/biome@0.15.6', 'npm:old-plugin@1.0.0'];
		const after = ['npm:@dprint/biome@0.15.7', 'npm:new-plugin@2.0.0'];
		expect(describeChanges(before, after, ['docs/a page.md', 'kprint.toml'])).toEqual({
			changed: true,
			title: 'chore(deps): update @dprint/biome 0.15.7, new-plugin 2.0.0',
			body: [
				'Formatter changes:',
				'',
				'- `npm:@dprint/biome@0.15.6` → `npm:@dprint/biome@0.15.7`',
				'- Added `npm:new-plugin@2.0.0`',
				'- Removed `npm:old-plugin@1.0.0`',
				'',
				'Changed files:',
				'',
				'- `docs/a page.md`',
				'- `kprint.toml`',
			].join('\n'),
		});
	});

	it('uses the affected path for a file-only fix', () => {
		expect(describeChanges([], [], ['docs/a page.md'])).toEqual({
			changed: true,
			title: 'style: apply formatting and lint fixes to docs/a page.md',
			body: 'Changed file:\n\n- `docs/a page.md`',
		});
	});

	it('writes multiline GitHub outputs from a clean and then a changed Git checkout', () => {
		const directory = mkdtempSync(join(tmpdir(), 'dreamcli-autofix-'));
		try {
			const cwd = join(directory, 'checkout');
			const output = join(directory, 'outputs');
			mkdirSync(cwd);
			const git = (...args: string[]) => execFileSync('git', args, { cwd });
			git('init', '--quiet', '--template=');
			const nested = join(cwd, 'tooling');
			mkdirSync(nested);
			writeFileSync(
				join(nested, '.kprint.jsonc'),
				'{\n// pins\n"plugins":["npm:formatter@1.0.0",],\n}',
			);
			writeFileSync(join(cwd, 'deleted.md'), 'old');
			git('add', '.');
			git(
				'-c',
				'user.name=Test',
				'-c',
				'user.email=test@example.test',
				'commit',
				'--no-gpg-sign',
				'-qm',
				'Base',
			);
			const script = fileURLToPath(new URL('./autofix-pr.ts', import.meta.url));
			const generate = () => {
				writeFileSync(output, '');
				execFileSync('bun', [script], { cwd, env: { ...process.env, GITHUB_OUTPUT: output } });
				return readFileSync(output, 'utf8');
			};
			expect(generate()).toMatch(/^changed<<(\S+)\nfalse\n\1\n/u);

			rmSync(join(nested, '.kprint.jsonc'));
			expect(generate()).toContain('- Removed `npm:formatter@1.0.0`');
			writeFileSync(join(nested, 'kprint.toml'), 'plugins = ["npm:formatter@2.0.0"]\n');
			rmSync(join(cwd, 'deleted.md'));
			writeFileSync(join(cwd, 'new file.md'), 'new');
			const result = generate();
			expect(result).toMatch(/^changed<<(\S+)\ntrue\n\1\n/u);
			expect(result).toMatch(/^title<<(\S+)\nchore\(deps\): update formatter 2\.0\.0\n\1$/mu);
			expect(result).toMatch(/^body<<(\S+)\n([\s\S]*)\n\1\n$/mu);
			expect(result).toContain('- `npm:formatter@1.0.0` → `npm:formatter@2.0.0`');
			expect(result).toContain(
				'- `deleted.md`\n- `new file.md`\n- `tooling/.kprint.jsonc`\n- `tooling/kprint.toml`',
			);

			git('add', '-A');
			expect(generate()).toContain('- `npm:formatter@1.0.0` → `npm:formatter@2.0.0`');

			git('restore', '--staged', '--worktree', '--', '.');
			writeFileSync(join(cwd, 'deleted.md'), 'formatted');
			expect(generate()).toContain('style: apply formatting and lint fixes to deleted.md');
			writeFileSync(join(nested, 'dprint.json'), '{"plugins":["npm:new-plugin@2.0.0"]}');
			expect(generate()).toContain('- Added `npm:new-plugin@2.0.0`');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
