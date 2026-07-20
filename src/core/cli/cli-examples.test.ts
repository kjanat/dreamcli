/**
 * End-to-end tests for function-form `.example()` commands, which resolve
 * against the invoked program name/version at render time.
 */
import { describe, expect, it } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { cli } from './index.ts';

function deployCommand() {
	return command('deploy')
		.description('Deploy the app')
		.example((m) => `${m.name} deploy --force`, 'Force deploy')
		.action(({ out }) => {
			out.log('deployed');
		});
}

describe('function-form examples — end to end', () => {
	it('resolves meta.name to the invoked program name in command help', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--help']);
		expect(result.stdout.join('')).toContain('$ mycli deploy --force');
	});

	it('reflects an inheritName-style binName override', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--help'], { help: { binName: 'renamed' } });
		expect(result.stdout.join('')).toContain('$ renamed deploy --force');
	});

	it('passes the program version to function-form examples', async () => {
		const app = cli('mycli')
			.version('4.2.0')
			.command(
				command('gen')
					.example((m) => `gen@${m.version ?? 'dev'}`)
					.action(() => {}),
			);
		const result = await app.execute(['gen', '--help']);
		expect(result.stdout.join('')).toContain('$ gen@4.2.0');
	});

	it('serializes the resolved command in --json help, matching text help', async () => {
		const app = cli('mycli').command(deployCommand());
		const result = await app.execute(['deploy', '--help', '--json']);
		const parsed = JSON.parse(result.stdout.join('')) as { examples?: { command: string }[] };
		expect(parsed.examples?.[0]?.command).toBe('mycli deploy --force');
	});
});
