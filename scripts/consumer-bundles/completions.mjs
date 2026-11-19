import { cli, command } from '@kjanat/dreamcli';

await cli('app').command(command('hello')).completions().run();
