#!/usr/bin/env bun
/** Generate maintenance PR metadata from the checkout's actual changes. */

import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';

function plugins(path: string, source: string): string[] {
	const config: unknown = path.endsWith('.toml') ? Bun.TOML.parse(source) : Bun.JSONC.parse(source);
	if (config && typeof config === 'object' && !Array.isArray(config)) {
		if (!('plugins' in config)) return [];
		if (
			Array.isArray(config.plugins) &&
			config.plugins.every((value) => typeof value === 'string')
		) {
			return config.plugins;
		}
	}
	throw new Error(`Expected a formatter configuration with an optional plugins array in ${path}`);
}

function pluginName(reference: string): string {
	return reference.match(/^npm:((?:@[^/]+\/)?[^@]+)@/)?.[1] ?? reference.replace(/-v?\d[^/]*$/, '');
}

function pluginLabel(reference: string): string {
	const npm = reference.match(/^npm:((?:@[^/]+\/)?[^@]+)@([^/]+)/);
	if (npm) return `${npm[1]} ${npm[2]}`;
	return reference.split('/').at(-1) ?? reference;
}

export function describeChanges(before: string[], after: string[], files: string[]) {
	if (!files.length) return { changed: false, title: '', body: '' };
	const removed = before.filter((reference) => !after.includes(reference));
	const added = after.filter((reference) => !before.includes(reference));
	const updates = added.map((reference) => {
		const previous = removed.find((old) => pluginName(old) === pluginName(reference));
		return previous ? `- \`${previous}\` → \`${reference}\`` : `- Added \`${reference}\``;
	});
	updates.push(
		...removed
			.filter((old) => !added.some((reference) => pluginName(old) === pluginName(reference)))
			.map((reference) => `- Removed \`${reference}\``),
	);
	const targets = added.map(pluginLabel);
	const scope = files.length === 1 ? files[0] : `${files.length} files`;
	const title = targets.length
		? `chore(deps): update ${targets.slice(0, 2).join(', ')}${targets.length > 2 ? ` and ${targets.length - 2} more` : ''}`
		: removed.length
			? `chore(deps): remove ${removed.map(pluginLabel).join(', ')}`
			: `style: apply formatting and lint fixes to ${scope}`;
	const body = [
		...(updates.length ? ['Formatter changes:', '', ...updates, ''] : []),
		`Changed ${files.length === 1 ? 'file' : 'files'}:`,
		'',
		...files.map((file) => `- \`${file}\``),
	].join('\n');
	return { changed: true, title, body };
}

if (import.meta.main) {
	const git = (...args: string[]) => {
		const result = Bun.spawnSync(['git', ...args]);
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString();
	};
	const files = [
		...new Set(
			[
				...git('diff', '--no-renames', '--name-only', '-z', 'HEAD').split('\0'),
				...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
			].filter(Boolean),
		),
	].sort();
	const configs = files.filter((path) =>
		/^\.?(?:kprint|dprint)\.(?:toml|jsonc?)$/.test(basename(path)),
	);
	const before = new Set<string>();
	const after = new Set<string>();
	if (configs.length) {
		const tracked = git('ls-tree', '-rz', '--name-only', 'HEAD', '--', ...configs).split('\0');
		for (const path of configs) {
			if (tracked.includes(path)) {
				for (const reference of plugins(path, git('show', `HEAD:${path}`))) before.add(reference);
			}
			const file = Bun.file(path);
			if (await file.exists()) {
				for (const reference of plugins(path, await file.text())) after.add(reference);
			}
		}
	}
	const result = describeChanges([...before], [...after], files);
	const output = process.env.GITHUB_OUTPUT;
	if (!output) throw new Error('GITHUB_OUTPUT is required');
	for (const [name, value] of Object.entries(result)) {
		const delimiter = `autofix_${crypto.randomUUID()}`;
		appendFileSync(output, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
	}
}
