/**
 * Focused completion contract tests for the shipped `.completions()` surface.
 */

import { describe, expect, it } from 'vitest';
import {
	extractBashRootWords,
	extractFishCompletionLines,
	extractZshRootFunction,
} from '#internals/core/completion/completion-test-helpers.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

// === Test helpers

function deployCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string().describe('Deploy target'))
		.flag('force', flag.boolean().alias('f').describe('Force deployment'))
		.action(({ out }) => {
			out.log('deploy');
		});
}

function serveDefaultCommand() {
	return command('serve')
		.description('Start the server')
		.flag('port', flag.number().alias('p').describe('Port'))
		.flag('verbose', flag.boolean().propagate().describe('Verbose logging'))
		.command(
			command('inspect')
				.description('Inspect the running server')
				.flag('childOnly', flag.boolean().describe('Child-only flag'))
				.action(({ out }) => {
					out.log('inspect');
				}),
		)
		.action(({ out }) => {
			out.log('serve');
		});
}

function statusCommand() {
	return command('status')
		.description('Show current status')
		.action(({ out }) => {
			out.log('status');
		});
}

function dbCommand() {
	return command('db')
		.description('Database operations')
		.flag('verbose', flag.boolean().alias('v').describe('Verbose output').propagate())
		.command(
			command('migrate')
				.description('Run migrations')
				.flag('dry-run', flag.boolean().describe('Dry run mode'))
				.action(({ out }) => {
					out.log('migrate');
				}),
		)
		.command(
			command('seed')
				.description('Seed database')
				.flag('count', flag.number().describe('Record count'))
				.action(({ out }) => {
					out.log('seed');
				}),
		)
		.action(({ out }) => {
			out.log('db');
		});
}

// === Completion contract

