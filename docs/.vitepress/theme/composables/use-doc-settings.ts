/**
 * Reactive doc settings store backed by localStorage.
 *
 * @module
 */

import { ref, watch } from 'vue';

export const runtimes = [
  { value: 'npx tsx', label: 'npx tsx (Node)' },
  { value: 'bun', label: 'bun' },
  { value: 'deno run -A', label: 'deno run -A' },
] as const;

export type Runtime = (typeof runtimes)[number]['value'];

export interface DocSettings {
  twoslash: boolean;
  runtime: Runtime;
}

const STORAGE_KEY = 'dreamcli-doc-settings';

const defaults: DocSettings = {
  twoslash: true,
  runtime: 'npx tsx',
};

const validRuntimes = new Set<Runtime>(runtimes.map((r) => r.value));

function load(): DocSettings {
  if (typeof localStorage === 'undefined') return defaults;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;

    const obj = parsed as Partial<Record<keyof DocSettings, unknown>>;

    return {
      twoslash:
        typeof obj.twoslash === 'boolean' ? obj.twoslash : defaults.twoslash,
      runtime: validRuntimes.has(obj.runtime as Runtime)
        ? (obj.runtime as Runtime)
        : defaults.runtime,
    };
  } catch {
    return defaults;
  }
}

const state = ref<DocSettings>(load());

watch(
  state,
  (value) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
  },
  { deep: true },
);

export function useDocSettings() {
  return state;
}
