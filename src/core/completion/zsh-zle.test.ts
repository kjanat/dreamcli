/** Zsh must forward decoded arguments before the cursor and insert whole values. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { quoteShellArg } from './shells/shared.ts';
import { generateZshCompletion } from './shells/zsh.ts';
import { runTerminalCases } from './terminal-test-helpers.ts';

const cases = [
	{
		line: 'dczfixture adopt --name wiget',
		back: 3,
		prefix: 'wi',
		argv: ['adopt', '--name', 'widget'],
	},
	{
		line: 'dczfixture adopt --name=wiget',
		back: 3,
		prefix: '--name=wi',
		argv: ['adopt', '--name=widget'],
	},
	{
		line: 'dczfixture adopt --name="wi"',
		back: 1,
		prefix: '--name=wi',
		argv: ['adopt', '--name=widget'],
	},
	{ line: 'dczfixture adopt --name "wi', prefix: 'wi', argv: ['adopt', '--name', 'widget'] },
	{ line: "dczfixture adopt --name 'wi", prefix: 'wi', argv: ['adopt', '--name', 'widget'] },
	{ line: 'dczfixture adopt --name="wi', prefix: '--name=wi', argv: ['adopt', '--name=widget'] },
	{ line: "dczfixture adopt --name='wi", prefix: '--name=wi', argv: ['adopt', '--name=widget'] },
	{
		line: 'dczfixture adopt --profile "a b" --name wi',
		prefix: 'wi',
		argv: ['adopt', '--profile', 'a b', '--name', 'widget'],
	},
	{
		line: "dczfixture adopt --profile 'a b' --name wi",
		prefix: 'wi',
		argv: ['adopt', '--profile', 'a b', '--name', 'widget'],
	},
	{
		line: 'dczfixture adopt --profile a\\ b --name wi',
		prefix: 'wi',
		argv: ['adopt', '--profile', 'a b', '--name', 'widget'],
	},
	{ line: 'dczfixture adopt --name sp\\ v', prefix: 'sp v', argv: ['adopt', '--name', 'sp value'] },
	{
		line: "dczfixture adopt --name 'back\\s",
		prefix: 'back\\s',
		argv: ['adopt', '--name', 'back\\slash'],
	},
	{
		line: 'dczfixture adopt --name "back\\s',
		prefix: 'back\\s',
		argv: ['adopt', '--name', 'back\\slash'],
	},
	{
		line: "dczfixture adopt --name='back\\s",
		prefix: '--name=back\\s',
		argv: ['adopt', '--name=back\\slash'],
	},
	{
		line: "dczfixture adopt --profile '$(false)' --name wi",
		prefix: 'wi',
		argv: ['adopt', '--profile', '$(false)', '--name', 'widget'],
	},
	{
		line: 'dczfixture adopt --profile "" --name wi',
		prefix: 'wi',
		argv: ['adopt', '--profile', '', '--name', 'widget'],
	},
];

const prerequisites = [
	...(process.platform === 'linux' && !('Deno' in globalThis) ? [] : ['Linux Node/Bun host']),
	...['zsh', 'bun'].filter((tool) => spawnSync(tool, ['--version']).status !== 0),
];
if (prerequisites.length > 0)
	console.warn(`Skipping Zsh ZLE test: requires ${prerequisites.join(', ')}`);

describe.skipIf(prerequisites.length > 0)('Zsh interactive completion', () => {
	it('decodes shell words and completes at the cursor with COMPLETE_IN_WORD', () => {
		const directory = mkdtempSync(join(tmpdir(), 'dreamcli-zsh-'));
		try {
			const source = new URL('../../index.ts', import.meta.url).href;
			const fixture = join(directory, 'fixture.ts');
			const capture = join(directory, 'argv');
			const completionCapture = join(directory, 'completion-argv');
			const script = join(directory, 'completion.zsh');
			const values = ['widget', 'sp value', 'back\\slash'];
			const app = cli('dczfixture').command(
				command('adopt')
					.flag('profile', flag.string())
					.flag(
						'name',
						flag.string().complete(() => values),
					),
			);
			writeFileSync(
				join(directory, 'fixture-data.json'),
				JSON.stringify({ source, candidates: values }),
			);
			writeFileSync(script, generateZshCompletion(app.schema));
			writeFileSync(
				fixture,
				[
					"import settings from './fixture-data.json' with { type: 'json' };",
					'const { cli, command, flag } = await import(settings.source);',
					"await cli('dczfixture').command(command('adopt').flag('profile', flag.string())",
					".flag('name', flag.string().complete(() => settings.candidates))).run();",
				].join('\n'),
			);
			writeFileSync(
				join(directory, 'dczfixture'),
				[
					'#!/usr/bin/env bash',
					// biome-ignore lint/suspicious/noTemplateCurlyInString: bash positional parameter
					'if [[ "${1-}" == __complete ]]; then',
					`  printf '%s\\0' "\${@:2}" > ${quoteShellArg(completionCapture)}`,
					`  exec bun ${quoteShellArg(fixture)} "$@"`,
					'fi',
					`printf '%s\\0' "$@" > ${quoteShellArg(capture)}`,
				].join('\n'),
				{ mode: 0o700 },
			);
			const actual = runTerminalCases({
				shell: 'zsh',
				setup: `export PATH=${quoteShellArg(directory)}:$PATH; autoload -Uz compinit; compinit -D -i; setopt COMPLETE_IN_WORD; bindkey -e; bindkey '^I' complete-word; source ${quoteShellArg(script)}`,
				capture,
				completionCapture,
				cases,
			});
			expect(actual).toHaveLength(cases.length);
			for (const [index, value] of actual.entries()) {
				const testCase = cases[index];
				expect(value.argv, value.transcript).toEqual(testCase?.argv);
				expect(value.completionArgv, value.transcript).toEqual([
					'--',
					...value.argv.slice(0, -1),
					testCase?.prefix,
				]);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 120_000);
});
