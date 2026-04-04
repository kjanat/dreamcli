# Plan: Mobile-optimize Twoslash hover tooltips

## Summary

The VitePress docs site uses `@shikijs/vitepress-twoslash` for IDE-like type hover on example pages. On mobile, the `"touch"` trigger (touchstart/touchend) causes popups to flicker and dismiss instantly, the popup CSS overflows small viewports (hard-coded `max-width: 600-700px`), and there's no visual affordance telling users tokens are tappable. Fix by: (1) switching mobile triggers to `"click"` for tap-to-toggle, (2) adding responsive CSS for popup sizing, (3) making the dotted underline always visible on touch devices, and (4) showing a one-time "tap for type info" toast on first visit.

## Root Cause Analysis

### Problem 1: Touch trigger is functionally broken

FloatingVue maps `"touch"` to `touchstart` (show) and `touchend` (hide). A mobile tap fires both in ~50-100ms, so the popup shows then immediately hides. Additionally, FloatingVue sets a 300ms `$_preventShow` lock after touch-hide, making re-triggering harder. Result: users see a brief flicker at best.

**Evidence**: `client.mjs:50` sets `triggers: ["touch"]` for mobile. FloatingVue's trigger map: `touch` -> `touchstart`/`touchend`.

### Problem 2: Popup CSS overflows mobile viewports

- `.twoslash-floating .twoslash-popup-code`: `max-width: 600px` (style-core.css:54)
- `.twoslash-floating .twoslash-popup-docs/error`: `max-width: 700px`, `max-height: 500px` (style-core.css:70-71)
- Common mobile widths: 320-428px. Both max-widths exceed every mobile device.

### Problem 3: No visual affordance on touch devices

The dotted underline on hoverable tokens is triggered by `.twoslash:hover .twoslash-hover` (style.css:220-221). The `:hover` pseudo-class on the parent `.twoslash` container never activates on touch devices, so users see no indication that tokens are interactive.

### Problem 4: `flip: false` prevents repositioning

`client.mjs:59` sets `flip: false`. On mobile with limited vertical space (especially with virtual keyboard), popups render below the trigger even when there's no room, pushing content off-screen.

## Changes

### 1. Create `docs/.vitepress/theme/twoslash-mobile.css`

New file with responsive overrides targeting touch devices.

```css
/* --- Twoslash mobile/touch optimizations --- */

@media (hover: none) {
	/*
	 * 1. Cap popup widths to viewport.
	 *    Upstream: max-width 600px (code) / 700px (docs) — overflows all phones.
	 *    24px = 12px overflow-padding on each side (matches FloatingVue config).
	 */
	.twoslash-floating .twoslash-popup-code {
		max-width: calc(100vw - 24px);
	}

	.twoslash-floating .twoslash-popup-docs,
	.twoslash-floating .twoslash-popup-error {
		max-width: calc(100vw - 24px);
		max-height: 40vh;
	}

	/*
	 * 2. Compact padding + font size for small screens.
	 *    Upstream code block: padding 6px 12px. Docs: padding 12px, font 0.9em.
	 */
	.twoslash-floating .twoslash-popup-code {
		padding: 4px 8px;
		font-size: 0.85em;
	}

	.twoslash-floating .twoslash-popup-docs,
	.twoslash-floating .twoslash-popup-error {
		padding: 8px !important;
		font-size: 0.8em;
	}

	/*
	 * 3. Always show dotted underline on touch devices.
	 *    Upstream: underline only visible via `.twoslash:hover .twoslash-hover`
	 *    which never fires on touch. Making it permanent tells users "tap me".
	 */
	.twoslash .twoslash-hover {
		border-color: var(--twoslash-underline-color);
	}
}

/* --- First-visit hint toast --- */

.twoslash-mobile-hint {
	position: fixed;
	bottom: 16px;
	left: 50%;
	transform: translateX(-50%);
	background: var(--vp-c-bg-soft);
	color: var(--vp-c-text-2);
	border: 1px solid var(--vp-c-border);
	padding: 8px 16px;
	border-radius: 8px;
	font-size: 0.85em;
	z-index: 100;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	pointer-events: none;
	animation: twoslash-hint-in 0.3s ease;
}

.twoslash-mobile-hint-out {
	animation: twoslash-hint-out 0.3s ease forwards;
}

@keyframes twoslash-hint-in {
	from {
		opacity: 0;
		transform: translateX(-50%) translateY(8px);
	}
	to {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}
}

@keyframes twoslash-hint-out {
	from {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}
	to {
		opacity: 0;
		transform: translateX(-50%) translateY(8px);
	}
}
```

