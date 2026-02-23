<!--
	RepertoireSelector.svelte
	─────────────────────────
	Two responsibilities in one component:

	1. SELECTOR — a compact button in the nav bar showing the active repertoire.
	   Clicking it opens a dropdown listing all repertoires to switch between.

	2. MANAGE MODAL — a "Manage repertoires" option in the dropdown opens a full
	   modal overlay for creating, renaming, and deleting repertoires.

	After any change (create / rename / delete / switch) this component calls
	invalidateAll() from SvelteKit. That re-runs the layout's load function,
	which re-fetches the repertoire list from the database, and Svelte re-renders
	the nav with fresh data — without a full page reload.
-->

<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	// The shape of one repertoire row as returned by the server.
	interface Repertoire {
		id: number;
		userId: number;
		name: string;
		color: string; // "WHITE" or "BLACK"
		createdAt: Date | string | number;
	}

	let {
		repertoires = [],
		activeRepertoireId = null
	}: {
		repertoires: Repertoire[];
		activeRepertoireId: number | null;
	} = $props();

	// ── UI state ────────────────────────────────────────────────────────────────
	let dropdownOpen = $state(false);
	let manageOpen = $state(false);

	// ── Create form state ────────────────────────────────────────────────────────
	let newName = $state('');
	let newColor = $state<'WHITE' | 'BLACK'>('WHITE');

	// ── Rename state (tracks which row is being edited inline) ───────────────────
	let editingId = $state<number | null>(null);
	let editingName = $state('');

	// ── Delete confirmation state ────────────────────────────────────────────────
	let confirmDeleteId = $state<number | null>(null);

	// ── Request-in-flight guard (prevents double-clicks) ────────────────────────
	let busy = $state(false);

	// Derived: the repertoire object that is currently active (or null if none).
	const active = $derived(repertoires.find((r) => r.id === activeRepertoireId) ?? null);

	// White pawn for WHITE repertoires, black pawn for BLACK.
	function colorIcon(color: string): string {
		return color === 'WHITE' ? '♙' : '♟';
	}

	// ── Switch active repertoire ─────────────────────────────────────────────────
	async function switchTo(id: number) {
		if (busy || id === activeRepertoireId) {
			dropdownOpen = false;
			return;
		}
		busy = true;
		dropdownOpen = false;
		await fetch('/api/repertoires/active', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		await invalidateAll();
		busy = false;
	}

	// ── Create a new repertoire ──────────────────────────────────────────────────
	async function createRepertoire() {
		if (!newName.trim() || busy) return;
		busy = true;

		const res = await fetch('/api/repertoires', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: newName.trim(), color: newColor })
		});

		if (res.ok) {
			const created: Repertoire = await res.json();
			// Automatically switch to the new repertoire — if you created it,
			// you almost certainly want to start using it immediately.
			await fetch('/api/repertoires/active', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: created.id })
			});
			newName = '';
			newColor = 'WHITE';
		}

		await invalidateAll();
		busy = false;
	}

	// ── Start editing a repertoire name inline ───────────────────────────────────
	function startEdit(rep: Repertoire) {
		editingId = rep.id;
		editingName = rep.name;
		confirmDeleteId = null; // dismiss any open confirm dialog
	}

	function cancelEdit() {
		editingId = null;
		editingName = '';
	}

	// ── Save a rename ────────────────────────────────────────────────────────────
	async function saveRename(id: number) {
		if (!editingName.trim() || busy) return;
		busy = true;
		await fetch(`/api/repertoires/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: editingName.trim() })
		});
		editingId = null;
		editingName = '';
		await invalidateAll();
		busy = false;
	}

	// ── Delete flow — ask first, confirm to proceed ──────────────────────────────
	function askDelete(id: number) {
		confirmDeleteId = id;
		editingId = null; // dismiss any open rename input
	}

	function cancelDelete() {
		confirmDeleteId = null;
	}

	async function confirmDelete(id: number) {
		if (busy) return;
		busy = true;
		await fetch(`/api/repertoires/${id}`, { method: 'DELETE' });
		confirmDeleteId = null;
		await invalidateAll();
		busy = false;
	}

	// Close the dropdown when the user clicks anywhere outside this component.
	function handleWindowClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.repertoire-selector')) {
			dropdownOpen = false;
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<!-- ── Selector button + dropdown ──────────────────────────────────────────── -->
<div class="repertoire-selector">
	<button
		class="selector-btn"
		onclick={() => (dropdownOpen = !dropdownOpen)}
		aria-haspopup="listbox"
		aria-expanded={dropdownOpen}
		title="Switch repertoire"
	>
		{#if active}
			<span class="color-icon">{colorIcon(active.color)}</span>
			<span class="rep-name">{active.name}</span>
		{:else}
			<span class="no-rep">No repertoire</span>
		{/if}
		<span class="chevron" class:open={dropdownOpen}>▾</span>
	</button>

	{#if dropdownOpen}
		<div class="dropdown" role="listbox">
			{#each repertoires as rep (rep.id)}
				<button
					class="dropdown-item"
					class:is-active={rep.id === activeRepertoireId}
					role="option"
					aria-selected={rep.id === activeRepertoireId}
					onclick={() => switchTo(rep.id)}
				>
					<span class="color-icon">{colorIcon(rep.color)}</span>
					<span class="item-name">{rep.name}</span>
					{#if rep.id === activeRepertoireId}
						<span class="check">✓</span>
					{/if}
				</button>
			{/each}

			{#if repertoires.length === 0}
				<p class="dropdown-empty">No repertoires yet</p>
			{/if}

			<div class="dropdown-divider"></div>

			<button
				class="dropdown-action"
				onclick={() => {
					dropdownOpen = false;
					manageOpen = true;
				}}
			>
				⚙ Manage repertoires
			</button>
		</div>
	{/if}
</div>

<!-- ── Management modal ─────────────────────────────────────────────────────── -->
{#if manageOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="backdrop"
		onclick={(e) => {
			if (e.target === e.currentTarget) manageOpen = false;
		}}
	>
		<div class="modal" role="dialog" aria-modal="true" aria-label="Manage repertoires">
			<!-- Header -->
			<div class="modal-header">
				<h2>Manage Repertoires</h2>
				<button class="close-btn" onclick={() => (manageOpen = false)} aria-label="Close">✕</button>
			</div>

			<!-- Existing repertoires list -->
			<div class="rep-list">
				{#each repertoires as rep (rep.id)}
					<div class="rep-row">
						{#if confirmDeleteId === rep.id}
							<!-- Delete confirmation banner replaces the row content -->
							<div class="confirm-zone">
								<span class="confirm-msg">
									Delete "<strong>{rep.name}</strong>"? This removes all moves and review history.
								</span>
								<div class="confirm-actions">
									<button class="btn-danger" onclick={() => confirmDelete(rep.id)} disabled={busy}>
										Delete forever
									</button>
									<button class="btn-ghost" onclick={cancelDelete} disabled={busy}>Cancel</button>
								</div>
							</div>
						{:else if editingId === rep.id}
							<!-- Inline rename input replaces the name label -->
							<span class="row-icon">{colorIcon(rep.color)}</span>
							<input
								class="rename-input"
								type="text"
								bind:value={editingName}
								onkeydown={(e) => {
									if (e.key === 'Enter') saveRename(rep.id);
									if (e.key === 'Escape') cancelEdit();
								}}
							/>
							<div class="row-actions">
								<button class="btn-primary" onclick={() => saveRename(rep.id)} disabled={busy}>
									Save
								</button>
								<button class="btn-ghost" onclick={cancelEdit} disabled={busy}>Cancel</button>
							</div>
						{:else}
							<!-- Normal row -->
							<span class="row-icon">{colorIcon(rep.color)}</span>
							<span class="row-name">{rep.name}</span>
							<span
								class="color-badge"
								class:badge-white={rep.color === 'WHITE'}
								class:badge-black={rep.color === 'BLACK'}
							>
								{rep.color === 'WHITE' ? 'White' : 'Black'}
							</span>
							<div class="row-actions">
								<button class="btn-ghost" onclick={() => startEdit(rep)}>Rename</button>
								<button class="btn-ghost btn-ghost--danger" onclick={() => askDelete(rep.id)}>
									Delete
								</button>
							</div>
						{/if}
					</div>
				{/each}

				{#if repertoires.length === 0}
					<p class="empty-hint">No repertoires yet — create one below.</p>
				{/if}
			</div>

			<!-- Create new repertoire form -->
			<div class="create-section">
				<h3>Create New Repertoire</h3>

				<div class="form-row">
					<input
						class="text-input"
						type="text"
						placeholder="e.g. White — e4 lines or Black vs d4"
						bind:value={newName}
						onkeydown={(e) => {
							if (e.key === 'Enter') createRepertoire();
						}}
					/>
				</div>

				<div class="color-row">
					<label class="color-label">
						<input type="radio" name="rep-color" value="WHITE" bind:group={newColor} />
						<span class="color-opt">♙ White</span>
					</label>
					<label class="color-label">
						<input type="radio" name="rep-color" value="BLACK" bind:group={newColor} />
						<span class="color-opt">♟ Black</span>
					</label>
				</div>

				<button
					class="btn-primary btn-create"
					onclick={createRepertoire}
					disabled={!newName.trim() || busy}
				>
					{busy ? 'Creating…' : 'Create Repertoire'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Selector button ────────────────────────────────────────────────────── */

	.repertoire-selector {
		position: relative;
	}

	.selector-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.65rem;
		background: #0f3460;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #e0e0e0;
		font-size: 0.875rem;
		cursor: pointer;
		white-space: nowrap;
		max-width: 220px;
		transition: border-color 0.15s;
	}

	.selector-btn:hover {
		border-color: #e2b714;
	}

	.rep-name {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}

	.no-rep {
		color: #606070;
		font-style: italic;
	}

	.chevron {
		font-size: 0.7rem;
		color: #707080;
		transition: transform 0.15s;
		flex-shrink: 0;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	/* ── Dropdown panel ─────────────────────────────────────────────────────── */

	.dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 210px;
		background: #1a2840;
		border: 1px solid #0f3460;
		border-radius: 6px;
		padding: 0.25rem 0;
		z-index: 100;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.75rem;
		background: none;
		border: none;
		color: #c0c0d0;
		font-size: 0.875rem;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.dropdown-item:hover {
		background: #0f3460;
		color: #f0f0f0;
	}

	.dropdown-item.is-active {
		color: #e2b714;
	}

	.item-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.check {
		color: #e2b714;
		font-size: 0.8rem;
		flex-shrink: 0;
	}

	.dropdown-empty {
		padding: 0.5rem 0.75rem;
		color: #505060;
		font-size: 0.8rem;
		margin: 0;
	}

	.dropdown-divider {
		height: 1px;
		background: #0f3460;
		margin: 0.25rem 0;
	}

	.dropdown-action {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.45rem 0.75rem;
		background: none;
		border: none;
		color: #909098;
		font-size: 0.8rem;
		cursor: pointer;
		text-align: left;
		transition:
			color 0.1s,
			background 0.1s;
	}

	.dropdown-action:hover {
		background: #0f3460;
		color: #f0f0f0;
	}

	/* ── Modal backdrop + panel ─────────────────────────────────────────────── */

	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.65);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: #1a2840;
		border: 1px solid #0f3460;
		border-radius: 8px;
		width: 540px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 4rem);
		overflow-y: auto;
		padding: 1.5rem;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
		color: #f0f0f0;
		font-weight: 600;
	}

	.close-btn {
		background: none;
		border: none;
		color: #606070;
		font-size: 1rem;
		cursor: pointer;
		padding: 0.25rem 0.4rem;
		border-radius: 3px;
		transition: color 0.15s;
		line-height: 1;
	}

	.close-btn:hover {
		color: #e0e0e0;
	}

	/* ── Repertoire list ────────────────────────────────────────────────────── */

	.rep-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.rep-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		background: #0f1f35;
		border: 1px solid #1a3a5c;
		border-radius: 6px;
		min-height: 44px;
	}

	.row-icon {
		font-size: 1.1rem;
		flex-shrink: 0;
		line-height: 1;
	}

	.row-name {
		flex: 1;
		font-size: 0.9rem;
		color: #e0e0e0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		flex-shrink: 0;
		font-size: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.badge-white {
		background: #252525;
		color: #b0b0b0;
		border: 1px solid #3a3a3a;
	}

	.badge-black {
		background: #181818;
		color: #707070;
		border: 1px solid #2a2a2a;
	}

	.row-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	/* ── Confirm delete zone ────────────────────────────────────────────────── */

	.confirm-zone {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 100%;
	}

	.confirm-msg {
		font-size: 0.85rem;
		color: #e0a0a0;
		line-height: 1.4;
	}

	.confirm-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* ── Rename input ───────────────────────────────────────────────────────── */

	.rename-input {
		flex: 1;
		padding: 0.35rem 0.55rem;
		background: #0a1828;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #e0e0e0;
		font-size: 0.875rem;
	}

	.rename-input:focus {
		outline: none;
		border-color: #e2b714;
	}

	/* ── Empty state ────────────────────────────────────────────────────────── */

	.empty-hint {
		color: #505060;
		font-size: 0.875rem;
		text-align: center;
		padding: 1rem;
		margin: 0;
	}

	/* ── Create section ─────────────────────────────────────────────────────── */

	.create-section {
		border-top: 1px solid #0f3460;
		padding-top: 1.25rem;
	}

	.create-section h3 {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		color: #a0a0b0;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.form-row {
		margin-bottom: 0.75rem;
	}

	.text-input {
		width: 100%;
		padding: 0.5rem 0.65rem;
		background: #0a1828;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #e0e0e0;
		font-size: 0.9rem;
		box-sizing: border-box;
	}

	.text-input:focus {
		outline: none;
		border-color: #e2b714;
	}

	.color-row {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.color-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		font-size: 0.9rem;
		color: #c0c0d0;
	}

	.color-label input[type='radio'] {
		accent-color: #e2b714;
		cursor: pointer;
	}

	.btn-create {
		width: 100%;
		padding: 0.55rem;
		font-size: 0.9rem;
	}

	/* ── Shared button styles ───────────────────────────────────────────────── */

	.btn-primary {
		padding: 0.35rem 0.85rem;
		background: #e2b714;
		border: none;
		border-radius: 4px;
		color: #1a1a2e;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.88;
	}

	.btn-primary:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.btn-ghost {
		padding: 0.35rem 0.65rem;
		background: transparent;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #909098;
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.btn-ghost:hover:not(:disabled) {
		border-color: #a0a0b0;
		color: #e0e0e0;
	}

	.btn-ghost--danger:hover:not(:disabled) {
		border-color: #c04040;
		color: #e06060;
	}

	.btn-ghost:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.btn-danger {
		padding: 0.35rem 0.75rem;
		background: #7a1818;
		border: none;
		border-radius: 4px;
		color: #f0c0c0;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-danger:hover:not(:disabled) {
		background: #9a2020;
	}

	.btn-danger:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
