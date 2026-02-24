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
			<span class="chess-icon">♟</span>
			<h1 class="welcome-title">Welcome to Chess Reps</h1>
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
						<span class="color-opt">♙ White</span>
					</label>
					<label class="color-label" class:selected={color === 'BLACK'}>
						<input type="radio" name="color" value="BLACK" bind:group={color} disabled={busy} />
						<span class="color-opt">♟ Black</span>
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
	/* ── Outer wrapper — centres the card vertically in the page ────────────── */

	.welcome-wrap {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 2rem 1rem;
	}

	.welcome-card {
		width: 100%;
		max-width: 780px;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	/* ── Header block ───────────────────────────────────────────────────────── */

	.welcome-header {
		text-align: center;
	}

	.chess-icon {
		display: block;
		font-size: 3rem;
		line-height: 1;
		margin-bottom: 0.75rem;
		color: #e2b714;
	}

	.welcome-title {
		margin: 0 0 0.5rem;
		font-size: 1.8rem;
		font-weight: 700;
		color: #f0f0f0;
	}

	.welcome-subtitle {
		margin: 0;
		font-size: 1rem;
		color: #909098;
		line-height: 1.5;
	}

	/* ── Mode cards row ─────────────────────────────────────────────────────── */

	.modes-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 560px) {
		.modes-row {
			grid-template-columns: 1fr;
		}
	}

	.mode-card {
		background: #16213e;
		border: 1px solid #0f3460;
		border-radius: 8px;
		padding: 1.25rem 1.25rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.mode-icon {
		font-size: 1.5rem;
		line-height: 1;
	}

	.mode-name {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: #e2b714;
	}

	.mode-desc {
		margin: 0;
		font-size: 0.875rem;
		color: #a0a0b0;
		line-height: 1.55;
		flex: 1;
	}

	.mode-link {
		font-size: 0.8rem;
		color: #4a7ab0;
		text-decoration: none;
		margin-top: 0.25rem;
		transition: color 0.15s;
	}

	.mode-link:hover {
		color: #6a9ad0;
	}

	/* ── Create section ─────────────────────────────────────────────────────── */

	.create-section {
		background: #16213e;
		border: 1px solid #0f3460;
		border-radius: 8px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.create-heading {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: #f0f0f0;
	}

	.create-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #707080;
		line-height: 1.5;
	}

	/* ── Form fields ────────────────────────────────────────────────────────── */

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.field-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #a0a0b0;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.text-input {
		width: 100%;
		padding: 0.55rem 0.7rem;
		background: #0a1828;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #e0e0e0;
		font-size: 0.95rem;
		box-sizing: border-box;
		transition: border-color 0.15s;
	}

	.text-input:focus {
		outline: none;
		border-color: #e2b714;
	}

	.text-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.color-row {
		display: flex;
		gap: 1.5rem;
	}

	.color-label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
		font-size: 0.95rem;
		color: #c0c0d0;
		padding: 0.35rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 4px;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.color-label.selected {
		border-color: #e2b714;
		color: #e2b714;
	}

	.color-label input[type='radio'] {
		accent-color: #e2b714;
		cursor: pointer;
	}

	.color-opt {
		user-select: none;
	}

	/* ── Error message ──────────────────────────────────────────────────────── */

	.error-msg {
		margin: 0;
		font-size: 0.85rem;
		color: #e06060;
	}

	/* ── Create button ──────────────────────────────────────────────────────── */

	.btn-create {
		align-self: flex-start;
		padding: 0.6rem 1.4rem;
		background: #e2b714;
		border: none;
		border-radius: 4px;
		color: #1a1a2e;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-create:hover:not(:disabled) {
		opacity: 0.88;
	}

	.btn-create:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
