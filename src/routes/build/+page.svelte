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
	import ResizableBoard from '$lib/components/ResizableBoard.svelte';
	import CandidateMoves from '$lib/components/CandidateMoves.svelte';
	import EvalBar from '$lib/components/EvalBar.svelte';
	import OpeningName from '$lib/components/OpeningName.svelte';
	import MoveList from '$lib/components/build/MoveList.svelte';
	import MoveTree from '$lib/components/build/MoveTree.svelte';
	import AnnotationModal from '$lib/components/build/AnnotationModal.svelte';
	import ImportPgnModal from '$lib/components/build/ImportPgnModal.svelte';
	import { createBuildState, STARTING_FEN, fenKey } from '$lib/components/build/buildState.svelte';
	import { invalidateAll } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import type { PageData } from './$types';
	import { initSounds, setSoundEnabled } from '$lib/sounds';
	import { downloadTextFile, copyToClipboard } from '$lib/download';
	import { Chess } from 'chess.js';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import type { Key } from '@lichess-org/chessground/types';
	import { tutorialStep } from '$lib/stores/tutorial';

	let importOpen = $state(false);
	let exporting = $state(false);
	let exportDropdown = $state(false);
	let exportPgn = $state('');
	let exportFilename = $state('');
	let exportMsg = $state('');

	// ── Keyboard shortcut & hover-arrow state ─────────────────────────────────
	let hoveredSan = $state<string | null>(null);
	let highlightedCandidateIdx = $state<number | null>(null);
	let highlightedContinuationIdx = $state<number | null>(null);
	let activeCandidates = $state<string[]>([]);
	let requestedTab = $state<'book' | 'engine' | 'masters' | null>(null);
	let currentCandidateTab = $state<'book' | 'engine' | 'masters'>('book');

	// ── Eval bar state ────────────────────────────────────────────────────────
	let evalCp = $state<number | null>(null);
	let evalMate = $state<number | null>(null);

	// ── Board resize ─────────────────────────────────────────────────────────
	// Fire-and-forget: the ResizableBoard component already shows the new size
	// via localWidth; no invalidateAll() needed (which would reset nav state).
	function handleBoardResize(size: number) {
		fetch('/api/settings', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ boardSize: size })
		});
	}

	const TAB_ORDER: Array<'book' | 'masters' | 'engine'> = ['book', 'masters', 'engine'];

	/** Resolve from/to squares for a SAN move at the given FEN. */
	function getMoveSquares(fen: string, san: string): { from: string; to: string } | null {
		try {
			const chess = new Chess(fen);
			const result = chess.move(san);
			return result ? { from: result.from, to: result.to } : null;
		} catch {
			return null;
		}
	}

	/** Blue arrow showing the hovered / keyboard-highlighted candidate on the board. */
	const boardShapes: DrawShape[] = $derived.by(() => {
		if (!hoveredSan) return [];
		const sq = getMoveSquares(s.currentFen, hoveredSan);
		if (!sq) return [];
		return [{ orig: sq.from as Key, dest: sq.to as Key, brush: 'blue' }];
	});

	// Reset keyboard highlight whenever the position changes.
	$effect(() => {
		void s.currentFen; // track as dependency
		highlightedCandidateIdx = null;
		highlightedContinuationIdx = null;
		hoveredSan = null;
	});

	function handleKeydown(e: KeyboardEvent) {
		// Don't intercept when a modal is open.
		if (s.annotatingMove || s.pendingDelete || importOpen) return;
		// Don't intercept when typing in an input field.
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
			return;
		}

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				s.handleUndo();
				break;

			case 'ArrowRight':
				e.preventDefault();
				if (s.movesFromCurrentPosition.length > 0) {
					const idx = highlightedContinuationIdx ?? 0;
					s.navigateTo(s.movesFromCurrentPosition[idx]);
				}
				break;

			case 'Home':
				e.preventDefault();
				s.handleReset();
				break;

			case 'ArrowDown':
				e.preventDefault();
				// Context-sensitive: cycle saved continuations when multiple exist,
				// otherwise fall through to candidate highlighting.
				if (s.movesFromCurrentPosition.length > 1) {
					highlightedContinuationIdx =
						highlightedContinuationIdx === null
							? 0
							: Math.min(highlightedContinuationIdx + 1, s.movesFromCurrentPosition.length - 1);
					hoveredSan = s.movesFromCurrentPosition[highlightedContinuationIdx].san;
				} else if (activeCandidates.length > 0) {
					highlightedCandidateIdx =
						highlightedCandidateIdx === null
							? 0
							: Math.min(highlightedCandidateIdx + 1, activeCandidates.length - 1);
				}
				break;

			case 'ArrowUp':
				e.preventDefault();
				if (s.movesFromCurrentPosition.length > 1) {
					highlightedContinuationIdx =
						highlightedContinuationIdx === null
							? s.movesFromCurrentPosition.length - 1
							: Math.max(highlightedContinuationIdx - 1, 0);
					hoveredSan = s.movesFromCurrentPosition[highlightedContinuationIdx].san;
				} else if (activeCandidates.length > 0) {
					highlightedCandidateIdx =
						highlightedCandidateIdx === null
							? activeCandidates.length - 1
							: Math.max(highlightedCandidateIdx - 1, 0);
				}
				break;

			case 'Enter':
				if (
					highlightedCandidateIdx !== null &&
					activeCandidates[highlightedCandidateIdx] &&
					!s.saving
				) {
					e.preventDefault();
					s.handleCandidateSelect(activeCandidates[highlightedCandidateIdx]);
					highlightedCandidateIdx = null;
				}
				break;

			case 'Tab': {
				e.preventDefault();
				const curIdx = TAB_ORDER.indexOf(currentCandidateTab);
				if (e.shiftKey) {
					requestedTab = TAB_ORDER[(curIdx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
				} else {
					requestedTab = TAB_ORDER[(curIdx + 1) % TAB_ORDER.length];
				}
				highlightedCandidateIdx = null;
				break;
			}

			case 'Escape':
				if (highlightedCandidateIdx !== null || highlightedContinuationIdx !== null) {
					e.preventDefault();
					highlightedCandidateIdx = null;
					highlightedContinuationIdx = null;
					hoveredSan = null;
				}
				break;

			default:
				// Number keys 1-5 directly select a candidate.
				if (e.key >= '1' && e.key <= '5' && !s.saving) {
					const idx = parseInt(e.key) - 1;
					if (activeCandidates[idx]) {
						e.preventDefault();
						s.handleCandidateSelect(activeCandidates[idx]);
						highlightedCandidateIdx = null;
					}
				}
				break;
		}
	}

	async function handleExport() {
		if (exporting) return;
		exporting = true;
		exportMsg = '';
		try {
			const res = await fetch(`/api/repertoires/${data.repertoire.id}/export`);
			if (!res.ok) throw new Error('Export failed');
			const result = await res.json();
			exportPgn = result.pgn;
			exportFilename = result.filename;
			exportDropdown = true;
		} catch {
			exportMsg = 'Export failed';
		} finally {
			exporting = false;
		}
	}

	function handleDownload() {
		downloadTextFile(exportPgn, exportFilename);
		exportDropdown = false;
	}

	let copyMsgTimeout: ReturnType<typeof setTimeout> | undefined;

	async function handleCopy() {
		const ok = await copyToClipboard(exportPgn);
		exportDropdown = false;
		exportMsg = ok ? 'Copied!' : 'Copy failed';
		if (ok) {
			clearTimeout(copyMsgTimeout);
			copyMsgTimeout = setTimeout(() => (exportMsg = ''), 2000);
		}
	}

	onMount(() => {
		initSounds();
		return () => {
			clearTimeout(copyMsgTimeout);
		};
	});

	let { data }: { data: PageData } = $props();

	// Keep the sounds module in sync with the user's saved preference.
	// This reacts to changes from the settings page (via invalidateAll).
	$effect(() => {
		setSoundEnabled(data.settings?.soundEnabled ?? true);
	});

	const s = createBuildState({
		getRepertoireId: () => data.repertoire.id,
		getRepertoireColor: () => data.repertoire.color,
		getStartFen: () => data.repertoire.startFen ?? null
	});

	// Board orientation: white at bottom for white repertoires, black for black.
	const orientation = $derived<'white' | 'black'>(
		data.repertoire.color === 'WHITE' ? 'white' : 'black'
	);

	// Reset the transposition dismissed flag whenever the user navigates to a new position.
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		s.currentFen; // tracked — changing this FEN re-runs the $effect
		s.dismissTransposition();
	});

	// One-time flag: have we already replayed the jump line from the URL param?
	// Plain (non-reactive) variable so Svelte does not track it as a dependency.
	let didJumpToLine = false;

	// Sync all local state from the server-provided page data.
	// Runs on initial mount AND whenever `data` is refreshed.
	$effect(() => {
		const jumpLine = !didJumpToLine && data.jumpLine ? data.jumpLine : undefined;
		if (jumpLine) didJumpToLine = true;
		s.syncFromData(data.moves as Parameters<typeof s.syncFromData>[0], jumpLine);

		// When arriving via a Gap Finder deep link, the jump line may include
		// an opponent book move that isn't in the user's repertoire yet. Save
		// any missing moves so the tree stays connected.
		// Wrapped in untrack() because saveJumpLineMoves reads reactive state
		// (moves, navHistory) — without untrack, those reads would become
		// dependencies of this $effect, causing it to re-run and reset the
		// board back to the starting position when the saves complete.
		if (jumpLine) {
			untrack(() => s.saveJumpLineMoves());
		}
	});

	// ── Tutorial: advance after 8 half-moves ─────────────────────────────────
	$effect(() => {
		if ($tutorialStep !== 1) return;
		// navHistory length = number of half-moves in the current line
		if (s.navHistory.length >= 8) {
			fetch('/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tutorialStep: 2 })
			}).then(() => invalidateAll());
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="page">
	<!-- ── Board column ─────────────────────────────────────────────────────── -->
	<!--
		{#key boardKey} remounts the board when boardKey increments.
		We increment boardKey to reject a move visually — it forces
		Chessground to reinitialize with `currentFen`, snapping the
		piece back to where it was.
	-->
	<div class="board-col">
		<ResizableBoard boardSize={data.settings?.boardSize ?? 0} onResize={handleBoardResize}>
			<div class="board-inner">
				<EvalBar {evalCp} {evalMate} {orientation} />
				{#key s.boardKey}
					<ChessBoard
						fen={s.currentFen}
						{orientation}
						boardTheme={data.settings?.boardTheme ?? 'blue'}
						interactive={!s.saving}
						lastMove={s.lastMove}
						onMove={s.handleMove}
						autoShapes={boardShapes}
					/>
				{/key}
			</div>
		</ResizableBoard>
	</div>

	<!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
	<div class="sidebar">
		<!-- Repertoire identity -->
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
			{#if !s.exploreMode}
				<button class="import-btn" onclick={() => (importOpen = true)} title="Import PGN">
					Import PGN
				</button>
				<div class="export-wrap">
					<button class="import-btn" onclick={handleExport} disabled={exporting} title="Export PGN">
						{exporting ? 'Exporting…' : 'Export PGN'}
					</button>
					{#if exportDropdown}
						<div class="export-dropdown">
							<button class="export-option" onclick={handleDownload}>Download .pgn</button>
							<button class="export-option" onclick={handleCopy}>Copy to clipboard</button>
							<button class="export-option export-cancel" onclick={() => (exportDropdown = false)}
								>Cancel</button
							>
						</div>
					{/if}
					{#if exportMsg}
						<span class="export-msg">{exportMsg}</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Mode toggle -->
		<div class="mode-toggle">
			<button
				class="mode-btn"
				class:mode-btn--active={!s.exploreMode}
				onclick={() => {
					if (s.exploreMode) s.toggleExploreMode();
				}}
			>
				Build
			</button>
			<button
				class="mode-btn"
				class:mode-btn--active={s.exploreMode}
				onclick={() => {
					if (!s.exploreMode) s.toggleExploreMode();
				}}
			>
				Explore
			</button>
		</div>

		<!-- ECO opening name (updates as moves are played) -->
		<OpeningName currentFen={s.currentFen} fenHistory={s.fenHistory} />

		{#if s.exploreMode}
			<div class="banner banner--explore">Explore mode — moves are not saved to repertoire</div>
		{:else}
			<!-- Turn indicator -->
			<div class="turn-indicator" class:user-turn={s.isUserTurn} class:opp-turn={!s.isUserTurn}>
				<span class="turn-dot"></span>
				{#if s.isUserTurn}
					YOUR TURN <span class="turn-hint">— play a move on the board</span>
				{:else}
					OPPONENT'S TURN <span class="turn-hint">— play their move to add a response</span>
				{/if}
			</div>

			<!-- Conflict warning -->
			{#if s.conflictSan}
				<div class="banner banner--warn">
					You already have <strong>{s.conflictSan}</strong> here. Remove it first to change your
					move.
					<button class="banner-dismiss" aria-label="Dismiss" onclick={() => s.dismissConflict()}
						>✕</button
					>
				</div>
			{/if}
		{/if}

		<!-- Error message -->
		{#if s.errorMsg}
			<div class="banner banner--error">
				{s.errorMsg}
				<button class="banner-dismiss" aria-label="Dismiss" onclick={() => s.dismissError()}
					>✕</button
				>
			</div>
		{/if}

		<!-- Transposition notice -->
		{#if s.transpositionExists && !s.transpositionDismissed}
			<div class="banner banner--info">
				<strong>Transposition</strong> — this position is already in your repertoire via a different
				move order. Your existing preparation applies here.
				<button class="banner-dismiss" aria-label="Dismiss" onclick={() => s.dismissTransposition()}
					>✕</button
				>
			</div>
		{/if}

		<!-- Current line -->
		<MoveList
			movePairs={s.movePairs}
			currentIdx={s.navHistory.length - 1}
			onNavigate={s.navigateToHistoryIdx}
			isExploreEntry={s.exploreMode ? s.isExploreNavEntry : undefined}
		/>

		<!-- Full repertoire tree view -->
		<MoveTree
			moves={s.moves}
			currentFen={s.currentFen}
			startFen={s.startFen}
			onNavigateToLine={s.navigateToLine}
		/>

		<!-- Moves from the current position -->
		{#if s.exploreMode}
			{#if s.movesFromCurrentPosition.length > 0}
				<div class="section">
					<div class="section-label">SAVED MOVES HERE</div>
					<div class="position-moves">
						{#each s.movesFromCurrentPosition as m, idx (m.id)}
							<div class="position-move-row">
								<button
									class="move-nav-btn"
									class:move-nav-btn--highlighted={highlightedContinuationIdx === idx}
									onclick={() => s.navigateTo(m)}
									onmouseenter={() => {
										hoveredSan = m.san;
									}}
									onmouseleave={() => {
										hoveredSan = null;
									}}
								>
									{m.san}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<div class="section">
				<div class="section-label">
					{s.isUserTurn ? 'YOUR MOVE' : 'OPPONENT RESPONSES'}
				</div>

				{#if s.movesFromCurrentPosition.length > 0}
					<div class="position-moves">
						{#each s.movesFromCurrentPosition as m, idx (m.id)}
							<div class="position-move-item">
								<div class="position-move-row">
									<button
										class="move-nav-btn"
										class:move-nav-btn--highlighted={highlightedContinuationIdx === idx}
										onclick={() => s.navigateTo(m)}
										onmouseenter={() => {
											hoveredSan = m.san;
										}}
										onmouseleave={() => {
											hoveredSan = null;
										}}
									>
										{m.san}
									</button>
									<button
										class="move-annotate-btn"
										onclick={() => s.openAnnotation(m)}
										title="Add or edit annotation"
										aria-label="Edit annotation for {m.san}"
									>
										✎
									</button>
									<button
										class="move-delete-btn"
										onclick={() => s.confirmDelete(m)}
										disabled={s.saving}
										title="Remove this move and all moves after it"
									>
										✕
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
						{#if s.isUserTurn}
							No move saved yet — play one on the board.
						{:else}
							No responses yet — play an opponent move to add one.
						{/if}
					</p>
				{/if}
			</div>
		{/if}

		<!-- Candidate moves (book + Stockfish suggestions) -->
		<CandidateMoves
			currentFen={s.currentFen}
			onSelectMove={s.handleCandidateSelect}
			onHoverMove={(san) => {
				hoveredSan = san;
			}}
			disabled={s.saving}
			playerColor={data.repertoire.color as 'WHITE' | 'BLACK'}
			highlightedIndex={highlightedCandidateIdx}
			onCandidatesChanged={(sans) => {
				activeCandidates = sans;
			}}
			{requestedTab}
			onTabChanged={(tab) => {
				currentCandidateTab = tab;
				requestedTab = null;
			}}
			onEvalChanged={(cp, mate) => {
				evalCp = cp;
				evalMate = mate;
			}}
		/>

		<!-- Navigation controls -->
		<div class="nav-controls">
			<button
				class="nav-btn"
				onclick={s.handleReset}
				disabled={s.navHistory.length === 0 || s.saving}
				title="Return to the starting position"
			>
				⏮
			</button>
			<button
				class="nav-btn nav-btn--undo"
				onclick={s.handleUndo}
				disabled={s.navHistory.length === 0 || s.saving}
				title="Go back one move (does not delete from repertoire)"
			>
				← Undo
			</button>
			{#if !s.exploreMode}
				<button
					class="nav-btn nav-btn--annotate"
					onclick={s.annotateLastMove}
					disabled={s.navHistory.length === 0 || s.saving}
					title="Annotate the last move"
				>
					✎
				</button>
			{/if}
		</div>

		{#if s.exploreMode && s.hasUnsavedExploreMoves}
			<button
				class="save-line-btn"
				onclick={s.saveExploreLine}
				disabled={s.saving}
				title="Save all moves in the current line to your repertoire"
			>
				{s.saving ? 'Saving…' : 'Add current line to repertoire'}
			</button>
		{/if}

		{#if !s.exploreMode}
			<!-- Start position control -->
			{#if s.isStartPosition}
				<div class="start-indicator">
					<span class="start-label">Start Position</span>
					<button
						class="start-clear-btn"
						onclick={s.clearStartPosition}
						disabled={s.saving}
						title="Reset to default (after first move)"
					>
						Clear
					</button>
				</div>
			{:else if fenKey(s.currentFen) !== fenKey(STARTING_FEN) && s.navHistory.length > 0}
				<button
					class="start-btn"
					onclick={s.setStartPosition}
					disabled={s.saving}
					title="Set this position as the repertoire's starting point — moves before it won't be drilled"
				>
					Set as Start Position
				</button>
			{:else if s.startFen && fenKey(s.currentFen) === fenKey(STARTING_FEN)}
				<button
					class="start-clear-btn-standalone"
					onclick={s.clearStartPosition}
					disabled={s.saving}
					title="Reset to default (after first move)"
				>
					Clear Start Position
				</button>
			{/if}

			<!-- Drill from here -->
			{#if s.navHistory.length > 0 && s.movesFromCurrentPosition.length > 0}
				<a
					href="/drill?mode=all&fromFen={encodeURIComponent(s.currentFen)}"
					class="drill-here-btn"
					title="Drill all cards downstream from this position"
				>
					Drill from here
				</a>
			{/if}

			<!-- Saving indicator -->
			{#if s.saving}
				<div class="saving-indicator">Saving…</div>
			{/if}
		{/if}
	</div>

	<!-- ── Annotation modal ──────────────────────────────────────────────── -->
	{#if s.annotatingMove}
		<AnnotationModal
			move={s.annotatingMove}
			bind:draft={s.annotationDraft}
			saving={s.savingAnnotation}
			error={s.annotationError}
			onSave={s.saveAnnotation}
			onClose={s.closeAnnotation}
		/>
	{/if}

	<!-- ── Delete confirmation modal ────────────────────────────────────── -->
	{#if s.pendingDelete}
		{@const subtreeCount = s.pendingDeleteSubtreeCount}
		{@const totalCount = subtreeCount + 1}
		<div
			class="modal-backdrop"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={() => s.cancelDelete()}
			onkeydown={(e) => e.key === 'Escape' && s.cancelDelete()}
		>
			<div
				class="modal"
				role="presentation"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<div class="modal-header">
					<span class="modal-title">Delete <strong>{s.pendingDelete.san}</strong>?</span>
					<button class="modal-close" onclick={() => s.cancelDelete()} aria-label="Close">✕</button>
				</div>
				<p class="delete-explanation">
					{#if subtreeCount === 0}
						This will permanently remove <strong>{s.pendingDelete.san}</strong> from your repertoire.
						Any associated drill card will also be deleted.
					{:else}
						This will permanently remove <strong>{s.pendingDelete.san}</strong> and
						<strong>{subtreeCount}</strong> follow-up {subtreeCount === 1 ? 'move' : 'moves'}
						({totalCount} total). All associated drill cards will also be deleted.
					{/if}
				</p>
				<div class="modal-actions">
					<button class="modal-btn modal-btn--cancel" onclick={() => s.cancelDelete()}>
						Cancel
					</button>
					<button class="modal-btn modal-btn--danger" onclick={() => s.executePendingDelete()}>
						Delete
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ── PGN import modal ─────────────────────────────────────────────── -->
	<ImportPgnModal
		bind:open={importOpen}
		repertoireId={data.repertoire.id}
		repertoireColor={data.repertoire.color as 'WHITE' | 'BLACK'}
		onComplete={() => invalidateAll()}
	/>
</div>

<style>
	/* ── Page layout (mobile-first) ──────────────────────────────────────────── */

	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
	}

	.board-col {
		width: 100%;
	}

	.board-inner {
		display: flex;
		align-items: stretch;
		gap: var(--space-1, 4px);
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

	/* ── Repertoire header ───────────────────────────────────────────────────── */

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
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.color-badge {
		font-size: 10px;
		padding: 2px var(--space-2);
		border-radius: 3px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		flex-shrink: 0;
	}

	.badge-white {
		background: var(--color-surface-alt);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.badge-black {
		background: var(--color-base);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.import-btn {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 11px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
		flex-shrink: 0;
	}

	.import-btn:hover:not(:disabled) {
		border-color: var(--color-accent-dim);
		color: var(--color-accent);
		box-shadow: var(--glow-accent);
	}

	.import-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* ── Export dropdown ────────────────────────────────────────────────────── */

	.export-wrap {
		position: relative;
		flex-shrink: 0;
	}

	.export-dropdown {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		z-index: 20;
		min-width: 150px;
		box-shadow: var(--shadow-elevated);
	}

	.export-option {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		text-align: left;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.export-option:last-child {
		border-bottom: none;
	}

	.export-option:hover {
		background: var(--color-surface-alt);
		color: var(--color-accent);
	}

	.export-cancel {
		color: var(--color-text-muted);
	}

	.export-msg {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		font-size: 11px;
		color: var(--color-success);
		white-space: nowrap;
	}

	/* ── Mode toggle ────────────────────────────────────────────────────────── */

	.mode-toggle {
		display: flex;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.mode-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.mode-btn:hover:not(.mode-btn--active) {
		color: var(--color-text-secondary);
		background: var(--color-surface-alt);
	}

	.mode-btn--active {
		background: var(--color-surface-alt);
		color: var(--color-accent);
		font-weight: 600;
		cursor: default;
		box-shadow: inset 0 -2px 0 var(--color-accent);
	}

	.mode-btn + .mode-btn {
		border-left: 1px solid var(--color-border);
	}

	/* ── Turn indicator ──────────────────────────────────────────────────────── */

	.turn-indicator {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
	}

	.turn-indicator.user-turn {
		background: var(--color-accent-glow);
		border-color: rgba(91, 127, 164, 0.3);
		color: var(--color-accent);
	}

	.turn-indicator.opp-turn {
		background: rgba(139, 139, 160, 0.08);
		border-color: rgba(139, 139, 160, 0.2);
		color: var(--color-text-secondary);
	}

	.turn-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
		background: currentColor;
	}

	.turn-hint {
		font-weight: 400;
		text-transform: none;
		letter-spacing: normal;
		opacity: 0.7;
	}

	/* ── Banners (conflict / error / info) ──────────────────────────────────── */

	.banner {
		position: relative;
		padding: var(--space-3) var(--space-8) var(--space-3) var(--space-3);
		border-radius: var(--radius-md);
		font-size: 12px;
		line-height: 1.5;
	}

	.banner--warn {
		background: rgba(91, 127, 164, 0.08);
		border: 1px solid rgba(91, 127, 164, 0.25);
		color: var(--color-accent);
	}

	.banner--error {
		background: rgba(248, 113, 113, 0.08);
		border: 1px solid rgba(248, 113, 113, 0.25);
		color: var(--color-danger);
	}

	.banner--info {
		background: rgba(139, 139, 160, 0.08);
		border: 1px solid rgba(139, 139, 160, 0.2);
		color: var(--color-text-secondary);
	}

	.banner--explore {
		background: var(--color-explore-glow);
		border: 1px solid rgba(103, 232, 249, 0.3);
		color: var(--color-explore);
		font-weight: 500;
	}

	.banner-dismiss {
		position: absolute;
		top: 50%;
		right: var(--space-2);
		transform: translateY(-50%);
		background: none;
		border: none;
		color: currentColor;
		opacity: 0.5;
		cursor: pointer;
		font-size: 12px;
		padding: 2px 4px;
		line-height: 1;
	}

	.banner-dismiss:hover {
		opacity: 1;
	}

	/* ── Sections ────────────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		box-shadow: var(--shadow-surface);
	}

	.section-label {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	/* ── Moves from current position ─────────────────────────────────────────── */

	.position-moves {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.position-move-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.move-nav-btn {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.move-nav-btn:hover,
	.move-nav-btn--highlighted {
		border-color: var(--color-accent-dim);
		color: var(--color-accent);
		box-shadow: var(--glow-accent);
	}

	.move-delete-btn {
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 11px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
		padding: 0;
	}

	.move-delete-btn:hover:not(:disabled) {
		border-color: rgba(248, 113, 113, 0.5);
		color: var(--color-danger);
	}

	.move-delete-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	/* ── Navigation controls ─────────────────────────────────────────────────── */

	.nav-controls {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.nav-btn {
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.nav-btn:hover:not(:disabled) {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
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

	/* ── Save explore line button ───────────────────────────────────────────── */

	.save-line-btn {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-explore-glow);
		border: 1px solid rgba(103, 232, 249, 0.3);
		border-radius: var(--radius-sm);
		color: var(--color-explore);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.save-line-btn:hover:not(:disabled) {
		border-color: var(--color-explore);
		background: rgba(103, 232, 249, 0.2);
	}

	.save-line-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	/* ── Saving indicator ────────────────────────────────────────────────────── */

	.saving-indicator {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
		text-align: center;
	}

	/* ── Annotation UI ───────────────────────────────────────────────────────── */

	.position-move-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.move-notes {
		font-size: 11px;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0 0 0 var(--space-1);
		line-height: 1.4;
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
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-size: 12px;
		cursor: pointer;
		padding: 0;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.move-annotate-btn:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text-secondary);
	}

	/* ── Start position controls ─────────────────────────────────────────── */

	.start-indicator {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: rgba(74, 222, 128, 0.08);
		border: 1px solid rgba(74, 222, 128, 0.2);
		border-radius: var(--radius-md);
	}

	.start-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-success);
		letter-spacing: 0.04em;
	}

	.start-clear-btn {
		padding: 2px var(--space-2);
		background: transparent;
		border: 1px solid rgba(74, 222, 128, 0.2);
		border-radius: 3px;
		color: rgba(74, 222, 128, 0.5);
		font-family: var(--font-body);
		font-size: 11px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.start-clear-btn:hover:not(:disabled) {
		border-color: rgba(248, 113, 113, 0.5);
		color: var(--color-danger);
	}

	.start-clear-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.start-btn {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.start-btn:hover:not(:disabled) {
		border-color: rgba(74, 222, 128, 0.4);
		color: var(--color-success);
		background: rgba(74, 222, 128, 0.05);
	}

	.start-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.drill-here-btn {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		text-align: center;
		text-decoration: none;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.drill-here-btn:hover {
		border-color: var(--color-accent, rgba(59, 130, 246, 0.4));
		color: var(--color-accent, #3b82f6);
		background: rgba(59, 130, 246, 0.05);
	}

	.start-clear-btn-standalone {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.start-clear-btn-standalone:hover:not(:disabled) {
		border-color: rgba(248, 113, 113, 0.5);
		color: var(--color-danger);
	}

	.start-clear-btn-standalone:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* ── Delete confirmation modal ──────────────────────────────────────────── */

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-elevated);
		padding: var(--space-6);
		width: 360px;
		max-width: calc(100vw - 2rem);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-title {
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.modal-close {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 12px;
		cursor: pointer;
		padding: 2px 4px;
		line-height: 1;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.modal-close:hover {
		color: var(--color-text-primary);
	}

	.delete-explanation {
		font-size: 13px;
		color: var(--color-text-secondary);
		line-height: 1.6;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.modal-btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap),
			box-shadow var(--dur-fast) var(--ease-snap);
	}

	.modal-btn--cancel {
		background: none;
		border: 1px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.modal-btn--cancel:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.modal-btn--danger {
		background: var(--color-danger);
		border: 1px solid var(--color-danger);
		color: #fff;
		font-weight: 600;
	}

	.modal-btn--danger:hover {
		box-shadow: 0 0 12px rgba(248, 113, 113, 0.4);
	}

	.modal-btn--danger:active {
		transform: scale(0.97);
	}

	@media (max-width: 767px) {
		.modal-btn {
			min-height: 44px;
		}

		.modal-close {
			min-width: 44px;
			min-height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
		}
	}

	@media (max-width: 559px) {
		.modal {
			position: fixed;
			inset: 0;
			width: 100%;
			max-width: 100%;
			border-radius: 0;
			padding-top: var(--space-8);
		}

		.modal::before {
			content: '';
			position: absolute;
			top: var(--space-2);
			left: 50%;
			transform: translateX(-50%);
			width: 36px;
			height: 4px;
			border-radius: 2px;
			background: var(--color-border);
		}
	}
</style>
