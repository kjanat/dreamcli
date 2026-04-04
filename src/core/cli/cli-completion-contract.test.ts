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
		describe('bash', () => {
			it('includes propagated ancestor flags in leaf completions', async () => {
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
		});

		describe('zsh', () => {
			it('includes propagated ancestor flags in leaf completions', async () => {
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
		});

		describe('fish', () => {
			it('includes propagated ancestor flags in leaf completions', async () => {
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
	});

	// --- root and default-command policy

	describe('root and default-command policy', () => {
		describe('bash', () => {
			it('keeps hybrid roots command-centric by default', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions();
				const result = await app.execute(['completions', 'bash']);
				const rootWords = extractBashRootWords(result.stdout.join(''));

				expect(result.exitCode).toBe(0);
				expect(rootWords).toEqual(['serve', 'status', '--help']);
			});

			it('surfaces default flags in surface mode', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions({ rootMode: 'surface' });
				const result = await app.execute(['completions', 'bash']);
				const rootWords = extractBashRootWords(result.stdout.join(''));

				expect(result.exitCode).toBe(0);
				expect(rootWords).toContain('--port');
				expect(rootWords).toContain('-p');
				expect(rootWords).toContain('--verbose');
				expect(rootWords).not.toContain('--childOnly');
			});
		});

		describe('zsh', () => {
			it('keeps hybrid roots command-centric by default', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions();
				const result = await app.execute(['completions', 'zsh']);
				const rootFunction = extractZshRootFunction(result.stdout.join(''), '_mycli');

				expect(result.exitCode).toBe(0);
				expect(rootFunction).toContain("'serve:Start the server'");
				expect(rootFunction).toContain("'status:Show current status'");
				expect(rootFunction).not.toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
			});

			it('surfaces default flags in surface mode', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions({ rootMode: 'surface' });
				const result = await app.execute(['completions', 'zsh']);
				const rootFunction = extractZshRootFunction(result.stdout.join(''), '_mycli');

				expect(result.exitCode).toBe(0);
				expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
				expect(rootFunction).toContain("'--verbose[Verbose logging]'");
				expect(rootFunction).not.toContain("'--childOnly[Child-only flag]'");
			});
		});

		describe('fish', () => {
			it('keeps hybrid roots command-centric by default', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions();
				const result = await app.execute(['completions', 'fish']);
				const rootLines = extractFishCompletionLines(
					result.stdout.join(''),
					'__mycli_completions_path_is',
					'',
				).join('\n');

				expect(result.exitCode).toBe(0);
				expect(rootLines).toContain('-a serve');
				expect(rootLines).toContain('-a status');
				expect(rootLines).not.toContain('-l port');
			});

			it('surfaces default flags in surface mode', async () => {
				const app = cli('mycli')
					.default(serveDefaultCommand())
					.command(statusCommand())
					.completions({ rootMode: 'surface' });
				const result = await app.execute(['completions', 'fish']);
				const rootLines = extractFishCompletionLines(
					result.stdout.join(''),
					'__mycli_completions_path_is',
					'',
				).join('\n');

				expect(result.exitCode).toBe(0);
				expect(rootLines).toContain('-l port');
				expect(rootLines).toContain('-s p');
				expect(rootLines).toContain('-l verbose');
				expect(rootLines).not.toContain('-l childOnly');
			});
		});
	});
});
