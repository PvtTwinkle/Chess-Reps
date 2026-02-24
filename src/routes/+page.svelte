<script lang="ts">
	import type { PageData } from './$types';
	import OnboardingWelcome from '$lib/components/OnboardingWelcome.svelte';

	// `data` comes from +page.server.ts, which calls parent() to get the
	// repertoires list from the layout without a second database query.
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
	<p class="placeholder">Your stats and review history will appear here. Coming soon.</p>
{/if}

<style>
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		color: #f0f0f0;
	}

	.placeholder {
		color: #606070;
		font-size: 0.95rem;
	}
</style>
