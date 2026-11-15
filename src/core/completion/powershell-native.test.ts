/** Native PowerShell completion must decode literal partial shell tokens. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
			const inputs = cases.map((item) => {
				const line = `dcpsfixture adopt ${item.suffix}`;
				const cursor =
					'cursorBefore' in item ? line.indexOf(String(item.cursorBefore)) : line.length;
				return { line, cursor };
			});
			const inputFile = join(directory, 'cases.json');
			writeFileSync(inputFile, JSON.stringify(inputs));
			const result = spawnSync(
				'pwsh',
				[
					'-NoProfile',
					'-NonInteractive',
					'-Command',
					[
						"$ErrorActionPreference = 'Stop'",
						`$env:PATH = ${quote(directory)} + [IO.Path]::PathSeparator + $env:PATH`,
						`. ${quote(script)}`,
						`$cases = Get-Content -Raw -LiteralPath ${quote(inputFile)} | ConvertFrom-Json`,
						'$results = @(foreach ($case in $cases) {',
						`  if (Test-Path -LiteralPath ${quote(capture)}) { Remove-Item -LiteralPath ${quote(capture)} }`,
						'  $completion = [System.Management.Automation.CommandCompletion]::CompleteInput($case.line, $case.cursor, $null)',
						`  $captured = [IO.File]::ReadAllText(${quote(capture)})`,
						'  [pscustomobject]@{',
						'    argv = @($captured.Substring(0, $captured.Length - 1).Split([char]0))',
						'    values = @($completion.CompletionMatches | ForEach-Object { $_.ListItemText })',
						'  }',
						'})',
						'ConvertTo-Json -Compress -Depth 5 -InputObject $results',
					].join('\n'),
				],
				{ encoding: 'utf8', timeout: 20_000 },
			);
			expect(result.status, result.error?.message ?? result.stderr).toBe(0);
			const results = JSON.parse(result.stdout);
			expect(results).toHaveLength(cases.length);
			for (const [index, item] of cases.entries()) {
				expect(results[index], inputs[index]?.line).toEqual({
					argv: ['__complete', '--', 'adopt', ...item.argv],
					values: Array.isArray(item.value) ? item.value : [item.value],
				});
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);
});
