/**
 * GitHub Project cli definition for the DreamCLI re-foundation workflow.
 *
 * @module
 */

import { cli } from '@kjanat/dreamcli';

import { finish } from '#commands/finish.ts';
import { list } from '#commands/list.ts';
import { setWorkflow } from '#commands/set.ts';
import { start } from '#commands/start.ts';
import { sync } from '#commands/sync.ts';

/** The `gh-project` CLI for managing the DreamCLI re-foundation GitHub project.
 *
 * Provides commands for listing, starting, syncing, and finishing project tasks.
 */
export const ghProject = cli('gh-project')
	.description('Manage the DreamCLI re-foundation GitHub project')
	.command(list)
	.command(start)
	.command(setWorkflow)
	.command(finish)
	.command(sync)
	.completions({ rootMode: 'surface' });
