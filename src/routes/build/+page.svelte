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
	import OpeningName from '$lib/components/OpeningName.svelte';
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

	// True when the user has dismissed the transposition notice at the current position.
	// Reset automatically whenever currentFen changes so it reappears at each new transposition.
	let transpositionDismissed = $state(false);

	// Incrementing this key forces ChessBoard to remount, which resets the visual
	// board state to `currentFen`. We use this to snap a piece back after a
	// rejected move (conflict or error).
	let boardKey = $state(0);

	// ── Annotation editing ────────────────────────────────────────────────────────

	// The move currently being annotated. null means the modal is closed.
	let annotatingMove = $state<RepertoireMove | null>(null);

	// The current value of the textarea while the modal is open.
	let annotationDraft = $state('');

	// True while a PATCH request for notes is in-flight.
	let savingAnnotation = $state(false);

	// Error message specific to annotation saving (distinct from the main errorMsg).
	let annotationError = $state<string | null>(null);

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

	// Reset the transposition dismissed flag whenever the user navigates to a new position.
	// This ensures the banner reappears at every new transposition position.
	$effect(() => {
		currentFen; // tracked — changing this FEN re-runs the effect
		transpositionDismissed = false;
	});

	// ── Derived values ───────────────────────────────────────────────────────────

	// Quick lookup: normalised FEN key → moves that start from that position.
	// Keys use only the first 4 FEN fields (position + side + castling + en-passant),
	// stripping the half-move clock and full-move counter. This means two paths that
	// reach the same board position will map to the same bucket even if their
	// half-move clocks differ — which is exactly what we want for transpositions.
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
	// Uses the normalised key so transposition positions show the same continuation
	// moves regardless of which path the user took to arrive here.
	const movesFromCurrentPosition = $derived(movesFromFen.get(fenKey(currentFen)) ?? []);

	// The FENs from the navigation history, ordered newest-to-oldest.
	// Passed to OpeningName so it can walk backwards to find the deepest
	// recognised ECO position even if the exact current FEN has no entry.
	// Each navHistory entry's fromFen is the board state BEFORE that move,
	// so reversing gives us: (position before last move), ..., starting FEN.
	const fenHistory = $derived([...navHistory].reverse().map((e) => e.fromFen));

	// The navigation history grouped into move-number pairs for display.
	// e.g. [[e4, e5], [Nf3, Nc6]] represents "1. e4 e5 2. Nf3 Nc6"
	const movePairs = $derived.by(() => {
		const pairs: [NavEntry, NavEntry | null][] = [];
		for (let i = 0; i < navHistory.length; i += 2) {
			pairs.push([navHistory[i], navHistory[i + 1] ?? null]);
		}
		return pairs;
	});

	// Strip the half-move clock and full-move counter from a FEN string.
	// Two positions that differ only in these fields are the same board position
	// for repertoire purposes. Without this, transpositions reached via different
	// move orders produce different half-move clock values and the string comparison
	// would miss them (e.g. "... - 0 3" vs "... - 2 3").
	function fenKey(fen: string): string {
		return fen.split(' ').slice(0, 4).join(' ');
	}

	// True when the current position can also be reached via a different move order
	// than the one in navHistory. We detect this by checking whether any saved move
	// leads to currentFen from a different fromFen than the one we arrived from.
	// FENs are compared by position only (first 4 fields) to handle the half-move
	// clock mismatch that transpositions naturally produce.
	const transpositionExists = $derived.by(() => {
		if (navHistory.length === 0) return false;
		const lastEntry = navHistory[navHistory.length - 1];
		const currentKey = fenKey(currentFen);
		return moves.some(
			(m) => fenKey(m.toFen) === currentKey && fenKey(m.fromFen) !== fenKey(lastEntry.fromFen)
		);
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

	// Collect all normalised FEN keys reachable from a given position in the local
	// move tree. Used after a deletion to figure out which local state entries to
	// remove. The visited set stores normalised keys to prevent infinite loops and
	// to correctly match moves stored with different half-move clock values.
	function collectSubtreeFens(startFen: string): SvelteSet<string> {
		const visited = new SvelteSet<string>();
		const queue = [startFen];
		while (queue.length > 0) {
			const fen = queue.shift()!;
			const key = fenKey(fen);
			if (visited.has(key)) continue;
			visited.add(key);
			for (const child of movesFromFen.get(key) ?? []) {
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
		// Normalised key lookup so a transposition position finds moves saved via
		// the other path rather than trying to save a duplicate.
		const existing = movesFromFen.get(fenKey(currentFen))?.find((m) => m.san === san);
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
			// Compare using normalised keys to catch moves stored with different
			// half-move clocks (e.g. the same position reached via a transposition).
			moves = moves.filter((m) => {
				if (m.id === move.id) return false;
				if (deletedFens.has(fenKey(m.fromFen))) return false;
				return true;
			});

			// If the user is currently at a position inside the deleted subtree,
			// navigate back to where the deleted move started.
			if (fenKey(currentFen) === fenKey(move.toFen) || deletedFens.has(fenKey(currentFen))) {
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

	// ── Annotation helpers ────────────────────────────────────────────────────────

	// Open the annotation modal for a specific move.
	function openAnnotation(move: RepertoireMove) {
		annotatingMove = move;
		annotationDraft = move.notes ?? '';
		annotationError = null;
	}

	// Close the modal and discard any unsaved changes.
	function closeAnnotation() {
		annotatingMove = null;
		annotationDraft = '';
		annotationError = null;
	}

	// Open the annotation modal for the move that led to the current position.
	// Used by the "✎" button in the nav controls so the user can annotate the
	// last move without having to step back first.
	function annotateLastMove() {
		if (navHistory.length === 0) return;
		const last = navHistory[navHistory.length - 1];
		const move = moves.find(
			(m) => fenKey(m.fromFen) === fenKey(last.fromFen) && m.san === last.san
		);
		if (move) openAnnotation(move);
	}

	// Save the current draft to the server and update local state.
	async function saveAnnotation() {
		if (!annotatingMove) return;
		savingAnnotation = true;
		annotationError = null;

		const notes = annotationDraft.trim() === '' ? null : annotationDraft.trim();

		try {
			const res = await fetch(`/api/moves/${annotatingMove.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notes })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				annotationError = body.message ?? 'Failed to save annotation.';
				return;
			}

			const updated: RepertoireMove = await res.json();

			// Replace the updated move in local state so the notes display refreshes.
			moves = moves.map((m) => (m.id === updated.id ? updated : m));

			closeAnnotation();
		} catch {
			annotationError = 'Network error. Please try again.';
		} finally {
			savingAnnotation = false;
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

		<!-- ECO opening name (updates as moves are played) -->
		<OpeningName {currentFen} {fenHistory} />

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

		<!-- Transposition notice -->
		{#if transpositionExists && !transpositionDismissed}
			<div class="banner banner--info">
				<strong>Transposition</strong> — this position is already in your repertoire via a
				different move order. Your existing preparation applies here.
				<button class="banner-dismiss" onclick={() => (transpositionDismissed = true)}>✕</button>
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
						<div class="position-move-item">
							<div class="position-move-row">
								<button class="move-nav-btn" onclick={() => navigateTo(m)}>
									{m.san}
								</button>
								<button
									class="move-annotate-btn"
									onclick={() => openAnnotation(m)}
									title="Add or edit annotation"
									aria-label="Edit annotation for {m.san}"
								>
									✎
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
							{#if m.notes}
								<p class="move-notes">{m.notes.length > 80 ? m.notes.slice(0, 80) + '…' : m.notes}</p>
							{/if}
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
			<button
				class="nav-btn nav-btn--annotate"
				onclick={annotateLastMove}
				disabled={navHistory.length === 0 || saving}
				title="Annotate the last move"
			>
				✎
			</button>
		</div>

		<!-- Saving indicator -->
		{#if saving}
			<div class="saving-indicator">Saving…</div>
		{/if}
	</div>

	<!-- ── Annotation modal ──────────────────────────────────────────────────────────────────────── -->
	{#if annotatingMove}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={closeAnnotation}
			onkeydown={(e) => e.key === 'Escape' && closeAnnotation()}
		>
			<div
				class="modal"
				role="presentation"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<div class="modal-header">
					<span class="modal-title">Annotation — <strong>{annotatingMove.san}</strong></span>
					<button class="modal-close" onclick={closeAnnotation} aria-label="Close">✕</button>
				</div>
				<textarea
					class="annotation-textarea"
					bind:value={annotationDraft}
					placeholder="Add a note about this move…"
					maxlength="500"
					rows="4"
					disabled={savingAnnotation}
				></textarea>
				<div class="annotation-char-count">{annotationDraft.length}/500</div>
				{#if annotationError}
					<p class="annotation-error">{annotationError}</p>
				{/if}
				<div class="modal-actions">
					<button
						class="modal-btn modal-btn--cancel"
						onclick={closeAnnotation}
						disabled={savingAnnotation}
					>
						Cancel
					</button>
					<button
						class="modal-btn modal-btn--save"
						onclick={saveAnnotation}
						disabled={savingAnnotation}
					>
						{savingAnnotation ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	{/if}
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

	.banner--info {
		background: rgba(40, 100, 160, 0.15);
		border: 1px solid rgba(40, 100, 160, 0.35);
		color: #60a0d0;
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

	.nav-btn--annotate {
		flex-shrink: 0;
	}

	/* ── Saving indicator ────────────────────────────────────────────────────── */

	.saving-indicator {
		font-size: 0.78rem;
		color: #505060;
		font-style: italic;
		text-align: center;
	}

	/* ── Annotation UI ───────────────────────────────────────────────────────── */

	.position-move-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.move-notes {
		font-size: 0.75rem;
		color: #6878a0;
		font-style: italic;
		margin: 0 0 0 0.25rem;
		line-height: 1.35;
		word-break: break-word;
	}

	.move-annotate-btn {
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
		font-size: 0.75rem;
		cursor: pointer;
		padding: 0;
		transition:
			border-color 0.12s,
			color 0.12s;
	}

	.move-annotate-btn:hover {
		border-color: #4a6a9a;
		color: #a0b0d0;
	}

	/* ── Annotation modal ────────────────────────────────────────────────────── */

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: #111827;
		border: 1px solid #1a3a5c;
		border-radius: 8px;
		padding: 1.25rem;
		width: 360px;
		max-width: calc(100vw - 2rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-title {
		font-size: 0.875rem;
		color: #c0c0d0;
	}

	.modal-close {
		background: none;
		border: none;
		color: #505060;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		line-height: 1;
	}

	.modal-close:hover {
		color: #a0a0b0;
	}

	.annotation-textarea {
		width: 100%;
		background: #0d1520;
		border: 1px solid #1a3a5c;
		border-radius: 4px;
		color: #c0c0d0;
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.5;
		padding: 0.5rem 0.65rem;
		resize: vertical;
		box-sizing: border-box;
	}

	.annotation-textarea:focus {
		outline: none;
		border-color: #4a6a9a;
	}

	.annotation-textarea:disabled {
		opacity: 0.5;
	}

	.annotation-char-count {
		font-size: 0.72rem;
		color: #404050;
		text-align: right;
		margin-top: -0.4rem;
	}

	.annotation-error {
		font-size: 0.8rem;
		color: #e06060;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.modal-btn {
		padding: 0.4rem 1rem;
		border-radius: 4px;
		font-size: 0.875rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.12s,
			background 0.12s,
			color 0.12s;
	}

	.modal-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.modal-btn--cancel {
		background: none;
		border: 1px solid #1a3a5c;
		color: #a0a0b0;
	}

	.modal-btn--cancel:hover:not(:disabled) {
		border-color: #4a6a9a;
		color: #d0d0e0;
	}

	.modal-btn--save {
		background: #0f3460;
		border: 1px solid #1a5090;
		color: #c8d8f0;
	}

	.modal-btn--save:hover:not(:disabled) {
		background: #1a4a7a;
		border-color: #2a6aaa;
		color: #e0eeff;
	}
</style>
