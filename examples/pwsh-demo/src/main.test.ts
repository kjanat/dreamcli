/**
 * Smoke tests for the PowerShell completion playground.
 *
 * @module
 */
/// <reference types="bun" />

import { describe, expect, it } from 'bun:test';

import { pwshDemo } from './main.ts';

describe('pwsh-demo example', () => {
	it('generates a PowerShell script with native registration', async () => {
		const result = await pwshDemo.execute(['completions', 'powershell']);

		expect(result.exitCode).toBe(0);

		const script = result.stdout.join('');
		expect(script).toContain('# PowerShell completion for pwsh-demo');
		expect(script).toContain('Register-ArgumentCompleter -Native -CommandName');
		expect(script).toContain('ship');
		expect(script).toContain('blue-green');
		expect(script).not.toContain('debug-dump');
		expect(script).toContain("Forms = @('--profile', '-p')");
	});

	it('keeps hidden commands executable', async () => {
		const result = await pwshDemo.execute(['debug-dump', '--section', 'completions']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('"section": "completions"');
	});

	it('surfaces default-command flags at the root', async () => {
		const help = await pwshDemo.execute(['--help']);

		expect(help.exitCode).toBe(0);
		expect(help.stdout.join('')).toContain('open');

		const result = await pwshDemo.execute(['bravo', '--profile', 'ops', '--shell', 'cmd']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual([
			'Opening bravo with ops profile in cmd\n',
			'Format: table\n',
		]);
	});
});
