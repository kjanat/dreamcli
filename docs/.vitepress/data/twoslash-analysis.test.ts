/** @module */
import { createTwoslasher } from 'twoslash';
import { expect, it } from 'vitest';
import { createBuildAnalyzer } from '../vite-plugins/twoslash-analysis.ts';
import { rootDirPath } from './paths.ts';

it('analyzes arbitrary build inputs, reuses their results, and preserves diagnostic checks', () => {
	const analyzer = createBuildAnalyzer(rootDirPath);
	const { read, write } = analyzer.typesCache;
	const code = 'const answer = 42 as const;\n//    ^?';
	expect(read(code)).toBeNull();
	analyzer.plugin.configResolved();
	try {
		const result = read(code);
		expect(result?.nodes.find((node) => node.type === 'query')).toMatchObject({
			target: 'answer',
			text: expect.stringContaining('42'),
		});
		expect(read(code)).toBe(result);

		const invalid = 'const n: number = "invalid";';
		const stock = createTwoslasher({ vfsRoot: rootDirPath });
		expect(read(invalid)).toBeNull();
		expect(() => stock(invalid, 'ts')).toThrow(/2322/);

		const expectedError = `// @errors: 2322\n${invalid}`;
		expect(read(expectedError)).toBeNull();
		const checked = stock(expectedError, 'ts');
		expect(checked.nodes.some((node) => node.type === 'error' && node.code === 2322)).toBe(true);
		write(expectedError, checked);
		expect(read(expectedError)).toBe(checked);
	} finally {
		analyzer.finish();
	}
	expect(read(code)).toBeNull();
});

it('keeps overload hints, declaration docs, JSON import aliases, and optional-chain types', () => {
	const analyzer = createBuildAnalyzer(rootDirPath);
	analyzer.plugin.configResolved();
	try {
		const code = [
			"import { cli } from '@kjanat/dreamcli';",
			"import definition from '@kjanat/dreamcli/schema';",
			"import { createInterface } from 'node:readline';",
			"import { fileURLToPath } from 'node:url';",
			"cli('test').manifest({ inferName: true });",
			'const dates: Date[] = [];',
			"console.log(definition, dates[0]?.getTime(), new Date(), Promise.resolve(), Bun.TOML.parse(''));",
			'const items: { spelling: string }[] = []; console.log(items[0]?.spelling);',
			"new Error('message'); createInterface({ input: process.stdin }); fileURLToPath('file:///tmp');",
			'new Promise<void>((resolve) => setTimeout(resolve, 1));',
		].join('\n');
		const hovers = analyzer.typesCache.read(code)?.nodes.filter((node) => node.type === 'hover');
		const named = (target: string) => hovers?.filter((hover) => hover.target === target);
		expect(named('manifest')?.[0]?.text).toContain('(+1 overload)');
		expect(named('resolve')?.[0]?.text).toContain('(+2 overloads)');
		expect(named('Error')?.[0]?.text).toContain('(+1 overload)');
		expect(named('createInterface')?.at(-1)?.text).toContain('(+1 overload)');
		expect(named('fileURLToPath')?.at(-1)?.text).toMatch(
			/options\?: FileUrlToPathOptions\): string$/,
		);
		expect(named('Promise')?.[0]?.docs).toContain('Represents the completion');
		expect(named('Date')?.at(-1)?.docs).toContain('Enables basic storage');
		expect(named('Bun')?.[0]?.docs).toContain('Bun runtime APIs');
		expect(named('setTimeout')?.[0]?.tags).toContainEqual(['param', 'handler function to call']);
		expect(named('definition')?.map((hover) => hover.text)).toEqual([
			'import definition',
			'import definition',
		]);
		expect(named('spelling')?.at(-1)?.text).toContain('string | undefined');
	} finally {
		analyzer.finish();
	}
});
