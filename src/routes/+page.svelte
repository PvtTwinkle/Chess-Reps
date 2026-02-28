<script lang="ts">
	import type { PageData } from './$types';
	import OnboardingWelcome from '$lib/components/OnboardingWelcome.svelte';
	import { formatLine } from '$lib/gaps';
	import { base } from '$app/paths';

	let { data }: { data: PageData } = $props();
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

	{#if data.gaps.length > 0}
		<section class="gap-widget">
			<header class="gap-header">
				<span class="gap-icon">!</span>
				<span
					>{data.gaps.length} gap{data.gaps.length === 1 ? '' : 's'} found in your repertoire</span
				>
			</header>
			<ul class="gap-list">
				{#each data.gaps.slice(0, 5) as gap (gap.toFen)}
					<li class="gap-item">
						<span class="gap-line">{formatLine(gap.line)}</span>
						<a href="{base}/build?line={encodeURIComponent(gap.line)}" class="gap-link">
							Open in Build Mode
						</a>
					</li>
				{/each}
			</ul>
			{#if data.gaps.length > 5}
				<p class="gap-more">+ {data.gaps.length - 5} more</p>
			{/if}
		</section>
	{:else}
		<section class="gap-widget gap-covered">
			<p>No gaps — repertoire fully covered</p>
		</section>
	{/if}
{/if}

<style>
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		color: #f0f0f0;
	}

	.gap-widget {
		background: #1e1e2e;
		border: 1px solid #2a2a3c;
		border-radius: 8px;
		padding: 1rem;
		margin-top: 1rem;
		max-width: 600px;
	}

	.gap-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
		color: #e0e0e0;
		margin-bottom: 0.75rem;
	}

	.gap-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #d4a017;
		color: #1e1e2e;
		font-weight: 700;
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.gap-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.gap-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.6rem;
		background: #252536;
		border-radius: 4px;
		font-size: 0.9rem;
	}

	.gap-line {
		color: #c0c0d0;
		font-family: monospace;
	}

	.gap-link {
		color: #7aa2f7;
		text-decoration: none;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.gap-link:hover {
		text-decoration: underline;
	}

	.gap-more {
		margin: 0.5rem 0 0;
		color: #606070;
		font-size: 0.85rem;
	}

	.gap-covered p {
		margin: 0;
		color: #50c878;
		font-size: 0.95rem;
	}
</style>
