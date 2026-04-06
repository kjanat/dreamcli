import type { Plugin } from 'vitepress';

/**
 * Post-processes rendered chunks to deduplicate inline Shiki style
 * objects (`{"--shiki-light":"...","--shiki-dark":"..."}`) that twoslash
 * popups emit outside the normal transformer pipeline. Replaces repeated
 * style objects with references to shared variables.
 */
function shikiDedupePopupStylesPlugin(): Plugin {
	return {
		name: 'shiki-dedupe-popup-styles',
		enforce: 'post',
		generateBundle(_options, bundle) {
			for (const chunk of Object.values(bundle)) {
				if (chunk.type !== 'chunk') continue;
				// Only process page chunks with twoslash popups
				if (!chunk.code.includes('twoslash-popup-code')) continue;

				const styleMap = new Map<string, string>();
				let counter = 0;

				// Match style objects like {"--shiki-light":"#D73A49","--shiki-dark":"#F97583"}
				// These appear as `style:` values in Vue render functions
				const stylePattern = /\{[^{}]*"--shiki-light":"[^"]*"[^{}]*"--shiki-dark":"[^"]*"[^{}]*\}/g;

				// First pass: collect all unique styles and count occurrences
				const occurrences = new Map<string, number>();
				for (const match of chunk.code.matchAll(stylePattern)) {
					occurrences.set(match[0], (occurrences.get(match[0]) ?? 0) + 1);
				}

				// Only deduplicate styles that appear 3+ times
				for (const [style, count] of occurrences) {
					if (count >= 3) {
						styleMap.set(style, `__s${counter++}`);
					}
				}

				if (styleMap.size === 0) continue;

				// Build variable declarations
				const declarations = [...styleMap.entries()]
					.map(([style, varName]) => `const ${varName}=${style};`)
					.join('');

				// Replace all occurrences with variable references
				let code = chunk.code;
				for (const [style, varName] of styleMap) {
					code = code.replaceAll(style, varName);
				}

				// Inject declarations after the first line (usually the module header)
				const firstNewline = code.indexOf('\n');
				chunk.code = code.slice(0, firstNewline + 1) + declarations + code.slice(firstNewline + 1);
			}
		},
	};
}

export { shikiDedupePopupStylesPlugin };
