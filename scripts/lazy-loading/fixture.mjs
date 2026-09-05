import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);

const dist = new URL('../../dist/', import.meta.url);
const { cli, command, flag } = await import(new URL('index.mjs', dist).href);

async function ttyAdapter(stdinLine) {
	const { createNodeAdapter } = await import(new URL('runtime.mjs', dist).href);
	return {
		...createNodeAdapter(),
		stdinIsTTY: true,
		stdin: async () => stdinLine,
	};
}

const deploy = command('deploy')
	.flag('region', flag.string().prompt({ kind: 'input', message: 'Region?' }))
	.action(() => {});

const scenario = process.env.DREAMCLI_SCENARIO;
switch (scenario) {
	case 'plain':
	case 'help-json':
		await cli('app').command(deploy).run();
		break;
	case 'completions-command':
		await cli('app').command(deploy).completions().run();
		break;
	case 'completions-flag':
		await cli('app').config('app').manifest().command(deploy).completions({ as: 'flag' }).run();
		break;
	case 'config':
		await cli('app').config('app').command(deploy).run();
		break;
	case 'manifest':
		await cli('app').manifest().command(deploy).run();
		break;
	case 'manifest-data':
		await cli('app').manifest({ version: '1.0.0' }).command(deploy).run();
		break;
	case 'tty-no-prompt':
		await cli('app')
			.command(deploy)
			.run({ adapter: await ttyAdapter('eu') });
		break;
	case 'tty-prompt':
		await cli('app')
			.command(deploy)
			.run({ adapter: await ttyAdapter('eu') });
		break;
	case 'answers':
		await cli('app')
			.command(deploy)
			.execute(['deploy'], { answers: ['eu'] });
		break;
	default:
		throw new Error(`unknown scenario: ${scenario}`);
}
