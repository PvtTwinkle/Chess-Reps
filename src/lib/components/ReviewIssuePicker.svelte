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
		cplClass?: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null;
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
		cplClass = null,
		onSelectMove,
		onHoverMove,
		onSkip,
		disabled = false,
		loading = false
	}: Props = $props();

	// Live engine evals — updated as CandidateMoves streams depth updates.
	// liveEvalCp: eval for the game move (null if not among top candidates).
	// liveBestEvalCp: eval for the engine's #1 candidate (always available once engine starts).
	let liveEvalCp = $state<number | null>(null);
	let liveBestEvalCp = $state<number | null>(null);

	// Reset live evals when the position changes (new issue / chain leg).
	$effect(() => {
		void fen; // track fen as dependency
		liveEvalCp = null;
		liveBestEvalCp = null;
	});

	function handleEngineCandidates(
		candidates: { san: string; evalCp: number | null; evalMate: number | null }[]
	): void {
		// Track the best candidate's eval (first in the list = engine's top pick).
		liveBestEvalCp = candidates.length > 0 ? (candidates[0].evalCp ?? null) : null;

		if (!gameMoveSan) return;
		const match = candidates.find((c) => c.san === gameMoveSan);
		liveEvalCp = match?.evalCp ?? null;
	}

	// Use live engine eval when available, static batch eval as fallback.
	const displayEvalCp = $derived(liveEvalCp ?? gameMoveEvalCp);

	// Format eval from White's perspective, flipped for Black player.
	function formatEval(cp: number): string {
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		const pawns = Math.abs(playerCp) / 100;
		if (playerCp === 0) return '=';
		return playerCp > 0 ? `+${pawns.toFixed(1)}` : `−${pawns.toFixed(1)}`;
	}

	// Compute live CPL class from engine's best candidate vs the game move eval.
	// Both evals are from white's perspective, so:
	//   White player: wants high eval → CPL = bestEval − gameMoveEval
	//   Black player: wants low eval  → CPL = gameMoveEval − bestEval
	function getLiveCplClass(): 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null {
		if (liveBestEvalCp == null || displayEvalCp == null) return null;
		const raw =
			playerColor === 'WHITE' ? liveBestEvalCp - displayEvalCp : displayEvalCp - liveBestEvalCp;
		const cpl = Math.max(0, raw);
		if (cpl <= 10) return 'best';
		if (cpl <= 50) return 'good';
		if (cpl <= 100) return 'inaccuracy';
		if (cpl <= 200) return 'mistake';
		return 'blunder';
	}

	// Live engine CPL class takes priority, then batch CPL from parent.
	const activeCplClass = $derived(getLiveCplClass() ?? cplClass);

	// CSS class based on CPL classification.
	// Move name: falls back to no class (inherits accent color from .game-move-san).
	// Eval badge: falls back to eval-neutral (muted).
	const moveColorClass = $derived(activeCplClass ? `eval-${activeCplClass}` : '');
	const evalColorClass = $derived(activeCplClass ? `eval-${activeCplClass}` : 'eval-neutral');
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
			<strong class="game-move-san {moveColorClass}">{gameMoveSan}</strong>
			{#if displayEvalCp !== null}
				<span class="game-move-eval {evalColorClass}">{formatEval(displayEvalCp)}</span>
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
		onEngineCandidatesChanged={handleEngineCandidates}
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
		background: rgba(91, 127, 164, 0.1);
		border: 1px solid rgba(91, 127, 164, 0.35);
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
		border-color: var(--color-accent);
		background: rgba(91, 127, 164, 0.18);
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
		color: var(--color-accent);
	}

	.game-move-eval {
		margin-left: auto;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.eval-best {
		color: var(--color-eval-best);
	}

	.eval-good {
		color: var(--color-eval-good);
	}

	.eval-inaccuracy {
		color: var(--color-eval-inaccuracy);
	}

	.eval-mistake {
		color: var(--color-eval-mistake);
	}

	.eval-blunder {
		color: var(--color-eval-blunder);
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
