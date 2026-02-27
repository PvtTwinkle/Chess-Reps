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

	// Per-issue Stockfish state (keyed by issue.ply).
	let stockfishLoading = new SvelteMap<number, boolean>();
	// Evals for DEVIATION issues: evalCp from White's perspective after each move.
	// Fetched in the background when analysis loads; populated as results arrive.
	let deviationEvals = new SvelteMap<number, { played: number | null; correct: number | null }>();
	const deviationFetching = new Set<number>(); // plain Set — not reactive, just dedup guard
	let stockfishSuggestions = new SvelteMap<
		number,
		{ san: string; evalCp: number | null; isBook: boolean; openingName: string | null }[]
	>();
	let actionLoading = new SvelteMap<number, boolean>();

	// ── Save state ──────────────────────────────────────────────────────────────

	let saving = $state(false);
	let savedId = $state<number | null>(null);

	onMount(() => {
		initSounds();
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

			// Reset per-analysis state.
			currentPlyIdx = 0;
			resolvedIssues.clear();
			opponentMoveAdded.clear();
			notes = '';
			savedId = null;
			analysisError = null;
			stockfishLoading.clear();
			stockfishSuggestions.clear();
			actionLoading.clear();
			deviationEvals.clear();
			deviationFetching.clear();

			// Auto-play from the start up to the first issue (or end of game if clean).
			const loaded = form.analysis as GameAnalysis;
			const targetPly =
				loaded.issues.length > 0
					? loaded.issues[0].ply
					: loaded.fenHistory.length - 1;
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

	function stopAutoPlay() {
		autoPlayTarget = null;
		isAutoPlaying = false;
	}

	function startAutoPlay(targetPly: number) {
		if (currentPlyIdx >= targetPly) return;
		autoPlayTarget = targetPly;
		isAutoPlaying = true;
	}

	// Play the correct sound when advancing forward to `ply`.
	function playMoveSound(ply: number) {
		const san = analysis?.sanHistory[ply - 1] ?? '';
		if (san.includes('x')) playCapture();
		else playMove();
	}

	// Move forward one ply — cancels auto-play, plays sound.
	function goForward() {
		stopAutoPlay();
		if (!analysis) return;
		const next = Math.min(analysis.fenHistory.length - 1, currentPlyIdx + 1);
		if (next !== currentPlyIdx) {
			currentPlyIdx = next;
			playMoveSound(next);
		}
	}

	// Move backward one ply — cancels auto-play, no sound.
	function goBack() {
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
	function jumpToIssue(issue: GameIssue) {
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

	// Overlay arrows on the board when viewing a DEVIATION issue position.
	// Red = the wrong move the user played; green = the correct repertoire move.
	const boardShapes = $derived.by((): DrawShape[] => {
		if (!analysis) return [];
		const dev = analysis.issues.find(
			(iss) => iss.type === 'DEVIATION' && currentPlyIdx === iss.ply
		);
		if (!dev || !dev.repertoireSan) return [];

		const shapes: DrawShape[] = [];

		// Wrong move (red arrow).
		const wFrom = analysis.fromSquares[dev.ply - 1];
		const wTo = analysis.toSquares[dev.ply - 1];
		if (wFrom && wTo) shapes.push({ orig: wFrom as Key, dest: wTo as Key, brush: 'red' });

		// Correct move (green arrow).
		const correct = getMoveSquares(dev.fromFen, dev.repertoireSan);
		if (correct) shapes.push({ orig: correct.from as Key, dest: correct.to as Key, brush: 'green' });

		return shapes;
	});

	// Fetch Stockfish evals for a DEVIATION issue (wrong move and correct alternative).
	// Both positions are evaluated in parallel and results stored in deviationEvals.
	// evalCp is always from White's perspective (positive = White better).
	async function fetchDeviationEvals(issue: GameIssue) {
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
				} catch { /* ignore */ }
			}

			const evalPos = async (fen: string): Promise<number | null> => {
				try {
					const res = await fetch('/api/stockfish', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ fen, depth: 15, numMoves: 1 })
					});
					if (!res.ok) return null;
					const data = await res.json() as { candidates?: { evalCp: number | null }[] };
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

	// Resolve an issue without any action (skip).
	function resolveIssue(ply: number) {
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
			if (issue.type === 'DEVIATION') return '#e2944a'; // orange
			if (issue.type === 'BEYOND_REPERTOIRE') return '#4a90d9'; // blue
			if (issue.type === 'OPPONENT_SURPRISE') return '#e06060'; // red
		}
		if (ply > cutoffPly) return '#3a3a4a'; // dim — off-book

		const isUserPly =
			(analysedPlayerColor === 'WHITE' && ply % 2 === 1) ||
			(analysedPlayerColor === 'BLACK' && ply % 2 === 0);
		return isUserPly ? '#5ccc5c' : '#9ab'; // green for user, light blue-gray for opponent
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
	async function handleFailCard(issue: GameIssue) {
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
	async function handleUpdateRepertoire(issue: GameIssue) {
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
	async function handleAddMyMove(issue: GameIssue) {
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			resolveIssue(issue.ply);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 3 — OPPONENT_SURPRISE, phase 1: add only the opponent's move.
	// Moves the card to phase 2 where the user picks their response, and
	// immediately kicks off an engine fetch so candidates are ready without
	// requiring the user to click "Engine suggestion" manually.
	async function handleAddOpponentMove(issue: GameIssue) {
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.fromFen,
				san: issue.playedSan
			});
			opponentMoveAdded.add(issue.ply);
			// Fire the engine fetch in the background — don't await so the
			// action spinner clears immediately while candidates load separately.
			fetchEngineSuggestion(issue);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Case 3 — OPPONENT_SURPRISE, phase 2: add the user's actual in-game response.
	async function handleAddUserResponse(issue: GameIssue) {
		if (!issue.userResponseSan) return;
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen: issue.toFen,
				san: issue.userResponseSan
			});
			resolveIssue(issue.ply);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Fetch engine/book suggestions for an issue position.
	// For Case 2 (BEYOND_REPERTOIRE) the relevant FEN is fromFen (user's move position).
	// For Case 3 (OPPONENT_SURPRISE) the relevant FEN is toFen (position after opponent's
	// surprise move, where the user needs to respond). Fetches 3 candidates for
	// OPPONENT_SURPRISE so the user has multiple response options to choose from.
	async function fetchEngineSuggestion(issue: GameIssue) {
		const fen = issue.type === 'OPPONENT_SURPRISE' ? issue.toFen : issue.fromFen;
		const numMoves = issue.type === 'OPPONENT_SURPRISE' ? 3 : 1;
		stockfishLoading.set(issue.ply, true);
		try {
			const res = await fetch('/api/stockfish', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fen, depth: 15, numMoves })
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
					const seen = new Map<
						string,
						{ san: string; evalCp: number | null; isBook: boolean; openingName: string | null }
					>();
					for (const c of result.candidates) {
						const existing = seen.get(c.san);
						if (!existing) {
							seen.set(c.san, c);
						} else if (!c.isBook && existing.isBook) {
							// Engine version has an eval — merge it into the book entry so the
							// move keeps its book identity (styling, openingName) while also
							// showing an evaluation score.
							seen.set(c.san, { ...existing, evalCp: c.evalCp });
						}
						// All other cases (duplicate book, engine-then-book): first entry wins.
					}
					stockfishSuggestions.set(issue.ply, [...seen.values()]);
				}
			}
		} finally {
			stockfishLoading.set(issue.ply, false);
		}
	}

	// Add a specific engine/book candidate to the repertoire (Case 2 or Case 3 phase 2).
	// The caller passes the SAN directly from the candidate button.
	// For OPPONENT_SURPRISE the opponent's move is already added in phase 1.
	async function handleAddEngineSuggestion(issue: GameIssue, san: string) {
		const fromFen = issue.type === 'OPPONENT_SURPRISE' ? issue.toFen : issue.fromFen;
		actionLoading.set(issue.ply, true);
		try {
			await callApi('/api/review/add-move', {
				repertoireId: data.repertoire.id,
				fromFen,
				san
			});
			resolveIssue(issue.ply);
		} finally {
			actionLoading.set(issue.ply, false);
		}
	}

	// Save the reviewed game record to the database.
	async function saveReview() {
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
	function reviewAnother() {
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
				<ChessBoard fen={currentFen} {orientation} interactive={false} {lastMove} autoShapes={boardShapes} />
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
								<div class="issue-details">
									{#if issue.type === 'DEVIATION'}
										{@const ev = deviationEvals.get(issue.ply)}
										<span
											>You played <strong>{issue.playedSan}</strong>{#if ev?.played != null}&nbsp;<span class="move-eval">{formatEval(ev.played)}</span>{/if}, repertoire has
											<strong>{issue.repertoireSan}</strong>{#if ev?.correct != null}&nbsp;<span class="move-eval">{formatEval(ev.correct)}</span>{/if}</span
										>
									{:else if issue.type === 'BEYOND_REPERTOIRE'}
										<span
											>You played <strong>{issue.playedSan}</strong> — no repertoire move here</span
										>
									{:else if issue.type === 'OPPONENT_SURPRISE'}
										<span
											>Opponent played <strong>{issue.playedSan}</strong> (not in your repertoire)</span
										>
									{/if}
								</div>

								<div class="issue-actions">
									{#if issue.type === 'DEVIATION'}
										<button
											class="act-btn act-btn--warn"
											onclick={() => handleFailCard(issue)}
											disabled={isLoading}
										>
											Fail card
										</button>
										<button
											class="act-btn act-btn--primary"
											onclick={() => handleUpdateRepertoire(issue)}
											disabled={isLoading}
										>
											Update repertoire
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
												Add: {top.san}{formatCandidateEval(top.evalCp)}{top.isBook ? ` · ${top.openingName ?? 'book'}` : ''}
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
													Add: {issue.userResponseSan} (your move)
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
														onclick={() => handleAddEngineSuggestion(issue, candidate.san)}
														disabled={isLoading}
													>
														Add: {candidate.san}{formatCandidateEval(candidate.evalCp)}{candidate.isBook ? ` · ${candidate.openingName ?? 'book'}` : ''}
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
		gap: 2rem;
		align-items: flex-start;
	}

	.board-col {
		width: 520px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.board-wrap {
		width: 100%;
	}

	.sidebar {
		flex: 1;
		min-width: 220px;
		max-width: 340px;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	/* ── Input page ─────────────────────────────────────────────────────────── */

	.input-page {
		max-width: 560px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.input-card {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.input-title {
		font-size: 1.3rem;
		font-weight: 700;
		color: #e0e0e0;
		margin: 0;
	}

	.input-subtitle {
		font-size: 0.85rem;
		color: #888;
		margin: 0;
	}

	/* Color selector */
	.color-selector {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.color-label {
		font-size: 0.85rem;
		color: #888;
		flex-shrink: 0;
	}

	.color-opt {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: #aaa;
		cursor: pointer;
		padding: 0.3rem 0.7rem;
		border-radius: 4px;
		border: 1px solid #222;
		transition:
			border-color 0.15s,
			color 0.15s;
		user-select: none;
	}

	.color-opt input {
		display: none;
	}

	.color-opt.selected {
		border-color: #4a90d9;
		color: #e0e0e0;
		background: rgba(74, 144, 217, 0.1);
	}

	/* PGN textarea */
	.pgn-input {
		width: 100%;
		box-sizing: border-box;
		background: #0d0d1a;
		border: 1px solid #1e2a44;
		border-radius: 5px;
		color: #c0c0c0;
		font-family: 'JetBrains Mono', 'Fira Code', monospace;
		font-size: 0.75rem;
		line-height: 1.5;
		padding: 0.75rem;
		resize: vertical;
		transition: border-color 0.15s;
	}

	.pgn-input:focus {
		outline: none;
		border-color: #4a90d9;
	}

	/* Error banner */
	.error-banner {
		background: rgba(220, 60, 60, 0.12);
		border: 1px solid rgba(220, 60, 60, 0.4);
		color: #e06060;
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		font-size: 0.82rem;
	}

	/* ── History section ────────────────────────────────────────────────────── */

	.history-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.6rem;
		background: #0d0d1a;
		border-radius: 4px;
		font-size: 0.8rem;
	}

	.history-date {
		color: #666;
		flex-shrink: 0;
		min-width: 3.5rem;
	}

	.history-source {
		color: #555;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.history-badge {
		margin-left: auto;
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
		font-weight: 600;
	}

	.history-badge.deviation {
		background: rgba(226, 148, 74, 0.15);
		color: #e2944a;
		border: 1px solid rgba(226, 148, 74, 0.3);
	}

	.history-badge.clean {
		background: rgba(92, 204, 92, 0.12);
		color: #5ccc5c;
		border: 1px solid rgba(92, 204, 92, 0.25);
	}

	/* ── Move list below board ──────────────────────────────────────────────── */

	.move-list-wrap {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.35rem;
		font-size: 0.82rem;
		background: #0d0d1a;
		border: 1px solid #1a1a2e;
		border-radius: 4px;
		padding: 0.5rem 0.6rem;
		max-height: 96px;
		overflow-y: auto;
		line-height: 1.7;
	}

	.move-num {
		color: #454555;
		font-variant-numeric: tabular-nums;
		font-size: 0.75rem;
	}

	.move-san {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.05rem 0.2rem;
		border-radius: 3px;
		font-size: 0.82rem;
		font-family: inherit;
		transition: background 0.1s;
	}

	.move-san:hover {
		background: rgba(255, 255, 255, 0.07);
	}

	.move-san--active {
		background: rgba(74, 144, 217, 0.2) !important;
		outline: 1px solid rgba(74, 144, 217, 0.5);
		border-radius: 3px;
	}

	/* ── Navigation row ─────────────────────────────────────────────────────── */

	.nav-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.nav-arrows {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.nav-btn {
		background: #0f1929;
		border: 1px solid #1e2a44;
		color: #888;
		border-radius: 4px;
		padding: 0.3rem 0.6rem;
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.nav-btn:not(:disabled):hover {
		color: #ccc;
		border-color: #4a90d9;
	}

	.nav-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.nav-pos {
		font-size: 0.8rem;
		color: #666;
		min-width: 5rem;
		text-align: center;
	}

	/* ── Sidebar elements ───────────────────────────────────────────────────── */

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

	.game-info {
		font-size: 0.8rem;
		color: #888;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.game-result {
		font-weight: 700;
		color: #aaa;
	}

	/* ── Section label ──────────────────────────────────────────────────────── */

	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #555;
		text-transform: uppercase;
	}

	/* ── No issues state ────────────────────────────────────────────────────── */

	.no-issues {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.5rem 0;
	}

	.no-issues-icon {
		font-size: 1.5rem;
		color: #5ccc5c;
	}

	.no-issues-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #e0e0e0;
		margin: 0;
	}

	.no-issues-hint {
		font-size: 0.8rem;
		color: #777;
		margin: 0;
	}

	/* ── Issue cards ────────────────────────────────────────────────────────── */

	.issues-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 360px;
		overflow-y: auto;
	}

	.issue-card {
		border-radius: 5px;
		border: 1px solid transparent;
		overflow: hidden;
		transition: opacity 0.2s;
	}

	/* Type-specific border/background colours */
	.issue-deviation {
		border-color: rgba(226, 148, 74, 0.4);
		background: rgba(226, 148, 74, 0.05);
	}

	.issue-beyond {
		border-color: rgba(74, 144, 217, 0.4);
		background: rgba(74, 144, 217, 0.05);
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
		gap: 0.5rem;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.5rem 0.65rem;
		text-align: left;
		font-family: inherit;
	}

	.issue-type-label {
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.issue-move-num {
		font-size: 0.75rem;
		color: #888;
		flex-shrink: 0;
	}

	.issue-san-played {
		font-size: 0.85rem;
		font-weight: 700;
		color: #e0e0e0;
		flex: 1;
	}

	.resolved-mark {
		font-size: 0.9rem;
		color: #5ccc5c;
		flex-shrink: 0;
	}

	.issue-details {
		padding: 0 0.65rem 0.4rem;
		font-size: 0.78rem;
		color: #999;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		line-height: 1.4;
	}

	.issue-details strong {
		color: #ccc;
	}

	.move-eval {
		font-size: 0.7rem;
		color: #666;
		font-weight: 400;
	}

	.issue-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		padding: 0 0.65rem 0.6rem;
	}

	/* Action buttons within issue cards */
	.act-btn {
		padding: 0.3rem 0.55rem;
		border-radius: 4px;
		border: 1px solid transparent;
		font-size: 0.73rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition: filter 0.15s;
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
		background: rgba(74, 144, 217, 0.2);
		border-color: rgba(74, 144, 217, 0.5);
		color: #6ab0e8;
	}

	.act-btn--warn {
		background: rgba(226, 148, 74, 0.18);
		border-color: rgba(226, 148, 74, 0.45);
		color: #e2944a;
	}

	.act-btn--engine {
		background: rgba(226, 183, 20, 0.12);
		border-color: rgba(226, 183, 20, 0.35);
		color: #e2b714;
	}

	.act-btn--book {
		background: rgba(92, 204, 92, 0.12);
		border-color: rgba(92, 204, 92, 0.35);
		color: #5ccc5c;
	}

	.phase-label {
		font-size: 0.75rem;
		color: #888;
		margin: 0 0 4px;
	}

	.act-btn--ghost {
		background: none;
		border-color: #2a2a3a;
		color: #666;
	}

	/* ── Notes + save section ───────────────────────────────────────────────── */

	.save-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: auto;
		padding-top: 0.75rem;
		border-top: 1px solid #0f3460;
	}

	.notes-input {
		width: 100%;
		box-sizing: border-box;
		background: #0d0d1a;
		border: 1px solid #1e2a44;
		border-radius: 4px;
		color: #c0c0c0;
		font-size: 0.8rem;
		padding: 0.5rem 0.6rem;
		resize: vertical;
		font-family: inherit;
	}

	.notes-input:focus {
		outline: none;
		border-color: #4a90d9;
	}

	/* ── Saved page ─────────────────────────────────────────────────────────── */

	.saved-page {
		display: flex;
		justify-content: center;
		padding: 3rem 1rem;
	}

	.saved-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
		max-width: 380px;
	}

	.saved-icon {
		font-size: 2.5rem;
		color: #5ccc5c;
	}

	.saved-title {
		font-size: 1.4rem;
		font-weight: 700;
		color: #e0e0e0;
		margin: 0;
	}

	.saved-subtitle {
		font-size: 0.9rem;
		color: #888;
		margin: 0;
	}

	.saved-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}

	/* ── Shared button styles ───────────────────────────────────────────────── */

	.btn {
		display: block;
		text-align: center;
		padding: 0.5rem 1rem;
		border-radius: 5px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		border: 1px solid transparent;
		transition: filter 0.15s;
		font-family: inherit;
	}

	.btn:hover:not(:disabled) {
		filter: brightness(1.15);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.btn--primary {
		background: #0f3460;
		border-color: #4a90d9;
		color: #e0e0e0;
	}

	.btn--secondary {
		background: #1a1a2e;
		border-color: #0f3460;
		color: #888;
	}

	.btn--full {
		width: 100%;
		box-sizing: border-box;
	}
</style>
