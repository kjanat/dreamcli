#!/usr/bin/env bun
/**
 * Testing examples using @kjanat/dreamcli/testkit.
 *
 * Demonstrates: `runCommand()`, prompt answers, env/config injection, output
 * assertions, middleware context, activity assertions, and filesystem checks
 * through an injected `stat` probe.
 *
 * This file is structured as a Vitest test suite — run with
 * `bun test examples/testing.ts`.
 *
 * Usage:
 *   bun test examples/testing.ts
 */

import { arg, command, flag, middleware } from '@kjanat/dreamcli';
import { createTestPrompter, PROMPT_CANCEL, runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from 'vitest';

// --- Command under test ---

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target'))
	.flag(
		'region',
		flag
			.enum(['us', 'eu', 'ap'])
			.env('DEPLOY_REGION')
			.config('deploy.region')
			.prompt({ kind: 'select', message: 'Which region?' })
			.describe('Target region'),
	)
	.flag('force', flag.boolean().alias('f'))
	.action(({ args, flags, out }) => {
		if (!flags.force) {
			out.warn('Use --force to skip confirmation');
		}
		out.log(`Deploying ${args.target} to ${flags.region}`);
	});

// --- Tests ---

describe('deploy command', () => {
	it('deploys with explicit flags', async () => {
		const result = await runCommand(deploy, ['production', '--region', 'eu', '--force']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Deploying production to eu\n']);
		expect(result.stderr).toEqual([]);
	});

	it('resolves region from environment variable', async () => {
		const result = await runCommand(deploy, ['staging', '--force'], {
			env: { DEPLOY_REGION: 'ap' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Deploying staging to ap\n']);
	});

	it('resolves region from config file', async () => {
		const result = await runCommand(deploy, ['staging', '--force'], {
			config: { deploy: { region: 'eu' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Deploying staging to eu\n']);
	});

	it('prompts for region when not provided', async () => {
		const result = await runCommand(deploy, ['staging', '--force'], {
			answers: ['us'],
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Deploying staging to us\n']);
	});

	it('handles prompt cancellation', async () => {
		const result = await runCommand(deploy, ['staging'], {
			prompter: createTestPrompter([PROMPT_CANCEL]),
		});

		expect(result.exitCode).not.toBe(0);
	});

	it('shows warning when --force is not set', async () => {
		const result = await runCommand(deploy, ['production', '--region', 'us']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toEqual(['Use --force to skip confirmation\n']);
		expect(result.stdout).toEqual(['Deploying production to us\n']);
	});

	it('renders help text', async () => {
		const result = await runCommand(deploy, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Deploy to an environment');
		expect(result.stdout.join('')).toContain('--region');
	});
});

// --- Middleware testing ---

const auth = middleware<{ user: string }>(async ({ next }) => {
	return next({ user: 'alice' });
});

const guarded = command('secret')
	.description('Protected command')
	.middleware(auth)
	.action(({ ctx, out }) => {
		out.log(`Hello, ${ctx.user}`);
	});

describe('middleware context', () => {
	it('passes context from middleware to action', async () => {
		const result = await runCommand(guarded, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Hello, alice\n']);
	});
});

// --- Spinner/progress activity events ---

const build = command('build')
	.description('Build something')
	.action(({ out }) => {
		const spinner = out.spinner('Building...');
		spinner.succeed('Done');
	});

describe('activity events', () => {
	it('captures spinner lifecycle in activity array', async () => {
		const result = await runCommand(build, []);

		expect(result.exitCode).toBe(0);
		expect(result.activity).toContainEqual(
			expect.objectContaining({ type: 'spinner:start', text: 'Building...' }),
		);
		expect(result.activity).toContainEqual(
			expect.objectContaining({ type: 'spinner:succeed', text: 'Done' }),
		);
	});
});

// --- Filesystem checks (arg.path / flag.path) ---

const convert = command('convert')
	.description('Convert a module')
	.arg('input', arg.path({ type: 'file' })) // existing input
	.arg('output', arg.path({ type: 'file', mustExist: false })) // new output is allowed
	.action(({ args, out }) => {
		out.log(`${args.input} -> ${args.output}`);
	});

describe('filesystem checks', () => {
	// A probe is a plain function: no temp files, no mocks.
	const files = new Set(['in.wasm']);
	const stat = async (path: string) => (files.has(path) ? 'file' : null);

	it('reports checks that never ran when no probe is injected', async () => {
		const result = await runCommand(convert, ['in.wasm', 'out.wasm']);

		expect(result.exitCode).toBe(0); // the action ran…
		expect(result.skippedPathChecks).toEqual([
			// …but neither path was checked, so this proves nothing about the real CLI
			expect.objectContaining({ kind: 'arg', name: 'input', missing: 'stat' }),
			expect.objectContaining({ kind: 'arg', name: 'output', missing: 'stat' }),
		]);
	});

	it('exercises every declared check under strict mode', async () => {
		const result = await runCommand(convert, ['in.wasm', 'out.wasm'], {
			stat,
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['in.wasm -> out.wasm\n']);
		expect(result.skippedPathChecks).toEqual([]);
	});

	it('rejects a missing input the way the real CLI would', async () => {
		const result = await runCommand(convert, ['nope.wasm', 'out.wasm'], {
			stat,
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
	});

	it('fails instead of passing silently when the probe is forgotten', async () => {
		const result = await runCommand(convert, ['in.wasm', 'out.wasm'], {
			pathChecks: 'strict',
		});

		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('PATH_CHECK_SKIPPED');
	});
});
