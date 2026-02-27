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
		gap: 0.5rem;
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #505060;
	}

	.move-list {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.1rem 0.25rem;
		font-size: 0.875rem;
	}

	.move-num {
		color: #505060;
		font-size: 0.78rem;
		user-select: none;
	}

	.move-san {
		background: none;
		border: none;
		color: #c0c0d0;
		font-size: 0.875rem;
		cursor: pointer;
		padding: 0.1rem 0.25rem;
		border-radius: 3px;
		transition:
			background 0.1s,
			color 0.1s;
		font-family: inherit;
	}

	.move-san:hover {
		background: #0f3460;
		color: #f0f0f0;
	}

	.move-san.is-current {
		background: #1a4a7a;
		color: #e2b714;
		font-weight: 600;
	}

	/* Black's moves are slightly dimmer to visually distinguish them. */
	.move-san--black {
		color: #909098;
	}
</style>
