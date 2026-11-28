/** Exercise shell completions through a real terminal under Node and Bun test runners. @module */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

interface TerminalCases {
	shell: 'bash' | 'zsh';
	setup: string;
	capture: string;
	completionCapture?: string;
	cases: { line: string; configure?: string; back?: number }[];
}

interface Submission {
	line: string;
	argv: string[];
	completionArgv?: string[];
	transcript: string;
}

export function runTerminalCases(settings: TerminalCases): Submission[] {
	// Vitest also runs in Node. Use the same Bun PTY driver for both runtimes.
	const result = spawnSync('bun', [fileURLToPath(import.meta.url)], {
		input: JSON.stringify(settings),
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(result.stderr || `PTY driver exited with ${result.signal}`);
	return JSON.parse(result.stdout);
}

function readArgv(path: string) {
	return readFileSync(path, 'utf8').split('\0').slice(0, -1);
}

async function drive({ shell, setup, capture, completionCapture, cases }: TerminalCases) {
	const prompt = 'COMPLETION_TEST> ';
	const bash = shell === 'bash';
	const decoder = new TextDecoder();
	let transcript = '';
	let onData: (() => void) | undefined;
	const child = Bun.spawn(bash ? ['bash', '--noprofile', '--norc', '-i'] : ['zsh', '-f', '-i'], {
		env: {
			...process.env,
			PS1: prompt,
			PROMPT: prompt,
			RPROMPT: '',
			HISTFILE: '/dev/null',
			INPUTRC: '/dev/null',
			TERM: bash ? 'dumb' : 'xterm',
		},
		terminal: {
			cols: 200,
			rows: 24,
			data(_terminal, bytes) {
				transcript += decoder.decode(bytes, { stream: true });
				onData?.();
			},
		},
	});
	const terminal = child.terminal;
	if (!terminal) throw new Error('Bun did not allocate a terminal');
	let exited = false;
	void child.exited.then(() => {
		exited = true;
		onData?.();
	});
	const waitForPrompt = (label: string, input?: string) => {
		if (input !== undefined) {
			transcript = '';
			terminal.write(input);
		}
		return new Promise<string>((resolve, reject) => {
			const fail = (reason: string) =>
				reject(new Error(`${shell} ${reason} during ${label}: ${JSON.stringify(transcript)}`));
			const timer = setTimeout(() => fail('timed out'), 10_000);
			onData = () => {
				if (!exited && !stripVTControlCharacters(transcript).endsWith(prompt)) return;
				clearTimeout(timer);
				onData = undefined;
				if (exited) fail('exited');
				else resolve(transcript);
			};
			onData();
		});
	};
	try {
		await waitForPrompt('startup');
		await waitForPrompt('setup', `${setup}\n`);
		const results: Submission[] = [];
		let previousConfig: string | undefined;
		for (const { configure, line, back = 0 } of cases) {
			if (configure !== undefined && configure !== previousConfig) {
				await waitForPrompt(`configuring ${line}`, `${configure}\n`);
				previousConfig = configure;
			}
			rmSync(capture, { force: true });
			if (completionCapture) rmSync(completionCapture, { force: true });
			const keys = bash ? '\t\n' : `${'\x02'.repeat(back)}\t\x05\n`;
			const output = await waitForPrompt(line, line + keys);
			try {
				results.push({
					line,
					transcript: output,
					argv: readArgv(capture),
					...(completionCapture && { completionArgv: readArgv(completionCapture) }),
				});
			} catch (cause) {
				throw new Error(`Missing captured arguments for ${line}: ${output}`, { cause });
			}
		}
		return results;
	} finally {
		onData = undefined;
		child.kill('SIGKILL');
		terminal.close();
		await child.exited;
	}
}

if (import.meta.main) console.log(JSON.stringify(await drive(await Bun.stdin.json())));
