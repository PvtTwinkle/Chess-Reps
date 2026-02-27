<!--
	RepertoireSelector.svelte
	─────────────────────────
	A compact button in the nav bar showing the active repertoire.
	Clicking it opens a dropdown listing all repertoires to switch between.

	The "Manage repertoires" option opens ManageRepertoireModal for
	creating, renaming, and deleting repertoires.

	After any change (create / rename / delete / switch) this component calls
	invalidateAll() from SvelteKit. That re-runs the layout's load function,
	which re-fetches the repertoire list from the database, and Svelte re-renders
	the nav with fresh data — without a full page reload.
-->

<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import ManageRepertoireModal from './ManageRepertoireModal.svelte';

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

<!-- ── Management modal (separate component) ──────────────────────────────── -->
<ManageRepertoireModal bind:open={manageOpen} {repertoires} />

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
</style>
