<!--
	Opening Trainer — /train
	────────────────────────
	Practice openings against a computer that plays moves weighted by real game
	statistics from the Lichess open database or masters database.

	PHASE STATE MACHINE
	───────────────────
	setup → playing → ended
	                  ↓
	                  (review handoff via sessionStorage → /review)
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import { fenKey, STARTING_FEN, toFullFen } from '$lib/fen';
	import { reconstructPath } from '$lib/repertoire';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Chess } from 'chess.js';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled, playMove, playCapture } from '$lib/sounds';
	import type { TrainerEvalResult } from '$lib/trainer';
	import { RATING_BRACKETS, bracketForRating } from '$lib/ratings';

	type Phase = 'setup' | 'playing' | 'ended';

	interface SavedPosition {
		id: number;
		fen: string;
		name: string;
		leadInMoves: string | null; // JSON array of SAN strings, or null
		createdAt: Date;
	}

	let { data }: { data: PageData } = $props();

	// ── Reactive state ──────────────────────────────────────────────────────────

	let phase = $state<Phase>('setup');

	// Setup configuration
	let moveSource = $state<'PLAYERS' | 'MASTERS'>('PLAYERS');
	let depthLimit = $state(0); // 0 = no limit
	let rated = $state(true);
	let setupMode = $state<'repertoire' | 'custom' | 'saved'>('repertoire');

	// Starting position — derived from setup mode
	let customFen = $state(STARTING_FEN);
	let customSetupMoves = $state<string[]>([]); // SAN moves made during custom position setup
	let selectedSavedId = $state<number | null>(null);

	// First-time rating setup
	let showRatingSetup = $state(false);
	let initialRating = $state(1200);
	let trainerRating = $state<number | null>(null);

	// Sync from server data on load
	$effect(() => {
		showRatingSetup = data.trainerRating === null;
		trainerRating = data.trainerRating;
	});

	// Board state
	let currentFen = $state(STARTING_FEN);
	let lastMove = $state<[string, string] | undefined>(undefined);
	let boardKey = $state(0);
	let orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// Game state (during playing phase)
	// gameChess maintains the full move history for PGN export — never replace it mid-game.
	// Re-created in startTraining(); only accessed during playing/ended phases.
	let gameChess = $state(new Chess());
	let gameMoves = $state<{ san: string; fen: string; from: string; to: string }[]>([]);
	let waitingForComputer = $state(false);
	let moveCount = $state(0); // total half-moves played by both sides during interactive phase
	let leadInLength = $state(0); // half-moves replayed before interactive play
	let endReason = $state('');

	// Sound
	// eslint-disable-next-line svelte/prefer-writable-derived
	let soundEnabled = $state(true);
	$effect(() => {
		soundEnabled = data.settings?.soundEnabled ?? true;
	});

	// Saved positions
	// eslint-disable-next-line svelte/prefer-writable-derived
	let savedPositions = $state<SavedPosition[]>([]);
	$effect(() => {
		savedPositions = data.savedPositions as SavedPosition[];
	});
	let savePositionName = $state('');
	let savingPosition = $state(false);

	// End screen state
	let evalResult = $state<TrainerEvalResult | null>(null);
	let evaluating = $state(false);

	// ── Derived ─────────────────────────────────────────────────────────────────

	let startFen = $derived.by(() => {
		if (setupMode === 'repertoire') {
			return data.repertoire.startFen ?? STARTING_FEN;
		}
		if (setupMode === 'saved' && selectedSavedId !== null) {
			const pos = savedPositions.find((p) => p.id === selectedSavedId);
			return pos?.fen ?? STARTING_FEN;
		}
		return fenKey(customFen);
	});

	let isUserTurn = $derived.by(() => {
		const sideToMove = currentFen.split(' ')[1]; // 'w' or 'b'
		const userColor = data.repertoire.color === 'WHITE' ? 'w' : 'b';
		return sideToMove === userColor;
	});

	// Rating bracket for Players mode: defaults to bracket matching trainer rating
	let selectedBracket = $state(3);
	$effect(() => {
		const rating = data.trainerRating;
		if (rating !== null) {
			selectedBracket = bracketForRating(rating) ?? 7;
		} else {
			selectedBracket = data.settings?.playersRatingBracket ?? 3;
		}
	});

	// Format eval for display
	let evalDisplay = $derived.by(() => {
		if (!evalResult?.evalCp && evalResult?.evalCp !== 0) return null;
		const cp = evalResult.evalCp;
		if (cp === 99999) return 'Mate (winning)';
		if (cp === -99999) return 'Mate (losing)';
		const pawns = (cp / 100).toFixed(2);
		return cp >= 0 ? `+${pawns}` : pawns;
	});

	// Move list for display, grouped into pairs. Move numbers are offset by
	// the lead-in length so they match the actual PGN move numbers.
	let moveListDisplay = $derived.by(() => {
		const pairs: { num: number; white?: string; black?: string }[] = [];
		const offset = leadInLength; // half-moves before interactive play
		for (let i = 0; i < gameMoves.length; i++) {
			const plyIndex = offset + i; // absolute ply in the full game
			const moveNum = Math.floor(plyIndex / 2) + 1;
			if (plyIndex % 2 === 0) {
				// White's move
				pairs.push({ num: moveNum, white: gameMoves[i].san });
			} else {
				// Black's move — append to existing pair or start new one
				if (pairs.length > 0 && pairs[pairs.length - 1].num === moveNum) {
					pairs[pairs.length - 1].black = gameMoves[i].san;
				} else {
					pairs.push({ num: moveNum, black: gameMoves[i].san });
				}
			}
		}
		return pairs;
	});

	// ── Board resize ────────────────────────────────────────────────────────────

	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

	// ── Sound ───────────────────────────────────────────────────────────────────

	onMount(() => {
		initSounds();
		setSoundEnabled(soundEnabled);
	});

	function toggleSound() {
		soundEnabled = !soundEnabled;
		setSoundEnabled(soundEnabled);
		try {
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ soundEnabled })
			});
		} catch {
			// Non-critical
		}
	}

	// ── Rating setup ────────────────────────────────────────────────────────────

	async function saveInitialRating() {
		const clamped = Math.max(100, Math.min(3000, Math.round(initialRating)));
		try {
			await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trainerRating: clamped })
			});
			trainerRating = clamped;
			showRatingSetup = false;
		} catch {
			// If save fails, let user retry
		}
	}

	// ── Setup: custom position ──────────────────────────────────────────────────

	function handleSetupMove(
		from: string,
		to: string,
		san: string,
		newFen: string,
		isCapture: boolean
	) {
		customFen = newFen;
		customSetupMoves = [...customSetupMoves, san];
		currentFen = newFen;
		lastMove = [from, to] as [string, string];
		if (soundEnabled) {
			if (isCapture) playCapture();
			else playMove();
		}
	}

	function resetCustomPosition() {
		customFen = STARTING_FEN;
		customSetupMoves = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		boardKey++;
	}

	// ── Setup: saved positions ──────────────────────────────────────────────────

	async function saveCurrentPosition() {
		if (!savePositionName.trim()) return;
		savingPosition = true;
		try {
			const res = await fetch('/api/train/saved-positions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fen: customFen,
					name: savePositionName.trim(),
					leadInMoves: customSetupMoves.length > 0 ? customSetupMoves : undefined
				})
			});
			if (res.ok) {
				const { position } = await res.json();
				savedPositions = [position, ...savedPositions];
				savePositionName = '';
			}
		} finally {
			savingPosition = false;
		}
	}

	async function deleteSavedPosition(id: number) {
		try {
			const res = await fetch('/api/train/saved-positions', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				savedPositions = savedPositions.filter((p) => p.id !== id);
				if (selectedSavedId === id) selectedSavedId = null;
			}
		} catch {
			// Non-critical
		}
	}

	// Get the lead-in moves for the current setup mode.
	// Returns SAN array from the standard starting position to the training start.
	function getLeadInMoves(): string[] {
		if (setupMode === 'custom') {
			return customSetupMoves;
		}
		if (setupMode === 'saved' && selectedSavedId !== null) {
			const pos = savedPositions.find((p) => p.id === selectedSavedId);
			if (pos?.leadInMoves) {
				try {
					return JSON.parse(pos.leadInMoves) as string[];
				} catch {
					return [];
				}
			}
			return [];
		}
		if (setupMode === 'repertoire') {
			const repStart = data.repertoire.startFen;
			if (!repStart) return []; // default starting position, no lead-in needed
			return reconstructPath(data.repertoireMoves, repStart);
		}
		return [];
	}

	// ── Game start ──────────────────────────────────────────────────────────────

	function startTraining() {
		// Always start from the standard position and replay lead-in moves so the
		// PGN records the full game from move 1 (no [SetUp] header).
		const leadIn = getLeadInMoves();

		gameChess = new Chess();

		// Set PGN headers so the game is identifiable in review
		const username = data.user?.username ?? 'Player';
		const bracketLabel =
			moveSource === 'PLAYERS' ? ` (${RATING_BRACKETS[selectedBracket].label})` : ' (Masters)';
		const now = new Date();
		const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

		if (data.repertoire.color === 'WHITE') {
			gameChess.header('White', username, 'Black', `Chessstack Trainer${bracketLabel}`);
		} else {
			gameChess.header('White', `Chessstack Trainer${bracketLabel}`, 'Black', username);
		}
		gameChess.header(
			'Event',
			'Opening Trainer',
			'Site',
			'Chessstack',
			'Date',
			dateStr,
			'Round',
			'-'
		);
		if (trainerRating !== null) {
			const ratingKey = data.repertoire.color === 'WHITE' ? 'WhiteElo' : 'BlackElo';
			gameChess.header(ratingKey, String(trainerRating));
		}

		for (const san of leadIn) {
			gameChess.move(san);
		}
		leadInLength = leadIn.length;

		currentFen = gameChess.fen();
		lastMove = undefined;
		gameMoves = [];
		moveCount = 0;
		endReason = '';
		evalResult = null;
		evaluating = false;
		boardKey++;
		phase = 'playing';

		// If it's the computer's turn first (user plays black and white moves first),
		// fetch the computer's opening move
		if (!isUserTurn) {
			fetchComputerMove();
		}
	}

	// ── User move handling ──────────────────────────────────────────────────────

	function handleMove(from: string, to: string, san: string, newFen: string, isCapture: boolean) {
		if (phase !== 'playing' || !isUserTurn) return;

		// Record the move on the persistent Chess instance (preserves PGN history)
		const moveResult = gameChess.move(san);
		if (!moveResult) return; // shouldn't happen (Chessground validated), but don't crash
		gameMoves = [...gameMoves, { san, fen: newFen, from, to }];
		currentFen = newFen;
		lastMove = [from, to] as [string, string];
		moveCount++;

		if (soundEnabled) {
			if (isCapture) playCapture();
			else playMove();
		}

		// Check end conditions
		if (checkEndConditions()) return;

		// Computer's turn
		fetchComputerMove();
	}

	// ── Computer move ───────────────────────────────────────────────────────────

	async function fetchComputerMove() {
		waitingForComputer = true;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive one-shot usage
		const params = new URLSearchParams({
			fen: currentFen,
			source: moveSource.toLowerCase()
		});
		if (moveSource === 'PLAYERS') {
			params.set('rating', String(selectedBracket));
		}

		try {
			const res = await fetch(`/api/train/computer-move?${params}`);
			const result = await res.json();

			if (result.noMoves) {
				endReason = 'The database has no more moves for this position.';
				endGame();
				return;
			}

			// Brief delay for natural feel
			await new Promise((r) => setTimeout(r, data.settings?.playbackSpeed ?? 500));

			// Apply the computer's move on the persistent Chess instance
			const moveResult = gameChess.move(result.san);
			if (!moveResult) {
				// Shouldn't happen, but fall back gracefully
				endReason = 'Computer returned an invalid move.';
				endGame();
				return;
			}

			const newFen = gameChess.fen();
			gameMoves = [
				...gameMoves,
				{ san: result.san, fen: newFen, from: moveResult.from, to: moveResult.to }
			];
			currentFen = newFen;
			lastMove = [moveResult.from, moveResult.to] as [string, string];
			moveCount++;
			boardKey++;

			if (soundEnabled) {
				if (moveResult.captured) playCapture();
				else playMove();
			}

			// Check end conditions after computer's move
			checkEndConditions();
		} catch {
			endReason = 'Failed to fetch computer move.';
			endGame();
		} finally {
			waitingForComputer = false;
		}
	}

	// ── End condition checks ────────────────────────────────────────────────────

	function checkEndConditions(): boolean {
		if (gameChess.isGameOver()) {
			if (gameChess.isCheckmate()) endReason = 'Checkmate!';
			else if (gameChess.isStalemate()) endReason = 'Stalemate.';
			else if (gameChess.isDraw()) endReason = 'Draw.';
			else endReason = 'Game over.';
			endGame();
			return true;
		}

		// Depth limit check: only after a full move pair (both sides moved)
		// depthLimit counts full moves, moveCount counts half-moves
		if (depthLimit > 0) {
			const fullMoves = Math.floor(moveCount / 2);
			if (fullMoves >= depthLimit) {
				endReason = `Reached the depth limit of ${depthLimit} move${depthLimit === 1 ? '' : 's'}.`;
				endGame();
				return true;
			}
		}

		return false;
	}

	// ── Stop button (manual end) ────────────────────────────────────────────────

	function stopTraining() {
		endReason = 'Training stopped manually.';
		endGame();
	}

	// ── End game + evaluate ─────────────────────────────────────────────────────

	async function endGame() {
		phase = 'ended';
		evaluating = true;

		// Set the Result header based on how the game ended
		if (gameChess.isCheckmate()) {
			// The side that just moved delivered checkmate
			const loser = gameChess.turn(); // side that cannot move = lost
			gameChess.header('Result', loser === 'w' ? '0-1' : '1-0');
		} else if (gameChess.isDraw() || gameChess.isStalemate()) {
			gameChess.header('Result', '1/2-1/2');
		} else {
			gameChess.header('Result', '*');
		}

		// Count only the user's half-moves. gameMoves only contains moves made
		// during the interactive phase (after lead-in replay), so index 0 is
		// always the first post-lead-in move.
		const userColor = data.repertoire.color;
		const userMoves = gameMoves.filter((_, i) => {
			return userColor === 'WHITE' ? i % 2 === 0 : i % 2 === 1;
		}).length;

		try {
			const res = await fetch('/api/train/evaluate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fen: currentFen,
					rated: rated && trainerRating !== null,
					repertoireId: data.repertoire.id,
					pgn: gameChess.pgn(),
					movesPlayed: userMoves,
					startFen: startFen,
					moveSource,
					playerColor: data.repertoire.color,
					ratingBracket: moveSource === 'PLAYERS' ? selectedBracket : null
				})
			});
			evalResult = await res.json();
			if (evalResult?.ratingAfter != null) {
				trainerRating = evalResult.ratingAfter;
			}
		} catch {
			evalResult = null;
		} finally {
			evaluating = false;
		}
	}

	// ── Review handoff ──────────────────────────────────────────────────────────

	function reviewGame() {
		const pgn = gameChess.pgn();
		sessionStorage.setItem(
			'chessstack:trainer-review',
			JSON.stringify({
				pgn,
				playerColor: data.repertoire.color,
				repertoireId: data.repertoire.id
			})
		);
		goto('/review'); // eslint-disable-line svelte/no-navigation-without-resolve
	}

	// ── Play again ──────────────────────────────────────────────────────────────

	function playAgain() {
		phase = 'setup';
		currentFen = STARTING_FEN;
		lastMove = undefined;
		gameMoves = [];
		moveCount = 0;
		leadInLength = 0;
		endReason = '';
		evalResult = null;
		boardKey++;
	}

	// ── Setup mode changes ──────────────────────────────────────────────────────

	function switchSetupMode(mode: 'repertoire' | 'custom' | 'saved') {
		setupMode = mode;
		if (mode === 'repertoire') {
			currentFen = toFullFen(data.repertoire.startFen ?? STARTING_FEN);
			lastMove = undefined;
			boardKey++;
		} else if (mode === 'custom') {
			currentFen = toFullFen(customFen);
			lastMove = undefined;
		} else if (mode === 'saved') {
			if (selectedSavedId) {
				const pos = savedPositions.find((p) => p.id === selectedSavedId);
				if (pos) {
					currentFen = toFullFen(pos.fen);
					lastMove = undefined;
					boardKey++;
				}
			}
		}
	}

	function selectSavedPosition(id: number) {
		selectedSavedId = id;
		const pos = savedPositions.find((p) => p.id === id);
		if (pos) {
			currentFen = toFullFen(pos.fen);
			lastMove = undefined;
			boardKey++;
		}
	}
