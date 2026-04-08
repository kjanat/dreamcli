<script setup lang="ts">
	import { onMounted, onUnmounted, ref } from 'vue';

	import { runtimes, useDocSettings } from '../composables/use-doc-settings.ts';

	const settings = useDocSettings();
	const settingsDropdownId = 'docs-settings-dropdown';
	const settingsTriggerId = 'docs-settings-trigger';
	const open = ref(false);
	const root = ref<HTMLElement | null>(null);
	const triggerButton = ref<HTMLButtonElement | null>(null);
	type RuntimeChoice = (typeof runtimes)[number]['value'];

	function toggle() {
		open.value = !open.value;
	}

	function toggleTwoslash() {
		settings.value.twoslash = !settings.value.twoslash;
	}

	function setRuntime(runtime: RuntimeChoice) {
		settings.value.runtime = runtime;
	}

	function onClickOutside(e: MouseEvent) {
		if (root.value && !root.value.contains(e.target as Node)) {
			open.value = false;
		}
	}

	function getOptionElements(): HTMLElement[] {
		if (root.value === null) {
			return [];
		}
		return Array.from(
			root.value.querySelectorAll<HTMLElement>('.settings-dropdown [data-settings-option]'),
		);
	}

	const navigableKeys: Record<string, true> = {
		ArrowDown: true,
		ArrowUp: true,
		Home: true,
		End: true,
	};

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open.value) {
			const active = document.activeElement;
			const withinComponent =
				root.value !== null ? root.value.contains(active) : active === triggerButton.value;
			if (withinComponent) {
				open.value = false;
				triggerButton.value?.focus();
			}
			return;
		}

		if (!open.value || !(e.key in navigableKeys)) {
			return;
		}

		const activeElement = document.activeElement;
		if (root.value !== null && (activeElement === null || !root.value.contains(activeElement))) {
			return;
		}

		const options = getOptionElements();
		if (options.length === 0) {
			return;
		}

		e.preventDefault();
		const currentIndex = activeElement instanceof HTMLElement ? options.indexOf(activeElement) : -1;
		let nextIndex: number;
		if (e.key === 'Home') {
			nextIndex = 0;
		} else if (e.key === 'End') {
			nextIndex = options.length - 1;
		} else {
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			nextIndex =
				currentIndex === -1
					? direction === 1
						? 0
						: options.length - 1
					: (currentIndex + direction + options.length) % options.length;
		}
		const nextOption = options[nextIndex];
		if (nextOption !== undefined) {
			nextOption.focus();
		}
	}

	onMounted(() => {
		document.addEventListener('click', onClickOutside);
		document.addEventListener('keydown', onKeyDown);
	});
	onUnmounted(() => {
		document.removeEventListener('click', onClickOutside);
		document.removeEventListener('keydown', onKeyDown);
	});
</script>

