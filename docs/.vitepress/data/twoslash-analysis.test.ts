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
