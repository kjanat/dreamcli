/**
 * Tests for recursive command dispatch — dispatch() function.
 */

import { describe, expect, it } from 'vitest';
import { buildFlagLookup } from '#internals/core/parse/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { CompiledCommand } from './compiled.ts';
import { compileCommand } from './compiled.ts';
import {
	consumesFollowingToken,
	dispatch,
	findClosestCommand,
	levenshtein,
	uniqueCommands,
} from './dispatch.ts';

// === Helpers

/** Leaf command builder carrying a handler. */
function leafBuilder(name: string) {
	return command(name).action(() => {});
}

/** Compiled graph node for a leaf command carrying a handler. */
function leaf(name: string): CompiledCommand {
	return compileCommand(leafBuilder(name));
}

/**
 * Compiled subcommand of `parent` registered under `route`.
 *
 * @param parent - Compiled parent node.
 * @param route - Subcommand name or alias.
 * @returns The compiled child node.
 * @throws When no subcommand answers to `route`.
 */
function sub(parent: CompiledCommand, route: string): CompiledCommand {
	const child = parent.subcommands.get(route);
	if (child === undefined) {
		throw new Error(`No compiled subcommand '${route}' under '${parent.schema.name}'`);
	}
	return child;
}

/** Build a name+alias map from an array of compiled commands. */
function commandMap(...commands: readonly CompiledCommand[]): ReadonlyMap<string, CompiledCommand> {
	const map = new Map<string, CompiledCommand>();
	for (const cmd of commands) {
		map.set(cmd.schema.name, cmd);
		for (const alias of cmd.schema.aliases) {
			map.set(alias, cmd);
		}
	}
	return map;
}

// === dispatch()