</script>

<div class="page">
	<!-- ── Board column ──────────────────────────────────────────────────────── -->
	<div class="board-col">
		<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={handleBoardResize}>
			<div class="board-wrap">
				{#key boardKey}
					<ChessBoard
						fen={currentFen}
						{orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={(phase === 'setup' && setupMode === 'custom') ||
							(phase === 'playing' && isUserTurn && !waitingForComputer)}
						{lastMove}
						onMove={phase === 'setup' ? handleSetupMove : handleMove}
					/>
				{/key}

				{#if phase === 'playing' && waitingForComputer}
					<div class="autoplay-badge">Thinking...</div>
				{/if}
			</div>
		</ResizableBoard>
	</div>

	<!-- ── Sidebar ───────────────────────────────────────────────────────────── -->
	<div class="sidebar">
		<!-- Repertoire header -->
		<div class="rep-header">
			<span class="rep-icon"
				><span
					class="color-dot {data.repertoire.color === 'WHITE'
						? 'color-dot--white'
						: 'color-dot--black'}"
				></span></span
			>
			<span class="rep-name">{data.repertoire.name}</span>
			<span
				class="color-badge"
				class:badge-white={data.repertoire.color === 'WHITE'}
				class:badge-black={data.repertoire.color === 'BLACK'}
			>
				{data.repertoire.color === 'WHITE' ? 'White' : 'Black'}
			</span>
			<button
				class="mute-btn"
				class:muted={!soundEnabled}
				onclick={toggleSound}
				title={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
				aria-label={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
			>
				{soundEnabled ? '🔊' : '🔇'}
			</button>
		</div>

		<!-- Opening name -->
		<OpeningName {currentFen} fenHistory={gameMoves.map((m) => m.fen).reverse()} />

		<!-- Rating display -->
		{#if trainerRating !== null}
			<div class="rating-display">
				<span class="rating-label">Trainer Rating</span>
				<span class="rating-value">{trainerRating}</span>
			</div>
		{/if}

		<!-- ── First-time rating setup ──────────────────────────────────────── -->
		{#if showRatingSetup}
			<div class="rating-setup">
				<div class="section-label">Set Your Starting Rating</div>
				<p class="setup-desc">
					Choose a starting rating for the opening trainer. This will update based on your
					performance in rated sessions. You can change it later in Settings.
				</p>
				<div class="rating-input-row">
					<input
						type="number"
						class="rating-input"
						min="100"
						max="3000"
						bind:value={initialRating}
					/>
					<button class="btn btn-primary" onclick={saveInitialRating}>Set Rating</button>
				</div>
			</div>
		{/if}

		<!-- ── SETUP PHASE ──────────────────────────────────────────────────── -->
		{#if phase === 'setup' && !showRatingSetup}
			<div class="section">
				<div class="section-label">Starting Position</div>
				<div class="tab-row">
					<button
						class="tab-btn"
						class:active={setupMode === 'repertoire'}
						onclick={() => switchSetupMode('repertoire')}
					>
						Repertoire
					</button>
					<button
						class="tab-btn"
						class:active={setupMode === 'custom'}
						onclick={() => switchSetupMode('custom')}
					>
						Custom
					</button>
					<button
						class="tab-btn"
						class:active={setupMode === 'saved'}
						onclick={() => switchSetupMode('saved')}
					>
						Saved
					</button>
				</div>

				{#if setupMode === 'repertoire'}
					<p class="setup-desc">
						Training starts from your repertoire's configured start position.
					</p>
				{:else if setupMode === 'custom'}
					<p class="setup-desc">Make moves on the board to reach your desired starting position.</p>
					<div class="custom-actions">
						<button class="btn btn-secondary btn-sm" onclick={resetCustomPosition}>
							Reset Board
						</button>
					</div>
					<!-- Save this position -->
					<div class="save-position-row">
						<input
							type="text"
							class="save-position-input"
							placeholder="Position name..."
							maxlength="100"
							bind:value={savePositionName}
						/>
						<button
							class="btn btn-secondary btn-sm"
							onclick={saveCurrentPosition}
							disabled={savingPosition || !savePositionName.trim()}
						>
							Save
						</button>
					</div>
				{:else if setupMode === 'saved'}
					{#if savedPositions.length === 0}
						<p class="setup-desc">No saved positions yet. Use the Custom tab to save one.</p>
					{:else}
						<div class="saved-row">
							<select
								class="bracket-select"
								value={selectedSavedId ?? ''}
								onchange={(e) => {
									const val = (e.target as HTMLSelectElement).value;
									if (val) selectSavedPosition(Number(val));
								}}
							>
								<option value="" disabled>Select a position...</option>
								{#each savedPositions as pos (pos.id)}
									<option value={pos.id}>{pos.name}</option>
								{/each}
							</select>
							{#if selectedSavedId !== null}
								<button
									class="btn btn-secondary btn-sm saved-delete-btn"
									onclick={() => {
										if (selectedSavedId !== null) deleteSavedPosition(selectedSavedId);
									}}
									title="Delete saved position"
									aria-label="Delete saved position"
								>
									&times;
								</button>
							{/if}
						</div>
					{/if}
				{/if}
			</div>

			<div class="section">
				<div class="section-label">Move Source</div>
				<div class="tab-row">
					<button
						class="tab-btn"
						class:active={moveSource === 'PLAYERS'}
						onclick={() => {
							moveSource = 'PLAYERS';
						}}
					>
						Players
					</button>
					<button
						class="tab-btn"
						class:active={moveSource === 'MASTERS'}
						onclick={() => {
							moveSource = 'MASTERS';
						}}
					>
						Masters
					</button>
				</div>
				{#if moveSource === 'PLAYERS'}
					<div class="bracket-row">
						<label class="bracket-label" for="bracket-select">Rating Bracket</label>
						<select id="bracket-select" class="bracket-select" bind:value={selectedBracket}>
							{#each RATING_BRACKETS as bracket (bracket.id)}
								<option value={bracket.id}>{bracket.label}</option>
							{/each}
						</select>
					</div>
					<p class="setup-desc">
						Computer plays moves from Lichess games in the {RATING_BRACKETS[selectedBracket].label} rating
						range.
					</p>
				{:else}
					<p class="setup-desc">Computer plays moves from master-level games (2500+ ELO).</p>
				{/if}
			</div>

			<div class="section">
				<div class="section-label">Depth Limit</div>
				<div class="depth-row">
					<input type="number" class="depth-input" min="0" max="200" bind:value={depthLimit} />
					<span class="depth-hint">
						{depthLimit === 0 ? 'No limit' : `${depthLimit} move${depthLimit === 1 ? '' : 's'}`}
					</span>
				</div>
				<p class="setup-desc">
					Training always stops when the database runs out of moves or the game ends. Set a number
					above 0 to also stop at that many full moves.
				</p>
			</div>

			<div class="section">
				<div class="section-label">Session Type</div>
				<div class="tab-row">
					<button
						class="tab-btn"
						class:active={rated}
						onclick={() => {
							rated = true;
						}}
					>
						Rated
					</button>
					<button
						class="tab-btn"
						class:active={!rated}
						onclick={() => {
							rated = false;
						}}
					>
						Unrated
					</button>
				</div>
			</div>

			<button class="btn btn-primary btn-start" onclick={startTraining}> Start Training </button>

			<!-- ── PLAYING PHASE ────────────────────────────────────────────────── -->
		{:else if phase === 'playing'}
			<div class="section">
				<div class="section-label">Move List</div>
				<div class="move-list">
					{#each moveListDisplay as pair (pair.num)}
						<span class="move-num">{pair.num}.</span>
						{#if pair.white}
							<span class="move-san">{pair.white}</span>
						{/if}
						{#if pair.black}
							<span class="move-san move-san--opponent">{pair.black}</span>
						{/if}
					{/each}
				</div>
			</div>

			<div class="turn-indicator" class:user-turn={isUserTurn && !waitingForComputer}>
				<span class="turn-dot"></span>
				{#if waitingForComputer}
					Computer is thinking...
				{:else if isUserTurn}
					Your move
				{:else}
					Computer's turn
				{/if}
			</div>

			{#if depthLimit > 0}
				<div class="progress-section">
					<span class="progress-label">
						Move {Math.floor(moveCount / 2)} / {depthLimit}
					</span>
					<div class="progress-bar">
						<div
							class="progress-fill"
							style="width: {Math.min(100, (Math.floor(moveCount / 2) / depthLimit) * 100)}%"
						></div>
					</div>
				</div>
			{:else}
				<div class="move-counter">
					{Math.floor(moveCount / 2)} move{Math.floor(moveCount / 2) === 1 ? '' : 's'} played
				</div>
			{/if}

			<button class="btn btn-secondary" onclick={stopTraining}> Stop Training </button>

			<!-- ── ENDED PHASE ──────────────────────────────────────────────────── -->
		{:else if phase === 'ended'}
			<div class="section">
				<div class="section-label">Session Complete</div>
				<p class="end-reason">{endReason}</p>
			</div>

			{#if evaluating}
				<div class="eval-loading">
					<div class="spinner"></div>
					Evaluating position...
				</div>
			{:else if evalResult}
				<div class="eval-card">
					<div class="eval-row">
						<span class="eval-label">Position Eval</span>
						<span
							class="eval-value"
							class:eval-good={evalResult.evalCp != null && evalResult.evalCp > 0}
							class:eval-bad={evalResult.evalCp != null && evalResult.evalCp < 0}
						>
							{evalDisplay ?? 'N/A'}
						</span>
					</div>

					{#if evalResult.ratingBefore != null && evalResult.ratingAfter != null && evalResult.ratingChange != null}
						<div class="eval-row">
							<span class="eval-label">Rating</span>
							<span class="eval-value">
								{evalResult.ratingBefore}
								<span class="rating-arrow">&#8594;</span>
								{evalResult.ratingAfter}
								<span
									class="rating-delta"
									class:delta-positive={evalResult.ratingChange > 0}
									class:delta-negative={evalResult.ratingChange < 0}
								>
									({evalResult.ratingChange > 0 ? '+' : ''}{evalResult.ratingChange})
								</span>
							</span>
						</div>
					{:else if !rated}
						<div class="eval-row">
							<span class="eval-label">Rating</span>
							<span class="eval-value eval-unrated">Unrated session</span>
						</div>
					{/if}

					<div class="eval-row">
						<span class="eval-label">Moves Played</span>
						<span class="eval-value">{Math.floor(moveCount / 2)}</span>
					</div>
				</div>
			{:else}
				<p class="eval-unavailable">Engine evaluation unavailable.</p>
			{/if}

			<!-- Move list recap -->
			{#if gameMoves.length > 0}
				<div class="section">
					<div class="section-label">Game Moves</div>
					<div class="move-list">
						{#each moveListDisplay as pair (pair.num)}
							<span class="move-num">{pair.num}.</span>
							{#if pair.white}
								<span class="move-san">{pair.white}</span>
							{/if}
							{#if pair.black}
								<span class="move-san move-san--opponent">{pair.black}</span>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<div class="end-actions">
				<button class="btn btn-primary" onclick={reviewGame}> Review Game </button>
				<button class="btn btn-secondary" onclick={playAgain}> Play Again </button>
				<a
					class="btn btn-secondary lichess-link"
					href="https://lichess.org/analysis/{(fenKey(currentFen) + ' 0 1').replaceAll(
						' ',
						'_'
					)}?color={orientation}"
					target="_blank"
					rel="noopener noreferrer"
				>
					Analyze on Lichess
				</a>
			</div>
		{/if}
	</div>
</div>

<style>
	/* ── Page layout ──────────────────────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
	}

	.board-wrap {
		position: relative;
		width: 100%;
	}

	.sidebar {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
		box-shadow: var(--shadow-surface);
	}

	@media (min-width: 768px) {
		.page {
			display: grid;
			grid-template-columns: auto 280px;
			gap: var(--space-4);
			align-items: start;
			justify-content: center;
			padding: 0;
		}
	}

	@media (min-width: 1024px) {
		.page {
			grid-template-columns: auto 340px;
			gap: var(--space-6);
			max-width: 1100px;
			margin: 0 auto;
		}
	}

	@media (max-width: 479px) {
		.page {
			padding: var(--space-2);
			gap: var(--space-2);
		}

		.sidebar {
			padding: var(--space-3);
			gap: var(--space-3);
		}
	}

	/* ── Repertoire header ───────────────────────────────────────────────────── */

	.rep-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.rep-icon {
		display: inline-flex;
	}

	.color-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.color-dot--white {
		background: #fff;
		border: 1px solid var(--color-border);
	}

	.color-dot--black {
		background: #333;
	}

	.rep-name {
		font-weight: 600;
		font-size: 0.95rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}

	.badge-white {
		background: rgba(255, 255, 255, 0.15);
		color: var(--color-text-secondary);
	}

	.badge-black {
		background: rgba(0, 0, 0, 0.25);
		color: var(--color-text-secondary);
	}

	.mute-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		padding: 0.15rem;
		opacity: 0.7;
		transition: opacity var(--dur-fast) var(--ease-snap);
	}

	.mute-btn:hover {
		opacity: 1;
	}

	.mute-btn.muted {
		opacity: 0.35;
	}

	/* ── Rating display ──────────────────────────────────────────────────────── */

	.rating-display {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: rgba(91, 127, 164, 0.08);
		border: 1px solid rgba(91, 127, 164, 0.2);
	}

	.rating-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
	}

	.rating-value {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--color-accent);
		font-variant-numeric: tabular-nums;
	}

	/* ── Rating setup (first visit) ──────────────────────────────────────────── */

	.rating-setup {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-accent);
		background: rgba(91, 127, 164, 0.06);
	}

	.rating-input-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}

	.rating-input {
		width: 100px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		font-family: var(--font-body);
	}

	/* ── Section headings ────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-label {
		font-size: 11px;
		font-family: var(--font-body);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		text-transform: uppercase;
	}

	.setup-desc {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
		margin: 0;
	}

	/* ── Tab rows ────────────────────────────────────────────────────────────── */

	.tab-row {
		display: flex;
		gap: 2px;
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	.tab-btn {
		flex: 1;
		padding: var(--space-2) var(--space-2);
		border: none;
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-size: 0.78rem;
		font-weight: 600;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-snap);
	}

	.tab-btn.active {
		background: var(--color-accent);
		color: #fff;
	}

	.tab-btn:hover:not(.active) {
		background: rgba(91, 127, 164, 0.12);
	}

	/* ── Custom position ─────────────────────────────────────────────────────── */

	.custom-actions {
		display: flex;
		gap: var(--space-2);
	}

	.save-position-row {
		display: flex;
		gap: var(--space-2);
	}

	.save-position-input {
		flex: 1;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.78rem;
		font-family: var(--font-body);
	}

	/* ── Saved positions list ────────────────────────────────────────────────── */

	.saved-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.saved-delete-btn {
		flex-shrink: 0;
		min-width: 36px;
		padding: var(--space-1);
		font-size: 1.1rem;
		line-height: 1;
	}

	/* ── Depth input ─────────────────────────────────────────────────────────── */

	.depth-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.depth-input {
		width: 70px;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		font-family: var(--font-body);
	}

	.depth-hint {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}

	/* ── Buttons ──────────────────────────────────────────────────────────────── */

	.btn {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font-size: 0.85rem;
		font-weight: 600;
		font-family: var(--font-body);
		cursor: pointer;
		transition: all var(--dur-fast) var(--ease-snap);
		min-height: 44px;
	}

	.btn-primary {
		background: var(--color-accent);
		color: #fff;
		border-color: var(--color-accent);
	}

	.btn-primary:hover {
		filter: brightness(1.15);
		box-shadow: var(--glow-accent);
	}

	.btn-secondary {
		background: var(--color-surface);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.btn-secondary:hover {
		border-color: var(--color-accent);
	}

	.btn-sm {
		padding: var(--space-1) var(--space-2);
		font-size: 0.75rem;
		min-height: 36px;
	}

	.btn-start {
		width: 100%;
		font-size: 1rem;
		padding: var(--space-3);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Move list ────────────────────────────────────────────────────────────── */

	.move-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		font-size: 0.85rem;
	}

	.move-num {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.move-san {
		font-weight: 500;
	}

	.move-san--opponent {
		color: var(--color-text-secondary);
	}

	/* ── Turn indicator ──────────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		color: var(--color-text-secondary);
	}

	.turn-indicator.user-turn {
		background: rgba(91, 127, 164, 0.1);
		border-color: rgba(91, 127, 164, 0.3);
		color: var(--color-accent);
	}

	.turn-dot {
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	/* ── Progress bar ────────────────────────────────────────────────────────── */

	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.progress-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.progress-bar {
		height: 6px;
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	.progress-fill {
		height: 100%;
		background: var(--color-accent);
		border-radius: var(--radius-sm);
		transition: width var(--dur-base) ease;
	}

	.move-counter {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		padding: var(--space-2) 0;
	}

	/* ── Autoplay badge ──────────────────────────────────────────────────────── */

	.autoplay-badge {
		position: absolute;
		top: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		padding: 0.2rem 0.7rem;
		background: rgba(0, 0, 0, 0.7);
		color: #fff;
		border-radius: var(--radius-md);
		font-size: 0.72rem;
		font-weight: 600;
		pointer-events: none;
		z-index: 3;
	}

	/* ── End screen ──────────────────────────────────────────────────────────── */

	.end-reason {
		font-size: 0.85rem;
		color: var(--color-text);
		margin: 0;
	}

	.eval-loading {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		padding: var(--space-3);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.eval-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.eval-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.eval-label {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
	}

	.eval-value {
		font-size: 0.9rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.eval-good {
		color: var(--color-success);
	}

	.eval-bad {
		color: var(--color-error);
	}

	.eval-unrated {
		color: var(--color-text-muted);
		font-style: italic;
		font-weight: 400;
	}

	.eval-unavailable {
		font-size: 0.82rem;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	.rating-arrow {
		color: var(--color-text-muted);
		margin: 0 var(--space-1);
	}

	.rating-delta {
		font-size: 0.8rem;
		margin-left: var(--space-1);
	}

	.delta-positive {
		color: var(--color-success);
	}

	.delta-negative {
		color: var(--color-error);
	}

	.end-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* ── Bracket selector ────────────────────────────────────────────────────── */

	.bracket-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.bracket-label {
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.bracket-select {
		flex: 1;
		padding: var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.82rem;
		font-family: var(--font-body);
		cursor: pointer;
	}

	/* ── Lichess link ────────────────────────────────────────────────────────── */

	.lichess-link {
		text-align: center;
		text-decoration: none;
	}
</style>
