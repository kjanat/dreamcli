/** Verify creation of the initial Git commit. @module */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(spawnSync('git', ['--version']).status !== 0)(
	'commits only the starter files with generator provenance and skips an existing repository',
	() => {
		const root = mkdtempSync(join(tmpdir(), 'dreamcli-git-'));
		try {
			const config = join(root, 'gitconfig');
			writeFileSync(config, '[user]\n\tname = DreamCLI Test\n\temail = dreamcli@example.invalid\n');
			const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
			const git = (cwd: string, ...args: string[]) =>
				execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
			const init = (cwd: string, extraEnv = {}) =>
				JSON.parse(
					execFileSync(
						process.execPath,
						[
							'-e',
							`import { initGit } from ${JSON.stringify(new URL('../../bin/git.mjs', import.meta.url).href)}; console.log(JSON.stringify(initGit(process.cwd(), ['starter.ts'], '5.7.0', 'abc1234')));`,
						],
						{ cwd, env: { ...env, ...extraEnv }, encoding: 'utf8' },
					),
				);

			const unrelated = join(root, 'unrelated');
			mkdirSync(unrelated);
			git(unrelated, 'init');
			const project = join(root, 'project');
			mkdirSync(project);
			writeFileSync(join(project, 'starter.ts'), 'export {};\n');
			writeFileSync(join(project, 'untracked.txt'), 'leave untracked\n');
			const result = init(project, { GIT_DIR: join(unrelated, '.git') });
			expect(result).toEqual({ commit: git(project, 'rev-parse', 'HEAD') });
			expect(git(project, 'log', '-1', '--format=%B')).toBe(
				'Initialize with dreamcli create 5.7.0\n\nDreamCLI-Revision: abc1234',
			);
			expect(git(project, 'ls-tree', '--name-only', 'HEAD')).toBe('starter.ts');
			expect(git(unrelated, 'rev-list', '--all', '--count')).toBe('0');

			const nested = join(project, 'nested');
			mkdirSync(nested);
			expect(init(nested)).toEqual({ skipped: 'existing-repository' });
			expect(existsSync(join(nested, '.git'))).toBe(false);
			expect(git(project, 'rev-list', '--count', 'HEAD')).toBe('1');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);
