import { arg, command, flag } from '#dreamcli';

export const greet = command('greet')
  .arg('name', arg.string())
  .flag('loud', flag.boolean())
  .action(({ args, flags, out }) => {
    const message = `Hello, ${args.name}!`;
    out.log(flags.loud ? message.toUpperCase() : message);
  });

export const deploy = command('deploy')
  .arg('target', arg.string())
  .flag(
    'region',
    flag
      .enum(['us', 'eu', 'ap'])
      .env('DEPLOY_REGION')
      .config('deploy.region')
      .required()
      .prompt({ kind: 'select', message: 'Which region?' }),
  )
  .flag('force', flag.boolean())
  .action(({ args, flags, out }) => {
    out.log(`Deploying ${args.target} to ${flags.region}`);
    if (!flags.force) {
      out.warn('Use --force to skip confirmation');
    }
  });

export const regionCmd = command('region')
  .flag('flag', flag.string())
  .flag('region', flag.string().env('MY_REGION'))
  .action(({ flags, out }) => {
    out.log(flags.region ?? flags.flag ?? 'ok');
  });

export const promptCmd = command('prompt')
  .flag(
    'region',
    flag
      .enum(['us', 'eu', 'ap'])
      .required()
      .prompt({ kind: 'select', message: 'Region?' }),
  )
  .action(({ flags, out }) => {
    out.log(`region=${flags.region}`);
  });

export const activityCmd = command('build').action(
  ({ out }) => {
    const spinner = out.spinner('Building');
    spinner.succeed('Done');
  },
);

export const jsonListCmd = command('list').action(
  ({ out }) => {
    out.json([{ id: 1 }, { id: 2 }]);
  },
);
