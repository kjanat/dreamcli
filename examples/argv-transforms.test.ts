import { expect, it } from 'vitest';
import { notes } from './argv-transforms.ts';

it('keeps existing scripts working and warns only for legacy syntax', async () => {
	const input = { stdinData: 'Released\n' };
	const old = await notes.execute(['add', 'changelog', '--from-stdin'], input);
	const current = await notes.execute(['add', 'changelog', '--body', '-'], input);
	expect(old.exitCode).toBe(0);
	expect(current.exitCode).toBe(0);
	expect(old.stdout).toEqual(['changelog: Released\n']);
	expect(current.stdout).toEqual(old.stdout);
	expect(old.stderr).toEqual(['Use --body - in place of --from-stdin.\n']);
	expect(current.stderr).toEqual([]);
});

it('preserves a legacy-looking literal after the separator', async () => {
	const result = await notes.execute(['add', '--body', 'Literal title', '--', '--from-stdin']);
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toEqual(['--from-stdin: Literal title\n']);
	expect(result.stderr).toEqual([]);
});
