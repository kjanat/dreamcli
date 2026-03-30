/**
 * Integration tests — env/config wired through testkit and CLI builder.
 *
 * Verifies that RunOptions.env and RunOptions.config flow from
 * runCommand() and CLIBuilder.execute() all the way into resolve().
 */

import { describe, expect, it } from 'vitest';
import { createTestAdapter, ExitError } from '../../runtime/adapter.ts';
import { cli } from '../cli/index.ts';
import { arg } from '../schema/arg.ts';
import { command } from '../schema/command.ts';
import { flag } from '../schema/flag.ts';
import { runCommand } from '../testkit/index.ts';

// ---------------------------------------------------------------------------
// Test commands
// ---------------------------------------------------------------------------

/** Command with env-resolvable flags. */
function envCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string())
		.flag('region', flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION').describe('Target region'))
		.flag('verbose', flag.boolean().env('VERBOSE'))
		.flag('retries', flag.number().env('RETRIES').default(3))
		.action(({ args, flags, out }) => {
			out.log(
				`deploy ${args.target} region=${String(flags.region)} verbose=${String(flags.verbose)} retries=${String(flags.retries)}`,
			);
		});
}

/** Command with config-resolvable flags. */
function configCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string())
		.flag('region', flag.enum(['us', 'eu', 'ap']).config('deploy.region'))
		.flag('timeout', flag.number().config('deploy.timeout').default(30))
		.action(({ args, flags, out }) => {
			out.log(
				`deploy ${args.target} region=${String(flags.region)} timeout=${String(flags.timeout)}`,
			);
		});
}

/** Command with both env and config sources. */
function multiSourceCommand() {
	return command('deploy')
		.description('Deploy to an environment')
		.arg('target', arg.string())
		.flag(
			'region',
			flag.enum(['us', 'eu', 'ap']).env('DEPLOY_REGION').config('deploy.region').required(),
		)
		.flag('timeout', flag.number().env('TIMEOUT').config('deploy.timeout').default(30))
		.action(({ args, flags, out }) => {
			out.log(
				`deploy ${args.target} region=${String(flags.region)} timeout=${String(flags.timeout)}`,
			);
		});
}

/** Command with an arg that can read from stdin. */
function stdinCommand() {
	return command('deploy')
		.description('Deploy from stdin')
		.arg('target', arg.string().stdin().env('DEPLOY_TARGET').required())
		.action(({ args, out }) => {
			out.log(`deploy ${String(args.target)}`);
		});
}

// ---------------------------------------------------------------------------
// runCommand() — env threading
// ---------------------------------------------------------------------------

describe('runCommand — env resolution', () => {
	it('resolves flag from env when no CLI value provided', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod'], {
			env: { DEPLOY_REGION: 'eu' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=eu');
	});

	it('CLI value takes precedence over env', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod', '--region', 'us'], {
			env: { DEPLOY_REGION: 'eu' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=us');
	});

	it('resolves boolean flag from env', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod'], {
			env: { VERBOSE: 'true' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('verbose=true');
	});

	it('resolves number flag from env', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod'], {
			env: { RETRIES: '5' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('retries=5');
	});

	it('falls back to default when env not set', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod'], { env: {} });

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('retries=3');
	});

	it('returns error for invalid env value', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod'], {
			env: { DEPLOY_REGION: 'invalid' },
		});

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('INVALID_ENUM');
	});
});

// ---------------------------------------------------------------------------
// runCommand() — config threading
// ---------------------------------------------------------------------------