**Why `@media (hover: none)` instead of `max-width: 767px`**: Width-based breakpoints would incorrectly target desktop users with narrow windows while missing large tablets without hover. `hover: none` targets exactly the devices that lack hover capability — the actual problem.

**Why not touch the upstream `style.css`/`style-core.css`**: Those are in `node_modules`. CSS cascade with matching specificity + later source order wins.

### 2. Modify `docs/.vitepress/theme/index.ts`

Add the CSS import and pass FloatingVue theme overrides with conditional mobile detection.

**From:**

```ts
/// <reference types="vite/client" />

import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client';
import type { EnhanceAppContext } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import '@shikijs/vitepress-twoslash/style.css';

export default {
	extends: DefaultTheme,
	enhanceApp({ app }: EnhanceAppContext) {
		if (typeof window !== 'undefined') {
			app.use(TwoslashFloatingVue);
		}
	},
};
```

**To:**

```ts
/// <reference types="vite/client" />

import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client';
import type { EnhanceAppContext } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { onMounted } from 'vue';
import '@shikijs/vitepress-twoslash/style.css';
import './twoslash-mobile.css';

const HINT_KEY = 'twoslash-hint-seen';

function showTwoslashHint(): void {
	if (window.matchMedia('(hover: hover)').matches) return;
	if (localStorage.getItem(HINT_KEY)) return;
	if (!document.querySelector('.twoslash')) return;

	const hint = document.createElement('div');
	hint.className = 'twoslash-mobile-hint';
	hint.textContent = 'Tap underlined code for type info';
	document.body.appendChild(hint);

	const dismiss = () => {
		if (!hint.parentNode) return;
		hint.classList.add('twoslash-mobile-hint-out');
		hint.addEventListener('animationend', () => hint.remove());
		localStorage.setItem(HINT_KEY, '1');
	};

	document.addEventListener(
		'click',
		(e) => {
			if ((e.target as Element).closest?.('.twoslash-hover')) dismiss();
		},
		{ once: true },
	);

	setTimeout(dismiss, 5000);
}

export default {
	extends: DefaultTheme,
	enhanceApp({ app }: EnhanceAppContext) {
		if (typeof window !== 'undefined') {
			const hasHover = window.matchMedia('(hover: hover)').matches;

			app.use(TwoslashFloatingVue, {
				themes: {
					twoslash: {
						triggers: hasHover ? ['hover', 'touch'] : ['click'],
						popperTriggers: hasHover ? ['hover', 'touch'] : ['click'],
						flip: true,
						overflowPadding: 12,
					},
				},
			});
		}
	},
	setup() {
		onMounted(() => {
			if (typeof window !== 'undefined') showTwoslashHint();
		});
	},
};
```

**Why each override:**

| Override              | Value                                 | Reason                                                                                                       |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `triggers`            | `['click']` on touch devices          | `click` gives tap-to-toggle; browser synthesizes `click` from tap. Fixes the touchstart/touchend flicker.    |
| `triggers`            | `['hover', 'touch']` on hover devices | Preserves desktop hover behavior (no UX regression).                                                         |
| `popperTriggers`      | mirrors `triggers`                    | Must match — controls whether popper content itself keeps the popup open on hover/interaction.               |
| `flip: true`          | both                                  | Allows popup to reposition above trigger when no room below. Critical on mobile with limited vertical space. |
| `overflowPadding: 12` | both                                  | Coordinates with CSS `calc(100vw - 24px)` — 12px per side. Slightly increased from default 10.               |

