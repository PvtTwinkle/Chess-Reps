<!--
	Drill Mode — /drill
	───────────────────
	Spaced repetition practice: surface due cards, play through from move 1,
	pause at the user's turn, grade their response.

	DRILL FLOW
	──────────
	1. Load all due SR cards and all moves from the server.
	2. Filter cards by sub-mode (Main / Punishment / Mixed).
	3. Pick the first due card. Reconstruct the path from move 1 to that position.
	4. Auto-play moves at 500ms intervals until reaching the due position.
	5. Board becomes interactive — user must play the correct move.
	6. Correct: green flash → show Again/Good/Easy buttons → grade → next card.
	7. Wrong:   red flash → show correct move → auto-grade Again → next card.
	8. When queue is empty: show session summary.

	PHASE STATE MACHINE
	───────────────────
	idle → playing → waiting → correct → (grading) → idle (next card)
	                         ↘ incorrect → (auto-grade Again) → idle
	idle (all done) → complete
-->

<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { Chess } from 'chess.js';
	import type { PageData } from './$types';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { Key } from '@lichess-org/chessground/types';
	import {
		initSounds,
		setSoundEnabled,
		playMove,
		playCapture,
		playCorrect,
		playIncorrect
	} from '$lib/sounds';

	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	// Shape of a move row from the server (user_move table).
	interface RepertoireMove {
		id: number;
		fromFen: string;
		toFen: string;
		san: string;
	}

	// Shape of a due SR card from the server (user_repertoire_move table).
	interface DueCard {
		id: number;
		fromFen: string;
		san: string;
		state: number | null;
	}

	// One step in the current navigation path through the board.
	interface NavEntry {
		fromFen: string;
		toFen: string;
		san: string;
		from: string;
		to: string;
	}

	type Phase = 'idle' | 'playing' | 'waiting' | 'correct' | 'incorrect' | 'complete';

	let { data }: { data: PageData } = $props();

	// ── Reactive state ─────────────────────────────────────────────────────────

	// All moves in the repertoire — used for path reconstruction.
	let allMoves = $state<RepertoireMove[]>([]);

	// All due cards loaded from the server.
	let allDueCards = $state<DueCard[]>([]);

	// Index into allDueCards — which card we're currently drilling.
	let currentCardIdx = $state(0);

	// SAN moves from move 1 to the current due card's fromFen.
	// The auto-play mechanic steps through this list.
	let path = $state<string[]>([]);

	// Navigation history (same shape as build/explorer mode).
	let navHistory = $state<NavEntry[]>([]);

	// FEN currently on the board.
	let currentFen = $state(STARTING_FEN);

	// Last move played (for yellow highlight on board).
	let lastMove = $state<[string, string] | undefined>(undefined);

	// Current phase of the drill state machine.
	let phase = $state<Phase>('idle');

	// Overlay colour for the correct/incorrect flash animation.
	// null = no overlay shown.
	let flashColor = $state<'green' | 'red' | null>(null);

	// Set when the user plays wrong — shows "The correct move was X" message.
	let revealedSan = $state<string | null>(null);

	// True while a grade fetch is in-flight — prevents double-grading.
	let grading = $state(false);

	// Hint state: whether the user asked for a hint this card, and which
	// square to highlight (the "from" square of the correct move).
	let hintUsed = $state(false);
	let hintSquare = $state<string | null>(null);

	// Session stats (accumulated across all cards in this session).
	let totalReviewed = $state(0);
	let correctCount = $state(0);

	// ID of the drill_session row created when the user grades the first card.
	// Null until the first grade, then set for the rest of the session.
	let sessionId = $state<number | null>(null);

	// ISO timestamp of the next due card after this session completes.
	// Set by the finalize PATCH — displayed on the end screen.
	let nextDueAt = $state<string | null>(null);

	// Incrementing this forces ChessBoard to remount, snapping pieces back.
	let boardKey = $state(0);

	// Timer handle for auto-play. Kept outside reactive state so it doesn't
	// trigger re-renders when set/cleared.
	let autoPlayTimer: ReturnType<typeof setTimeout> | undefined;

	// Timer handle for the incorrect-reveal delay.
	let incorrectTimer: ReturnType<typeof setTimeout> | undefined;

	// Whether sound effects are enabled. Initialised from server settings,
	// can be toggled in-session via the mute button (persisted to the DB).
	let soundEnabled = $state(true);

	// Preload audio files once on mount so sounds play without latency.
	onMount(() => {
		initSounds();
	});

	// ── Keyboard shortcuts ─────────────────────────────────────────────────────

	// Register a keydown listener for the grading shortcuts.
	// The $effect cleanup function removes the listener when the component unmounts.
	$effect(() => {
		function handleKey(e: KeyboardEvent) {
			// Only fire shortcuts when the grading buttons are visible and no
			// modifier keys are held (avoids conflicts with browser shortcuts).
			if (phase !== 'correct' || e.ctrlKey || e.altKey || e.metaKey) return;
			// Ignore keypresses inside input fields.
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			if (e.key === '1') {
				e.preventDefault();
				gradeAndAdvance(1);
			} else if (e.key === '2') {
				e.preventDefault();
				gradeAndAdvance(3);
			} else if (e.key === '3') {
				e.preventDefault();
				gradeAndAdvance(4);
			}
		}

		window.addEventListener('keydown', handleKey);
		return () => window.removeEventListener('keydown', handleKey);
	});

	// ── Sync from server data ──────────────────────────────────────────────────

	// Runs on mount and again whenever the server data changes (e.g. invalidateAll).
	// IMPORTANT: resetBoard() and startNextCard() are wrapped in untrack() to prevent
	// them from adding filteredCards/allMoves/currentCardIdx as reactive dependencies
	// of this effect. Without untrack, writing allDueCards/drillMode above invalidates
	// filteredCards, and then reading filteredCards inside startNextCard() makes it a
	// dependency — causing this effect to re-run infinitely.
	// Keep the sounds module in sync with soundEnabled state.
	$effect(() => {
		setSoundEnabled(soundEnabled);
	});

	$effect(() => {
		allMoves = data.moves as RepertoireMove[];
		allDueCards = data.dueCards as DueCard[];
		soundEnabled = data.settings?.soundEnabled ?? true;

		// Reset session.
		totalReviewed = 0;
		correctCount = 0;
		currentCardIdx = 0;
		sessionId = null;
		nextDueAt = null;

		untrack(() => {
			resetBoard();
			startNextCard();
		});
	});

	// ── Derived ───────────────────────────────────────────────────────────────

	// The card being drilled right now.
	const currentCard = $derived(allDueCards[currentCardIdx] ?? null);

	// The FENs from the navigation history, newest-first, for OpeningName.
	const fenHistory = $derived([...navHistory].reverse().map((e) => e.fromFen));

	// Orientation: white at bottom for white repertoires.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// Progress fraction (0–1) for the progress bar.
	const progress = $derived(allDueCards.length === 0 ? 1 : currentCardIdx / allDueCards.length);

	// Yellow circle on the piece's square when a hint is active.
	// A shape with only `orig` (no `dest`) draws a circle dot on that square.
	const hintShapes = $derived<DrawShape[]>(
		hintSquare ? [{ orig: hintSquare as Key, brush: 'yellow' }] : []
	);

	// ── Utility functions ──────────────────────────────────────────────────────

	// Formats the next-due timestamp into a human-readable string for the end screen.
	// e.g. "Today at 2:30 PM", "Tomorrow at 9:00 AM", "In 3 days".
	function formatNextSession(isoStr: string): string {
		const due = new Date(isoStr);
		const now = new Date();

		// Strip time components to compare calendar days only.
		const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

		const timeStr = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

		if (diffDays === 0) return `Today at ${timeStr}`;
		if (diffDays === 1) return `Tomorrow at ${timeStr}`;
		return `In ${diffDays} days`;
	}

	// ── Hint ───────────────────────────────────────────────────────────────────

	// Use Chess.js to find which square the correct piece moves FROM.
	// Returns null if the SAN can't be found in the current position (shouldn't happen).
	function getHintSquare(fen: string, san: string): string | null {
		const chess = new Chess(fen);
		const move = chess.moves({ verbose: true }).find((m) => m.san === san);
		return move?.from ?? null;
	}

	// Show the hint: highlight the source square of the correct move.
	// Guard against calling more than once per card or outside the waiting phase.
	function showHint() {
		if (hintUsed || !currentCard || phase !== 'waiting') return;
		hintSquare = getHintSquare(currentFen, currentCard.san);
		hintUsed = true;
	}

	// Strip the half-move clock and full-move counter from a FEN so that
	// positions reached via different move orders compare equal.
	function fenKey(fen: string): string {
		return fen.split(' ').slice(0, 4).join(' ');
	}

	// Reconstruct the sequence of SAN moves from the starting position to
	// `targetFen` by walking the move tree backwards.
	// When multiple paths exist (transpositions), any one is chosen — all are
	// equally valid for giving context before the due position.
	function reconstructPath(moves: RepertoireMove[], targetFen: string): string[] {
		// Build a reverse map: normalised(toFen) → { fromFen, san }
		const reverse = new SvelteMap<string, { fromFen: string; san: string }>();
		for (const m of moves) {
			reverse.set(fenKey(m.toFen), { fromFen: m.fromFen, san: m.san });
		}

		const pathSans: string[] = [];
		let current = fenKey(targetFen);
		const startKey = fenKey(STARTING_FEN);

		// Walk backward until we reach the starting position or get stuck.
		while (current !== startKey) {
			const prev = reverse.get(current);
			if (!prev) break; // position not reachable from our tree — stop
			pathSans.unshift(prev.san);
			current = fenKey(prev.fromFen);
		}

		return pathSans;
	}

	// Reset board state to the starting position.
	function resetBoard() {
		stopAutoPlay();
		stopIncorrectTimer();
		navHistory = [];
		currentFen = STARTING_FEN;
		lastMove = undefined;
		flashColor = null;
		revealedSan = null;
		hintUsed = false;
		hintSquare = null;
		boardKey++;
	}

	// Stop any running auto-play timer.
	function stopAutoPlay() {
		if (autoPlayTimer !== undefined) {
			clearTimeout(autoPlayTimer);
			autoPlayTimer = undefined;
		}
	}

	function stopIncorrectTimer() {
		if (incorrectTimer !== undefined) {
			clearTimeout(incorrectTimer);
			incorrectTimer = undefined;
		}
	}

	// ── Card loading and auto-play ─────────────────────────────────────────────

	// Load the card at allDueCards[currentCardIdx] and start playing through from move 1.
	function startNextCard() {
		if (allDueCards.length === 0 || currentCardIdx >= allDueCards.length) {
			phase = 'complete';
			return;
		}

		const card = allDueCards[currentCardIdx];
		path = reconstructPath(allMoves, card.fromFen);

		resetBoard();
		phase = 'playing';
		startAutoPlay(path);
	}

	// Auto-play moves from `pathMoves` one at a time with a 500ms delay.
	// When all moves are played, transitions to 'waiting' so the user can move.
	function startAutoPlay(pathMoves: string[]) {
		// If the position is already at the starting FEN (no path), go to waiting
		// immediately — this card is about the very first move of the game.
		if (pathMoves.length === 0) {
			phase = 'waiting';
			return;
		}

		let fen = STARTING_FEN;
		let history: NavEntry[] = [];
		let idx = 0;

		function step() {
			if (phase !== 'playing') return; // aborted (e.g. repertoire switch)

			if (idx >= pathMoves.length) {
				// Reached the due position — hand control to the user.
				phase = 'waiting';
				return;
			}

			const san = pathMoves[idx];
			try {
				const chess = new Chess(fen);
				const result = chess.move(san);
				if (!result) {
					phase = 'waiting'; // move failed, show what we have
					return;
				}
				const entry: NavEntry = {
					fromFen: fen,
					toFen: chess.fen(),
					san: result.san,
					from: result.from,
					to: result.to
				};
				history = [...history, entry];
				fen = chess.fen();

				// Update reactive state so the board and sidebar update.
				navHistory = history;
				currentFen = fen;
				lastMove = [result.from, result.to];

				// Play the appropriate sound for this auto-played move.
				if (result.captured) playCapture();
				else playMove();
			} catch {
				phase = 'waiting';
				return;
			}

			idx++;
			autoPlayTimer = setTimeout(step, 500);
		}

		// First move plays after a short pause so the user sees the starting position.
		autoPlayTimer = setTimeout(step, 500);
	}

	// ── User move handling ─────────────────────────────────────────────────────

	// Called by ChessBoard when the user drags a piece.
	function handleMove(from: string, to: string, san: string, newFen: string, isCapture: boolean) {
		if (phase !== 'waiting' || !currentCard) return;

		if (san === currentCard.san) {
			// Correct move played. Update the board position regardless.
			navHistory = [...navHistory, { fromFen: currentFen, toFen: newFen, san, from, to }];
			currentFen = newFen;
			lastMove = [from, to];
			flashColor = 'green';
			setTimeout(() => (flashColor = null), 600);
			if (isCapture) playCapture();
			else playMove();

			if (hintUsed) {
				// Hint was used — auto-grade as Again (no grade buttons).
				// Green flash shows they played the right move; the penalty is in the grade.
				phase = 'correct'; // template checks hintUsed to show the penalty message
				incorrectTimer = setTimeout(() => {
					gradeAndAdvance(1); // Rating.Again
				}, 2000);
			} else {
				phase = 'correct';
				playCorrect();
			}
		} else {
			// Wrong move — snap the board back and show the correct move.
			boardKey++;
			phase = 'incorrect';
			flashColor = 'red';
			playIncorrect();
			revealedSan = currentCard.san;
			setTimeout(() => (flashColor = null), 600);

			// After a moment, auto-grade as Again and move on.
			incorrectTimer = setTimeout(() => {
				gradeAndAdvance(1); // Rating.Again = 1
			}, 2000);
		}
	}

	// ── Grading ────────────────────────────────────────────────────────────────

	// Called when the user clicks Again / Good / Easy, or auto-called on wrong answer.
	async function gradeAndAdvance(rating: number) {
		if (grading || !currentCard) return;
		grading = true;

		const wasCorrect = phase === 'correct';

		// Create the session record the first time a card is graded.
		// Non-critical: if this fails we still let the user continue drilling.
		if (sessionId === null) {
			try {
				const sessRes = await fetch('/api/drill/session', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ repertoireId: data.repertoire.id })
				});
				if (sessRes.ok) {
					const sessData = await sessRes.json();
					sessionId = sessData.sessionId;
				}
			} catch {
				// Non-critical — session tracking is best-effort.
			}
		}

		try {
			const res = await fetch('/api/drill/grade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cardId: currentCard.id, rating })
			});
			if (!res.ok) throw new Error(`Grade failed: ${res.status}`);
		} catch (err) {
			console.error('Failed to grade card:', err);
			// Don't block the user from continuing on a network error.
		}

		totalReviewed++;
		if (wasCorrect) correctCount++;

		grading = false;
		currentCardIdx++;
		resetBoard();

		// If this was the last card, finalize the session record and retrieve
		// the next-due timestamp to show on the end screen.
		if (currentCardIdx >= allDueCards.length && sessionId !== null) {
			try {
				const finalRes = await fetch(`/api/drill/session/${sessionId}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ cardsReviewed: totalReviewed, cardsCorrect: correctCount })
				});
				if (finalRes.ok) {
					const finalData = await finalRes.json();
					nextDueAt = finalData.nextDueAt;
				}
			} catch {
				// Non-critical.
			}
		}

		// Small pause between cards so the transition feels deliberate.
		setTimeout(() => {
			startNextCard();
		}, 300);
	}

	// ── Session restart ────────────────────────────────────────────────────────

	// Reload fresh due cards from the server, then let the $effect handle the
	// reset and startNextCard(). This ensures we don't re-drill cards that were
	// just graded (their due dates are now in the future), and picks up any
	// repertoire change that happened while this page was open.
	function restartSession() {
		phase = 'idle'; // hide the complete screen immediately while data loads
		sessionId = null;
		nextDueAt = null;
		invalidateAll();
	}

	// Toggle sound on/off and persist the preference to the database.
	async function toggleSound() {
		soundEnabled = !soundEnabled;
		try {
			await fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ soundEnabled })
			});
		} catch {
			// Non-critical — the in-session toggle still works even if the save fails.
		}
	}
</script>

<div class="page">
	<!-- ── Board column ──────────────────────────────────────────────────────── -->
	<div class="board-col">
		<div class="board-wrap">
			{#key boardKey}
				<ChessBoard
					fen={currentFen}
					{orientation}
					interactive={phase === 'waiting'}
					{lastMove}
					autoShapes={hintShapes}
					onMove={handleMove}
				/>
			{/key}

			<!-- Green/red flash overlay on correct/incorrect -->
			{#if flashColor}
				<div
					class="flash-overlay"
					class:flash-correct={flashColor === 'green'}
					class:flash-incorrect={flashColor === 'red'}
				></div>
			{/if}

			<!-- Auto-play indicator -->
			{#if phase === 'playing'}
				<div class="autoplay-badge">▶ Playing through…</div>
			{/if}
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

		<!-- ECO opening name -->
		<OpeningName {currentFen} {fenHistory} />

		<!-- Progress bar -->
		{#if phase !== 'complete' && allDueCards.length > 0}
			<div class="progress-section">
				<div class="progress-label">
					Card {Math.min(currentCardIdx + 1, allDueCards.length)} of {allDueCards.length}
				</div>
				<div class="progress-bar">
					<div class="progress-fill" style="width: {progress * 100}%"></div>
				</div>
			</div>
		{/if}

		<!-- ── Phase-specific content ─────────────────────────────────────────── -->

		<!-- Empty-state check comes first: always show "All caught up!" when there
		     are no due cards, regardless of phase. Prevents the "Session complete"
		     screen appearing with 0 cards after all cards are pushed into the future. -->
		{#if allDueCards.length === 0}
			<!-- No cards due -->
			<div class="empty-state">
				<div class="empty-icon">✓</div>
				<p class="empty-title">All caught up!</p>
				<p class="empty-hint">No cards due right now. Come back later or build more repertoire.</p>
				<a href="/build" class="btn btn--primary">Build Mode</a>
				<a href="/explorer" class="btn btn--secondary">Explorer</a>
			</div>
		{:else if phase === 'complete'}
			<!-- Session complete screen -->
			<div class="complete-screen">
				<div class="complete-title">Session complete</div>
				<div class="complete-stats">
					<div class="stat-row">
						<span class="stat-label">Cards reviewed</span>
						<span class="stat-value">{totalReviewed}</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Correct first try</span>
						<span class="stat-value">
							{correctCount}
							{#if totalReviewed > 0}
								<span class="stat-pct">({Math.round((correctCount / totalReviewed) * 100)}%)</span>
							{/if}
						</span>
					</div>
					<div class="stat-row">
						<span class="stat-label">Next session</span>
						<span class="stat-value">
							{#if nextDueAt}
								{formatNextSession(nextDueAt)}
							{:else}
								—
							{/if}
						</span>
					</div>
				</div>
				<button class="btn btn--primary" onclick={restartSession}> Drill again </button>
				<a href="/explorer" class="btn btn--secondary">Go to Explorer</a>
			</div>
		{:else if phase === 'playing'}
			<!-- Auto-playing through the line -->
			<div class="section">
				<div class="section-label">PLAYING THROUGH LINE</div>
				<p class="phase-hint">Watch the moves — your turn is coming…</p>
			</div>

			<!-- Current line display -->
			{#if navHistory.length > 0}
				<div class="section">
					<div class="section-label">CURRENT LINE</div>
					<div class="move-list">
						{#each navHistory as entry, i (i)}
							{#if i % 2 === 0}
								<span class="move-num">{Math.floor(i / 2) + 1}.</span>
							{/if}
							<span class="move-san move-san--auto">{entry.san}</span>
						{/each}
					</div>
				</div>
			{/if}
		{:else if phase === 'waiting'}
			<!-- User's turn to play -->
			<div class="turn-indicator user-turn">
				<span class="turn-dot"></span>
				YOUR TURN <span class="turn-hint">— play your move</span>
			</div>

			<!-- Hint button / hint-active indicator -->
			{#if !hintUsed}
				<button class="hint-btn" onclick={showHint}>💡 Hint</button>
			{:else}
				<div class="hint-active">
					<span>💡 Hint active — piece highlighted</span>
					<span class="hint-penalty">Move will be graded Again</span>
				</div>
			{/if}

			<!-- Current line display (clickable) -->
			{#if navHistory.length > 0}
				<div class="section">
					<div class="section-label">CURRENT LINE</div>
					<div class="move-list">
						{#each navHistory as entry, i (i)}
							{#if i % 2 === 0}
								<span class="move-num">{Math.floor(i / 2) + 1}.</span>
							{/if}
							<span class="move-san move-san--auto">{entry.san}</span>
						{/each}
					</div>
				</div>
			{/if}
		{:else if phase === 'correct'}
			<!-- Correct! Show grading buttons, or auto-advance if a hint was used. -->
			<div class="feedback feedback--correct">
				<span class="feedback-icon">✓</span>
				{hintUsed ? 'Correct! (hint used)' : 'Correct!'}
			</div>

			{#if navHistory.length > 0}
				<div class="section">
					<div class="section-label">CURRENT LINE</div>
					<div class="move-list">
						{#each navHistory as entry, i (i)}
							{#if i % 2 === 0}
								<span class="move-num">{Math.floor(i / 2) + 1}.</span>
							{/if}
							<span class="move-san move-san--auto">{entry.san}</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if hintUsed}
				<!-- Hint was used — auto-graded Again, no grade buttons shown. -->
				<p class="auto-advance-hint">Graded as Again — advancing…</p>
			{:else}
				<div class="section">
					<div class="section-label">HOW WELL DID YOU KNOW IT?</div>
					<div class="grade-buttons">
						<button
							class="grade-btn grade-btn--again"
							onclick={() => gradeAndAdvance(1)}
							disabled={grading}
						>
							Again
						</button>
						<button
							class="grade-btn grade-btn--good"
							onclick={() => gradeAndAdvance(3)}
							disabled={grading}
						>
							Good
						</button>
						<button
							class="grade-btn grade-btn--easy"
							onclick={() => gradeAndAdvance(4)}
							disabled={grading}
						>
							Easy
						</button>
					</div>
					<div class="shortcut-hints">
						<span class="shortcut"><kbd>1</kbd> Again</span>
						<span class="shortcut"><kbd>2</kbd> Good</span>
						<span class="shortcut"><kbd>3</kbd> Easy</span>
					</div>
				</div>
			{/if}
		{:else if phase === 'incorrect'}
			<!-- Wrong move — reveal the correct answer and auto-advance. -->
			<div class="feedback feedback--incorrect">
				<span class="feedback-icon">✗</span> Incorrect
			</div>

			{#if revealedSan}
				<div class="section">
					<div class="section-label">CORRECT MOVE</div>
					<div class="revealed-move">{revealedSan}</div>
				</div>
			{/if}

			<p class="auto-advance-hint">Advancing in a moment…</p>
		{/if}
	</div>
</div>

<style>
	/* ── Page layout ──────────────────────────────────────────────────────────── */

	.page {
		display: flex;
		gap: 2rem;
		align-items: flex-start;
	}

	.board-col {
		width: 520px;
		flex-shrink: 0;
	}

	.board-wrap {
		position: relative; /* needed for overlays */
		width: 100%;
	}

	.sidebar {
		flex: 1;
		min-width: 220px;
		max-width: 320px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ── Board overlays ──────────────────────────────────────────────────────── */

	.flash-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: 2px;
		animation: flash-fade 0.6s ease-out forwards;
	}

	.flash-correct {
		background: rgba(80, 200, 80, 0.35);
	}

	.flash-incorrect {
		background: rgba(220, 60, 60, 0.35);
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
		bottom: 0.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		color: #aaa;
		font-size: 0.75rem;
		padding: 0.2rem 0.6rem;
		border-radius: 3px;
		pointer-events: none;
		white-space: nowrap;
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

	/* ── Mute toggle button ───────────────────────────────────────────────────── */

	.mute-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0.1rem 0.2rem;
		border-radius: 3px;
		opacity: 0.6;
		transition: opacity 0.15s;
		flex-shrink: 0;
	}

	.mute-btn:hover {
		opacity: 1;
	}

	.mute-btn.muted {
		opacity: 0.35;
	}

	/* ── Hint button ──────────────────────────────────────────────────────────── */

	.hint-btn {
		width: 100%;
		padding: 0.45rem;
		border-radius: 5px;
		border: 1px solid rgba(226, 183, 20, 0.35);
		background: rgba(226, 183, 20, 0.08);
		color: #e2b714;
		font-size: 0.8rem;
		cursor: pointer;
		transition: filter 0.15s;
	}

	.hint-btn:hover {
		filter: brightness(1.2);
	}

	.hint-active {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.4rem 0.65rem;
		border-radius: 5px;
		border: 1px solid rgba(226, 183, 20, 0.25);
		background: rgba(226, 183, 20, 0.06);
		font-size: 0.78rem;
		color: #c8a010;
	}

	.hint-penalty {
		font-size: 0.7rem;
		color: #888;
		font-style: italic;
	}

	/* ── Keyboard shortcut hints ──────────────────────────────────────────────── */

	.shortcut-hints {
		display: flex;
		gap: 1rem;
		margin-top: 0.4rem;
	}

	.shortcut {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		color: #555;
	}

	kbd {
		display: inline-block;
		padding: 0.05rem 0.3rem;
		border: 1px solid #333;
		border-radius: 3px;
		background: #1a1a2e;
		color: #777;
		font-size: 0.65rem;
		font-family: inherit;
		line-height: 1.4;
	}

	/* ── Progress bar ─────────────────────────────────────────────────────────── */

	.progress-section {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.progress-label {
		font-size: 0.75rem;
		color: #888;
	}

	.progress-bar {
		height: 6px;
		background: #1a1a2e;
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid #0f3460;
	}

	.progress-fill {
		height: 100%;
		background: #4a90d9;
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	/* ── Section headings and move list ──────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-label {
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #555;
		text-transform: uppercase;
	}

	.move-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.4rem;
		font-size: 0.85rem;
	}

	.move-num {
		color: #555;
		font-variant-numeric: tabular-nums;
	}

	.move-san--auto {
		color: #9ab;
	}

	/* ── Turn indicator ───────────────────────────────────────────────────────── */

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

	.turn-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		flex-shrink: 0;
	}

	.turn-hint {
		font-weight: 400;
		font-size: 0.75rem;
		opacity: 0.8;
	}

	/* ── Feedback banners ─────────────────────────────────────────────────────── */

	.feedback {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-radius: 5px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.feedback--correct {
		background: rgba(60, 180, 60, 0.15);
		border: 1px solid rgba(60, 180, 60, 0.4);
		color: #5ccc5c;
	}

	.feedback--incorrect {
		background: rgba(220, 60, 60, 0.15);
		border: 1px solid rgba(220, 60, 60, 0.4);
		color: #e06060;
	}

	.feedback-icon {
		font-size: 1.1rem;
	}

	/* ── Grading buttons ──────────────────────────────────────────────────────── */

	.grade-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.grade-btn {
		flex: 1;
		padding: 0.6rem 0.4rem;
		border-radius: 5px;
		border: 1px solid transparent;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: filter 0.15s;
	}

	.grade-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.grade-btn:not(:disabled):hover {
		filter: brightness(1.15);
	}

	.grade-btn--again {
		background: rgba(220, 60, 60, 0.2);
		border-color: rgba(220, 60, 60, 0.5);
		color: #e06060;
	}

	.grade-btn--good {
		background: rgba(60, 140, 220, 0.2);
		border-color: rgba(60, 140, 220, 0.5);
		color: #60aaee;
	}

	.grade-btn--easy {
		background: rgba(60, 180, 60, 0.2);
		border-color: rgba(60, 180, 60, 0.5);
		color: #5ccc5c;
	}

	/* ── Revealed correct move ────────────────────────────────────────────────── */

	.revealed-move {
		font-size: 1.4rem;
		font-weight: 700;
		color: #e0a020;
		padding: 0.3rem 0;
	}

	/* ── Phase hints ─────────────────────────────────────────────────────────── */

	.phase-hint {
		font-size: 0.8rem;
		color: #666;
		margin: 0;
	}

	.auto-advance-hint {
		font-size: 0.75rem;
		color: #555;
		margin: 0;
		font-style: italic;
	}

	/* ── Empty state ──────────────────────────────────────────────────────────── */

	.empty-state {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 0;
	}

	.empty-icon {
		font-size: 2rem;
		color: #5ccc5c;
	}

	.empty-title {
		font-size: 1rem;
		font-weight: 600;
		color: #e0e0e0;
		margin: 0;
	}

	.empty-hint {
		font-size: 0.8rem;
		color: #777;
		margin: 0;
		line-height: 1.5;
	}

	/* ── Session complete screen ──────────────────────────────────────────────── */

	.complete-screen {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.5rem 0;
	}

	.complete-title {
		font-size: 1.1rem;
		font-weight: 700;
		color: #e0e0e0;
	}

	.complete-stats {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}

	.stat-label {
		color: #888;
	}

	.stat-value {
		color: #e0e0e0;
		font-weight: 600;
	}

	.stat-pct {
		color: #888;
		font-weight: 400;
	}

	/* ── Generic buttons ──────────────────────────────────────────────────────── */

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
	}

	.btn:hover {
		filter: brightness(1.15);
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
</style>