describe('Completion contract', () => {
	// --- supported shell surface

	describe('supported shell surface', () => {
		it('advertises only implemented shells in completions help', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const result = await app.execute(['completions', '--help']);
			const output = result.stdout.join('');

			expect(result.exitCode).toBe(0);
			expect(output).toContain('bash');
			expect(output).toContain('zsh');
			expect(output).toContain('fish');
			expect(output).toContain('powershell');
		});

		it('accepts powershell at the command boundary', async () => {
			const app = cli('mycli').command(deployCommand()).completions();
			const powershellResult = await app.execute(['completions', 'powershell']);

			expect(powershellResult.exitCode).toBe(0);
			expect(powershellResult.stdout.join('')).toContain('# PowerShell completion for mycli');
		});
	});

	// --- nested command propagation

	describe('nested command propagation', () => {
		it('includes nested bash leaf completions with propagated ancestor flags', async () => {
			const app = cli('mycli').command(dbCommand()).completions();
			const result = await app.execute(['completions', 'bash']);
			const lines = result.stdout.join('').split('\n');
			const migrateIdx = lines.findIndex((line) => line.includes('"db migrate"'));

			expect(result.exitCode).toBe(0);
			expect(migrateIdx).toBeGreaterThan(-1);

			const migrateBlock = lines.slice(migrateIdx, migrateIdx + 15).join('\n');
			expect(migrateBlock).toContain('--verbose');
			expect(migrateBlock).toContain('-v');
			expect(migrateBlock).toContain('--dry-run');
		});

		it('includes nested zsh leaf completions with propagated ancestor flags', async () => {
			const app = cli('mycli').command(dbCommand()).completions();
			const result = await app.execute(['completions', 'zsh']);
			const lines = result.stdout.join('').split('\n');
			const migrateIdx = lines.findIndex((line) => line.includes('_mycli_db_migrate() {'));

			expect(result.exitCode).toBe(0);
			expect(migrateIdx).toBeGreaterThan(-1);

			const migrateBlock = lines.slice(migrateIdx, migrateIdx + 10).join('\n');
			expect(migrateBlock).toContain('--verbose');
			expect(migrateBlock).toContain('-v');
			expect(migrateBlock).toContain('--dry-run');
		});

		it('includes nested fish leaf completions with propagated ancestor flags', async () => {
			const app = cli('mycli').command(dbCommand()).completions();
			const result = await app.execute(['completions', 'fish']);
			const lines = extractFishCompletionLines(
				result.stdout.join(''),
				'__mycli_completions_path_is',
				'db migrate',
			).join('\n');

			expect(result.exitCode).toBe(0);
			expect(lines).toContain('-l verbose');
			expect(lines).toContain('-s v');
			expect(lines).toContain('-l dry-run');
		});
	});

	// --- root and default-command policy

	describe('root and default-command policy', () => {
		it('keeps hybrid bash roots command-centric by default and surfaces default flags on request', async () => {
			const commandModeApp = cli('mycli')
				.default(serveDefaultCommand())
				.command(statusCommand())
				.completions();
			const commandModeResult = await commandModeApp.execute(['completions', 'bash']);
			const commandModeWords = extractBashRootWords(commandModeResult.stdout.join(''));

			expect(commandModeResult.exitCode).toBe(0);
			expect(commandModeWords).toEqual(['serve', 'status', '--help']);

			const surfaceModeApp = cli('mycli')
				.default(serveDefaultCommand())
				.command(statusCommand())
				.completions({ rootMode: 'surface' });
			const surfaceModeResult = await surfaceModeApp.execute(['completions', 'bash']);
			const surfaceModeWords = extractBashRootWords(surfaceModeResult.stdout.join(''));

			expect(surfaceModeResult.exitCode).toBe(0);
			expect(surfaceModeWords).toContain('--port');
			expect(surfaceModeWords).toContain('-p');
			expect(surfaceModeWords).toContain('--verbose');
			expect(surfaceModeWords).not.toContain('--childOnly');
		});

		it('keeps hybrid zsh roots command-centric by default and surfaces default flags on request', async () => {
			const commandModeApp = cli('mycli')
				.default(serveDefaultCommand())
				.command(statusCommand())
				.completions();
			const commandModeResult = await commandModeApp.execute(['completions', 'zsh']);
			const commandModeRoot = extractZshRootFunction(commandModeResult.stdout.join(''), '_mycli');

			expect(commandModeResult.exitCode).toBe(0);
			expect(commandModeRoot).toContain("'serve:Start the server'");
			expect(commandModeRoot).toContain("'status:Show current status'");
			expect(commandModeRoot).not.toContain("'(-p --port)'{-p,--port}'[Port]:value:'");

			const surfaceModeApp = cli('mycli')
				.default(serveDefaultCommand())
				.command(statusCommand())
				.completions({ rootMode: 'surface' });
			const surfaceModeResult = await surfaceModeApp.execute(['completions', 'zsh']);
			const surfaceModeRoot = extractZshRootFunction(surfaceModeResult.stdout.join(''), '_mycli');

			expect(surfaceModeResult.exitCode).toBe(0);
			expect(surfaceModeRoot).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
			expect(surfaceModeRoot).toContain("'--verbose[Verbose logging]'");
			expect(surfaceModeRoot).not.toContain("'--childOnly[Child-only flag]'");
		});

		it('keeps hybrid fish roots command-centric by default and surfaces default flags on request', async () => {
			const commandModeApp = cli('mycli')
				.default(serveDefaultCommand())
				.command(statusCommand())
				.completions();
			const commandModeResult = await commandModeApp.execute(['completions', 'fish']);
			const commandModeRoot = extractFishCompletionLines(
				commandModeResult.stdout.join(''),
				'__mycli_completions_path_is',
				'',
			).join('\n');

			expect(commandModeResult.exitCode).toBe(0);
			expect(commandModeRoot).toContain('-a serve');
			expect(commandModeRoot).toContain('-a status');
			expect(commandModeRoot).not.toContain('-l port');

			const surfaceModeApp = cli('mycli')
				.default(serveDefaultCommand())
				.command(statusCommand())
				.completions({ rootMode: 'surface' });
			const surfaceModeResult = await surfaceModeApp.execute(['completions', 'fish']);
			const surfaceModeRoot = extractFishCompletionLines(
				surfaceModeResult.stdout.join(''),
				'__mycli_completions_path_is',
				'',
			).join('\n');

			expect(surfaceModeResult.exitCode).toBe(0);
			expect(surfaceModeRoot).toContain('-l port');
			expect(surfaceModeRoot).toContain('-s p');
			expect(surfaceModeRoot).toContain('-l verbose');
			expect(surfaceModeRoot).not.toContain('-l childOnly');
		});
	});
});
