/** Shared name, version, and links for help headers. @internal @module */

import { osc8 } from './ansi.ts';
import type { HelpTheme } from './theme.ts';

interface ProgramHelpHeader {
	readonly name: string;
	readonly version: string | undefined;
	readonly helpLinks?:
		| {
				readonly name: string | undefined;
				readonly version: string | undefined;
		  }
		| undefined;
}

function formatProgramHeader(
	header: ProgramHelpHeader,
	hyperlinks: boolean,
	theme: HelpTheme,
): string {
	const links = hyperlinks ? header.helpLinks : undefined;
	const styledName = theme.headerName(header.name);
	const name = links?.name !== undefined ? osc8(links.name, styledName) : styledName;
	if (header.version === undefined) return name;
	const version = theme.headerVersion(`v${header.version}`);
	return `${name} ${links?.version !== undefined ? osc8(links.version, version) : version}`;
}

export type { ProgramHelpHeader };
export { formatProgramHeader };
