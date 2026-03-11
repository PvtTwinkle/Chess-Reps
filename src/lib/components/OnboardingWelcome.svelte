<!--
	OnboardingWelcome.svelte
	────────────────────────
	Shown on the dashboard when the user has no repertoires yet.

	Responsibilities:
	  1. Welcome the user and orient them to what the app does.
	  2. Briefly explain the two main modes: Build and Drill.
	  3. Provide a simple "Create your first repertoire" form.
	  4. After a successful create, call invalidateAll() so the layout
	     re-fetches the repertoire list. The parent page will then see
	     repertoires.length > 0 and swap this screen for the dashboard.

	This component is self-contained — it manages its own form state and
	talks directly to the API, just as RepertoireSelector does.
-->

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { base } from '$app/paths';

	// ── Form state ──────────────────────────────────────────────────────────────
	let name = $state('');
	let color = $state<'WHITE' | 'BLACK'>('WHITE');
	let busy = $state(false);
	let errorMsg = $state('');

	// ── Create the first repertoire ─────────────────────────────────────────────
	async function createRepertoire() {
		if (!name.trim() || busy) return;
		busy = true;
		errorMsg = '';

		// Step 1: Create the repertoire
		const res = await fetch('/api/repertoires', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: name.trim(), color })
		});

		if (!res.ok) {
			errorMsg = 'Something went wrong. Please try again.';
			busy = false;
			return;
		}

		const created = await res.json();

		// Step 2: Set it as the active repertoire so you land on it immediately
		await fetch('/api/repertoires/active', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: created.id })
		});

		// Step 3: Re-run all load functions. The layout will re-fetch repertoires,
		// the count will be 1, and the parent page will hide this welcome screen.
		await invalidateAll();
	}
</script>

