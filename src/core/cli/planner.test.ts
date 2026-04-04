/**
 * Contract tests for planner outcomes.
 */

import { describe, expect, it } from 'vitest';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { OutputPolicy } from '#internals/core/output/contracts.ts';
import type { CommandSchema, ErasedCommand } from '#internals/core/schema/command.ts';
import { createSchema } from '#internals/core/schema/flag.ts';
import { mergeCommandSchema, planInvocation } from './planner.ts';

// === Helpers

function commandSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: true,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

function erased(
	schema: CommandSchema,
	subcommands: ReadonlyMap<string, ErasedCommand> = new Map(),
): ErasedCommand {
	return {
		schema,
		subcommands,
		async _execute() {
			const stdout: string[] = [];
			const stderr: string[] = [];
			return {
				stdout,
				stderr,
				activity: [],
				exitCode: 0,
				error: undefined,
			};
		},
	};
}

function commandMap(...commands: readonly ErasedCommand[]): ReadonlyMap<string, ErasedCommand> {
	const map = new Map<string, ErasedCommand>();
	for (const cmd of commands) {
		map.set(cmd.schema.name, cmd);
		for (const alias of cmd.schema.aliases) {
			map.set(alias, cmd);
		}
	}
	return map;
}

function flagSchema(kind: 'string' | 'boolean' | 'number', propagate: boolean) {
	return createSchema(kind, { propagate });
}

const help: HelpOptions = {
	binName: 'dream',
};

const output: OutputPolicy = {
	jsonMode: false,
	isTTY: true,
	verbosity: 'normal',
};

function planFor(
	commands: readonly ErasedCommand[],
	argv: readonly string[],
	defaultCommand?: ErasedCommand,
) {
	return planInvocation({
		schema: {
			name: 'dream',
			version: '1.2.3',
			commands,
			defaultCommand,
			plugins: [],
		},
		argv,
		help,
		output,
	});
}

// === Root interception

describe('planInvocation() — root interception', () => {
	it('treats --json before --version as root version output', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));

		const result = planFor([deploy], ['--json', '--version']);

		expect(result).toEqual({ kind: 'root-version', version: '1.2.3' });
	});

	it('treats --json before root --help as root help output', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));

		const result = planFor([deploy], ['--json', '--help']);

		expect(result).toEqual({ kind: 'root-help', help });
	});

	it('keeps subcommand help in the match plan', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));

		const result = planFor([deploy], ['--json', 'deploy', '--help']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['--help']);
		}
	});

	it('rewrites virtual help before planning the command match', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));

		const result = planFor([deploy], ['help', 'deploy', '--json', '--force']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['--force', '--help']);
		}
	});
});

// === Default-command behavior

describe('planInvocation() — default command behavior', () => {
	it('delegates unknown root argv without suggestions', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));
		const status = erased(commandSchema({ name: 'status' }));

		const result = planFor([deploy, status], ['production', '--force'], deploy);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['production', '--force']);
			expect(result.plan.meta.command).toBe('deploy');
		}
	});

	it('keeps typo suggestions as dispatch errors', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));
		const status = erased(commandSchema({ name: 'status' }));

		const result = planFor([deploy, status], ['depliy'], deploy);

		expect(result.kind).toBe('dispatch-error');
		if (result.kind === 'dispatch-error') {
			expect(result.error.message).toBe('Unknown command: depliy');
			expect(result.error.suggest).toBe("Did you mean 'deploy'?");
		}
	});
});

// === Dispatch outcomes

describe('planInvocation() — dispatch outcomes', () => {
	it('returns scoped help context when a group needs a subcommand', () => {
		const migrate = erased(commandSchema({ name: 'migrate' }));
		const db = erased(commandSchema({ name: 'db', hasAction: false }), commandMap(migrate));

		const result = planFor([db], ['db']);

		expect(result.kind).toBe('needs-subcommand');
		if (result.kind === 'needs-subcommand') {
			expect(result.command).toBe(db);
			expect(result.help.binName).toBe('dream');
		}
	});

	it('returns nested unknown-command errors with a scoped help suggestion', () => {
		const migrate = erased(commandSchema({ name: 'migrate' }));
		const db = erased(commandSchema({ name: 'db', hasAction: false }), commandMap(migrate));

		const result = planFor([db], ['db', 'bogus']);

		expect(result.kind).toBe('dispatch-error');
		if (result.kind === 'dispatch-error') {
			expect(result.error.message).toBe('Unknown command: bogus');
			expect(result.error.suggest).toBe("Run 'dream db --help' for available commands");
		}
	});

	it('returns unknown-flag errors when only flags are present', () => {
		const deploy = erased(commandSchema({ name: 'deploy' }));

		const result = planFor([deploy], ['--bogus']);

		expect(result.kind).toBe('dispatch-error');
		if (result.kind === 'dispatch-error') {
			expect(result.error.message).toBe('Unknown flag --bogus');
			expect(result.error.suggest).toBe("Run 'dream --help' for available commands");
		}
	});
});

// === Propagated flags

describe('planner contract — propagated flag masking', () => {
	it('masks inherited flags when the leaf defines the same name', () => {
		const root = commandSchema({
			name: 'dream',
			flags: {
				verbose: flagSchema('boolean', true),
				format: flagSchema('string', true),
			},
		});
		const deploy = erased(
			commandSchema({
				name: 'deploy',
				flags: {
					verbose: flagSchema('string', false),
				},
			}),
		);

		const merged = mergeCommandSchema(deploy, [root, deploy.schema]);

		expect(merged.flags['verbose']).toBe(deploy.schema.flags['verbose']);
		expect(merged.flags['format']).toBe(root.flags['format']);
	});

	it('carries merged propagated flags into the match plan', () => {
		const migrate = erased(commandSchema({ name: 'migrate' }));
		const db = erased(
			commandSchema({
				name: 'db',
				hasAction: false,
				flags: { verbose: flagSchema('boolean', true) },
			}),
			commandMap(migrate),
		);

		const result = planFor([db], ['db', 'migrate']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.mergedSchema.flags['verbose']).toBe(db.schema.flags['verbose']);
		}
	});
});
