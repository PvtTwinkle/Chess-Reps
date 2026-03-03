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
		margin: 0 0 0.75rem;
		font-size: 1.5rem;
		color: #f0f0f0;
	}

	/* ── Widget Grid ──────────────────────────────────────────────────── */

	.widget-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 0.75rem;
		max-width: 720px;
	}

	.widget {
		background: #1e1e2e;
		border: 1px solid #2a2a3c;
		border-radius: 8px;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.widget-wide {
		grid-column: 1 / -1;
	}

	.widget-link {
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.widget-link:hover {
		border-color: #7aa2f7;
	}

	.widget-label {
		font-size: 0.8rem;
		color: #808090;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.widget-value {
		font-size: 1.8rem;
		font-weight: 700;
		color: #e0e0e0;
		line-height: 1.2;
	}

	.widget-denom {
		font-size: 1rem;
		font-weight: 400;
		color: #606070;
	}

	.widget-unit {
		font-size: 1rem;
		font-weight: 400;
		color: #808090;
	}

	.widget-hint {
		font-size: 0.78rem;
		color: #606070;
	}

	.widget-empty {
		margin: 0.25rem 0 0;
		color: #606070;
		font-size: 0.85rem;
	}

	/* ── Due Now accent ───────────────────────────────────────────────── */

	.due-positive {
		color: #f7768e;
	}

	/* ── Mastered accent ──────────────────────────────────────────────── */

	.mastered-value {
		color: #50c878;
	}

	/* ── Streak accent ────────────────────────────────────────────────── */

	.streak-value {
		color: #ff9e64;
	}

	/* ── Next Review accent ───────────────────────────────────────────── */

	.next-value {
		color: #7aa2f7;
	}

	/* ── Card State Breakdown ─────────────────────────────────────────── */

	.state-bar {
		display: flex;
		height: 20px;
		border-radius: 4px;
		overflow: hidden;
		margin-top: 0.35rem;
	}

	.state-segment {
		min-width: 4px;
		transition: width 0.3s;
	}

	.state-new {
		background: #7aa2f7;
	}

	.state-learning {
		background: #ff9e64;
	}

	.state-review {
		background: #50c878;
	}

	.state-relearning {
		background: #f7768e;
	}

	.state-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.4rem;
		font-size: 0.78rem;
		color: #a0a0b0;
	}

	/* ── Shared legend dots ───────────────────────────────────────────── */

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
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
		gap: 4px;
		margin-top: 0.35rem;
	}

	.trend-block {
		width: 28px;
		height: 28px;
		border-radius: 3px;
	}

	.acc-green {
		background: #50c878;
	}

	.acc-yellow {
		background: #e0af68;
	}

	.acc-red {
		background: #f7768e;
	}

	.trend-legend {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.4rem;
		font-size: 0.78rem;
		color: #a0a0b0;
	}

	/* ── Gap Finder ───────────────────────────────────────────────────── */

	.gap-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		border-radius: 10px;
		background: #d4a017;
		color: #1e1e2e;
		font-weight: 700;
		font-size: 0.75rem;
		padding: 0 5px;
	}

	.gap-list {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.gap-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.35rem 0.5rem;
		background: #252536;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.gap-line {
		color: #c0c0d0;
		font-family: monospace;
	}

	.gap-link {
		color: #7aa2f7;
		text-decoration: none;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.gap-link:hover {
		text-decoration: underline;
	}

	.gap-more {
		margin: 0.4rem 0 0;
		color: #606070;
		font-size: 0.8rem;
	}

	.gap-covered p {
		margin: 0.25rem 0 0;
		color: #50c878;
		font-size: 0.9rem;
	}

	/* ── Trouble Spots ────────────────────────────────────────────────── */

	.trouble-list {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.trouble-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		background: #252536;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.trouble-move {
		color: #f0f0f0;
		font-family: monospace;
		font-weight: 600;
	}

	.trouble-fen {
		color: #606070;
		font-family: monospace;
		font-size: 0.75rem;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trouble-lapses {
		color: #f7768e;
		font-size: 0.8rem;
		white-space: nowrap;
	}
</style>