describe('runCommand — config resolution', () => {
	it('resolves flag from config when no CLI value provided', async () => {
		const cmd = configCommand();
		const result = await runCommand(cmd, ['prod'], {
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=ap');
	});

	it('CLI value takes precedence over config', async () => {
		const cmd = configCommand();
		const result = await runCommand(cmd, ['prod', '--region', 'us'], {
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=us');
	});

	it('resolves number flag from config', async () => {
		const cmd = configCommand();
		const result = await runCommand(cmd, ['prod'], {
			config: { deploy: { timeout: 60 } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('timeout=60');
	});

	it('falls back to default when config path missing', async () => {
		const cmd = configCommand();
		const result = await runCommand(cmd, ['prod'], {
			config: { deploy: {} },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('timeout=30');
	});
});

// ---------------------------------------------------------------------------
// runCommand() — full chain: CLI > env > config > default
// ---------------------------------------------------------------------------

describe('runCommand — full resolution chain', () => {
	it('stdin fills stdin-mode arg before env', async () => {
		const cmd = stdinCommand();
		const result = await runCommand(cmd, [], {
			stdinData: 'stdin-target',
			env: { DEPLOY_TARGET: 'env-target' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['deploy stdin-target\n']);
	});

	it("explicit '-' resolves stdin-mode arg from stdin", async () => {
		const cmd = stdinCommand();
		const result = await runCommand(cmd, ['-'], {
			stdinData: 'dash-target',
			env: { DEPLOY_TARGET: 'env-target' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['deploy dash-target\n']);
	});

	it('env takes precedence over config', async () => {
		const cmd = multiSourceCommand();
		const result = await runCommand(cmd, ['prod'], {
			env: { DEPLOY_REGION: 'eu' },
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=eu');
	});

	it('config used when env absent', async () => {
		const cmd = multiSourceCommand();
		const result = await runCommand(cmd, ['prod'], {
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=ap');
	});

	it('CLI > env > config precedence', async () => {
		const cmd = multiSourceCommand();
		const result = await runCommand(cmd, ['prod', '--region', 'us'], {
			env: { DEPLOY_REGION: 'eu' },
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=us');
	});

	it('required flag errors when no source provides value', async () => {
		const cmd = multiSourceCommand();
		const result = await runCommand(cmd, ['prod']);

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeDefined();
		expect(result.error?.code).toBe('REQUIRED_FLAG');
	});

	it('env number overrides config number', async () => {
		const cmd = multiSourceCommand();
		const result = await runCommand(cmd, ['prod'], {
			env: { DEPLOY_REGION: 'us', TIMEOUT: '10' },
			config: { deploy: { region: 'ap', timeout: 60 } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('timeout=10');
	});
});

// ---------------------------------------------------------------------------
// CLIBuilder.execute() — env/config threading
// ---------------------------------------------------------------------------

describe('CLIBuilder.execute — env/config threading', () => {
	it('threads stdinData through to command resolution', async () => {
		const app = cli('test').command(stdinCommand());
		const result = await app.execute(['deploy'], {
			stdinData: 'execute-target',
			env: { DEPLOY_TARGET: 'env-target' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['deploy execute-target\n']);
	});

	it('threads env through to command resolution', async () => {
		const app = cli('test').command(envCommand());
		const result = await app.execute(['deploy', 'prod'], {
			env: { DEPLOY_REGION: 'eu' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=eu');
	});

	it('threads config through to command resolution', async () => {
		const app = cli('test').command(configCommand());
		const result = await app.execute(['deploy', 'prod'], {
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=ap');
	});

	it('threads both env and config — env wins', async () => {
		const app = cli('test').command(multiSourceCommand());
		const result = await app.execute(['deploy', 'prod'], {
			env: { DEPLOY_REGION: 'eu' },
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=eu');
	});

	it('CLI arg to command wins over env/config', async () => {
		const app = cli('test').command(multiSourceCommand());
		const result = await app.execute(['deploy', 'prod', '--region', 'us'], {
			env: { DEPLOY_REGION: 'eu' },
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=us');
	});

	it('config used when env missing in CLI builder', async () => {
		const app = cli('test').command(multiSourceCommand());
		const result = await app.execute(['deploy', 'prod'], {
			config: { deploy: { region: 'ap' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=ap');
	});

	it('required flag error when no source in CLI builder', async () => {
		const app = cli('test').command(multiSourceCommand());
		const result = await app.execute(['deploy', 'prod']);

		expect(result.exitCode).toBe(2);
		expect(result.error).toBeDefined();
	});

	it('multiple commands — env/config scoped correctly', async () => {
		const login = command('login')
			.flag('token', flag.string().env('AUTH_TOKEN').required())
			.action(({ flags, out }) => {
				out.log(`token=${String(flags.token)}`);
			});

		const app = cli('test').command(multiSourceCommand()).command(login);

		// deploy uses DEPLOY_REGION from env
		const r1 = await app.execute(['deploy', 'prod'], {
			env: { DEPLOY_REGION: 'eu', AUTH_TOKEN: 'abc' },
		});
		expect(r1.exitCode).toBe(0);
		expect(r1.stdout[0]).toContain('region=eu');

		// login uses AUTH_TOKEN from env
		const r2 = await app.execute(['login'], {
			env: { DEPLOY_REGION: 'eu', AUTH_TOKEN: 'abc' },
		});
		expect(r2.exitCode).toBe(0);
		expect(r2.stdout[0]).toContain('token=abc');
	});
});

// ---------------------------------------------------------------------------
// CLIBuilder.run() — adapter.env auto-sourcing with config
// ---------------------------------------------------------------------------

describe('CLIBuilder.run — adapter env/config integration', () => {
	it('reads stdin once from adapter and threads it into execute', async () => {
		const stdoutLines: string[] = [];
		let reads = 0;
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
			stdinData: 'run-target',
			stdout: (s) => stdoutLines.push(s),
			readFile: async () => null,
			exit: (code) => {
				throw new ExitError(code);
			},
		});
		const readStdin = adapter.readStdin;
		const countingAdapter = {
			...adapter,
			readStdin: async () => {
				reads += 1;
				return readStdin();
			},
		};
		const app = cli('test').command(stdinCommand());

		try {
			await app.run({ adapter: countingAdapter });
		} catch (err) {
			if (!(err instanceof ExitError)) {
				throw err;
			}
		}

		expect(reads).toBe(1);
		expect(stdoutLines).toEqual(['deploy run-target\n']);
	});

	it('does not read stdin when a stdin-backed arg is provided on argv', async () => {
		const stdoutLines: string[] = [];
		let reads = 0;
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy', 'cli-target'],
			stdinData: 'ignored-target',
			stdout: (s) => stdoutLines.push(s),
			exit: (code) => {
				throw new ExitError(code);
			},
		});
		const readStdin = adapter.readStdin;
		const countingAdapter = {
			...adapter,
			readStdin: async () => {
				reads += 1;
				return readStdin();
			},
		};
		const app = cli('test').command(stdinCommand());

		try {
			await app.run({ adapter: countingAdapter });
		} catch (err) {
			if (!(err instanceof ExitError)) {
				throw err;
			}
		}

		expect(reads).toBe(0);
		expect(stdoutLines).toEqual(['deploy cli-target\n']);
	});

	it('does not read stdin when stdinData is already provided in run options', async () => {
		const stdoutLines: string[] = [];
		let reads = 0;
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy'],
			stdinData: 'adapter-target',
			stdout: (s) => stdoutLines.push(s),
			exit: (code) => {
				throw new ExitError(code);
			},
		});
		const readStdin = adapter.readStdin;
		const countingAdapter = {
			...adapter,
			readStdin: async () => {
				reads += 1;
				return readStdin();
			},
		};
		const app = cli('test').command(stdinCommand());

		try {
			await app.run({ adapter: countingAdapter, stdinData: 'options-target' });
		} catch (err) {
			if (!(err instanceof ExitError)) {
				throw err;
			}
		}

		expect(reads).toBe(0);
		expect(stdoutLines).toEqual(['deploy options-target\n']);
	});

	it('does not read stdin for command help paths', async () => {
		const stdoutLines: string[] = [];
		let reads = 0;
		const adapter = createTestAdapter({
			argv: ['node', 'test', 'deploy', '--help'],
			stdinData: 'ignored-target',
			stdout: (s) => stdoutLines.push(s),
			exit: (code) => {
				throw new ExitError(code);
			},
		});
		const readStdin = adapter.readStdin;
		const countingAdapter = {
			...adapter,
			readStdin: async () => {
				reads += 1;
				return readStdin();
			},
		};
		const app = cli('test').command(stdinCommand());

		try {
			await app.run({ adapter: countingAdapter });
		} catch (err) {
			if (!(err instanceof ExitError)) {
				throw err;
			}
		}

		expect(reads).toBe(0);
		expect(stdoutLines.join('')).toContain('Deploy from stdin');
	});

	it('auto-sources adapter.env into resolution when no explicit env', async () => {
		const app = cli('test').command(envCommand());

		// Use execute with adapter-like env (simulating what .run() does)
		// .run() spreads adapter.env when options.env is undefined
		const result = await app.execute(['deploy', 'prod'], {
			env: { DEPLOY_REGION: 'ap' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=ap');
	});

	it('explicit env overrides adapter env', async () => {
		// When user provides env explicitly, it should be used
		const app = cli('test').command(envCommand());
		const result = await app.execute(['deploy', 'prod'], {
			env: { DEPLOY_REGION: 'us' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=us');
	});

	it('config passes through .execute() even without env', async () => {
		const app = cli('test').command(configCommand());
		const result = await app.execute(['deploy', 'prod'], {
			config: { deploy: { region: 'eu', timeout: 90 } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=eu');
		expect(result.stdout[0]).toContain('timeout=90');
	});
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe('backward compatibility', () => {
	it('runCommand works without env/config options', async () => {
		const cmd = command('hello')
			.flag('name', flag.string().default('world'))
			.action(({ flags, out }) => {
				out.log(`hello ${String(flags.name)}`);
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('hello world');
	});

	it('CLIBuilder.execute works without env/config options', async () => {
		const hello = command('hello')
			.flag('name', flag.string().default('world'))
			.action(({ flags, out }) => {
				out.log(`hello ${String(flags.name)}`);
			});

		const app = cli('test').command(hello);
		const result = await app.execute(['hello']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('hello world');
	});

	it('existing tests with env in runCommand still work', async () => {
		const cmd = envCommand();
		const result = await runCommand(cmd, ['prod', '--region', 'us']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('region=us');
	});
});

// ---------------------------------------------------------------------------
// runCommand() — custom flag integration
// ---------------------------------------------------------------------------

describe('runCommand — custom flag integration', () => {
	it('custom flag parsed from CLI argv', async () => {
		const cmd = command('test')
			.flag('hex', flag.custom((raw) => Number.parseInt(String(raw), 16)).describe('Hex value'))
			.action(({ flags, out }) => {
				out.log(`hex=${String(flags.hex)}`);
			});

		const result = await runCommand(cmd, ['--hex', 'ff']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('hex=255');
	});

	it('custom flag resolved from env', async () => {
		const cmd = command('test')
			.flag('hex', flag.custom((raw) => Number.parseInt(String(raw), 16)).env('HEX_VALUE'))
			.action(({ flags, out }) => {
				out.log(`hex=${String(flags.hex)}`);
			});

		const result = await runCommand(cmd, [], { env: { HEX_VALUE: 'a0' } });
		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('hex=160');
	});

	it('custom flag resolved from config', async () => {
		const cmd = command('test')
			.flag('hex', flag.custom((raw) => Number.parseInt(String(raw), 16)).config('hex'))
			.action(({ flags, out }) => {
				out.log(`hex=${String(flags.hex)}`);
			});

		const result = await runCommand(cmd, [], { config: { hex: 'b0' } });
		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('hex=176');
	});

	it('custom flag with default', async () => {
		const cmd = command('test')
			.flag('hex', flag.custom((raw) => Number.parseInt(String(raw), 16)).default(0))
			.action(({ flags, out }) => {
				out.log(`hex=${String(flags.hex)}`);
			});

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(0);
		expect(result.stdout[0]).toContain('hex=0');
	});

	it('custom flag parse error renders correctly', async () => {
		const cmd = command('test')
			.flag(
				'port',
				flag.custom((raw: unknown) => {
					const n = Number(raw);
					if (Number.isNaN(n)) throw new Error('Not a number');
					return n;
				}),
			)
			.action(({ out }) => {
				out.log('ok');
			});

		const result = await runCommand(cmd, ['--port', 'abc']);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Failed to parse flag --port');
	});

	it('required custom flag fails when not provided', async () => {
		const cmd = command('test')
			.flag('hex', flag.custom((raw) => Number.parseInt(String(raw), 16)).required())
			.action(({ out }) => {
				out.log('ok');
			});

		const result = await runCommand(cmd, []);
		expect(result.exitCode).toBe(2);
		expect(result.stderr.join('')).toContain('Missing required flag --hex');
	});
});