describe('dispatch()', () => {
	// --- base cases

	describe('base cases', () => {
		it('returns unknown with empty input on empty argv', () => {
			const deploy = leaf('deploy');
			const result = dispatch([], commandMap(deploy));
			expect(result.kind).toBe('unknown');
			if (result.kind === 'unknown') {
				expect(result.input).toBe('');
			}
		});

		it('returns unknown with input when command not found', () => {
			const deploy = leaf('deploy');
			const result = dispatch(['nope'], commandMap(deploy));
			expect(result.kind).toBe('unknown');
			if (result.kind === 'unknown') {
				expect(result.input).toBe('nope');
				expect(result.candidates).toHaveLength(1);
			}
		});

		it('matches leaf command by name', () => {
			const deploy = leaf('deploy');
			const result = dispatch(['deploy'], commandMap(deploy));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(deploy);
				expect(result.commandPath).toEqual([deploy.schema]);
				expect(result.remainingArgv).toEqual([]);
			}
		});

		it('matches leaf command by alias', () => {
			const deploy = compileCommand(
				command('deploy')
					.alias('d')
					.action(() => {}),
			);
			const result = dispatch(['d'], commandMap(deploy));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(deploy);
			}
		});

		it('preserves remaining argv after command name', () => {
			const deploy = leaf('deploy');
			const result = dispatch(['deploy', '--force', 'prod'], commandMap(deploy));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.remainingArgv).toEqual(['--force', 'prod']);
			}
		});

		it('skips leading flags when finding command name', () => {
			const deploy = leaf('deploy');
			const result = dispatch(['--verbose', 'deploy', 'prod'], commandMap(deploy));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(deploy);
				expect(result.remainingArgv).toEqual(['--verbose', 'prod']);
			}
		});

		it('returns unknown when only flags given (no command name)', () => {
			const deploy = leaf('deploy');
			const result = dispatch(['--verbose', '--force'], commandMap(deploy));
			expect(result.kind).toBe('unknown');
			if (result.kind === 'unknown') {
				expect(result.input).toBe('');
			}
		});
	});

	// --- nested commands

	describe('nested commands', () => {
		it('dispatches to nested subcommand', () => {
			const db = compileCommand(command('db').command(leafBuilder('migrate')));
			const migrate = sub(db, 'migrate');
			const result = dispatch(['db', 'migrate'], commandMap(db));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(migrate);
				expect(result.commandPath).toEqual([db.schema, migrate.schema]);
				expect(result.remainingArgv).toEqual([]);
			}
		});

		it('dispatches 3 levels deep', () => {
			const db = compileCommand(
				command('db').command(command('migrate').command(leafBuilder('up'))),
			);
			const migrate = sub(db, 'migrate');
			const up = sub(migrate, 'up');
			const result = dispatch(['db', 'migrate', 'up'], commandMap(db));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(up);
				expect(result.commandPath).toEqual([db.schema, migrate.schema, up.schema]);
			}
		});

		it('preserves remaining argv through nesting', () => {
			const db = compileCommand(command('db').command(leafBuilder('migrate')));
			const result = dispatch(['db', 'migrate', '--steps', '3'], commandMap(db));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.remainingArgv).toEqual(['--steps', '3']);
			}
		});
	});

	// --- groups without handlers

	describe('groups without handlers', () => {
		it('returns needs-subcommand for bare groups', () => {
			const db = compileCommand(command('db').command(leafBuilder('migrate')));
			const result = dispatch(['db'], commandMap(db));
			expect(result.kind).toBe('needs-subcommand');
			if (result.kind === 'needs-subcommand') {
				expect(result.command).toBe(db);
				expect(result.commandPath).toEqual([db.schema]);
			}
		});

		it('returns unknown for unknown subcommands', () => {
			const db = compileCommand(command('db').command(leafBuilder('migrate')));
			const result = dispatch(['db', 'nope'], commandMap(db));
			expect(result.kind).toBe('unknown');
			if (result.kind === 'unknown') {
				expect(result.input).toBe('nope');
			}
		});
	});

	// --- groups with handlers (hybrid commands)

	describe('groups with handlers (hybrid commands)', () => {
		it('dispatches to group handler when no subcommand given', () => {
			const remote = compileCommand(
				command('remote')
					.command(leafBuilder('add'))
					.action(() => {}),
			);
			const result = dispatch(['remote'], commandMap(remote));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(remote);
				expect(result.remainingArgv).toEqual([]);
			}
		});

		it('dispatches to subcommand when subcommand matches', () => {
			const remote = compileCommand(
				command('remote')
					.command(leafBuilder('add'))
					.action(() => {}),
			);
			const add = sub(remote, 'add');
			const result = dispatch(['remote', 'add', 'origin'], commandMap(remote));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(add);
				expect(result.remainingArgv).toEqual(['origin']);
			}
		});

		it('dispatches to the group handler for positional args', () => {
			const remote = compileCommand(
				command('remote')
					.command(leafBuilder('add'))
					.action(() => {}),
			);
			const result = dispatch(['remote', 'origin'], commandMap(remote));
			expect(result.kind).toBe('match');
			if (result.kind === 'match') {
				expect(result.command).toBe(remote);
				// 'origin' stays in argv as a positional arg for the group handler
				expect(result.remainingArgv).toEqual(['origin']);
			}
		});
	});
});

// === levenshtein()

describe('levenshtein()', () => {
	it('returns 0 for identical strings', () => {
		expect(levenshtein('deploy', 'deploy')).toBe(0);
	});

	it('returns length for empty vs non-empty', () => {
		expect(levenshtein('', 'abc')).toBe(3);
		expect(levenshtein('abc', '')).toBe(3);
	});

	it('computes single-char distance', () => {
		expect(levenshtein('cat', 'bat')).toBe(1);
	});
});

// === findClosestCommand()

describe('findClosestCommand()', () => {
	it('returns closest match within threshold', () => {
		const deploy = leaf('deploy');
		expect(findClosestCommand('deplpy', [deploy])).toBe('deploy');
	});

	it('returns undefined when no close match', () => {
		const deploy = leaf('deploy');
		expect(findClosestCommand('zzzzzzz', [deploy])).toBeUndefined();
	});

	it('matches aliases', () => {
		const deploy = compileCommand(
			command('deploy')
				.alias('d')
				.action(() => {}),
		);
		expect(findClosestCommand('e', [deploy])).toBe('deploy');
	});
});

