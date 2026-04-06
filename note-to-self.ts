#!/usr/bin/env bun

/**
 * Developer helper for Bun workspace linking behavior.
 *
 * @module note-to-self
 * @internal
 */

import { $ } from 'bun';
import { dependencies } from './examples/gh/package.json' with { type: 'json' };

/** Prints a clickable link in supported terminals (e.g. iTerm2, VSCode) using OSC 8 escape codes. */
const osc8Link = (url: string, text?: string) => {
	return `\u001B]8;;${url}\u0007${text ?? url}\u001B]8;;\u0007`;
};

/** Formats a code block in markdown with optional language and file link. */
const mdCodeFence = (code: string, language = '', file?: string, filetext?: string) => {
	const fence = '```';
	const fileLink = file
		? ` ${osc8Link(`file://${import.meta.dir}/${file}`, filetext ?? file)}`
		: '';
	return `${fence}${language}${fileLink}\n${code}\n${fence}`;
};

/** Registers the current package as a “linkable” package
 * @see https://bun.com/docs/pm/cli/link */
const link = await $`bun link`.quiet();
if (link.exitCode !== 0) {
	console.error('bun link failed:', new TextDecoder().decode(link.stderr));
	process.exit(link.exitCode);
}

console.error(`Reminder: verify Bun workspace behavior for root package references.
link: ${osc8Link('https://bun.com/docs/pm/workspaces', 'bun workspaces')}`);

/** Why this workaround exists. See Bun docs for linking root packages in workspaces. */
const why = `
Why this step exists:

${mdCodeFence(JSON.stringify(dependencies, null, '  '), 'json', 'examples/gh/package.json', "gh example's package.json dependencies")}`;

console.warn(why);
process.exit(0);
