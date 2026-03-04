<script lang="ts">
	import type { PageData } from './$types';
	import OnboardingWelcome from '$lib/components/OnboardingWelcome.svelte';
	import { formatLine } from '$lib/gaps';
	import { base } from '$app/paths';

	let { data }: { data: PageData } = $props();

	/**
	 * Format a unix timestamp (seconds) as a relative time string like
	 * "in 3 hours" or "in 2 days". No external library needed.
	 */
	function relativeTime(unixSeconds: number): string {
		const diffMs = unixSeconds * 1000 - Date.now();
		const diffMin = Math.round(diffMs / 60_000);
		if (diffMin < 1) return 'now';
		if (diffMin < 60) return `in ${diffMin}m`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `in ${diffHr}h`;
		const diffDay = Math.round(diffHr / 24);
		return `in ${diffDay}d`;
	}

	/**
	 * Accuracy percentage for a session. Returns 0–100.
	 */
	function accuracy(reviewed: number, correct: number): number {
		if (reviewed === 0) return 0;
		return Math.round((correct / reviewed) * 100);
	}

	/**
	 * CSS class for an accuracy block: green >80%, yellow 60–80%, red <60%.
	 */
	function accuracyClass(reviewed: number, correct: number): string {
		const pct = accuracy(reviewed, correct);
		if (pct >= 80) return 'acc-green';
		if (pct >= 60) return 'acc-yellow';
		return 'acc-red';
	}
</script>

<!--
	Show the onboarding welcome screen if the user has no repertoires yet.
	Once they create one via the welcome screen, invalidateAll() re-runs the
	layout load, repertoires.length becomes 1, and this condition flips.
