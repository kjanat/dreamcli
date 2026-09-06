#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Scenario {
	readonly name: string;
	readonly argv: readonly string[];
	readonly exactly: readonly string[];
}

const HOT_PATH = ['index', 'core'];
// Dynamic feature chunks also import Rolldown's shared interop helpers.
const FEATURE_BASE = [...HOT_PATH, 'rolldown-runtime'];

const SCENARIOS: readonly Scenario[] = [
	{ name: 'plain', argv: ['deploy', '--region', 'eu'], exactly: HOT_PATH },
	{
		name: 'help-json',
		argv: ['--help', '--json'],
		exactly: [...FEATURE_BASE, 'json-schema'],
	},
	{
		name: 'completions-command',
		argv: ['completions', 'bash'],
		exactly: [...FEATURE_BASE, 'completion', 'version'],
	},
	{
		name: 'completions-flag',
		argv: ['--completions', 'zsh'],
		exactly: [...FEATURE_BASE, 'completion', 'version'],
	},
	{ name: 'config', argv: ['deploy', '--region', 'eu'], exactly: [...FEATURE_BASE, 'config'] },
	{
		name: 'manifest',
		argv: ['deploy', '--region', 'eu'],
		exactly: [...FEATURE_BASE, 'package-json'],
	},
	{ name: 'manifest-data', argv: ['deploy', '--region', 'eu'], exactly: HOT_PATH },
	{ name: 'tty-no-prompt', argv: ['deploy', '--region', 'eu'], exactly: HOT_PATH },
	{ name: 'tty-prompt', argv: ['deploy'], exactly: [...FEATURE_BASE, 'terminal'] },
	{ name: 'answers', argv: [], exactly: [...FEATURE_BASE, 'test-prompter'] },
];

function chunkName(url: string): string {
	const file = basename(new URL(url).pathname);
	return file.replace(/(-[A-Za-z0-9_-]{8})?\.mjs$/, '');
}

function trace(scenario: Scenario, traceDir: string): readonly string[] {
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
	// Deduplicate URLs before stripping hashes, so two distinct modules with
	// the same logical name still count twice in the exact comparison.
	return [...new Set(lines)].map(chunkName);
}

function main(): number {
	const traceDir = mkdtempSync(join(tmpdir(), 'dreamcli-lazy-'));
	const violations: string[] = [];
	try {
		for (const scenario of SCENARIOS) {
			const loaded = trace(scenario, traceDir);
			const listed = [...loaded].sort().join(', ');
			console.log(`${scenario.name.padEnd(20)} ${listed}`);
			const expected = [...scenario.exactly].sort().join(', ');
			if (listed !== expected) {
				violations.push(`${scenario.name}: loaded [${listed}], expected exactly [${expected}]`);
			}
		}
	} finally {
		rmSync(traceDir, { recursive: true, force: true });
	}
	for (const violation of violations) console.error(`lazy: ${violation}`);
	return violations.length === 0 ? 0 : 1;
}

process.exitCode = main();
