import { describe, expect, expectTypeOf, it } from 'vitest';
import { runCommand } from '#internals/core/testkit/index.ts';
import { command } from './command.ts';
import type { AllowedPromptConfig, FlagBuilder, FlagConfig, InferFlag } from './flag.ts';
import { flag } from './flag.ts';

/** Extract the phantom config from a builder for prompt-compatibility checks. */
type ConfigOf<B> = B extends FlagBuilder<infer C extends FlagConfig> ? C : never;

function countCommand(onFlags: (verbose: number) => void) {
	return command('smoke')
		.flag('verbose', flag.count().alias('v'))
		.action(({ flags }) => {
			onFlags(flags.verbose);
		});
}

function keyValueCommand(onFlags: (env: Record<string, string>) => void) {
	return command('smoke')
		.flag('env', flag.keyValue().alias('e'))
		.action(({ flags }) => {
			onFlags(flags.env);
		});
}

// === flag.count()

describe('flag.count()', () => {
	// --- type inference

	describe('type inference', () => {
		it('resolves to number (defaulted, never undefined)', () => {
			const f = flag.count();
			expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<number>();
		});

		it('starts life defaulted to 0', () => {
			const f = flag.count();
			expect(f.schema.kind).toBe('count');
			expect(f.schema.presence).toBe('defaulted');
			expect(f.schema.defaultValue).toBe(0);
		});

		it('is not promptable — AllowedPromptConfig is never', () => {
			const f = flag.count();
			expectTypeOf<AllowedPromptConfig<ConfigOf<typeof f>>>().toBeNever();
		});
	});

	// --- runtime accumulation

	describe('occurrence counting', () => {
		it('absent resolves to 0', async () => {
			let received: number | undefined;
			const result = await runCommand(
				countCommand((verbose) => {
					received = verbose;
				}),
				[],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toBe(0);
		});

		it('-v resolves to 1', async () => {
			let received: number | undefined;
			const result = await runCommand(
				countCommand((verbose) => {
					received = verbose;
				}),
				['-v'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toBe(1);
		});

		it('-vvv resolves to 3', async () => {
			let received: number | undefined;
			const result = await runCommand(
				countCommand((verbose) => {
					received = verbose;
				}),
				['-vvv'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toBe(3);
		});

		it('mixed -v -v and --verbose accumulate across forms', async () => {
			let received: number | undefined;
			const result = await runCommand(
				countCommand((verbose) => {
					received = verbose;
				}),
				['-v', '-v', '--verbose'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toBe(3);
		});

		it('--verbose=2 sets the count explicitly', async () => {
			let received: number | undefined;
			const result = await runCommand(
				countCommand((verbose) => {
					received = verbose;
				}),
				['--verbose=2'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toBe(2);
		});

		it('--verbose=nope is rejected at parse time', async () => {
			const result = await runCommand(
				countCommand(() => {}),
				['--verbose=nope'],
			);

			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('INVALID_VALUE');
			expect(result.error?.message).toContain('Invalid count value');
		});
	});

	// --- env resolution

	describe('env resolution', () => {
		function envCountCommand(onFlags: (verbose: number) => void) {
			return command('smoke')
				.flag('verbose', flag.count().alias('v').env('SMOKE_V'))
				.action(({ flags }) => {
					onFlags(flags.verbose);
				});
		}

		it('resolves SMOKE_V=2 to 2', async () => {
			let received: number | undefined;
			const result = await runCommand(
				envCountCommand((verbose) => {
					received = verbose;
				}),
				[],
				{ env: { SMOKE_V: '2' } },
			);

			expect(result.exitCode).toBe(0);
			expect(received).toBe(2);
		});

		it('rejects a negative env value', async () => {
			const result = await runCommand(
				envCountCommand(() => {}),
				[],
				{
					env: { SMOKE_V: '-1' },
				},
			);

			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('TYPE_MISMATCH');
			expect(result.error?.message).toContain('Invalid count value');
		});

		it('rejects a float env value', async () => {
			const result = await runCommand(
				envCountCommand(() => {}),
				[],
				{
					env: { SMOKE_V: '1.5' },
				},
			);

			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('TYPE_MISMATCH');
		});
	});

	// --- help output

	describe('help output', () => {
		it('renders without a value placeholder and without (default: 0)', async () => {
			const cmd = command('smoke')
				.flag('verbose', flag.count().alias('v').describe('Increase verbosity'))
				.action(() => {});

			const result = await runCommand(cmd, ['--help']);
			expect(result.exitCode).toBe(0);

			const helpText = result.stdout.join('');
			const verboseLine = helpText.split('\n').find((line) => line.includes('--verbose'));

			expect(verboseLine).toBeDefined();
			expect(verboseLine ?? '').not.toContain('<value>');
			expect(verboseLine ?? '').not.toContain('<');
			expect(helpText).not.toContain('(default: 0)');
		});
	});
});

// === flag.keyValue()

describe('flag.keyValue()', () => {
	// --- type inference

	describe('type inference', () => {
		it('resolves to Record<string, string> (never undefined)', () => {
			const f = flag.keyValue();
			expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<Record<string, string>>();
		});

		it('is not promptable — AllowedPromptConfig is never', () => {
			const f = flag.keyValue();
			expectTypeOf<AllowedPromptConfig<ConfigOf<typeof f>>>().toBeNever();
		});
	});

	// --- runtime merging

	describe('pair merging', () => {
		it('absent resolves to an empty object', async () => {
			let received: Record<string, string> | undefined;
			const result = await runCommand(
				keyValueCommand((env) => {
					received = env;
				}),
				[],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toEqual({});
		});

		it('repeated -e occurrences merge into one record', async () => {
			let received: Record<string, string> | undefined;
			const result = await runCommand(
				keyValueCommand((env) => {
					received = env;
				}),
				['-e', 'A=1', '-e', 'B=2'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toEqual({ A: '1', B: '2' });
		});

		it('last occurrence wins for duplicate keys', async () => {
			let received: Record<string, string> | undefined;
			const result = await runCommand(
				keyValueCommand((env) => {
					received = env;
				}),
				['-e', 'A=1', '-e', 'A=2'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toEqual({ A: '2' });
		});

		it('splits at the first = so values may contain =', async () => {
			let received: Record<string, string> | undefined;
			const result = await runCommand(
				keyValueCommand((env) => {
					received = env;
				}),
				['-e', 'A=b=c'],
			);

			expect(result.exitCode).toBe(0);
			expect(received).toEqual({ A: 'b=c' });
		});

		it('rejects a value with no =', async () => {
			const result = await runCommand(
				keyValueCommand(() => {}),
				['--env', 'noequals'],
			);

			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('INVALID_VALUE');
		});

		it('rejects a value with an empty key', async () => {
			const result = await runCommand(
				keyValueCommand(() => {}),
				['--env', '=x'],
			);

			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('INVALID_VALUE');
		});
	});

	// --- env and config resolution

	describe('env and config resolution', () => {
		function envKeyValueCommand(onFlags: (env: Record<string, string>) => void) {
			return command('smoke')
				.flag('env', flag.keyValue().alias('e').env('SMOKE_ENV').config('envs'))
				.action(({ flags }) => {
					onFlags(flags.env);
				});
		}

		it('parses comma-separated pairs from an env var', async () => {
			let received: Record<string, string> | undefined;
			const result = await runCommand(
				envKeyValueCommand((env) => {
					received = env;
				}),
				[],
				{ env: { SMOKE_ENV: 'A=1,B=2' } },
			);

			expect(result.exitCode).toBe(0);
			expect(received).toEqual({ A: '1', B: '2' });
		});

		it('accepts a plain object from config', async () => {
			let received: Record<string, string> | undefined;
			const result = await runCommand(
				envKeyValueCommand((env) => {
					received = env;
				}),
				[],
				{ config: { envs: { A: '1', B: '2' } } },
			);

			expect(result.exitCode).toBe(0);
			expect(received).toEqual({ A: '1', B: '2' });
		});

		it('rejects a config object with non-string values', async () => {
			const result = await runCommand(
				envKeyValueCommand(() => {}),
				[],
				{
					config: { envs: { PORT: 8080 } },
				},
			);

			expect(result.exitCode).toBe(2);
			expect(result.error?.code).toBe('TYPE_MISMATCH');
		});
	});

	// --- help output

	describe('help output', () => {
		it('renders the <key=value> hint', async () => {
			const cmd = command('smoke')
				.flag('env', flag.keyValue().alias('e').describe('Environment variables'))
				.action(() => {});

			const result = await runCommand(cmd, ['--help']);
			expect(result.exitCode).toBe(0);

			const helpText = result.stdout.join('');
			const envLine = helpText.split('\n').find((line) => line.includes('--env'));

			expect(envLine).toBeDefined();
			expect(envLine ?? '').toContain('<key=value>');
		});
	});
});
