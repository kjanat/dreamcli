/** Source and test templates for the two starter layouts. @module */

const hello = `export const hello = command('hello')
	.description('Say hello')
	.arg('name', arg.string().default('World').describe('Who to greet'))
	.action(({ args, out }) => {
		out.log(\`Hello, \${args.name}!\`);
	});
`;

const run = `if (import.meta.main) {
	await app.run();
}
`;

export const entryTemplates = {
	single: `import { arg, cli, command } from '@kjanat/dreamcli';

${hello}
export const app = cli('__CLI_NAME__').default(hello);

${run}`,
	multi: `import { arg, cli, command, group } from '@kjanat/dreamcli';

${hello}
export const app = cli('__CLI_NAME__').command(group('greet').command(hello));

${run}`,
};

export const testTemplate = `import { runCommand } from '@kjanat/dreamcli/testkit';
import { expect, it } from '__TEST_RUNNER__';
import { hello } from '__ENTRY_FILE__';

it('greets the name passed on the command line', async () => {
	const result = await runCommand(hello, ['Ada']);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toEqual(['Hello, Ada!\\n']);
});
`;
