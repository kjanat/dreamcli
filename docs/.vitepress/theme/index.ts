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
