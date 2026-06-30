/// <reference types="vite/client" />

import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client';
import { options as floatingOptions } from 'floating-vue';
import type { EnhanceAppContext } from 'vitepress';
import { onContentUpdated } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { h, onMounted, onUnmounted, watch } from 'vue';
import '@shikijs/vitepress-twoslash/style.css';
import 'virtual:shiki-class.css';
import './twoslash-mobile.css';
import './settings.css';
import './custom.css';
import SettingsGear from './components/SettingsGear.vue';
import type { Runtime } from './composables/use-doc-settings.ts';
import { useDocSettings } from './composables/use-doc-settings.ts';

const HINT_KEY = 'twoslash-hint-seen';
const MOBILE_UA_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

function isTouchDevice(): boolean {
	return !window.matchMedia('(hover: hover)').matches;
}

function isMobileUserAgent(): boolean {
	return MOBILE_UA_RE.test(navigator.userAgent);
}

function twoslashFloatingOptions() {
	const mobile = isTouchDevice() || isMobileUserAgent();
	return {
		themes: {
			twoslash: {
				// Mobile: tap to open, tap-away to close
				...(mobile && { triggers: ['click'], popperTriggers: [], autoHide: true }),
				// Desktop: close previous popup instantly when sliding to another target
				...(!mobile && { instantMove: true, disposeTimeout: 0, autoHide: true }),
			},
		},
	};
}

// === First-visit hint toast ===

function showTwoslashHint(): void {
	if (!isTouchDevice()) return;
	if (localStorage.getItem(HINT_KEY)) return;
	if (document.querySelector('.twoslash-mobile-hint')) return;
	if (!document.querySelector('.twoslash')) return;

	localStorage.setItem(HINT_KEY, '1');

	const hint = document.createElement('div');
	hint.className = 'twoslash-mobile-hint';
	hint.textContent = 'Tap underlined code for type info';
	document.body.appendChild(hint);

	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const onClick = (e: Event) => {
		if ((e.target as Element).closest?.('.twoslash-hover')) dismiss();
	};

	const dismiss = () => {
		if (!hint.parentNode) return;
		document.removeEventListener('click', onClick);
		if (timeoutId !== undefined) clearTimeout(timeoutId);
		hint.classList.add('twoslash-mobile-hint-out');
		hint.addEventListener('animationend', () => hint.remove(), { once: true });
	};

	document.addEventListener('click', onClick);
	timeoutId = setTimeout(dismiss, 5000);
}

// === Bottom sheet behavior for mobile popups ===

function setupMobileBottomSheet(): (() => void) | undefined {
	if (!isTouchDevice()) return undefined;

	let activeBackdrop: HTMLElement | null = null;

	function enhancePopup(popperInner: HTMLElement): void {
		if (popperInner.querySelector('.twoslash-drag-handle')) return;

		// Add drag handle
		const handle = document.createElement('div');
		handle.className = 'twoslash-drag-handle';
		popperInner.prepend(handle);

		// Add close button
		const closeBtn = document.createElement('button');
		closeBtn.className = 'twoslash-close-btn';
		closeBtn.textContent = '\u00d7';
		closeBtn.setAttribute('aria-label', 'Close');
		popperInner.style.position = 'relative';
		popperInner.appendChild(closeBtn);

		// Add backdrop (remove any orphaned previous one first)
		activeBackdrop?.remove();
		activeBackdrop = document.createElement('div');
		activeBackdrop.className = 'twoslash-backdrop';
		document.body.appendChild(activeBackdrop);

		// Close on backdrop tap or close button
		const closePopup = () => {
			const popper = popperInner.closest('.v-popper--theme-twoslash');
			if (popper) (popper as HTMLElement).style.display = 'none';
			activeBackdrop?.remove();
			activeBackdrop = null;
		};

		closeBtn.addEventListener('click', closePopup);
		activeBackdrop.addEventListener('click', closePopup);

		// Drag-to-resize
		let startY = 0;
		let startHeight = 0;

		handle.addEventListener(
			'touchstart',
			(e: TouchEvent) => {
				const touch = e.touches[0];
				if (touch === undefined) return;
				startY = touch.clientY;
				startHeight = popperInner.offsetHeight;
				e.preventDefault();
			},
			{ passive: false },
		);

		handle.addEventListener(
			'touchmove',
			(e: TouchEvent) => {
				const touch = e.touches[0];
				if (touch === undefined) return;
				const dy = startY - touch.clientY;
				const newHeight = Math.max(100, Math.min(startHeight + dy, window.innerHeight * 0.9));
				popperInner.style.maxHeight = `${newHeight}px`;
				e.preventDefault();
			},
			{ passive: false },
		);
	}

	function cleanupPopup(): void {
		activeBackdrop?.remove();
		activeBackdrop = null;
	}

	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (!(node instanceof HTMLElement)) continue;
				const inner = node.classList?.contains('v-popper__inner')
					? node
					: node.querySelector?.('.v-popper__inner');
				if (inner instanceof HTMLElement) enhancePopup(inner);
			}
			for (const node of mutation.removedNodes) {
				if (!(node instanceof HTMLElement)) continue;
				if (
					node.classList?.contains('v-popper--theme-twoslash') ||
					node.querySelector?.('.v-popper--theme-twoslash')
				) {
					cleanupPopup();
				}
			}
		}
	});

	observer.observe(document.body, { childList: true, subtree: true });

	return () => {
		observer.disconnect();
		cleanupPopup();
	};
}

