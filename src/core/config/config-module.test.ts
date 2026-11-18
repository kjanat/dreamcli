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
const config = await discoverConfig('app', createAdapter(), {
  configPath: ${JSON.stringify(path)},
  loaders: [configModule({ typescript: true })],
});
console.log(JSON.stringify(config));
`,
			);
			const args = process.versions.deno
				? [
						'run',
						'-A',
						'--quiet',
						'--no-lock',
						'--config',
						fileURLToPath(new URL('../../../deno.json', import.meta.url)),
						probe,
					]
				: [probe];
			const output = execFileSync(process.execPath, args, { encoding: 'utf8' });
			expect(JSON.parse(output)).toEqual({
				found: true,
				path,
				data: { port: 3000 },
				format: extension,
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('lets a custom loader resolve a config by path without a module-capable adapter', async () => {
		const path = '/project/app.config.custom';
		const adapter = createTestAdapter({
			readFile: async (candidate) => (candidate === path ? '' : null),
		});
		await expect(
			discoverConfig('app', adapter, {
				configPath: path,
				loaders: [{ extensions: ['custom'], load: async (file) => ({ file }) }],
			}),
		).resolves.toEqual({ found: true, path, data: { file: path }, format: 'custom' });
	});

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
