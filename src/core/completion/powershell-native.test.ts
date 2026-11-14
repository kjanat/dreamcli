/** Native PowerShell completion must decode literal partial shell tokens. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { generatePowerShellCompletion } from './shells/powershell.ts';
import { quoteShellArg } from './shells/shared.ts';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const prerequisites = [
	...(process.platform === 'linux' && !('Deno' in globalThis) ? [] : ['Linux Node/Bun host']),
	...['pwsh', 'bun', 'bash'].filter((tool) => spawnSync(tool, ['--version']).status !== 0),
];
if (prerequisites.length > 0)
	console.warn(`Skipping native PowerShell completion: requires ${prerequisites.join(', ')}`);

describe.skipIf(prerequisites.length > 0)('native PowerShell completion', () => {
	it('preserves partial quotes, escaped literals, and preceding arguments', () => {
		const directory = mkdtempSync(join(tmpdir(), 'dreamcli-powershell-'));
		try {
			const source = new URL('../../index.ts', import.meta.url).href;
			const fixture = join(directory, 'fixture.ts');
			const capture = join(directory, 'argv');
			const script = join(directory, 'completion.ps1');
			const literals = [
				'widget',
				'space value',
				"quote'value",
				'quote"value',
				'dollar$value',
				'tick`value',
			];
			const app = cli('dcpsfixture').command(
				command('adopt')
					.flag('previous', flag.string())
					.flag(
						'name',
						flag.string().complete(() => literals),
					),
			);
			writeFileSync(
				join(directory, 'fixture-data.json'),
				JSON.stringify({ source, candidates: literals }),
			);
			writeFileSync(script, generatePowerShellCompletion(app.schema));
			writeFileSync(
				fixture,
				[
					"import settings from './fixture-data.json' with { type: 'json' };",
					'const { cli, command, flag } = await import(settings.source);',
					"await cli('dcpsfixture').command(command('adopt').flag('previous', flag.string()).flag('name', flag.string().complete(() => settings.candidates))).run();",
				].join('\n'),
			);
			writeFileSync(
				join(directory, 'dcpsfixture'),
				[
					'#!/usr/bin/env bash',
					`printf '%s\\0' "$@" > ${quoteShellArg(capture)}`,
					`exec bun ${quoteShellArg(fixture)} "$@"`,
				].join('\n'),
				{ mode: 0o700 },
			);
			const cases = [
				{
					suffix: '--name  --previous later',
					cursorBefore: ' --previous later',
					argv: ['--name', ''],
					value: literals,
				},
				{
					suffix: '--name wi --previous later',
					cursorBefore: ' --previous later',
					argv: ['--name', 'wi'],
					value: 'widget',
				},
				{ suffix: '--name "wi', argv: ['--name', 'wi'], value: 'widget' },
				{ suffix: "--name 'wi", argv: ['--name', 'wi'], value: 'widget' },
				{ suffix: '--name="wi', argv: ['--name=wi'], value: '--name=widget' },
				{ suffix: "--name='wi", argv: ['--name=wi'], value: '--name=widget' },
				{
					suffix: '--previous "space value" --name wi',
					argv: ['--previous', 'space value', '--name', 'wi'],
					value: 'widget',
				},
				{
					suffix: "--previous 'quote''value' --name wi",
					argv: ['--previous', "quote'value", '--name', 'wi'],
					value: 'widget',
				},
				{
					suffix: '--previous "dollar$value" --name wi',
					argv: ['--previous', 'dollar$value', '--name', 'wi'],
					value: 'widget',
				},
				{
					suffix: '--previous space` value --name wi',
					argv: ['--previous', 'space value', '--name', 'wi'],
					value: 'widget',
				},
				{ suffix: '--name "quote`"v', argv: ['--name', 'quote"v'], value: 'quote"value' },
				{ suffix: "--name 'quote''v", argv: ['--name', "quote'v"], value: "quote'value" },
				{ suffix: '--name dollar`$v', argv: ['--name', 'dollar$v'], value: 'dollar$value' },
				{ suffix: '--name tick``v', argv: ['--name', 'tick`v'], value: 'tick`value' },
				{
					suffix: '--previous "quote""value" --name wi',
					argv: ['--previous', 'quote"value', '--name', 'wi'],
					value: 'widget',
				},
				{
					suffix: '--previous "`$(Get-Date)" --name wi',
					argv: ['--previous', '$(Get-Date)', '--name', 'wi'],
					value: 'widget',
				},
				{
					suffix: '--previous "`u{1f600}" --name wi',
					argv: ['--previous', '😀', '--name', 'wi'],
					value: 'widget',
				},
			];
			for (const item of cases) {
				const line = `dcpsfixture adopt ${item.suffix}`;
				const cursor =
					'cursorBefore' in item ? line.indexOf(String(item.cursorBefore)) : line.length;
				const result = spawnSync(
					'pwsh',
					[
						'-NoProfile',
						'-NonInteractive',
						'-Command',
						[
							`$env:PATH = ${quote(directory)} + [IO.Path]::PathSeparator + $env:PATH`,
							`. ${quote(script)}`,
							`$line = ${quote(line)}`,
							`$result = [System.Management.Automation.CommandCompletion]::CompleteInput($line, ${cursor}, $null)`,
							'ConvertTo-Json -Compress -InputObject @($result.CompletionMatches | ForEach-Object { $_.ListItemText })',
						].join('\n'),
					],
					{ encoding: 'utf8', timeout: 10_000 },
				);
				expect(result.status, result.stderr).toBe(0);
				expect(readFileSync(capture, 'utf8').split('\0').slice(0, -1), line).toEqual([
					'__complete',
					'--',
					'adopt',
					...item.argv,
				]);
				expect(JSON.parse(result.stdout), line).toEqual(
					Array.isArray(item.value) ? item.value : [item.value],
				);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);
});