// === Mermaid rendering from CDN ===

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
let mermaidReady: Promise<typeof import('mermaid')> | undefined;

/** Warm-cool harmony: gold / indigo / sage on white */
const MERMAID_LIGHT = {
	primaryColor: '#fef6e4',
	primaryBorderColor: '#D6A24A',
	primaryTextColor: '#3c3c43',
	secondaryColor: '#eef0ff',
	secondaryBorderColor: '#5c73e7',
	secondaryTextColor: '#3c3c43',
	tertiaryColor: '#eef5ee',
	tertiaryBorderColor: '#5a9a6a',
	tertiaryTextColor: '#3c3c43',
	lineColor: '#67676c',
	textColor: '#3c3c43',
	mainBkg: '#fef6e4',
	noteBkgColor: '#fef3c7',
	noteBorderColor: '#D6A24A',
	noteTextColor: '#3c3c43',
	fontFamily: '"Inter", sans-serif',
	fontSize: '14px',
} as const;

/** Warm-cool harmony: indigo / amber / teal on dark */
const MERMAID_DARK = {
	darkMode: true,
	primaryColor: '#252540',
	primaryBorderColor: '#a8b1ff',
	primaryTextColor: '#dfdfd6',
	secondaryColor: '#302820',
	secondaryBorderColor: '#f9b44e',
	secondaryTextColor: '#dfdfd6',
	tertiaryColor: '#1e2e28',
	tertiaryBorderColor: '#3dd68c',
	tertiaryTextColor: '#dfdfd6',
	lineColor: '#98989f',
	textColor: '#dfdfd6',
	mainBkg: '#252540',
	noteBkgColor: '#302820',
	noteBorderColor: '#f9b44e',
	noteTextColor: '#dfdfd6',
	background: '#1b1b1f',
	fontFamily: '"Inter", sans-serif',
	fontSize: '14px',
} as const;

function isMermaidDark(): boolean {
	return document.documentElement.classList.contains('dark');
}

function mermaidConfig() {
	return {
		startOnLoad: false,
		theme: 'base' as const,
		themeVariables: isMermaidDark() ? MERMAID_DARK : MERMAID_LIGHT,
	};
}

function loadMermaid(): Promise<typeof import('mermaid')> {
	mermaidReady ??= import(/* @vite-ignore */ MERMAID_CDN).then((mod) => {
		mod.default.initialize(mermaidConfig());
		return mod;
	});
	return mermaidReady;
}

async function renderMermaidBlocks(): Promise<void> {
	const blocks = document.querySelectorAll<HTMLElement>(
		'pre > code.language-mermaid, div.language-mermaid pre > code',
	);
	if (blocks.length === 0) return;

	const mermaid = await loadMermaid();
	for (const code of blocks) {
		const pre = code.parentElement;
		if (pre === null || pre.dataset['mermaidRendered'] !== undefined) continue;
		pre.dataset['mermaidRendered'] = '';

		const source = code.textContent ?? '';
		const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
		const { svg } = await mermaid.default.render(id, source);

		const container = document.createElement('div');
		container.className = 'mermaid';
		container.dataset['mermaidSource'] = source;
		container.innerHTML = svg;
		pre.replaceWith(container);
	}
}