**Why `matchMedia('(hover: hover)')` instead of user-agent regex**: The upstream plugin uses UA sniffing (`/Android|webOS|iPhone|iPad.../i`). `matchMedia` is the standards-based approach — it queries the device's actual hover capability rather than guessing from the UA string. It correctly handles iPads in desktop mode, convertible laptops, and future devices.

**How the first-visit hint works:**

1. `setup()` runs in VitePress's layout component — `onMounted` fires after the page DOM is ready.
2. Three guards: skip if device has hover, skip if `localStorage` key `twoslash-hint-seen` exists, skip if no `.twoslash` block on current page.
3. Injects a fixed-position toast: "Tap underlined code for type info".
4. Auto-dismisses after 5 seconds with a fade-out animation, OR immediately when the user taps a `.twoslash-hover` token (whichever comes first).
5. Sets `localStorage` key so it never shows again.
6. `pointer-events: none` on the toast prevents it from intercepting taps on content beneath it.

**What we intentionally leave unchanged:**

- `shift` / `shiftCrossAxis`: Not needed. `autoBoundaryMaxSize: true` (upstream default) already constrains the popper to the viewport boundary. Adding shift would be redundant.
- `handleResize`: Stays `false` (upstream default). Avoids unnecessary reflows. The initial positioning is correct thanks to flip + overflow padding.
- `autoHide: true`: Upstream default. Tapping outside the popup dismisses it — correct for mobile click-trigger model.
- `instantMove: true`: Upstream default. On desktop, moving hover between adjacent tokens instantly repositions the popup without fade.

## Testing

1. `bun run docs:dev` — start local dev server
2. **Mobile test** (Chrome DevTools device toolbar or real device):
   - Navigate to any example page (e.g., `/examples/basic`)
   - Verify dotted underlines are always visible on code tokens
   - **First visit**: toast "Tap underlined code for type info" appears at bottom of viewport
   - Toast auto-dismisses after ~5 seconds with fade-out animation
   - Reload page — toast should NOT reappear (localStorage key set)
   - Clear localStorage, reload — toast reappears (confirming persistence logic)
   - Tap a token — popup should appear and stay visible; toast dismisses if still showing
   - Tap outside — popup should dismiss
   - Verify popup doesn't overflow horizontally (check on 320px and 375px widths)
   - Verify popup max-height is reasonable (~40% of viewport)
   - Scroll the page while popup is open — should not break positioning
3. **Desktop test** (no device emulation):
   - Hover over a token — popup appears on hover (no regression)
   - Move hover away — popup dismisses
   - Underlines should appear when hovering the code block (existing behavior preserved)
   - Toast should NOT appear (device has hover capability)
4. `bun run format` — ensure CSS + TS pass dprint/biome formatting

## Risks

1. **`matchMedia` SSR safety**: The `typeof window !== 'undefined'` guard already protects both `enhanceApp` and `setup` code paths. No SSR risk.
2. **Convertible laptop edge case**: A Surface Pro with keyboard attached reports `(hover: hover)`. Detaching the keyboard changes the media query result, but only if the page is reloaded. Users who detach mid-session keep hover triggers — acceptable since they can still tap (the `touch` trigger is included in the hover-capable config).
3. **CSS specificity**: Our overrides use the same selectors as upstream (`style-core.css`). They win because they're imported after `style.css` in the cascade. If the upstream package changes selectors, our overrides may stop applying — low risk since we match exact upstream selectors.
4. **`flip: true` on desktop**: Previously disabled. Enabling it means popups at the top of a code block may appear above the token instead of below. This is standard tooltip behavior and arguably better UX. Unlikely to cause issues.
5. **Hint on non-example pages**: `showTwoslashHint` checks for `.twoslash` in the DOM. On pages without twoslash code blocks (guide pages, reference), the hint won't show. However, `onMounted` only fires once (VitePress SPA routing doesn't re-mount the layout). If the user first lands on a non-twoslash page, then navigates to an example page, the hint won't show. This is acceptable — the always-visible underlines still provide affordance, and the hint is a nice-to-have, not critical.
