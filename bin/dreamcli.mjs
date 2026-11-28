#!/usr/bin/env node

/** DreamCLI's package executable. @module */

import { basename, resolve } from 'node:path';
import { arg, cli, command, flag } from '@kjanat/dreamcli';
import { scaffold } from '@kjanat/dreamcli/create';
import { DREAMCLI_REVISION, DREAMCLI_VERSION } from '@kjanat/dreamcli/version';
import { initGit } from './git.mjs';

const create = command('create')
	.alias('init')
	.description('Generate a DreamCLI starter')
	.arg(
		'directory',
		arg.string().default('.').describe('Project directory (or CLI name with --out)'),
	)
	.flag('mode', flag.enum(['single', 'multi']).default('single').describe('Starter layout'))
	.flag(
		'out',
		flag.string().describe('Write files into this directory instead of creating a project'),
	)
	.flag('git', flag.boolean().default(true).negatable().describe('Create the initial Git commit'))
	.flag('test', flag.boolean().default(true).negatable().describe('Generate a starter test'))
	.flag('force', flag.boolean().default(false).describe('Replace existing starter files'))
	.action(({ args, flags, out }) => {
		const { git: useGit, ...options } = flags;
		const directory = resolve(args.directory);
		const project = options.out === undefined;
		const name = project ? basename(directory) : args.directory;
		const result = scaffold({ name, directory, ...options });
		const git =
			project && useGit
				? initGit(
						directory,
						[
							basename(result.entry),
							'package.json',
							'.gitignore',
							...(result.test ? [basename(result.test)] : []),
						],
						DREAMCLI_VERSION,
						DREAMCLI_REVISION,
					)
				: undefined;
		if (out.jsonMode) {
			out.json({ ...result, ...(git && { git }) });
			return;
		}
		out.log(`Created ${result.entry}`);
		if (result.test !== undefined) out.log(`Created ${result.test}`);
		if (git?.commit) out.log(`Initial Git commit: ${git.commit.slice(0, 12)}`);
		if (git?.skipped) out.status('Git skipped: the project is inside an existing repository.');
		if (git?.error) out.warn(`Initial Git commit was not created: ${git.error}`);
		if (project) out.log(`In ${directory}, run npm install, then npm start -- --help.`);
	});

await cli('dreamcli')
	.version(DREAMCLI_VERSION)
	.description('Create a project with DreamCLI')
	.command(create)
	.run();
