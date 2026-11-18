/** Interpret inline JSDoc links without tying them to a collector. @module */

interface DocLink {
	readonly target: string;
	readonly label: string;
	readonly code: boolean;
}

export function replaceDocLinks(text: string, render: (link: DocLink) => string): string {
	return text.replace(
		/\{@(linkcode|linkplain|link)\s+([^\s}|]+)(?:\s*(?:\|\s*)?([^}]+))?\}/gu,
		(_match, kind: string, target: string, label?: string) =>
			render({
				target,
				label: label?.trim() || target,
				code: kind === 'linkcode',
			}),
	);
}
