/**
 * Contract tests for planner outcomes.
 */

import { describe, expect, it } from 'vitest';
import { CLIError } from '#internals/core/errors/index.ts';
import type { HelpOptions } from '#internals/core/help/index.ts';
import type { OutputPolicy } from '#internals/core/output/contracts.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import type { CompiledCommand } from './compiled.ts';
import { compileCommand } from './compiled.ts';
import { mergeCommandSchema, planInvocation } from './planner.ts';

// === Helpers

/** Leaf command builder carrying a handler. */
function leafBuilder(name: string) {
	return command(name).action(() => {});
}

/** Compiled graph node for a leaf command carrying a handler. */
function leaf(name: string): CompiledCommand {
	return compileCommand(leafBuilder(name));
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
	commands: readonly CompiledCommand[],
	argv: readonly string[],
	defaultCommand?: CompiledCommand,
) {
	return planInvocation({
		schema: {
			name: 'dream',
			version: '1.2.3',
			defaultCommandRouted: false,
			completionsFlag: undefined,
		},
		compiled: { commands, defaultCommand, plugins: [] },
		argv,
		help,
		output,
	});
}

// === Root interception

describe('planInvocation() — root interception', () => {
	it('treats --json before --version as root version output', () => {
		const deploy = leaf('deploy');

		const result = planFor([deploy], ['--json', '--version']);

		expect(result).toEqual({ kind: 'root-version', version: '1.2.3' });
	});

	it('treats --json before root --help as root help output', () => {
		const deploy = leaf('deploy');

		const result = planFor([deploy], ['--json', '--help']);

		expect(result).toEqual({ kind: 'root-help', help });
	});

	it('keeps subcommand help in the match plan', () => {
		const deploy = leaf('deploy');

		const result = planFor([deploy], ['--json', 'deploy', '--help']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['--help']);
		}
	});

	it('rewrites virtual help before planning the command match', () => {
		const deploy = leaf('deploy');

		const result = planFor([deploy], ['help', 'deploy', '--json', '--force']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['--force', '--help']);
		}
	});
});

// === Consistent --help / --version positional reach (#29)

describe('planInvocation() — consistent help/version reach (#29)', () => {
	function defaultWithVerbose(): CompiledCommand {
		return compileCommand(
			command('app')
				.flag('verbose', flag.boolean())
				.action(() => {}),
		);
	}

	it('intercepts root help when only flags precede --help', () => {
		const app = defaultWithVerbose();

		const result = planFor([], ['--verbose', '--help'], app);

		expect(result).toEqual({ kind: 'root-help', help });
	});

	it('intercepts root version when only flags precede --version (mirror of --help)', () => {
		const app = defaultWithVerbose();

		const result = planFor([], ['--verbose', '--version'], app);

		expect(result).toEqual({ kind: 'root-version', version: '1.2.3' });
	});

	it('intercepts root help for a bare --help', () => {
		const deploy = leaf('deploy');

		expect(planFor([deploy], ['--help'])).toEqual({ kind: 'root-help', help });
		expect(planFor([deploy], ['-h'])).toEqual({ kind: 'root-help', help });
	});

	it('keeps --help after a subcommand token scoped to that subcommand', () => {
		const deploy = leaf('deploy');

		const result = planFor([deploy], ['deploy', '--help']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['--help']);
		}
	});

	it('respects the -- separator: a literal --help after -- is not root help', () => {
		const deploy = compileCommand(
			command('app')
				.arg('rest', arg.string())
				.action(() => {}),
		);

		const result = planFor([], ['--', '--help'], deploy);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['--', '--help']);
		}
	});

	it('treats a bare help token after flags as a root help request', () => {
		const deploy = leaf('deploy');
		const app = defaultWithVerbose();

		const result = planFor([deploy], ['--verbose', 'help'], app);

		expect(result).toEqual({ kind: 'root-help', help });
	});
});

// === Default-command behavior

