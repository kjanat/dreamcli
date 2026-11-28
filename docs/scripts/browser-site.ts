/** Serve a built VitePress site to an isolated Chromium context without an HTTP server. @module */
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';

export async function launchChromium() {
	const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	return chromium.launch(executablePath ? { executablePath } : {});
}

export async function openBuiltSite(browser: Browser, dist: string) {
	const root = resolve(dist);
	const home = await readFile(resolve(root, 'index.html'), 'utf8');
	const base = home.match(/href="([^"]*\/)assets\/style\.[^"]+\.css"/)?.[1];
	if (!base?.startsWith('/')) throw new Error(`Missing VitePress asset base in ${root}`);
	const origin = 'http://docs.test';
	const context = await browser.newContext({ baseURL: origin + base, serviceWorkers: 'block' });
	await context.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== origin || !url.pathname.startsWith(base)) return route.abort();
		const rel = decodeURIComponent(url.pathname.slice(base.length));
		const file = resolve(root, rel || 'index.html');
		if (!file.startsWith(root + sep)) return route.abort();
		for (const name of [file, `${file}.html`, resolve(file, 'index.html')]) {
			if ((await stat(name).catch(() => undefined))?.isFile()) return route.fulfill({ path: name });
		}
		return route.fulfill({ status: 404, body: 'Missing docs asset' });
	});
	return { context, base };
}
