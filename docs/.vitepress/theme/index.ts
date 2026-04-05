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
import SettingsGear from './components/SettingsGear.vue';
import type { Runtime } from './composables/use-doc-settings.ts';
import { useDocSettings } from './composables/use-doc-settings.ts';

const HINT_KEY = 'twoslash-hint-seen';

function isTouchDevice(): boolean {
  return !window.matchMedia('(hover: hover)').matches;
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
        const newHeight = Math.max(
          100,
          Math.min(startHeight + dy, window.innerHeight * 0.9),
        );
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
      const hasHover = !isTouchDevice();

      app.use(TwoslashFloatingVue, {
        themes: {
          twoslash: {
            triggers: hasHover ? ['hover', 'touch'] : ['click'],
            popperTriggers: hasHover ? ['hover', 'touch'] : ['click'],
            autoHide: hasHover,
            flip: true,
            overflowPadding: 12,
          },
        },
      });
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
      if (typeof window === 'undefined') return;
      showTwoslashHint();
      cleanup = setupMobileBottomSheet();
      applyRuntime(settings.value.runtime);
    });

    onContentUpdated(() => {
      showTwoslashHint();
      applyRuntime(settings.value.runtime);
    });

    onUnmounted(() => {
      cleanup?.();
    });
  },
};
