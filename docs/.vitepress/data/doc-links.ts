/** Interpret inline JSDoc links without tying them to a collector. @module */

interface DocLink {
	readonly target: string;
	readonly label: string;
	readonly code: boolean;
}

export function replaceDocLinks(text: string, render: (link: DocLink) => string): string {
	return text.replace(
		/\{@(linkcode|linkplain|link)\s+([^\s}|]+)(?:\s*(?:\|\s*)?((?:\\[\s\S]|[^\\}])*))?\}/gu,
		(_match, kind: string, target: string, label?: string) =>
			render({
				target,
				label: label?.trim().replace(/\\([{}\\])/gu, '$1') || target,
				code: kind === 'linkcode',
			}),
	);
}

export function replaceProseLinks(text: string, render: (link: DocLink) => string): string {
	const chunks: string[] = [];
	let fence = '';
	let prose: string[] = [];
	for (const line of text.split('\n')) {
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
		const run = marker?.[1] ?? '';
		if (fence !== '') {
			chunks.push(line);
			if (run.startsWith(fence) && marker?.[2]?.trim() === '') fence = '';
		} else if (run !== '') {
			if (prose.length > 0) chunks.push(replaceDocLinks(prose.join('\n'), render));
			prose = [];
			fence = run;
			chunks.push(line);
		} else {
			prose.push(line);
		}
	}
	if (prose.length > 0) chunks.push(replaceDocLinks(prose.join('\n'), render));
	return chunks.join('\n');
}
