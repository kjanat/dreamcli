/** Templates for a DreamCLI project and for adding starter files to an existing project. @module */

const hello = `export const hello = command('hello')
	.description('Say hello')
	.arg('name', arg.string().default('World').describe('Who to greet'))
	.action(({ args, out }) => {
		out.log(\`Hello, \${args.name}!\`);
	});
`;

export const commandTemplate = `import { arg, command } from '@kjanat/dreamcli';

${hello}`;

export const cliTemplate = `import { cli } from '@kjanat/dreamcli';
import { hello } from './commands/hello.ts';

await cli('__CLI_NAME__').command(hello).run();
`;

export const standaloneTemplate = `import { arg, cli, command } from '@kjanat/dreamcli';

${hello}
if (import.meta.main) {
	await cli('__CLI_NAME__').command(hello).run();
}
`;

export const testTemplate = `import { runCommand } from '@kjanat/dreamcli/testkit';
import { expect, it } from '__TEST_RUNNER__';
import { hello } from '__COMMAND_FILE__';

it('greets the name passed on the command line', async () => {
	const result = await runCommand(hello, ['Ada']);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toEqual(['Hello, Ada!\\n']);
});
`;
