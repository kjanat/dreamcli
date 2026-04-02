/**
 * Tests for prompt wiring through testkit and CLI builder.
 *
 * Validates the `answers` convenience field on RunOptions,
 * prompter threading through CLIBuilder.execute()/run(),
 * and help text annotations for promptable flags.
 */

import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { createTestPrompter, PROMPT_CANCEL } from '#internals/core/prompt/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from './index.ts';

// === runCommand — answers convenience field

describe('runCommand — answers convenience', () => {
	it('resolves a prompted flag from answers', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], { answers: ['us'] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=us\n']);
	});

	it('resolves multiple prompted flags from answers in order', async () => {
		const cmd = command('setup')
			.flag('name', flag.string().prompt({ kind: 'input', message: 'Name?' }))
			.flag('confirm', flag.boolean().prompt({ kind: 'confirm', message: 'Sure?' }))
			.action(({ flags, out }) => {
				out.log(`name=${flags.name} confirm=${String(flags.confirm)}`);
			});

		const result = await runCommand(cmd, [], { answers: ['Alice', true] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['name=Alice confirm=true\n']);
	});

	it('supports PROMPT_CANCEL in answers (falls to default)', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag.enum(['us', 'eu']).default('us').prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], { answers: [PROMPT_CANCEL] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=us\n']);
	});

	it('PROMPT_CANCEL on required flag without default produces error', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag.enum(['us', 'eu']).required().prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], { answers: [PROMPT_CANCEL] });

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('REQUIRED_FLAG');
	});

	it('CLI value takes precedence over answers', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, ['--region', 'eu'], { answers: ['us'] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('env value takes precedence over answers', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag.enum(['us', 'eu']).env('DEPLOY_REGION').prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], {
			env: { DEPLOY_REGION: 'eu' },
			answers: ['us'],
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('config value takes precedence over answers', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag
					.enum(['us', 'eu'])
					.config('deploy.region')
					.prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], {
			config: { deploy: { region: 'eu' } },
			answers: ['us'],
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('explicit prompter takes precedence over answers', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], {
			prompter: createTestPrompter(['eu']),
			answers: ['us'], // should be ignored
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('no answers and no prompter skips prompting', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag.enum(['us', 'eu']).default('us').prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, []);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=us\n']);
	});

	it('answers work with confirm prompt kind', async () => {
		const cmd = command('rm')
			.flag('force', flag.boolean().prompt({ kind: 'confirm', message: 'Delete?' }))
			.action(({ flags, out }) => {
				out.log(`force=${String(flags.force)}`);
			});

		const result = await runCommand(cmd, [], { answers: [true] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['force=true\n']);
	});

	it('answers work with input prompt kind', async () => {
		const cmd = command('greet')
			.flag('name', flag.string().prompt({ kind: 'input', message: 'Name?' }))
			.action(({ flags, out }) => {
				out.log(`name=${flags.name}`);
			});

		const result = await runCommand(cmd, [], { answers: ['Alice'] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['name=Alice\n']);
	});

	it('answers work with multiselect prompt kind', async () => {
		const cmd = command('deploy')
			.flag(
				'regions',
				flag.array(flag.string()).prompt({
					kind: 'multiselect',
					message: 'Regions?',
					choices: [{ value: 'us' }, { value: 'eu' }],
				}),
			)
			.action(({ flags, out }) => {
				const regions: string[] = flags.regions ?? [];
				out.log(`regions=${regions.join(',')}`);
			});

		const result = await runCommand(cmd, [], { answers: [['us', 'eu']] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['regions=us,eu\n']);
	});

	it('answers work with number coercion', async () => {
		const cmd = command('set')
			.flag('port', flag.number().prompt({ kind: 'input', message: 'Port?' }))
			.action(({ flags, out }) => {
				out.log(`port=${String(flags.port)}`);
			});

		const result = await runCommand(cmd, [], { answers: ['8080'] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['port=8080\n']);
	});

	it('empty answers array means no prompts answered', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag.enum(['us', 'eu']).default('us').prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		// Empty answers → test prompter exhausted → onExhausted default is 'throw'
		// But since CLI builder creates prompter from answers, exhausted throws error.
		// However runCommand catches all errors. The prompter will throw when a prompt
		// is attempted but queue is empty — this is caught as UNEXPECTED_ERROR.
		// Actually with empty answers, the createTestPrompter will throw on first prompt,
		// but since answers=[] and a prompt is configured, it will try to prompt and fail.
		const result = await runCommand(cmd, [], { answers: [] });

		// The test prompter throws when exhausted → wraps as UNEXPECTED_ERROR
		expect(result.exitCode).toBe(1);
		expect(result.error?.code).toBe('UNEXPECTED_ERROR');
	});
});

// === runCommand — answers + interactive resolver

describe('runCommand — answers with interactive resolver', () => {
	it('interactive resolver can override per-flag prompt via answers', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']))
			.flag('force', flag.boolean())
			.interactive(({ flags }) => ({
				region: !flags.region && { kind: 'select' as const, message: 'Region?' },
				force: !flags.force && { kind: 'confirm' as const, message: 'Force?' },
			}))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region} force=${String(flags.force)}`);
			});

		const result = await runCommand(cmd, [], { answers: ['us', true] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=us force=true\n']);
	});

	it('interactive resolver suppression (false) skips prompt', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).default('us'))
			.flag('force', flag.boolean().prompt({ kind: 'confirm', message: 'Force?' }))
			.interactive(() => ({
				force: false, // suppress prompting for force
			}))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region} force=${String(flags.force)}`);
			});

		// force is suppressed → falls to default (false for boolean)
		const result = await runCommand(cmd, [], { answers: [] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=us force=false\n']);
	});
});

// === CLIBuilder.execute() — answers threading

describe('CLIBuilder.execute() — answers threading', () => {
	it('threads answers through to command execution', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const app = cli('test').command(cmd);
		const result = await app.execute(['deploy'], { answers: ['eu'] });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('threads prompter through to command execution', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const app = cli('test').command(cmd);
		const result = await app.execute(['deploy'], {
			prompter: createTestPrompter(['us']),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=us\n']);
	});

	it('explicit prompter takes precedence over answers in CLI execute', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const app = cli('test').command(cmd);
		const result = await app.execute(['deploy'], {
			prompter: createTestPrompter(['eu']),
			answers: ['us'], // ignored
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('answers combined with env/config in CLI execute', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag.enum(['us', 'eu']).env('DEPLOY_REGION').prompt({ kind: 'select', message: 'Region?' }),
			)
			.flag('name', flag.string().prompt({ kind: 'input', message: 'Name?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region} name=${flags.name}`);
			});

		const app = cli('test').command(cmd);
		const result = await app.execute(['deploy'], {
			env: { DEPLOY_REGION: 'eu' }, // region resolved from env
			answers: ['Alice'], // name resolved from prompt
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu name=Alice\n']);
	});
});

// === Help text — [prompt] annotation

describe('help text — prompt annotation', () => {
	it('shows [prompt] annotation for promptable flags', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(() => {});

		const result = await runCommand(cmd, ['--help']);

		expect(result.exitCode).toBe(0);
		const helpText = result.stdout.join('');
		expect(helpText).toContain('[prompt]');
	});

	it('does not show [prompt] for non-promptable flags', async () => {
		const cmd = command('deploy')
			.flag('force', flag.boolean())
			.action(() => {});

		const result = await runCommand(cmd, ['--help']);

		expect(result.exitCode).toBe(0);
		const helpText = result.stdout.join('');
		expect(helpText).not.toContain('[prompt]');
	});

	it('[prompt] annotation appears between [config] and [required]', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag
					.enum(['us', 'eu'])
					.env('DEPLOY_REGION')
					.config('deploy.region')
					.required()
					.prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(() => {});

		const result = await runCommand(cmd, ['--help'], { help: { width: 200 } });

		expect(result.exitCode).toBe(0);
		const helpText = result.stdout.join('');
		// Order: description → [env] → [config] → [prompt] → [required]
		const envIdx = helpText.indexOf('[env: DEPLOY_REGION]');
		const configIdx = helpText.indexOf('[config: deploy.region]');
		const promptIdx = helpText.indexOf('[prompt]');
		const requiredIdx = helpText.indexOf('[required]');

		expect(envIdx).toBeGreaterThan(-1);
		expect(configIdx).toBeGreaterThan(-1);
		expect(promptIdx).toBeGreaterThan(-1);
		expect(requiredIdx).toBeGreaterThan(-1);
		expect(configIdx).toBeLessThan(promptIdx);
		expect(promptIdx).toBeLessThan(requiredIdx);
	});

	it('[prompt] with description and default', async () => {
		const cmd = command('set')
			.flag(
				'port',
				flag
					.number()
					.default(3000)
					.describe('Server port')
					.prompt({ kind: 'input', message: 'Port?' }),
			)
			.action(() => {});

		const result = await runCommand(cmd, ['--help'], { help: { width: 200 } });

		expect(result.exitCode).toBe(0);
		const helpText = result.stdout.join('');
		expect(helpText).toContain('Server port');
		expect(helpText).toContain('[prompt]');
		expect(helpText).toContain('(default: 3000)');
	});
});

// === Backward compatibility

describe('backward compatibility', () => {
	it('existing tests without answers/prompter continue to work', async () => {
		const cmd = command('greet')
			.arg('name', arg.string())
			.action(({ args, out }) => {
				out.log(`Hello, ${args.name}!`);
			});

		const result = await runCommand(cmd, ['World']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Hello, World!\n']);
	});

	it('runCommand with env still works', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).env('REGION').default('us'))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], { env: { REGION: 'eu' } });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('runCommand with config still works', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).config('deploy.region').default('us'))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], {
			config: { deploy: { region: 'eu' } },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});

	it('runCommand with explicit prompter still works', async () => {
		const cmd = command('deploy')
			.flag('region', flag.enum(['us', 'eu']).prompt({ kind: 'select', message: 'Region?' }))
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		const result = await runCommand(cmd, [], {
			prompter: createTestPrompter(['eu']),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['region=eu\n']);
	});
});

// === Full resolution chain through testkit: CLI > env > config > prompt > default

describe('full resolution chain through testkit', () => {
	it('CLI > env > config > prompt > default', async () => {
		const cmd = command('deploy')
			.flag(
				'region',
				flag
					.enum(['us', 'eu', 'ap'])
					.env('DEPLOY_REGION')
					.config('deploy.region')
					.default('us')
					.prompt({ kind: 'select', message: 'Region?' }),
			)
			.action(({ flags, out }) => {
				out.log(`region=${flags.region}`);
			});

		// CLI wins
		const r1 = await runCommand(cmd, ['--region', 'ap'], {
			env: { DEPLOY_REGION: 'eu' },
			config: { deploy: { region: 'us' } },
			answers: ['eu'],
		});
		expect(r1.stdout).toEqual(['region=ap\n']);

		// Env wins when no CLI
		const r2 = await runCommand(cmd, [], {
			env: { DEPLOY_REGION: 'eu' },
			config: { deploy: { region: 'ap' } },
			answers: ['us'],
		});
		expect(r2.stdout).toEqual(['region=eu\n']);

		// Config wins when no CLI/env
		const r3 = await runCommand(cmd, [], {
			config: { deploy: { region: 'ap' } },
			answers: ['us'],
		});
		expect(r3.stdout).toEqual(['region=ap\n']);

		// Prompt wins when no CLI/env/config
		const r4 = await runCommand(cmd, [], {
			answers: ['eu'],
		});
		expect(r4.stdout).toEqual(['region=eu\n']);

		// Default wins when no CLI/env/config/prompt
		const r5 = await runCommand(cmd, []);
		expect(r5.stdout).toEqual(['region=us\n']);
	});
});

// === Public surface exports

describe('public surface exports', () => {
	it('RunOptions type accepts answers field', async () => {
		// This is a compile-time check — if it compiles, the type is correct
		const cmd = command('test').action(({ out }) => {
			out.log('ok');
		});

		const result = await runCommand(cmd, [], { answers: ['a', 1, true, PROMPT_CANCEL] });
		// The answers won't be consumed (no prompted flags), but the type accepts them
		expect(result.exitCode).toBe(0);
	});
});
