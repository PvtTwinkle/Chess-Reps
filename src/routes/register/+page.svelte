<script lang="ts">
	import type { ActionData } from './$types';
	import { base } from '$app/paths';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Create Account — Chess Reps</title>
</svelte:head>

<div class="register-page">
	<div class="register-card">
		<div class="logo">
			<svg class="logo-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M19 22H5v-2h14v2M13 2c-1.25 0-2.42.62-3.11 1.66L7 8l2 2 2.1-2.81a1 1 0 0 1 1.34-.28c.48.3.63.94.33 1.42L10.5 12H7.5c-.28 0-.5.22-.5.5v2c0 .28.22.5.5.5h5.1l-1.1 5h3l1.5-5.34c.5-1.76.16-3.62-.9-5.16l.9-1.5c1 .75 1.6 1.94 1.6 3.2V14h2V11.3c0-2.35-1.1-4.55-2.94-5.97L18 3.66C17.03 2.63 15.58 2 14 2h-1Z"
				/>
			</svg>
			<span class="logo-text">Chess Reps</span>
		</div>
		<h1>Create account</h1>

		<form method="POST">
			{#if form?.error}
				<p class="error" role="alert">{form.error}</p>
			{/if}

			<div class="field">
				<label for="username">Username</label>
				<input
					id="username"
					type="text"
					name="username"
					required
					minlength="3"
					maxlength="30"
					pattern="[a-zA-Z0-9_-]+"
					autocomplete="username"
				/>
				<span class="hint">3–30 characters. Letters, numbers, hyphens, underscores.</span>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<input
					id="password"
					type="password"
					name="password"
					required
					minlength="8"
					autocomplete="new-password"
				/>
				<span class="hint">At least 8 characters.</span>
			</div>

			<div class="field">
				<label for="confirmPassword">Confirm password</label>
				<input
					id="confirmPassword"
					type="password"
					name="confirmPassword"
					required
					minlength="8"
					autocomplete="new-password"
				/>
			</div>

			<button type="submit">Create account</button>
		</form>

		<p class="signin-link">Already have an account? <a href="{base}/login">Sign in</a></p>
	</div>
</div>

<style>
	.register-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-base);
	}

	.register-card {
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
		width: 28px;
		height: 28px;
		color: var(--color-gold);
	}

	.logo-text {
		font-family: var(--font-display);
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
		border-color: var(--color-gold);
		box-shadow: 0 0 0 3px var(--color-gold-glow);
	}

	.hint {
		display: block;
		font-size: 11px;
		color: var(--color-text-muted);
		margin-top: var(--space-1);
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
		background: var(--color-gold);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		margin-top: var(--space-2);
		transition:
			box-shadow var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	button:hover {
		box-shadow: var(--glow-gold);
	}

	button:active {
		transform: scale(0.97);
	}

	.signin-link {
		text-align: center;
		margin-top: var(--space-6);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.signin-link a {
		color: var(--color-gold);
		text-decoration: none;
	}

	.signin-link a:hover {
		text-decoration: underline;
	}
</style>
