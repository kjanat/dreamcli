/** Bash must insert candidates into the actual Readline replacement range. */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { generateBashCompletion } from './shells/bash.ts';
import { quoteShellArg } from './shells/shared.ts';

const runReadline = String.raw`
import json, os, pty, select, signal, sys, time

settings = json.load(sys.stdin)
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
        if os.path.exists(settings['completion_capture']):
            os.unlink(settings['completion_capture'])
        transcript = send(case['line'] + '\t\n')
        with open(settings['capture'], 'rb') as captured:
            argv = captured.read().decode().split('\0')[:-1]
        with open(settings['completion_capture'], 'rb') as captured:
            completion_argv = captured.read().decode().split('\0')[:-1]
        results.append(dict(completion_argv=completion_argv, configure=case['configure'], line=case['line'], argv=argv, transcript=transcript))
    print(json.dumps(results))
finally:
    os.kill(pid, signal.SIGKILL)
    os.close(terminal)
    os.waitpid(pid, 0)
`;

const cases = [
	{ line: 'dcfixture --value-only wi', argv: ['--value-only', 'widget'] },
	{ line: 'dcfixture --value-only=wi', argv: ['--value-only=widget'] },
	{ line: 'dcfixture adopt --name=wi', argv: ['adopt', '--name=widget'] },
	{ line: 'dcfixture adopt --name=', argv: ['adopt', '--name=widget'] },
	{ line: 'dcfixture adopt --name wi', argv: ['adopt', '--name', 'widget'] },
	{ line: 'dcfixture adopt -nwi', argv: ['adopt', '-nwidget'] },
	{ line: 'dcfixture adopt --mode=fa', argv: ['adopt', '--mode=fast'] },
	{ line: 'dcfixture adopt --mode fa', argv: ['adopt', '--mode', 'fast'] },
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

const prerequisites = [
	...(process.platform === 'linux' && !('Deno' in globalThis) ? [] : ['Linux Node/Bun host']),
	...['bash', 'python3', 'bun'].filter((tool) => spawnSync(tool, ['--version']).status !== 0),
	...(existsSync('/usr/share/bash-completion/bash_completion') ? [] : ['bash-completion']),
];

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
									.complete(() => ['widget']),
							)
							.flag('mode', flag.enum(['fast', 'full']))
							.flag(
								'literal',
								flag.string().complete(() => literals),
							),
					);
				writeFileSync(script, generateBashCompletion(app.schema));
				writeFileSync(
					fixture,
					[
						`import { cli, command, flag } from ${JSON.stringify(source)};`,
						"await cli('dcfixture')",
						".default(command('default').flag('value-only', flag.string().complete(() => ['widget'])))",
						".command(command('adopt')",
						".flag('name', flag.string().alias('n').complete(() => ['widget']))",
						".flag('mode', flag.enum(['fast', 'full']))",
						`.flag('literal', flag.string().complete(() => ${JSON.stringify(literals)}))).run();`,
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
				const configurations = [
					'COMP_WORDBREAKS=$original_wordbreaks',
					// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
					'COMP_WORDBREAKS=${original_wordbreaks//=/}',
				];
				const result = spawnSync('python3', ['-c', runReadline], {
					input: JSON.stringify({
						capture,
						completion_capture: completionCapture,
						setup: `export PATH=${quoteShellArg(directory)}:"$PATH"; source /usr/share/bash-completion/bash_completion; source ${quoteShellArg(script)}; original_wordbreaks=$COMP_WORDBREAKS`,
						cases: configurations.flatMap((configure) =>
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
				expect(actual).toHaveLength(configurations.length * cases.length);
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
