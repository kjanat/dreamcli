/**
 * Tests for the testkit — runCommand() with injected state.
 */

import { describe, expect, it, vi } from 'vitest';
import { CLIError, ValidationError } from '../errors/index.ts';
import { arg } from '../schema/arg.ts';
import type { CommandMeta } from '../schema/command.ts';
import { command } from '../schema/command.ts';
import { flag } from '../schema/flag.ts';
import { runCommand } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a simple greet command for testing. */
function greetCommand() {
	return command('greet')
		.description('Greet someone')
		.arg('name', arg.string().describe('Who to greet'))
		.flag('loud', flag.boolean().alias('l').describe('Shout the greeting'))
		.flag('times', flag.number().default(1).describe('Repeat count'))
		.action(({ args, flags, out }) => {
			for (let i = 0; i < flags.times; i++) {
				const msg = `Hello, ${args.name}!`;
				out.log(flags.loud ? msg.toUpperCase() : msg);
			}
		});
}

// ---------------------------------------------------------------------------
// Basic execution
// ---------------------------------------------------------------------------

describe('runCommand — basic execution', () => {
	it('runs a command and captures stdout', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Alice']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Hello, Alice!\n']);
		expect(result.stderr).toEqual([]);
		expect(result.error).toBeUndefined();
	});

	it('passes flags to the handler', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Bob', '--loud']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['HELLO, BOB!\n']);
	});

	it('passes short flags to the handler', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Charlie', '-l']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['HELLO, CHARLIE!\n']);
	});

	it('passes default flag values', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Alice', '--times', '3']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toHaveLength(3);
		expect(result.stdout).toEqual(['Hello, Alice!\n', 'Hello, Alice!\n', 'Hello, Alice!\n']);
	});

	it('handles async action handlers', async () => {
		const cmd = command('async-cmd')
			.arg('name', arg.string())
			.action(async ({ args, out }) => {
				await Promise.resolve();
				out.log(`async: ${args.name}`);
			});

		const result = await runCommand(cmd, ['test']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['async: test\n']);
	});

	it('handles commands with no args or flags', async () => {
		const cmd = command('simple').action(({ out }) => {
			out.log('done');
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['done\n']);
	});
});

// ---------------------------------------------------------------------------
// Help detection
// ---------------------------------------------------------------------------

describe('runCommand — help detection', () => {
	it('prints help for --help and exits 0', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Usage:');
		expect(result.stdout.join('')).toContain('greet');
		expect(result.error).toBeUndefined();
	});

	it('prints help for -h and exits 0', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['-h']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Usage:');
	});

	it('passes help options (binName, width)', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['--help'], {
			help: { binName: 'mycli', width: 60 },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('mycli greet');
	});

	it('--help takes priority even with other args', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Alice', '--help', '--loud']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Usage:');
	});
});

// ---------------------------------------------------------------------------
// Error handling — parse errors
// ---------------------------------------------------------------------------

describe('runCommand — parse errors', () => {
	it('returns exit 2 for unknown flags', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Alice', '--unknown']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Unknown flag');
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('UNKNOWN_FLAG');
	});

	it('returns exit 2 for invalid number values', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, ['Alice', '--times', 'abc']);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Invalid number');
		expect(result.error?.code).toBe('INVALID_VALUE');
	});
});

// ---------------------------------------------------------------------------
// Error handling — validation errors
// ---------------------------------------------------------------------------

