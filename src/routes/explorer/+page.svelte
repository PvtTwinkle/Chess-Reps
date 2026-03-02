<!--
	Explorer Mode — /explorer
	─────────────────────────
	Read-only view of the user's full repertoire tree.

	HOW NAVIGATION WORKS
	────────────────────
	• The board is non-interactive — no piece dragging.
	• Click any move in the "MOVES FROM HERE" sidebar list to advance.
	• Click "← Back" to step back one move, or "⏮" to return to the start.
	• The CURRENT LINE breadcrumb at the top of the sidebar shows the path taken.

	ARROWS
	──────
	• Green arrows: the user's prepared move(s) at the current position.
	• Blue arrows: opponent responses at the current position.
	• These are Chessground autoShapes — they update whenever the position changes.

	GAP INDICATORS
	──────────────
	• When it is the user's turn, moves in the sidebar that lead to a position
	  where the user has NO prepared response are marked with a "!" gap badge.
	• These are the holes in the repertoire — places where the opponent could
	  reach a position the user hasn't prepared for.

	REPERTOIRE SWITCHING
	────────────────────
	• A $effect syncs all local state from `data` whenever the server provides
	  fresh data. This happens on initial mount and after any invalidateAll()
	  call — which the nav bar's RepertoireSelector triggers on switch/rename/delete.
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { onMount } from 'svelte';
	import { Chess } from 'chess.js';
	import type { PageData } from './$types';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { Key } from '@lichess-org/chessground/types';
	import { initSounds, playMove, playCapture } from '$lib/sounds';

	onMount(() => {
		initSounds();
	});

	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	// Shape of a move row as returned by the server.
	interface RepertoireMove {
		id: number;
		userId: number;
		repertoireId: number;
		fromFen: string;
		toFen: string;
		san: string;
		source: string;
		notes: string | null;
		createdAt: Date | string | number;
	}

	// One step in the user's current navigation path through the tree.
	interface NavEntry {
		fromFen: string;
		toFen: string;
		san: string;
		from: string;
		to: string;
	}

	let { data }: { data: PageData } = $props();

	// ── Reactive state ────────────────────────────────────────────────────────

	let moves = $state<RepertoireMove[]>([]);
	let navHistory = $state<NavEntry[]>([]);
	let currentFen = $state(STARTING_FEN);
	let lastMove = $state<[string, string] | undefined>(undefined);

	// Sync all local state when the server provides fresh data (initial load or
	// repertoire switch via the nav bar).
	$effect(() => {
		moves = data.moves as RepertoireMove[];
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
	});

	// ── Derived values ────────────────────────────────────────────────────────

	// Quick lookup: normalised FEN key → moves that start from that position.
	// Stripping the half-move clock and full-move counter handles transpositions:
	// two paths that reach the same board position map to the same bucket.
	const movesFromFen = $derived.by(() => {
		const map = new SvelteMap<string, RepertoireMove[]>();
		for (const m of moves) {
			const key = fenKey(m.fromFen);
			const arr = map.get(key);
			if (arr) {
				arr.push(m);
			} else {
				map.set(key, [m]);
			}
		}
		return map;
	});

	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// True when it is the user's turn at the current board position.
	const isUserTurn = $derived.by(() => {
		try {
			const chess = new Chess(currentFen);
			const turn = chess.turn();
			return (
				(data.repertoire.color === 'WHITE' && turn === 'w') ||
				(data.repertoire.color === 'BLACK' && turn === 'b')
			);
		} catch {
			return true;
		}
	});

	// All saved moves from the current position (for the sidebar list).
	const movesFromCurrentPosition = $derived(movesFromFen.get(fenKey(currentFen)) ?? []);

	// FEN history ordered newest-to-oldest — passed to OpeningName so it can
	// walk backwards to find the deepest recognised ECO position.
	const fenHistory = $derived([...navHistory].reverse().map((e) => e.fromFen));

	// Navigation history grouped into move-number pairs for the breadcrumb display.
	// e.g. [[e4, e5], [Nf3, Nc6]] → "1. e4 e5  2. Nf3 Nc6"
	const movePairs = $derived.by(() => {
		const pairs: [NavEntry, NavEntry | null][] = [];
		for (let i = 0; i < navHistory.length; i += 2) {
			pairs.push([navHistory[i], navHistory[i + 1] ?? null]);
		}
		return pairs;
	});

	// Arrows to draw on the board for the current position.
	// Green = user's moves, Blue = opponent responses.
	// Resolved from SAN → from/to squares via Chess.js.
	const boardShapes = $derived.by((): DrawShape[] => {
		const shapes: DrawShape[] = [];
		for (const m of movesFromCurrentPosition) {
			const sq = resolveSquares(currentFen, m.san);
			if (sq) {
				shapes.push({
					orig: sq[0] as Key,
					dest: sq[1] as Key,
					brush: isUserTurn ? 'green' : 'blue'
				});
			}
		}
		return shapes;
	});

	// ── Helpers ───────────────────────────────────────────────────────────────

	// Strip the half-move clock and full-move counter from a FEN string so that
	// transpositions (the same position reached via different move orders) hash
	// to the same key.
	function fenKey(fen: string): string {
		return fen.split(' ').slice(0, 4).join(' ');
	}

	// Given a FEN and a SAN move, resolve the from/to squares using Chess.js.
	function resolveSquares(fen: string, san: string): [string, string] | undefined {
		try {
			const chess = new Chess(fen);
			const result = chess.move(san);
			return result ? [result.from, result.to] : undefined;
		} catch {
			return undefined;
		}
	}

	// Returns true if a move leads to a position where the user has no prepared
	// response. These are "gaps" — holes in the repertoire.
	// Only meaningful when it is the opponent's turn (i.e. we are checking whether
	// the user has an answer to each opponent move).
	function isGap(move: RepertoireMove): boolean {
		// After the opponent plays `move`, it becomes the user's turn.
		// If there are no user moves from that FEN, it is a gap.
		return (movesFromFen.get(fenKey(move.toFen)) ?? []).length === 0;
	}

	// ── Navigation ────────────────────────────────────────────────────────────

	// Navigate forward to a move from the current position.
	function navigateTo(move: RepertoireMove) {
		const squares = resolveSquares(move.fromFen, move.san);
		navHistory = [
			...navHistory,
			{
				fromFen: move.fromFen,
				toFen: move.toFen,
				san: move.san,
				from: squares?.[0] ?? '',
				to: squares?.[1] ?? ''
			}
		];
		currentFen = move.toFen;
		lastMove = squares;
		// SAN always contains 'x' for captures (e.g. "Nxe4", "exd5").
		if (move.san.includes('x')) playCapture();
		else playMove();
	}

	// Jump to a specific index in the current line by clicking the breadcrumb.
	function navigateToHistoryIdx(idx: number) {
		navHistory = navHistory.slice(0, idx + 1);
		currentFen = navHistory[idx].toFen;
		lastMove =
			navHistory[idx].from && navHistory[idx].to
				? [navHistory[idx].from, navHistory[idx].to]
				: undefined;
	}

	// Step back one move.
	function handleUndo() {
		if (navHistory.length === 0) return;
		const prev = navHistory[navHistory.length - 1];
		navHistory = navHistory.slice(0, -1);
		currentFen = prev.fromFen;
		lastMove =
			navHistory.length > 0
				? [navHistory[navHistory.length - 1].from, navHistory[navHistory.length - 1].to]
				: undefined;
	}

	// Return to the starting position.
	function handleReset() {
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
	}

	// URL for the "Build from here" button.
	// Encodes the current nav history as a comma-separated SAN list so Build Mode
	// can replay the moves and jump straight to this position on load.
	const buildLink = $derived.by(() => {
		if (navHistory.length === 0) return '/build';
		const sans = navHistory.map((e) => e.san).join(',');
		return `/build?line=${encodeURIComponent(sans)}`;
	});