<div class="welcome-wrap">
	<div class="welcome-card">
		<!-- Header -->
		<div class="welcome-header">
			<svg class="chess-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M19 22H5v-2h14v2M13 2c-1.25 0-2.42.62-3.11 1.66L7 8l2 2 2.1-2.81a1 1 0 0 1 1.34-.28c.48.3.63.94.33 1.42L10.5 12H7.5c-.28 0-.5.22-.5.5v2c0 .28.22.5.5.5h5.1l-1.1 5h3l1.5-5.34c.5-1.76.16-3.62-.9-5.16l.9-1.5c1 .75 1.6 1.94 1.6 3.2V14h2V11.3c0-2.35-1.1-4.55-2.94-5.97L18 3.66C17.03 2.63 15.58 2 14 2h-1Z"
				/>
			</svg>
			<h1 class="welcome-title">Welcome to Chessstack</h1>
			<p class="welcome-subtitle">
				Your personal chess opening trainer. Build your repertoire once, drill it forever.
			</p>
		</div>

		<!-- Mode explanations -->
		<div class="modes-row">
			<div class="mode-card">
				<div class="mode-icon">⚒</div>
				<h2 class="mode-name">Build Mode</h2>
				<p class="mode-desc">
					Play out moves on an interactive board to build your opening repertoire. The app suggests
					known book moves and Stockfish engine recommendations at every step. You choose one
					response for your turns and select which opponent lines to prepare for.
				</p>
				<a href="{base}/build" class="mode-link">Go to Build →</a>
			</div>

			<div class="mode-card">
				<div class="mode-icon">🎯</div>
				<h2 class="mode-name">Drill Mode</h2>
				<p class="mode-desc">
					The app uses spaced repetition (the same algorithm behind Anki) to surface positions you
					are likely to forget. You play through each line from move 1 for context, grade yourself,
					and the algorithm schedules the next review automatically.
				</p>
				<a href="{base}/drill" class="mode-link">Go to Drill →</a>
			</div>
		</div>

		<!-- Create form -->
		<div class="create-section">
			<h2 class="create-heading">Create your first repertoire</h2>
			<p class="create-hint">
				A repertoire is a named collection of opening lines. Most players start with one for each
				side they play — for example "White — e4 lines" and "Black vs d4".
			</p>

			<div class="form-group">
				<label class="field-label" for="rep-name">Repertoire name</label>
				<input
					id="rep-name"
					class="text-input"
					type="text"
					placeholder="e.g. White — e4 lines"
					bind:value={name}
					onkeydown={(e) => {
						if (e.key === 'Enter') createRepertoire();
					}}
					disabled={busy}
				/>
			</div>

			<div class="form-group">
				<span class="field-label">I am playing as</span>
				<div class="color-row">
					<label class="color-label" class:selected={color === 'WHITE'}>
						<input type="radio" name="color" value="WHITE" bind:group={color} disabled={busy} />
						<span class="color-opt"><span class="color-dot color-dot--white"></span> White</span>
					</label>
					<label class="color-label" class:selected={color === 'BLACK'}>
						<input type="radio" name="color" value="BLACK" bind:group={color} disabled={busy} />
						<span class="color-opt"><span class="color-dot color-dot--black"></span> Black</span>
					</label>
				</div>
			</div>

			{#if errorMsg}
				<p class="error-msg">{errorMsg}</p>
			{/if}

			<button class="btn-create" onclick={createRepertoire} disabled={!name.trim() || busy}>
				{busy ? 'Creating…' : 'Create Repertoire'}
			</button>
		</div>
	</div>
</div>

<style>
	/* ── Outer wrapper ─────────────────────────────────────────────────────── */

	.welcome-wrap {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: var(--space-8) var(--space-4);
	}

	.welcome-card {
		width: 100%;
		max-width: 780px;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	/* ── Header block ───────────────────────────────────────────────────────── */

	.welcome-header {
		text-align: center;
	}

	.chess-icon {
		display: block;
		width: 48px;
		height: 48px;
		margin: 0 auto var(--space-4);
		color: var(--color-accent);
	}

	.welcome-title {
		margin: 0 0 var(--space-2);
		font-family: var(--font-body);
		font-size: 1.8rem;
		color: var(--color-text-primary);
	}

	.welcome-subtitle {
		margin: 0;
		font-size: 14px;
		color: var(--color-text-secondary);
		line-height: 1.6;
	}

	/* ── Mode cards row ─────────────────────────────────────────────────────── */

	.modes-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	@media (max-width: 560px) {
		.modes-row {
			grid-template-columns: 1fr;
		}
	}

	.mode-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6) var(--space-6) var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		box-shadow: var(--shadow-surface);
		transition:
			border-color var(--dur-base) var(--ease-snap),
			box-shadow var(--dur-base) var(--ease-snap);
	}

	.mode-card:hover {
		border-color: var(--color-accent);
		box-shadow: var(--glow-accent);
	}

	.mode-icon {
		font-size: 1.5rem;
		line-height: 1;
	}

	.mode-name {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.1rem;
		color: var(--color-accent);
	}

	.mode-desc {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.6;
		flex: 1;
	}

	.mode-link {
		font-size: 12px;
		color: var(--color-accent-dim);
		text-decoration: none;
		margin-top: var(--space-1);
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.mode-link:hover {
		color: var(--color-accent);
	}

	/* ── Create section ─────────────────────────────────────────────────────── */

	.create-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		box-shadow: var(--shadow-surface);
	}

	.create-heading {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.1rem;
		color: var(--color-text-primary);
	}

	.create-hint {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-muted);
		line-height: 1.6;
	}

	/* ── Form fields ────────────────────────────────────────────────────────── */

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.field-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.text-input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 14px;
		box-sizing: border-box;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.text-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.text-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.color-row {
		display: flex;
		gap: var(--space-4);
	}

	.color-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		font-size: 14px;
		color: var(--color-text-secondary);
		padding: var(--space-2) var(--space-3);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.color-label.selected {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.color-label input[type='radio'] {
		accent-color: var(--color-accent);
		cursor: pointer;
	}

	.color-opt {
		user-select: none;
	}

	/* ── Error message ──────────────────────────────────────────────────────── */

	.error-msg {
		margin: 0;
		font-size: 13px;
		color: var(--color-danger);
	}

	/* ── Create button ──────────────────────────────────────────────────────── */

	.btn-create {
		align-self: flex-start;
		padding: var(--space-3) var(--space-6);
		background: var(--color-accent);
		border: none;
		border-radius: var(--radius-md);
		color: var(--color-base);
		font-family: var(--font-body);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--color-accent);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.btn-create:hover:not(:disabled) {
		border-color: var(--color-border-strong);
		box-shadow: var(--glow-accent);
	}

	.btn-create:active:not(:disabled) {
		transform: scale(0.97);
	}

	.btn-create:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
