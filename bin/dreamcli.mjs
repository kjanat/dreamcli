#!/usr/bin/env node

/** DreamCLI's package executable. @module */

import { arg, cli, command, flag } from '@kjanat/dreamcli';
import { scaffold } from '@kjanat/dreamcli/create';
import { DREAMCLI_VERSION } from '@kjanat/dreamcli/version';

const create = command('create')
	.alias('init')
	.description('Generate a DreamCLI starter')
	.arg('name', arg.string().required().describe('Name of the CLI'))
	.flag('mode', flag.enum(['single', 'multi']).default('single').describe('Starter layout'))
	.flag('out', flag.string().default('.').describe('Output directory'))
	.flag('test', flag.boolean().default(true).negatable().describe('Generate a starter test'))
	.flag('force', flag.boolean().default(false).describe('Replace existing starter files'))
	.action(({ args, flags, out }) => {
		const result = scaffold({ name: args.name, ...flags });
		if (out.jsonMode) {
			out.json(result);
			return;
		}
		out.log(`Created ${result.entry}`);
		if (result.test !== undefined) {
			out.log(`Created ${result.test} (${result.testRunner})`);
		}
	});

await cli('dreamcli')
	.version(DREAMCLI_VERSION)
	.description('Create a project with DreamCLI')
	.command(create)
	.run();
