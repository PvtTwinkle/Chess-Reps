<script lang="ts">
	// `form` is automatically populated by SvelteKit after a form action runs.
	// If the login fails, the action returns { error: '...' } via fail(),
	// and SvelteKit puts that in `form` so we can display the error message.
	import type { ActionData, PageData } from './$types';
	import { base } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<svelte:head>
	<title>Sign In — Chessstack</title>
</svelte:head>

<div class="login-page">
	<div class="login-card">
		<div class="logo">
			<img class="logo-icon" src={favicon} alt="Chessstack logo" />
			<span class="logo-text">Chessstack</span>
		</div>
		<h1>Sign in</h1>

		<!--
			method="POST" — submits to the default action in +page.server.ts.
			No JavaScript required — the form works as plain HTML.
		-->
		<form method="POST">
			{#if form?.error}
				<p class="error" role="alert">{form.error}</p>
			{/if}

			<div class="field">
				<label for="username">Username</label>
				<input id="username" type="text" name="username" required autocomplete="username" />
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					type="password"
					name="password"
					required
					autocomplete="current-password"
				/>
			</div>

			<button type="submit">Sign in</button>
		</form>

		{#if data.registrationOpen}
			<p class="register-link">No account? <a href="{base}/register">Create one</a></p>
		{/if}
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-base);
	}

	.login-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-10);
		width: 100%;
		max-width: 380px;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.logo-icon {
		width: 32px;
		height: 32px;
	}

	.logo-text {
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	h1 {
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0 0 var(--space-8) 0;
		color: var(--color-text-secondary);
	}

	.field {
		margin-bottom: var(--space-5);
	}

	label {
		display: block;
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}

	input {
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 14px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.error {
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid rgba(248, 113, 113, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-danger);
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		margin-bottom: var(--space-4);
	}

	button {
		width: 100%;
		padding: var(--space-3);
		background: var(--color-accent);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		margin-top: var(--space-2);
		transition:
			filter var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	button:hover {
		box-shadow: var(--glow-accent);
		filter: brightness(1.1);
	}

	button:active {
		transform: scale(0.97);
	}

	.register-link {
		text-align: center;
		margin-top: var(--space-6);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.register-link a {
		color: var(--color-accent);
		text-decoration: none;
	}

	.register-link a:hover {
		text-decoration: underline;
	}
</style>
