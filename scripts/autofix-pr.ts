#!/usr/bin/env bun
/** Generate maintenance PR metadata from the checkout's actual changes. */

import { appendFileSync } from 'node:fs';

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
	const plugins = (source: string): string[] => {
		const config: unknown = Bun.TOML.parse(source);
		if (
			!config ||
			typeof config !== 'object' ||
			!('plugins' in config) ||
			!Array.isArray(config.plugins) ||
			!config.plugins.every((value) => typeof value === 'string')
		) {
			throw new Error('Expected a plugins array in kprint.toml');
		}
		return config.plugins;
	};
	const files = [
		...new Set(
			[
				...git('diff', '--name-only', '-z', 'HEAD').split('\0'),
				...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
			].filter(Boolean),
		),
	].sort();
	const result = describeChanges(
		plugins(git('show', 'HEAD:kprint.toml')),
		plugins(await Bun.file('kprint.toml').text()),
		files,
	);
	const output = process.env.GITHUB_OUTPUT;
	if (!output) throw new Error('GITHUB_OUTPUT is required');
	for (const [name, value] of Object.entries(result)) {
		const delimiter = `autofix_${crypto.randomUUID()}`;
		appendFileSync(output, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
	}
}
