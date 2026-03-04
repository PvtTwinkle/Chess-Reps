<!--
	Puzzle Training — /puzzles
	──────────────────────────
	Interactive puzzle solving filtered to openings in the user's repertoire.
	Puzzles come from the Lichess puzzle database, imported via puzzle-import.py.

	PUZZLE FLOW
	───────────
	1. Page loads: server returns matching opening families + puzzle count.
	2. Client fetches a random matching puzzle from GET /api/puzzles/next.
	3. Board shows the puzzle's starting FEN.
	4. Auto-play the first move (the "setup" move that creates the tactic).
	5. User must find the correct response.
	6. If more solution moves remain, auto-play opponent's reply, repeat.
	7. On completion or failure, record the attempt and enable "Next Puzzle".

	PHASE STATE MACHINE
	───────────────────
	idle → loading → setup → waiting → correct → (auto-play opponent) → waiting → ...
	                                  ↘ incorrect → idle
	idle (all moves done) → solved → idle
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { onMount } from 'svelte';
	import { Chess } from 'chess.js';
	import type { Key } from '@lichess-org/chessground/types';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { PageData } from './$types';
	import {
		initSounds,
		setSoundEnabled,
		playMove,
		playCapture,
		playCorrect,
		playIncorrect
	} from '$lib/sounds';

	type Phase = 'idle' | 'loading' | 'setup' | 'waiting' | 'correct' | 'incorrect' | 'solved';

	// Shape of a puzzle row from the server.
	interface Puzzle {
		puzzleId: string;
		fen: string;
		moves: string;
		rating: number;
		ratingDeviation: number;
		popularity: number;
		nbPlays: number;
		themes: string | null;
		gameUrl: string | null;
		openingTags: string;
		openingFamily: string;
	}

	let { data }: { data: PageData } = $props();

	// ── Reactive state ─────────────────────────────────────────────────────────

	let phase = $state<Phase>('idle');
	let currentPuzzle = $state<Puzzle | null>(null);
	let currentFen = $state('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
	let orientation = $state<'white' | 'black'>('white');
	let lastMove = $state<[string, string] | undefined>(undefined);
	let flashColor = $state<'green' | 'red' | null>(null);
	let boardKey = $state(0); // force re-mount on new puzzle

	// Solution tracking
	let solutionMoves = $state<string[]>([]); // full UCI move list
	let moveIndex = $state(0); // which move we're at in the solution
	let startTime = $state(0); // when the user's interaction started

	// Filters
	let selectedFamilies = $state<string[]>([]);
	let minRating = $state('');
	let maxRating = $state('');

	// Session stats
	let puzzlesSolved = $state(0);
	let puzzlesFailed = $state(0);

	// Hint support
	let hintShapes = $state<DrawShape[]>([]);

	// Sound setup
	let soundEnabled = $state(true);

	// ── Derived ────────────────────────────────────────────────────────────────

	let puzzlesAttempted = $derived(puzzlesSolved + puzzlesFailed);
	let accuracy = $derived(
		puzzlesAttempted > 0 ? Math.round((puzzlesSolved / puzzlesAttempted) * 100) : 0
	);

	// Format opening family for display: "sicilian defense najdorf variation" → "Sicilian Defense Najdorf Variation"
	function formatFamily(family: string): string {
		return family.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	// Format theme tags for display
	function formatThemes(themes: string | null): string[] {
		if (!themes) return [];
		return themes.split(/\s+/).filter((t) => t.length > 0);
	}

	// ── UCI move parsing ───────────────────────────────────────────────────────

	/** Parse a UCI move string like "e2e4" or "e7e8q" into chess.js move format. */
	function parseUci(uci: string): { from: string; to: string; promotion?: string } {
		return {
			from: uci.slice(0, 2),
			to: uci.slice(2, 4),
			promotion: uci.length > 4 ? uci[4] : undefined
		};
	}

	/** Apply a UCI move to a Chess instance and return the result. */
	function applyUci(chess: Chess, uci: string) {
		const { from, to, promotion } = parseUci(uci);
		return chess.move({ from, to, promotion });
	}

	// ── Puzzle fetching ────────────────────────────────────────────────────────

	async function fetchNextPuzzle() {
		phase = 'loading';
		hintShapes = [];
		currentPuzzle = null;

		// Build query params
		const families = selectedFamilies.length > 0 ? selectedFamilies : data.openingFamilies;

		if (families.length === 0) {
			phase = 'idle';
			return;
		}

		const params = new URLSearchParams();
		params.set('families', families.join(','));
		if (minRating) params.set('minRating', minRating);
		if (maxRating) params.set('maxRating', maxRating);

		try {
			const res = await fetch(`/api/puzzles/next?${params}`);
			const puzzleData: Puzzle | null = await res.json();

			if (!puzzleData) {
				phase = 'idle';
				return;
			}

			currentPuzzle = puzzleData;
			solutionMoves = puzzleData.moves.split(/\s+/);
			moveIndex = 0;

			// Determine board orientation from the puzzle FEN.
			// The puzzle FEN shows the position BEFORE the setup move.
			// The user plays the side that moves AFTER the setup move.
			const chess = new Chess(puzzleData.fen);
			// After the setup move (move 0), it's the OTHER side's turn → that's the user.
			// So the user plays the SAME color as the initial position's turn
			// (because the setup move flips it, then it's user's turn).
			// Actually: initial turn = opponent's setup move. After that, it's the other side = user.
			// So user plays the opposite of the FEN's active color.
			const fenTurn = chess.turn(); // 'w' or 'b'
			orientation = fenTurn === 'w' ? 'black' : 'white';

			// Set up the board at the puzzle's starting FEN
			currentFen = puzzleData.fen;
			lastMove = undefined;
			boardKey++;
			phase = 'setup';

			// Auto-play the setup move after a brief delay
			setTimeout(() => playSetupMove(), 600);
		} catch {
			phase = 'idle';
		}
	}

	// ── Setup move (auto-played) ───────────────────────────────────────────────

	function playSetupMove() {
		if (!currentPuzzle || solutionMoves.length === 0) return;

		const chess = new Chess(currentFen);
		const uci = solutionMoves[0];
		const result = applyUci(chess, uci);

		if (!result) {
			// Invalid move in puzzle data — skip this puzzle
			phase = 'idle';
			return;
		}

		// Update board
		currentFen = chess.fen();
		lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
		moveIndex = 1;
		startTime = Date.now();

		// Play sound for the setup move
		if (result.captured) {
			playCapture();
		} else {
			playMove();
		}

		// Board is now interactive for the user
		phase = 'waiting';
	}

	// ── User move handling ─────────────────────────────────────────────────────

	function handleMove(from: string, to: string, san: string, newFen: string, isCapture: boolean) {
		if (phase !== 'waiting' || !currentPuzzle) return;

		// Check if this move matches the expected solution move
		const expectedUci = solutionMoves[moveIndex];
		const { from: expFrom, to: expTo, promotion: expPromo } = parseUci(expectedUci);

		// Normalize: compare from/to squares. For promotions, also check the piece.
		const moveUci = from + to;
		const expectedBase = expFrom + expTo;

		// For promotion moves, chess.js auto-promotes to queen via ChessBoard,
		// so also check if promotion matches
		const isCorrect = moveUci === expectedBase && (!expPromo || expPromo === 'q'); // ChessBoard auto-promotes to queen

		if (isCorrect) {
			// Correct move!
			if (isCapture) {
				playCapture();
			} else {
				playMove();
			}

			currentFen = newFen;
			lastMove = [from, to];
			moveIndex++;
			hintShapes = [];

			// Check if there are more moves in the solution
			if (moveIndex >= solutionMoves.length) {
				// Puzzle solved!
				phase = 'solved';
				flashColor = 'green';
				playCorrect();
				setTimeout(() => (flashColor = null), 600);
				puzzlesSolved++;
				recordAttempt(true);
			} else {
				// More moves: auto-play the opponent's response
				phase = 'correct';
				flashColor = 'green';
				setTimeout(() => {
					flashColor = null;
					playOpponentResponse();
				}, 500);
			}
		} else {
			// Wrong move — flash red, show correct move
			phase = 'incorrect';
			flashColor = 'red';
			playIncorrect();
			setTimeout(() => (flashColor = null), 600);
			puzzlesFailed++;
			recordAttempt(false);

			// Show the correct move after a moment
			setTimeout(() => {
				showCorrectMove();
			}, 800);
		}
	}

	// ── Opponent auto-play ─────────────────────────────────────────────────────

	function playOpponentResponse() {
		if (moveIndex >= solutionMoves.length || !currentPuzzle) {
			phase = 'solved';
			return;
		}

		const chess = new Chess(currentFen);
		const uci = solutionMoves[moveIndex];
		const result = applyUci(chess, uci);

		if (!result) {
			phase = 'idle';
			return;
		}

		currentFen = chess.fen();
		lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
		moveIndex++;

		if (result.captured) {
			playCapture();
		} else {
			playMove();
		}

		// Check if this was the last move
		if (moveIndex >= solutionMoves.length) {
			phase = 'solved';
			flashColor = 'green';
			playCorrect();
			setTimeout(() => (flashColor = null), 600);
			puzzlesSolved++;
			recordAttempt(true);
		} else {
			// User's turn again
			phase = 'waiting';
		}
	}

	// ── Show correct move on failure ───────────────────────────────────────────

	function showCorrectMove() {
		if (!currentPuzzle || moveIndex >= solutionMoves.length) return;

		const chess = new Chess(currentFen);
		const uci = solutionMoves[moveIndex];
		const result = applyUci(chess, uci);

		if (result) {
			currentFen = chess.fen();
			lastMove = [uci.slice(0, 2), uci.slice(2, 4)];
		}

		// Stay in idle — user can click "Next Puzzle"
		phase = 'idle';
	}

	// ── Attempt recording ──────────────────────────────────────────────────────

	async function recordAttempt(solved: boolean) {
		if (!currentPuzzle) return;

		const timeMs = Date.now() - startTime;

		try {
			await fetch('/api/puzzles/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					puzzleId: currentPuzzle.puzzleId,
					solved,
					timeMs
				})
			});
		} catch {
			// Non-critical — the puzzle still works even if recording fails
		}
	}

	// ── Hint ───────────────────────────────────────────────────────────────────

	function showHint() {
		if (phase !== 'waiting' || moveIndex >= solutionMoves.length) return;

		const uci = solutionMoves[moveIndex];
		const from = uci.slice(0, 2) as Key;

		// Highlight the source square of the correct move
		hintShapes = [{ orig: from, brush: 'green' }];
	}

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			if (phase === 'idle' || phase === 'solved') {
				fetchNextPuzzle();
			}
		}
		if (e.key === 'h' || e.key === 'H') {
			if (phase === 'waiting') {
				showHint();
			}
		}
	}

	// ── Sound initialization ───────────────────────────────────────────────────

	onMount(() => {
		initSounds();
		soundEnabled = data.settings?.soundEnabled ?? true;
		setSoundEnabled(soundEnabled);
	});

	$effect(() => {
		setSoundEnabled(soundEnabled);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- ── Empty states ────────────────────────────────────────────────────────── -->

{#if !data.hasImportedPuzzles}
	<div class="empty-state">
		<h2>No Puzzles Imported</h2>
		<p>The puzzle database hasn't been imported yet. To get started:</p>
		<ol>
			<li>
				Download the puzzle CSV from <a
					href="https://database.lichess.org/#puzzles"
					target="_blank"
					rel="noopener">database.lichess.org</a
				>
			</li>
			<li>Decompress: <code>zstd -d lichess_db_puzzle.csv.zst</code></li>
			<li>
				Run the import script:
				<code>python scripts/puzzle-import.py --csv-path ./lichess_db_puzzle.csv</code>
			</li>
		</ol>
	</div>
{:else if data.openingFamilies.length === 0}
	<div class="empty-state">
		<h2>No Matching Puzzles</h2>
		<p>
			No puzzles match the openings in your current repertoire. Build your repertoire in <a
				href="/build">Build Mode</a
			> to unlock matching puzzles.
		</p>
	</div>
{:else}
	<!-- ── Main puzzle layout ──────────────────────────────────────────────── -->
	<div class="page">
		<!-- ── Board column ────────────────────────────────────────────────── -->
		<div class="board-col">
			<div class="board-wrap">
				{#key boardKey}
					<ChessBoard
						fen={currentFen}
						{orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={phase === 'waiting'}
						{lastMove}
						autoShapes={hintShapes}
						onMove={handleMove}
					/>
				{/key}

				<!-- Green/red flash overlay -->
				{#if flashColor}
					<div
						class="flash-overlay"
						class:flash-correct={flashColor === 'green'}
						class:flash-incorrect={flashColor === 'red'}
					></div>
				{/if}

				<!-- Phase indicator -->
				{#if phase === 'setup'}
					<div class="autoplay-badge">Setting up...</div>
				{:else if phase === 'loading'}
					<div class="autoplay-badge">Loading puzzle...</div>
				{/if}
			</div>

			<!-- Turn indicator -->
			{#if currentPuzzle && (phase === 'waiting' || phase === 'setup')}
				<div class="turn-indicator">
					<span
						class="turn-dot"
						class:white={orientation === 'white'}
						class:black={orientation === 'black'}
					></span>
					Your turn — find the best move
				</div>
			{/if}
		</div>

		<!-- ── Sidebar ─────────────────────────────────────────────────────── -->
		<div class="sidebar">
			<!-- Puzzle info -->
			{#if currentPuzzle}
				<div class="puzzle-info">
					<div class="puzzle-header">
						<span class="puzzle-id">Puzzle #{currentPuzzle.puzzleId}</span>
						<span class="puzzle-rating">Rating {currentPuzzle.rating}</span>
					</div>
					<div class="puzzle-opening">{formatFamily(currentPuzzle.openingFamily)}</div>
					{#if currentPuzzle.themes}
						<div class="puzzle-themes">
							{#each formatThemes(currentPuzzle.themes) as theme}
								<span class="theme-tag">{theme}</span>
							{/each}
						</div>
					{/if}
					{#if currentPuzzle.gameUrl}
						<a href={currentPuzzle.gameUrl} target="_blank" rel="noopener" class="game-link">
							View game on Lichess
						</a>
					{/if}
				</div>
			{/if}

			<!-- Status / Result -->
			{#if phase === 'solved'}
				<div class="result-banner solved">Puzzle solved!</div>
			{:else if phase === 'incorrect'}
				<div class="result-banner failed">Incorrect — showing the solution</div>
			{:else if phase === 'idle' && puzzlesAttempted > 0 && !currentPuzzle}
				<div class="result-banner neutral">Select filters and click Next Puzzle</div>
			{/if}

			<!-- Controls -->
			<div class="controls">
				<button
					class="btn-primary"
					onclick={fetchNextPuzzle}
					disabled={phase === 'loading' ||
						phase === 'setup' ||
						phase === 'waiting' ||
						phase === 'correct'}
				>
					{phase === 'loading' ? 'Loading...' : 'Next Puzzle'}
				</button>

				{#if phase === 'waiting'}
					<button class="btn-secondary" onclick={showHint}> Hint (H) </button>
				{/if}
			</div>

			<!-- Session stats -->
			{#if puzzlesAttempted > 0}
				<div class="session-stats">
					<div class="stat-row">
						<span class="stat-label">Solved</span>
						<span class="stat-value correct">{puzzlesSolved}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Failed</span>
						<span class="stat-value incorrect">{puzzlesFailed}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Accuracy</span>
						<span class="stat-value">{accuracy}%</span>
					</div>
				</div>
			{/if}

			<!-- Filters -->
			<details class="filters" open>
				<summary class="filters-title">Filters</summary>

				<div class="filter-group">
					<label class="filter-label" for="opening-filter">Opening</label>
					<select id="opening-filter" class="filter-select" bind:value={selectedFamilies} multiple>
						{#each data.openingFamilies as family}
							<option value={family}>{formatFamily(family)}</option>
						{/each}
					</select>
					<span class="filter-hint">Hold Ctrl/Cmd to select multiple. Empty = all.</span>
				</div>

				<div class="filter-group">
					<label class="filter-label" for="min-rating">Rating Range</label>
					<div class="rating-inputs">
						<input
							id="min-rating"
							type="number"
							class="filter-input"
							placeholder="Min"
							bind:value={minRating}
						/>
						<span class="rating-sep">–</span>
						<input
							id="max-rating"
							type="number"
							class="filter-input"
							placeholder="Max"
							bind:value={maxRating}
						/>
					</div>
				</div>
			</details>

			<!-- Match info -->
			<div class="match-info">
				{data.totalMatchingPuzzles.toLocaleString()} puzzles match your repertoire
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Page layout ──────────────────────────────────────────────────────────── */

	.page {
		display: flex;
		gap: var(--space-8);
		align-items: flex-start;
	}

	.board-col {
		width: 520px;
		flex-shrink: 0;
	}

	.board-wrap {
		position: relative;
		width: 100%;
	}

	.sidebar {
		flex: 1;
		min-width: 220px;
		max-width: 340px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-family: var(--font-body);
	}

	/* ── Board overlays ──────────────────────────────────────────────────────── */

	.flash-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: var(--radius-sm);
		animation: flash-fade 0.6s ease-out forwards;
	}

	.flash-correct {
		background: rgba(74, 222, 128, 0.35);
	}

	.flash-incorrect {
		background: rgba(248, 113, 113, 0.35);
	}

	@keyframes flash-fade {
		from {
			opacity: 1;
		}
		to {
			opacity: 0;
		}
	}

	.autoplay-badge {
		position: absolute;
		bottom: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: var(--color-text-secondary);
		font-size: 0.75rem;
		font-family: var(--font-body);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		pointer-events: none;
		white-space: nowrap;
	}

	/* ── Turn indicator ──────────────────────────────────────────────────────── */

	.turn-indicator {
		margin-top: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.turn-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.turn-dot.white {
		background: var(--color-text-primary);
	}

	.turn-dot.black {
		background: var(--color-base);
		border: 1px solid var(--color-text-muted);
	}

	/* ── Puzzle info ──────────────────────────────────────────────────────────── */

	.puzzle-info {
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.puzzle-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.puzzle-id {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.puzzle-rating {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-gold);
		background: var(--color-gold-glow);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}

	.puzzle-opening {
		font-size: 0.9rem;
		color: var(--color-text-primary);
		font-weight: 500;
	}

	.puzzle-themes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.theme-tag {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-alt);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
	}

	.game-link {
		font-size: 0.78rem;
		color: var(--color-gold);
		text-decoration: none;
	}

	.game-link:hover {
		text-decoration: underline;
	}

	/* ── Result banners ──────────────────────────────────────────────────────── */

	.result-banner {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: 0.9rem;
		font-weight: 600;
		text-align: center;
	}

	.result-banner.solved {
		background: rgba(74, 222, 128, 0.15);
		color: var(--color-success);
		border: 1px solid rgba(74, 222, 128, 0.3);
	}

	.result-banner.failed {
		background: rgba(248, 113, 113, 0.15);
		color: var(--color-danger);
		border: 1px solid rgba(248, 113, 113, 0.3);
	}

	.result-banner.neutral {
		background: var(--color-gold-glow);
		color: var(--color-gold);
		border: 1px solid rgba(226, 183, 20, 0.2);
	}

	/* ── Controls ─────────────────────────────────────────────────────────────── */

	.controls {
		display: flex;
		gap: var(--space-2);
	}

	.btn-primary {
		flex: 1;
		padding: var(--space-3) var(--space-4);
		background: var(--color-gold);
		color: var(--color-base);
		border: none;
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 0.9rem;
		cursor: pointer;
		transition: background var(--dur-fast) var(--ease-snap);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: var(--space-3) var(--space-2);
		background: transparent;
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 0.85rem;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.btn-secondary:hover {
		border-color: var(--color-gold);
		color: var(--color-gold);
	}

	/* ── Session stats ────────────────────────────────────────────────────────── */

	.session-stats {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.stat-label {
		color: var(--color-text-secondary);
	}

	.stat-value {
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.stat-value.correct {
		color: var(--color-success);
	}

	.stat-value.incorrect {
		color: var(--color-danger);
	}

	/* ── Filters ──────────────────────────────────────────────────────────────── */

	.filters {
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}

	.filters-title {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-weight: 500;
		margin-bottom: var(--space-2);
	}

	.filter-group {
		margin-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.filter-label {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.filter-select {
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1);
		font-family: var(--font-body);
		font-size: 0.82rem;
		min-height: 80px;
	}

	.filter-select option {
		padding: var(--space-1) var(--space-2);
	}

	.filter-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.rating-inputs {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.filter-input {
		flex: 1;
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		font-family: var(--font-body);
		font-size: 0.82rem;
	}

	.filter-input:focus {
		outline: none;
		border-color: var(--color-gold);
		box-shadow: var(--shadow-gold);
	}

	.filter-input::placeholder {
		color: var(--color-text-muted);
	}

	.rating-sep {
		color: var(--color-text-muted);
	}

	/* ── Match info ───────────────────────────────────────────────────────────── */

	.match-info {
		font-size: 0.78rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	/* ── Empty state ──────────────────────────────────────────────────────────── */

	.empty-state {
		max-width: 520px;
		margin: var(--space-8) auto;
		text-align: center;
	}

	.empty-state h2 {
		color: var(--color-text-primary);
		margin-bottom: var(--space-2);
	}

	.empty-state p {
		color: var(--color-text-secondary);
		line-height: 1.6;
	}

	.empty-state ol {
		text-align: left;
		color: var(--color-text-secondary);
		line-height: 1.8;
	}

	.empty-state code {
		background: var(--color-surface);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-size: 0.85rem;
		color: var(--color-gold);
	}

	.empty-state a {
		color: var(--color-gold);
	}

	/* ── Mobile responsive ────────────────────────────────────────────── */

	@media (max-width: 768px) {
		.page {
			flex-direction: column;
		}

		.board-col {
			width: 100%;
		}

		.sidebar {
			max-width: 100%;
		}
	}
</style>
