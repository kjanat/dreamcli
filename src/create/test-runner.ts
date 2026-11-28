/** Select the starter test template for the destination project. @module */

import type { Dirent } from 'node:fs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cwd } from 'node:process';

const manifests = ['package.json', 'package.json5', 'package.yaml', 'package.yml'];
const lockfiles = [
	'bun.lock',
	'bun.lockb',
	'pnpm-lock.yaml',
	'pnpm-lock.yml',
	'pnpm-workspace.yaml',
	'pnpm-workspace.yml',
	'yarn.lock',
	'package-lock.json',
	'npm-shrinkwrap.json',
];

function readOptional(path: string): string {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR' || code === 'EACCES')
			return '';
		throw error;
	}
}

function projectLocks(directory: string): string[] {
	let names: Dirent[];
	try {
		names = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') return [];
		throw error;
	}
	return [
		...lockfiles.filter((name) =>
			names.some((entry) => !entry.isDirectory() && entry.name === name),
		),
		...names
			.filter(
				(entry) =>
					!entry.isDirectory() &&
					/^pnpm-.*\.ya?ml$/.test(entry.name) &&
					!lockfiles.includes(entry.name),
			)
			.map((entry) => entry.name)
			.sort(),
	];
}

function detectProject(start: string): 'bun:test' | 'vitest' | undefined {
	let hasProject = false;
	let hasVitest = false;
	for (let directory = start; ; directory = dirname(directory)) {
		const manifestPaths = manifests.map((name) => join(directory, name)).filter(existsSync);
		const locks = projectLocks(directory);
		const contents = manifestPaths.map(readOptional);
		hasProject ||= contents.length > 0 || locks.length > 0;
		hasVitest ||=
			contents.some((content) => /\bvitest\b/.test(content)) ||
			existsSync(join(directory, 'node_modules', 'vitest', 'package.json'));

		const declared = contents
			.map(
				(content) =>
					/(?:^|[,{\n])\s*["']?packageManager["']?\s*:\s*["']?(bun|npm|pnpm|yarn)(?=[@\s"',}#]|$)/.exec(
						content,
					)?.[1],
			)
			.find((manager) => manager !== undefined);
		const lock = locks[0];
		if (declared !== undefined || lock !== undefined) {
			const isBun = declared === undefined ? lock?.startsWith('bun.') : declared === 'bun';
			if (!isBun) return 'vitest';
			hasVitest ||= locks.some((filename) =>
				/\bvitest\b/.test(readOptional(join(directory, filename))),
			);
			return hasVitest ? 'vitest' : 'bun:test';
		}
		if (dirname(directory) === directory) return hasProject ? 'vitest' : undefined;
	}
}

export function detectTestRunner(directory: string): 'bun:test' | 'vitest' {
	return detectProject(directory) ?? detectProject(cwd()) ?? 'vitest';
}
