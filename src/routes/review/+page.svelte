<!--
	Review Mode — /review
	─────────────────────
	Analyse a played game against the user's opening repertoire.

	STATES
	──────
	input    — PGN textarea + color selector, recent review history
	analysis — board + issue list + notes + save
	saved    — confirmation screen

	ISSUE TYPES
	───────────
	DEVIATION         — user's turn; played a different move than repertoire
	BEYOND_REPERTOIRE — user's turn; no repertoire move at all for this position
	OPPONENT_SURPRISE — opponent's turn; played a move user hasn't prepared for

	For each issue the user can: resolve it (fail card, add to repertoire, etc.)
	or skip it. All issues are shown upfront; clicking any jumps the board there.
-->

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import { enhance } from '$app/forms';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { PageData } from './$types';
	import type { GameAnalysis, GameIssue } from '$lib/pgn';
	import { initSounds, setSoundEnabled, playMove, playCapture } from '$lib/sounds';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { Key } from '@lichess-org/chessground/types';
	import { Chess } from 'chess.js';

	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	// ── Input state ─────────────────────────────────────────────────────────────

	let pgnText = $state('');
	// Default to the active repertoire's color; user can override before submitting.
	// Use $effect so this stays in sync if the active repertoire changes (e.g. after navigation).
	// playerColor is user-writable (color toggle sets it), so $derived alone won't work.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let playerColor = $state<'WHITE' | 'BLACK'>('WHITE');
	$effect(() => {
		playerColor = data.repertoire.color as 'WHITE' | 'BLACK';
	});
	let analysing = $state(false);
	let analysisError = $state<string | null>(null);

	// ── Analysis state ──────────────────────────────────────────────────────────

	let analysis = $state<GameAnalysis | null>(null);
	let parsedPgn = $state<string | null>(null);
	let analysisHeaders = $state<Record<string, string>>({});
	let analysedPlayerColor = $state<'WHITE' | 'BLACK'>('WHITE');
	let currentPlyIdx = $state(0); // 0 = starting position, N = position after ply N
	let isAutoPlaying = $state(false);
	let autoPlayTarget = $state<number | null>(null);
	let resolvedIssues = new SvelteSet<number>(); // issue.ply values of resolved issues
	let opponentMoveAdded = new SvelteSet<number>(); // OPPONENT_SURPRISE issues where phase 1 is done
	let notes = $state('');

	// ── Chain extension state ────────────────────────────────────────────────────
	// After a user adds their game response (OPPONENT_SURPRISE phase 2) or their
	// own move (BEYOND_REPERTOIRE phase 1), if there are more game moves we offer
	// to keep building the repertoire. Each "leg" of the chain represents one
	// pending opponent-move → user-response pair still waiting to be added.

	interface ChainLeg {
		opponentFen: string; // FEN where the opponent needs to move (user just added a move here)
		opponentSan: string; // what the opponent played in the actual game
		opponentAdded: boolean; // true once the opponent's move has been saved to the repertoire
		userFen: string | null; // FEN after the opponent's move (where user must respond), or null if game ended
		userSan: string | null; // user's actual in-game response, or null if game ended
		plyInGame: number; // 1-indexed ply of the opponent's move (used to advance the chain)
	}

	// Keyed by issue.ply — only one active chain leg per issue at a time.
	let chainExtensions = new SvelteMap<number, ChainLeg>();

	// Eval (centipawns, White's perspective) for the user's actual game move at each phase,
	// so it can be shown alongside engine candidates for comparison. Keyed by issue.ply.
	// undefined = not yet fetched; null = fetched but Stockfish unavailable.
	let userMoveEvals = new SvelteMap<number, number | null>();

	// Per-issue Stockfish state (keyed by issue.ply).
	let stockfishLoading = new SvelteMap<number, boolean>();
	// Evals for DEVIATION issues: evalCp from White's perspective after each move.
	// Fetched in the background when analysis loads; populated as results arrive.
	let deviationEvals = new SvelteMap<number, { played: number | null; correct: number | null }>();
	const deviationFetching = new SvelteSet<number>(); // dedup guard — tracks in-flight fetches
	let stockfishSuggestions = new SvelteMap<
		number,
		{ san: string; evalCp: number | null; isBook: boolean; openingName: string | null }[]
	>();
	let actionLoading = new SvelteMap<number, boolean>();

	// ── Masters data for DEVIATION issues (lazy-loaded on expand) ───────────────

	interface MastersMove {
		san: string;
		white: number;
		draws: number;
		black: number;
		totalGames: number;
	}

	let deviationMasters = new SvelteMap<number, MastersMove[]>();
	let deviationMastersLoading = new SvelteMap<number, boolean>();
	let deviationMastersError = new SvelteMap<number, boolean>();
	let deviationMastersExpanded = new SvelteSet<number>();

	// ── Save state ──────────────────────────────────────────────────────────────

	let saving = $state(false);
	let savedId = $state<number | null>(null);

	onMount(() => {
		initSounds();
	});

	// Keep the sounds module in sync with the user's saved preference.
	// This reacts to changes from the settings page (via invalidateAll).
	$effect(() => {
		setSoundEnabled(data.settings?.soundEnabled ?? true);
	});

	// ── Sync from form action result ────────────────────────────────────────────

	// When the analyzeGame action succeeds, store the result in local state.
	// When it fails, show the error. We avoid reading form data directly in the
	// template because the form prop resets on page invalidation.
	$effect(() => {
		if (!form) return;

		if (typeof form.error === 'string') {
			analysisError = form.error;
			analysing = false;
			return;
		}

		if (form.analysis) {
			analysis = form.analysis as GameAnalysis;
			parsedPgn = form.parsedPgn as string;
			analysisHeaders = (form.headers as Record<string, string>) ?? {};
			analysedPlayerColor = (form.playerColor as 'WHITE' | 'BLACK') ?? 'WHITE';

			// Reset per-analysis state. Wrap reactive collection clears in
			// untrack so they don't register as dependencies of this $effect
			// (mutations from background fetches would otherwise re-trigger it).
			currentPlyIdx = 0;
			notes = '';
			savedId = null;
			analysisError = null;
			untrack(() => {
				resolvedIssues.clear();
				opponentMoveAdded.clear();
				chainExtensions.clear();
				userMoveEvals.clear();
				stockfishLoading.clear();
				stockfishSuggestions.clear();
				actionLoading.clear();
				deviationEvals.clear();
				deviationFetching.clear();
				deviationMasters.clear();
				deviationMastersLoading.clear();
				deviationMastersError.clear();
				deviationMastersExpanded.clear();
			});

			// Auto-play from the start up to the first issue (or end of game if clean).
			const loaded = form.analysis as GameAnalysis;
			const targetPly =
				loaded.issues.length > 0 ? loaded.issues[0].ply : loaded.fenHistory.length - 1;
			untrack(() => startAutoPlay(targetPly));

			// Fetch evals for DEVIATION issues in the background (fire and forget).
			for (const issue of loaded.issues) {
				if (issue.type === 'DEVIATION') fetchDeviationEvals(issue);
			}
		}
	});

	// ── Derived values ──────────────────────────────────────────────────────────

	// Which UI state are we in?
	const pageState = $derived<'input' | 'analysis' | 'saved'>(
		savedId !== null ? 'saved' : analysis !== null ? 'analysis' : 'input'
	);

	// The FEN currently shown on the board.
	const currentFen = $derived(
		analysis ? (analysis.fenHistory[currentPlyIdx] ?? STARTING_FEN) : STARTING_FEN
	);

	// Last move for the yellow highlight on the board.
	const lastMove = $derived<[string, string] | undefined>(
		analysis && currentPlyIdx > 0
			? [analysis.fromSquares[currentPlyIdx - 1], analysis.toSquares[currentPlyIdx - 1]]
			: undefined
	);

	// Board orientation — Black side at bottom for Black repertoires.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// FEN history for OpeningName (positions from newest to oldest, without currentFen).
	const openingFenHistory = $derived(
		analysis ? analysis.fenHistory.slice(0, currentPlyIdx).reverse() : []
	);

	// Lookup map: issue.ply → GameIssue (for quick colour lookups in the move list).
	const issueByPly = $derived(
		analysis ? new Map(analysis.issues.map((iss) => [iss.ply, iss])) : new Map<number, GameIssue>()
	);

	// The ply after which analysis stopped (off-book territory).
	const cutoffPly = $derived(
		!analysis || analysis.issues.length === 0
			? Number.MAX_SAFE_INTEGER
			: (() => {
					const last = analysis.issues[analysis.issues.length - 1];
					return last.type === 'OPPONENT_SURPRISE' ? last.ply + 1 : last.ply;
				})()
	);

	// ── Auto-play ────────────────────────────────────────────────────────────────

	function stopAutoPlay(): void {
		autoPlayTarget = null;
		isAutoPlaying = false;
	}

	function startAutoPlay(targetPly: number): void {
		if (currentPlyIdx >= targetPly) return;
		autoPlayTarget = targetPly;
		isAutoPlaying = true;
	}

	// Play the correct sound when advancing forward to `ply`.
	function playMoveSound(ply: number): void {
		const san = analysis?.sanHistory[ply - 1] ?? '';
		if (san.includes('x')) playCapture();
		else playMove();
	}

	// Move forward one ply — cancels auto-play, plays sound.
	function goForward(): void {
		stopAutoPlay();
		if (!analysis) return;
		const next = Math.min(analysis.fenHistory.length - 1, currentPlyIdx + 1);
		if (next !== currentPlyIdx) {
			currentPlyIdx = next;
			playMoveSound(next);
		}
	}

	// Move backward one ply — cancels auto-play, no sound.
	function goBack(): void {
		stopAutoPlay();
		currentPlyIdx = Math.max(0, currentPlyIdx - 1);
	}

	// Drives auto-play animation. This $effect re-runs whenever currentPlyIdx
	// or autoPlayTarget changes. It schedules the next increment 500ms out,
	// and the cleanup return value cancels any pending timer automatically —
	// this is the correct Svelte 5 pattern for timer-driven animation.
	$effect(() => {
		if (autoPlayTarget === null || currentPlyIdx >= autoPlayTarget) return;

		const nextPly = currentPlyIdx + 1;
		// Capture SAN synchronously so the setTimeout closure has it without
		// needing to read reactive state inside the async callback.
		const san = analysis?.sanHistory[nextPly - 1] ?? '';

		const timer = setTimeout(() => {
			currentPlyIdx = nextPly;
			if (san.includes('x')) playCapture();
			else playMove();
			if (nextPly >= (autoPlayTarget ?? 0)) {
				autoPlayTarget = null;
				isAutoPlaying = false;
			}
		}, 500);

		return () => clearTimeout(timer);
	});

	// ── Keyboard navigation ─────────────────────────────────────────────────────

	$effect(() => {
		if (pageState !== 'analysis' || !analysis) return;

		function handleKey(e: KeyboardEvent) {
			if (!analysis) return;
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			if (e.ctrlKey || e.altKey || e.metaKey) return;

			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				goBack();
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				goForward();
			}
		}

		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	});

	// ── Helpers ─────────────────────────────────────────────────────────────────

	// Jump the board to the position after the issue move.
	function jumpToIssue(issue: GameIssue): void {
		currentPlyIdx = issue.ply;
	}

	// Compute the from/to squares of a SAN move from a given FEN.
	// Returns null if the move is illegal or the SAN is unrecognised.
	function getMoveSquares(fen: string, san: string): { from: string; to: string } | null {
		try {
			const chess = new Chess(fen);
			const result = chess.move(san);
			if (!result) return null;
			return { from: result.from, to: result.to };
		} catch {
			return null;
		}
	}

	// Build response arrows for a position where the user is choosing a move to add.
	// Blue = the user's actual game move (primary button colour).
	// Yellow = engine candidate (engine button colour).
	// Green = book candidate (book button colour).
	// Skips any candidate whose SAN duplicates the game move (already shown in blue).
	function buildResponseArrows(
		fromFen: string,
		gameSan: string | null,
		candidates: { san: string; isBook: boolean }[]
	): DrawShape[] {
		const shapes: DrawShape[] = [];
		const shown = new SvelteSet<string>();

		if (gameSan) {
			const sq = getMoveSquares(fromFen, gameSan);
			if (sq) {
				shapes.push({ orig: sq.from as Key, dest: sq.to as Key, brush: 'blue' });
				shown.add(gameSan);
			}
		}

		for (const c of candidates) {
			if (shown.has(c.san)) continue;
			const sq = getMoveSquares(fromFen, c.san);
			if (sq) {
				shapes.push({
					orig: sq.from as Key,
					dest: sq.to as Key,
					brush: c.isBook ? 'green' : 'yellow'
				});
				shown.add(c.san);
			}
		}

		return shapes;
	}

	// Overlay arrows on the board when the current position matches an active issue phase.
	//
	// DEVIATION             — red = wrong move; green = correct repertoire move.
	// OPPONENT_SURPRISE ph2 — blue = game response; yellow/green = engine/book candidates.
	// Chain phase A         — red = opponent's proposed move.
	// Chain phase B         — blue = game response; yellow/green = engine/book candidates.
	const boardShapes = $derived.by((): DrawShape[] => {
		if (!analysis) return [];

		// DEVIATION: red for the wrong move, green for the correct one.
		const dev = analysis.issues.find(
			(iss) => iss.type === 'DEVIATION' && currentPlyIdx === iss.ply
		);
		if (dev && dev.repertoireSan) {
			const shapes: DrawShape[] = [];
			const wFrom = analysis.fromSquares[dev.ply - 1];
			const wTo = analysis.toSquares[dev.ply - 1];
			if (wFrom && wTo) shapes.push({ orig: wFrom as Key, dest: wTo as Key, brush: 'red' });
			const correct = getMoveSquares(dev.fromFen, dev.repertoireSan);
			if (correct)
				shapes.push({ orig: correct.from as Key, dest: correct.to as Key, brush: 'green' });
			return shapes;
		}

		// All other issue types — find the first one whose active phase matches the board.
		for (const issue of analysis.issues) {
			if (resolvedIssues.has(issue.ply)) continue;
			const chainLeg = chainExtensions.get(issue.ply) ?? null;
			const candidates = stockfishSuggestions.get(issue.ply) ?? [];

			// Chain phase A: board is one ply before the chain opponent's move — show it as red.
			if (chainLeg && !chainLeg.opponentAdded && currentPlyIdx === chainLeg.plyInGame - 1) {
				const sq = getMoveSquares(chainLeg.opponentFen, chainLeg.opponentSan);
				return sq ? [{ orig: sq.from as Key, dest: sq.to as Key, brush: 'red' }] : [];
			}

			// Chain phase B: board is at the position after the chain opponent's move —
			// show the user's available response choices.
			if (
				chainLeg &&
				chainLeg.opponentAdded &&
				chainLeg.userFen &&
				currentPlyIdx === chainLeg.plyInGame
			) {
				return buildResponseArrows(chainLeg.userFen, chainLeg.userSan, candidates);
			}

			// OPPONENT_SURPRISE phase 2: board is at issue.toFen (after opponent's surprise move) —
			// show the user's available response choices.
			if (
				issue.type === 'OPPONENT_SURPRISE' &&
				opponentMoveAdded.has(issue.ply) &&
				!chainLeg &&
				currentPlyIdx === issue.ply
			) {
				return buildResponseArrows(issue.toFen, issue.userResponseSan, candidates);
			}
		}

		return [];
	});

	// Fetch Stockfish evals for a DEVIATION issue (wrong move and correct alternative).
	// Both positions are evaluated in parallel and results stored in deviationEvals.
	// evalCp is always from White's perspective (positive = White better).
	async function fetchDeviationEvals(issue: GameIssue): Promise<void> {
		if (deviationFetching.has(issue.ply)) return;
		deviationFetching.add(issue.ply);
		try {
			// Compute the FEN after the correct repertoire move.
			let correctToFen: string | null = null;
			if (issue.repertoireSan) {
				try {
					const chess = new Chess(issue.fromFen);
					chess.move(issue.repertoireSan);
					correctToFen = chess.fen();
				} catch {
					/* ignore */
				}
			}

			const evalPos = async (fen: string): Promise<number | null> => {
				try {
					const res = await fetch('/api/stockfish', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ fen, numMoves: 1 })
					});
					if (!res.ok) return null;
					const data = (await res.json()) as { candidates?: { evalCp: number | null }[] };
					return data.candidates?.[0]?.evalCp ?? null;
				} catch {
					return null;
				}
			};

			const [playedEval, correctEval] = await Promise.all([
				evalPos(issue.toFen),
				correctToFen ? evalPos(correctToFen) : Promise.resolve(null)
			]);

			deviationEvals.set(issue.ply, { played: playedEval, correct: correctEval });
		} finally {
			deviationFetching.delete(issue.ply);
		}
	}

	// Format a centipawn eval as a short string from the player's perspective.
	// evalCp from the server is always White's perspective; flip the sign for
	// Black players so that positive always means "good for me".
	function formatEval(cp: number): string {
		const playerCp = analysedPlayerColor === 'BLACK' ? -cp : cp;
		const pawns = Math.abs(playerCp) / 100;
		if (playerCp === 0) return '(=)';
		return playerCp > 0 ? `(+${pawns.toFixed(1)})` : `(−${pawns.toFixed(1)})`;
	}

	// Same flip logic for candidate move buttons (evalCp may be null when book-only).
	function formatCandidateEval(evalCp: number | null): string {
		if (evalCp === null) return '';
		const playerCp = analysedPlayerColor === 'BLACK' ? -evalCp : evalCp;
		return ` (${playerCp >= 0 ? '+' : ''}${(playerCp / 100).toFixed(1)})`;
	}

	// Return a CSS class for an eval badge based on player-perspective centipawns.
	function evalBadgeClass(cp: number): string {
		const playerCp = analysedPlayerColor === 'BLACK' ? -cp : cp;
		if (playerCp > 50) return 'eval-badge-good';
		if (playerCp < -50) return 'eval-badge-bad';
		return 'eval-badge-neutral';
	}

	// Fetch Lichess Masters top moves for a DEVIATION's position (lazy, cache-first).
	async function fetchDeviationMasters(issue: GameIssue): Promise<void> {
		if (deviationMasters.has(issue.ply) || deviationMastersLoading.get(issue.ply)) return;
		deviationMastersLoading.set(issue.ply, true);
		deviationMastersError.set(issue.ply, false);
		try {
			const res = await fetch(`/api/masters?fen=${encodeURIComponent(issue.fromFen)}`);
			if (!res.ok) throw new Error('Masters fetch failed');
			const data = await res.json();
			deviationMasters.set(issue.ply, ((data.moves as MastersMove[]) ?? []).slice(0, 5));
		} catch {
			deviationMastersError.set(issue.ply, true);
		} finally {
			deviationMastersLoading.set(issue.ply, false);
		}
	}

	// Toggle Masters section visibility for a DEVIATION issue; lazy-fetch on first expand.
	function toggleMasters(issue: GameIssue): void {
		if (deviationMastersExpanded.has(issue.ply)) {
			deviationMastersExpanded.delete(issue.ply);
		} else {
			deviationMastersExpanded.add(issue.ply);
			fetchDeviationMasters(issue);
		}
	}

	// Resolve an issue without any action (skip).
	function resolveIssue(ply: number): void {
		resolvedIssues.add(ply);
	}

	// Convert a 1-indexed ply to a move number string, e.g. ply 3 → "2." (White).
	function plyToLabel(ply: number): string {
		const moveNum = Math.ceil(ply / 2);
		const isWhitePly = ply % 2 === 1;
		return isWhitePly ? `${moveNum}.` : `${moveNum}…`;
	}

	// CSS colour for a move in the move list.
	function getMoveColor(ply: number): string {
		const issue = issueByPly.get(ply);
		if (issue) {
			if (issue.type === 'DEVIATION') return 'var(--color-gold-dim)';
			if (issue.type === 'BEYOND_REPERTOIRE') return 'var(--color-gold)';
			if (issue.type === 'OPPONENT_SURPRISE') return 'var(--color-danger)';
		}
		if (ply > cutoffPly) return 'var(--color-text-muted)'; // dim — off-book

		const isUserPly =
			(analysedPlayerColor === 'WHITE' && ply % 2 === 1) ||
			(analysedPlayerColor === 'BLACK' && ply % 2 === 0);
		return isUserPly ? 'var(--color-success)' : 'var(--color-text-secondary)';
	}

	// ── Issue resolution actions ─────────────────────────────────────────────────

	async function callApi(path: string, body: Record<string, unknown>): Promise<boolean> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		return res.ok;
	}

	// Case 1 — DEVIATION: mark FSRS card as failed.
	async function handleFailCard(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/fail-card', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen
			});
			resolveIssue(issue.ply);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 1 — DEVIATION: update repertoire to the move the user actually played,
	// and also fail the SR card.
	async function handleUpdateRepertoire(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		try {
			// Fail the card first (it's a deviation regardless of what we do with the repertoire).
			await callApi('/api/review/fail-card', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen
			});
			// Replace the existing move in the repertoire with what the user played.
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan,
				forceReplace: true
			});
			resolveIssue(issue.ply);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 2 — BEYOND_REPERTOIRE: add the move the user actually played.
	// After adding, check if there's a next opponent move in the game — if so,
	// start a chain extension rather than resolving immediately.
	async function handleAddMyMove(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			// The next move after the user's ply is the opponent's — start a chain if it exists.
			const leg = buildChainLeg(issue.ply + 1);
			if (leg) {
				currentPlyIdx = issue.ply; // advance board to position after user's move
				chainExtensions.set(issue.ply, leg);
			} else {
				resolveIssue(issue.ply);
			}
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 3 — OPPONENT_SURPRISE, phase 1: add only the opponent's move.
	// Moves the card to phase 2 where the user picks their response, and
	// immediately kicks off an engine fetch so candidates are ready without
	// requiring the user to click "Engine suggestion" manually.
	async function handleAddOpponentMove(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			opponentMoveAdded.add(issue.ply);
			// Fire both fetches in the background so the spinner clears immediately.
			// Engine candidates and the user's game move eval load in parallel.
			fetchEngineSuggestion(issue);
			fetchUserMoveEval(issue.ply, issue.toFen, issue.userResponseSan);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 3 — OPPONENT_SURPRISE, phase 2: add the user's actual in-game response.
	// After adding, check if there's a next opponent move in the game — if so,
	// start a chain extension rather than resolving immediately.
	async function handleAddUserResponse(issue: GameIssue): Promise<void> {
		if (!issue.userResponseSan) return;
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.toFen,
				san: issue.userResponseSan
			});
			// issue.ply is the opponent's ply; +1 is the user's response; +2 is the next opponent move.
			const leg = buildChainLeg(issue.ply + 2);
			if (leg) {
				currentPlyIdx = issue.ply + 1; // advance board to position after user's response
				userMoveEvals.delete(issue.ply); // clear stale eval from the original phase 2
				chainExtensions.set(issue.ply, leg);
			} else {
				resolveIssue(issue.ply);
			}
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Build a chain leg for a given opponent ply in the game.
	// Returns null if there are no more game moves at that ply (game ended).
	function buildChainLeg(opponentPlyInGame: number): ChainLeg | null {
		if (!analysis) return null;
		const sanIdx = opponentPlyInGame - 1; // convert 1-indexed ply to 0-indexed array position
		if (sanIdx >= analysis.sanHistory.length) return null; // no such ply in the game

		const opponentSan = analysis.sanHistory[sanIdx];
		const opponentFen = analysis.fenHistory[sanIdx]; // FEN before the opponent's move
		const userFen = analysis.fenHistory[opponentPlyInGame] ?? null; // FEN after opponent's move
		const userSan = analysis.sanHistory[opponentPlyInGame] ?? null; // user's game response (may not exist)

		return {
			opponentFen,
			opponentSan,
			opponentAdded: false,
			userFen,
			userSan,
			plyInGame: opponentPlyInGame
		};
	}

	// Core engine fetch — accepts a FEN and key directly so it can be used for both
	// original issues and chain-extension legs (which don't have a GameIssue object).
	// Clears any stale suggestions for the key before fetching.
	async function fetchEngineSuggestionForFen(
		issuePly: number,
		fen: string,
		numMoves: number
	): Promise<void> {
		stockfishSuggestions.delete(issuePly);
		stockfishLoading.set(issuePly, true);
		try {
			const res = await fetch('/api/stockfish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fen, numMoves })
			});
			if (res.ok) {
				const result = (await res.json()) as {
					candidates?: {
						san: string;
						evalCp: number | null;
						isBook: boolean;
						openingName: string | null;
					}[];
				};
				if (result.candidates && result.candidates.length > 0) {
					// The API returns book candidates first, then engine candidates.
					// Deduplicate by SAN so the {#each (candidate.san)} key is always unique.
					// When the same move appears in both lists, merge them: keep the book
					// entry's isBook/openingName so it renders as a book move, but pull in
					// the engine's evalCp so the score is still shown.
					const seen = new SvelteMap<
						string,
						{ san: string; evalCp: number | null; isBook: boolean; openingName: string | null }
					>();
					for (const c of result.candidates) {
						const existing = seen.get(c.san);
						if (!existing) {
							seen.set(c.san, c);
						} else if (!c.isBook && existing.isBook) {
							seen.set(c.san, { ...existing, evalCp: c.evalCp });
						}
					}
					const mergedList = [...seen.values()];
					stockfishSuggestions.set(issuePly, mergedList);
					// Book candidates always have evalCp: null from the API (by design).
					// Evaluate their resulting positions in the background so the buttons
					// show a score once Stockfish responds. Fire-and-forget — the loading
					// spinner has already cleared; evals appear as results come in.
					enrichBookCandidateEvals(issuePly, fen, mergedList);
				}
			}
		} finally {
			stockfishLoading.set(issuePly, false);
		}
	}

	// Convenience wrapper — picks the right FEN and move count based on issue type.
	// For Case 2 (BEYOND_REPERTOIRE) the relevant FEN is fromFen (user's move position).
	// For Case 3 (OPPONENT_SURPRISE) the relevant FEN is toFen (position after opponent's
	// surprise move, where the user needs to respond). Fetches 3 candidates for
	// OPPONENT_SURPRISE so the user has multiple response options to choose from.
	async function fetchEngineSuggestion(issue: GameIssue): Promise<void> {
		const fen = issue.type === 'OPPONENT_SURPRISE' ? issue.toFen : issue.fromFen;
		const numMoves = issue.type === 'OPPONENT_SURPRISE' ? 3 : 1;
		await fetchEngineSuggestionForFen(issue.ply, fen, numMoves);
	}

	// Fetch and store the Stockfish eval for the user's actual game move (the position
	// that results after playing `san` from `fromFen`). Stored in userMoveEvals so the
	// "Add: [move] (your move)" button can display it alongside engine candidate evals.
	// Clears any stale value first so the UI doesn't flicker with the wrong number.
	async function fetchUserMoveEval(
		issuePly: number,
		fromFen: string,
		san: string | null
	): Promise<void> {
		if (!san) return;
		userMoveEvals.delete(issuePly); // clear stale entry while loading
		try {
			const chess = new Chess(fromFen);
			chess.move(san);
			const toFen = chess.fen();
			const res = await fetch('/api/stockfish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fen: toFen, numMoves: 1 })
			});
			if (res.ok) {
				const result = (await res.json()) as { candidates?: { evalCp: number | null }[] };
				userMoveEvals.set(issuePly, result.candidates?.[0]?.evalCp ?? null);
			}
		} catch {
			// Stockfish unreachable — leave the entry absent so no eval is shown.
		}
	}

	// For each book candidate in mergedList that has evalCp: null, evaluate the
	// position resulting from that move and patch stockfishSuggestions in-place.
	// Called fire-and-forget after the main engine fetch completes.
	async function enrichBookCandidateEvals(
		issuePly: number,
		fen: string,
		mergedList: {
			san: string;
			evalCp: number | null;
			isBook: boolean;
			openingName: string | null;
		}[]
	): Promise<void> {
		const bookCandidates = mergedList.filter((c) => c.isBook && c.evalCp === null);
		for (const candidate of bookCandidates) {
			try {
				const chess = new Chess(fen);
				chess.move(candidate.san);
				const toFen = chess.fen();
				const res = await fetch('/api/stockfish', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fen: toFen, numMoves: 1 })
				});
				if (res.ok) {
					const result = (await res.json()) as { candidates?: { evalCp: number | null }[] };
					const evalCp = result.candidates?.[0]?.evalCp ?? null;
					const current = stockfishSuggestions.get(issuePly);
					if (current) {
						stockfishSuggestions.set(
							issuePly,
							current.map((c) => (c.san === candidate.san ? { ...c, evalCp } : c))
						);
					}
				}
			} catch {
				// Stockfish unreachable — leave evalCp as null, no score shown.
			}
		}
	}

	// ── Chain extension handlers ─────────────────────────────────────────────────
	// These run when the user is working through a chain leg (phase 3+) rather
	// than the original issue phases. All are keyed by the original issue.ply.

	// Chain phase A — add the opponent's move for the current chain leg.
	// Transitions to chain phase B (pick a user response). Fires engine fetch
	// immediately so candidates are ready when the user gets there.
	async function handleChainAddOpponent(issuePly: number): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg) return;
		actionLoading.set(issuePly, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: leg.opponentFen,
				san: leg.opponentSan
			});
			chainExtensions.set(issuePly, { ...leg, opponentAdded: true });
			currentPlyIdx = leg.plyInGame; // advance board to position after opponent's move
			// Kick off engine candidates and user-move eval in parallel in the background.
			// userMoveEvals.delete ensures no stale eval flickers in before the new one arrives.
			if (leg.userFen) {
				fetchEngineSuggestionForFen(issuePly, leg.userFen, 3);
				fetchUserMoveEval(issuePly, leg.userFen, leg.userSan);
			}
		} finally {
			actionLoading.set(issuePly, false);
		}
	}

	// Chain phase B — add the user's actual game response and try to advance.
	// If there's yet another opponent move later in the game, creates the next leg.
	// Otherwise resolves the issue (chain complete).
	async function handleChainAddUserResponse(issuePly: number): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg || !leg.userFen || !leg.userSan) return;
		actionLoading.set(issuePly, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: leg.userFen,
				san: leg.userSan
			});
			// Advance: the next chain opponent ply is two past the current opponent ply
			// (opponent at leg.plyInGame → user at leg.plyInGame+1 → next opponent at leg.plyInGame+2).
			const nextLeg = buildChainLeg(leg.plyInGame + 2);
			if (nextLeg) {
				stockfishSuggestions.delete(issuePly); // clear stale candidates from this leg
				userMoveEvals.delete(issuePly); // clear stale eval from this leg
				currentPlyIdx = leg.plyInGame + 1; // advance board to position after user's response
				chainExtensions.set(issuePly, nextLeg);
			} else {
				chainExtensions.delete(issuePly);
				resolveIssue(issuePly);
			}
		} finally {
			actionLoading.set(issuePly, false);
		}
	}

	// Chain phase B — user picks an engine/book candidate.
	// If the chosen SAN matches the game move, advance the chain (same as picking
	// the game move button). Otherwise the user diverged, so end the chain.
	async function handleChainAddEngineSuggestion(issuePly: number, san: string): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg || !leg.userFen) return;
		actionLoading.set(issuePly, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: leg.userFen,
				san
			});
			if (san === leg.userSan) {
				// Same move as the game — advance the chain exactly like handleChainAddUserResponse.
				const nextLeg = buildChainLeg(leg.plyInGame + 2);
				if (nextLeg) {
					stockfishSuggestions.delete(issuePly);
					userMoveEvals.delete(issuePly); // clear stale eval from this leg
					currentPlyIdx = leg.plyInGame + 1;
					chainExtensions.set(issuePly, nextLeg);
				} else {
					chainExtensions.delete(issuePly);
					resolveIssue(issuePly);
				}
			} else {
				chainExtensions.delete(issuePly);
				resolveIssue(issuePly);
			}
		} finally {
			actionLoading.set(issuePly, false);
		}
	}

	// User clicks "Done" anywhere in the chain — stop extending, mark resolved.
	function skipChain(issuePly: number): void {
		chainExtensions.delete(issuePly);
		resolveIssue(issuePly);
	}

	// Add a specific engine/book candidate to the repertoire (Case 2 or Case 3 phase 2).
	// The caller passes the SAN directly from the candidate button.
	// For OPPONENT_SURPRISE the opponent's move is already added in phase 1.
	// If the chosen SAN matches the user's actual game response, treat it the same
	// as "Add: [game move]" and advance the chain rather than ending it.
	async function handleAddEngineSuggestion(issue: GameIssue, san: string): Promise<void> {
		const fromFen = issue.type === 'OPPONENT_SURPRISE' ? issue.toFen : issue.fromFen;
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen,
				san
			});
			// For OPPONENT_SURPRISE: if the chosen move is the same as the game move,
			// advance the chain (same logic as handleAddUserResponse). Otherwise end here.
			if (issue.type === 'OPPONENT_SURPRISE' && san === issue.userResponseSan) {
				const leg = buildChainLeg(issue.ply + 2);
				if (leg) {
					currentPlyIdx = issue.ply + 1;
					userMoveEvals.delete(issue.ply); // clear stale eval before chain starts
					chainExtensions.set(issue.ply, leg);
				} else {
					resolveIssue(issue.ply);
				}
			} else {
				resolveIssue(issue.ply);
			}
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Save the reviewed game record to the database.
	async function saveReview(): Promise<void> {
		if (!parsedPgn || !analysis || saving) return;
		saving = true;
		try {
			const res = await fetch('/api/review/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId: data.repertoire.id,
					pgn: parsedPgn,
					deviationFen: analysis.firstDeviationFen,
					notes: notes || null
				})
			});
			if (res.ok) {
				const result = (await res.json()) as { id: number };
				savedId = result.id;
			}
		} finally {
			saving = false;
		}
	}

	// Go back to the input state to review another game.
	function reviewAnother(): void {
		analysis = null;
		parsedPgn = null;
		savedId = null;
		pgnText = '';
		analysisError = null;
	}
