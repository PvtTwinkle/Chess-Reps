<script lang="ts">
	import type { PrepState } from './prepState.svelte';

	let { state }: { state: PrepState } = $props();

	let totalPositions = $derived(state.totalOpponentPositions);
	let greenCount = $derived(state.coveredPositions.green);
	let yellowCount = $derived(state.coveredPositions.yellow);
	let redCount = $derived(totalPositions - greenCount - yellowCount);
	let coveragePct = $derived(
		totalPositions > 0 ? Math.round(((greenCount + yellowCount) / totalPositions) * 100) : 0
	);
	let prepPct = $derived(totalPositions > 0 ? Math.round((greenCount / totalPositions) * 100) : 0);
</script>

<div class="dashboard">
	<div class="stat-row">
		<div class="stat">
			<span class="stat-value">{totalPositions}</span>
			<span class="stat-label">Positions</span>
		</div>
		<div class="stat">
			<span class="stat-value coverage-value">{coveragePct}%</span>
			<span class="stat-label">Coverage</span>
		</div>
		<div class="stat">
			<span class="stat-value prep-value">{prepPct}%</span>
			<span class="stat-label">Prepped</span>
		</div>
	</div>

	<div class="coverage-bar">
		{#if totalPositions > 0}
			<div class="bar-segment green" style="width: {(greenCount / totalPositions) * 100}%"></div>
			<div class="bar-segment yellow" style="width: {(yellowCount / totalPositions) * 100}%"></div>
			<div class="bar-segment red" style="width: {(redCount / totalPositions) * 100}%"></div>
		{:else}
			<div class="bar-segment empty" style="width: 100%"></div>
		{/if}
	</div>

	<p class="coverage-hint">How many of your opponent's moves you have a prepared response for.</p>

	<div class="legend">
		<span class="legend-item"><span class="dot green"></span> Prepped ({greenCount})</span>
		<span class="legend-item"><span class="dot yellow"></span> In repertoire ({yellowCount})</span>
		<span class="legend-item"><span class="dot red"></span> No response ({redCount})</span>
	</div>

	{#if state.allGaps.length > 0}
		<button class="next-gap-btn" onclick={() => state.navigateToGap()}>
			Next uncovered position
		</button>
		<p class="gap-hint">
			Jumps to the most important position where your opponent plays a move you haven't prepared
			against. Prioritized by how often they play it.
		</p>
	{:else if totalPositions > 0}
		<p class="gap-hint all-covered">All opponent moves covered.</p>
	{/if}
</div>

<style>
	.dashboard {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.stat-row {
		display: flex;
		gap: var(--space-4);
		margin-bottom: var(--space-3);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.stat-value {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.coverage-value {
		color: var(--color-eval-good);
	}

	.prep-value {
		color: var(--color-accent);
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.coverage-bar {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: var(--space-2);
		background: var(--color-surface-alt);
	}

	.bar-segment {
		transition: width 0.3s ease-out;
	}

	.bar-segment.green {
		background: var(--color-eval-good);
	}

	.bar-segment.yellow {
		background: var(--color-eval-inaccuracy);
	}

	.bar-segment.red {
		background: var(--color-eval-blunder);
	}

	.bar-segment.empty {
		background: var(--color-surface-alt);
	}

	.legend {
		display: flex;
		gap: var(--space-3);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.dot.green {
		background: var(--color-eval-good);
	}

	.dot.yellow {
		background: var(--color-eval-inaccuracy);
	}

	.dot.red {
		background: var(--color-eval-blunder);
	}

	.next-gap-btn {
		width: 100%;
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--dur-fast) var(--ease-snap);
	}

	.next-gap-btn:hover {
		opacity: 0.9;
	}

	.coverage-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: 0 0 var(--space-2) 0;
		line-height: 1.3;
	}

	.gap-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0 0;
		line-height: 1.3;
	}

	.gap-hint.all-covered {
		color: var(--color-eval-good);
		font-weight: 600;
	}
</style>
