/**
 * @module
 */

import { readFile } from 'node:fs/promises';
import { createTestPrompter, PROMPT_CANCEL, runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from 'vitest';

import {
	activityCmd,
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

	it('locks high-signal docs claims that previously drifted', async () => {
		const [migration, runtime, readme, testingGuide, testkitReference] = await Promise.all([
			readUtf8(new URL('../../guide/migration.md', import.meta.url)),
			readUtf8(new URL('../../guide/runtime.md', import.meta.url)),
			readUtf8(new URL('../../../README.md', import.meta.url)),
			readUtf8(new URL('../../guide/testing.md', import.meta.url)),
			readUtf8(new URL('../../reference/testkit.md', import.meta.url)),
		]);

		expect(migration).toContain('runCommand(deploy, [], {');
		expect(runtime).not.toContain('test adapter internally');
		expect(readme).toContain('`stdinData`');
		expect(readme).not.toMatch(/RunOptions` accepts:[\s\S]{0,160}`adapter`/);
		expect(testingGuide).toContain('promptCmd');
		expect(testingGuide).toContain('activityCmd');
		expect(testkitReference).toContain('promptCmd');
	});
});
