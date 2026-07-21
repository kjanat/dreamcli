/**
 * Static-asset worker with markdown content negotiation.
 *
 * Browsers get the rendered HTML. Agents sending `Accept: text/markdown` get
 * the markdown source the page was built from, when one exists.
 */

interface Env {
	readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/** Whether the client prefers markdown over HTML. */
function prefersMarkdown(accept: string | null): boolean {
	if (accept === null) return false;
	const markdown = accept.includes('text/markdown');
	if (!markdown) return false;
	// `Accept: */*` clients (curl, most browsers' subresource loads) never reach
	// here; an explicit markdown mention wins unless HTML is listed ahead of it.
	const htmlIndex = accept.indexOf('text/html');
	const markdownIndex = accept.indexOf('text/markdown');
	return htmlIndex === -1 || markdownIndex < htmlIndex;
}

/** Map a page route to the markdown asset emitted beside it. */
function markdownPath(pathname: string): string {
	if (pathname.endsWith('.md')) return pathname;
	const trimmed = pathname.replace(/\/+$/, '');
	// The root answers with the llms.txt index rather than the landing page's
	// marketing copy, which is what an agent asking for markdown wants first.
	if (trimmed === '') return '/llms.txt';
	if (trimmed.endsWith('.html')) return `${trimmed.slice(0, -'.html'.length)}.md`;
	// Anything already carrying an extension (llms.txt, sitemap.xml, assets) is
	// served as-is rather than probing for a markdown twin that cannot exist.
	if (/\.[a-z0-9]+$/i.test(trimmed)) return trimmed;
	return `${trimmed}.md`;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'GET' && prefersMarkdown(request.headers.get('accept'))) {
			const candidate = new Request(new URL(markdownPath(url.pathname), url).toString(), request);
			const markdown = await env.ASSETS.fetch(candidate);
			if (markdown.ok) {
				const headers = new Headers(markdown.headers);
				headers.set('content-type', 'text/markdown; charset=utf-8');
				headers.set('vary', 'Accept');
				return new Response(markdown.body, { status: markdown.status, headers });
			}
		}

		const response = await env.ASSETS.fetch(request);
		const headers = new Headers(response.headers);
		headers.append('vary', 'Accept');
		return new Response(response.body, { status: response.status, headers });
	},
};
