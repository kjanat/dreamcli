#!/usr/bin/env bun
/**
 * __CLI_NAME__ - multi-command DreamCLI starter (pony party edition).
 *
 * Bun:
 *   bun __CLI_NAME__.ts snack cupcake --count 3
 *   bun __CLI_NAME__.ts story "rainbow heist" --mood legendary --sparkle
 *   bun __CLI_NAME__.ts party start --theme midnight
 *   bun __CLI_NAME__.ts --help
 *
 * npm/tsx:
 *   npx tsx __CLI_NAME__.ts party playlist --genre chaos
 *
 * Deno:
 *   deno run -A __CLI_NAME__.ts snack donut --count 2
 */

import { arg, cli, command, flag, group, middleware } from '@kjanat/dreamcli';

const sparkle = middleware<{ sparkle: (message: string) => string }>(async ({ flags, next }) => {
	const sparkleEnabled = flags.sparkle === true;
	return next({
		sparkle: (message: string) => (sparkleEnabled ? `✨ ${message} ✨` : message),
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
		out.log(ctx.sparkle(`Serving ${count} ${treat}(s)!`));
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
		out.log(ctx.sparkle(`Story time: ${topic} (${mood})`));
		out.log(ctx.sparkle('Dramatic glitter intensifies'));
	});

export const partyStart = command('start')
	.description('Start the pony party')
	.flag('theme', flag.enum(['rainbow', 'midnight', 'glitter']).default('rainbow').describe('Party theme'))
	.flag('sparkle', sparkleFlag())
	.middleware(sparkle)
	.action(({ flags, ctx, out }) => {
		out.log(ctx.sparkle(`Party started with ${flags.theme} theme!`));
	});

export const partyPlaylist = command('playlist')
	.description('Pick a party playlist vibe')
	.flag('genre', flag.enum(['pop', 'ballad', 'chaos']).default('pop').describe('Playlist genre'))
	.flag('sparkle', sparkleFlag())
	.middleware(sparkle)
	.action(({ flags, ctx, out }) => {
		out.log(ctx.sparkle(`Now playing: ${flags.genre}`));
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
