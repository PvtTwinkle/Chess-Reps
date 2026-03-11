<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll, goto } from '$app/navigation';
	import { resolveRoute } from '$app/paths';
	import { onDestroy } from 'svelte';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { tutorialStep } from '$lib/stores/tutorial';

	let { data }: { data: PageData } = $props();

	// Timer cleanup — track all setTimeout IDs so we can clear them on unmount.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive, used only for cleanup
	const timers = new Set<ReturnType<typeof setTimeout>>();
	function safeTimeout(fn: () => void, ms: number) {
		const id = setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	}

	onDestroy(() => {
		clearTimeout(depthTimeout);
		clearTimeout(timeoutDebounce);
		clearTimeout(tempoDebounce);
		for (const id of timers) clearTimeout(id);
		timers.clear();
	});

	// ── App Theme (dark / light) ────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-writable-derived
	let appTheme = $state('dark');

	$effect(() => {
		appTheme = data.settings?.appTheme ?? 'dark';
	});

	async function setAppTheme(mode: string) {
		appTheme = mode;
		// Instant visual feedback — don't wait for the server round-trip
		document.documentElement.dataset.theme = mode;
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appTheme: mode })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
		} catch {
			// Revert on failure
			const prev = mode === 'dark' ? 'light' : 'dark';
			appTheme = prev;
			document.documentElement.dataset.theme = prev;
		}
	}

	// ── Board Theme ─────────────────────────────────────────────────────────
	const THEMES = [
		{ name: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863' },
		{ name: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
		{ name: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
		{ name: 'purple', label: 'Purple', light: '#e8dff5', dark: '#7b61a6' },
		{ name: 'grey', label: 'Grey', light: '#cccccc', dark: '#888888' }
	];

	// These settings are locally writable (optimistic UI) but sync from server data.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let selectedTheme = $state('blue');
	let themeStatus = $state('');

	$effect(() => {
		selectedTheme = data.settings?.boardTheme ?? 'blue';
	});

	async function setTheme(name: string) {
		selectedTheme = name;
		themeStatus = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ boardTheme: name })
			});
			if (!res.ok) throw new Error('Failed to save');
			// Refresh layout data so other pages pick up the new theme
			await invalidateAll();
			themeStatus = 'Saved';
			safeTimeout(() => (themeStatus = ''), 2000);
		} catch {
			themeStatus = 'Error saving';
		}
	}

	// ── Sound ───────────────────────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-writable-derived
	let soundEnabled = $state(true);

	$effect(() => {
		soundEnabled = data.settings?.soundEnabled ?? true;
	});

	async function toggleSound() {
		soundEnabled = !soundEnabled;
		try {
			await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ soundEnabled })
			});
			await invalidateAll();
		} catch {
			// Revert on failure
			soundEnabled = !soundEnabled;
		}
	}

	// ── Stockfish Depth ─────────────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-writable-derived
	let stockfishDepth = $state(15);
	let depthStatus = $state('');
	let depthTimeout: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		stockfishDepth = data.settings?.stockfishDepth ?? 15;
	});

	function handleDepthChange(e: Event) {
		const value = parseInt((e.target as HTMLInputElement).value);
		stockfishDepth = value;
		// Debounce: save after the user stops dragging
		clearTimeout(depthTimeout);
		depthTimeout = setTimeout(() => saveDepth(value), 400);
	}

	async function saveDepth(value: number) {
		depthStatus = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stockfishDepth: value })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
			depthStatus = 'Saved';
			safeTimeout(() => (depthStatus = ''), 2000);
		} catch {
			depthStatus = 'Error saving';
		}
	}

	// ── Stockfish Timeout ───────────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-writable-derived
	let stockfishTimeout = $state(10);
	let timeoutStatus = $state('');
	let timeoutDebounce: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		stockfishTimeout = data.settings?.stockfishTimeout ?? 10;
	});

	function handleTimeoutChange(e: Event) {
		const value = parseInt((e.target as HTMLInputElement).value);
		stockfishTimeout = value;
		clearTimeout(timeoutDebounce);
		timeoutDebounce = setTimeout(() => saveTimeout(value), 400);
	}

	async function saveTimeout(value: number) {
		timeoutStatus = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stockfishTimeout: value })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
			timeoutStatus = 'Saved';
			safeTimeout(() => (timeoutStatus = ''), 2000);
		} catch {
			timeoutStatus = 'Error saving';
		}
	}

	// ── Tempo Training ─────────────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-writable-derived
	let tempoEnabled = $state(false);
	// eslint-disable-next-line svelte/prefer-writable-derived
	let tempoSeconds = $state(10);
	let tempoStatus = $state('');
	let tempoDebounce: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		tempoEnabled = data.settings?.tempoEnabled ?? false;
	});

	$effect(() => {
		tempoSeconds = data.settings?.tempoSeconds ?? 10;
	});

	async function toggleTempo() {
		tempoEnabled = !tempoEnabled;
		try {
			await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tempoEnabled })
			});
			await invalidateAll();
		} catch {
			tempoEnabled = !tempoEnabled;
		}
	}

	function handleTempoSecondsChange(e: Event) {
		const value = parseInt((e.target as HTMLInputElement).value);
		tempoSeconds = value;
		clearTimeout(tempoDebounce);
		tempoDebounce = setTimeout(() => saveTempoSeconds(value), 400);
	}

	async function saveTempoSeconds(value: number) {
		tempoStatus = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tempoSeconds: value })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
			tempoStatus = 'Saved';
			safeTimeout(() => (tempoStatus = ''), 2000);
		} catch {
			tempoStatus = 'Error saving';
		}
	}

	// ── Game Import Accounts ────────────────────────────────────────────────
	// eslint-disable-next-line svelte/prefer-writable-derived
	let lichessUsername = $state('');
	let lichessStatus = $state('');
	let savingLichess = $state(false);

	// eslint-disable-next-line svelte/prefer-writable-derived
	let chesscomUsername = $state('');
	let chesscomStatus = $state('');
	let savingChesscom = $state(false);

	$effect(() => {
		lichessUsername = data.settings?.lichessUsername ?? '';
	});

	$effect(() => {
		chesscomUsername = data.settings?.chesscomUsername ?? '';
	});

	async function saveLichessUsername() {
		savingLichess = true;
		lichessStatus = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ lichessUsername: lichessUsername || null })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
			lichessStatus = 'Saved';
			safeTimeout(() => (lichessStatus = ''), 2000);
		} catch {
			lichessStatus = 'Error saving';
		} finally {
			savingLichess = false;
		}
	}

	async function saveChesscomUsername() {
		savingChesscom = true;
		chesscomStatus = '';
		try {
			const res = await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ chesscomUsername: chesscomUsername || null })
			});
			if (!res.ok) throw new Error('Failed to save');
			await invalidateAll();
			chesscomStatus = 'Saved';
			safeTimeout(() => (chesscomStatus = ''), 2000);
		} catch {
			chesscomStatus = 'Error saving';
		} finally {
			savingChesscom = false;
		}
	}

	// ── Password Change ─────────────────────────────────────────────────────
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordStatus = $state('');
	let passwordError = $state('');
	let changingPassword = $state(false);

	async function changePassword() {
		passwordError = '';
		passwordStatus = '';

		if (!currentPassword) {
			passwordError = 'Current password is required';
			return;
		}
		if (newPassword.length < 8) {
			passwordError = 'New password must be at least 8 characters';
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordError = 'New passwords do not match';
			return;
		}

		changingPassword = true;
		try {
			const res = await fetch('/api/auth/change-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				passwordError = data?.message ?? 'Failed to change password';
				return;
			}

			passwordStatus = 'Password changed successfully';
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} catch {
			passwordError = 'Network error — please try again';
		} finally {
			changingPassword = false;
		}
	}

	// ── Tutorial ──────────────────────────────────────────────────────────────
	let restartingTutorial = $state(false);

	async function restartTutorial() {
		if (restartingTutorial) return;
		restartingTutorial = true;
		await fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ tutorialStep: 1 })
		});
		await invalidateAll();
		await goto(resolveRoute('/build')); // eslint-disable-line svelte/no-navigation-without-resolve
	}
