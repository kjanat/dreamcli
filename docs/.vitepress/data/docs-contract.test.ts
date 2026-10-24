/**
 * @module
 */

import { readFile } from 'node:fs/promises';
import { createTestPrompter, PROMPT_CANCEL, runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from 'vitest';

import {
	activityCmd,
	buildCmd,
	convertCmd,
	deploy,
	greet,
	jsonListCmd,
	promptCmd,
} from '../twoslash/testing-fixtures.ts';

function readUtf8(path: URL): Promise<string> {
	return readFile(path, 'utf8');
}

describe('docs contracts', () => {
	it('executes guide-facing testing fixtures with expected semantics', async () => {
		const fromEnv = await runCommand(deploy, ['production'], {
			env: { DEPLOY_REGION: 'eu' },
		});
		expect(fromEnv.exitCode).toBe(0);
		expect(fromEnv.stdout).toEqual(['Deploying production to eu\n']);
		expect(fromEnv.stderr).toEqual(['Use --force to skip confirmation\n']);

		const fromConfig = await runCommand(deploy, ['production'], {
			config: { deploy: { region: 'us' } },
		});
		expect(fromConfig.exitCode).toBe(0);
		expect(fromConfig.stdout).toEqual(['Deploying production to us\n']);
		expect(fromConfig.stderr).toEqual(['Use --force to skip confirmation\n']);

		const fromPrompt = await runCommand(deploy, ['production'], {
			answers: ['ap'],
		});
		expect(fromPrompt.exitCode).toBe(0);
		expect(fromPrompt.stdout).toEqual(['Deploying production to ap\n']);
		expect(fromPrompt.stderr).toEqual(['Use --force to skip confirmation\n']);

		const cancelledPrompt = await runCommand(promptCmd, [], {
			prompter: createTestPrompter([PROMPT_CANCEL]),
		});
		expect(cancelledPrompt.exitCode).toBe(2);
		expect(cancelledPrompt.error?.code).toBe('REQUIRED_FLAG');

		const activity = await runCommand(activityCmd, []);
		expect(activity.exitCode).toBe(0);
		expect(activity.activity).toEqual([
			{ type: 'spinner:start', text: 'Building' },
			{ type: 'spinner:succeed', text: 'Done' },
		]);

		const json = await runCommand(jsonListCmd, [], { jsonMode: true });
		expect(json.exitCode).toBe(0);
		expect(JSON.parse(json.stdout[0] ?? '')).toEqual([{ id: 1 }, { id: 2 }]);

		const missingArg = await runCommand(greet, []);
		expect(missingArg.exitCode).toBe(2);
		expect(missingArg.error?.code).toBe('REQUIRED_ARG');
	});

	it('executes the filesystem-check recipes in the testing guide', async () => {
		const skipped = await runCommand(convertCmd, ['in.wasm', 'out.wasm']);
		expect(skipped.exitCode).toBe(0);
		expect(skipped.skippedPathChecks).toEqual([
			expect.objectContaining({ kind: 'arg', name: 'input', missing: 'stat' }),
			expect.objectContaining({ kind: 'arg', name: 'output', missing: 'stat' }),
		]);

		const files = new Set(['in.wasm']);
		const stat = async (path: string) => (files.has(path) ? 'file' : null);

		const ok = await runCommand(convertCmd, ['in.wasm', 'out.wasm'], {
			stat,
			pathChecks: 'strict',
		});
		expect(ok.exitCode).toBe(0);
		expect(ok.stdout).toEqual(['in.wasm -> out.wasm\n']);
		expect(ok.skippedPathChecks).toEqual([]);

		const missing = await runCommand(convertCmd, ['nope.wasm', 'out.wasm'], {
			stat,
			pathChecks: 'strict',
		});
		expect(missing.exitCode).toBe(2);
		expect(missing.error?.code).toBe('CONSTRAINT_VIOLATED');

		const unchecked = await runCommand(convertCmd, ['in.wasm', 'out.wasm'], {
			pathChecks: 'strict',
		});
		expect(unchecked.exitCode).toBe(1);
		expect(unchecked.error?.code).toBe('PATH_CHECK_SKIPPED');

		const created: string[] = [];
		const built = await runCommand(buildCmd, ['--out', 'dist'], {
			stat: async () => null,
			mkdir: async (path) => {
				created.push(path);
			},
			pathChecks: 'strict',
		});
		expect(built.exitCode).toBe(0);
		expect(created).toEqual(['dist']);
	});

	it('locks high-signal docs claims that previously drifted', async () => {
		const [
			migration,
			runtime,
			readme,
			testingGuide,
			testkitReference,
			mainReference,
			limitations,
			semantics,
		] = await Promise.all([
			readUtf8(new URL('../../guide/migration.md', import.meta.url)),
			readUtf8(new URL('../../guide/runtime.md', import.meta.url)),
			readUtf8(new URL('../../../README.md', import.meta.url)),
			readUtf8(new URL('../../guide/testing.md', import.meta.url)),
			readUtf8(new URL('../../reference/testkit.md', import.meta.url)),
			readUtf8(new URL('../../reference/main.md', import.meta.url)),
			readUtf8(new URL('../../guide/limitations.md', import.meta.url)),
			readUtf8(new URL('../../guide/semantics.md', import.meta.url)),
		]);

		expect(migration).toContain('runCommand(deploy, [], {');
		expect(runtime).not.toContain('test adapter internally');
		expect(readme).toContain('`stdinData`');
		expect(readme).not.toMatch(/RunOptions` accepts:[\s\S]{0,160}`adapter`/);
		expect(testingGuide).toContain('promptCmd');
		expect(testingGuide).toContain('activityCmd');
		expect(testingGuide).toContain('skippedPathChecks');
		expect(testingGuide).toContain("pathChecks: 'strict'");
		expect(testkitReference).toContain('promptCmd');
		expect(mainReference).toContain('.manifest({ from: import.meta.url })');
		expect(mainReference).toContain('.manifest({ from: import.meta })');
		expect(mainReference).toContain('if (import.meta.main)');
		expect(mainReference).toContain('if (isMainModule(import.meta))');
		expect(limitations).toContain('.negatable()');
		expect(limitations).not.toContain('unless you define that spelling yourself');
		expect(semantics).toContain('Call `.negatable()` on the boolean');
		expect(semantics).not.toContain('register that exact spelling as the flag name or as an alias');
	});
});
