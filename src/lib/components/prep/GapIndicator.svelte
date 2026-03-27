<script lang="ts">
	import type { GapStatus } from './prepState.svelte';

	let { status }: { status: GapStatus } = $props();
</script>

<span
	class="gap-dot"
	class:green={status === 'green'}
	class:yellow={status === 'yellow'}
	class:red={status === 'red'}
></span>

<style>
	.gap-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.gap-dot.green {
		background: var(--color-eval-good);
	}

	.gap-dot.yellow {
		background: var(--color-eval-inaccuracy);
	}

	.gap-dot.red {
		background: var(--color-eval-blunder);
	}
</style>
