/**
 * GitHub Project helper entrypoint for the DreamCLI re-foundation workflow.
 *
 * @module
 */

import { cli } from 'dreamcli';

import { finish } from './commands/finish.ts';
import { list } from './commands/list.ts';
import { setWorkflow } from './commands/set.ts';
import { start } from './commands/start.ts';
import { sync } from './commands/sync.ts';

function run(): Promise<void> {
	return cli('gh-project')
		.description('Manage the DreamCLI re-foundation GitHub project')
		.command(list)
		.command(start)
		.command(setWorkflow)
		.command(finish)
		.command(sync)
		.completions({ rootMode: 'surface' })
		.run();
}

export { run };

if (import.meta.main) {
	void run();
}
