<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { base } from '$app/paths';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import RepertoireSelector from '$lib/components/RepertoireSelector.svelte';

	// `data` comes from +layout.server.ts and includes `user`, `repertoires`,
	// and `activeRepertoireId`.
	// `children` is the content of the current page — rendered with {@render children()}.
	let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!--
	Only show the nav bar when the user is logged in.
	On the /login page, data.user is null so the nav is hidden.
-->
{#if data.user}
	<header class="app-header">
		<a href="{base}/" class="brand">♟ Chess Reps</a>

		<nav class="nav-links">
			<a href="{base}/">Dashboard</a>
			<a href="{base}/build">Build</a>
			<a href="{base}/drill">Drill</a>
<a href="{base}/review">Review</a>
			<a href="{base}/settings">Settings</a>
		</nav>

		<!--
			The repertoire selector lives between the nav links and the sign-out area.
			It passes the full list and the active ID down to the component so it can
			render the current selection and offer switching/management.
		-->
		<RepertoireSelector
			repertoires={data.repertoires}
			activeRepertoireId={data.activeRepertoireId}
		/>

		<!--
			Sign-out is a POST form, not a link.
			This prevents other websites from logging you out with a crafted URL.
		-->
		<form method="POST" action="/api/auth/logout" class="signout-form">
			<span class="username">{data.user.username}</span>
			<button type="submit" class="signout-btn">Sign out</button>
		</form>
	</header>
{/if}

<main class="app-main">
	{@render children()}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		background: #1a1a2e;
		color: #e0e0e0;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	.app-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0 1.5rem;
		height: 52px;
		background: #16213e;
		border-bottom: 1px solid #0f3460;
	}

	.brand {
		font-weight: 700;
		font-size: 1.1rem;
		color: #e2b714;
		text-decoration: none;
		white-space: nowrap;
	}

	.nav-links {
		display: flex;
		gap: 0.25rem;
		flex: 1;
	}

	.nav-links a {
		color: #a0a0b0;
		text-decoration: none;
		padding: 0.3rem 0.6rem;
		border-radius: 4px;
		font-size: 0.9rem;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.nav-links a:hover {
		color: #f0f0f0;
		background: #0f3460;
	}

	.signout-form {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.username {
		font-size: 0.875rem;
		color: #707080;
	}

	.signout-btn {
		padding: 0.3rem 0.75rem;
		background: transparent;
		border: 1px solid #0f3460;
		border-radius: 4px;
		color: #a0a0b0;
		font-size: 0.875rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.signout-btn:hover {
		border-color: #e2b714;
		color: #e2b714;
	}

	.app-main {
		padding: 1.5rem;
	}
</style>