describe('runCommand — validation errors', () => {
	it('returns exit 2 for missing required args', async () => {
		const cmd = greetCommand();
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Missing required');
		expect(result.error).toBeDefined();
	});

	it('returns exit 2 for missing required flags', async () => {
		const cmd = command('strict')
			.flag('token', flag.string().required())
			.action(({ flags, out }) => {
				out.log(flags.token);
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Missing required flag');
	});

	it('includes suggestions in stderr for validation errors', async () => {
		const cmd = command('strict')
			.flag('token', flag.string().required())
			.action(({ flags, out }) => {
				out.log(flags.token);
			});

		const result = await runCommand(cmd, []);

		expect(result.stderr.join('')).toContain('Suggestion:');
	});
});

// ---------------------------------------------------------------------------
// Error handling — handler errors
// ---------------------------------------------------------------------------

describe('runCommand — handler errors', () => {
	it('catches CLIError thrown by handler', async () => {
		const cmd = command('fail').action(() => {
			throw new CLIError('Something went wrong', {
				code: 'CUSTOM_ERROR',
				exitCode: 42,
				suggest: 'Try again',
			});
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(42);
		expect(result.stderr.join('')).toContain('Something went wrong');
		expect(result.stderr.join('')).toContain('Try again');
		expect(result.error?.code).toBe('CUSTOM_ERROR');
	});

	it('catches unexpected errors from handler', async () => {
		const cmd = command('crash').action(() => {
			throw new Error('kaboom');
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr.join('')).toContain('Unexpected error');
		expect(result.stderr.join('')).toContain('kaboom');
		expect(result.error?.code).toBe('UNEXPECTED_ERROR');
	});

	it('catches non-Error throws from handler', async () => {
		const cmd = command('throw-string').action(() => {
			// eslint-disable-next-line no-throw-literal
			throw 'raw string error';
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr.join('')).toContain('raw string error');
	});

	it('catches async handler errors', async () => {
		const cmd = command('async-fail').action(async () => {
			await Promise.resolve();
			throw new CLIError('async failure', {
				code: 'ASYNC_FAIL',
				exitCode: 3,
			});
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(3);
		expect(result.error?.code).toBe('ASYNC_FAIL');
	});
});

// ---------------------------------------------------------------------------
// No action handler
// ---------------------------------------------------------------------------

describe('runCommand — no action handler', () => {
	it('returns exit 1 when no action is registered', async () => {
		const cmd = command('empty').flag('verbose', flag.boolean());

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr.join('')).toContain('no action handler');
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('NO_ACTION');
	});
});

// ---------------------------------------------------------------------------
// Run options
// ---------------------------------------------------------------------------

describe('runCommand — options', () => {
	it('respects verbosity: quiet suppresses info', async () => {
		const cmd = command('verbose-cmd').action(({ out }) => {
			out.log('always visible');
			out.info('maybe visible');
		});

		const normal = await runCommand(cmd, []);
		expect(normal.stdout).toHaveLength(2);

		const quiet = await runCommand(cmd, [], { verbosity: 'quiet' });
		expect(quiet.stdout).toHaveLength(1);
		expect(quiet.stdout[0]).toContain('always visible');
	});

	it('preserves error object on the result', async () => {
		const cmd = command('err-preserve').action(() => {
			throw new ValidationError('bad value', {
				code: 'TYPE_MISMATCH',
				details: { field: 'x' },
			});
		});

		const result = await runCommand(cmd, []);

		expect(result.error).toBeInstanceOf(CLIError);
		expect(result.error).toBeInstanceOf(ValidationError);
		expect(result.error?.code).toBe('TYPE_MISMATCH');
	});
});

// ---------------------------------------------------------------------------
// Complex commands
// ---------------------------------------------------------------------------

describe('runCommand — complex commands', () => {
	it('handles enum flags correctly', async () => {
		const cmd = command('deploy')
			.arg('target', arg.string())
			.flag('region', flag.enum(['us', 'eu', 'ap']).default('us'))
			.action(({ args, flags, out }) => {
				out.log(`${args.target}@${flags.region}`);
			});

		const result = await runCommand(cmd, ['prod', '--region', 'eu']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['prod@eu\n']);
	});

	it('handles array flags', async () => {
		const cmd = command('multi')
			.flag('tag', flag.array(flag.string()))
			.action(({ flags, out }) => {
				const tags = flags.tag ?? [];
				for (const t of tags) {
					out.log(`tag: ${t}`);
				}
			});

		const result = await runCommand(cmd, ['--tag', 'v1', '--tag', 'v2']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['tag: v1\n', 'tag: v2\n']);
	});

	it('handles variadic args', async () => {
		const cmd = command('cat')
			.arg('files', arg.string().variadic())
			.action(({ args, out }) => {
				for (const f of args.files) {
					out.log(f);
				}
			});

		const result = await runCommand(cmd, ['a.txt', 'b.txt', 'c.txt']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['a.txt\n', 'b.txt\n', 'c.txt\n']);
	});

	it('handles optional args with defaults', async () => {
		const cmd = command('greet')
			.arg('name', arg.string().default('World'))
			.action(({ args, out }) => {
				out.log(`Hello, ${args.name}!`);
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Hello, World!\n']);
	});

	it('handles mixed flags and args', async () => {
		const cmd = command('build')
			.arg('entry', arg.string())
			.flag('outdir', flag.string().default('dist'))
			.flag('minify', flag.boolean())
			.flag('target', flag.enum(['es2020', 'es2022']).default('es2022'))
			.action(({ args, flags, out }) => {
				out.log(
					`${args.entry} → ${flags.outdir} [${flags.target}]${flags.minify ? ' (minified)' : ''}`,
				);
			});

		const result = await runCommand(cmd, ['src/index.ts', '--minify', '--outdir', 'build']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['src/index.ts → build [es2022] (minified)\n']);
	});
});

// ---------------------------------------------------------------------------
// Result structure
// ---------------------------------------------------------------------------

describe('runCommand — result structure', () => {
	it('result has all required fields', async () => {
		const cmd = command('check').action(({ out }) => {
			out.log('ok');
		});

		const result = await runCommand(cmd, []);

		expect(result).toHaveProperty('exitCode');
		expect(result).toHaveProperty('stdout');
		expect(result).toHaveProperty('stderr');
		expect(result).toHaveProperty('error');
		expect(typeof result.exitCode).toBe('number');
		expect(Array.isArray(result.stdout)).toBe(true);
		expect(Array.isArray(result.stderr)).toBe(true);
	});

	it('separates stdout and stderr correctly', async () => {
		const cmd = command('mixed-output').action(({ out }) => {
			out.log('stdout1');
			out.warn('stderr1');
			out.error('stderr2');
			out.info('stdout2');
		});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['stdout1\n', 'stdout2\n']);
		expect(result.stderr).toEqual(['stderr1\n', 'stderr2\n']);
	});

	it('error is undefined on success', async () => {
		const cmd = command('ok').action(() => {});
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
	});
});

// ========================================================================
// Deprecation warnings — end-to-end
// ========================================================================

describe('runCommand — deprecation warnings', () => {
	it('emits deprecated flag warning to stderr', async () => {
		const cmd = command('test')
			.flag('old', flag.string().deprecated('use --new'))
			.action(() => {});
		const result = await runCommand(cmd, ['--old', 'val']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContainEqual(
			expect.stringContaining('flag --old is deprecated: use --new'),
		);
	});

	it('emits deprecated arg warning to stderr', async () => {
		const cmd = command('test')
			.arg('target', arg.string().deprecated())
			.action(() => {});
		const result = await runCommand(cmd, ['prod']);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContainEqual(
			expect.stringContaining('argument <target> is deprecated'),
		);
	});

	it('does not emit warning when deprecated flag is not provided', async () => {
		const cmd = command('test')
			.flag('old', flag.string().deprecated())
			.action(() => {});
		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toHaveLength(0);
	});

	it('deprecation warning does not affect exit code', async () => {
		const cmd = command('test')
			.flag('old', flag.string().deprecated())
			.action(({ out }) => {
				out.log('ok');
			});
		const result = await runCommand(cmd, ['--old', 'val']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContainEqual('ok\n');
	});
});

// ===========================================================================
// CommandMeta — handler receives metadata
// ===========================================================================

describe('runCommand — meta', () => {
	it('provides default meta derived from command schema', async () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);

		await runCommand(cmd, []);

		expect(handler).toHaveBeenCalledOnce();
		const meta: CommandMeta = handler.mock.calls[0]![0].meta;
		expect(meta).toEqual({
			name: 'deploy',
			bin: 'deploy',
			version: undefined,
			command: 'deploy',
		});
	});

	it('uses help.binName for meta.bin when provided', async () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);

		await runCommand(cmd, [], { help: { binName: 'mycli' } });

		const meta: CommandMeta = handler.mock.calls[0]![0].meta;
		expect(meta.bin).toBe('mycli');
		expect(meta.name).toBe('deploy');
	});

	it('forwards explicit meta from RunOptions', async () => {
		const handler = vi.fn();
		const cmd = command('deploy').action(handler);

		const explicit: CommandMeta = {
			name: 'myapp',
			bin: 'myapp',
			version: '2.0.0',
			command: 'deploy',
		};
		await runCommand(cmd, [], { meta: explicit });

		const meta: CommandMeta = handler.mock.calls[0]![0].meta;
		expect(meta).toEqual(explicit);
	});
});
