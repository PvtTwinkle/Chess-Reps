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
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import ReviewIssuePicker from '$lib/components/ReviewIssuePicker.svelte';
	import { enhance } from '$app/forms';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { PageData } from './$types';
	import type { GameAnalysis, GameIssue } from '$lib/pgn';
	import { initSounds, setSoundEnabled, playMove, playCapture } from '$lib/sounds';
	import { manageRepertoiresOpen } from '$lib/stores/manageRepertoires';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { Key } from '@lichess-org/chessground/types';
	import { Chess } from 'chess.js';
	import { STARTING_FEN } from '$lib/fen';

	let { data, form }: { data: PageData; form: Record<string, unknown> | null } = $props();

	// ── Board resize ─────────────────────────────────────────────────────────
	// Fire-and-forget: the ResizableBoard component already shows the new size
	// via localWidth; no invalidateAll() needed (which would reset review state).
	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

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

	// ── Import tab state ────────────────────────────────────────────────────────

	// Which tab is active in the input state: 'paste' or 'import'
	let inputTab = $state<'paste' | 'import'>('paste');

	// Import fetch state
	let importingLichess = $state(false);
	let importingChesscom = $state(false);
	let importResult = $state<{ imported: number; skipped: number; source: string } | null>(null);
	let importError = $state<string | null>(null);

	// Import list filter
	let importFilter = $state<'all' | 'pending' | 'reviewed' | 'skipped'>('all');

	// The imported game currently being reviewed (set when user clicks "Review")
	let importedGameId = $state<number | null>(null);
	// Override repertoire ID (when reviewing an imported game against a specific repertoire)
	let overrideRepertoireId = $state<number | null>(null);

	// Repertoire picker modal
	let showRepPicker = $state(false);
	let repPickerAnalyses = $state<
		{ repertoireId: number; repertoireName: string; issueCount: number; matchDepth: number }[]
	>([]);
	let repPickerLoading = $state(false);
	let repPickerGameId = $state<number | null>(null);

	// Filtered imported games
	const filteredImportedGames = $derived(
		(data.importedGames ?? []).filter((g) => importFilter === 'all' || g.status === importFilter)
	);

	// Import functions
	async function triggerImport(source: 'LICHESS' | 'CHESSCOM') {
		importResult = null;
		importError = null;

		if (source === 'LICHESS') importingLichess = true;
		else importingChesscom = true;

		try {
			const res = await fetch('/api/import/fetch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ source })
			});

			const result = await res.json();

			if (res.status === 429 && result.rateLimited) {
				importError = `Rate limited by ${source === 'LICHESS' ? 'Lichess' : 'Chess.com'}. Try again in a minute.`;
				return;
			}

			if (!res.ok) {
				importError = result.message ?? `Import failed (${res.status})`;
				return;
			}

			importResult = {
				imported: result.imported,
				skipped: result.skipped,
				source: source === 'LICHESS' ? 'Lichess' : 'Chess.com'
			};

			// Refresh the imported games list
			const { invalidateAll } = await import('$app/navigation');
			await invalidateAll();
		} catch {
			importError = 'Network error. Check your connection.';
		} finally {
			if (source === 'LICHESS') importingLichess = false;
			else importingChesscom = false;
		}
	}

	async function skipImportedGame(gameId: number) {
		await fetch(`/api/import/${gameId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'skipped' })
		});
		const { invalidateAll } = await import('$app/navigation');
		await invalidateAll();
	}

	async function unskipImportedGame(gameId: number) {
		await fetch(`/api/import/${gameId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'pending' })
		});
		const { invalidateAll } = await import('$app/navigation');
		await invalidateAll();
	}

	async function startReviewImportedGame(gameId: number) {
		repPickerLoading = true;
		repPickerGameId = gameId;

		try {
			const res = await fetch(`/api/import/${gameId}/analyze`, { method: 'POST' });
			if (!res.ok) {
				importError = 'Failed to analyze game';
				return;
			}

			const result = await res.json();

			if (result.analyses.length === 0) {
				importError = result.message ?? 'No matching repertoires found for this game.';
				return;
			}

			if (result.analyses.length === 1) {
				// Only one matching repertoire — go directly to review.
				loadImportedGameForReview(
					gameId,
					result.game.pgn,
					result.game.playerColor,
					result.analyses[0].repertoireId
				);
			} else {
				// Multiple repertoires — show picker.
				repPickerAnalyses = result.analyses;
				showRepPicker = true;
			}
		} catch {
			importError = 'Network error analyzing game.';
		} finally {
			repPickerLoading = false;
		}
	}

	function loadImportedGameForReview(
		gameId: number,
		pgn: string,
		color: string,
		repertoireId: number
	) {
		showRepPicker = false;
		importedGameId = gameId;
		overrideRepertoireId = repertoireId;
		pgnText = pgn;
		playerColor = color as 'WHITE' | 'BLACK';
		inputTab = 'paste';

		// Auto-submit the analyze form after a tick to let the textarea render.
		setTimeout(() => {
			const formEl = document.querySelector(
				'form[action="?/analyzeGame"]'
			) as HTMLFormElement | null;
			if (formEl) formEl.requestSubmit();
		}, 100);
	}

	// ── Prefilled game from URL ─────────────────────────────────────────────────
	// When navigating from an external link with ?importedGameId=N, auto-fill the PGN.
	$effect(() => {
		if (data.prefilledGame && !analysis) {
			const pg = data.prefilledGame;
			untrack(() => {
				loadImportedGameForReview(pg.id, pg.pgn, pg.playerColor, data.repertoire.id);
			});
		}
	});
	let analysisError = $state<string | null>(null);

	// ── Analysis state ──────────────────────────────────────────────────────────

	let analysis = $state<GameAnalysis | null>(null);
	let parsedPgn = $state<string | null>(null);
	let analysisHeaders = $state<Record<string, string>>({});
	let analysedPlayerColor = $state<'WHITE' | 'BLACK'>('WHITE');
	let analysisRepName = $state<string | null>(null);
	let currentPlyIdx = $state(0); // 0 = starting position, N = position after ply N
	let isAutoPlaying = $state(false);
	let autoPlayTarget = $state<number | null>(null);
	let resolvedIssues = new SvelteSet<number>(); // issue.ply values of resolved issues
	let opponentMoveAdded = new SvelteSet<number>(); // OPPONENT_SURPRISE issues where phase 1 is done
	let notes = $state('');
	let actionError = new SvelteMap<number, string>(); // issue.ply → error message

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

	// Evals for DEVIATION issues: evalCp from White's perspective after each move.
	// Fetched in the background when analysis loads; populated as results arrive.
	let deviationEvals = new SvelteMap<number, { played: number | null; correct: number | null }>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive to avoid $effect loop
	const deviationFetching = new Set<number>();
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

	// ── Hover arrow state (for ReviewIssuePicker → board arrow) ─────────────────

	let hoveredFen = $state<string | null>(null);
	let hoveredSan = $state<string | null>(null);

	// ── "Add to new repertoire" inline form state ──────────────────────────────

	let newRepIssuePly = $state<number | null>(null); // which issue is showing the form
	let newRepName = $state('');

	function handleHoverMove(fen: string, san: string | null): void {
		hoveredFen = san ? fen : null;
		hoveredSan = san;
	}

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

			// Store the server-selected repertoire ID so saving targets the right
			// repertoire (which may differ from the active one if the server
			// auto-matched by opening moves).
			if (form.repertoireId && typeof form.repertoireId === 'number') {
				overrideRepertoireId = form.repertoireId;
			}
			analysisRepName = (form.repertoireName as string) ?? null;

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
				actionLoading.clear();
				actionError.clear();
				deviationEvals.clear();
				deviationFetching.clear();
				deviationMasters.clear();
				deviationMastersLoading.clear();
				deviationMastersError.clear();
				deviationMastersExpanded.clear();
				hoveredFen = null;
				hoveredSan = null;
				newRepIssuePly = null;
				newRepName = '';
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

	// Board orientation — use the analysed player color (which may differ from
	// the active repertoire's color when the server auto-matched a different one).
	const orientation = $derived<'white' | 'black'>(
		analysedPlayerColor === 'WHITE' ? 'white' : 'black'
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

	// Overlay arrows on the board:
	//
	// DEVIATION        — red = wrong move; green = correct repertoire move.
	// Chain phase A    — red = opponent's proposed move.
	// Hover            — blue arrow for the candidate move the user is hovering over
	//                    (from ReviewIssuePicker / CandidateMoves).
	const boardShapes = $derived.by((): DrawShape[] => {
		if (!analysis) return [];

		const shapes: DrawShape[] = [];

		// DEVIATION: red for the wrong move, green for the correct one.
		const dev = analysis.issues.find(
			(iss) => iss.type === 'DEVIATION' && currentPlyIdx === iss.ply
		);
		if (dev && dev.repertoireSan) {
			const wFrom = analysis.fromSquares[dev.ply - 1];
			const wTo = analysis.toSquares[dev.ply - 1];
			if (wFrom && wTo) shapes.push({ orig: wFrom as Key, dest: wTo as Key, brush: 'red' });
			const correct = getMoveSquares(dev.fromFen, dev.repertoireSan);
			if (correct)
				shapes.push({ orig: correct.from as Key, dest: correct.to as Key, brush: 'green' });
			return shapes;
		}

		// Chain phase A: board is one ply before the chain opponent's move — show it as red.
		for (const issue of analysis.issues) {
			if (resolvedIssues.has(issue.ply)) continue;
			const chainLeg = chainExtensions.get(issue.ply) ?? null;
			if (chainLeg && !chainLeg.opponentAdded && currentPlyIdx === chainLeg.plyInGame - 1) {
				const sq = getMoveSquares(chainLeg.opponentFen, chainLeg.opponentSan);
				if (sq) shapes.push({ orig: sq.from as Key, dest: sq.to as Key, brush: 'red' });
				return shapes;
			}
		}

		// Hover arrow from ReviewIssuePicker — blue arrow for the hovered candidate.
		if (hoveredSan && hoveredFen) {
			const sq = getMoveSquares(hoveredFen, hoveredSan);
			if (sq) shapes.push({ orig: sq.from as Key, dest: sq.to as Key, brush: 'blue' });
		}

		return shapes;
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
			if (issue.type === 'DEVIATION') return 'var(--color-accent-dim)';
			if (issue.type === 'BEYOND_REPERTOIRE') return 'var(--color-accent)';
			if (issue.type === 'OPPONENT_SURPRISE') return 'var(--color-danger)';
		}
		if (ply > cutoffPly) return 'var(--color-text-muted)'; // dim — off-book

		const isUserPly =
			(analysedPlayerColor === 'WHITE' && ply % 2 === 1) ||
			(analysedPlayerColor === 'BLACK' && ply % 2 === 0);
		return isUserPly ? 'var(--color-success)' : 'var(--color-text-secondary)';
	}

	// ── Issue resolution actions ─────────────────────────────────────────────────

	async function callApi(path: string, body: Record<string, unknown>): Promise<void> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(text || `Request failed (${res.status})`);
		}
	}

	// Case 1 — DEVIATION: mark FSRS card as failed.
	async function handleFailCard(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		actionError.delete(issue.ply);
		try {
			await callApi('/api/review/fail-card', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen: issue.fromFen
			});
			resolveIssue(issue.ply);
		} catch (e) {
			actionError.set(
				issue.ply,
				(e instanceof Error ? e.message : String(e)) || 'Failed to update card'
			);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 1 — DEVIATION: update repertoire to the move the user actually played,
	// and also fail the SR card.
	async function handleUpdateRepertoire(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		actionError.delete(issue.ply);
		try {
			// Fail the card first (it's a deviation regardless of what we do with the repertoire).
			await callApi('/api/review/fail-card', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen: issue.fromFen
			});
			// Replace the existing move in the repertoire with what the user played.
			await callApi('/api/review/add-move', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan,
				forceReplace: true
			});
			resolveIssue(issue.ply);
		} catch (e) {
			actionError.set(
				issue.ply,
				(e instanceof Error ? e.message : String(e)) || 'Failed to update repertoire'
			);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 3 — OPPONENT_SURPRISE, phase 1: add only the opponent's move.
	// Moves the card to phase 2 where the ReviewIssuePicker renders and
	// CandidateMoves handles fetching book/masters/engine data automatically.
	async function handleAddOpponentMove(issue: GameIssue): Promise<void> {
		actionLoading.set(issue.ply, true);
		actionError.delete(issue.ply);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			opponentMoveAdded.add(issue.ply);
		} catch (e) {
			actionError.set(
				issue.ply,
				(e instanceof Error ? e.message : String(e)) || 'Failed to add move'
			);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 3b — OPPONENT_SURPRISE, phase 1: create a new repertoire, add the
	// opponent's move to it, then continue as normal in phase 2.
	async function handleAddOpponentMoveNewRep(issue: GameIssue): Promise<void> {
		const name = newRepName.trim();
		if (!name) return;
		actionLoading.set(issue.ply, true);
		actionError.delete(issue.ply);
		try {
			// Create the new repertoire (same color as current analysis).
			const repRes = await fetch('/api/repertoires', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, color: analysedPlayerColor })
			});
			if (!repRes.ok) throw new Error('Failed to create repertoire');
			const newRep = (await repRes.json()) as { id: number };

			// Switch the rest of this review to use the new repertoire.
			overrideRepertoireId = newRep.id;

			// Add the opponent's move to the new repertoire.
			await callApi('/api/review/add-move', {
				repertoireId: newRep.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			opponentMoveAdded.add(issue.ply);
			newRepIssuePly = null;
			newRepName = '';
		} catch (e) {
			actionError.set(
				issue.ply,
				(e instanceof Error ? e.message : String(e)) || 'Failed to create repertoire'
			);
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

	// ── Chain extension handlers ─────────────────────────────────────────────────
	// These run when the user is working through a chain leg (phase 3+) rather
	// than the original issue phases. All are keyed by the original issue.ply.

	// Chain phase A — add the opponent's move for the current chain leg.
	// Transitions to chain phase B where ReviewIssuePicker renders and
	// CandidateMoves handles fetching book/masters/engine data automatically.
	async function handleChainAddOpponent(issuePly: number): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg) return;
		actionLoading.set(issuePly, true);
		actionError.delete(issuePly);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen: leg.opponentFen,
				san: leg.opponentSan
			});
			chainExtensions.set(issuePly, { ...leg, opponentAdded: true });
			currentPlyIdx = leg.plyInGame; // advance board to position after opponent's move
		} catch (e) {
			actionError.set(
				issuePly,
				(e instanceof Error ? e.message : String(e)) || 'Failed to add move'
			);
		} finally {
			actionLoading.set(issuePly, false);
		}
	}

	// User clicks "Done" anywhere in the chain — stop extending, mark resolved.
	function skipChain(issuePly: number): void {
		chainExtensions.delete(issuePly);
		resolveIssue(issuePly);
	}

	// ── Unified response handlers (used by ReviewIssuePicker) ───────────────────

	// Called when user picks a move from ReviewIssuePicker for an original issue
	// (OPPONENT_SURPRISE phase 2 or BEYOND_REPERTOIRE). Saves the move, then
	// checks if the game continues and offers to chain-extend.
	async function handlePickResponseMove(issue: GameIssue, san: string): Promise<void> {
		const fromFen = issue.type === 'OPPONENT_SURPRISE' ? issue.toFen : issue.fromFen;
		const gameSan = issue.type === 'OPPONENT_SURPRISE' ? issue.userResponseSan : issue.playedSan;
		actionLoading.set(issue.ply, true);
		actionError.delete(issue.ply);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen,
				san
			});
			// If the picked move matches the game continuation, try to chain-extend.
			if (san === gameSan) {
				const nextOpponentPly = issue.type === 'OPPONENT_SURPRISE' ? issue.ply + 2 : issue.ply + 1;
				const leg = buildChainLeg(nextOpponentPly);
				if (leg) {
					const advancePly = issue.type === 'OPPONENT_SURPRISE' ? issue.ply + 1 : issue.ply;
					currentPlyIdx = advancePly;
					chainExtensions.set(issue.ply, leg);
					return;
				}
			}
			resolveIssue(issue.ply);
		} catch (e) {
			actionError.set(
				issue.ply,
				(e instanceof Error ? e.message : String(e)) || 'Failed to add move'
			);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Called when user picks a move from ReviewIssuePicker during a chain leg
	// (phase B — choosing a response after the chain opponent's move was added).
	async function handlePickChainResponse(issuePly: number, san: string): Promise<void> {
		const leg = chainExtensions.get(issuePly);
		if (!leg || !leg.userFen) return;
		actionLoading.set(issuePly, true);
		actionError.delete(issuePly);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: overrideRepertoireId ?? data.repertoire.id,
				fromFen: leg.userFen,
				san
			});
			if (san === leg.userSan) {
				// Same move as the game — advance the chain.
				const nextLeg = buildChainLeg(leg.plyInGame + 2);
				if (nextLeg) {
					currentPlyIdx = leg.plyInGame + 1;
					chainExtensions.set(issuePly, nextLeg);
					return;
				}
			}
			chainExtensions.delete(issuePly);
			resolveIssue(issuePly);
		} catch (e) {
			actionError.set(
				issuePly,
				(e instanceof Error ? e.message : String(e)) || 'Failed to add move'
			);
		} finally {
			actionLoading.set(issuePly, false);
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
					repertoireId: overrideRepertoireId ?? data.repertoire.id,
					pgn: parsedPgn,
					deviationFen: analysis.firstDeviationFen,
					notes: notes || null,
					importedGameId: importedGameId ?? undefined
				})
			});
			if (res.ok) {
				const result = (await res.json()) as { id: number };
				savedId = result.id;
				const { invalidateAll } = await import('$app/navigation');
				await invalidateAll();
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
		importedGameId = null;
		overrideRepertoireId = null;
		hoveredFen = null;
		hoveredSan = null;
		newRepIssuePly = null;
		newRepName = '';
	}
