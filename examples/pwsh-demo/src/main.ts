#!/usr/bin/env bun
/**
 * PowerShell completion playground for DreamCLI.
 *
 * Usage:
 *   bun --cwd=examples/pwsh-demo src/main.ts --help
 *   bun --cwd=examples/pwsh-demo src/main.ts completions powershell
 *   bun --cwd=examples/pwsh-demo src/main.ts deploy --region eu --strategy canary
 *   bun --cwd=examples/pwsh-demo src/main.ts config set theme midnight --scope workspace
 *
 * @module
 */

import { arg, cli, command, flag, group } from '@kjanat/dreamcli';

const open = command('open')
	.description('Open a workspace session')
	.alias('o')
	.arg(
		'workspace',
		arg.enum(['alpha', 'bravo', 'charlie']).default('alpha').describe('Workspace to open'),
	)
	.flag(
		'profile',
		flag
			.enum(['default', 'ops', 'readonly'])
			.alias('p')
			.alias('account', { hidden: true })
			.describe('Credential profile'),
	)
	.flag(
		'shell',
		flag.enum(['powershell', 'cmd', 'bash']).default('powershell').describe('Interactive shell'),
	)
	.flag('format', flag.enum(['table', 'json', 'yaml']).alias('f').describe('Output format'))
	.flag('verbose', flag.boolean().alias('v').describe('Verbose logging'))
	.action(({ args, flags, out }) => {
		out.log(`Opening ${args.workspace} with ${flags.profile ?? 'default'} profile in ${flags.shell}`);
		out.log(`Format: ${flags.format ?? 'table'}`);
		if (flags.verbose) out.log('Verbose output enabled');
	});

const deploy = command('deploy')
	.description('Deploy the selected workspace')
	.alias('ship')
	.arg(
		'target',
		arg.enum(['dev', 'staging', 'prod']).default('staging').describe('Deployment target'),
	)
	.flag('region', flag.enum(['us', 'eu', 'ap']).alias('r').describe('Target region'))
	.flag(
		'strategy',
		flag.enum(['rolling', 'blue-green', 'canary']).alias('s').describe('Deployment strategy'),
	)
	.flag('approval', flag.enum(['manual', 'auto']).describe('Approval mode'))
	.flag('dryRun', flag.boolean().alias('d').describe('Preview the rollout without applying it'))
	.action(({ args, flags, out }) => {
		out.log(`Deploying ${args.target} to ${flags.region ?? 'us'} with ${flags.strategy ?? 'rolling'}`);
		out.log(`Approval: ${flags.approval ?? 'manual'}`);
		if (flags.dryRun) out.log('Dry run only');
	});

const status = command('status')
	.description('Show workspace status')
	.alias('st')
	.flag('view', flag.enum(['summary', 'full', 'json']).default('summary').describe('Status view'))
	.flag('watch', flag.boolean().alias('w').describe('Refresh continuously'))
	.action(({ flags, out }) => {
		out.log(`Status view: ${flags.view}`);
		if (flags.watch) out.log('Watching for changes');
	});

const configGet = command('get')
	.description('Read a saved setting')
	.alias('show')
	.arg('key', arg.enum(['theme', 'region', 'profile']).describe('Setting to read'))
	.action(({ args, out }) => {
		out.log(`${args.key}=demo-value`);
	});

const configSet = command('set')
	.description('Write a saved setting')
	.arg('key', arg.enum(['theme', 'region', 'profile']).describe('Setting to write'))
	.arg('value', arg.string().describe('New value'))
	.flag('scope', flag.enum(['user', 'workspace']).alias('s').default('user').describe('Config scope'))
	.action(({ args, flags, out }) => {
		out.log(`Saved ${args.key}=${args.value} to ${flags.scope} scope`);
	});

const configReset = command('reset')
	.description('Reset a saved setting')
	.alias('rm')
	.arg('key', arg.enum(['theme', 'region', 'profile']).describe('Setting to reset'))
	.flag('scope', flag.enum(['user', 'workspace']).default('user').describe('Config scope'))
	.action(({ args, flags, out }) => {
		out.log(`Reset ${args.key} in ${flags.scope} scope`);
	});

const config = group('config')
	.description('Manage saved settings')
	.command(configGet)
	.command(configSet)
	.command(configReset);

const debugDump = command('debug-dump')
	.description('Dump internal playground state')
	.hidden()
	.flag(
		'section',
		flag.enum(['schema', 'completions', 'runtime']).default('schema').describe('Section to inspect'),
	)
	.action(({ flags, out }) => {
		out.log(JSON.stringify({ section: flags.section, hidden: true }, null, 2));
	});

export const pwshDemo = cli('pwsh-demo')
	.packageJson()
	.default(open)
	.command(deploy)
	.command(status)
	.command(config)
	.command(debugDump)
	.completions({ rootMode: 'surface' });

if (import.meta.main) {
	pwshDemo.run();
}
