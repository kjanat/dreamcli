/** Bash must insert candidates into the actual Readline replacement range. */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { generateBashCompletion } from './shells/bash.ts';
import { quoteShellArg } from './shells/shared.ts';
import { runTerminalCases } from './terminal-test-helpers.ts';

const hasBash = spawnSync('bash', ['--version']).status === 0;

function replies(script: string, ...words: string[]) {
	const result = spawnSync(
		'bash',
		[
			'-c',
			[
				script,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Bash array expansion
				'_init_completion() { words=("${COMP_WORDS[@]}"); cword=$COMP_CWORD; cur=${words[cword]}; prev=${words[cword-1]}; }',
				'COMP_WORDS=(demo "$@"); COMP_CWORD=$#',
				'_demo_completions',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Bash array expansion
				'printf "%s\\n" "${COMPREPLY[@]}"',
			].join('\n'),
			'bash',
			...words,
		],
		{ encoding: 'utf8' },
	);
	expect(result.status, result.stderr).toBe(0);
	return result.stdout.trim().split('\n');
}

it.skipIf(!hasBash)('completes static default-command values on the visible root surface', () => {
	const root = command('run')
		.flag('mode', flag.enum(['fast', 'full']).alias('m'))
		.flag('level', flag.string().complete(['low', 'high']));
	const single = cli('demo').default(root);
	const hybrid = single.command(command('sub').flag('mode', flag.enum(['child'])));
	for (const script of [
		generateBashCompletion(single.schema),
		generateBashCompletion(hybrid.schema, { rootMode: 'surface' }),
	]) {
		expect(replies(script, '--mode', '')).toEqual(['fast', 'full']);
		expect(replies(script, '-m', 'fu')).toEqual(['full']);
		expect(replies(script, '--level=hi')).toEqual(['--level=high']);
	}
	expect(replies(generateBashCompletion(hybrid.schema), '--mode', '')).not.toContain('fast');
	expect(replies(generateBashCompletion(hybrid.schema), 'sub', '--mode', '')).toEqual(['child']);
});

it.skipIf(!hasBash)('completes optional boolean values at the cursor', () => {
	const values = ['true', 'false', '1', '0', 'truth'];
	const root = command('root')
		.flag('enabled', flag.boolean({ separateValue: true }).complete(values))
		.flag('plain', flag.boolean({ separateValue: true }));
	const task = command('task').flag('mode', flag.enum(['fast']));
	const app = cli('demo').default(root).command(task);
	const script = generateBashCompletion(app.schema, { rootMode: 'surface' });

	expect(replies(script, '--enabled', '')).toEqual(['true', 'false', '1', '0']);
	expect(replies(script, '--enabled', 't')).toEqual(['true']);
	expect(replies(script, '--enabled', 'f')).toEqual(['false']);
	expect(replies(script, '--enabled', 'ta')).toEqual(['task']);
	expect(replies(script, '--plain', '')).toContain('task');
	expect(replies(script, '--enabled', 'true', 'task', '--mode', 'f')).toEqual(['fast']);
});

it.skipIf(!hasBash)('rescans earlier options in each command group', () => {
	const app = cli('demo')
		.default(command('root').flag('pick', flag.boolean()))
		.command(
			command('group')
				.flag('pick', flag.string())
				.flag('mode', flag.enum(['from-group']))
				.command(command('nested').flag('mode', flag.enum(['from-child'])))
				.action(() => {}),
		);
	const script = generateBashCompletion(app.schema);

	expect(replies(script, '--pick', 'group', 'nested', '--mode', 'f')).toEqual(['from-group']);
	expect(replies(script, 'group', 'nested', '--mode', 'f')).toEqual(['from-child']);
});

it.skipIf(!hasBash)('falls back to an ancestor action for an unknown nested command', () => {
	const middle = command('middle')
		.flag('mode', flag.enum(['from-middle']))
		.command(command('leaf').flag('mode', flag.enum(['from-leaf'])));
	const outer = command('outer')
		.arg('rest', arg.string().variadic())
		.flag('mode', flag.enum(['from-outer']))
		.command(middle)
		.action(() => {});
	const script = generateBashCompletion(cli('demo').command(outer).schema);

	expect(replies(script, 'outer', 'middle', '--mode', 'f')).toEqual(['from-middle']);
	expect(replies(script, 'outer', 'middle', 'leaf', '--mode', 'f')).toEqual(['from-leaf']);
	expect(replies(script, 'outer', 'middle', '', '--mode', 'f')).toEqual(['from-middle']);
	expect(replies(script, 'outer', 'middle', 'nope', '--mode', 'f')).toEqual(['from-outer']);
});