</script>

<!-- ════════════════════════════════════════════════════════════════════════════
     STATE A — Input
     ════════════════════════════════════════════════════════════════════════════ -->

{#if pageState === 'input'}
	<div class="input-page">
		<!-- ── Tab bar ─────────────────────────────────────────────────────────── -->
		<div class="input-tabs">
			<button
				class="input-tab"
				class:input-tab--active={inputTab === 'paste'}
				onclick={() => (inputTab = 'paste')}
			>
				Paste PGN
			</button>
			<button
				class="input-tab"
				class:input-tab--active={inputTab === 'import'}
				onclick={() => (inputTab = 'import')}
			>
				Import Games
			</button>
		</div>

		<!-- ── Tab 1: Paste PGN ───────────────────────────────────────────────── -->
		{#if inputTab === 'paste'}
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

					<!-- Hidden repertoire override (set when reviewing an imported game) -->
					{#if overrideRepertoireId}
						<input type="hidden" name="repertoireId" value={overrideRepertoireId} />
					{/if}

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
						<div class="error-banner">
							{analysisError}
							{#if analysisError.includes('Create one first')}
								<button
									type="button"
									class="create-rep-link"
									onclick={() => manageRepertoiresOpen.set(true)}>Create a repertoire</button
								>
							{/if}
						</div>
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

			<!-- ── Tab 2: Import Games ────────────────────────────────────────────── -->
		{:else}
			<div class="input-card">
				<h2 class="input-title">Import Games</h2>
				<p class="input-subtitle">Fetch recent games from Lichess or Chess.com.</p>

				<!-- Import buttons -->
				<div class="import-buttons">
					<button
						class="btn btn--import"
						onclick={() => triggerImport('LICHESS')}
						disabled={importingLichess || !data.importSettings?.lichessUsername}
					>
						{#if importingLichess}
							Importing…
						{:else if !data.importSettings?.lichessUsername}
							Lichess (set username in Settings)
						{:else}
							Import from Lichess
						{/if}
					</button>
					<button
						class="btn btn--import"
						onclick={() => triggerImport('CHESSCOM')}
						disabled={importingChesscom || !data.importSettings?.chesscomUsername}
					>
						{#if importingChesscom}
							Importing…
						{:else if !data.importSettings?.chesscomUsername}
							Chess.com (set username in Settings)
						{:else}
							Import from Chess.com
						{/if}
					</button>
				</div>

				<!-- Import result / error -->
				{#if importResult}
					<div class="import-result">
						{importResult.imported} new game{importResult.imported !== 1 ? 's' : ''} imported from {importResult.source}.
						{#if importResult.skipped > 0}
							{importResult.skipped} already imported.
						{/if}
					</div>
				{/if}
				{#if importError}
					<div class="error-banner">
						{importError}
						{#if importError.includes('Create one first')}
							<button
								type="button"
								class="create-rep-link"
								onclick={() => manageRepertoiresOpen.set(true)}>Create a repertoire</button
							>
						{/if}
					</div>
				{/if}

				<!-- Filter chips -->
				<div class="import-filters">
					{#each ['all', 'pending', 'reviewed', 'skipped'] as f (f)}
						<button
							class="filter-chip"
							class:filter-chip--active={importFilter === f}
							onclick={() => (importFilter = f as typeof importFilter)}
						>
							{f.charAt(0).toUpperCase() + f.slice(1)}
						</button>
					{/each}
				</div>

				<!-- Imported games list -->
				{#if filteredImportedGames.length === 0}
					<p class="import-empty">
						{importFilter === 'all'
							? 'No imported games yet. Click a button above to fetch games.'
							: `No ${importFilter} games.`}
					</p>
				{:else}
					<div class="import-list">
						{#each filteredImportedGames as game (game.id)}
							<div class="import-item">
								<div class="import-meta">
									<span class="import-source import-source--{game.source.toLowerCase()}">
										{game.source === 'LICHESS' ? 'Li' : 'CC'}
									</span>
									<span class="import-color">
										{game.playerColor === 'WHITE' ? '♙' : '♟'}
									</span>
									<span class="import-opponent">
										vs {game.opponentName ?? 'Unknown'}
										{#if game.opponentRating}
											<span class="import-rating">({game.opponentRating})</span>
										{/if}
									</span>
									<span class="import-result-text">{game.result ?? ''}</span>
									{#if game.playedAt}
										<span class="import-date">
											{new Date(game.playedAt).toLocaleDateString(undefined, {
												month: 'short',
												day: 'numeric'
											})}
										</span>
									{/if}
								</div>
								<div class="import-actions">
									{#if game.status === 'pending'}
										<button
											class="btn btn--sm btn--primary"
											onclick={() => startReviewImportedGame(game.id)}
											disabled={repPickerLoading && repPickerGameId === game.id}
										>
											{repPickerLoading && repPickerGameId === game.id ? 'Analyzing…' : 'Review'}
										</button>
										<button
											class="btn btn--sm btn--ghost"
											onclick={() => skipImportedGame(game.id)}
										>
											Skip
										</button>
									{:else if game.status === 'reviewed'}
										<span class="import-badge import-badge--reviewed">Reviewed</span>
									{:else}
										<span class="import-badge import-badge--skipped">Skipped</span>
										<button
											class="btn btn--sm btn--ghost"
											onclick={() => unskipImportedGame(game.id)}
										>
											Un-skip
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

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

	<!-- ── Repertoire Picker Modal ────────────────────────────────────────────── -->
	{#if showRepPicker}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-overlay" onclick={() => (showRepPicker = false)}>
			<div class="modal-card" onclick={(e) => e.stopPropagation()}>
				<h3 class="modal-title">Choose Repertoire</h3>
				<p class="modal-subtitle">
					This game matches multiple repertoires. Pick one to review against.
				</p>
				<div class="rep-picker-list">
					{#each repPickerAnalyses as a (a.repertoireId)}
						<button
							class="rep-picker-item"
							onclick={() => {
								const game = data.importedGames?.find((g) => g.id === repPickerGameId);
								if (game) {
									loadImportedGameForReview(game.id, game.pgn, game.playerColor, a.repertoireId);
								}
							}}
						>
							<span class="rep-picker-name">{a.repertoireName}</span>
							<span class="rep-picker-match">
								Matches first {Math.ceil(a.matchDepth / 2)} move{Math.ceil(a.matchDepth / 2) !== 1
									? 's'
									: ''}
							</span>
							<span class="rep-picker-issues">
								{a.issueCount === 0
									? 'Clean'
									: `${a.issueCount} issue${a.issueCount !== 1 ? 's' : ''}`}
							</span>
						</button>
					{/each}
				</div>
				<button class="btn btn--secondary btn--full" onclick={() => (showRepPicker = false)}>
					Cancel
				</button>
			</div>
		</div>
	{/if}

	<!-- ════════════════════════════════════════════════════════════════════════════
     STATE B — Analysis
     ════════════════════════════════════════════════════════════════════════════ -->
{:else if pageState === 'analysis' && analysis}
	<div class="page">
		<!-- ── Board column ──────────────────────────────────────────────────────── -->
		<div class="board-col">
			<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={handleBoardResize}>
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
			</ResizableBoard>

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
				<span class="rep-icon">{analysedPlayerColor === 'WHITE' ? '♙' : '♟'}</span>
				<span class="rep-name">{analysisRepName ?? data.repertoire.name}</span>
				<span
					class="color-badge"
					class:badge-white={analysedPlayerColor === 'WHITE'}
					class:badge-black={analysedPlayerColor === 'BLACK'}
				>
					{analysedPlayerColor === 'WHITE' ? 'White' : 'Black'}
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
						{@const isActive = currentPlyIdx === issue.ply}
						{@const chainLeg = chainExtensions.get(issue.ply) ?? null}

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
									{:else if chainLeg.userFen}
										<div class="issue-details">
											<span><strong>{chainLeg.opponentSan}</strong> added. Pick your response:</span
											>
										</div>
										<div class="issue-picker-wrap">
											<ReviewIssuePicker
												fen={chainLeg.userFen}
												playerColor={analysedPlayerColor}
												gameMoveSan={chainLeg.userSan}
												gameMoveEvalCp={null}
												onSelectMove={(san) => handlePickChainResponse(issue.ply, san)}
												onHoverMove={(san) => handleHoverMove(chainLeg.userFen ?? '', san)}
												onSkip={() => skipChain(issue.ply)}
												disabled={isLoading}
												loading={isLoading}
											/>
										</div>
									{/if}
								{:else}
									<!-- ── Original issue phases ──────────────────────────────────── -->

									{#if issue.type === 'DEVIATION'}
										{@const ev = deviationEvals.get(issue.ply)}
										<!-- DEVIATION: eval comparison + simple action buttons -->
										<div class="issue-details">
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
															{@const winPct =
																m.totalGames > 0 ? (m.white / m.totalGames) * 100 : 0}
															{@const drawPct =
																m.totalGames > 0 ? (m.draws / m.totalGames) * 100 : 0}
															{@const lossPct =
																m.totalGames > 0 ? (m.black / m.totalGames) * 100 : 0}
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
																<span class="masters-mini-count"
																	>{m.totalGames.toLocaleString()}</span
																>
															</div>
														{/each}
													</div>
												{:else if masters}
													<div class="masters-inline-error">No master games here</div>
												{/if}
											{/if}
										</div>
										{@const devEv = deviationEvals.get(issue.ply)}
										{@const playedBetter =
											devEv?.played != null &&
											devEv?.correct != null &&
											(analysedPlayerColor === 'BLACK' ? -devEv.played : devEv.played) >
												(analysedPlayerColor === 'BLACK' ? -devEv.correct : devEv.correct)}
										<div class="issue-actions">
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
										</div>
									{:else if issue.type === 'BEYOND_REPERTOIRE'}
										<!-- BEYOND_REPERTOIRE: tabbed move picker -->
										<div class="issue-details">
											<span
												>You played <strong>{issue.playedSan}</strong> — no repertoire move here. Pick
												a move to add:</span
											>
										</div>
										<div class="issue-picker-wrap">
											<ReviewIssuePicker
												fen={issue.fromFen}
												playerColor={analysedPlayerColor}
												gameMoveSan={issue.playedSan}
												gameMoveEvalCp={null}
												onSelectMove={(san) => handlePickResponseMove(issue, san)}
												onHoverMove={(san) => handleHoverMove(issue.fromFen, san)}
												onSkip={() => resolveIssue(issue.ply)}
												disabled={isLoading}
												loading={isLoading}
											/>
										</div>
									{:else if issue.type === 'OPPONENT_SURPRISE'}
										{#if !opponentMoveAdded.has(issue.ply)}
											<!-- Phase 1: decide whether to add the opponent's move -->
											<div class="issue-details">
												<span
													>Opponent played <strong>{issue.playedSan}</strong> (not in your repertoire)</span
												>
											</div>
											<div class="issue-actions">
												<button
													class="act-btn act-btn--primary"
													onclick={() => handleAddOpponentMove(issue)}
													disabled={isLoading}
												>
													Add to repertoire
												</button>
												{#if newRepIssuePly === issue.ply}
													<form
														class="new-rep-inline"
														onsubmit={(e) => {
															e.preventDefault();
															handleAddOpponentMoveNewRep(issue);
														}}
													>
														<input
															type="text"
															class="new-rep-input"
															placeholder="Repertoire name"
															bind:value={newRepName}
															disabled={isLoading}
														/>
														<button
															type="submit"
															class="act-btn act-btn--primary act-btn--sm"
															disabled={isLoading || !newRepName.trim()}
														>
															Create
														</button>
														<button
															type="button"
															class="act-btn act-btn--ghost act-btn--sm"
															onclick={() => {
																newRepIssuePly = null;
																newRepName = '';
															}}
															disabled={isLoading}
														>
															Cancel
														</button>
													</form>
												{:else}
													<button
														class="act-btn act-btn--secondary"
														onclick={() => {
															newRepIssuePly = issue.ply;
															newRepName = '';
														}}
														disabled={isLoading}
													>
														Add to new repertoire
													</button>
												{/if}
												<button
													class="act-btn act-btn--ghost"
													onclick={() => resolveIssue(issue.ply)}
													disabled={isLoading}
												>
													Skip
												</button>
											</div>
										{:else}
											<!-- Phase 2: opponent added — pick your response via tabbed panel -->
											<div class="issue-details">
												<span>Added <strong>{issue.playedSan}</strong>. Pick your response:</span>
											</div>
											<div class="issue-picker-wrap">
												<ReviewIssuePicker
													fen={issue.toFen}
													playerColor={analysedPlayerColor}
													gameMoveSan={issue.userResponseSan}
													gameMoveEvalCp={null}
													onSelectMove={(san) => handlePickResponseMove(issue, san)}
													onHoverMove={(san) => handleHoverMove(issue.toFen, san)}
													onSkip={() => resolveIssue(issue.ply)}
													disabled={isLoading}
													loading={isLoading}
												/>
											</div>
										{/if}
									{/if}
								{/if}
							{/if}
							{#if actionError.has(issue.ply)}
								<div class="action-error">{actionError.get(issue.ply)}</div>
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
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	/* ── Input page ─────────────────────────────────────────────────────────── */

	.input-page {
		max-width: 640px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.input-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-surface);
	}

	.input-title {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-body);
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
		border-color: var(--color-accent);
		color: var(--color-text-primary);
		background: var(--color-accent-glow);
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
		border-color: var(--color-accent);
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

	.error-banner .create-rep-link {
		display: inline-block;
		margin-top: var(--space-2);
		background: none;
		border: none;
		padding: 0;
		font-family: inherit;
		font-size: inherit;
		color: var(--color-accent);
		text-decoration: underline;
		font-weight: 600;
		cursor: pointer;
	}

	.error-banner .create-rep-link:hover {
		color: var(--color-text-primary);
	}

	/* ── Input tab bar ─────────────────────────────────────────────────────── */

	.input-tabs {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-2);
	}

	.input-tab {
		padding: var(--space-2) var(--space-4);
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition:
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
	}

	.input-tab:hover {
		color: var(--color-text-secondary);
	}

	.input-tab--active {
		color: var(--color-accent);
		border-bottom-color: var(--color-accent);
		font-weight: 600;
	}

	/* ── Import tab ─────────────────────────────────────────────────────────── */

	.import-buttons {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.btn--import {
		flex: 1;
		min-width: 180px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-base);
		color: var(--color-text-secondary);
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		font-family: var(--font-body);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.btn--import:hover:not(:disabled) {
		border-color: var(--color-accent);
		color: var(--color-text-primary);
		box-shadow: var(--glow-accent);
	}

	.btn--import:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.import-result {
		padding: var(--space-2) var(--space-3);
		background: rgba(92, 204, 92, 0.1);
		border: 1px solid rgba(92, 204, 92, 0.25);
		color: var(--color-success);
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
	}

	.import-filters {
		display: flex;
		gap: var(--space-1);
	}

	.filter-chip {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 0.72rem;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.filter-chip:hover {
		color: var(--color-text-secondary);
	}

	.filter-chip--active {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: var(--color-accent-glow);
	}

	.import-empty {
		color: var(--color-text-muted);
		font-size: 0.82rem;
		text-align: center;
		padding: var(--space-6) 0;
	}

	.import-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 400px;
		overflow-y: auto;
	}

	.import-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-base);
		border-radius: var(--radius-sm);
		font-size: 0.8rem;
	}

	.import-meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.import-source {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 1px 4px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.import-source--lichess {
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-text-muted);
	}

	.import-source--chesscom {
		background: rgba(118, 150, 86, 0.2);
		color: rgba(118, 150, 86, 0.9);
	}

	.import-color {
		flex-shrink: 0;
	}

	.import-opponent {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--color-text-primary);
	}

	.import-rating {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.import-result-text {
		color: var(--color-text-muted);
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.import-date {
		color: var(--color-text-muted);
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.import-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.btn--sm {
		padding: 2px var(--space-2);
		font-size: 0.72rem;
		border-radius: var(--radius-sm);
	}

	.btn--ghost {
		background: transparent;
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.btn--ghost:hover:not(:disabled) {
		color: var(--color-text-secondary);
		border-color: var(--color-text-muted);
	}

	.import-badge {
		font-size: 0.65rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-weight: 600;
	}

	.import-badge--reviewed {
		background: rgba(92, 204, 92, 0.12);
		color: var(--color-success);
	}

	.import-badge--skipped {
		background: rgba(160, 160, 160, 0.12);
		color: var(--color-text-muted);
	}

	/* ── Repertoire picker modal ───────────────────────────────────────────── */

	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--space-4);
	}

	.modal-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		max-width: 400px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.modal-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-family: var(--font-body);
		margin: 0;
	}

	.modal-subtitle {
		font-size: 0.82rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.rep-picker-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.rep-picker-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		background: var(--color-base);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-family: var(--font-body);
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.rep-picker-item:hover {
		border-color: var(--color-accent);
		background: var(--color-accent-glow);
	}

	.rep-picker-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.rep-picker-match {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
	}

	.rep-picker-issues {
		font-size: 0.75rem;
		color: var(--color-text-muted);
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
		color: var(--color-accent-dim);
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
		background: var(--color-accent-glow) !important;
		outline: 1px solid rgba(91, 127, 164, 0.5);
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
		border-color: var(--color-accent);
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
		overflow-y: auto;
	}

	.issue-card {
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		overflow: hidden;
		transition: opacity var(--dur-fast) var(--ease-snap);
		box-shadow: var(--shadow-surface);
	}

	/* Type-specific border/background colours */
	.issue-deviation {
		border-color: rgba(226, 148, 74, 0.4);
		background: rgba(226, 148, 74, 0.05);
	}

	.issue-beyond {
		border-color: rgba(91, 127, 164, 0.4);
		background: rgba(91, 127, 164, 0.05);
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
		color: var(--color-accent);
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
		color: var(--color-accent-dim);
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

	.action-error {
		padding: var(--space-2) var(--space-3);
		font-size: 0.73rem;
		color: var(--color-danger);
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
		background: rgba(91, 127, 164, 0.2);
		border-color: rgba(91, 127, 164, 0.5);
		color: var(--color-accent);
	}

	.act-btn--primary:not(:disabled):hover {
		box-shadow: var(--glow-accent);
	}

	.act-btn--warn {
		background: rgba(226, 148, 74, 0.18);
		border-color: rgba(226, 148, 74, 0.45);
		color: var(--color-accent-dim);
	}

	.act-btn--ghost {
		background: none;
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.act-btn--secondary {
		background: rgba(130, 160, 200, 0.12);
		border-color: rgba(130, 160, 200, 0.35);
		color: var(--color-text-secondary);
	}

	.act-btn--sm {
		padding: var(--space-1) var(--space-2);
		font-size: 0.7rem;
	}

	/* ── New repertoire inline form ──────────────────────────────────────────── */

	.new-rep-inline {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		width: 100%;
	}

	.new-rep-input {
		flex: 1;
		min-width: 0;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.73rem;
	}

	.new-rep-input::placeholder {
		color: var(--color-text-muted);
	}

	.new-rep-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* ── ReviewIssuePicker wrapper (within issue cards) ────────────────────── */

	.issue-picker-wrap {
		padding: 0 var(--space-3) var(--space-3);
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
		border-color: var(--color-accent);
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
		font-family: var(--font-body);
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
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-base);
	}

	.btn--primary:hover:not(:disabled) {
		box-shadow: var(--glow-accent);
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
			grid-template-columns: 1fr 280px;
			gap: var(--space-4);
			align-items: start;
			padding: 0;
		}
	}

	/* Desktop (≥1024px) — --bp-lg */
	@media (min-width: 1024px) {
		.page {
			grid-template-columns: 1fr 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}
</style>