</script>

<!-- ════════════════════════════════════════════════════════════════════════════
     STATE A — Input
     ════════════════════════════════════════════════════════════════════════════ -->

{#if pageState === 'input'}
	<div class="input-page">
		<div class="input-card">
			<h2 class="input-title">Review a Game</h2>
			<p class="input-subtitle">Paste a PGN to find where you deviated from your repertoire.</p>

			<form
				method="POST"
				action="?/analyzeGame"
				use:enhance={() => {
					analysing = true;
					analysisError = null;
					return async ({ update }) => {
						await update({ reset: false });
						analysing = false;
					};
				}}
			>
				<!-- Color selector -->
				<div class="color-selector">
					<span class="color-label">I played as:</span>
					<label class="color-opt" class:selected={playerColor === 'WHITE'}>
						<input type="radio" name="playerColor" value="WHITE" bind:group={playerColor} />
						♙ White
					</label>
					<label class="color-opt" class:selected={playerColor === 'BLACK'}>
						<input type="radio" name="playerColor" value="BLACK" bind:group={playerColor} />
						♟ Black
					</label>
				</div>

				<textarea
					name="pgn"
					class="pgn-input"
					rows="10"
					placeholder="[Event &quot;Rapid game&quot;]
[White &quot;You&quot;]
[Black &quot;Opponent&quot;]
[Result &quot;1-0&quot;]

1. e4 e5 2. Nf3 Nc6 ..."
					bind:value={pgnText}
					spellcheck="false"
				></textarea>

				{#if analysisError}
					<div class="error-banner">{analysisError}</div>
				{/if}

				<button
					type="submit"
					class="btn btn--primary btn--full"
					disabled={!pgnText.trim() || analysing}
				>
					{analysing ? 'Analysing…' : 'Analyse Game'}
				</button>
			</form>
		</div>

		<!-- Recent reviews history -->
		{#if data.recentGames.length > 0}
			<div class="history-section">
				<div class="section-label">RECENT REVIEWS</div>
				<div class="history-list">
					{#each data.recentGames as game (game.id)}
						<div class="history-item">
							<span class="history-date">
								{new Date(game.reviewedAt).toLocaleDateString(undefined, {
									month: 'short',
									day: 'numeric'
								})}
							</span>
							<span class="history-source">{game.source}</span>
							{#if game.deviationFen}
								<span class="history-badge deviation">Deviation found</span>
							{:else}
								<span class="history-badge clean">Clean</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- ════════════════════════════════════════════════════════════════════════════
     STATE B — Analysis
     ════════════════════════════════════════════════════════════════════════════ -->
{:else if pageState === 'analysis' && analysis}
	<div class="page">
		<!-- ── Board column ──────────────────────────────────────────────────────── -->
		<div class="board-col">
			<div class="board-wrap">
				<ChessBoard
					fen={currentFen}
					{orientation}
					boardTheme={data.settings?.boardTheme ?? 'blue'}
					interactive={false}
					{lastMove}
					autoShapes={boardShapes}
				/>
			</div>

			<!-- Move list — full game, colour-coded -->
			<div class="move-list-wrap">
				{#each analysis.sanHistory as san, i (i)}
					{@const ply = i + 1}
					{#if i % 2 === 0}
						<span class="move-num">{Math.floor(i / 2) + 1}.</span>
					{/if}
					<button
						class="move-san"
						class:move-san--active={currentPlyIdx === ply}
						style="color: {getMoveColor(ply)}"
						onclick={() => {
							currentPlyIdx = ply;
						}}>{san}</button
					>
				{/each}
			</div>

			<!-- Navigation controls -->
			<div class="nav-row">
				<button class="nav-btn" onclick={reviewAnother} title="Back to input"> ← New game </button>
				<div class="nav-arrows">
					<button
						class="nav-btn"
						onclick={goBack}
						disabled={currentPlyIdx === 0}
						aria-label="Previous move"
					>
						◀
					</button>
					<span class="nav-pos">
						{#if isAutoPlaying}
							Playing…
						{:else if currentPlyIdx === 0}
							Start
						{:else}
							{plyToLabel(currentPlyIdx) + ' ' + analysis.sanHistory[currentPlyIdx - 1]}
						{/if}
					</span>
					<button
						class="nav-btn"
						onclick={goForward}
						disabled={currentPlyIdx === analysis!.fenHistory.length - 1}
						aria-label="Next move"
					>
						▶
					</button>
				</div>
			</div>
		</div>

		<!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
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

			<!-- ECO opening name for current board position -->
			<OpeningName {currentFen} fenHistory={openingFenHistory} />

			<!-- Game info from PGN headers -->
			{#if analysisHeaders.White || analysisHeaders.Black}
				<div class="game-info">
					{analysisHeaders.White ?? '?'} vs {analysisHeaders.Black ?? '?'}
					{#if analysisHeaders.Result}
						<span class="game-result">{analysisHeaders.Result}</span>
					{/if}
				</div>
			{/if}

			<!-- Issues section -->
			<div class="section-label">
				{#if analysis.issues.length === 0}
					ANALYSIS
				{:else}
					ISSUES ({analysis.issues.length})
				{/if}
			</div>

			{#if analysis.issues.length === 0}
				<div class="no-issues">
					<div class="no-issues-icon">✓</div>
					<p class="no-issues-title">No deviations found!</p>
					<p class="no-issues-hint">Your opening was perfectly on book.</p>
				</div>
			{:else}
				<div class="issues-list">
					{#each analysis.issues as issue (issue.ply)}
						{@const isResolved = resolvedIssues.has(issue.ply)}
						{@const isLoading = actionLoading.get(issue.ply) ?? false}
						{@const sfLoading = stockfishLoading.get(issue.ply) ?? false}
						{@const sfCandidates = stockfishSuggestions.get(issue.ply) ?? null}
						{@const isActive = currentPlyIdx === issue.ply}
						{@const chainLeg = chainExtensions.get(issue.ply) ?? null}
						{@const userMoveEvalCp = userMoveEvals.get(issue.ply) ?? null}

						<div
							class="issue-card"
							class:issue-deviation={issue.type === 'DEVIATION'}
							class:issue-beyond={issue.type === 'BEYOND_REPERTOIRE'}
							class:issue-surprise={issue.type === 'OPPONENT_SURPRISE'}
							class:issue-resolved={isResolved}
							class:issue-active={isActive}
						>
							<!-- Header — click to jump board to this position -->
							<button class="issue-header" onclick={() => jumpToIssue(issue)}>
								<span class="issue-type-label">
									{#if issue.type === 'DEVIATION'}⚠{:else if issue.type === 'BEYOND_REPERTOIRE'}↗{:else}?{/if}
								</span>
								<span class="issue-move-num">Move {Math.ceil(issue.ply / 2)}</span>
								<span class="issue-san-played">{issue.playedSan}</span>
								{#if isResolved}
									<span class="resolved-mark">✓</span>
								{/if}
							</button>

							<!-- Details + actions (only if not resolved) -->
							{#if !isResolved}
								{#if chainLeg}
									<!-- ── Chain extension phases ─────────────────────────────────── -->
									<!-- Phase A: ask whether to add the next opponent move.         -->
									<!-- Phase B: opponent added — pick a response.                  -->
									{#if !chainLeg.opponentAdded}
										<div class="issue-details">
											<span
												>Keep building? Opponent would play <strong>{chainLeg.opponentSan}</strong
												></span
											>
										</div>
										<div class="issue-actions">
											<button
												class="act-btn act-btn--primary"
												onclick={() => handleChainAddOpponent(issue.ply)}
												disabled={isLoading}
											>
												Add opponent's {chainLeg.opponentSan}
											</button>
											<button
												class="act-btn act-btn--ghost"
												onclick={() => skipChain(issue.ply)}
												disabled={isLoading}
											>
												Done
											</button>
										</div>
									{:else}
										<div class="issue-details">
											<span
												><strong>{chainLeg.opponentSan}</strong> added. How will you respond?</span
											>
										</div>
										<div class="issue-actions">
											{#if chainLeg.userSan}
												<button
													class="act-btn act-btn--primary"
													onclick={() => handleChainAddUserResponse(issue.ply)}
													disabled={isLoading}
												>
													Add: {chainLeg.userSan} (your move){userMoveEvalCp !== null
														? formatCandidateEval(userMoveEvalCp)
														: ''}
												</button>
											{/if}
											{#if sfLoading}
												<button class="act-btn act-btn--ghost" disabled>Loading candidates…</button>
											{:else if sfCandidates && sfCandidates.length > 0}
												{#each sfCandidates as candidate (candidate.san)}
													<button
														class="act-btn"
														class:act-btn--engine={!candidate.isBook}
														class:act-btn--book={candidate.isBook}
														onclick={() => handleChainAddEngineSuggestion(issue.ply, candidate.san)}
														disabled={isLoading}
													>
														Add: {candidate.san}{formatCandidateEval(
															candidate.evalCp
														)}{candidate.isBook ? ` · ${candidate.openingName ?? 'book'}` : ''}
													</button>
												{/each}
											{:else if chainLeg.userFen}
												<button
													class="act-btn act-btn--ghost"
													onclick={() =>
														fetchEngineSuggestionForFen(issue.ply, chainLeg.userFen!, 3)}
													disabled={sfLoading || isLoading}
												>
													Engine suggestion
												</button>
											{/if}
											<button
												class="act-btn act-btn--ghost"
												onclick={() => skipChain(issue.ply)}
												disabled={isLoading}
											>
												Done
											</button>
										</div>
									{/if}
								{:else}
									<!-- ── Original issue phases ──────────────────────────────────── -->
									<div class="issue-details">
										{#if issue.type === 'DEVIATION'}
											{@const ev = deviationEvals.get(issue.ply)}
											<!-- Eval comparison: two rows -->
											<div class="eval-compare">
												<div class="eval-row">
													<span class="eval-label">Played</span>
													<strong class="eval-san">{issue.playedSan}</strong>
													{#if ev?.played != null}
														<span class="eval-badge {evalBadgeClass(ev.played)}"
															>{formatEval(ev.played)}</span
														>
													{:else}
														<span class="eval-badge eval-loading">…</span>
													{/if}
												</div>
												<div class="eval-row">
													<span class="eval-label">Book</span>
													<strong class="eval-san">{issue.repertoireSan}</strong>
													{#if ev?.correct != null}
														<span class="eval-badge {evalBadgeClass(ev.correct)}"
															>{formatEval(ev.correct)}</span
														>
													{:else}
														<span class="eval-badge eval-loading">…</span>
													{/if}
												</div>
											</div>
										{:else if issue.type === 'BEYOND_REPERTOIRE'}
											<span
												>You played <strong>{issue.playedSan}</strong> — no repertoire move here</span
											>
										{:else if issue.type === 'OPPONENT_SURPRISE'}
											<span
												>Opponent played <strong>{issue.playedSan}</strong> (not in your repertoire)</span
											>
										{/if}
										<!-- Collapsible Masters section (all issue types) -->
										<button
											type="button"
											class="masters-toggle"
											onclick={() => toggleMasters(issue)}
										>
											{deviationMastersExpanded.has(issue.ply) ? '▾' : '▸'} Masters
										</button>
										{#if deviationMastersExpanded.has(issue.ply)}
											{@const masters = deviationMasters.get(issue.ply)}
											{@const mLoading = deviationMastersLoading.get(issue.ply)}
											{@const mError = deviationMastersError.get(issue.ply)}
											{#if mLoading}
												<div class="masters-inline-loading">Loading masters…</div>
											{:else if mError}
												<div class="masters-inline-error">Masters unavailable</div>
											{:else if masters && masters.length > 0}
												<div class="masters-mini-list">
													{#each masters as m (m.san)}
														{@const winPct = m.totalGames > 0 ? (m.white / m.totalGames) * 100 : 0}
														{@const drawPct = m.totalGames > 0 ? (m.draws / m.totalGames) * 100 : 0}
														{@const lossPct = m.totalGames > 0 ? (m.black / m.totalGames) * 100 : 0}
														<div class="masters-mini-row">
															<span
																class="masters-mini-san"
																class:masters-mini-highlight={m.san === issue.playedSan}
																class:masters-mini-book={m.san === issue.repertoireSan}
																>{m.san}</span
															>
															<div class="wdl-bar-mini">
																<div class="wdl-w" style="width: {winPct}%"></div>
																<div class="wdl-d" style="width: {drawPct}%"></div>
																<div class="wdl-b" style="width: {lossPct}%"></div>
															</div>
															<span class="masters-mini-count">{m.totalGames.toLocaleString()}</span
															>
														</div>
													{/each}
												</div>
											{:else if masters}
												<div class="masters-inline-error">No master games here</div>
											{/if}
										{/if}
									</div>

									<div class="issue-actions">
										{#if issue.type === 'DEVIATION'}
											{@const devEv = deviationEvals.get(issue.ply)}
											{@const playedBetter =
												devEv?.played != null &&
												devEv?.correct != null &&
												(analysedPlayerColor === 'BLACK' ? -devEv.played : devEv.played) >
													(analysedPlayerColor === 'BLACK' ? -devEv.correct : devEv.correct)}
											<button
												class="act-btn act-btn--warn"
												onclick={() => handleFailCard(issue)}
												disabled={isLoading}
											>
												Fail card
											</button>
											<button
												class="act-btn {playedBetter ? 'act-btn--primary' : 'act-btn--warn'}"
												onclick={() => handleUpdateRepertoire(issue)}
												disabled={isLoading}
											>
												{playedBetter ? 'Replace in repertoire' : 'Update repertoire'}
											</button>
											<button
												class="act-btn act-btn--ghost"
												onclick={() => resolveIssue(issue.ply)}
												disabled={isLoading}
											>
												Skip
											</button>
										{:else if issue.type === 'BEYOND_REPERTOIRE'}
											<button
												class="act-btn act-btn--primary"
												onclick={() => handleAddMyMove(issue)}
												disabled={isLoading || sfLoading}
											>
												Add my move
											</button>
											{#if sfCandidates && sfCandidates.length > 0}
												{@const top = sfCandidates[0]}
												<button
													class="act-btn act-btn--engine"
													onclick={() => handleAddEngineSuggestion(issue, top.san)}
													disabled={isLoading}
												>
													Add: {top.san}{formatCandidateEval(top.evalCp)}{top.isBook
														? ` · ${top.openingName ?? 'book'}`
														: ''}
												</button>
											{:else}
												<button
													class="act-btn act-btn--ghost"
													onclick={() => fetchEngineSuggestion(issue)}
													disabled={sfLoading || isLoading}
												>
													{sfLoading ? 'Loading…' : 'Engine suggestion'}
												</button>
											{/if}
											<button
												class="act-btn act-btn--ghost"
												onclick={() => resolveIssue(issue.ply)}
												disabled={isLoading}
											>
												Skip
											</button>
										{:else if issue.type === 'OPPONENT_SURPRISE'}
											{#if !opponentMoveAdded.has(issue.ply)}
												<!-- Phase 1: decide whether to add the opponent's move -->
												<button
													class="act-btn act-btn--primary"
													onclick={() => handleAddOpponentMove(issue)}
													disabled={isLoading}
												>
													Add to repertoire
												</button>
												<button
													class="act-btn act-btn--ghost"
													onclick={() => resolveIssue(issue.ply)}
													disabled={isLoading}
												>
													Skip
												</button>
											{:else}
												<!-- Phase 2: opponent's move added — now pick a response -->
												<p class="phase-label">Added. How will you respond?</p>
												{#if issue.userResponseSan}
													<button
														class="act-btn act-btn--primary"
														onclick={() => handleAddUserResponse(issue)}
														disabled={isLoading}
													>
														Add: {issue.userResponseSan} (your move){userMoveEvalCp !== null
															? formatCandidateEval(userMoveEvalCp)
															: ''}
													</button>
												{/if}
												{#if sfLoading}
													<button class="act-btn act-btn--ghost" disabled
														>Loading candidates…</button
													>
												{:else if sfCandidates && sfCandidates.length > 0}
													{#each sfCandidates as candidate (candidate.san)}
														<button
															class="act-btn"
															class:act-btn--engine={!candidate.isBook}
															class:act-btn--book={candidate.isBook}
															onclick={() => handleAddEngineSuggestion(issue, candidate.san)}
															disabled={isLoading}
														>
															Add: {candidate.san}{formatCandidateEval(
																candidate.evalCp
															)}{candidate.isBook ? ` · ${candidate.openingName ?? 'book'}` : ''}
														</button>
													{/each}
												{/if}
												<button
													class="act-btn act-btn--ghost"
													onclick={() => resolveIssue(issue.ply)}
													disabled={isLoading}
												>
													Skip
												</button>
											{/if}
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Notes + save -->
			<div class="save-section">
				<textarea
					class="notes-input"
					rows="3"
					placeholder="Notes about this game…"
					bind:value={notes}
				></textarea>
				<button class="btn btn--primary btn--full" onclick={saveReview} disabled={saving}>
					{saving ? 'Saving…' : 'Save Review'}
				</button>
			</div>
		</div>
	</div>

	<!-- ════════════════════════════════════════════════════════════════════════════
     STATE C — Saved
     ════════════════════════════════════════════════════════════════════════════ -->
{:else if pageState === 'saved'}
	<div class="saved-page">
		<div class="saved-card">
			<div class="saved-icon">✓</div>
			<h2 class="saved-title">Review saved</h2>
			{#if analysis && analysis.issues.length === 0}
				<p class="saved-subtitle">Your opening was perfectly on book.</p>
			{:else if analysis}
				<p class="saved-subtitle">
					{analysis.issues.filter((i) => resolvedIssues.has(i.ply)).length} of {analysis.issues
						.length}
					issue{analysis.issues.length !== 1 ? 's' : ''} resolved.
				</p>
			{/if}
			<div class="saved-actions">
				<button class="btn btn--primary" onclick={reviewAnother}>Review another game</button>
				<a href="/drill" class="btn btn--secondary">Drill mode</a>
				<a href="/build" class="btn btn--secondary">Build mode</a>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Two-column analysis layout ─────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.board-wrap {
		width: 100%;
	}

	.sidebar {
		width: 100%;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* ── Input page ─────────────────────────────────────────────────────────── */

	.input-page {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.input-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.input-title {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-display);
		margin: 0;
	}

	.input-subtitle {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	/* Color selector */
	.color-selector {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.color-label {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.color-opt {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-primary);
		cursor: pointer;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
		user-select: none;
	}

	.color-opt input {
		display: none;
	}

	.color-opt.selected {
		border-color: var(--color-gold);
		color: var(--color-text-primary);
		background: var(--color-gold-glow);
	}

	/* PGN textarea */
	.pgn-input {
		width: 100%;
		box-sizing: border-box;
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.75rem;
		line-height: 1.5;
		padding: var(--space-3);
		resize: vertical;
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.pgn-input:focus {
		outline: none;
		border-color: var(--color-gold);
		box-shadow: var(--glow-gold);
	}

	/* Error banner */
	.error-banner {
		background: rgba(220, 60, 60, 0.12);
		border: 1px solid rgba(220, 60, 60, 0.4);
		color: var(--color-danger);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: 0.82rem;
	}

	/* ── History section ────────────────────────────────────────────────────── */

	.history-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--color-base);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
	}

	.history-date {
		color: var(--color-text-muted);
		flex-shrink: 0;
		min-width: 3.5rem;
	}

	.history-source {
		color: var(--color-text-muted);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.history-badge {
		margin-left: auto;
		font-size: 0.7rem;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.history-badge.deviation {
		background: rgba(226, 148, 74, 0.15);
		color: var(--color-gold-dim);
		border: 1px solid rgba(226, 148, 74, 0.3);
	}

	.history-badge.clean {
		background: rgba(92, 204, 92, 0.12);
		color: var(--color-success);
		border: 1px solid rgba(92, 204, 92, 0.25);
	}

	/* ── Move list below board ──────────────────────────────────────────────── */

	.move-list-wrap {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: 0.82rem;
		background: var(--color-base);
		border: 1px solid var(--color-surface);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		max-height: 96px;
		overflow-y: auto;
		line-height: 1.7;
	}

	.move-num {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
	}

	.move-san {
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--space-1) var(--space-1);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		font-family: var(--font-body);
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.move-san:hover {
		background: rgba(255, 255, 255, 0.07);
	}

	.move-san--active {
		background: var(--color-gold-glow) !important;
		outline: 1px solid rgba(226, 183, 20, 0.5);
		border-radius: var(--radius-sm);
	}

	/* ── Navigation row ─────────────────────────────────────────────────────── */

	.nav-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.nav-arrows {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.nav-btn {
		background: var(--color-base);
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.nav-btn:not(:disabled):hover {
		color: var(--color-text-primary);
		border-color: var(--color-gold);
	}

	.nav-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.nav-pos {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		min-width: 5rem;
		text-align: center;
	}

	/* ── Sidebar elements ───────────────────────────────────────────────────── */

	.rep-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.rep-icon {
		font-size: 1.2rem;
		line-height: 1;
	}

	.rep-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text-primary);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 0.7rem;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		flex-shrink: 0;
	}

	.badge-white {
		background: var(--color-surface);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.badge-black {
		background: var(--color-base);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.game-info {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.game-result {
		font-weight: 700;
		color: var(--color-text-primary);
	}

	/* ── Section label ──────────────────────────────────────────────────────── */

	.section-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	/* ── No issues state ────────────────────────────────────────────────────── */

	.no-issues {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2) 0;
	}

	.no-issues-icon {
		font-size: 1.5rem;
		color: var(--color-success);
	}

	.no-issues-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.no-issues-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* ── Issue cards ────────────────────────────────────────────────────────── */

	.issues-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-height: 360px;
		overflow-y: auto;
	}

	.issue-card {
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		overflow: hidden;
		transition: opacity var(--dur-fast) var(--ease-snap);
	}

	/* Type-specific border/background colours */
	.issue-deviation {
		border-color: rgba(226, 148, 74, 0.4);
		background: rgba(226, 148, 74, 0.05);
	}

	.issue-beyond {
		border-color: rgba(226, 183, 20, 0.4);
		background: rgba(226, 183, 20, 0.05);
	}

	.issue-surprise {
		border-color: rgba(220, 96, 96, 0.4);
		background: rgba(220, 96, 96, 0.05);
	}

	/* Resolved issues are dimmed */
	.issue-resolved {
		opacity: 0.45;
	}

	/* Active issue (board is showing this position) gets a slightly brighter ring */
	.issue-active:not(.issue-resolved) {
		filter: brightness(1.15);
	}

	.issue-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-family: var(--font-body);
	}

	.issue-type-label {
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.issue-move-num {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.issue-san-played {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-primary);
		flex: 1;
	}

	.resolved-mark {
		font-size: 0.9rem;
		color: var(--color-success);
		flex-shrink: 0;
	}

	.issue-details {
		padding: 0 var(--space-3) var(--space-2);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		line-height: 1.4;
	}

	.issue-details strong {
		color: var(--color-text-primary);
	}

	.move-eval {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		font-weight: 400;
	}

	/* ── Eval comparison (DEVIATION cards) ──────────────────────────────────── */

	.eval-compare {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.eval-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.eval-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		width: 2.8rem;
		flex-shrink: 0;
	}

	.eval-san {
		font-size: 0.82rem;
		color: var(--color-text-primary);
		min-width: 2.5rem;
	}

	.eval-badge {
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		margin-left: auto;
	}

	.eval-badge-good {
		color: var(--color-success);
		background: rgba(74, 222, 128, 0.12);
	}

	.eval-badge-bad {
		color: var(--color-danger);
		background: rgba(248, 113, 113, 0.12);
	}

	.eval-badge-neutral {
		color: var(--color-text-muted);
		background: rgba(112, 112, 128, 0.12);
	}

	.eval-loading {
		color: var(--color-text-muted);
	}

	/* ── Masters toggle + mini-list ────────────────────────────────────────── */

	.masters-toggle {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 0.7rem;
		font-family: var(--font-body);
		cursor: pointer;
		padding: var(--space-1) 0;
		text-align: left;
	}

	.masters-toggle:hover {
		color: var(--color-gold);
	}

	.masters-mini-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-left: var(--space-2);
	}

	.masters-mini-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.masters-mini-san {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		min-width: 2.2rem;
	}

	.masters-mini-highlight {
		color: var(--color-gold-dim);
	}

	.masters-mini-book {
		color: var(--color-success);
	}

	.wdl-bar-mini {
		display: flex;
		height: 3px;
		border-radius: 1.5px;
		overflow: hidden;
		flex: 1;
		min-width: 60px;
	}

	.wdl-w {
		background: var(--color-success);
	}

	.wdl-d {
		background: var(--color-text-muted);
	}

	.wdl-b {
		background: var(--color-danger);
	}

	.masters-mini-count {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		min-width: 2rem;
		text-align: right;
	}

	.masters-inline-loading,
	.masters-inline-error {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-style: italic;
		padding-left: var(--space-2);
	}

	.issue-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 0 var(--space-3) var(--space-3);
	}

	/* Action buttons within issue cards */
	.act-btn {
		padding: var(--space-2) var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		font-size: 0.73rem;
		font-weight: 600;
		cursor: pointer;
		font-family: var(--font-body);
		transition: filter var(--dur-fast) var(--ease-snap);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.act-btn:not(:disabled):hover {
		filter: brightness(1.2);
	}

	.act-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.act-btn--primary {
		background: rgba(226, 183, 20, 0.2);
		border-color: rgba(226, 183, 20, 0.5);
		color: var(--color-gold);
	}

	.act-btn--warn {
		background: rgba(226, 148, 74, 0.18);
		border-color: rgba(226, 148, 74, 0.45);
		color: var(--color-gold-dim);
	}

	.act-btn--engine {
		background: rgba(226, 183, 20, 0.12);
		border-color: rgba(226, 183, 20, 0.35);
		color: var(--color-gold);
	}

	.act-btn--book {
		background: rgba(92, 204, 92, 0.12);
		border-color: rgba(92, 204, 92, 0.35);
		color: var(--color-success);
	}

	.phase-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-1);
	}

	.act-btn--ghost {
		background: none;
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	/* ── Notes + save section ───────────────────────────────────────────────── */

	.save-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: auto;
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.notes-input {
		width: 100%;
		box-sizing: border-box;
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 0.8rem;
		padding: var(--space-2) var(--space-3);
		resize: vertical;
		font-family: var(--font-body);
	}

	.notes-input:focus {
		outline: none;
		border-color: var(--color-gold);
		box-shadow: var(--glow-gold);
	}

	/* ── Saved page ─────────────────────────────────────────────────────────── */

	.saved-page {
		display: flex;
		justify-content: center;
		padding: var(--space-12) var(--space-4);
	}

	.saved-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		text-align: center;
		max-width: 380px;
	}

	.saved-icon {
		font-size: 2.5rem;
		color: var(--color-success);
	}

	.saved-title {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-display);
		margin: 0;
	}

	.saved-subtitle {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.saved-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}

	/* ── Shared button styles ───────────────────────────────────────────────── */

	.btn {
		display: block;
		text-align: center;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
		transition: filter var(--dur-fast) var(--ease-snap);
		font-family: var(--font-body);
	}

	.btn:hover:not(:disabled) {
		filter: brightness(1.15);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.btn--primary {
		background: var(--color-gold);
		border-color: var(--color-gold);
		color: var(--color-base);
	}

	.btn--secondary {
		background: var(--color-surface);
		border-color: var(--color-border);
		color: var(--color-text-secondary);
	}

	.btn--full {
		width: 100%;
		box-sizing: border-box;
	}

	/* ── Mobile responsive ────────────────────────────────────────────── */

	/* Tablet (768px – 1023px) — --bp-md */
	@media (min-width: 768px) {
		.page {
			display: grid;
			grid-template-columns: 1fr 260px;
			gap: var(--space-4);
			align-items: start;
			padding: 0;
		}
	}

	/* Desktop (≥1024px) — --bp-lg */
	@media (min-width: 1024px) {
		.page {
			grid-template-columns: 1fr 300px;
			gap: var(--space-8);
			max-width: 920px;
			margin: 0 auto;
		}
	}
</style>
