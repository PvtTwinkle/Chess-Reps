<!--
	ReviewIssuePicker — move selection panel for Review Mode.

	Wraps CandidateMoves with review-specific UI:
	  1. Highlighted row for the user's actual game move (if any)
	  2. "or pick a different move" divider
	  3. Full CandidateMoves tabbed panel (Book / Masters / Engine)
	  4. "Done" / "Skip" button

	The parent controls what happens when a move is selected via
	onSelectMove (save to repertoire, advance chain, etc.).
-->

<script lang="ts">
	import CandidateMoves from '$lib/components/CandidateMoves.svelte';

	interface Props {
		fen: string;
		playerColor: 'WHITE' | 'BLACK';
		gameMoveSan: string | null;
		gameMoveEvalCp: number | null;
		onSelectMove: (san: string) => void;
		onHoverMove: (san: string | null) => void;
		onSkip: () => void;
		disabled?: boolean;
		loading?: boolean;
	}

	let {
		fen,
		playerColor,
		gameMoveSan,
		gameMoveEvalCp,
		onSelectMove,
		onHoverMove,
		onSkip,
		disabled = false,
		loading = false
	}: Props = $props();

	// Format eval from White's perspective, flipped for Black player.
	function formatEval(cp: number): string {
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		const pawns = Math.abs(playerCp) / 100;
		if (playerCp === 0) return '=';
		return playerCp > 0 ? `+${pawns.toFixed(1)}` : `−${pawns.toFixed(1)}`;
	}

	function evalClass(cp: number): string {
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		if (playerCp > 50) return 'eval-good';
		if (playerCp < -50) return 'eval-bad';
		return 'eval-neutral';
	}
</script>

<div class="picker">
	<!-- User's game move (highlighted option) -->
	{#if gameMoveSan}
		<button
			class="game-move-row"
			onclick={() => onSelectMove(gameMoveSan)}
			onmouseenter={() => onHoverMove(gameMoveSan)}
			onmouseleave={() => onHoverMove(null)}
			disabled={disabled || loading}
		>
			<span class="game-move-label">Your move</span>
			<strong class="game-move-san">{gameMoveSan}</strong>
			{#if gameMoveEvalCp !== null}
				<span class="game-move-eval {evalClass(gameMoveEvalCp)}">{formatEval(gameMoveEvalCp)}</span>
			{/if}
		</button>
		<div class="divider">or pick a different move</div>
	{/if}

	<!-- CandidateMoves tabbed panel -->
	<CandidateMoves
		currentFen={fen}
		{onSelectMove}
		{onHoverMove}
		{playerColor}
		disabled={disabled || loading}
	/>

	<!-- Done / Skip -->
	<button class="done-btn" onclick={onSkip} disabled={disabled || loading}>
		{loading ? 'Saving…' : 'Skip'}
	</button>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* ── Game move row ─────────────────────────────────────────────────────── */

	.game-move-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: rgba(226, 183, 20, 0.1);
		border: 1px solid rgba(226, 183, 20, 0.35);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-body);
		font-size: 13px;
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.game-move-row:hover:not(:disabled) {
		border-color: var(--color-gold);
		background: rgba(226, 183, 20, 0.18);
	}

	.game-move-row:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.game-move-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.game-move-san {
		font-weight: 600;
		color: var(--color-gold);
	}

	.game-move-eval {
		margin-left: auto;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.eval-good {
		color: var(--color-success);
	}

	.eval-bad {
		color: var(--color-danger);
	}

	.eval-neutral {
		color: var(--color-text-muted);
	}

	/* ── Divider ───────────────────────────────────────────────────────────── */

	.divider {
		font-size: 11px;
		color: var(--color-text-muted);
		text-align: center;
		position: relative;
		padding: var(--space-1) 0;
	}

	.divider::before,
	.divider::after {
		content: '';
		position: absolute;
		top: 50%;
		width: 20%;
		height: 1px;
		background: var(--color-border);
	}

	.divider::before {
		left: 0;
	}

	.divider::after {
		right: 0;
	}

	/* ── Done button ───────────────────────────────────────────────────────── */

	.done-btn {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		background: none;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 0.73rem;
		font-weight: 600;
		cursor: pointer;
		transition: filter var(--dur-fast) var(--ease-snap);
	}

	.done-btn:not(:disabled):hover {
		color: var(--color-text-secondary);
		border-color: var(--color-text-muted);
	}

	.done-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
