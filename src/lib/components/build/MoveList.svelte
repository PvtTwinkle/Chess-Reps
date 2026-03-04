<!--
	MoveList — displays the current navigation line as numbered move pairs.

	Shows moves like "1. e4 e5  2. Nf3 Nc6" with clickable SAN buttons.
	The move at the current position is highlighted.

	Props:
	  movePairs — grouped pairs from buildState
	  currentIdx — index of the current move in navHistory (navHistory.length - 1)

	Events:
	  onNavigate(idx) — called when the user clicks a move to jump to that position
-->

<script lang="ts">
	import type { NavEntry } from './buildState.svelte';

	interface Props {
		movePairs: [NavEntry, NavEntry | null][];
		currentIdx: number;
		onNavigate: (idx: number) => void;
	}

	let { movePairs, currentIdx, onNavigate }: Props = $props();
</script>

{#if movePairs.length > 0}
	<div class="section">
		<div class="section-label">CURRENT LINE</div>
		<div class="move-list">
			{#each movePairs as pair, i (i)}
				<span class="move-num">{i + 1}.</span>
				<button
					class="move-san"
					class:is-current={currentIdx === i * 2}
					onclick={() => onNavigate(i * 2)}
				>
					{pair[0].san}
				</button>
				{#if pair[1]}
					<button
						class="move-san move-san--black"
						class:is-current={currentIdx === i * 2 + 1}
						onclick={() => onNavigate(i * 2 + 1)}
					>
						{pair[1].san}
					</button>
				{/if}
			{/each}
		</div>
	</div>
{/if}

<style>
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-label {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.move-list {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 1px var(--space-1);
		font-size: 13px;
	}

	.move-num {
		color: var(--color-text-muted);
		font-size: 12px;
		user-select: none;
	}

	.move-san {
		background: none;
		border: none;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		padding: 1px var(--space-1);
		border-radius: 3px;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.move-san:hover {
		background: var(--color-surface-alt);
		color: var(--color-gold);
	}

	.move-san.is-current {
		background: var(--color-surface-alt);
		color: var(--color-gold);
		font-weight: 600;
		border-left: 2px solid var(--color-gold);
	}

	/* Black's moves are slightly dimmer to visually distinguish them. */
	.move-san--black {
		color: var(--color-text-secondary);
	}

	/* ── Mobile compact mode ── --bp-md */
	@media (max-width: 767px) {
		.move-san {
			min-height: 36px;
			padding: var(--space-2);
			display: inline-flex;
			align-items: center;
		}
	}
</style>
