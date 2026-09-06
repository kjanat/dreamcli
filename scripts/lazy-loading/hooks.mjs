import { appendFileSync } from 'node:fs';

const traceFile = process.env.DREAMCLI_TRACE;
const distUrl = process.env.DREAMCLI_DIST;

export async function resolve(specifier, context, nextResolve) {
	const result = await nextResolve(specifier, context);
	if (traceFile !== undefined && distUrl !== undefined && result.url.startsWith(distUrl)) {
		appendFileSync(traceFile, `${result.url}\n`);
	}
	return result;
}