-->
{#if data.repertoires.length === 0}
	<OnboardingWelcome />
{:else}
	<h1>Dashboard</h1>

	<div class="widget-grid">
		<!-- Due Now -->
		<a href="{base}/drill" class="widget widget-link">
			<div class="widget-label">Due Now</div>
			<div class="widget-value" class:due-positive={data.dueCount > 0}>
				{data.dueCount}
			</div>
			{#if data.dueCount > 0}
				<div class="widget-hint">Tap to drill</div>
			{:else}
				<div class="widget-hint">All caught up</div>
			{/if}
		</a>

		<!-- Mastered -->
		<div class="widget">
			<div class="widget-label">Mastered</div>
			<div class="widget-value mastered-value">
				{data.masteredCount}<span class="widget-denom">/{data.totalCards}</span>
			</div>
			{#if data.totalCards > 0}
				<div class="widget-hint">
					{Math.round((data.masteredCount / data.totalCards) * 100)}% of cards
				</div>
			{/if}
		</div>

		<!-- Streak -->
		<div class="widget">
			<div class="widget-label">Streak</div>
			<div class="widget-value streak-value">
				{data.streak}<span class="widget-unit">d</span>
			</div>
			<div class="widget-hint">
				{data.streak === 0 ? 'Drill today to start' : 'Consecutive days'}
			</div>
		</div>

		<!-- Next Review -->
		<div class="widget">
			<div class="widget-label">Next Review</div>
			<div class="widget-value next-value">
				{#if data.nextReviewAt}
					{relativeTime(data.nextReviewAt)}
				{:else if data.totalCards === 0}
					&mdash;
				{:else}
					Now
				{/if}
			</div>
			<div class="widget-hint">
				{#if data.nextReviewAt}
					Soonest due card
				{:else if data.totalCards === 0}
					No cards yet
				{:else}
					Cards are waiting
				{/if}
			</div>
		</div>

		<!-- Card State Breakdown -->
		<div class="widget widget-wide">
			<div class="widget-label">Card States</div>
			{#if data.totalCards > 0}
				<div class="state-bar">
					{#if data.cardStates.new_ > 0}
						<div
							class="state-segment state-new"
							style="width: {(data.cardStates.new_ / data.totalCards) * 100}%"
							title="New: {data.cardStates.new_}"
						></div>
					{/if}
					{#if data.cardStates.learning > 0}
						<div
							class="state-segment state-learning"
							style="width: {(data.cardStates.learning / data.totalCards) * 100}%"
							title="Learning: {data.cardStates.learning}"
						></div>
					{/if}
					{#if data.cardStates.review > 0}
						<div
							class="state-segment state-review"
							style="width: {(data.cardStates.review / data.totalCards) * 100}%"
							title="Review: {data.cardStates.review}"
						></div>
					{/if}
					{#if data.cardStates.relearning > 0}
						<div
							class="state-segment state-relearning"
							style="width: {(data.cardStates.relearning / data.totalCards) * 100}%"
							title="Relearning: {data.cardStates.relearning}"
						></div>
					{/if}
				</div>
				<div class="state-legend">
					<span class="legend-item"
						><span class="legend-dot state-new"></span> New {data.cardStates.new_}</span
					>
					<span class="legend-item"
						><span class="legend-dot state-learning"></span> Learning {data.cardStates
							.learning}</span
					>
					<span class="legend-item"
						><span class="legend-dot state-review"></span> Review {data.cardStates.review}</span
					>
					<span class="legend-item"
						><span class="legend-dot state-relearning"></span> Relearning {data.cardStates
							.relearning}</span
					>
				</div>
			{:else}
				<p class="widget-empty">No cards yet</p>
			{/if}
		</div>

		<!-- Accuracy Trend -->
		<div class="widget widget-wide">
			<div class="widget-label">Accuracy Trend</div>
			{#if data.recentSessions.length > 0}
				<div class="trend-row">
					{#each data.recentSessions as session (session.completedAt)}
						<div
							class="trend-block {accuracyClass(session.cardsReviewed, session.cardsCorrect)}"
							title="{accuracy(
								session.cardsReviewed,
								session.cardsCorrect
							)}% ({session.cardsCorrect}/{session.cardsReviewed})"
						></div>
					{/each}
				</div>
				<div class="trend-legend">
					<span class="legend-item"><span class="legend-dot acc-green"></span> &gt;80%</span>
					<span class="legend-item"><span class="legend-dot acc-yellow"></span> 60–80%</span>
					<span class="legend-item"><span class="legend-dot acc-red"></span> &lt;60%</span>
				</div>
			{:else}
				<p class="widget-empty">Complete a session to see trends</p>
			{/if}
		</div>

		<!-- Gap Finder -->
		{#if data.gaps.length > 0}
			<div class="widget widget-wide">
				<div class="widget-label">
					<span class="gap-badge">{data.gaps.length}</span>
					Gap{data.gaps.length === 1 ? '' : 's'} Found
				</div>
				<ul class="gap-list">
					{#each data.gaps.slice(0, 5) as gap (gap.toFen)}
						<li class="gap-item">
							<span class="gap-line">{formatLine(gap.line)}</span>
							<a href="{base}/build?line={encodeURIComponent(gap.line)}" class="gap-link">
								Build
							</a>
						</li>
					{/each}
				</ul>
				{#if data.gaps.length > 5}
					<p class="gap-more">+ {data.gaps.length - 5} more</p>
				{/if}
			</div>
		{:else}
			<div class="widget widget-wide gap-covered">
				<div class="widget-label">Gap Finder</div>
				<p>No gaps — repertoire fully covered</p>
			</div>
		{/if}

		<!-- Trouble Spots -->
		{#if data.troubleSpots.length > 0}
			<div class="widget widget-wide">
				<div class="widget-label">Trouble Spots</div>
				<ul class="trouble-list">
					{#each data.troubleSpots as spot (spot.fromFen + spot.san)}
						<li class="trouble-item">
							<span class="trouble-move">{spot.san}</span>
							<span class="trouble-fen">{spot.fromFen.split(' ')[0].slice(0, 20)}…</span>
							<span class="trouble-lapses">{spot.lapses} lapses</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}

<style>
	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-display);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	/* ── Widget Grid ──────────────────────────────────────────────────── */

	.widget-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: var(--space-3);
		max-width: 720px;
	}

	.widget {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-surface);
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		transition: border-color var(--dur-base) var(--ease-snap),
			box-shadow var(--dur-base) var(--ease-snap);
	}

	.widget-wide {
		grid-column: 1 / -1;
	}

	.widget-link {
		text-decoration: none;
		color: inherit;
		cursor: pointer;
	}

	.widget-link:hover {
		border-color: var(--color-gold-dim);
		box-shadow: var(--shadow-gold);
	}

	.widget-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.widget-value {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--color-text-primary);
		line-height: 1.2;
	}

	.widget-denom {
		font-size: 1rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.widget-unit {
		font-size: 1rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.widget-hint {
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.widget-empty {
		margin: var(--space-1) 0 0;
		color: var(--color-text-muted);
		font-size: 13px;
	}

	/* ── Due Now accent ───────────────────────────────────────────────── */

	.due-positive {
		color: var(--color-gold);
	}

	/* ── Mastered accent ──────────────────────────────────────────────── */

	.mastered-value {
		color: var(--color-success);
	}

	/* ── Streak accent ────────────────────────────────────────────────── */

	.streak-value {
		color: var(--color-gold-dim);
	}

	/* ── Next Review accent ───────────────────────────────────────────── */

	.next-value {
		color: var(--color-text-secondary);
	}

	/* ── Card State Breakdown ─────────────────────────────────────────── */

	.state-bar {
		display: flex;
		height: 20px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-top: var(--space-2);
	}

	.state-segment {
		min-width: 4px;
		transition: width var(--dur-slow);
	}

	.state-new {
		background: #7aa2f7;
	}

	.state-learning {
		background: var(--color-gold-dim);
	}

	.state-review {
		background: var(--color-success);
	}

	.state-relearning {
		background: var(--color-danger);
	}

	.state-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* ── Shared legend dots ───────────────────────────────────────────── */

	.legend-item {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.legend-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}

	/* ── Accuracy Trend ───────────────────────────────────────────────── */

	.trend-row {
		display: flex;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}

	.trend-block {
		width: 28px;
		height: 28px;
		border-radius: 3px;
	}

	.acc-green {
		background: var(--color-success);
	}

	.acc-yellow {
		background: var(--color-gold-dim);
	}

	.acc-red {
		background: var(--color-danger);
	}

	.trend-legend {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-2);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* ── Gap Finder ───────────────────────────────────────────────────── */

	.gap-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		border-radius: 10px;
		background: var(--color-gold);
		color: var(--color-base);
		font-weight: 700;
		font-size: 11px;
		padding: 0 5px;
	}

	.gap-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.gap-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.gap-line {
		color: var(--color-text-secondary);
	}

	.gap-link {
		color: var(--color-gold);
		text-decoration: none;
		font-size: 12px;
		white-space: nowrap;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.gap-link:hover {
		color: var(--color-text-primary);
	}

	.gap-more {
		margin: var(--space-2) 0 0;
		color: var(--color-text-muted);
		font-size: 12px;
	}

	.gap-covered p {
		margin: var(--space-1) 0 0;
		color: var(--color-success);
		font-size: 13px;
	}

	/* ── Trouble Spots ────────────────────────────────────────────────── */

	.trouble-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.trouble-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		font-size: 13px;
	}

	.trouble-move {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.trouble-fen {
		color: var(--color-text-muted);
		font-size: 11px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trouble-lapses {
		color: var(--color-danger);
		font-size: 12px;
		white-space: nowrap;
	}
</style>