/** Re-initialize mermaid with current color scheme and re-render all blocks. */
async function rerenderMermaidBlocks(): Promise<void> {
	if (mermaidReady === undefined) return;
	const mermaid = await mermaidReady;
	mermaid.default.initialize(mermaidConfig());

	const containers = document.querySelectorAll<HTMLElement>('div.mermaid[data-mermaid-source]');
	for (const container of containers) {
		const source = container.dataset['mermaidSource'] ?? '';
		const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
		const { svg } = await mermaid.default.render(id, source);
		container.innerHTML = svg;
	}
}

// === Runtime replacement in bash code blocks ===

const ORIG_HTML = 'data-orig-html';

// Matches `npx tsx` in innerHTML, handling an optional span boundary between tokens:
//   same span:  "npx tsx"
//   cross span: "npx</span><span class="__shiki_x"> tsx"
const NPX_TSX_RE = /\bnpx\s*(?:<\/span>\s*<span[^>]*>\s*)?tsx\b/;

/**
 * Replace `npx tsx` with the selected runtime in code blocks.
 * Always replaces from the stored original innerHTML so syntax highlighting
 * is preserved and switching between runtimes works repeatedly.
 */
function applyRuntime(runtime: Runtime): void {
	const selector = [
		'div.language-bash pre code .line',
		'div.language-sh pre code .line',
		'div.language-ts pre code .line',
		'div.language-typescript pre code .line',
	].join(', ');
	for (const line of document.querySelectorAll(selector)) {
		const el = line as HTMLElement;

		// First encounter: snapshot original and skip lines without npx tsx
		if (!el.hasAttribute(ORIG_HTML)) {
			if (!el.textContent?.includes('npx tsx')) continue;
			el.setAttribute(ORIG_HTML, el.innerHTML);
		}

		const original = el.getAttribute(ORIG_HTML) ?? '';
		if (runtime === 'npx tsx') {
			el.innerHTML = original;
		} else {
			el.innerHTML = original.replace(NPX_TSX_RE, runtime);
		}
	}
}

// === Theme export ===

export default {
	extends: DefaultTheme,
	enhanceApp({ app }: EnhanceAppContext) {
		if (typeof window !== 'undefined') {
			app.use(TwoslashFloatingVue, twoslashFloatingOptions());
		} else {
			// SSR: register stub components that render slot content without floating-vue popover
			// machinery (which crashes during SSR with popperId destructure error).
			// This preserves identifier text in the static HTML for hydration.
			// Render slot content only — floating-vue Popper crashes during SSR (popperId destructure).
			// Duplicate @vue/runtime-core copies (hoisted vs .bun/) make Component types incompatible.
			const SlotPassthrough = (
				_: unknown,
				{ slots }: { slots: Record<string, (...args: unknown[]) => unknown> },
			) => slots['default']?.() ?? null;
			// @ts-expect-error — dual @vue/runtime-core copies produce incompatible Component types
			app.component('VMenu', SlotPassthrough);
			// @ts-expect-error — same as above
			app.component('VDropdown', SlotPassthrough);
			// @ts-expect-error — same as above
			app.component('VTooltip', SlotPassthrough);
		}
	},
	Layout() {
		return h(DefaultTheme.Layout, null, {
			'nav-bar-content-after': () => h(SettingsGear),
		});
	},
	setup() {
		const settings = useDocSettings();
		let cleanup: (() => void) | undefined;

		// --- Twoslash toggle via floating-vue theme disabled flag ---
		watch(
			() => settings.value.twoslash,
			(enabled) => {
				const theme = floatingOptions.themes['twoslash'];
				if (theme) {
					theme.disabled = !enabled;
				}
				if (typeof document !== 'undefined') {
					document.documentElement.classList.toggle('twoslash-off', !enabled);
				}
			},
			{ immediate: true },
		);

		// --- Runtime replacement ---
		watch(
			() => settings.value.runtime,
			(runtime) => applyRuntime(runtime),
		);

		onMounted(() => {
			showTwoslashHint();
			cleanup = setupMobileBottomSheet();
			applyRuntime(settings.value.runtime);
			renderMermaidBlocks();

			// Re-render mermaid diagrams when VitePress toggles dark mode
			const darkObserver = new MutationObserver((mutations) => {
				for (const m of mutations) {
					if (m.attributeName === 'class') rerenderMermaidBlocks();
				}
			});
			darkObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['class'],
			});
			const prevCleanup = cleanup;
			cleanup = () => {
				prevCleanup?.();
				darkObserver.disconnect();
			};
		});

		onContentUpdated(() => {
			showTwoslashHint();
			applyRuntime(settings.value.runtime);
			renderMermaidBlocks();
		});

		onUnmounted(() => {
			cleanup?.();
		});
	},
};
