<script setup lang="ts">
  import { onMounted, onUnmounted, ref } from 'vue';

  import { runtimes, useDocSettings } from '../composables/use-doc-settings.ts';

  const settings = useDocSettings();
  const open = ref(false);
  const root = ref<HTMLElement | null>(null);

  function toggle() {
    open.value = !open.value;
  }

  function onClickOutside(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
      open.value = false;
    }
  }

  onMounted(() => document.addEventListener('click', onClickOutside));
  onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>

<template>
  <div ref="root" class="settings-gear" :class="{ open }">
    <button
      class="settings-gear-btn"
      :aria-expanded="open"
      aria-label="Documentation settings"
      @click="toggle"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>

    <Transition name="settings-dropdown">
      <div v-show="open" class="settings-dropdown">
        <div class="settings-section">
          <label class="settings-toggle">
            <input v-model="settings.twoslash" type="checkbox">
            <span>Type hovers</span>
          </label>
        </div>

        <div class="settings-divider" />

        <div class="settings-section">
          <div class="settings-label">Run examples with</div>
          <div class="runtime-options">
            <label
              v-for="rt in runtimes"
              :key="rt.value"
              class="runtime-option"
            >
              <input
                v-model="settings.runtime"
                type="radio"
                name="runtime"
                :value="rt.value"
              >
              <span>{{ rt.label }}</span>
            </label>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
  .settings-gear {
    --s-duration: 0.25s;
    --s-ease: cubic-bezier(0.4, 0, 0.2, 1);
    --s-gap: 8px;
    --s-radius: 8px;
    --s-radius-sm: 6px;
    --s-accent: var(--vp-c-brand-1);

    position: relative;
    display: flex;
    align-items: center;
    margin-left: 4px;
  }

  .settings-gear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: var(--s-radius);
    background: transparent;
    color: var(--vp-c-text-2);
    cursor: pointer;
    transition:
      color var(--s-duration) var(--s-ease),
      background-color var(--s-duration) var(--s-ease);
  }

  .settings-gear-btn svg {
    transition: transform var(--s-duration) var(--s-ease);
  }

  .settings-gear.open .settings-gear-btn svg {
    transform: rotate(60deg);
  }

  .settings-gear-btn:hover,
  .settings-gear.open .settings-gear-btn {
    color: var(--vp-c-text-1);
    background: var(--vp-c-default-soft);
  }

  .settings-dropdown {
    position: absolute;
    top: calc(100% + var(--s-gap));
    right: 0;
    z-index: 100;
    min-width: 200px;
    padding: 12px;
    border: 1px solid var(--vp-c-border);
    border-radius: 12px;
    background: var(--vp-c-bg-elv);
    box-shadow: var(--vp-shadow-3);
  }

  .settings-section {
    padding: 4px 0;
  }

  .settings-divider {
    margin: var(--s-gap) 0;
    border-top: 1px solid var(--vp-c-divider);
  }

  .settings-label {
    margin-bottom: var(--s-radius-sm);
    font-size: 12px;
    font-weight: 600;
    color: var(--vp-c-text-2);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .settings-toggle {
    display: flex;
    gap: var(--s-gap);
    align-items: center;
    cursor: pointer;
    font-size: 14px;
    color: var(--vp-c-text-1);
  }

  .settings-toggle input {
    accent-color: var(--s-accent);
  }

  .runtime-options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .runtime-option {
    display: flex;
    gap: var(--s-gap);
    align-items: center;
    padding: 4px var(--s-gap);
    border-radius: var(--s-radius-sm);
    cursor: pointer;
    font-size: 13px;
    color: var(--vp-c-text-1);
    font-family: var(--vp-font-family-mono);
    transition: background-color var(--s-duration) var(--s-ease);
  }

  .runtime-option:hover {
    background: var(--vp-c-default-soft);
  }

  .runtime-option input {
    accent-color: var(--s-accent);
  }

  /* --- Transition --- */

  .settings-dropdown-enter-active,
  .settings-dropdown-leave-active {
    transition:
      opacity var(--s-duration) var(--s-ease),
      transform var(--s-duration) var(--s-ease);
  }

  .settings-dropdown-enter-from,
  .settings-dropdown-leave-to {
    opacity: 0;
    transform: translateY(-4px);
  }
</style>
