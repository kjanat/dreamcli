#!/usr/bin/env bun
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
}

console.error(`remember to check if bun supports basic monorepo shit like referencing workspace's root package...
link: ${osc8Link('https://bun.com/docs/pm/workspaces', 'bun workspaces')}`);

/** WHY DO I NEED TO FUCKING DO THIS??? @see {@linkcode link | Linking the root package for use in workspaces} */
const why = `
WTF IS THIS SHIT!!! Why??? This is why:

${mdCodeFence(JSON.stringify(dependencies, null, '  '), 'json', 'examples/gh/package.json', "gh example's package.json dependencies")}`;

console.warn(why);
process.exit(link.exitCode);
