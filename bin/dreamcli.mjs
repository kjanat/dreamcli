#!/usr/bin/env node

/** DreamCLI's package executable. @module */

import { basename, relative, resolve, sep } from 'node:path';
import { cwd, env, stderr, stdin } from 'node:process';
import { arg, CLIError, cli, command, flag } from '@kjanat/dreamcli';
import { scaffold } from '@kjanat/dreamcli/create';
import { prompt } from '@kjanat/dreamcli/prompt';
import { DREAMCLI_REVISION, DREAMCLI_VERSION } from '@kjanat/dreamcli/version';
import { initGit } from './git.mjs';

const create = command('create')
	.alias('init')
	.description('Generate a DreamCLI starter')
	.arg('directory', arg.string().optional().describe('Project directory (or CLI name with --out)'))
	.flag('name', flag.string().describe('Override the project name'))
	.flag('yes', flag.boolean().alias('y').describe('Use defaults without prompting'))
	.flag(
		'out',
		flag.string().describe('Write files into this directory instead of creating a project'),
	)
	.flag('git', flag.boolean().default(true).negatable().describe('Create the initial Git commit'))
	.flag('test', flag.boolean().default(true).negatable().describe('Generate a starter test'))
	.flag('force', flag.boolean().default(false).describe('Replace existing starter files'))
	.action(async ({ args, flags, out, ask }) => {
		const { git: useGit, name: explicitName, yes, ...options } = flags;
		const project = options.out === undefined;
		const inCI = env.CI && env.CI !== 'false' && env.CI !== '0';
		const interactive =
			project && !yes && !inCI && !out.jsonMode && out.isTTY && stdin.isTTY && stderr.isTTY;

		let target = args.directory;
		if (!target && interactive) {
			target = await ask(
				prompt.input({
					message: 'Directory',
				}),
			);
		}
		if (!target) {
			throw new CLIError(
				project ? 'Provide a project directory.' : 'Provide a CLI name with --out.',
				{
					code: 'SCAFFOLD_DIRECTORY_REQUIRED',
					exitCode: 2,
					suggest: project
						? 'For example: dreamcli create ./my-cli'
						: 'For example: dreamcli create my-cli --out .',
				},
			);
		}

		const directory = resolve(target);
		const name = explicitName ?? (project ? basename(directory) : target);
		if (interactive && relative(cwd(), directory) === '') {
			if (!(await ask(prompt.confirm({ message: 'Create here?', default: false })))) return;
		}

		const result = scaffold({ ...options, name, directory });
		const git =
			project && useGit
				? initGit(
						directory,
						result.files.map((path) => relative(directory, path).split(sep).join('/')),
						DREAMCLI_VERSION,
						DREAMCLI_REVISION,
					)
				: undefined;
		if (out.jsonMode) {
			out.json({ ...result, ...(git && { git }) });
			return;
		}
		out.log(project ? `Created ${target}` : `Created ${relative(cwd(), result.entry)}`);
		if (git?.error) out.warn(`Git: ${git.error}`);
	});

await cli('dreamcli')
	.version(DREAMCLI_VERSION)
	.description('Create a project with DreamCLI')
	.command(create)
	.run();
