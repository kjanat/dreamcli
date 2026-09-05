#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Scenario {
	readonly name: string;
	readonly argv: readonly string[];
	readonly exactly?: readonly string[];
	readonly loads?: readonly string[];
	readonly never: readonly string[];
}

const FEATURE_CHUNKS = [
	'completion',
	'json-schema',
	'config',
	'package-json',
	'terminal',
	'test-prompter',
];

function never(...loaded: readonly string[]): string[] {
	return FEATURE_CHUNKS.filter((chunk) => !loaded.includes(chunk));
}

const SCENARIOS: readonly Scenario[] = [
	{ name: 'plain', argv: ['deploy', '--region', 'eu'], exactly: ['index', 'core'], never: never() },
	{
		name: 'help-json',
		argv: ['--help', '--json'],
		loads: ['json-schema'],
		never: never('json-schema'),
	},
	{
		name: 'completions-command',
		argv: ['completions', 'bash'],
		loads: ['completion'],
		never: never('completion'),
	},
	{
		name: 'completions-flag',
		argv: ['--completions', 'zsh'],
		loads: ['completion'],
		never: never('completion'),
	},
	{ name: 'config', argv: ['deploy', '--region', 'eu'], loads: ['config'], never: never('config') },
	{
		name: 'manifest',
		argv: ['deploy', '--region', 'eu'],
		loads: ['package-json'],
		never: never('package-json'),
	},
	{ name: 'manifest-data', argv: ['deploy', '--region', 'eu'], never: never() },
	{ name: 'tty-no-prompt', argv: ['deploy', '--region', 'eu'], never: never() },
	{ name: 'tty-prompt', argv: ['deploy'], loads: ['terminal'], never: never('terminal') },
	{ name: 'answers', argv: [], loads: ['test-prompter'], never: never('test-prompter') },
];

function chunkName(url: string): string {
	const file = basename(new URL(url).pathname);
	return file.replace(/(-[A-Za-z0-9_-]{8})?\.mjs$/, '');
}

function trace(scenario: Scenario, traceDir: string): Set<string> {
	const traceFile = join(traceDir, `${scenario.name}.txt`);
	const result = Bun.spawnSync(['node', 'scripts/lazy-loading/fixture.mjs', ...scenario.argv], {
		env: {
			...process.env,
			DREAMCLI_SCENARIO: scenario.name,
			DREAMCLI_TRACE: traceFile,
			DREAMCLI_DIST: `${pathToFileURL(resolve('dist')).href}/`,
		},
		stdout: 'pipe',
		stderr: 'pipe',
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`${scenario.name}: fixture exited with ${result.exitCode}\n${result.stderr.toString()}`,
		);
	}
	const lines = readFileSync(traceFile, 'utf8')
		.split('\n')
		.filter((line) => line !== '');
	return new Set(lines.map(chunkName));
}

function main(): number {
	const traceDir = mkdtempSync(join(tmpdir(), 'dreamcli-lazy-'));
	const violations: string[] = [];
	try {
		for (const scenario of SCENARIOS) {
			const loaded = trace(scenario, traceDir);
			const listed = [...loaded].sort().join(', ');
			console.log(`${scenario.name.padEnd(20)} ${listed}`);
			if (scenario.exactly !== undefined) {
				const expected = [...scenario.exactly].sort().join(', ');
				if (listed !== expected) {
					violations.push(`${scenario.name}: loaded [${listed}], expected exactly [${expected}]`);
				}
			}
			for (const chunk of scenario.loads ?? []) {
				if (!loaded.has(chunk)) violations.push(`${scenario.name}: did not load ${chunk}`);
			}
			for (const chunk of scenario.never) {
				if (loaded.has(chunk)) violations.push(`${scenario.name}: loaded ${chunk}`);
			}
		}
	} finally {
		rmSync(traceDir, { recursive: true, force: true });
	}
	for (const violation of violations) console.error(`lazy: ${violation}`);
	return violations.length === 0 ? 0 : 1;
}

process.exitCode = main();