describe('planInvocation() — default command behavior', () => {
	it('delegates unknown root argv to defaults with positional args', () => {
		const deploy = compileCommand(
			command('deploy')
				.arg('target', arg.string())
				.action(() => {}),
		);
		const status = leaf('status');

		const result = planFor([deploy, status], ['production', '--force'], deploy);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.command).toBe(deploy);
			expect(result.plan.argv).toEqual(['production', '--force']);
			expect(result.plan.meta.command).toBe('deploy');
		}
	});

	it('rejects unknown root argv for defaults without positional args', () => {
		const deploy = leaf('deploy');
		const status = leaf('status');

		const result = planFor([deploy, status], ['production'], deploy);

		expect(result.kind).toBe('dispatch-error');
		if (result.kind === 'dispatch-error') {
			expect(result.error.message).toBe('Unknown command: production');
			expect(result.error.code).toBe('UNKNOWN_COMMAND');
			expect(result.error.suggest).toBe("Run 'dream --help' for available commands");
		}
	});

	it('reports unknown flags before unknown positional values for no-arg defaults', () => {
		const deploy = leaf('deploy');
		const status = leaf('status');

		const result = planFor([deploy, status], ['--bogus', 'production'], deploy);

		expect(result.kind).toBe('dispatch-error');
		if (result.kind === 'dispatch-error') {
			expect(result.error.message).toBe('Unknown flag --bogus');
			expect(result.error.code).toBe('UNKNOWN_FLAG');
			expect(result.error.suggest).toBe("Run 'dream --help' for available commands");
		}
	});

	it('keeps typo suggestions as dispatch errors', () => {
		const deploy = leaf('deploy');
		const status = leaf('status');

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
	it('throws when root command routes collide', () => {
		const deploy = leaf('deploy');
		const status = compileCommand(
			command('status')
				.alias('deploy')
				.action(() => {}),
		);

		try {
			planFor([deploy, status], ['deploy']);
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(CLIError);
			if (!(error instanceof CLIError)) {
				expect.unreachable('expected CLIError');
			}
			expect(error.code).toBe('DUPLICATE_COMMAND');
		}
	});

	it('returns scoped help context when a group needs a subcommand', () => {
		const db = compileCommand(command('db').command(leafBuilder('migrate')));

		const result = planFor([db], ['db']);

		expect(result.kind).toBe('needs-subcommand');
		if (result.kind === 'needs-subcommand') {
			expect(result.command).toBe(db);
			expect(result.help.binName).toBe('dream');
		}
	});

	it('returns nested unknown-command errors with a scoped help suggestion', () => {
		const db = compileCommand(command('db').command(leafBuilder('migrate')));

		const result = planFor([db], ['db', 'bogus']);

		expect(result.kind).toBe('dispatch-error');
		if (result.kind === 'dispatch-error') {
			expect(result.error.message).toBe('Unknown command: bogus');
			expect(result.error.suggest).toBe("Run 'dream db --help' for available commands");
		}
	});

	it('returns unknown-flag errors when only flags are present', () => {
		const deploy = leaf('deploy');

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
		const root = command('dream')
			.flag('verbose', flag.boolean().propagate())
			.flag('format', flag.string().propagate()).schema;
		const deploy = compileCommand(
			command('deploy')
				.flag('verbose', flag.string())
				.action(() => {}),
		);

		const merged = mergeCommandSchema(deploy, [root, deploy.schema]);

		expect(merged.flags['verbose']).toBe(deploy.schema.flags['verbose']);
		expect(merged.flags['format']).toBe(root.flags['format']);
	});

	it('carries merged propagated flags into the match plan', () => {
		const db = compileCommand(
			command('db').flag('verbose', flag.boolean().propagate()).command(leafBuilder('migrate')),
		);

		const result = planFor([db], ['db', 'migrate']);

		expect(result.kind).toBe('match');
		if (result.kind === 'match') {
			expect(result.plan.mergedSchema.flags['verbose']).toBe(db.schema.flags['verbose']);
		}
	});
});
