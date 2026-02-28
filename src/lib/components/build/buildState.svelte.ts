/**
 * buildState.svelte.ts — Svelte 5 runes module for Build Mode.
 *
 * All reactive state ($state, $derived) and action functions live here.
 * The +page.svelte imports createBuildState() and wires the returned
 * state/actions to the template and child components.
 */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Chess } from 'chess.js';
import { playMove, playCapture } from '$lib/sounds';

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Shape of a move row as returned by the server / API.
export interface RepertoireMove {
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
// "from" and "to" are the board squares (e.g. "e2", "e4") needed to
// draw the lastMove highlight on the board.
export interface NavEntry {
	fromFen: string;
	toFen: string;
	san: string;
	from: string;
	to: string;
}

// Strip the half-move clock and full-move counter from a FEN string.
// Two positions that differ only in these fields are the same board position
// for repertoire purposes.
export function fenKey(fen: string): string {
	return fen.split(' ').slice(0, 4).join(' ');
}

// Given a FEN and a SAN move, use Chess.js to resolve the from/to squares.
function resolveSquares(fen: string, san: string): [string, string] | undefined {
	try {
		const chess = new Chess(fen);
		const result = chess.move(san);
		return result ? [result.from, result.to] : undefined;
	} catch {
		return undefined;
	}
}

interface CreateBuildStateParams {
	getRepertoireId: () => number;
	getRepertoireColor: () => string;
	getStartFen: () => string | null;
}

export function createBuildState(params: CreateBuildStateParams) {
	// ── Reactive state ───────────────────────────────────────────────────────

	let moves = $state<RepertoireMove[]>([]);
	let navHistory = $state<NavEntry[]>([]);
	let currentFen = $state(STARTING_FEN);
	let lastMove = $state<[string, string] | undefined>(undefined);
	let saving = $state(false);
	let conflictSan = $state<string | null>(null);
	let errorMsg = $state<string | null>(null);
	let transpositionDismissed = $state(false);
	let boardKey = $state(0);
	let startFen = $state<string | null>(null);

	// ── Annotation state ─────────────────────────────────────────────────────

	let annotatingMove = $state<RepertoireMove | null>(null);
	let annotationDraft = $state('');
	let savingAnnotation = $state(false);
	let annotationError = $state<string | null>(null);

	// ── Derived values ───────────────────────────────────────────────────────

	// Quick lookup: normalised FEN key → moves that start from that position.
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

	// True when it is the user's turn at the current board position.
	const isUserTurn = $derived.by(() => {
		try {
			const chess = new Chess(currentFen);
			const turn = chess.turn();
			return (
				(params.getRepertoireColor() === 'WHITE' && turn === 'w') ||
				(params.getRepertoireColor() === 'BLACK' && turn === 'b')
			);
		} catch {
			return true;
		}
	});

	// All saved moves from the current position.
	const movesFromCurrentPosition = $derived(movesFromFen.get(fenKey(currentFen)) ?? []);

	// The FENs from the navigation history, ordered newest-to-oldest.
	const fenHistory = $derived([...navHistory].reverse().map((e) => e.fromFen));

	// The navigation history grouped into move-number pairs for display.
	const movePairs = $derived.by(() => {
		const pairs: [NavEntry, NavEntry | null][] = [];
		for (let i = 0; i < navHistory.length; i += 2) {
			pairs.push([navHistory[i], navHistory[i + 1] ?? null]);
		}
		return pairs;
	});

	// True when the current position is the repertoire's custom start position.
	const isStartPosition = $derived(startFen !== null && fenKey(currentFen) === fenKey(startFen));

	// True when the current position can also be reached via a different move order.
	const transpositionExists = $derived.by(() => {
		if (navHistory.length === 0) return false;
		const lastEntry = navHistory[navHistory.length - 1];
		const currentKey = fenKey(currentFen);
		return moves.some(
			(m) => fenKey(m.toFen) === currentKey && fenKey(m.fromFen) !== fenKey(lastEntry.fromFen)
		);
	});

	// ── Helpers ──────────────────────────────────────────────────────────────

	// Collect all normalised FEN keys reachable from a given position.
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

	// Replay a sequence of SAN moves from the starting position.
	function replayLine(sans: string[]): void {
		let fen = STARTING_FEN;
		const history: NavEntry[] = [];
		for (const san of sans) {
			try {
				const chess = new Chess(fen);
				const result = chess.move(san);
				if (!result) break;
				history.push({
					fromFen: fen,
					toFen: chess.fen(),
					san: result.san,
					from: result.from,
					to: result.to
				});
				fen = chess.fen();
			} catch {
				break;
			}
		}
		if (history.length > 0) {
			navHistory = history;
			currentFen = fen;
			lastMove = [history[history.length - 1].from, history[history.length - 1].to];
		}
	}

	// Sync all local state from server-provided page data.
	function syncFromData(newMoves: RepertoireMove[], jumpLine?: string | null): void {
		moves = newMoves;
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		conflictSan = null;
		errorMsg = null;
		startFen = params.getStartFen();

		if (jumpLine) {
			replayLine(jumpLine.split(',').filter(Boolean));
		}
	}

	// Save any moves from the replayed jump line that aren't already in the
	// user's repertoire. This is needed for Gap Finder deep links: the gap
	// line includes an opponent book move that exists in the opening book but
	// not in the user's move tree. Without saving it, the user's response
	// would be a disconnected leaf in the tree.
	async function saveJumpLineMoves(): Promise<void> {
		if (navHistory.length === 0) return;

		for (const entry of navHistory) {
			const key = fenKey(entry.fromFen);
			const existing = moves.find(
				(m) => fenKey(m.fromFen) === key && m.san === entry.san
			);
			if (existing) continue;

			// This move is in the jump line but not in the user's repertoire — save it.
			try {
				const res = await fetch('/api/moves', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						repertoireId: params.getRepertoireId(),
						fromFen: entry.fromFen,
						san: entry.san
					})
				});

				if (res.ok || res.status === 201) {
					const savedMove: RepertoireMove = await res.json();
					// Only add if not already present (the API returns existing moves for idempotent calls).
					if (!moves.find((m) => m.id === savedMove.id)) {
						moves = [...moves, savedMove];
					}
				}
			} catch {
				// Silently skip — the user can still play from this position,
				// the tree just won't be fully connected until next time.
			}
		}
	}

	// ── Move handler ─────────────────────────────────────────────────────────

	async function handleMove(
		from: string,
		to: string,
		san: string,
		newFen: string,
		isCapture = false
	): Promise<void> {
		conflictSan = null;
		errorMsg = null;

		// If this exact move is already in the repertoire, just navigate.
		const existing = movesFromFen.get(fenKey(currentFen))?.find((m) => m.san === san);
		if (existing) {
			navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
			currentFen = newFen;
			lastMove = [from, to];
			if (isCapture) playCapture();
			else playMove();
			return;
		}

		// On the user's turn, only one move per position is allowed.
		if (isUserTurn && movesFromCurrentPosition.length > 0) {
			conflictSan = movesFromCurrentPosition[0].san;
			boardKey += 1;
			return;
		}

		// New move — save it to the database.
		saving = true;
		try {
			const res = await fetch('/api/moves', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId: params.getRepertoireId(),
					fromFen: currentFen,
					san
				})
			});

			if (res.status === 409) {
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
			if (isCapture) playCapture();
			else playMove();
		} catch {
			errorMsg = 'Network error. Please try again.';
			boardKey += 1;
		} finally {
			saving = false;
		}
	}

	// ── Undo / Reset ─────────────────────────────────────────────────────────

	function handleUndo(): void {
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

	function handleReset(): void {
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		conflictSan = null;
		errorMsg = null;
	}

	// ── Sidebar navigation ───────────────────────────────────────────────────

	function navigateTo(move: RepertoireMove): void {
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
		if (move.san.includes('x')) playCapture();
		else playMove();
	}

	function navigateToHistoryIdx(idx: number): void {
		navHistory = navHistory.slice(0, idx + 1);
		currentFen = navHistory[idx].toFen;
		lastMove =
			navHistory[idx].from && navHistory[idx].to
				? [navHistory[idx].from, navHistory[idx].to]
				: undefined;
		conflictSan = null;
		errorMsg = null;
	}

	// ── Candidate move selection ─────────────────────────────────────────────

	async function handleCandidateSelect(san: string): Promise<void> {
		try {
			const chess = new Chess(currentFen);
			const result = chess.move(san);
			if (result) {
				await handleMove(result.from, result.to, result.san, chess.fen(), !!result.captured);
			}
		} catch {
			errorMsg = 'Could not play the selected move.';
		}
	}

	// ── Deletion ─────────────────────────────────────────────────────────────

	async function deleteMove(move: RepertoireMove): Promise<void> {
		if (saving) return;
		saving = true;
		errorMsg = null;

		try {
			const res = await fetch(`/api/moves/${move.id}`, { method: 'DELETE' });
			if (!res.ok) {
				errorMsg = 'Failed to delete move. Please try again.';
				return;
			}

			const deletedFens = collectSubtreeFens(move.toFen);

			moves = moves.filter((m) => {
				if (m.id === move.id) return false;
				if (deletedFens.has(fenKey(m.fromFen))) return false;
				return true;
			});

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

	// ── Annotation helpers ───────────────────────────────────────────────────

	function openAnnotation(move: RepertoireMove): void {
		annotatingMove = move;
		annotationDraft = move.notes ?? '';
		annotationError = null;
	}

	function closeAnnotation(): void {
		annotatingMove = null;
		annotationDraft = '';
		annotationError = null;
	}

	function annotateLastMove(): void {
		if (navHistory.length === 0) return;
		const last = navHistory[navHistory.length - 1];
		const move = moves.find(
			(m) => fenKey(m.fromFen) === fenKey(last.fromFen) && m.san === last.san
		);
		if (move) openAnnotation(move);
	}

	async function saveAnnotation(): Promise<void> {
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
			moves = moves.map((m) => (m.id === updated.id ? updated : m));
			closeAnnotation();
		} catch {
			annotationError = 'Network error. Please try again.';
		} finally {
			savingAnnotation = false;
		}
	}

	// ── Dismiss helpers ──────────────────────────────────────────────────────

	function dismissConflict(): void {
		conflictSan = null;
	}

	function dismissError(): void {
		errorMsg = null;
	}

	function dismissTransposition(): void {
		transpositionDismissed = true;
	}

	// ── Start position management ───────────────────────────────────────────

	async function setStartPosition(): Promise<void> {
		if (saving) return;
		saving = true;
		errorMsg = null;

		try {
			const res = await fetch(`/api/repertoires/${params.getRepertoireId()}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ startFen: currentFen })
			});

			if (!res.ok) {
				errorMsg = 'Failed to set start position.';
				return;
			}

			startFen = currentFen;
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}

	async function clearStartPosition(): Promise<void> {
		if (saving) return;
		saving = true;
		errorMsg = null;

		try {
			const res = await fetch(`/api/repertoires/${params.getRepertoireId()}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ startFen: null })
			});

			if (!res.ok) {
				errorMsg = 'Failed to clear start position.';
				return;
			}

			startFen = null;
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}

	return {
		// Reactive state (getters/setters so reactivity crosses the module boundary)
		get moves() {
			return moves;
		},
		get navHistory() {
			return navHistory;
		},
		get currentFen() {
			return currentFen;
		},
		get lastMove() {
			return lastMove;
		},
		get saving() {
			return saving;
		},
		get conflictSan() {
			return conflictSan;
		},
		get errorMsg() {
			return errorMsg;
		},
		get transpositionDismissed() {
			return transpositionDismissed;
		},
		get boardKey() {
			return boardKey;
		},

		// Annotation state
		get annotatingMove() {
			return annotatingMove;
		},
		get annotationDraft() {
			return annotationDraft;
		},
		set annotationDraft(v: string) {
			annotationDraft = v;
		},
		get savingAnnotation() {
			return savingAnnotation;
		},
		get annotationError() {
			return annotationError;
		},

		// Derived
		get isUserTurn() {
			return isUserTurn;
		},
		get movesFromCurrentPosition() {
			return movesFromCurrentPosition;
		},
		get fenHistory() {
			return fenHistory;
		},
		get movePairs() {
			return movePairs;
		},
		get transpositionExists() {
			return transpositionExists;
		},
		get startFen() {
			return startFen;
		},
		get isStartPosition() {
			return isStartPosition;
		},

		// Actions
		syncFromData,
		saveJumpLineMoves,
		handleMove,
		handleUndo,
		handleReset,
		navigateTo,
		navigateToHistoryIdx,
		handleCandidateSelect,
		deleteMove,
		openAnnotation,
		closeAnnotation,
		annotateLastMove,
		saveAnnotation,
		dismissConflict,
		dismissError,
		dismissTransposition,
		setStartPosition,
		clearStartPosition
	};
}

export type BuildState = ReturnType<typeof createBuildState>;
