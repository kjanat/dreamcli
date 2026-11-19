import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createAdapter, createTestAdapter, ExitError } from '#internals/runtime/index.ts';
import { configModule, discoverConfig } from './index.ts';

async function runNativeProbe(probe: string): Promise<string> {
	if (typeof Deno === 'undefined') {
		return execFileSync(process.execPath, [probe], {
			encoding: 'utf8',
			timeout: 15_000,
			killSignal: 'SIGKILL',
		});
	}
	const output = await new Deno.Command(Deno.execPath(), {
		signal: AbortSignal.timeout(15_000),
		args: [
			'run',
			'-A',
			'--quiet',
			'--no-lock',
			'--config',
			fileURLToPath(new URL('../../../deno.json', import.meta.url)),
			probe,
		],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	const decoder = new TextDecoder();
	if (!output.success) throw new Error(decoder.decode(output.stderr));
	return decoder.decode(output.stdout);
}

describe('executable config', () => {
	it.each([
		['mjs', 'export default { port: 3000 };'],
		['cjs', 'module.exports = { port: 3000 };'],
		['js', 'export default { port: 3000 };'],
		['mts', 'const port: number = 3000; export default { port };'],
		['cts', 'const port: number = 3000; module.exports = { port };'],
		['ts', 'const port: number = 3000; export default { port };'],
	])('loads a .%s module via the native adapter', async (extension, source) => {
		const directory = await mkdtemp(join(tmpdir(), 'dreamcli-config-'));
		try {
			const path = join(directory, `app # config.${extension}`);
			const probe = join(directory, 'probe.mts');
			await writeFile(join(directory, 'package.json'), '{"type":"module"}');
			await writeFile(path, source);
			// Exercise native import resolution without Vitest's module runner.
			await writeFile(
				probe,
				`
import { configModule, discoverConfig } from ${JSON.stringify(new URL('../../config.ts', import.meta.url).href)};
import { createAdapter } from ${JSON.stringify(new URL('../../runtime.ts', import.meta.url).href)};
for (const fresh of [false, true]) {
const config = await discoverConfig('app', createAdapter(), {
  configPath: ${JSON.stringify(path)},
  loaders: [configModule({ typescript: true, fresh })],
});
console.log(JSON.stringify(config));
}
`,
			);
			const output = await runNativeProbe(probe);
			const expected = {
				found: true,
				path,
				data: { port: 3000 },
				format: extension,
			};
			expect(
				output
					.trim()
					.split('\n')
					.map((line) => JSON.parse(line)),
			).toEqual([expected, expected]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('loads an existing path without opening it through the text reader', async () => {
		const path = '/project/app.config.custom';
		const adapter = createTestAdapter({
			configFileExists: async (candidate) => candidate === path,
			readFile: async () => {
				throw new Error('unexpected read');
			},
		});
		await expect(
			discoverConfig('app', adapter, {
				configPath: path,
				loaders: [{ extensions: ['custom'], load: async (file) => ({ file }) }],
			}),
		).resolves.toEqual({ found: true, path, data: { file: path }, format: 'custom' });
	});

	it('isolates fresh loads across edits, failed imports and mutations', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dreamcli-config-'));
		try {
			const path = join(directory, 'app.mjs');
			const dep = join(directory, 'shared.mjs');
			const probe = join(directory, 'probe.mts');
			await writeFile(dep, 'export const port = 1;');
			const source = "import { port } from './shared.mjs'; export default { nested: { port } };";
			await writeFile(path, source);
			await writeFile(
				probe,
				`
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { configModule, discoverConfig } from ${JSON.stringify(new URL('../../config.ts', import.meta.url).href)};
import { createAdapter } from ${JSON.stringify(new URL('../../runtime.ts', import.meta.url).href)};
const adapter = createAdapter();
const path = ${JSON.stringify(path)};
const load = async (fresh) => (await discoverConfig('app', adapter, {
  configPath: path, loaders: [configModule({ fresh })],
})).data;
const cached = await load(false);
const first = await load(true);
first.nested.port = 99;
assert.equal((await load(true)).nested.port, 1);
await writeFile(${JSON.stringify(dep)}, 'export const port = 2;');
assert.equal((await load(true)).nested.port, 2);
await writeFile(path, 'throw new Error("bad config");');
await assert.rejects(load(true), { code: 'CONFIG_PARSE_ERROR' });
await writeFile(path, 'export default { port: 3 };');
assert.deepEqual(await load(true), { port: 3 });
assert.equal(await load(false), cached);
assert.equal(cached.nested.port, 1);
await writeFile(path, 'export default { callback() {} };');
await assert.rejects(load(true), { code: 'CONFIG_PARSE_ERROR' });
console.log('ok');
`,
			);
			expect((await runNativeProbe(probe)).trim()).toBe('ok');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('separates worker messages from exports and terminates stalled loads', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dreamcli-config-'));
		try {
			const configPath = join(directory, 'app.mjs');
			const probe = join(directory, 'probe.mts');
			await writeFile(
				configPath,
				`
import { parentPort } from 'node:worker_threads';
parentPort.postMessage({ status: 'loading' });
setInterval(() => {}, 60000);
export default { port: 1 };
`,
			);
			await writeFile(
				probe,
				`
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { configModule, discoverConfig } from ${JSON.stringify(new URL('../../config.ts', import.meta.url).href)};
import { createAdapter } from ${JSON.stringify(new URL('../../runtime.ts', import.meta.url).href)};
const configPath = ${JSON.stringify(configPath)};
const adapter = createAdapter();
const load = async (timeoutMs) => (await discoverConfig('app', adapter, {
  configPath, loaders: [configModule({ fresh: true, timeoutMs })],
})).data;
assert.deepEqual(await load(5000), { port: 1 });
await writeFile(configPath, 'setInterval(() => {}, 60000); await new Promise(() => {}); export default {};');
await assert.rejects(load(250), {
  code: 'CONFIG_PARSE_ERROR',
  details: { path: configPath, format: 'mjs', message: 'Config worker timed out after 250 ms' },
});
await writeFile(configPath, 'export default { port: 2 };');
assert.deepEqual(await load(5000), { port: 2 });
console.log('ok');
`,
			);
			expect((await runNativeProbe(probe)).trim()).toBe('ok');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 20_000);

	it('opts into discovery via the CLI and retains JSON precedence within the same location', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dreamcli-config-'));
		try {
			const native = createAdapter();
			const stdout: string[] = [];
			const adapter = createTestAdapter({
				argv: ['test', 'app'],
				cwd: directory,
				readFile: native.readFile,
				importConfigModule: native.importConfigModule,
				stdout: (text) => stdout.push(text),
			});
			await writeFile(join(directory, 'demo.config.mjs'), 'export default { port: 3000 };');
			const app = cli('demo')
				.config('demo')
				.default(
					command('run')
						.flag('port', flag.number().config('port').default(80))
						.action(({ flags, out }) => out.log(String(flags.port))),
				);
			await expect(app.run({ adapter })).rejects.toEqual(new ExitError(0));
			const optedIn = app.configLoader(configModule());
			await expect(optedIn.run({ adapter })).rejects.toEqual(new ExitError(0));
			await writeFile(join(directory, 'demo.config.json'), '{"port":8000}');
			await expect(optedIn.run({ adapter })).rejects.toEqual(new ExitError(0));
			expect(stdout).toEqual(['80\n', '3000\n', '8000\n']);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('reports unsupported formats and invalid module exports as config errors', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'dreamcli-config-'));
		try {
			const native = createAdapter();
			const tsPath = join(directory, 'app.config.mts');
			const jsPath = join(directory, 'app.config.mjs');
			await writeFile(tsPath, 'throw new Error("This module should not run");');
			await writeFile(jsPath, 'export const port = 3000;');
			await expect(
				discoverConfig('app', native, {
					configPath: tsPath,
					loaders: [configModule()],
				}),
			).rejects.toMatchObject({ code: 'CONFIG_UNKNOWN_FORMAT' });
			await expect(
				discoverConfig('app', native, {
					configPath: jsPath,
					loaders: [configModule()],
				}),
			).rejects.toMatchObject({
				code: 'CONFIG_PARSE_ERROR',
				details: { message: 'Config loader must return a plain object' },
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
