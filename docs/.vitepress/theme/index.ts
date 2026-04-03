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
