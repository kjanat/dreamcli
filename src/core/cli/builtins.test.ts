/**
 * Tests for consumer-owned built-in flags — `.builtins()` and the released
 * `--help`, `--json`, `--quiet` tokens (#86).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { generateCompletion } from '#internals/core/completion/index.ts';
import { CLIError } from '#internals/core/errors/index.ts';
import { command } from '#internals/core/schema/command.ts';
import type { FlagBuilder, FlagConfig } from '#internals/core/schema/flag.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import type { BuiltinName } from './builtins.ts';
import { BUILTIN_NAMES, BUILTIN_SPECS } from './builtins.ts';
import type { BuiltinsConfig, CLIDefinition } from './index.ts';
import { cli, createCLISchema, resolveRenderContext } from './index.ts';

// === Helpers

const ALL_ON = { help: 'on', json: 'on', quiet: 'on' };

/** Echo one flag's value so an end-to-end delivery is observable in stdout. */
function echoFlag<N extends string, B extends FlagBuilder<FlagConfig>>(flagName: N, builder: B) {
	return command('show')
		.flag(flagName, builder)
		.action(({ flags, out }) => {
			out.log(`${flagName}=${String(flags[flagName])}`);
		});
}

/** Read the root-level word list out of a generated bash completion script. */
function rootCompletionWords(script: string): string {
	const lines = script.split('\n');
	const marker = lines.findIndex((line) => line.includes('Root-level completions'));
	expect(marker).toBeGreaterThan(-1);
	return lines[marker + 1] ?? '';
}

/** The flag spellings listed in the root-help `Global options:` block, in order. */
function globalOptionSpellings(output: string): readonly string[] {
	const lines = output.split('\n');
	const start = lines.findIndex((line) => line.includes('Global options:'));
	expect(start).toBeGreaterThan(-1);

	const spellings: string[] = [];
	for (const line of lines.slice(start + 1)) {
		const trimmed = line.trim();
		if (trimmed === '') break;
		if (!trimmed.startsWith('-')) continue;
		spellings.push(trimmed.split(/ {2,}/)[0] ?? '');
	}
	return spellings;
}

/** Capture the {@link CLIError} a build-time call throws. */
function buildError(build: () => unknown): CLIError {
	let thrown: unknown;
	try {
		build();
	} catch (error: unknown) {
		thrown = error;
	}

	expect(thrown).toBeInstanceOf(CLIError);
	if (!(thrown instanceof CLIError)) throw new Error('unreachable');
	return thrown;
}

// === Spelling-table exhaustiveness

describe('builtins — BUILTIN_NAMES exhaustiveness', () => {
	it('leaves no BuiltinName outside the array', () => {
		expectTypeOf<Exclude<BuiltinName, (typeof BUILTIN_NAMES)[number]>>().toBeNever();
	});

	it('walks every BUILTIN_SPECS entry exactly once', () => {
		expect([...BUILTIN_NAMES].sort()).toEqual(Object.keys(BUILTIN_SPECS).sort());
	});
});

// === Root-help ordering derived from the array

describe('builtins — Global options order', () => {
	it('lists the built-ins in BUILTIN_NAMES order with --version after --help', async () => {
		const app = cli('mycli')
			.version('1.0.0')
			.config('mycli')
			.command(command('show').action(() => {}));

		expect(globalOptionSpellings((await app.execute([])).stdout.join(''))).toEqual([
			'-h, --help',
			'-V, --version',
			'--json',
			'-q, --quiet',
			'--config <path>',
		]);
	});

	it('keeps --version first once help is released', async () => {
		const app = cli('mycli')
			.builtins({ help: 'off' })
			.version('1.0.0')
			.command(echoFlag('help', flag.string()));

		expect(globalOptionSpellings((await app.execute([])).stdout.join(''))).toEqual([
			'-V, --version',
			'--json',
			'-q, --quiet',
		]);
	});
});

// === Normalization

