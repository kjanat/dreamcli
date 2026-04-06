<script setup lang="ts">
	import { onMounted, onUnmounted, ref } from 'vue';

	import { runtimes, useDocSettings } from '../composables/use-doc-settings.ts';

	const settings = useDocSettings();
	const settingsDropdownId = 'docs-settings-dropdown';
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
			open.value = false;
			const trigger = triggerButton.value;
			if (trigger !== null) {
				trigger.focus();
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
			ref="triggerButton"
			class="settings-gear-btn"
			:aria-expanded="open"
			:aria-controls="settingsDropdownId"
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
			<div v-show="open" :id="settingsDropdownId" class="settings-dropdown" role="menu">
				<button
					class="settings-toggle"
					type="button"
					role="menuitemcheckbox"
					:aria-checked="settings.twoslash"
					data-settings-option
					@click="toggleTwoslash"
				>
					<span>Type hovers</span>
					<span class="toggle-track" :class="{ active: settings.twoslash }" />
				</button>

				<div class="runtime-options">
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
						<span>{{ rt.label }}</span>
					</button>
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
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 170px;
		padding: 8px;
		border: 1px solid var(--vp-c-border);
		border-radius: 10px;
		background: var(--vp-c-bg-elv);
		box-shadow: var(--vp-shadow-3);
	}

	/* --- Toggle switch --- */

	.settings-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 4px 6px;
		border: none;
		border-radius: var(--s-radius-sm);
		background: transparent;
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		color: var(--vp-c-text-1);
		text-align: left;
		transition: background-color var(--s-duration) var(--s-ease);
	}

	.settings-toggle:hover {
		background: var(--vp-c-default-soft);
	}

	.settings-toggle:focus-visible,
	.runtime-option:focus-visible {
		outline: 2px solid var(--s-accent);
		outline-offset: 2px;
	}

	.toggle-track {
		position: relative;
		width: 32px;
		height: 18px;
		border-radius: 9px;
		background: var(--vp-c-default-soft);
		transition: background-color var(--s-duration) var(--s-ease);
		flex-shrink: 0;
	}

	.toggle-track::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--vp-c-text-3);
		transition:
			transform var(--s-duration) var(--s-ease),
			background-color var(--s-duration) var(--s-ease);
	}

	.toggle-track.active {
		background: var(--s-accent);
	}

	.toggle-track.active::after {
		transform: translateX(14px);
		background: white;
	}

	/* --- Segmented control --- */

	.runtime-options {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 3px;
		border-radius: var(--s-radius);
		background: var(--vp-c-default-soft);
	}

	.runtime-option {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 5px 8px;
		border: none;
		border-radius: var(--s-radius-sm);
		background: transparent;
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		color: var(--vp-c-text-2);
		font-family: var(--vp-font-family-mono);
		transition:
			background-color var(--s-duration) var(--s-ease),
			color var(--s-duration) var(--s-ease),
			box-shadow var(--s-duration) var(--s-ease);
	}

	.runtime-option:hover {
		color: var(--vp-c-text-1);
	}

	.runtime-option.active {
		background: var(--vp-c-bg-elv);
		color: var(--vp-c-text-1);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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
