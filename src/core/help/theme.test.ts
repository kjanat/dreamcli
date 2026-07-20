/**
 * Tests for themed help output.
 *
 * @module dreamcli/core/help/theme.test
 */

import { createColors } from 'ansispeck';
import { describe, expect, it } from 'vitest';

import { command } from '#internals/core/schema/command.ts';
import { arg, flag } from '#internals/core/schema/index.ts';

import { stripAnsi } from './ansi.ts';
import { formatHelp } from './index.ts';
import { defaultHelpTheme, resolveHelpTheme } from './theme.ts';

// ansispeck's top-level named exports (bold, cyan, …) auto-gate on detected
// support — identity in a non-TTY test process. Expected strings must be
// built from an explicitly enabled palette instead.
const on = createColors(true);

const ESC = '[';

/** A schema exercising every themed role: aliases, hints, defaults, env,
 *  deprecation, subcommands, args, examples, and a wrap-inducing description. */
function richCommand() {
	return command('deploy')
		.description('Deploy the application to a remote environment')
		.command(command('status').description('Show the current deployment status'))
		.arg('env', arg.enum(['us', 'eu', 'ap']).describe('Target region'))
		.arg('out', arg.string().optional().describe('Output file'))
		.flag(
			'force',
			flag
				.boolean()
				.alias('f')
				.describe('Skip confirmation prompts and any interactive safety checks entirely'),
		)
		.flag('retries', flag.number({ min: 0 }).default(3).describe('Retry attempts'))
		.flag('token', flag.string().env('DEPLOY_TOKEN').required().describe('Auth token'))
		.flag('legacy', flag.boolean().deprecated('use --force').describe('Old escape hatch'))
		.example('deploy us --force', 'Force-deploy to US');
}

describe('resolveHelpTheme', () => {
	it('returns the default theme for an undefined palette', () => {
		const theme = resolveHelpTheme(undefined, undefined);
		expect(theme.sectionTitle('Flags:')).toBe('Flags:');
		expect(theme.flag('--force')).toBe('--force');
	});

	it('builds styled formatters from an enabled palette', () => {
		const theme = resolveHelpTheme(on, undefined);
		expect(theme.sectionTitle('Flags:')).toBe(on.bold(on.underline('Flags:')));
		expect(theme.flag('--force')).toBe(on.cyan('--force'));
		expect(theme.deprecated('[deprecated]')).toBe(on.yellow('[deprecated]'));
	});

	it('merges user overrides over the default theme when color is on', () => {
		const theme = resolveHelpTheme(on, (c) => ({ sectionTitle: c.magenta }));
		expect(theme.sectionTitle('Flags:')).toBe(on.magenta('Flags:'));
		// Unoverridden roles keep their defaults.
		expect(theme.flag('--force')).toBe(on.cyan('--force'));
	});

	it('never invokes the user factory when color is off', () => {
		let invoked = false;
		const theme = resolveHelpTheme(createColors(false), () => {
			invoked = true;
			return { sectionTitle: () => `${ESC}31mhostile${ESC}0m` };
		});
		expect(invoked).toBe(false);
		expect(theme.sectionTitle('Flags:')).toBe('Flags:');
	});
});

describe('formatHelp theming', () => {
	it('emits no escapes by default', () => {
		const help = formatHelp(richCommand().schema);
		expect(help).not.toContain(ESC);
	});

	it('emits no escapes with a disabled palette', () => {
		const help = formatHelp(richCommand().schema, { colors: createColors(false) });
		expect(help).not.toContain(ESC);
	});

	it('styles section titles, flags, hints, and annotations under forced color', () => {
		const help = formatHelp(richCommand().schema, { colors: on });
		expect(help).toContain(on.bold(on.underline('Usage:')));
		expect(help).toContain(on.bold(on.underline('Flags:')));
		expect(help).toContain(on.bold(on.underline('Arguments:')));
		expect(help).toContain(on.bold(on.underline('Commands:')));
		expect(help).toContain(on.bold(on.underline('Examples:')));
		expect(help).toContain(on.cyan('-f, --force'));
		expect(help).toContain(on.dim('<number>'));
		expect(help).toContain(on.dim('[env: DEPLOY_TOKEN]'));
		expect(help).toContain(on.dim('[required]'));
		expect(help).toContain(on.dim('(default: 3)'));
		expect(help).toContain(on.yellow('[deprecated: use --force]'));
		expect(help).toContain(on.cyan('status'));
	});

	it('keeps descriptions unstyled', () => {
		const help = formatHelp(richCommand().schema, { colors: on });
		expect(help).toContain('Retry attempts');
		expect(help).not.toContain(on.cyan('Retry attempts'));
	});

	it('strip-equivalence: colored output strips to exactly the plain rendering', () => {
		const schema = richCommand().schema;
		const plain = formatHelp(schema, { width: 40 });
		const colored = formatHelp(schema, { colors: on, width: 40 });
		expect(stripAnsi(colored)).toBe(plain);
	});

	it('applies user theme overrides through HelpOptions', () => {
		const help = formatHelp(richCommand().schema, {
			colors: on,
			theme: (palette) => ({ sectionTitle: palette.magenta }),
		});
		expect(help).toContain(on.magenta('Flags:'));
		expect(help).not.toContain(on.bold(on.underline('Flags:')));
	});

	it('hostile theme factory cannot leak escapes when color is off', () => {
		const help = formatHelp(richCommand().schema, {
			colors: createColors(false),
			theme: () => ({ sectionTitle: (input) => `${ESC}31m${String(input)}${ESC}0m` }),
		});
		expect(help).not.toContain(ESC);
	});
});

describe('example command highlighting', () => {
	function exampleCommand(cmd: string) {
		return command('deploy').description('Deploy the app').example(cmd).schema;
	}

	it('bolds the binary, cyans flag tokens, and leaves values plain', () => {
		const help = formatHelp(exampleCommand("mycli --scope './a b' run"), { colors: on });
		expect(help).toContain(on.bold('mycli'));
		expect(help).toContain(on.cyan('--scope'));
		expect(help).toContain("'./a b'");
		expect(help).not.toContain(on.cyan("'./a b'"));
	});

	it('keeps a quoted argument with internal spaces as one plain token', () => {
		const help = formatHelp(exampleCommand("mycli --msg 'a b c'"), { colors: on });
		expect(help).toContain(`${on.cyan('--msg')} 'a b c'`);
	});

	it('emits no escapes when color is off', () => {
		const help = formatHelp(exampleCommand("mycli --scope './a b' run"));
		expect(help).not.toContain(ESC);
		expect(help).toContain("$ mycli --scope './a b' run");
	});

	it('strip-equivalence holds with quoted args and irregular spacing', () => {
		const schema = exampleCommand("mycli --scope './a b'  run --force");
		const plain = formatHelp(schema);
		const colored = formatHelp(schema, { colors: on });
		expect(stripAnsi(colored)).toBe(plain);
	});
});

describe('defaultHelpTheme', () => {
	it('is identity end-to-end with a disabled palette', () => {
		const theme = defaultHelpTheme(createColors(false));
		for (const format of Object.values(theme)) {
			expect(format('sample')).toBe('sample');
		}
	});
});
