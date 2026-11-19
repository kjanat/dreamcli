import { cli, command } from '@kjanat/dreamcli';

await cli('app')
	.command(command('hello').action(({ out }) => out.log('hello')))
	.run();