describe('builtins — normalization', () => {
	it('defaults every built-in to on', () => {
		expect(cli('mycli').schema.builtins).toEqual(ALL_ON);
		expect(createCLISchema({ name: 'mycli' }).builtins).toEqual(ALL_ON);
	});

	it('fills the untouched built-ins in when one is released', () => {
		expect(cli('mycli').builtins({ json: 'off' }).schema.builtins).toEqual({
			help: 'on',
			json: 'off',
			quiet: 'on',
		});
	});

	it('normalizes the builder and definition paths identically', () => {
		const fromBuilder = cli('mycli').builtins({ help: 'off', quiet: 'off' }).schema.builtins;
		const fromDefinition = createCLISchema({
			name: 'mycli',
			builtins: { help: 'off', quiet: 'off' },
		}).builtins;

		expect(fromBuilder).toEqual(fromDefinition);
	});

	it('re-feeding a built schema produces a deep-equal schema', () => {
		const built = createCLISchema({ name: 'mycli', builtins: { json: 'off' } });

		expect(createCLISchema(built)).toEqual(built);
	});

	it('merges repeated calls, last mode per built-in winning', () => {
		const app = cli('mycli')
			.builtins({ json: 'off', quiet: 'off' })
			.builtins({ quiet: 'on', help: 'off' });

		expect(app.schema.builtins).toEqual({ help: 'off', json: 'off', quiet: 'on' });
	});

	it('treats an explicit undefined as an omitted incremental setting', () => {
		const looselyTyped = { json: undefined, quiet: 'off' } as unknown as BuiltinsConfig;
		const app = cli('mycli').builtins({ json: 'off' }).builtins(looselyTyped);

		expect(app.schema.builtins).toEqual({ help: 'on', json: 'off', quiet: 'off' });
	});

	it('rejects a value that is neither mode on the definition path', () => {
		const definition: CLIDefinition = {
			name: 'mycli',
			builtins: { json: 'yes' } as unknown as BuiltinsConfig,
		};

		expect(buildError(() => createCLISchema(definition)).code).toBe('INVALID_SCHEMA');
	});

	it('rejects a value that is neither mode on the builder path', () => {
		const error = buildError(() =>
			cli('mycli').builtins({ quiet: 'disabled' } as unknown as BuiltinsConfig),
		);

		expect(error.code).toBe('INVALID_SCHEMA');
		expect(error.message).toContain("Built-in 'quiet' must be 'on' or 'off'");
	});
});

// === json released to the commands

describe("builtins — json: 'off'", () => {
	it('delivers a command flag named json, bare and with a value', async () => {
		const app = cli('mycli')
			.builtins({ json: 'off' })
			.command(echoFlag('json', flag.string().describe('Document to validate')));

		const spaced = await app.execute(['show', '--json', 'doc.json']);
		expect(spaced.exitCode).toBe(0);
		expect(spaced.stdout.join('')).toBe('json=doc.json\n');

		const inline = await app.execute(['show', '--json=doc.json']);
		expect(inline.exitCode).toBe(0);
		expect(inline.stdout.join('')).toBe('json=doc.json\n');
	});

	it('leaves the run in human mode when the released token is present', async () => {
		const app = cli('mycli').builtins({ json: 'off' }).command(echoFlag('json', flag.boolean()));

		const result = await app.execute(['show', '--json']);
		expect(result.stdout.join('')).toBe('json=true\n');
		expect(result.stderr).toEqual([]);
	});

	it('keeps the RunOptions jsonMode override working', async () => {
		const app = cli('mycli')
			.builtins({ json: 'off' })
			.command(
				command('show')
					.flag('json', flag.string())
					.action(({ out }) => {
						out.json({ mode: out.jsonMode });
					}),
			);

		const result = await app.execute(['show', '--json', 'doc.json'], { jsonMode: true });
		expect(JSON.parse(result.stdout.join(''))).toEqual({ mode: true });
	});

	it('drops --json from the root Global options block', async () => {
		const app = cli('mycli').builtins({ json: 'off' }).command(echoFlag('json', flag.string()));
		const output = (await app.execute([])).stdout.join('');

		expect(output).toContain('Global options:');
		expect(output).not.toContain('--json');
		expect(output).toContain('-q, --quiet');
	});

	it('renders the released flag in the command help flags block', async () => {
		const app = cli('mycli')
			.builtins({ json: 'off' })
			.command(echoFlag('json', flag.string().describe('Document to validate')));
		const output = (await app.execute(['show', '--help'])).stdout.join('');

		expect(output).toContain('--json');
		expect(output).toContain('Document to validate');
	});

	it('stops resolveRenderContext reading the released token', () => {
		expect(resolveRenderContext(['--json']).jsonMode).toBe(true);
		expect(resolveRenderContext(['--json'], { builtins: { json: 'off' } }).jsonMode).toBe(false);
	});
});

