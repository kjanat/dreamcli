import { arg, command, flag } from '@kjanat/dreamcli';

export const greet = command('greet')
  .arg('name', arg.string())
  .flag('loud', flag.boolean())
  .action(({ args, flags, out }) => {
    const message = `Hello, ${args.name}!`;
    out.log(flags.loud ? message.toUpperCase() : message);
  });

export const deploy = command('deploy')
  .arg('target', arg.string())
  .flag('region', flag.string().env('DEPLOY_REGION').default('us'))
  .flag('force', flag.boolean())
  .action(({ args, flags, out }) => {
    out.log(`Deploying ${args.target} to ${flags.region}`);
    if (!flags.force) {
      out.warn('Use --force to skip confirmation');
    }
  });

export const cmd = command('cmd')
  .flag('flag', flag.string())
  .flag('region', flag.string().env('MY_REGION'))
  .action(({ flags, out }) => {
    out.log(flags.region ?? flags.flag ?? 'ok');
  });
