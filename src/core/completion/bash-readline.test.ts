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

const runReadline = String.raw`
import json, os, pty, select, signal, sys, time

settings = json.load(sys.stdin)
completion_capture = settings.get('completion_capture')
prompt = b'READLINE_TEST> '
pid, terminal = pty.fork()
if pid == 0:
    env = dict(os.environ, PS1=prompt.decode(), HISTFILE='/dev/null', INPUTRC='/dev/null', TERM='dumb')
    os.execvpe('bash', ['bash', '--noprofile', '--norc', '-i'], env)

def read_prompt():
    data = b''
    deadline = time.monotonic() + 10
    while not data.endswith(prompt):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([terminal], [], [], remaining)[0]:
            raise RuntimeError('Timed out waiting for Bash: ' + repr(data))
        data += os.read(terminal, 65536)
    return data.decode(errors='replace')

def send(line):
    os.write(terminal, line.encode())
    return read_prompt()

results = []
try:
    read_prompt()
    send(settings['setup'] + '\n')
    for case in settings['cases']:
        send(case['configure'] + '\n')
        if os.path.exists(settings['capture']):
            os.unlink(settings['capture'])
        if completion_capture and os.path.exists(completion_capture):
            os.unlink(completion_capture)
        transcript = send(case['line'] + '\t\n')
        with open(settings['capture'], 'rb') as captured:
            argv = captured.read().decode().split('\0')[:-1]
        completion_argv = None
        if completion_capture:
            with open(completion_capture, 'rb') as captured:
                completion_argv = captured.read().decode().split('\0')[:-1]
        results.append(dict(completion_argv=completion_argv, configure=case['configure'], line=case['line'], argv=argv, transcript=transcript))
    print(json.dumps(results))
finally:
    os.kill(pid, signal.SIGKILL)
    os.close(terminal)
    os.waitpid(pid, 0)
`;

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
const readlinePrerequisites = [
	...(process.platform === 'linux' && !('Deno' in globalThis) ? [] : ['Linux Node/Bun host']),
	...['bash', 'python3'].filter((tool) => spawnSync(tool, ['--version']).status !== 0),
	...(existsSync(bashCompletion) ? [] : ['bash-completion']),
];
const prerequisites = [
	...readlinePrerequisites,
	...(spawnSync('bun', ['--version']).status === 0 ? [] : ['bun']),
];
const wordBreakSettings = [
	'COMP_WORDBREAKS=$original_wordbreaks',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
	'COMP_WORDBREAKS=${original_wordbreaks//=/}',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
	'COMP_WORDBREAKS=${original_wordbreaks//:/}',
	'COMP_WORDBREAKS=$original_wordbreaks/,',
];

it.skipIf(readlinePrerequisites.length > 0)(
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
				.flag('left', flag.string())
				.flag('right', flag.string())
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
			const rootCases = [
				{ line: '--mode=fa', argv: ['--mode=fast'] },
				{ line: '--choices --help=un', argv: ['--choices', '--help=unknown'] },
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
			const result = spawnSync('python3', ['-c', runReadline], {
				input: JSON.stringify({
					capture,
					setup: [
						`source ${quoteShellArg(bashCompletion)}`,
						'original_wordbreaks=$COMP_WORDBREAKS',
						'set -H',
						'history -s world-expanded',
						`dcfixture() { printf '%s\\0' "$@" > ${quoteShellArg(capture)}; }`,
					].join('; '),
					cases: scenarios,
				}),
				encoding: 'utf8',
				timeout: 25_000,
			});
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(0);
			const actual: { argv: string[]; transcript: string }[] = JSON.parse(result.stdout);
			expect(actual).toHaveLength(scenarios.length);
			for (const [index, item] of actual.entries()) {
				expect(item.argv, item.transcript).toEqual(scenarios[index]?.argv);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	30_000,
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
				const result = spawnSync('python3', ['-c', runReadline], {
					input: JSON.stringify({
						capture,
						completion_capture: completionCapture,
						setup: `export PATH=${quoteShellArg(directory)}:"$PATH"; source ${quoteShellArg(bashCompletion)}; source ${quoteShellArg(script)}; original_wordbreaks=$COMP_WORDBREAKS`,
						cases: wordBreakSettings.flatMap((configure) =>
							cases.map((value) => ({ ...value, configure })),
						),
					}),
					encoding: 'utf8',
					timeout: 25_000,
				});
				expect(result.error).toBeUndefined();
				expect(result.status, result.stderr).toBe(0);
				const actual: {
					line: string;
					argv: string[];
					transcript: string;
					completion_argv: string[];
				}[] = JSON.parse(result.stdout);
				expect(actual).toHaveLength(wordBreakSettings.length * cases.length);
				for (const [index, item] of actual.entries()) {
					expect(item.argv, item.transcript).toEqual(cases[index % cases.length]?.argv);
					expect(item.completion_argv).toEqual([
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
		}, 30_000);
	},
);