// === quiet released to the commands

describe("builtins — quiet: 'off'", () => {
	it('delivers a command flag named quiet through both spellings', async () => {
		const app = cli('mycli')
			.builtins({ quiet: 'off' })
			.command(echoFlag('quiet', flag.boolean().alias('q')));

		expect((await app.execute(['show', '--quiet'])).stdout.join('')).toBe('quiet=true\n');
		expect((await app.execute(['show', '-q'])).stdout.join('')).toBe('quiet=true\n');
	});

	it('keeps verbosity normal when argv carries the released token', async () => {
		const app = cli('mycli')
			.builtins({ quiet: 'off' })
			.command(
				command('show')
					.flag('quiet', flag.boolean())
					.action(({ out }) => {
						out.log(out.verbosity);
						out.status('still speaking');
					}),
			);

		const result = await app.execute(['show', '--quiet']);
		expect(result.stdout.join('')).toBe('normal\n');
		expect(result.stderr.join('')).toContain('still speaking');
	});

	it('keeps the RunOptions verbosity override working', async () => {
		const app = cli('mycli')
			.builtins({ quiet: 'off' })
			.command(
				command('show')
					.flag('quiet', flag.boolean())
					.action(({ out }) => {
						out.log(out.verbosity);
					}),
			);

		const result = await app.execute(['show', '--quiet'], { verbosity: 'quiet' });
		expect(result.stdout.join('')).toBe('quiet\n');
	});

	it('drops -q, --quiet from the root Global options block', async () => {
		const app = cli('mycli').builtins({ quiet: 'off' }).command(echoFlag('quiet', flag.boolean()));
		const output = (await app.execute([])).stdout.join('');

		expect(output).not.toContain('--quiet');
		expect(output).toContain('--json');
	});
});

// === help released to the commands

describe("builtins — help: 'off'", () => {
	function helpOwningApp() {
		return cli('mycli')
			.builtins({ help: 'off' })
			.command(echoFlag('help', flag.string().alias('h').describe('Topic to explain')));
	}

	it('stops root --help and -h interception', async () => {
		const app = helpOwningApp();

		for (const token of ['--help', '-h']) {
			const result = await app.execute([token, 'topics']);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout.join('')).not.toContain('Global options:');
		}
	});

	it('stops command-level help and delivers the flag instead', async () => {
		const app = helpOwningApp();

		expect((await app.execute(['show', '--help', 'flags'])).stdout.join('')).toBe('help=flags\n');
		expect((await app.execute(['show', '-h', 'flags'])).stdout.join('')).toBe('help=flags\n');
	});

	it('does not let released help bypass an invalid root output flag', async () => {
		const result = await helpOwningApp().execute(['show', '--help', 'flags', '--json=banana']);

		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
	});

	it('stops routing the bare help token', async () => {
		const result = await helpOwningApp().execute(['help']);

		expect(result.error?.code).toBe('UNKNOWN_COMMAND');
	});

	it('drops -h, --help from the root Global options block and the footer hint', async () => {
		const output = (await helpOwningApp().execute([])).stdout.join('');

		expect(output).toContain('Global options:');
		expect(output).not.toContain('--help');
		expect(output).not.toContain('for more information');
		expect(output).toContain('--json');
	});

	it('keeps rendering root help for a bare invocation', async () => {
		const output = (await helpOwningApp().execute([])).stdout.join('');

		expect(output).toContain('Usage: mycli');
		expect(output).toContain('Commands:');
	});

	it('stops offering --help in dispatch failures', async () => {
		const app = helpOwningApp().command(command('grp').command(command('leaf').action(() => {})));

		const unknownFlag = await app.execute(['--bogus']);
		expect(unknownFlag.error?.code).toBe('UNKNOWN_FLAG');
		expect(unknownFlag.error?.suggest).toBeUndefined();

		const unknownCommand = await app.execute(['grp', 'nope']);
		expect(unknownCommand.error?.code).toBe('UNKNOWN_COMMAND');
		expect(unknownCommand.error?.suggest).toBeUndefined();
	});

	it('drops the synthetic --help from generated completion scripts', () => {
		const plain = command('show').action(() => {});
		const owned = cli('mycli').builtins({ help: 'off' }).command(plain);
		const framework = cli('mycli').command(plain);

		expect(rootCompletionWords(generateCompletion(framework.schema, 'bash'))).toContain('--help');
		expect(rootCompletionWords(generateCompletion(owned.schema, 'bash'))).not.toContain('--help');
	});

	it('omits the Global options block entirely once nothing is left in it', async () => {
		const app = cli('mycli')
			.builtins({ help: 'off', json: 'off', quiet: 'off' })
			.command(command('show').action(() => {}));
		const output = (await app.execute([])).stdout.join('');

		expect(output).not.toContain('Global options:');
		expect(output).toContain('Commands:');
	});
});

