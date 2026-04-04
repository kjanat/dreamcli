/**
 * Reactive doc settings store backed by localStorage.
 *
 * Singleton — every call to `useDocSettings()` returns the same
 * reactive ref. Changes auto-persist to localStorage.
 *
 * @module
 */

import { ref, watch } from 'vue';

/** Supported runtime commands for example code blocks. */
export type Runtime = 'npx tsx' | 'bun' | 'deno run -A';

export interface DocSettings {
  /** Whether twoslash type-hover popups are enabled. */
  twoslash: boolean;
  /** Runtime prefix shown in bash usage blocks. */
  runtime: Runtime;
}

export const runtimes: readonly {
  readonly value: Runtime;
  readonly label: string;
}[] = [
  { value: 'npx tsx', label: 'npx tsx (Node)' },
  { value: 'bun', label: 'bun' },
  { value: 'deno run -A', label: 'deno run -A' },
];

const STORAGE_KEY = 'dreamcli-doc-settings';

const defaults: DocSettings = {
  twoslash: true,
  runtime: 'npx tsx',
};

const validRuntimes = new Set<string>(runtimes.map((r) => r.value));

function load(): DocSettings {
  if (typeof localStorage === 'undefined') return { ...defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...defaults };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...defaults };
    const obj = parsed as Record<string, unknown>;
    return {
      twoslash:
        typeof obj['twoslash'] === 'boolean'
          ? obj['twoslash']
          : defaults.twoslash,
      runtime:
        typeof obj['runtime'] === 'string' && validRuntimes.has(obj['runtime'])
          ? (obj['runtime'] as Runtime)
          : defaults.runtime,
    };
  } catch {
    return { ...defaults };
  }
}

function save(settings: DocSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Singleton reactive state — shared across all consumers
const state = ref<DocSettings>(load());

let watching = false;

/** Returns shared reactive doc settings. Auto-persists to localStorage. */
export function useDocSettings() {
  if (!watching) {
    watching = true;
    watch(state, (v) => save(v), { deep: true });
  }
  return state;
}
