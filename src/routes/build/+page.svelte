<!--
	Build Mode — /build
	───────────────────
	Where the user constructs their opening repertoire by playing out moves.

	Layout: board on the left, sidebar on the right.

	HOW MOVES WORK
	──────────────
	• Playing a move on the board saves it immediately (auto-save).
	• If the move is already saved, the board navigates there without a DB call.
	• On the user's turn, only ONE move per position is allowed. Playing a
	  different move when one already exists shows a conflict warning and snaps
	  the piece back.
	• On the opponent's turn, multiple moves are allowed (one for each line the
	  user wants to prepare against).

	HOW UNDO WORKS
	──────────────
	• Undo is navigation only — it steps backwards through the current line.
	• It does NOT delete anything from the database.
	• To actually remove a move from the repertoire, use the ✕ button in the
	  "Responses" section of the sidebar.

	REPERTOIRE SWITCHING
	────────────────────
	• A $effect syncs all local state from `data` whenever the server provides
	  fresh data. This happens on initial mount and after any invalidateAll()
	  call — which the nav bar's RepertoireSelector triggers on switch/rename/delete.
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import CandidateMoves from '$lib/components/CandidateMoves.svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Chess } from 'chess.js';
	import type { PageData } from './$types';

	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	// Shape of a move row as returned by the server / API.
	interface RepertoireMove {
		id: number;
		userId: number;
		repertoireId: number;
		fromFen: string;
		toFen: string;
		san: string;
		type: string;
		source: string;
		notes: string | null;
		createdAt: Date | string | number;
	}

	// One step in the user's current navigation path through the tree.
	// "from" and "to" are the board squares (e.g. "e2", "e4") needed to
	// draw the lastMove highlight on the board.
	interface NavEntry {
		fromFen: string;
		toFen: string;
		san: string;
		from: string;
		to: string;
	}

	let { data }: { data: PageData } = $props();

	// ── Reactive state ───────────────────────────────────────────────────────────

	// All moves saved to this repertoire. Initialised to empty here; the $effect
	// below immediately populates it from `data.moves` and re-syncs whenever
	// the server provides fresh data (e.g. after switching repertoire).
	let moves = $state<RepertoireMove[]>([]);

	// The user's current navigation path from the starting position.
	// Pushing adds a step forward; slicing removes steps (undo / navigation click).
	let navHistory = $state<NavEntry[]>([]);

	// The FEN currently shown on the board.
	let currentFen = $state(STARTING_FEN);

	// The from/to squares of the last move played — shown as yellow highlights.
	let lastMove = $state<[string, string] | undefined>(undefined);

	// True while a fetch is in-flight — disables the board to prevent race conditions.
	let saving = $state(false);

	// Set to the SAN of the conflicting move when the user tries to add a second
	// move on their own turn (which is not allowed).
	let conflictSan = $state<string | null>(null);

	// Set when a network or server error occurs.
	let errorMsg = $state<string | null>(null);

	// Incrementing this key forces ChessBoard to remount, which resets the visual
	// board state to `currentFen`. We use this to snap a piece back after a
	// rejected move (conflict or error).
	let boardKey = $state(0);

	// Sync all local state from the server-provided page data.
	// Runs on initial mount AND whenever `data` is refreshed — which happens
	// when the user switches to a different repertoire via the nav bar
	// (invalidateAll() re-runs the server load function and delivers fresh data).
	$effect(() => {
		moves = data.moves as RepertoireMove[];
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		conflictSan = null;
		errorMsg = null;
	});

	// ── Derived values ───────────────────────────────────────────────────────────

	// Quick lookup: FEN → moves that start from that position.
	// Rebuilt automatically whenever `moves` changes.
	const movesFromFen = $derived.by(() => {
		const map = new SvelteMap<string, RepertoireMove[]>();
		for (const m of moves) {
			const arr = map.get(m.fromFen);
			if (arr) {
				arr.push(m);
			} else {
				map.set(m.fromFen, [m]);
			}
		}
		return map;
	});

	// Board orientation: white at bottom for white repertoires, black for black.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// True when it is the user's turn at the current board position.
	// Determined by comparing the FEN's active side with the repertoire color.
	const isUserTurn = $derived.by(() => {
		try {
			const chess = new Chess(currentFen);
			const turn = chess.turn(); // 'w' or 'b'
			return (
				(data.repertoire.color === 'WHITE' && turn === 'w') ||
				(data.repertoire.color === 'BLACK' && turn === 'b')
			);
		} catch {
			return true; // safe default if FEN is somehow invalid
		}
	});

	// All saved moves from the current position, shown in the sidebar.
	const movesFromCurrentPosition = $derived(movesFromFen.get(currentFen) ?? []);

	// The navigation history grouped into move-number pairs for display.
	// e.g. [[e4, e5], [Nf3, Nc6]] represents "1. e4 e5 2. Nf3 Nc6"
	const movePairs = $derived.by(() => {
		const pairs: [NavEntry, NavEntry | null][] = [];
		for (let i = 0; i < navHistory.length; i += 2) {
			pairs.push([navHistory[i], navHistory[i + 1] ?? null]);
		}
		return pairs;
	});

	// ── Helpers ──────────────────────────────────────────────────────────────────

	// Given a FEN and a SAN move, use Chess.js to resolve the from/to squares.
	// Returns undefined if the move is somehow unparseable (shouldn't happen in
	// practice because Chess.js already validated the move when it was saved).
	function resolveSquares(fen: string, san: string): [string, string] | undefined {
		try {
			const chess = new Chess(fen);
			const result = chess.move(san);
			return result ? [result.from, result.to] : undefined;
		} catch {
			return undefined;
		}
	}

	// Collect all FENs reachable from a given position in the local move tree.
	// Used after a deletion to figure out which local state entries to remove.
	// The visited set prevents infinite loops on transpositions.
	function collectSubtreeFens(startFen: string): SvelteSet<string> {
		const visited = new SvelteSet<string>();
		const queue = [startFen];
		while (queue.length > 0) {
			const fen = queue.shift()!;
			if (visited.has(fen)) continue;
			visited.add(fen);
			for (const child of movesFromFen.get(fen) ?? []) {
				queue.push(child.toFen);
			}
		}
		return visited;
	}

	// ── Move handler (called by ChessBoard after the user moves a piece) ─────────

	async function handleMove(from: string, to: string, san: string, newFen: string) {
		conflictSan = null;
		errorMsg = null;

		// If this exact move is already in the repertoire, just navigate — no API call.
		const existing = movesFromFen.get(currentFen)?.find((m) => m.san === san);
		if (existing) {
			navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
			currentFen = newFen;
			lastMove = [from, to];
			return;
		}

		// On the user's turn, only one move per position is allowed.
		// If a different move already exists, show a warning and snap back.
		if (isUserTurn && movesFromCurrentPosition.length > 0) {
			conflictSan = movesFromCurrentPosition[0].san;
			boardKey += 1; // remount ChessBoard → piece snaps back to currentFen
			return;
		}

		// New move — save it to the database.
		saving = true;
		try {
			const res = await fetch('/api/moves', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId: data.repertoire.id,
					fromFen: currentFen,
					san,
					type: 'MAIN'
				})
			});

			if (res.status === 409) {
				// Server-side conflict (e.g. two browser tabs open at once).
				const body = await res.json();
				conflictSan = body.existing?.san ?? '?';
				boardKey += 1;
				return;
			}

			if (!res.ok) {
				errorMsg = 'Failed to save move. Please try again.';
				boardKey += 1;
				return;
			}

			const savedMove: RepertoireMove = await res.json();
			moves = [...moves, savedMove];
			navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
			currentFen = newFen;
			lastMove = [from, to];
		} catch {
			errorMsg = 'Network error. Please try again.';
			boardKey += 1;
		} finally {
			saving = false;
		}
	}

	// ── Undo ─────────────────────────────────────────────────────────────────────

	// Step back one move in the navigation history.
	// The move stays in the database — undo is navigation, not deletion.
	function handleUndo() {
		if (navHistory.length === 0) return;
		const prev = navHistory[navHistory.length - 1];
		navHistory = navHistory.slice(0, -1);
		currentFen = prev.fromFen;
		lastMove =
			navHistory.length > 0
				? [navHistory[navHistory.length - 1].from, navHistory[navHistory.length - 1].to]
				: undefined;
		conflictSan = null;
		errorMsg = null;
	}

	// Jump back to the starting position (clears the navigation history entirely).
	function handleReset() {
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		conflictSan = null;
		errorMsg = null;
	}

	// ── Sidebar navigation ───────────────────────────────────────────────────────

	// Navigate to a saved move by clicking it in the sidebar.
	// Appends the move to the navigation history so undo still works.
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
		conflictSan = null;
		errorMsg = null;
	}

	// Navigate to a specific index in the current line by clicking a move in the
	// move-list display. Slices the history up to that point.
	function navigateToHistoryIdx(idx: number) {
		navHistory = navHistory.slice(0, idx + 1);
		currentFen = navHistory[idx].toFen;
		lastMove =
			navHistory[idx].from && navHistory[idx].to
				? [navHistory[idx].from, navHistory[idx].to]
				: undefined;
		conflictSan = null;
		errorMsg = null;
	}

	// ── Candidate move selection ──────────────────────────────────────────────

	// Called when the user clicks a suggested move in the CandidateMoves panel.
	// Uses Chess.js to resolve the from/to squares from the SAN, then feeds
	// the move through the same handleMove path as a drag-and-drop move.
	// This means conflict detection, auto-save, and undo all work identically.
	async function handleCandidateSelect(san: string) {
		try {
			const chess = new Chess(currentFen);
			const result = chess.move(san);
			if (result) {
				await handleMove(result.from, result.to, result.san, chess.fen());
			}
		} catch {
			// Chess.js throws if the move is somehow invalid — shouldn't happen
			// with candidates from the engine, but guard defensively.
			errorMsg = 'Could not play the selected move.';
		}
	}

	// ── Deletion ─────────────────────────────────────────────────────────────────

	// Remove a move from the repertoire, including all moves that are only
	// reachable through it (the subtree). If the user is currently viewing a
	// position inside the deleted subtree, navigate them back to safety.
	async function deleteMove(move: RepertoireMove) {
		if (saving) return;
		saving = true;
		errorMsg = null;

		try {
			const res = await fetch(`/api/moves/${move.id}`, { method: 'DELETE' });
			if (!res.ok) {
				errorMsg = 'Failed to delete move. Please try again.';
				return;
			}

			// Collect all positions that were inside the deleted subtree.
			const deletedFens = collectSubtreeFens(move.toFen);

			// Remove the deleted move and its subtree from local state.
			moves = moves.filter((m) => {
				if (m.id === move.id) return false;
				if (deletedFens.has(m.fromFen)) return false;
				return true;
			});

			// If the user is currently at a position inside the deleted subtree,
			// navigate back to where the deleted move started.
			if (currentFen === move.toFen || deletedFens.has(currentFen)) {
				const entryIdx = navHistory.findIndex((e) => e.toFen === move.toFen);
				if (entryIdx >= 0) {
					navHistory = navHistory.slice(0, entryIdx);
				}
				currentFen = move.fromFen;
				lastMove =
					navHistory.length > 0
						? [navHistory[navHistory.length - 1].from, navHistory[navHistory.length - 1].to]
						: undefined;
			}
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="page">
	<!-- ── Board column ─────────────────────────────────────────────────────── -->
	<div class="board-col">
		<!--
				{#key boardKey} remounts ChessBoard when boardKey increments.
				We increment boardKey to reject a move visually — it forces
				Chessground to reinitialize with `currentFen`, snapping the
				piece back to where it was.
			-->
		{#key boardKey}
			<ChessBoard
				fen={currentFen}
				{orientation}
				interactive={!saving}
				{lastMove}
				onMove={handleMove}
			/>
		{/key}
	</div>

	<!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
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

		<!-- Turn indicator -->
		<div class="turn-indicator" class:user-turn={isUserTurn} class:opp-turn={!isUserTurn}>
			<span class="turn-dot"></span>
			{#if isUserTurn}
				YOUR TURN <span class="turn-hint">— play a move on the board</span>
			{:else}
				OPPONENT'S TURN <span class="turn-hint">— play their move to add a response</span>
			{/if}
		</div>

		<!-- Conflict warning -->
		{#if conflictSan}
			<div class="banner banner--warn">
				You already have <strong>{conflictSan}</strong> here. Remove it first to change your move.
				<button class="banner-dismiss" onclick={() => (conflictSan = null)}>✕</button>
			</div>
		{/if}

		<!-- Error message -->
		{#if errorMsg}
			<div class="banner banner--error">
				{errorMsg}
				<button class="banner-dismiss" onclick={() => (errorMsg = null)}>✕</button>
			</div>
		{/if}

		<!-- Current line -->
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
						<div class="position-move-row">
							<button class="move-nav-btn" onclick={() => navigateTo(m)}>
								{m.san}
							</button>
							<button
								class="move-delete-btn"
								onclick={() => deleteMove(m)}
								disabled={saving}
								title="Remove this move and all moves after it"
							>
								✕
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty-hint">
					{#if isUserTurn}
						No move saved yet — play one on the board.
					{:else}
						No responses yet — play an opponent move to add one.
					{/if}
				</p>
			{/if}
		</div>

		<!-- Candidate moves (book + Stockfish suggestions) -->
		<CandidateMoves {currentFen} onSelectMove={handleCandidateSelect} disabled={saving} />

		<!-- Navigation controls -->
		<div class="nav-controls">
			<button
				class="nav-btn"
				onclick={handleReset}
				disabled={navHistory.length === 0 || saving}
				title="Return to the starting position"
			>
				⏮
			</button>
			<button
				class="nav-btn nav-btn--undo"
				onclick={handleUndo}
				disabled={navHistory.length === 0 || saving}
				title="Go back one move (does not delete from repertoire)"
			>
				← Undo
			</button>
		</div>

		<!-- Saving indicator -->
		{#if saving}
			<div class="saving-indicator">Saving…</div>
		{/if}
	</div>
</div>

<style>
	/* ── Page layout ─────────────────────────────────────────────────────────── */

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

	/* ── Repertoire header ───────────────────────────────────────────────────── */

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

	/* ── Turn indicator ──────────────────────────────────────────────────────── */

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

	.turn-hint {
		font-weight: 400;
		opacity: 0.75;
	}

	/* ── Banners (conflict / error) ──────────────────────────────────────────── */

	.banner {
		position: relative;
		padding: 0.6rem 2rem 0.6rem 0.75rem;
		border-radius: 5px;
		font-size: 0.82rem;
		line-height: 1.4;
	}

	.banner--warn {
		background: rgba(180, 130, 0, 0.15);
		border: 1px solid rgba(180, 130, 0, 0.35);
		color: #d4a820;
	}

	.banner--error {
		background: rgba(160, 40, 40, 0.15);
		border: 1px solid rgba(160, 40, 40, 0.35);
		color: #e06060;
	}

	.banner-dismiss {
		position: absolute;
		top: 50%;
		right: 0.5rem;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: currentColor;
		opacity: 0.6;
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0.1rem 0.2rem;
		line-height: 1;
	}

	.banner-dismiss:hover {
		opacity: 1;
	}

	/* ── Sections ────────────────────────────────────────────────────────────── */

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

	/* ── Move list (current line) ────────────────────────────────────────────── */

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

	/* Black's moves are slightly dimmer to visually distinguish them. */
	.move-san--black {
		color: #909098;
	}

	/* ── Moves from current position ─────────────────────────────────────────── */

	.position-moves {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
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

	.move-delete-btn {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid #1a3a5c;
		border-radius: 4px;
		color: #505060;
		font-size: 0.7rem;
		cursor: pointer;
		transition:
			border-color 0.12s,
			color 0.12s;
		padding: 0;
	}

	.move-delete-btn:hover:not(:disabled) {
		border-color: #c04040;
		color: #e06060;
	}

	.move-delete-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.empty-hint {
		font-size: 0.82rem;
		color: #404050;
		font-style: italic;
		margin: 0;
	}

	/* ── Navigation controls ─────────────────────────────────────────────────── */

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

	.nav-btn--undo {
		flex: 1;
	}

	/* ── Saving indicator ────────────────────────────────────────────────────── */

	.saving-indicator {
		font-size: 0.78rem;
		color: #505060;
		font-style: italic;
		text-align: center;
	}
</style>