// === Interaction with the RESERVED_FLAG guard

describe('builtins — reserved-flag guard', () => {
	it('still rejects a flag colliding with a built-in that stays on', () => {
		expect(() =>
			cli('mycli').builtins({ json: 'off' }).command(echoFlag('quiet', flag.boolean())),
		).toThrow(CLIError);
	});

	it('rejects the released flag when it is registered before the release', () => {
		const error = buildError(() => cli('mycli').command(echoFlag('json', flag.string())));

		expect(error.code).toBe('RESERVED_FLAG');
		expect(error.suggest).toContain(".builtins({ json: 'off' }) before registering the command");
	});

	it('rejects taking a built-in back while a command still declares it', () => {
		const app = cli('mycli').builtins({ json: 'off' }).command(echoFlag('json', flag.string()));

		expect(() => app.builtins({ json: 'on' })).toThrow(CLIError);
	});

	it('accepts the released flag on the definition path', () => {
		const schema = createCLISchema({
			name: 'mycli',
			builtins: { quiet: 'off' },
			commands: [{ name: 'show', flags: { quiet: { kind: 'boolean' } } }],
		});

		expect(schema.commands[0]?.flags.quiet?.kind).toBe('boolean');
	});
});

// === testkit mirror

describe('builtins — testkit runCommand', () => {
	it('mirrors the root strip by default', async () => {
		const result = await runCommand(echoFlag('target', flag.string()), ['--json', '--target', 'x']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('');
		expect(result.stderr.join('')).toBe('target=x\n');
	});

	it('leaves a released token for the command under test', async () => {
		const result = await runCommand(echoFlag('json', flag.string()), ['--json', 'doc.json'], {
			builtins: { json: 'off' },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toBe('json=doc.json\n');
	});

	it('leaves a released --help for the command under test', async () => {
		const result = await runCommand(echoFlag('help', flag.string()), ['--help', 'topics'], {
			builtins: { help: 'off' },
		});

		expect(result.stdout.join('')).toBe('help=topics\n');
	});

	it('bypasses an invalid root output value only while help is root-owned', async () => {
		const cmd = echoFlag('target', flag.string());
		const owned = await runCommand(cmd, ['--help', '--json=banana']);
		expect(owned.exitCode).toBe(0);
		expect(owned.error).toBeUndefined();

		const released = await runCommand(cmd, ['--help', '--json=banana'], {
			builtins: { help: 'off' },
		});
		expect(released.exitCode).toBe(2);
		expect(released.error?.code).toBe('INVALID_VALUE');
	});
});