const cases = [
	{ line: 'dcfixture adopt --name tenant:sub:wi', argv: ['adopt', '--name', 'tenant:sub:widget'] },
	{ line: 'dcfixture adopt --name tenant:wi', argv: ['adopt', '--name', 'tenant:widget'] },
	{ line: 'dcfixture adopt --name=tenant:wi', argv: ['adopt', '--name=tenant:widget'] },
	{
		line: 'dcfixture adopt --literal tenant:old --name wi',
		argv: ['adopt', '--literal', 'tenant:old', '--name', 'widget'],
	},
	{ line: 'dcfixture --value-only wi', argv: ['--value-only', 'widget'] },
	{ line: 'dcfixture --value-only=wi', argv: ['--value-only=widget'] },
	{ line: 'dcfixture adopt --name=wi', argv: ['adopt', '--name=widget'] },
	{ line: 'dcfixture adopt --name=', argv: ['adopt', '--name=widget'] },
	{ line: 'dcfixture adopt --name wi', argv: ['adopt', '--name', 'widget'] },
	{ line: 'dcfixture adopt -nwi', argv: ['adopt', '-nwidget'] },
	{ line: 'dcfixture adopt --mode=fa', argv: ['adopt', '--mode=fast'] },
	{ line: 'dcfixture adopt --mode fa', argv: ['adopt', '--mode', 'fast'] },
	{ line: 'dcfixture adopt --no-config --mo', argv: ['adopt', '--no-config', '--mode'] },
	{
		line: 'dcfixture adopt --no-config --config=settings.json --mo',
		argv: ['adopt', '--no-config', '--config=settings.json', '--mo'],
	},
	{
		line: 'dcfixture adopt --no-config --config settings.json --mo',
		argv: ['adopt', '--no-config', '--config', 'settings.json', '--mo'],
	},
	{
		line: 'dcfixture adopt --config=settings.json --no-config --mo',
		argv: ['adopt', '--config=settings.json', '--no-config', '--mo'],
	},
	{
		line: 'dcfixture adopt --config settings.json --no-config --mo',
		argv: ['adopt', '--config', 'settings.json', '--no-config', '--mo'],
	},
	{ line: 'dcfixture adopt --literal="sp', argv: ['adopt', '--literal=space value'] },
	{ line: 'dcfixture adopt "--literal=sp', argv: ['adopt', '--literal=space value'] },
	{ line: "dcfixture adopt --literal='sp", argv: ['adopt', '--literal=space value'] },
	{ line: 'dcfixture adopt --literal="sh', argv: ['adopt', '--literal=shell$(false)'] },
	{ line: "dcfixture adopt --literal='qu", argv: ['adopt', "--literal=quote'value"] },
	{ line: 'dcfixture adopt --literal=sp', argv: ['adopt', '--literal=space value'] },
	{ line: 'dcfixture adopt --literal=qu', argv: ['adopt', "--literal=quote'value"] },
	{ line: 'dcfixture adopt --literal=sh', argv: ['adopt', '--literal=shell$(false)'] },
	{ line: 'dcfixture adopt --literal=key=va', argv: ['adopt', '--literal=key=value'] },
];

const bashCompletion =
	process.env.DREAMCLI_BASH_COMPLETION ?? '/usr/share/bash-completion/bash_completion';
const prerequisites = [
	...(process.platform === 'linux' && !('Deno' in globalThis) ? [] : ['Linux Node/Bun host']),
	...['bash', 'bun'].filter((tool) => spawnSync(tool, ['--version']).status !== 0),
	...(existsSync(bashCompletion) ? [] : ['bash-completion']),
];
const wordBreakSettings = [
	'COMP_WORDBREAKS=$original_wordbreaks',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
	'COMP_WORDBREAKS=${original_wordbreaks//=/}',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
	'COMP_WORDBREAKS=${original_wordbreaks//:/}',
	'COMP_WORDBREAKS=$original_wordbreaks/,',
];

