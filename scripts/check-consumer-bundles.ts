#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { build } from 'esbuild';

const consumer = mkdtempSync(join(tmpdir(), 'dreamcli-consumer-'));
const budgets = { constant: 999, flags: 140_000, cli: 300_000, completions: 300_000 };
type Fixture = keyof typeof budgets;

// A flags-only app can use the parser, resolver, help and runtime adapters.
// All implementations of optional CLI features live outside these chunks.
function allowedFlagInput(path: string): boolean {
	return /^(?:core-[\w-]+|index|constants-[\w-]+)\.mjs$/.test(basename(path));
}

async function bundle(fixture: Fixture, bundler: 'bun' | 'esbuild', splitting: boolean) {
	const entry = `${fixture}.mjs`;
	const outdir = join(consumer, `${fixture}-${bundler}-${splitting ? 'split' : 'single'}`);
	const options = { outdir, format: 'esm', minify: true, splitting, metafile: true } as const;
	const { metafile } =
		bundler === 'bun'
			? await Bun.build({
					...options,
					entrypoints: [join(consumer, entry)],
					root: consumer,
					target: 'node',
				})
			: await build({
					...options,
					absWorkingDir: consumer,
					entryPoints: [entry],
					platform: 'node',
					bundle: true,
				});
	assert(metafile);
	assert(
		Object.keys(metafile.inputs).some((path) =>
			path.endsWith('node_modules/@kjanat/dreamcli/dist/index.mjs'),
		),
		'expected packed npm entry',
	);
	let total = 0;
	for (const [name, output] of Object.entries(metafile.outputs)) {
		total += statSync(join(outdir, basename(name))).size;
		const contributions: Record<string, { bytesInOutput: number }> = output.inputs;
		for (const [input, { bytesInOutput }] of Object.entries(contributions)) {
			if (!bytesInOutput || !input.includes('/@kjanat/dreamcli/')) continue;
			assert(input.includes('/dist/'), `unexpected source resolution: ${input}`);
			if (fixture === 'flags') {
				assert(allowedFlagInput(input), `flags retained ${bytesInOutput} bytes from ${input}`);
			}
			if (fixture === 'constant') {
				assert(/^constants-/.test(basename(input)), `constant retained ${input}`);
			}
		}
	}
	console.log(`${fixture} ${bundler} ${splitting ? 'split' : 'single'}: ${total} bytes`);
	assert(total <= budgets[fixture], `${total} exceeds ${fixture} budget of ${budgets[fixture]}`);
	return join(outdir, `${fixture}.js`);
}

function run(program: string, args: string[], status = 0) {
	const result = Bun.spawnSync(['node', program, ...args], { cwd: consumer });
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	assert.equal(result.exitCode, status, stderr.slice(-2000));
	return status === 0 ? stdout : stderr;
}

function verify(fixture: Fixture, program: string) {
	switch (fixture) {
		case 'constant':
			assert.equal(run(program, []), '1\n');
			break;
		case 'flags':
			assert.equal(run(program, ['--name', 'Ada']), 'Ada\n');
			assert.match(run(program, ['--help']), /--name/);
			assert.match(run(program, ['--unknown'], 1), /Unknown flag --unknown/);
			break;
		case 'cli':
			assert.equal(run(program, ['hello']), 'hello\n');
			assert.match(run(program, ['--help']), /hello/);
			assert.equal(JSON.parse(run(program, ['--help', '--json'])).name, 'app');
			break;
		case 'completions':
			assert.match(run(program, ['completions', 'bash']), /complete .*app/);
			break;
	}
}

try {
	const archive = join(consumer, 'dreamcli.tgz');
	await Bun.$`bun pm pack --ignore-scripts --filename ${archive}`.quiet();
	writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
	await Bun.$`bun add --ignore-scripts ./dreamcli.tgz`.cwd(consumer).quiet();
	cpSync(join(import.meta.dir, 'consumer-bundles'), consumer, { recursive: true });
	for (const fixture of ['constant', 'flags', 'cli', 'completions'] as const) {
		for (const bundler of ['bun', 'esbuild'] as const) {
			for (const splitting of [false, true]) {
				verify(fixture, await bundle(fixture, bundler, splitting));
			}
		}
	}
} finally {
	rmSync(consumer, { recursive: true, force: true });
}
