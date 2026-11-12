/**
 * Syntax colors for serialized JSON in terminal output.
 * @module dreamcli/core/output/json
 * @internal
 */

import type { Colors } from 'ansispeck';

function colorJson(text: string, colors: Colors): string {
	return text.replace(
		/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g,
		(token: string, offset: number) => {
			if (token.startsWith('"')) {
				return text
					.slice(offset + token.length)
					.trimStart()
					.startsWith(':')
					? colors.cyan(token)
					: colors.green(token);
			}
			return token === 'true' || token === 'false' || token === 'null'
				? colors.magenta(token)
				: colors.yellow(token);
		},
	);
}

export { colorJson };