it.skipIf(prerequisites.length > 0)(
	'submits static values in their active scope as exact argv tokens',
	() => {
		const directory = mkdtempSync(join(tmpdir(), 'dreamcli-static-readline-'));
		try {
			const capture = join(directory, 'argv');
			const root = command('root')
				.flag('mode', flag.enum(['fast', 'full']).alias('m').alias('old-mode', { hidden: true }))
				.flag('verbose', flag.boolean().alias('v'))
				.flag('enabled', flag.boolean({ separateValue: true }))
				.flag('token', flag.string())
				.flag(
					'expr',
					flag
						.string()
						.allowHyphenValues()
						.complete(['--mode', '--config=operand', '--json', 'value']),
				)
				.flag('left', flag.string())
				.flag('right', flag.string())
				.flag('pick', flag.enum(['vroot']))
				.flag(
					'choices',
					flag.array(flag.enum(['--help=unknown', '--version=literal']), { variadic: true }),
				)
				.flag(
					'literal',
					flag
						.string()
						.complete([
							'space value',
							"quote'value",
							'shell$(false)',
							'hello!world',
							'stage:sub:scope',
							'key=value',
							'docs/cli/reference',
							'docs,cli,reference',
						]),
				)
				.arg('rest', arg.string().variadic());
			const single = cli('dcfixture').default(root);
			const run = command('run')
				.alias('r')
				.flag(
					'token',
					flag
						.string()
						.alias('t')
						.alias('filter')
						.allowHyphenValues()
						.complete([
							'--mode',
							'-preview',
							'--config=operand',
							'--no-config',
							'--json',
							'--quiet',
							'--version',
							'value',
						]),
				)
				.flag('verbose', flag.boolean().alias('v'))
				.flag('mode', flag.enum(['fast']))
				.flag('left', flag.boolean())
				.flag('pick', flag.enum(['vrun']))
				.flag('config', flag.enum(['override']))
				.flag(
					'items',
					flag
						.array(flag.enum(['--mode', '--json', 'first', 'space value']), { variadic: true })
						.allowHyphenValues(),
				)
				.arg('rest', arg.string().variadic().optional())
				.action(() => {});
			const parent = command('parent')
				.alias('p')
				.flag('filter', flag.boolean())
				.flag('mode', flag.enum(['strict']))
				.flag('select', flag.enum(['r']))
				.flag('shade', flag.enum(['green']))
				.command(run)
				.command(
					command('strict')
						.flag('shade', flag.enum(['gray']))
						.action(() => {}),
				)
				.action(() => {});
			const hybrid = single.command(
				command('child')
					.alias('ch')
					.alias('true')
					.helpTopic('runners', 'Runners')
					.flag('mode', flag.enum(['child-mode']))
					.flag('token', flag.string().alias('t'))
					.flag('left', flag.boolean())
					.flag('right', flag.boolean())
					.flag('enabled', flag.boolean())
					.flag('group-left', flag.string())
					.flag('group-right', flag.string())
					.arg('extra', arg.string())
					.flag(
						'many',
						flag
							.array(
								flag.enum([
									'first',
									'space value',
									'-preview',
									'--quiet',
									'--json=false',
									'--version',
									'--completions=bash',
									'--config=chosen.json',
									'--no-config',
									'--help=runners',
									'--help=unknown',
								]),
								{ variadic: true },
							)
							.group('Runners'),
					)
					.command(
						command('nested')
							.flag('mode', flag.enum(['nested-mode']))
							.flag('group-left', flag.boolean())
							.flag('group-right', flag.boolean())
							.action(() => {}),
					)
					.action(() => {}),
			);
			const routes = hybrid.command(run).command(parent);
			const releasedOutput = cli('dcfixture')
				.builtins({ json: 'off', quiet: 'off' })
				.command(
					command('release')
						.flag('json', flag.enum(['report']))
						.flag('quiet', flag.enum(['soft']).alias('q')),
				);
			const topicValues = flag
				.array(flag.enum(['--help=runners', '--help=other', '--version=literal']), {
					variadic: true,
				})
				.group('Runners');
			const topicRoute = (name: string) =>
				command(name).flag('many', topicValues).helpTopic('runners', 'Runners');
			const helpTopics = cli('dcfixture')
				.version('1.0', { alias: 'z' })
				.default(topicRoute('default'))
				.command(topicRoute('named').alias('nr'))
				.command(command('plain').flag('many', topicValues))
				.command(
					command('opted')
						.flag('many', topicValues.allowHyphenValues())
						.helpTopic('runners', 'Runners'),
				);
			const rootCases = [
				{ line: '--choices --help=un', argv: ['--choices', '--help=unknown'] },
				{ line: '--mode=fa', argv: ['--mode=fast'] },
				{ line: '-m fu', argv: ['-m', 'full'] },
				{ line: '--old-mode=fa', argv: ['--old-mode=fast'] },
				{ line: '-vmfu', argv: ['-vmfull'] },
				{ line: '--literal sp', argv: ['--literal', 'space value'] },
				{ line: '--literal=sp', argv: ['--literal=space value'] },
				{ line: '--literal "space v', argv: ['--literal', 'space value'] },
				{ line: '--literal space\\ v', argv: ['--literal', 'space value'] },
				{ line: '"--literal=sp', argv: ['--literal=space value'] },
				{ line: "--literal='qu", argv: ["--literal=quote'value"] },
				{ line: '--literal=qu', argv: ["--literal=quote'value"] },
				{ line: '--literal="sh', argv: ['--literal=shell$(false)'] },
				{ line: '--literal sh', argv: ['--literal', 'shell$(false)'] },
				{ line: '--literal "he', argv: ['--literal', 'hello!world'] },
				{ line: '--literal stage:sub:sc', argv: ['--literal', 'stage:sub:scope'] },
				{ line: '--literal=stage:sub:sc', argv: ['--literal=stage:sub:scope'] },
				{ line: '--literal key=va', argv: ['--literal', 'key=value'] },
				{ line: '--literal=key=va', argv: ['--literal=key=value'] },
				{ line: '--literal docs/cli/re', argv: ['--literal', 'docs/cli/reference'] },
				{ line: '--literal=docs/cli/re', argv: ['--literal=docs/cli/reference'] },
				{ line: '--literal docs,cli,re', argv: ['--literal', 'docs,cli,reference'] },
				{ line: '--literal=docs,cli,re', argv: ['--literal=docs,cli,reference'] },
				{ line: '--expr --mo', argv: ['--expr', '--mode'] },
				{ line: '--expr --mode fa', argv: ['--expr', '--mode', 'fa'] },
				{ line: '--token -- --mode fa', argv: ['--token', '--', '--mode', 'fa'] },
				{ line: '-- --mode=fa', argv: ['--', '--mode=fa'] },
				{ line: '-- --mo', argv: ['--', '--mo'] },
			];
			const namedCases = [
				{ line: 'ch --mode=ch', argv: ['ch', '--mode=child-mode'] },
				{ line: '- child --mode ch', argv: ['-', 'child', '--mode', 'child-mode'] },
				{ line: 'ch nested --mode ne', argv: ['ch', 'nested', '--mode', 'nested-mode'] },
				{
					line: '--left --right child --mode ch',
					argv: ['--left', '--right', 'child', '--mode', 'child-mode'],
				},
				{
					line: 'child --group-left --group-right nested --mode ne',
					argv: ['child', '--group-left', '--group-right', 'nested', '--mode', 'nested-mode'],
				},
				{
					line: 'child -t nested --mode ch',
					argv: ['child', '-t', 'nested', '--mode', 'child-mode'],
				},
				{ line: 'child --token --mode ch', argv: ['child', '--token', '--mode', 'child-mode'] },
				{ line: 'child --mode -- --mode=ch', argv: ['child', '--mode', '--', '--mode=ch'] },
				{ line: 'child --many first sp', argv: ['child', '--many', 'first', 'space value'] },
				{
					line: 'child --many first --quiet sp',
					argv: ['child', '--many', 'first', '--quiet', 'sp'],
				},
				{ line: 'child --mode --quiet ch', argv: ['child', '--mode', '--quiet', 'child-mode'] },
				{ line: 'child --many -pre', argv: ['child', '--many', '-preview'] },
				{ line: 'child --many --qui', argv: ['child', '--many', '--qui'] },
				{ line: 'child --many --js', argv: ['child', '--many', '--js'] },
				{ line: 'child --many=--qui', argv: ['child', '--many=--quiet'] },
				{ line: 'child --many --ve', argv: ['child', '--many', '--version'] },
				{ line: 'child --many --comp', argv: ['child', '--many', '--completions=bash'] },
				{ line: 'child --many --conf', argv: ['child', '--many', '--config=chosen.json'] },
				{ line: 'child --many --help=ru', argv: ['child', '--many', '--help=ru'] },
				{ line: 'child --many --help=un', argv: ['child', '--many', '--help=unknown'] },
				{ line: 'child --many=--help=ru', argv: ['child', '--many=--help=runners'] },
				{
					line: 'child --many=first --mode ch',
					argv: ['child', '--many=first', '--mode', 'child-mode'],
				},
			];
			const scopeCases = [
				{ line: '--token child --mode fa', argv: ['--token', 'child', '--mode', 'fast'] },
				{ line: '--enabled true --mode fa', argv: ['--enabled', 'true', '--mode', 'fast'] },
				{
					line: '--enabled --quiet true --mode ch',
					argv: ['--enabled', '--quiet', 'true', '--mode', 'child-mode'],
				},
				{ line: 'unknown child --mode fa', argv: ['unknown', 'child', '--mode', 'fast'] },
				...['--quiet', '-q', '--quiet=false', '--json', '--json=1'].map((outputFlag) => ({
					line: `--left ${outputFlag} child --mode fa`,
					argv: ['--left', outputFlag, 'child', '--mode', 'fast'],
				})),
			];
			const hyphenCases = [
				{ line: 'run --token --mode fa', argv: ['run', '--token', '--mode', 'fa'] },
				{ line: 'r --filter --mo', argv: ['r', '--filter', '--mode'] },
				{ line: 'r -t -pre', argv: ['r', '-t', '-preview'] },
				{ line: 'r -vt--mo', argv: ['r', '-vt--mode'] },
				{ line: 'r --filter=--mo', argv: ['r', '--filter=--mode'] },
				{ line: 'r --filter=--mo --mode fa', argv: ['r', '--filter=--mo', '--mode', 'fast'] },
				{ line: 'r --filter -- --mode fa', argv: ['r', '--filter', '--', '--mode', 'fa'] },
				{ line: 'r --items --mo', argv: ['r', '--items', '--mode'] },
				{ line: 'r --items --mode sp', argv: ['r', '--items', '--mode', 'space value'] },
				{
					line: 'r --items --mode --mode fa',
					argv: ['r', '--items', '--mode', '--mode', 'fast'],
				},
				{ line: 'r --items=first --mode fa', argv: ['r', '--items=first', '--mode', 'fast'] },
				{ line: 'r --items -- --mode fa', argv: ['r', '--items', '--', '--mode', 'fa'] },
				{
					line: '--filter --mode r --mode fa',
					argv: ['--filter', '--mode', 'r', '--mode', 'fast'],
				},
				{
					line: '--filter --mode p r --mode fa',
					argv: ['--filter', '--mode', 'p', 'r', '--mode', 'fast'],
				},
				{
					line: 'p --filter --mode r --mode fa',
					argv: ['p', '--filter', '--mode', 'r', '--mode', 'fast'],
				},
				{
					line: 'p -vt --mode r --mode fa',
					argv: ['p', '-vt', '--mode', 'r', '--mode', 'fast'],
				},
				{
					line: 'p --items --mode r --mode fa',
					argv: ['p', '--items', '--mode', 'r', '--mode', 'fast'],
				},
				{
					line: 'p --filter --mode strict --select r --shade gr',
					argv: ['p', '--filter', '--mode', 'strict', '--select', 'r', '--shade', 'green'],
				},
			];
			const outputCases = [
				{ line: '--left --quiet r --pick v', argv: ['--left', '--quiet', 'r', '--pick', 'vroot'] },
				{ line: '--left --json r --pick v', argv: ['--left', '--json', 'r', '--pick', 'vroot'] },
				{
					line: '--left --quiet=false r --pick v',
					argv: ['--left', '--quiet=false', 'r', '--pick', 'vroot'],
				},
				{
					line: '--left --json=true r --pick v',
					argv: ['--left', '--json=true', 'r', '--pick', 'vroot'],
				},
				{ line: '--left -q r --pick v', argv: ['--left', '-q', 'r', '--pick', 'vroot'] },
				{ line: 'r --mode --quiet fa', argv: ['r', '--mode', '--quiet', 'fast'] },
				{ line: 'r --token --qui', argv: ['r', '--token', '--quiet'] },
				{ line: 'r -t --js', argv: ['r', '-t', '--json'] },
				{ line: 'r -t -q va', argv: ['r', '-t', '-q', 'va'] },
				{ line: 'r --token --json=false va', argv: ['r', '--token', '--json=false', 'va'] },
				{ line: 'p --filter --json r va', argv: ['p', '--filter', '--json', 'r', 'va'] },
				{ line: 'r --items --json sp', argv: ['r', '--items', '--json', 'space value'] },
				{ line: 'r --items=first --json sp', argv: ['r', '--items=first', '--json', 'sp'] },
				{ line: '--expr --js', argv: ['--expr', '--json'] },
				{ line: '--expr --json va', argv: ['--expr', '--json', 'va'] },
				{ line: 'child --many --qui', argv: ['child', '--many', '--qui'] },
				{ line: 'child --many=--qui', argv: ['child', '--many=--quiet'] },
				{ line: 'child --many --con', argv: ['child', '--many', '--config=chosen.json'] },
				{ line: 'child --many --ver', argv: ['child', '--many', '--version'] },
				{ line: 'child --many --comp', argv: ['child', '--many', '--completions=bash'] },
			];
			const configCases = [
				{
					line: '--config settings.json ch --mode ch',
					argv: ['--config', 'settings.json', 'ch', '--mode', 'child-mode'],
				},
				{
					line: '--config "local settings.json" ch --mode ch',
					argv: ['--config', 'local settings.json', 'ch', '--mode', 'child-mode'],
				},
				{
					line: 'ch --config settings.json nested --mode ne',
					argv: ['ch', '--config', 'settings.json', 'nested', '--mode', 'nested-mode'],
				},
				{
					line: '--config=settings.json ch --mode ch',
					argv: ['--config=settings.json', 'ch', '--mode', 'child-mode'],
				},
				{ line: '--config child --mode fa', argv: ['--config', 'child', '--mode', 'fast'] },
				{ line: '--config chi', argv: ['--config', 'chi'] },
				{
					line: '--config --token child --mode fa',
					argv: ['--config', '--token', 'child', '--mode', 'fast'],
				},
				{
					line: '--config= --config settings.json ch --mode ch',
					argv: ['--config=', '--config', 'settings.json', 'ch', '--mode', 'child-mode'],
				},
				{
					line: '--config=settings.json --config other.json child --mode ch',
					argv: ['--config=settings.json', '--config', 'other.json', 'child', '--mode', 'ch'],
				},
				{ line: 'child --many --conf', argv: ['child', '--many', '--conf'] },
				{
					line: '--config settings.json child --many --conf',
					argv: ['--config', 'settings.json', 'child', '--many', '--config=chosen.json'],
				},
				{ line: 'child --many --no-co', argv: ['child', '--many', '--no-config'] },
			];
			const configured = hybrid.config('dcfixture');
			const released = configured.builtins({ help: 'off', json: 'off', quiet: 'off' }).command(
				command('release')
					.flag('json', flag.enum(['report']))
					.flag('quiet', flag.enum(['detail']).alias('q'))
					.flag('no-config', flag.enum(['selection'])),
			);
			const groups = [
				{ script: generateBashCompletion(single.schema), cases: rootCases },
				{
					script: generateBashCompletion(hybrid.schema, { rootMode: 'surface' }),
					cases: [
						...rootCases,
						...namedCases,
						...scopeCases,
						{
							line: '--config settings.json ch --mode ch',
							argv: ['--config', 'settings.json', 'ch', '--mode', 'ch'],
						},
					],
				},
				{
					script: generateBashCompletion(hybrid.schema),
					cases: [
						{ line: '--mode fa', argv: ['--mode', 'fa'] },
						{ line: '--literal=sp', argv: ['--literal=sp'] },
						{ line: '--token child --mode ch', argv: ['--token', 'child', '--mode', 'ch'] },
						...namedCases,
					],
				},
				{
					script: generateBashCompletion(configured.schema, { rootMode: 'surface' }),
					cases: configCases,
				},
				{
					script: generateBashCompletion(hybrid.config('dcfixture', { noConfigFlag: true }).schema),
					cases: [
						{ line: 'child --many --no-co', argv: ['child', '--many', '--no-co'] },
						{
							line: '--no-config ch --mode ch',
							argv: ['--no-config', 'ch', '--mode', 'child-mode'],
						},
						{
							line: 'ch --no-config --config=settings.json --mo',
							argv: ['ch', '--no-config', '--config=settings.json', '--mo'],
						},
						{
							line: '--config settings.json --no-config ch --mode ch',
							argv: ['--config', 'settings.json', '--no-config', 'ch', '--mode', 'ch'],
						},
					],
				},
				{
					script: generateBashCompletion(released.schema),
					cases: [
						{ line: 'child --many --qui', argv: ['child', '--many', '--quiet'] },
						{ line: 'child --many --js', argv: ['child', '--many', '--json=false'] },
						{ line: 'child --many --help=ru', argv: ['child', '--many', '--help=runners'] },
						{ line: 'release --no-config se', argv: ['release', '--no-config', 'selection'] },
						{ line: 'release --quiet=de', argv: ['release', '--quiet=detail'] },
						{ line: 'release -q de', argv: ['release', '-q', 'detail'] },
						{
							line: '--config settings.json release --json re',
							argv: ['--config', 'settings.json', 'release', '--json', 'report'],
						},
					],
				},
				{
					script: generateBashCompletion(routes.schema, { rootMode: 'surface' }),
					cases: outputCases,
				},
				{
					script: generateBashCompletion(helpTopics.schema, { rootMode: 'surface' }),
					cases: [
						{ line: '--many --help=ru', argv: ['--many', '--help=ru'] },
						{ line: '--many --help=ot', argv: ['--many', '--help=other'] },
						{ line: '--many --ver', argv: ['--many', '--version=literal'] },
						{ line: 'nr --many --help=ru', argv: ['nr', '--many', '--help=ru'] },
						{ line: 'nr --many=--help=ru', argv: ['nr', '--many=--help=runners'] },
						{ line: 'plain --many --help=ru', argv: ['plain', '--many', '--help=runners'] },
						{ line: 'opted --many --help=ru', argv: ['opted', '--many', '--help=runners'] },
					],
				},
				{
					script: generateBashCompletion(helpTopics.builtins({ help: 'off' }).schema),
					cases: [{ line: 'nr --many --help=ru', argv: ['nr', '--many', '--help=runners'] }],
				},
				{
					script: generateBashCompletion(releasedOutput.schema),
					cases: [
						{ line: 'release --json re', argv: ['release', '--json', 'report'] },
						{ line: 'release --quiet=so', argv: ['release', '--quiet=soft'] },
						{ line: 'release -q so', argv: ['release', '-q', 'soft'] },
					],
				},
				{
					script: generateBashCompletion(
						routes.version('1.0', { alias: 'z' }).completions({ as: 'flag' }).schema,
					),
					cases: [
						{ line: 'child --many --ver', argv: ['child', '--many', '--ver'] },
						{ line: 'child --many --comp', argv: ['child', '--many', '--comp'] },
						{ line: 'child --many=--ver', argv: ['child', '--many=--version'] },
						{ line: 'child --many=--comp', argv: ['child', '--many=--completions=bash'] },
						{ line: 'r --token --ver', argv: ['r', '--token', '--version'] },
					],
				},
				{
					script: generateBashCompletion(single.config('dcfixture').schema),
					cases: [{ line: '--expr --config=op', argv: ['--expr', '--config=operand'] }],
				},
				{
					script: generateBashCompletion(
						routes.config('dcfixture', { noConfigFlag: true }).schema,
						{ rootMode: 'surface' },
					),
					cases: [
						{
							line: '--config /tmp/settings.json --token --config=operand r --mode fa',
							argv: [
								'--config',
								'/tmp/settings.json',
								'--token',
								'--config=operand',
								'r',
								'--mode',
								'fast',
							],
						},
						{
							line: '--config=primary.json r --config ov',
							argv: ['--config=primary.json', 'r', '--config', 'override'],
						},
						{
							line: '--config=primary.json --config r --mode fa',
							argv: ['--config=primary.json', '--config', 'r', '--mode', 'fast'],
						},
						{
							line: '--config r child --mode ch',
							argv: ['--config', 'r', 'child', '--mode', 'child-mode'],
						},
						{
							line: '--config= --config p r --mode fa',
							argv: ['--config=', '--config', 'p', 'r', '--mode', 'fast'],
						},
						{
							line: '--filter --config r --mode fa',
							argv: ['--filter', '--config', 'r', '--mode', 'fast'],
						},
						{
							line: 'r --token --config=op',
							argv: ['r', '--token', '--config=operand'],
						},
						{
							line: '--expr --config=operand --config p --mode fa',
							argv: ['--expr', '--config=operand', '--config', 'p', '--mode', 'fast'],
						},
						{
							line: '--no-config r --token --no-c',
							argv: ['--no-config', 'r', '--token', '--no-config'],
						},
						{
							line: '--no-config --config=p r --mode fa',
							argv: ['--no-config', '--config=p', 'r', '--mode', 'fa'],
						},
						{
							line: 'r --config ov',
							argv: ['r', '--config', 'ov'],
						},
						{
							line: 'r --config=ov',
							argv: ['r', '--config=ov'],
						},
						{
							line: 'r --mode --config primary.json fa',
							argv: ['r', '--mode', '--config', 'primary.json', 'fast'],
						},
						{
							line: '--filter r --config primary.json va',
							argv: ['--filter', 'r', '--config', 'primary.json', 'value'],
						},
						{
							line: '--filter r --config primary.json -pre',
							argv: ['--filter', 'r', '--config', 'primary.json', '-pre'],
						},
						{
							line: 'r --items=first --config primary.json sp',
							argv: ['r', '--items=first', '--config', 'primary.json', 'sp'],
						},
						{ line: 'child --many --con', argv: ['child', '--many', '--con'] },
						{
							line: '--config primary.json child --many --con',
							argv: ['--config', 'primary.json', 'child', '--many', '--config=chosen.json'],
						},
						{
							line: '--left --config primary.json --right child --mode ch',
							argv: [
								'--left',
								'--config',
								'primary.json',
								'--right',
								'child',
								'--mode',
								'child-mode',
							],
						},
					],
				},
				{
					script: generateBashCompletion(routes.schema, { rootMode: 'surface' }),
					cases: [...rootCases, ...namedCases, ...scopeCases, ...hyphenCases],
				},
				{
					script: generateBashCompletion(routes.schema),
					cases: [
						{ line: '--mode fa', argv: ['--mode', 'fa'] },
						{ line: '--literal=sp', argv: ['--literal=sp'] },
						{ line: '--token child --mode ch', argv: ['--token', 'child', '--mode', 'ch'] },
						...namedCases,
						...hyphenCases,
					],
				},
				{
					script: generateBashCompletion(
						hybrid.version('1.0.0').completions({ as: 'flag' }).schema,
						{ rootMode: 'surface' },
					),
					cases: [
						{ line: '--choices --version=li', argv: ['--choices', '--version=literal'] },
						{ line: 'child --many --ve', argv: ['child', '--many', '--ve'] },
						{ line: 'child --many --comp', argv: ['child', '--many', '--comp'] },
						{ line: 'child --many=--comp', argv: ['child', '--many=--completions=bash'] },
					],
				},
			];
			const scenarios = groups.flatMap((group, index) => {
				const path = join(directory, `completion-${index}.bash`);
				writeFileSync(path, group.script);
				return wordBreakSettings.flatMap((wordBreaks) =>
					group.cases.map((value) => ({
						...value,
						line: `dcfixture ${value.line}`,
						configure: `source ${quoteShellArg(path)}; ${wordBreaks}`,
					})),
				);
			});
			const actual = runTerminalCases({
				shell: 'bash',
				capture,
				setup: [
					`source ${quoteShellArg(bashCompletion)}`,
					'original_wordbreaks=$COMP_WORDBREAKS',
					'set -H',
					'history -s world-expanded',
					`dcfixture() { printf '%s\\0' "$@" > ${quoteShellArg(capture)}; }`,
				].join('; '),
				cases: scenarios,
			});
			expect(actual).toHaveLength(scenarios.length);
			for (const [index, item] of actual.entries()) {
				expect(item.argv, item.transcript).toEqual(scenarios[index]?.argv);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	120_000,
);

// CI hosts without these optional tools report why the terminal test is skipped.
if (prerequisites.length > 0)
	console.warn(`Skipping Bash Readline test: requires ${prerequisites.join(', ')}`);
describe.skipIf(prerequisites.length > 0)(
	`Bash Readline completion${prerequisites.length ? ` (requires ${prerequisites.join(', ')})` : ''}`,
	() => {
		it('submits whole values with default and customized word breaks', () => {
			const directory = mkdtempSync(join(tmpdir(), 'dreamcli-readline-'));
			try {
				const source = new URL('../../index.ts', import.meta.url).href;
				const fixture = join(directory, 'fixture.ts');
				const capture = join(directory, 'argv');
				const completionCapture = join(directory, 'completion-argv');
				const script = join(directory, 'completion.bash');
				const literals = ['space value', "quote'value", 'shell$(false)', 'key=value'];
				const app = cli('dcfixture')
					.config('dcfixture', { noConfigFlag: true })
					.default(
						command('default').flag(
							'value-only',
							flag.string().complete(() => ['widget']),
						),
					)
					.command(
						command('adopt')
							.flag(
								'name',
								flag
									.string()
									.alias('n')
									.complete(({ prefix }) => [
										prefix.includes('sub:')
											? 'tenant:sub:widget'
											: prefix.includes(':')
												? 'tenant:widget'
												: 'widget',
									]),
							)
							.flag('mode', flag.enum(['fast', 'full']))
							.flag(
								'literal',
								flag.string().complete(() => literals),
							),
					);
				writeFileSync(
					join(directory, 'fixture-data.json'),
					JSON.stringify({ source, candidates: literals }),
				);
				writeFileSync(script, generateBashCompletion(app.schema));
				writeFileSync(
					fixture,
					[
						"import settings from './fixture-data.json' with { type: 'json' };",
						'const { cli, command, flag } = await import(settings.source);',
						"await cli('dcfixture')",
						".config('dcfixture', { noConfigFlag: true })",
						".default(command('default').flag('value-only', flag.string().complete(() => ['widget'])))",
						".command(command('adopt')",
						".flag('name', flag.string().alias('n').complete(({ prefix }) => [prefix.includes('sub:') ? 'tenant:sub:widget' : prefix.includes(':') ? 'tenant:widget' : 'widget']))",
						".flag('mode', flag.enum(['fast', 'full']))",
						".flag('literal', flag.string().complete(() => settings.candidates))).run();",
					].join('\n'),
				);
				writeFileSync(
					join(directory, 'dcfixture'),
					[
						'#!/usr/bin/env bash',
						// biome-ignore lint/suspicious/noTemplateCurlyInString: bash positional parameter
						'if [[ "${1-}" == __complete ]]; then',
						`  printf '%s\\0' "\${@:2}" > ${quoteShellArg(completionCapture)}`,
						`  exec bun ${quoteShellArg(fixture)} "$@"`,
						'fi',
						`printf '%s\\0' "$@" > ${quoteShellArg(capture)}`,
					].join('\n'),
					{ mode: 0o700 },
				);
				const actual = runTerminalCases({
					shell: 'bash',
					capture,
					completionCapture,
					setup: `export PATH=${quoteShellArg(directory)}:"$PATH"; source ${quoteShellArg(bashCompletion)}; source ${quoteShellArg(script)}; original_wordbreaks=$COMP_WORDBREAKS`,
					cases: wordBreakSettings.flatMap((configure) =>
						cases.map((value) => ({ ...value, configure })),
					),
				});
				expect(actual).toHaveLength(wordBreakSettings.length * cases.length);
				for (const [index, item] of actual.entries()) {
					expect(item.argv, item.transcript).toEqual(cases[index % cases.length]?.argv);
					expect(item.completionArgv).toEqual([
						'--',
						...item.line
							.slice('dcfixture '.length)
							.replaceAll('"', '')
							.replaceAll("'", '')
							.split(' '),
					]);
				}
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}, 120_000);
	},
);
