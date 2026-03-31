/**
 * Interactive prompts with config file fallback.
 *
 * Demonstrates: per-flag .prompt(), command-level .interactive(),
 * .env(), .config(), resolution chain (CLI → env → config → prompt → default).
 *
 * The resolution chain means:
 *   1. Explicit CLI flag wins:      --region eu
 *   2. Then environment variable:   DEPLOY_REGION=eu
 *   3. Then config file value:      { "deploy": { "region": "eu" } }
 *   4. Then interactive prompt:     prompts user to select
 *   5. Then default value:          "us"
 *
 * Usage:
 *   npx tsx examples/interactive.ts                    # prompts for everything
 *   npx tsx examples/interactive.ts --region eu        # skips region prompt
 *   DEPLOY_REGION=ap npx tsx examples/interactive.ts   # env resolves region
 *   echo '{}' | npx tsx examples/interactive.ts        # non-interactive: uses defaults / errors
 */

import { arg, cli, command, flag } from 'dreamcli';

const deploy = command('deploy')
	.description('Deploy to an environment')
	.arg('target', arg.string().describe('Deploy target').default('staging'))
	.flag(
		'region',
		flag
			.enum(['us', 'eu', 'ap'])
			.env('DEPLOY_REGION')
			.config('deploy.region')
			.prompt({ kind: 'select', message: 'Which region?' })
			.default('us')
			.describe('Target region'),
	)
	.flag(
		'confirm',
		flag
			.boolean()
			.prompt({ kind: 'confirm', message: 'Proceed with deployment?' })
			.describe('Confirm deployment'),
	)
	.flag(
		'tag',
		flag
			.string()
			.prompt({ kind: 'input', message: 'Release tag (e.g. v1.2.3):' })
			.describe('Release tag'),
	)
	.action(({ args, flags, out }) => {
		// All flags are resolved by the time action runs.
		// flags.region: "us" | "eu" | "ap" — guaranteed by prompt/default
		// flags.confirm: boolean
		// flags.tag: string | undefined — only if user provided one
		if (!flags.confirm) {
			out.warn('Deployment cancelled');
			return;
		}
		out.log(`Deploying ${args.target} to ${flags.region}`);
		if (flags.tag !== undefined) {
			out.log(`Tagged: ${flags.tag}`);
		}
	});

void cli('deploy').default(deploy).run();