// === uniqueCommands()

describe('uniqueCommands()', () => {
	it('deduplicates aliased entries', () => {
		const deploy = compileCommand(
			command('deploy')
				.alias('d')
				.action(() => {}),
		);
		const map = commandMap(deploy);
		expect(map.size).toBe(2); // 'deploy' and 'd'
		const unique = uniqueCommands(map);
		expect(unique).toHaveLength(1);
		expect(unique[0]).toBe(deploy);
	});
});

// === consumesFollowingToken()

describe('consumesFollowingToken()', () => {
	const lookup = buildFlagLookup({
		source: flag.string().alias('s').schema,
		verbose: flag.boolean().alias('v').schema,
	});

	it('long value-flag consumes the next token', () => {
		expect(consumesFollowingToken('--source', lookup)).toBe(true);
	});

	it('long value-flag with inline = consumes nothing', () => {
		expect(consumesFollowingToken('--source=anthropic', lookup)).toBe(false);
	});

	it('boolean long flag consumes nothing', () => {
		expect(consumesFollowingToken('--verbose', lookup)).toBe(false);
	});

	it('short value alias consumes the next token', () => {
		expect(consumesFollowingToken('-s', lookup)).toBe(true);
	});

	it('short boolean alias consumes nothing', () => {
		expect(consumesFollowingToken('-v', lookup)).toBe(false);
	});

	it('short bundle ending in a value-flag consumes the next token', () => {
		expect(consumesFollowingToken('-vs', lookup)).toBe(true);
	});

	it('short bundle with a non-trailing value-flag consumes nothing (inline value)', () => {
		expect(consumesFollowingToken('-sv', lookup)).toBe(false);
	});

	it('unknown flag conservatively consumes nothing', () => {
		expect(consumesFollowingToken('--nope', lookup)).toBe(false);
	});
});

// === dispatch() flag-arity awareness (#25)

describe('dispatch() flag-arity awareness', () => {
	const valueFlags = buildFlagLookup({ source: flag.string().alias('s').schema });
	const booleanFlags = buildFlagLookup({ verbose: flag.boolean().alias('v').schema });

	it('does not match a value-flag value that collides with a command name', () => {
		const anthropic = leaf('anthropic');
		const result = dispatch(['--source', 'anthropic'], commandMap(anthropic), [], valueFlags);
		// The value was skipped, so no command token remains → fall through (default cmd).
		expect(result.kind).toBe('unknown');
		if (result.kind === 'unknown') expect(result.input).toBe('');
	});

	it('handles the short-alias form too', () => {
		const anthropic = leaf('anthropic');
		const result = dispatch(['-s', 'anthropic'], commandMap(anthropic), [], booleanFlags);
		// booleanFlags has no `s`; arity-unaware → would match. With value arity:
		const arityResult = dispatch(['-s', 'anthropic'], commandMap(anthropic), [], valueFlags);
		expect(arityResult.kind).toBe('unknown');
		expect(result.kind).toBe('match'); // contrast: unknown short flag is not a value-flag here
	});

	it('without arity info, the value is mis-matched as a command (legacy behaviour)', () => {
		const anthropic = leaf('anthropic');
		const result = dispatch(['--source', 'anthropic'], commandMap(anthropic));
		expect(result.kind).toBe('match');
	});

	it('a boolean flag does not swallow the following command token', () => {
		const anthropic = leaf('anthropic');
		const result = dispatch(['-v', 'anthropic'], commandMap(anthropic), [], booleanFlags);
		expect(result.kind).toBe('match');
		if (result.kind === 'match') expect(result.command.schema.name).toBe('anthropic');
	});

	it('the inline = form leaves the command token matchable', () => {
		const anthropic = leaf('anthropic');
		const result = dispatch(['--source=eu', 'anthropic'], commandMap(anthropic), [], valueFlags);
		expect(result.kind).toBe('match');
		if (result.kind === 'match') expect(result.command.schema.name).toBe('anthropic');
	});
});