</script>

<div class="settings-page">
	<h1>Settings</h1>

	<div class="settings-content">
		<!-- ── Board Appearance ────────────────────────────────────────────── -->
		<section class="settings-section">
			<h2>Board Appearance</h2>

			<div class="setting-row">
				<span class="setting-label">App Theme</span>
				<div class="theme-mode-picker">
					<button
						class="mode-btn"
						class:selected={appTheme === 'dark'}
						onclick={() => setAppTheme('dark')}
					>
						Dark
					</button>
					<button
						class="mode-btn"
						class:selected={appTheme === 'light'}
						onclick={() => setAppTheme('light')}
					>
						Light
					</button>
				</div>
			</div>

			<div class="setting-row">
				<span class="setting-label">Board Theme</span>
				<div class="theme-picker">
					{#each THEMES as theme (theme.name)}
						<button
							class="theme-swatch"
							class:selected={selectedTheme === theme.name}
							title={theme.label}
							onclick={() => setTheme(theme.name)}
						>
							<span class="swatch-light" style="background:{theme.light}"></span>
							<span class="swatch-dark" style="background:{theme.dark}"></span>
							<span class="swatch-label">{theme.label}</span>
						</button>
					{/each}
				</div>
				{#if themeStatus}
					<span class="status-msg">{themeStatus}</span>
				{/if}
			</div>

			<!-- Board preview -->
			<div class="board-preview">
				<ChessBoard boardTheme={selectedTheme} interactive={false} />
			</div>

			<div class="setting-row">
				<span class="setting-label">Sound Effects</span>
				<button class="toggle-btn" class:active={soundEnabled} onclick={toggleSound}>
					{soundEnabled ? 'On' : 'Off'}
				</button>
			</div>
		</section>

		<!-- ── Analysis ────────────────────────────────────────────────────── -->
		<section class="settings-section">
			<h2>Analysis</h2>

			<div class="setting-row">
				<label class="setting-label" for="depth-slider">
					Stockfish Depth: <strong>{stockfishDepth}</strong>
				</label>
				<div class="slider-wrap">
					<span class="slider-label">15</span>
					<input
						id="depth-slider"
						type="range"
						min="15"
						max="30"
						step="1"
						value={stockfishDepth}
						oninput={handleDepthChange}
					/>
					<span class="slider-label">30</span>
				</div>
				<p class="setting-hint">Higher = stronger analysis but slower. 20 is a good default.</p>
				{#if depthStatus}
					<span class="status-msg">{depthStatus}</span>
				{/if}
			</div>

			<div class="setting-row">
				<label class="setting-label" for="timeout-slider">
					Analysis Timeout: <strong>{stockfishTimeout}s</strong>
				</label>
				<div class="slider-wrap">
					<span class="slider-label">3s</span>
					<input
						id="timeout-slider"
						type="range"
						min="3"
						max="30"
						step="1"
						value={stockfishTimeout}
						oninput={handleTimeoutChange}
					/>
					<span class="slider-label">30s</span>
				</div>
				<p class="setting-hint">
					Max time to wait for engine results. Increase for deeper analysis at higher depths.
				</p>
				{#if timeoutStatus}
					<span class="status-msg">{timeoutStatus}</span>
				{/if}
			</div>
		</section>

		<!-- ── Drill ───────────────────────────────────────────────────────── -->
		<section class="settings-section">
			<h2>Drill</h2>

			<div class="setting-row">
				<span class="setting-label">Tempo Training</span>
				<button class="toggle-btn" class:active={tempoEnabled} onclick={toggleTempo}>
					{tempoEnabled ? 'On' : 'Off'}
				</button>
				<p class="setting-hint">
					Set a time limit per move during drill sessions. If you don't play in time, the card is
					marked as Forgot.
				</p>
			</div>

			{#if tempoEnabled}
				<div class="setting-row">
					<label class="setting-label" for="tempo-slider">
						Time Limit: <strong>{tempoSeconds}s</strong>
					</label>
					<div class="slider-wrap">
						<span class="slider-label">3s</span>
						<input
							id="tempo-slider"
							type="range"
							min="3"
							max="30"
							step="1"
							value={tempoSeconds}
							oninput={handleTempoSecondsChange}
						/>
						<span class="slider-label">30s</span>
					</div>
					<p class="setting-hint">Seconds per move. Shorter times make drills more challenging.</p>
					{#if tempoStatus}
						<span class="status-msg">{tempoStatus}</span>
					{/if}
				</div>
			{/if}
		</section>

		<!-- ── Game Import ─────────────────────────────────────────────────── -->
		<section class="settings-section">
			<h2>Game Import</h2>

			<div class="setting-row">
				<label class="setting-label" for="lichess-username">Lichess Username</label>
				<div class="username-input-row">
					<input
						id="lichess-username"
						type="text"
						placeholder="your_lichess_username"
						bind:value={lichessUsername}
						maxlength="25"
						class="username-input"
					/>
					<button class="btn-save" onclick={saveLichessUsername} disabled={savingLichess}>
						{savingLichess ? 'Saving...' : 'Save'}
					</button>
				</div>
				<p class="setting-hint">Your Lichess username. Games must be public for import to work.</p>
				{#if lichessStatus}
					<span class="status-msg">{lichessStatus}</span>
				{/if}
			</div>

			<div class="setting-row">
				<label class="setting-label" for="chesscom-username">Chess.com Username</label>
				<div class="username-input-row">
					<input
						id="chesscom-username"
						type="text"
						placeholder="your_chesscom_username"
						bind:value={chesscomUsername}
						maxlength="25"
						class="username-input"
					/>
					<button class="btn-save" onclick={saveChesscomUsername} disabled={savingChesscom}>
						{savingChesscom ? 'Saving...' : 'Save'}
					</button>
				</div>
				<p class="setting-hint">Your Chess.com username. Only standard chess games are imported.</p>
				{#if chesscomStatus}
					<span class="status-msg">{chesscomStatus}</span>
				{/if}
			</div>
		</section>

		<!-- ── Tutorial ────────────────────────────────────────────────────── -->
		{#if $tutorialStep === null}
			<section class="settings-section">
				<h2>Tutorial</h2>

				<div class="setting-row">
					<span class="setting-label">Guided Walkthrough</span>
					<p class="setting-hint">
						Replay the first-time tutorial that walks through Build, Drill, Puzzles, and Review.
					</p>
					<button class="btn-primary" onclick={restartTutorial} disabled={restartingTutorial}>
						{restartingTutorial ? 'Restarting...' : 'Restart Tutorial'}
					</button>
				</div>
			</section>
		{/if}

		<!-- ── Account ─────────────────────────────────────────────────────── -->
		<section class="settings-section">
			<h2>Account</h2>

			<div class="setting-row">
				<span class="setting-label">Change Password</span>

				<div class="password-form">
					<input
						type="password"
						placeholder="Current password"
						autocomplete="current-password"
						bind:value={currentPassword}
					/>
					<input
						type="password"
						placeholder="New password (min 8 characters)"
						autocomplete="new-password"
						bind:value={newPassword}
					/>
					<input
						type="password"
						placeholder="Confirm new password"
						autocomplete="new-password"
						bind:value={confirmPassword}
					/>
					<button class="btn-primary" onclick={changePassword} disabled={changingPassword}>
						{changingPassword ? 'Changing...' : 'Change Password'}
					</button>
				</div>

				{#if passwordError}
					<p class="error-msg">{passwordError}</p>
				{/if}
				{#if passwordStatus}
					<p class="success-msg">{passwordStatus}</p>
				{/if}
			</div>
		</section>
	</div>
</div>

<style>
	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-body);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	h2 {
		margin: 0 0 var(--space-4);
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--space-3);
	}

	.settings-page {
		max-width: 700px;
		margin: 0 auto;
	}

	.settings-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.settings-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-surface);
		/* Isolate stacking context so Chessground's z-indexed children
		   in the board preview can't escape and overlay other sections. */
		position: relative;
		z-index: 0;
	}

	.setting-row {
		margin-bottom: var(--space-5);
	}

	.setting-row:last-child {
		margin-bottom: 0;
	}

	.setting-label {
		display: block;
		font-size: 13px;
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	.setting-hint {
		margin: var(--space-1) 0 0;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	/* ── App theme mode picker ─────────────────────────────────────── */

	.theme-mode-picker {
		display: flex;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		width: fit-content;
	}

	.mode-btn {
		padding: var(--space-2) var(--space-5);
		border: none;
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.mode-btn:not(:last-child) {
		border-right: 1px solid var(--color-border);
	}

	.mode-btn:hover:not(.selected) {
		color: var(--color-text-secondary);
	}

	.mode-btn.selected {
		background: var(--color-accent);
		color: var(--color-base);
		font-weight: 600;
	}

	/* ── Theme picker ──────────────────────────────────────────────── */

	.theme-picker {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.theme-swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2);
		background: transparent;
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.theme-swatch:hover {
		border-color: var(--color-border);
	}

	.theme-swatch.selected {
		border-color: var(--color-accent);
	}

	.swatch-light,
	.swatch-dark {
		display: block;
		width: 28px;
		height: 14px;
	}

	.swatch-light {
		border-radius: 3px 3px 0 0;
	}

	.swatch-dark {
		border-radius: 0 0 3px 3px;
	}

	.swatch-label {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	/* ── Board preview ─────────────────────────────────────────────── */

	.board-preview {
		width: 240px;
		margin: var(--space-2) 0 var(--space-4);
		overflow: hidden;
		pointer-events: none;
		position: relative;
		z-index: 0;
	}

	/* ── Toggle button ─────────────────────────────────────────────── */

	.toggle-btn {
		padding: var(--space-2) var(--space-4);
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.toggle-btn.active {
		background: rgba(74, 222, 128, 0.1);
		color: var(--color-success);
		border-color: rgba(74, 222, 128, 0.3);
	}

	/* ── Slider ────────────────────────────────────────────────────── */

	.slider-wrap {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.slider-label {
		font-size: 12px;
		color: var(--color-text-muted);
		min-width: 2em;
		text-align: center;
	}

	input[type='range'] {
		flex: 1;
		accent-color: var(--color-accent);
	}

	/* ── Username input ────────────────────────────────────────────── */

	.username-input-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		max-width: 320px;
	}

	.username-input {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.username-input::placeholder {
		color: var(--color-text-muted);
	}

	.username-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.btn-save {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.btn-save:hover:not(:disabled) {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Password form ─────────────────────────────────────────────── */

	.password-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 320px;
	}

	.password-form input {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.password-form input::placeholder {
		color: var(--color-text-muted);
	}

	.password-form input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-glow);
	}

	.btn-primary {
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-accent);
		color: var(--color-base);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		align-self: flex-start;
		transition:
			box-shadow var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.btn-primary:hover:not(:disabled) {
		box-shadow: var(--glow-accent);
	}

	.btn-primary:active:not(:disabled) {
		transform: scale(0.97);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Status messages ───────────────────────────────────────────── */

	.status-msg {
		display: block;
		font-size: 12px;
		color: var(--color-success);
		margin-top: var(--space-1);
	}

	.error-msg {
		margin: var(--space-2) 0 0;
		font-size: 13px;
		color: var(--color-danger);
	}

	.success-msg {
		margin: var(--space-2) 0 0;
		font-size: 13px;
		color: var(--color-success);
	}
</style>