<template>
	<div ref="root" class="settings-gear" :class="{ open }">
		<button
			:id="settingsTriggerId"
			ref="triggerButton"
			class="settings-gear-btn"
			:aria-expanded="open"
			:aria-controls="settingsDropdownId"
			aria-haspopup="menu"
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
			<div
				v-show="open"
				:id="settingsDropdownId"
				class="settings-dropdown"
				role="menu"
				:aria-labelledby="settingsTriggerId"
			>
				<button
					class="settings-toggle"
					type="button"
					role="menuitemcheckbox"
					:aria-checked="settings.twoslash"
					data-settings-option
					@click="toggleTwoslash"
				>
					<span class="toggle-track" :class="{ active: settings.twoslash }" />
					<span class="toggle-label">Types</span>
				</button>

				<span class="divider" />

				<button
					v-for="rt in runtimes"
					:key="rt.value"
					class="runtime-option"
					type="button"
					:class="{ active: settings.runtime === rt.value }"
					role="menuitemradio"
					:aria-checked="settings.runtime === rt.value"
					data-settings-option
					@click="setRuntime(rt.value)"
				>
					<span>{{ rt.short }}</span>
				</button>
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

		/* gear animation */
		--s-hover-rotate: 30deg;
		--s-hover-circle-scale: 1.2;
		--s-open-rotate: 360deg;
		--s-open-circle-scale: 0.8;
		--s-open-duration: 0.5s;
		--s-open-ease: cubic-bezier(0, 0.7, 0.3, 1);
		--s-close-duration: 0.6s;
		--s-close-ease: cubic-bezier(0.2, 0, 0, 1);

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
		color: var(--vp-c-text-1);
		cursor: pointer;
		transition: color var(--s-duration) var(--s-ease);
	}

	@media (min-width: 768px) {
		.settings-gear-btn {
			color: var(--vp-c-text-2);
		}
	}

	.settings-gear-btn svg {
		transition: transform var(--s-close-duration) var(--s-close-ease);
	}

	.settings-gear-btn svg path {
		transition: transform var(--s-duration) var(--s-ease);
		transform-origin: 12px 12px;
	}

	.settings-gear-btn svg circle {
		transition: transform var(--s-duration) var(--s-ease);
		transform-origin: 12px 12px;
	}

	.settings-gear-btn:hover svg path {
		transform: rotate(var(--s-hover-rotate));
	}

	.settings-gear-btn:hover svg circle {
		transform: scale(var(--s-hover-circle-scale));
	}

	.settings-gear.open .settings-gear-btn svg {
		transform: rotate(var(--s-open-rotate));
		transition: transform var(--s-open-duration) var(--s-open-ease);
	}

	.settings-gear.open .settings-gear-btn svg circle {
		transform: scale(var(--s-open-circle-scale));
	}

	.settings-gear.open .settings-gear-btn:hover svg path {
		transform: rotate(calc(var(--s-hover-rotate) * -1));
	}

	.settings-gear-btn:hover,
	.settings-gear.open .settings-gear-btn {
		color: var(--vp-c-text-1);
	}

	.settings-dropdown {
		position: absolute;
		top: calc(100% + var(--s-gap));
		right: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 0;
		padding: 4px;
		border: 1px solid var(--vp-c-border);
		border-radius: 999px;
		background: var(--vp-c-bg-elv);
		backdrop-filter: blur(12px);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
		white-space: nowrap;
	}

	/* --- Toggle --- */

	.settings-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: none;
		border-radius: 999px;
		background: transparent;
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		font-weight: 500;
		color: var(--vp-c-text-2);
		transition:
			color var(--s-duration) var(--s-ease),
			background-color var(--s-duration) var(--s-ease);
	}

	.settings-toggle:hover {
		color: var(--vp-c-text-1);
		background: var(--vp-c-default-soft);
	}

	.settings-toggle:focus-visible,
	.runtime-option:focus-visible {
		outline: 2px solid var(--s-accent);
		outline-offset: 2px;
	}

	.toggle-label {
		user-select: none;
	}

	.toggle-track {
		position: relative;
		width: 28px;
		height: 16px;
		border-radius: 8px;
		background: var(--vp-c-default-soft);
		transition: background-color 0.3s var(--s-ease);
		flex-shrink: 0;
	}

	.toggle-track::after {
		content: "";
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--vp-c-text-3);
		transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s var(--s-ease);
	}

	.toggle-track.active {
		background: var(--s-accent);
	}

	.toggle-track.active::after {
		transform: translateX(12px);
		background: white;
	}

	/* --- Divider --- */

	.divider {
		width: 1px;
		height: 16px;
		margin: 0 2px;
		background: var(--vp-c-divider);
		flex-shrink: 0;
	}

	/* --- Runtime pills --- */

	.runtime-option {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 6px 10px;
		border: none;
		border-radius: 999px;
		background: transparent;
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		color: var(--vp-c-text-2);
		font-family: var(--vp-font-family-mono);
		transition:
			background-color var(--s-duration) var(--s-ease),
			color var(--s-duration) var(--s-ease),
			box-shadow var(--s-duration) var(--s-ease);
	}

	.runtime-option:hover {
		color: var(--vp-c-text-1);
		background: var(--vp-c-default-soft);
	}

	.runtime-option.active {
		background: var(--vp-c-brand-soft);
		color: var(--s-accent);
	}

	/* --- Transition --- */

	.settings-dropdown-enter-active {
		transition:
			opacity 0.25s cubic-bezier(0, 0, 0.2, 1),
			transform 0.25s cubic-bezier(0, 0, 0.2, 1);
	}

	.settings-dropdown-leave-active {
		transition: opacity 0.15s var(--s-ease), transform 0.15s var(--s-ease);
	}

	.settings-dropdown-enter-from {
		opacity: 0;
		transform: translateY(-6px) scale(0.95);
	}

	.settings-dropdown-leave-to {
		opacity: 0;
		transform: translateY(-3px);
	}
</style>
