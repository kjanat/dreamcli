/**
 * Tests for the build-time `RESERVED_FLAG` guard covering command flags the CLI
 * root already owns (#84).
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { CLIDefinition } from './index.ts';
import { cli, createCLISchema } from './index.ts';
import { readRootOutputFlags } from './root-output-flags.ts';

// === Helpers

function commandWithFlag<B extends FlagBuilder<FlagConfig>>(name: string, builder: B) {
	return command('serve')
		.flag(name, builder)
		.action(() => {});
}

function booleanCommand(name: string) {
	return commandWithFlag(name, flag.boolean());
}

function reservedError(register: () => unknown): CLIError {
	let thrown: unknown;
	try {
		register();
	} catch (error: unknown) {
		thrown = error;
	}

	expect(thrown).toBeInstanceOf(CLIError);
	if (!(thrown instanceof CLIError)) throw new Error('unreachable');
	return thrown;
}

// === Unconditionally reserved names and aliases

describe('reserved root flags', () => {
	describe('unconditional reservations', () => {
		it.each(['quiet', 'json', 'help'])('rejects a command flag named %s', (name) => {
			expect(() => cli('mycli').command(booleanCommand(name))).toThrow(CLIError);
		});

		it.each(['q', 'h'])('rejects a command flag aliased %s', (alias) => {
			expect(() =>
				cli('mycli').command(commandWithFlag('quick', flag.boolean().alias(alias))),
			).toThrow(CLIError);
		});

		it.each(['q', 'h'])('rejects a single-char command flag named %s', (name) => {
			expect(() => cli('mycli').command(booleanCommand(name))).toThrow(CLIError);
		});

		it('rejects a long alias that spells a reserved name', () => {
			expect(() =>
				cli('mycli').command(commandWithFlag('silent', flag.boolean().alias('quiet'))),
			).toThrow(CLIError);
		});

		it('rejects a hidden reserved alias', () => {
			expect(() =>
				cli('mycli').command(commandWithFlag('hush', flag.boolean().alias('q', { hidden: true }))),
			).toThrow(CLIError);
		});

		it('rejects a reserved flag on a nested subcommand', () => {
			const parent = command('db').command(
				command('migrate')
					.flag('json', flag.boolean())
					.action(() => {}),
			);

			expect(() => cli('mycli').command(parent)).toThrow(CLIError);
		});

		it('rejects a reserved flag on the default command', () => {
			expect(() => cli('mycli').default(booleanCommand('quiet'))).toThrow(CLIError);
		});

		it.each(['quiet', 'json', 'help'])('rejects a negated spelling of %s', (spelling) => {
			expect(() =>
				cli('mycli').command(
					commandWithFlag('loud', flag.boolean().default(true).negatable({ alias: spelling })),
				),
			).toThrow(CLIError);
		});

		it('rejects a hidden negated spelling of a reserved token', () => {
			expect(() =>
				cli('mycli').command(
					commandWithFlag(
						'loud',
						flag.boolean().default(true).negatable({ alias: 'q', hidden: true }),
					),
				),
			).toThrow(CLIError);
		});
	});

	// --- version, reserved only once a version is configured

	describe('version reservations', () => {
		it('allows a version flag and a V alias when no version is configured', () => {
			expect(() => cli('mycli').command(booleanCommand('version'))).not.toThrow();
			expect(() =>
				cli('mycli').command(commandWithFlag('verbose', flag.boolean().alias('V'))),
			).not.toThrow();
		});

		it('rejects a version flag registered after .version()', () => {
			expect(() => cli('mycli').version('1.0.0').command(booleanCommand('version'))).toThrow(
				CLIError,
			);
		});

		it('rejects a V alias registered after .version()', () => {
			expect(() =>
				cli('mycli')
					.version('1.0.0')
					.command(commandWithFlag('verbose', flag.boolean().alias('V'))),
			).toThrow(CLIError);
		});

		it('rejects .version() after the colliding command is registered', () => {
			expect(() => cli('mycli').command(booleanCommand('version')).version('1.0.0')).toThrow(
				CLIError,
			);
			expect(() =>
				cli('mycli')
					.command(commandWithFlag('verbose', flag.boolean().alias('V')))
					.version('1.0.0'),
			).toThrow(CLIError);
		});

		it('rejects .version() after the colliding default command is registered', () => {
			expect(() => cli('mycli').default(booleanCommand('version')).version('1.0.0')).toThrow(
				CLIError,
			);
		});

		it('rejects .manifest(data) whose version reaches a colliding command', () => {
			expect(() =>
				cli('mycli').command(booleanCommand('version')).manifest({ version: '1.0.0' }),
			).toThrow(CLIError);
		});

		it('rejects a negated spelling of version only once a version is configured', () => {
			const negatedVersion = flag.boolean().default(true).negatable({ alias: 'version' });

			expect(() => cli('mycli').command(commandWithFlag('loud', negatedVersion))).not.toThrow();
			expect(() =>
				cli('mycli').command(commandWithFlag('loud', negatedVersion)).version('1.0.0'),
			).toThrow(CLIError);
		});
	});

	// --- definition path

	describe('createCLISchema', () => {
		it('rejects a reserved flag on a command definition', () => {
			const error = reservedError(() =>
				createCLISchema({
					name: 'mycli',
					commands: [{ name: 'serve', flags: { quiet: { kind: 'boolean' } } }],
				}),
			);

			expect(error.code).toBe('RESERVED_FLAG');
		});

		it('rejects a reserved flag on a nested command definition', () => {
			expect(() =>
				createCLISchema({
					name: 'mycli',
					commands: [
						{ name: 'db', commands: [{ name: 'migrate', flags: { json: { kind: 'boolean' } } }] },
					],
				}),
			).toThrow(CLIError);
		});

		it('rejects a reserved flag on a default command definition', () => {
			expect(() =>
				createCLISchema({
					name: 'mycli',
					defaultCommand: { name: 'serve', flags: { help: { kind: 'boolean' } } },
				}),
			).toThrow(CLIError);
		});

		it('reserves version only when the definition declares one', () => {
			const definition: CLIDefinition = {
				name: 'mycli',
				commands: [{ name: 'serve', flags: { version: { kind: 'boolean' } } }],
			};

			expect(() => createCLISchema(definition)).not.toThrow();
			expect(() => createCLISchema({ ...definition, version: '1.0.0' })).toThrow(CLIError);
		});
	});

	// --- error shape

	describe('error shape', () => {
		it('carries the code, both flag names, and the rename-or-status remedy', () => {
			const error = reservedError(() => cli('mycli').command(booleanCommand('quiet')));

			expect(error.code).toBe('RESERVED_FLAG');
			expect(error.message).toContain("Command 'serve' defines a '--quiet' flag");
			expect(error.message).toContain("reserved by the root '--quiet' flag");
			expect(error.message).toContain('so the command can never receive it');
			expect(error.suggest).toBe(
				'Rename the flag, or use out.status() for output that root --quiet suppresses',
			);
		});

		it('names the alias and its owning flag when the collision is an alias', () => {
			const error = reservedError(() =>
				cli('mycli').command(commandWithFlag('quick', flag.boolean().alias('q'))),
			);

			expect(error.message).toContain("defines a '-q' alias on flag 'quick'");
		});

		it('names the negated spelling and its owning flag', () => {
			const error = reservedError(() =>
				cli('mycli').command(
					commandWithFlag('loud', flag.boolean().default(true).negatable({ alias: 'quiet' })),
				),
			);

			expect(error.message).toContain("defines a '--quiet' negated spelling on flag 'loud'");
		});

		it('suggests renaming for the non-quiet reservations', () => {
			const error = reservedError(() => cli('mycli').command(booleanCommand('json')));

			expect(error.suggest).toBe('Rename the flag');
		});

		it('explains help interception without claiming the root strips it', () => {
			const error = reservedError(() => cli('mycli').command(booleanCommand('help')));

			expect(error.message).toContain('A help request renders before flags are parsed');
			expect(error.message).not.toContain('strips');
		});

		it('says the root intercepts the version token', () => {
			const error = reservedError(() =>
				cli('mycli').version('1.0.0').command(booleanCommand('version')),
			);

			expect(error.message).toContain('The root intercepts that token before dispatch');
		});
	});

	// --- near misses stay legal

	describe('near misses', () => {
		it.each(['jsonOutput', 'quietMode', 'helpTopic', 'versionTag', 'no-json'])(
			'allows a flag named %s',
			(name) => {
				expect(() => cli('mycli').version('1.0.0').command(booleanCommand(name))).not.toThrow();
			},
		);

		it.each(['Q', 'H', 'j'])('allows a flag aliased %s', (alias) => {
			expect(() =>
				cli('mycli')
					.version('1.0.0')
					.command(commandWithFlag('quick', flag.boolean().alias(alias))),
			).not.toThrow();
		});

		it('allows a negatable boolean', () => {
			expect(() =>
				cli('mycli').command(commandWithFlag('color', flag.boolean().default(true).negatable())),
			).not.toThrow();
		});

		it('allows a custom negated spelling that is not reserved', () => {
			expect(() =>
				cli('mycli').command(
					commandWithFlag('loud', flag.boolean().default(true).negatable({ alias: 'silent' })),
				),
			).not.toThrow();
		});
	});

	// --- the reserved set matches what the root layer actually takes

	describe('agreement with the root layer', () => {
		it.each(['--json', '--quiet', '-q'])('strips %s ahead of the command', (token) => {
			expect(readRootOutputFlags(['serve', token]).argv).toEqual(['serve']);
		});

		it.each(['-Q', '-j', '--no-json', '--quietMode'])('leaves %s for the command', (token) => {
			expect(readRootOutputFlags(['serve', token]).argv).toEqual(['serve', token]);
		});

		it('renders help instead of running the command for --help and -h', async () => {
			const app = cli('mycli').command(
				command('serve')
					.description('Serve it')
					.action(({ out }) => out.log('ran')),
			);

			for (const token of ['--help', '-h']) {
				const result = await app.execute(['serve', token]);
				expect(result.stdout.join('')).not.toContain('ran');
				expect(result.stdout.join('')).toContain('Serve it');
			}
		});

		it('intercepts --version and -V only once a version is configured', async () => {
			const serve = command('serve').action(({ out }) => out.log('ran'));
			const versioned = cli('mycli').version('9.9.9').command(serve);

			for (const token of ['--version', '-V']) {
				expect((await versioned.execute(['serve', token])).stdout.join('')).toContain('9.9.9');
			}

			const unversioned = await cli('mycli').command(serve).execute(['serve', '--version']);
			expect(unversioned.stdout.join('')).not.toContain('9.9.9');
		});
	});
});
