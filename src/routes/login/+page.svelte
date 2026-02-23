<script lang="ts">
	// `form` is automatically populated by SvelteKit after a form action runs.
	// If the login fails, the action returns { error: '...' } via fail(),
	// and SvelteKit puts that in `form` so we can display the error message.
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign In — Chess Reps</title>
</svelte:head>

<div class="login-page">
	<div class="login-card">
		<div class="logo">♟ Chess Reps</div>
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
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}

	.login-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1a1a2e;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
	}

	.login-card {
		background: #16213e;
		border: 1px solid #0f3460;
		border-radius: 8px;
		padding: 2.5rem;
		width: 100%;
		max-width: 360px;
		color: #e0e0e0;
	}

	.logo {
		font-size: 1.5rem;
		font-weight: 700;
		color: #e2b714;
		margin-bottom: 0.5rem;
	}

	h1 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0 0 1.5rem 0;
		color: #f0f0f0;
	}

	.field {
		margin-bottom: 1rem;
	}

	label {
		display: block;
		font-size: 0.875rem;
		color: #a0a0b0;
		margin-bottom: 0.35rem;
	}

	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		background: #0f3460;
		border: 1px solid #1a4a8a;
		border-radius: 4px;
		color: #f0f0f0;
		font-size: 1rem;
	}

	input:focus {
		outline: 2px solid #e2b714;
		outline-offset: 1px;
	}

	.error {
		background: #4a1a1a;
		border: 1px solid #8a2020;
		border-radius: 4px;
		color: #ff8080;
		padding: 0.6rem 0.75rem;
		font-size: 0.875rem;
		margin-bottom: 1rem;
	}

	button {
		width: 100%;
		padding: 0.7rem;
		background: #e2b714;
		color: #1a1a2e;
		border: none;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.5rem;
	}

	button:hover {
		background: #f0c820;
	}
</style>
