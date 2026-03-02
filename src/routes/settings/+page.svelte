<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import ChessBoard from '$lib/components/ChessBoard.svelte';

	let { data }: { data: PageData } = $props();

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
			setTimeout(() => (themeStatus = ''), 2000);
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
			setTimeout(() => (depthStatus = ''), 2000);
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
			setTimeout(() => (timeoutStatus = ''), 2000);
		} catch {
			timeoutStatus = 'Error saving';
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
</script>

<h1>Settings</h1>

<div class="settings-page">
	<!-- ── Board Appearance ────────────────────────────────────────────── -->
	<section class="settings-section">
		<h2>Board Appearance</h2>

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

<style>
	h1 {
		margin: 0 0 0.75rem;
		font-size: 1.5rem;
		color: #f0f0f0;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
		color: #c0c0d0;
		border-bottom: 1px solid #2a2a3c;
		padding-bottom: 0.4rem;
	}

	.settings-page {
		max-width: 600px;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.settings-section {
		background: #1e1e2e;
		border: 1px solid #2a2a3c;
		border-radius: 8px;
		padding: 1rem 1.25rem;
		/* Isolate stacking context so Chessground's z-indexed children
		   in the board preview can't escape and overlay other sections. */
		position: relative;
		z-index: 0;
	}

	.setting-row {
		margin-bottom: 1rem;
	}

	.setting-row:last-child {
		margin-bottom: 0;
	}

	.setting-label {
		display: block;
		font-size: 0.9rem;
		color: #a0a0b0;
		margin-bottom: 0.4rem;
	}

	.setting-hint {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		color: #606070;
	}

	/* ── Theme picker ──────────────────────────────────────────────── */

	.theme-picker {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.theme-swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.4rem;
		background: transparent;
		border: 2px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.theme-swatch:hover {
		border-color: #505060;
	}

	.theme-swatch.selected {
		border-color: #7aa2f7;
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
		font-size: 0.7rem;
		color: #808090;
	}

	/* ── Board preview ─────────────────────────────────────────────── */

	.board-preview {
		width: 240px;
		margin: 0.5rem 0 1rem;
		/* Chessground coordinates use negative offsets (top: -20px, bottom: -4px)
		   that overflow outside the board. Clip them so they don't cover the
		   theme picker or other settings below. */
		overflow: hidden;
		/* Non-interactive preview — prevent the board's absolutely-positioned
		   overlay layers (shapes SVGs, squares) from stealing clicks. */
		pointer-events: none;
		/* Create a stacking context so the board's z-indexed children don't
		   escape and overlay sibling sections. */
		position: relative;
		z-index: 0;
	}

	/* ── Toggle button ─────────────────────────────────────────────── */

	.toggle-btn {
		padding: 0.35rem 1rem;
		border-radius: 4px;
		border: 1px solid #3a3a4c;
		background: #252536;
		color: #808090;
		font-size: 0.85rem;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.toggle-btn.active {
		background: #2d4a2d;
		color: #50c878;
		border-color: #50c878;
	}

	/* ── Slider ────────────────────────────────────────────────────── */

	.slider-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.slider-label {
		font-size: 0.78rem;
		color: #606070;
		min-width: 1.5em;
		text-align: center;
	}

	input[type='range'] {
		flex: 1;
		accent-color: #7aa2f7;
	}

	/* ── Password form ─────────────────────────────────────────────── */

	.password-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 320px;
	}

	.password-form input {
		padding: 0.5rem 0.75rem;
		border: 1px solid #3a3a4c;
		border-radius: 4px;
		background: #252536;
		color: #e0e0e0;
		font-size: 0.9rem;
	}

	.password-form input::placeholder {
		color: #606070;
	}

	.password-form input:focus {
		outline: none;
		border-color: #7aa2f7;
	}

	.btn-primary {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 4px;
		background: #7aa2f7;
		color: #1a1a2e;
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: opacity 0.15s;
		align-self: flex-start;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.85;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Status messages ───────────────────────────────────────────── */

	.status-msg {
		display: block;
		font-size: 0.78rem;
		color: #50c878;
		margin-top: 0.3rem;
	}

	.error-msg {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: #f7768e;
	}

	.success-msg {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: #50c878;
	}
</style>
