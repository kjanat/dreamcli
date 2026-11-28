#!/usr/bin/env node

/** DreamCLI's package executable. @module */

import { basename, resolve } from 'node:path';
import { env, stderr, stdin } from 'node:process';
import { arg, CLIError, cli, command, flag, wasExplicit } from '@kjanat/dreamcli';
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
	.flag('mode', flag.enum(['single', 'multi']).default('single').describe('Starter layout'))
	.flag(
		'out',
		flag.string().describe('Write files into this directory instead of creating a project'),
	)
	.flag('git', flag.boolean().default(true).negatable().describe('Create the initial Git commit'))
	.flag('test', flag.boolean().default(true).negatable().describe('Generate a starter test'))
	.flag('force', flag.boolean().default(false).describe('Replace existing starter files'))
	.action(async ({ args, flags, sources, out, ask }) => {
		const { git: defaultGit, name: explicitName, yes, ...options } = flags;
		const project = options.out === undefined;
		const inCI = env.CI && env.CI !== 'false' && env.CI !== '0';
		const interactive =
			project && !yes && !inCI && !out.jsonMode && out.isTTY && stdin.isTTY && stderr.isTTY;

		let target = args.directory;
		if (!target && interactive) {
			target = await ask(
				prompt.input({
					message: 'Project directory',
					placeholder: 'e.g. ./my-cli',
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
		let name = explicitName ?? (project ? basename(directory) : target);
		let { mode, test } = options;
		let useGit = defaultGit;
		if (interactive) {
			if (explicitName === undefined) {
				name = await ask(
					prompt.input({
						message: 'Project name',
						...(name ? { default: name } : {}),
					}),
				);
			}
			if (!wasExplicit(sources.flags.mode)) {
				mode = await ask(
					prompt.select({
						message: 'Starter layout',
						choices: [
							{ value: 'single', label: 'Single command' },
							{ value: 'multi', label: 'Grouped commands' },
						],
					}),
				);
			}
			if (!wasExplicit(sources.flags.test)) {
				test = await ask(prompt.confirm({ message: 'Generate a starter test?', default: test }));
			}
			if (!wasExplicit(sources.flags.git)) {
				useGit = await ask(
					prompt.confirm({ message: 'Create the initial Git commit?', default: useGit }),
				);
			}
			if (
				!(await ask(
					prompt.confirm({ message: `Create the project in ${directory}?`, default: false }),
				))
			) {
				out.status('Cancelled. No files written.');
				return;
			}
		}

		const result = scaffold({ ...options, name, directory, mode, test });
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
