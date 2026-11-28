/** Initialize a standalone starter without touching a surrounding repository. @module */

import { spawnSync } from 'node:child_process';
import { env } from 'node:process';

export function initGit(cwd, files, version, revision) {
	const options = { cwd, encoding: 'utf8', env: { ...env, LC_ALL: 'C' } };
	const run = (...args) => spawnSync('git', args, options);
	const local = run('rev-parse', '--local-env-vars');
	if (local.status !== 0) return failure(local);
	for (const key of local.stdout.trim().split(/\s+/)) delete options.env[key];

	const repository = run('rev-parse', '--git-dir');
	if (repository.status === 0) return { skipped: 'existing-repository' };
	if (!repository.stderr?.includes('not a git repository')) return failure(repository);

	const message = ['-m', `Initialize with dreamcli create ${version}`];
	if (revision !== 'dev') message.push('-m', `DreamCLI-Revision: ${revision}`);
	for (const args of [
		['init', '--template='],
		['add', '--', ...files],
		['commit', ...message, '--', ...files],
	]) {
		const result = run(...args);
		if (result.status !== 0) return failure(result);
	}
	const head = run('rev-parse', 'HEAD');
	return head.status === 0 ? { commit: head.stdout.trim() } : failure(head);
}

function failure(result) {
	return { error: result.stderr?.trim() || result.error?.message || 'Git exited unsuccessfully.' };
}