</script>

<div class="page">
	<!-- ── Board column ────────────────────────────────────────────────────── -->
	<div class="board-col">
		<ChessBoard
			fen={currentFen}
			{orientation}
			boardTheme={data.settings?.boardTheme ?? 'blue'}
			interactive={false}
			{lastMove}
			autoShapes={boardShapes}
		/>
	</div>

	<!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
	<div class="sidebar">
		<!-- Repertoire identity -->
		<div class="rep-header">
			<span class="rep-icon">{data.repertoire.color === 'WHITE' ? '♙' : '♟'}</span>
			<span class="rep-name">{data.repertoire.name}</span>
			<span
				class="color-badge"
				class:badge-white={data.repertoire.color === 'WHITE'}
				class:badge-black={data.repertoire.color === 'BLACK'}
			>
				{data.repertoire.color === 'WHITE' ? 'White' : 'Black'}
			</span>
		</div>

		<!-- ECO opening name -->
		<OpeningName {currentFen} {fenHistory} />

		<!-- Turn indicator (read-only — no instruction, just context) -->
		<div class="turn-indicator" class:user-turn={isUserTurn} class:opp-turn={!isUserTurn}>
			<span class="turn-dot"></span>
			{isUserTurn ? 'YOUR MOVE' : "OPPONENT'S MOVE"}
		</div>

		<!-- Current line breadcrumb -->
		{#if movePairs.length > 0}
			<div class="section">
				<div class="section-label">CURRENT LINE</div>
				<div class="move-list">
					{#each movePairs as pair, i (i)}
						<span class="move-num">{i + 1}.</span>
						<button
							class="move-san"
							class:is-current={navHistory.length - 1 === i * 2}
							onclick={() => navigateToHistoryIdx(i * 2)}
						>
							{pair[0].san}
						</button>
						{#if pair[1]}
							<button
								class="move-san move-san--black"
								class:is-current={navHistory.length - 1 === i * 2 + 1}
								onclick={() => navigateToHistoryIdx(i * 2 + 1)}
							>
								{pair[1].san}
							</button>
						{/if}
					{/each}
				</div>
			</div>
		{/if}

		<!-- Moves from the current position -->
		<div class="section">
			<div class="section-label">
				{isUserTurn ? 'YOUR MOVE' : 'OPPONENT RESPONSES'}
			</div>

			{#if movesFromCurrentPosition.length > 0}
				<div class="position-moves">
					{#each movesFromCurrentPosition as m (m.id)}
						<div class="position-move-item">
							<div class="position-move-row">
								<button class="move-nav-btn" onclick={() => navigateTo(m)}>
									{m.san}
									<!--
										Gap indicator: shown when this is an opponent move that leads to
										a position where the user has no prepared response.
										Only checked on the opponent's turn because on the user's turn,
										the existence of a move means there IS a response.
									-->
									{#if !isUserTurn && isGap(m)}
										<span class="gap-badge" title="No response prepared for this move">!</span>
									{/if}
								</button>
							</div>
							{#if m.notes}
								<p class="move-notes">
									{m.notes.length > 80 ? m.notes.slice(0, 80) + '…' : m.notes}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty-hint">
					{#if isUserTurn}
						No move prepared here. Go to <a href={buildLink} class="build-link">Build Mode</a> to add
						one.
					{:else}
						No opponent responses recorded here.
					{/if}
				</p>
			{/if}
		</div>

		<!-- Navigation controls -->
		<div class="nav-controls">
			<button
				class="nav-btn"
				onclick={handleReset}
				disabled={navHistory.length === 0}
				title="Return to the starting position"
			>
				⏮
			</button>
			<button
				class="nav-btn nav-btn--back"
				onclick={handleUndo}
				disabled={navHistory.length === 0}
				title="Go back one move"
			>
				← Back
			</button>
			<a href={buildLink} class="nav-btn nav-btn--build" title="Open this repertoire in Build Mode">
				Build
			</a>
		</div>

		<!-- Legend for the board arrows -->
		<div class="legend">
			<span class="legend-item">
				<span class="legend-arrow legend-arrow--green">→</span> Your moves
			</span>
			<span class="legend-item">
				<span class="legend-arrow legend-arrow--blue">→</span> Opponent responses
			</span>
			<span class="legend-item">
				<span class="gap-badge gap-badge--legend">!</span> Gap — no response prepared
			</span>
		</div>
	</div>
</div>

<style>
	/* ── Page layout ──────────────────────────────────────────────────────── */

	.page {
		display: flex;
		gap: 2rem;
		align-items: flex-start;
	}

	.board-col {
		width: 520px;
		flex-shrink: 0;
	}

	.sidebar {
		flex: 1;
		min-width: 220px;
		max-width: 320px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ── Repertoire header ────────────────────────────────────────────────── */

	.rep-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #0f3460;
	}

	.rep-icon {
		font-size: 1.2rem;
		line-height: 1;
	}

	.rep-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: #e0e0e0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex-shrink: 0;
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

	/* ── Turn indicator ───────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 0.5rem 0.65rem;
		border-radius: 5px;
		border: 1px solid transparent;
	}

	.turn-indicator.user-turn {
		background: rgba(226, 183, 20, 0.1);
		border-color: rgba(226, 183, 20, 0.3);
		color: #e2b714;
	}

	.turn-indicator.opp-turn {
		background: rgba(80, 100, 160, 0.15);
		border-color: rgba(80, 100, 160, 0.3);
		color: #8090c0;
	}

	.turn-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		background: currentColor;
	}

	/* ── Sections ─────────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #505060;
	}

	/* ── Move list (current line breadcrumb) ──────────────────────────────── */

	.move-list {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.1rem 0.25rem;
		font-size: 0.875rem;
	}

	.move-num {
		color: #505060;
		font-size: 0.78rem;
		user-select: none;
	}

	.move-san {
		background: none;
		border: none;
		color: #c0c0d0;
		font-size: 0.875rem;
		cursor: pointer;
		padding: 0.1rem 0.25rem;
		border-radius: 3px;
		transition:
			background 0.1s,
			color 0.1s;
		font-family: inherit;
	}

	.move-san:hover {
		background: #0f3460;
		color: #f0f0f0;
	}

	.move-san.is-current {
		background: #1a4a7a;
		color: #e2b714;
		font-weight: 600;
	}

	.move-san--black {
		color: #909098;
	}

	/* ── Moves from current position ──────────────────────────────────────── */

	.position-moves {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.position-move-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.position-move-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.move-nav-btn {
		flex: 1;
		padding: 0.35rem 0.65rem;
		background: #0f1f35;
		border: 1px solid #1a3a5c;
		border-radius: 4px;
		color: #c0c0d0;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		transition:
			border-color 0.12s,
			color 0.12s,
			background 0.12s;
		font-family: inherit;
	}

	.move-nav-btn:hover {
		border-color: #e2b714;
		color: #e2b714;
		background: #141f2e;
	}

	/* ── Gap badge ────────────────────────────────────────────────────────── */

	.gap-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		background: rgba(200, 80, 40, 0.2);
		border: 1px solid rgba(200, 80, 40, 0.5);
		border-radius: 50%;
		color: #d06040;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1;
		flex-shrink: 0;
	}

	.gap-badge--legend {
		width: 14px;
		height: 14px;
		font-size: 0.6rem;
	}

	.move-notes {
		font-size: 0.75rem;
		color: #6878a0;
		font-style: italic;
		margin: 0 0 0 0.25rem;
		line-height: 1.35;
		word-break: break-word;
	}

	.empty-hint {
		font-size: 0.82rem;
		color: #404050;
		font-style: italic;
		margin: 0;
	}

	.build-link {
		color: #4a7ab0;
		text-decoration: none;
	}

	.build-link:hover {
		color: #7aaad0;
		text-decoration: underline;
	}

	/* ── Navigation controls ──────────────────────────────────────────────── */

	.nav-controls {
		display: flex;
		gap: 0.5rem;
		padding-top: 0.25rem;
		border-top: 1px solid #0f3460;
	}

	.nav-btn {
		padding: 0.4rem 0.85rem;
		background: #0f1f35;
		border: 1px solid #1a3a5c;
		border-radius: 4px;
		color: #a0a0b0;
		font-size: 0.875rem;
		cursor: pointer;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		transition:
			border-color 0.12s,
			color 0.12s;
		font-family: inherit;
	}

	.nav-btn:hover:not(:disabled) {
		border-color: #4a6a9a;
		color: #d0d0e0;
	}

	.nav-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.nav-btn--back {
		flex: 1;
	}

	.nav-btn--build {
		flex-shrink: 0;
		border-color: #1a4060;
		color: #6090c0;
	}

	.nav-btn--build:hover {
		border-color: #4a7aaa;
		color: #90c0e0;
	}

	/* ── Legend ───────────────────────────────────────────────────────────── */

	.legend {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding-top: 0.5rem;
		border-top: 1px solid #0f3460;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		color: #505060;
	}

	.legend-arrow {
		font-size: 1rem;
		line-height: 1;
	}

	.legend-arrow--green {
		color: #15781b;
	}

	.legend-arrow--blue {
		color: #003088;
	}
</style>
