import { arg, command, flag } from '@kjanat/dreamcli';

export const authLogin = command('login').description(
  'Authenticate with GitHub',
);
export const authStatus = command('status').description(
  'Show authentication status',
);

export const prList = command('list')
  .description('List pull requests')
  .flag(
    'state',
    flag
      .enum(['open', 'closed', 'merged', 'all'])
      .default('open'),
  );

export const prView = command('view')
  .description('View a pull request')
  .arg('number', arg.number());

export const prCreate = command('create')
  .description('Create a pull request')
  .flag('title', flag.string().required());

export const issueList =
  command('list').description('List issues');

export const issueTriage = command('triage')
  .description('Triage an issue')
  .arg('number', arg.number())
  .flag(
    'decision',
    flag.enum(['backlog', 'close', 'assign']).required(),
  );
