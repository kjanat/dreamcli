/** Zsh must forward decoded arguments before the cursor and insert whole values. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { quoteShellArg } from './shells/shared.ts';
import { generateZshCompletion } from './shells/zsh.ts';

const runZsh = String.raw`
import json, os, pty, re, select, signal, sys, time

settings = json.load(sys.stdin)
prompt = b'ZSH_COMPLETION_TEST> '
pid, terminal = pty.fork()
if pid == 0:
    env = dict(os.environ, PS1=prompt.decode(), PROMPT=prompt.decode(), RPROMPT='', HISTFILE='/dev/null', TERM='xterm')
    os.execvpe('zsh', ['zsh', '-f', '-i'], env)

def read_prompt():
    data = b''
    deadline = time.monotonic() + 10
    while not re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', data).endswith(prompt):
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([terminal], [], [], remaining)[0]:
            raise RuntimeError('Timed out waiting for Zsh: ' + repr(data))
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
        for path in [settings['capture'], settings['completion_capture']]:
            if os.path.exists(path):
                os.unlink(path)
        transcript = send(case['line'] + '\x02' * case.get('back', 0) + '\t\x05\n')
        result = dict(transcript=transcript)
        for key, path in [('argv', settings['capture']), ('completion_argv', settings['completion_capture'])]:
            with open(path, 'rb') as captured:
                result[key] = captured.read().decode().split('\0')[:-1]
        results.append(result)
    print(json.dumps(results))
finally:
    os.kill(pid, signal.SIGKILL)
    os.close(terminal)
    os.waitpid(pid, 0)
`;

const cases = [
	{
		line: 'dczfixture adopt --name wiget',
		back: 3,
		prefix: 'wi',
		argv: ['adopt', '--name', 'widget'],
	},
	{
		line: 'dczfixture adopt --name=wiget',
		back: 3,
		prefix: '--name=wi',
		argv: ['adopt', '--name=widget'],
	},
	{
		line: 'dczfixture adopt --name="wi"',
		back: 1,
		prefix: '--name=wi',
		argv: ['adopt', '--name=widget'],
	},
	{ line: 'dczfixture adopt --name "wi', prefix: 'wi', argv: ['adopt', '--name', 'widget'] },
	{ line: "dczfixture adopt --name 'wi", prefix: 'wi', argv: ['adopt', '--name', 'widget'] },
	{ line: 'dczfixture adopt --name="wi', prefix: '--name=wi', argv: ['adopt', '--name=widget'] },
	{ line: "dczfixture adopt --name='wi", prefix: '--name=wi', argv: ['adopt', '--name=widget'] },
	{
		line: 'dczfixture adopt --profile "a b" --name wi',
		prefix: 'wi',
		argv: ['adopt', '--profile', 'a b', '--name', 'widget'],
	},
	{
		line: "dczfixture adopt --profile 'a b' --name wi",
		prefix: 'wi',
		argv: ['adopt', '--profile', 'a b', '--name', 'widget'],
	},
	{
		line: 'dczfixture adopt --profile a\\ b --name wi',
		prefix: 'wi',
		argv: ['adopt', '--profile', 'a b', '--name', 'widget'],
	},
	{ line: 'dczfixture adopt --name sp\\ v', prefix: 'sp v', argv: ['adopt', '--name', 'sp value'] },
	{
		line: "dczfixture adopt --name 'back\\s",
		prefix: 'back\\s',
		argv: ['adopt', '--name', 'back\\slash'],
	},
	{
		line: 'dczfixture adopt --name "back\\s',
		prefix: 'back\\s',
		argv: ['adopt', '--name', 'back\\slash'],
	},
	{
		line: "dczfixture adopt --name='back\\s",
		prefix: '--name=back\\s',
		argv: ['adopt', '--name=back\\slash'],
	},
	{
		line: "dczfixture adopt --profile '$(false)' --name wi",
		prefix: 'wi',
		argv: ['adopt', '--profile', '$(false)', '--name', 'widget'],
	},
	{
		line: 'dczfixture adopt --profile "" --name wi',
		prefix: 'wi',
		argv: ['adopt', '--profile', '', '--name', 'widget'],
	},
];

const prerequisites = [
	...(process.platform === 'linux' && !('Deno' in globalThis) ? [] : ['Linux Node/Bun host']),
	...['zsh', 'python3', 'bun'].filter((tool) => spawnSync(tool, ['--version']).status !== 0),
];
if (prerequisites.length > 0)
	console.warn(`Skipping Zsh ZLE test: requires ${prerequisites.join(', ')}`);

describe.skipIf(prerequisites.length > 0)('Zsh interactive completion', () => {
	it('decodes shell words and completes at the cursor with COMPLETE_IN_WORD', () => {
		const directory = mkdtempSync(join(tmpdir(), 'dreamcli-zsh-'));
		try {
			const source = new URL('../../index.ts', import.meta.url).href;
			const fixture = join(directory, 'fixture.ts');
			const capture = join(directory, 'argv');
			const completionCapture = join(directory, 'completion-argv');
			const script = join(directory, 'completion.zsh');
			const values = ['widget', 'sp value', 'back\\slash'];
			const app = cli('dczfixture').command(
				command('adopt')
					.flag('profile', flag.string())
					.flag(
						'name',
						flag.string().complete(() => values),
					),
			);
			writeFileSync(script, generateZshCompletion(app.schema));
			writeFileSync(
				fixture,
				[
					`import { cli, command, flag } from ${JSON.stringify(source)};`,
					"await cli('dczfixture').command(command('adopt').flag('profile', flag.string())",
					`.flag('name', flag.string().complete(() => ${JSON.stringify(values)}))).run();`,
				].join('\n'),
			);
			writeFileSync(
				join(directory, 'dczfixture'),
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
			const result = spawnSync('python3', ['-c', runZsh], {
				input: JSON.stringify({
					setup: `export PATH=${quoteShellArg(directory)}:$PATH; autoload -Uz compinit; compinit -D; setopt COMPLETE_IN_WORD; bindkey -e; bindkey '^I' complete-word; source ${quoteShellArg(script)}`,
					capture,
					completion_capture: completionCapture,
					cases,
				}),
				encoding: 'utf8',
				timeout: 25_000,
			});
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(0);
			const actual: { argv: string[]; completion_argv: string[]; transcript: string }[] =
				JSON.parse(result.stdout);
			expect(actual).toHaveLength(cases.length);
			for (const [index, value] of actual.entries()) {
				const testCase = cases[index];
				expect(value.argv, value.transcript).toEqual(testCase?.argv);
				expect(value.completion_argv, value.transcript).toEqual([
					'--',
					...value.argv.slice(0, -1),
					testCase?.prefix,
				]);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);
});
