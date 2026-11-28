/** Exercise the production search dialog under both deployment paths. @module */
import assert from 'node:assert/strict';
import { launchChromium, openBuiltSite } from './browser-site.ts';

const builds = process.argv.slice(2);
assert.ok(builds.length, 'Usage: bun docs/scripts/check-search-recovery.ts <dist> [other-dist]');
const browser = await launchChromium();
try {
	const paths = new Set<string>();
	for (const dist of builds) {
		for (const failure of ['none', 'http', 'corrupt', 'offline'] as const) {
			const { context, base } = await openBuiltSite(browser, dist);
			paths.add(base);
			try {
				const page = await context.newPage();
				let attempts = 0;
				let fallbacks = 0;
				const offlineFailure =
					failure === 'offline'
						? page.waitForEvent('requestfailed', {
								predicate: (r) => r.url().includes('local-search.') && r.url().endsWith('.json'),
							})
						: undefined;
				await page.route('**/local-search.*.bin', (route) => {
					if (++attempts > 1 || failure === 'none') return route.fallback();
					return failure === 'corrupt'
						? route.fulfill({ body: 'invalid gzip' })
						: route.fulfill({ status: 503, body: 'unavailable' });
				});
				await page.route('**/local-search.*.json', (route) => {
					fallbacks++;
					return failure === 'offline' ? route.abort() : route.fallback();
				});
				await page.goto('guide/arguments');
				const open = page.getByRole('button', { name: 'Search' });
				await open.click();
				const input = page.locator('#localsearch-input');
				await input.fill('allowHyphenValues');
				if (failure === 'offline') {
					await offlineFailure;
					await input.press('Escape');
					await open.click();
					await input.fill('allowHyphenValues');
				}
				const result = page.locator('a.result').filter({ hasText: /Flags/ }).first();
				await result.click({ timeout: 8000 });
				await page.locator('main h1').filter({ hasText: /Flags/ }).waitFor();
				assert.equal(new URL(page.url()).pathname, `${base}guide/flags`);
				assert.equal(new URL(page.url()).hash, '#values-starting-with-a-dash');
				assert.equal(fallbacks, failure === 'none' ? 0 : 1);
				assert.equal(attempts, failure === 'offline' ? 2 : 1);
				console.log(`${base} ${failure}: recovered and navigated to ${new URL(page.url()).hash}`);
			} finally {
				await context.close();
			}
		}
	}
	assert.equal(paths.size, builds.length, 'Expected each build to use a distinct deployment path');
} finally {
	await browser.close();
}
