/**
 * The Deno adapter and CLI under real `--allow-env` grants, in a child Deno process.
 *
 * In-process tests mock the namespace; only a real subprocess exercises the
 * production bootstrap under no grant, a scoped grant, and a full grant.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtimeUrl = new URL('../runtime.ts', import.meta.url).href;
const indexUrl = new URL('../index.ts', import.meta.url).href;

/** The Deno namespace when the tests themselves run under Deno. */
const hostDeno = 'Deno' in globalThis ? globalThis.Deno : undefined;

/** The `deno` executable: this process under Deno, otherwise the first on PATH. */
function findDeno(): string | undefined {
	if (hostDeno !== undefined) return hostDeno.execPath();
	const name = process.platform === 'win32' ? 'deno.exe' : 'deno';
	for (const dir of (process.env.PATH ?? '').split(delimiter)) {
		if (dir !== '' && existsSync(join(dir, name))) return join(dir, name);
	}
	return undefined;
}

const deno = findDeno();

/**
 * The variables ansispeck 0.4.2 reads while it loads. Granting them keeps the
 * CLI probes about the adapter until a release that reads only granted
 * variables lands.
 */
const COLOR_HINTS = 'FORCE_COLOR,NO_COLOR,CI,TERM,NO_HYPERLINKS,FORCE_HYPERLINKS';

interface ProbeResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * Spawn `command` with exactly `env`. Under Deno this goes through
 * `Deno.Command`, because `node:child_process` rewrites a spawn of Deno's
 * own executable into `deno run -A`, which would grant every permission.
 */
function spawnExact(
	command: string,
	args: readonly string[],
	env: Readonly<Record<string, string>>,
): ProbeResult {
	if (hostDeno !== undefined) {
		const output = new hostDeno.Command(command, {
			args: [...args],
			cwd: root,
			env: { ...env },
			clearEnv: true,
		}).outputSync();
		const decoder = new TextDecoder();
		return {
			code: output.code,
			stdout: decoder.decode(output.stdout),
			stderr: decoder.decode(output.stderr),
		};
	}
	const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env });
	return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Run `source` as a module under Deno with `permissions` and a fixed environment. */
function runDeno(source: string, permissions: readonly string[]): ProbeResult {
	const dir = mkdtempSync(join(tmpdir(), 'dreamcli-deno-'));
	try {
		const file = join(dir, 'probe.ts');
		writeFileSync(file, source);
		return spawnExact(
			deno ?? 'deno',
			[
				'run',
				'--config',
				join(root, 'deno.json'),
				'--no-lock',
				'--no-prompt',
				...permissions,
				file,
			],
			{
				PATH: process.env.PATH ?? '',
				...(process.env.DENO_DIR !== undefined ? { DENO_DIR: process.env.DENO_DIR } : {}),
				...(process.env.HOME !== undefined ? { HOME: process.env.HOME } : {}),
				NO_COLOR: '1',
				WASM_PATH: 'plugin.wasm',
				UNRELATED: 'do-not-read',
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const adapterProbe = `
import { createDenoAdapter } from ${JSON.stringify(runtimeUrl)};
const { env } = createDenoAdapter();
console.log(JSON.stringify({ wasm: env.WASM_PATH ?? null, unrelated: env.UNRELATED ?? null }));
`;

const cliProbe = `
import { cli, command, flag } from ${JSON.stringify(indexUrl)};
await cli('probe')
	.default(
		command('probe')
			.flag('wasmPath', flag.string().env('WASM_PATH').required())
			.action(({ flags, out }) => out.log('wasm=' + flags.wasmPath)),
	)
	.run();
`;

describe.skipIf(deno === undefined)('Deno env permissions (subprocess)', () => {
	it('creates the adapter without any env grant', () => {
		const result = runDeno(adapterProbe, []);
		expect(result.stderr).not.toContain('NotCapable');
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ wasm: null, unrelated: null });
	}, 60_000);

	it('reads exactly the granted variables under a scoped grant', () => {
		const result = runDeno(adapterProbe, ['--allow-env=WASM_PATH']);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ wasm: 'plugin.wasm', unrelated: null });
	}, 60_000);

	it('reads every variable under a full grant', () => {
		const result = runDeno(adapterProbe, ['--allow-env']);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ wasm: 'plugin.wasm', unrelated: 'do-not-read' });
	}, 60_000);

	it('resolves a declared .env() binding from a scoped grant', () => {
		const result = runDeno(cliProbe, [`--allow-env=${COLOR_HINTS},WASM_PATH`]);
		expect(result.stderr).toBe('');
		expect(result.code).toBe(0);
		expect(result.stdout).toBe('wasm=plugin.wasm\n');
	}, 60_000);

	it('names the missing grant without exposing the value', () => {
		const result = runDeno(cliProbe, [`--allow-env=${COLOR_HINTS}`]);
		expect(result.code).toBe(2);
		expect(result.stderr).toContain('run with --allow-env=WASM_PATH');
		expect(result.stderr).not.toContain('plugin.wasm');
	}, 60_000);
});
