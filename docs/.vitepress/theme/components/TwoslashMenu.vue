<script setup lang="ts">
	import { withBase } from 'vitepress';
	import { onMounted, ref, watchEffect } from 'vue';

	defineOptions({ inheritAttrs: false });
	const props = defineProps<{ payload?: string }>();
	const mounted = ref(false);
	const open = ref(false);
	const html = ref('');
	const failed = ref(false);

	// The server and the first client render both show the highlighted identifier.
	onMounted(() => {
		mounted.value = true;
	});
	watchEffect(async (onCleanup) => {
		const path = props.payload;
		if (!open.value || !path) return;
		const controller = new AbortController();
		onCleanup(() => controller.abort());
		html.value = '';
		failed.value = false;
		try {
			const response = await fetch(withBase(path), { signal: controller.signal });
			if (!response.ok) throw new Error(String(response.status));
			const content = await response.text();
			if (!controller.signal.aborted) html.value = content;
		} catch {
			if (!controller.signal.aborted) failed.value = true;
		}
	});
</script>

<template>
	<VMenu
		v-if="mounted"
		v-bind="$attrs"
		:handle-resize="true"
		@apply-show="open = true"
		@apply-hide="open = false"
	>
		<slot />
		<template #popper>
			<slot v-if="!payload" name="popper" />
			<span v-else-if="failed">Type information could not be loaded.</span>
			<span v-else-if="html" v-html="html" />
			<span v-else role="status">Loading type information…</span>
		</template>
	</VMenu>
	<slot v-else />
</template>
