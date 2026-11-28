/** Starter source and test templates for DreamCLI projects. @module */

export const entryTemplates = {
	single: `#!/usr/bin/env bun
// __CLI_NAME__ - hello-world DreamCLI starter.
//
// Bun:
//   bun __CLI_NAME__.ts
//   bun __CLI_NAME__.ts Twilight --sparkle --times 2
//   bun __CLI_NAME__.ts --help
//
// npm/tsx:
//   npx tsx __CLI_NAME__.ts Twilight --sparkle --times 2
//
// Deno:
//   deno run -A __CLI_NAME__.ts Twilight --sparkle --times 2

import { arg, cli, command, flag, middleware } from '@kjanat/dreamcli';

const sparkle = middleware<{ sparkle: (message: string) => string }>(async ({ flags, next }) => {
	const sparkleEnabled = flags.sparkle === true;
	return next({
		sparkle: (message: string) => (sparkleEnabled ? \`✨ \${message} ✨\` : message),
	});
});

export const hello = command('hello')
	.description('Say hello with optional sparkle')
	.example(({ name }) => \`\${name} Twilight --sparkle --times 2\`, 'Sparkly double greeting')
	.arg('name', arg.string().default('World').describe('Who to greet'))
	.flag('sparkle', flag.boolean().alias('s').env('SPARKLE').describe('Add sparkles'))
	// Constraints are enforced at every source, so the action needs no clamping.
	.flag('times', flag.number({ int: true, min: 0, max: 100 }).default(1).alias('n').describe('Repeat count'))
	.middleware(sparkle)
	.action(({ args, flags, ctx, out }) => {
		for (let i = 0; i < flags.times; i++) {
			out.log(ctx.sparkle(\`Hello, \${args.name}!\`));
		}

		// stderr, and silenced by --quiet: keeps stdout pipe-clean.
		out.status(\`Greeted \${args.name} \${flags.times} time(s)\`);
	});

export const app = cli('__CLI_NAME__').default(hello);

if (import.meta.main) {
	app.run();
}
`,
	multi: `#!/usr/bin/env bun
// __CLI_NAME__ - multi-command DreamCLI starter (pony party edition).
//
// Bun:
//   bun __CLI_NAME__.ts snack cupcake --count 3
//   bun __CLI_NAME__.ts story "rainbow heist" --mood legendary --sparkle
//   bun __CLI_NAME__.ts party start --theme midnight
//   bun __CLI_NAME__.ts --help
//
// npm/tsx:
//   npx tsx __CLI_NAME__.ts party playlist --genre chaos
//
// Deno:
//   deno run -A __CLI_NAME__.ts snack donut --count 2

import { arg, cli, command, flag, group, middleware } from '@kjanat/dreamcli';

const sparkle = middleware<{ sparkle: (message: string) => string }>(async ({ flags, next }) => {
	const sparkleEnabled = flags.sparkle === true;
	return next({
		sparkle: (message: string) => (sparkleEnabled ? \`✨ \${message} ✨\` : message),
	});
});

const sparkleFlag = () => flag.boolean().alias('s').env('SPARKLE').describe('Add extra sparkle');

export const snack = command('snack')
	.description('Serve snacks to the crew')
	.arg('treat', arg.string().default('cupcake').describe('Snack to serve'))
	.flag('count', flag.number().default(1).alias('c').describe('How many snacks'))
	.flag('sparkle', sparkleFlag())
	.middleware(sparkle)
	.action(({ args, flags, ctx, out }) => {
		const { treat } = args;
		const { count } = flags;
		out.log(ctx.sparkle(\`Serving \${count} \${treat}(s)!\`));
	});

export const story = command('story')
	.description('Tell a dramatic story')
	.arg('topic', arg.string().default('the great cupcake rescue').describe('Story topic'))
	.flag('mood', flag.enum(['calm', 'chaos', 'legendary'])
		.prompt({ kind: 'select', message: 'Set the mood!' })
		.default('calm').describe('Story mood'))
	.flag('sparkle', sparkleFlag())
	.middleware(sparkle)
	.action(({ args, flags, ctx, out }) => {
		const { topic } = args;
		const { mood } = flags;
		out.log(ctx.sparkle(\`Story time: \${topic} (\${mood})\`));
		out.log(ctx.sparkle('Dramatic glitter intensifies'));
	});

export const partyStart = command('start')
	.description('Start the pony party')
	.flag('theme', flag.enum(['rainbow', 'midnight', 'glitter']).default('rainbow').describe('Party theme'))
	.flag('sparkle', sparkleFlag())
	.middleware(sparkle)
	.action(({ flags, ctx, out }) => {
		out.log(ctx.sparkle(\`Party started with \${flags.theme} theme!\`));
	});

export const partyPlaylist = command('playlist')
	.description('Pick a party playlist vibe')
	.flag('genre', flag.enum(['pop', 'ballad', 'chaos']).default('pop').describe('Playlist genre'))
	.flag('sparkle', sparkleFlag())
	.middleware(sparkle)
	.action(({ flags, ctx, out }) => {
		out.log(ctx.sparkle(\`Now playing: \${flags.genre}\`));
	});

export const party = group('party')
	.description('Party controls')
	.command(partyStart)
	.command(partyPlaylist);

export const app = cli('__CLI_NAME__')
	.version('0.1.0')
	.description('Fun DreamCLI starter app')
	.command(snack)
	.command(story)
	.command(party)
	.completions();

if (import.meta.main) {
	app.run();
}
`,
};

export const testTemplates = {
	single: `import { hello } from '__ENTRY_FILE__';
import { runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from '__TEST_RUNNER__';

describe('hello command', () => {
	it('prints sparkly greeting when --sparkle is set', async () => {
		const result = await runCommand(hello, ['Twilight', '--sparkle', '--times', '2']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['✨ Hello, Twilight! ✨\\n', '✨ Hello, Twilight! ✨\\n']);
		// out.status() writes to stderr so stdout stays pipe-clean.
		expect(result.stderr).toEqual(['Greeted Twilight 2 time(s)\\n']);
	});

	it('suppresses status output with --quiet', async () => {
		const result = await runCommand(hello, ['Twilight', '--quiet']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['Hello, Twilight!\\n']);
		expect(result.stderr).toEqual([]);
	});

	it('renders help text', async () => {
		const result = await runCommand(hello, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Say hello with optional sparkle');
	});
});
`,
	multi: `import { partyStart } from '__ENTRY_FILE__';
import { runCommand } from '@kjanat/dreamcli/testkit';
import { describe, expect, it } from '__TEST_RUNNER__';

describe('party start command', () => {
	it('applies sparkle middleware when --sparkle is set', async () => {
		const result = await runCommand(partyStart, ['--theme', 'midnight', '--sparkle']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEqual(['✨ Party started with midnight theme! ✨\\n']);
		expect(result.stderr).toEqual([]);
	});

	it('renders help text', async () => {
		const result = await runCommand(partyStart, ['--help']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('')).toContain('Start the pony party');
	});
});
`,
};
