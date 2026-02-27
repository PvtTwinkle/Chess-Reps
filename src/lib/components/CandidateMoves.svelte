<!--
	CandidateMoves — sidebar panel for Build Mode.

	Shows suggested moves at the current board position, drawn from two sources:
	  • The shared opening book (shown with the ECO opening name if known)
	  • Stockfish engine analysis (shown with an evaluation score only)

	Two tabs switch between Book moves and Engine suggestions. Book tab is shown
	first; if there are no book moves the Engine tab is activated automatically.

	When the user clicks a candidate, onSelectMove is called with the SAN of
	that move. The parent (build page) handles playing it on the board through
	the same handleMove path as a drag-and-drop move — so conflict detection,
	auto-save, and undo history all work identically.

	The evaluation score is always shown from white's perspective:
	  +0.45 = white is 0.45 pawns better
	  -1.20 = black is 1.20 pawns better
	  #3    = white mates in 3
	  -#3   = black mates in 3
-->

<script lang="ts">
	interface Candidate {
		san: string;
		uci: string;
		evalCp: number | null;
		evalMate: number | null;
		isBook: boolean;
		annotation: string | null;
		openingName: string | null;
	}

	interface Props {
		currentFen: string;
		onSelectMove: (san: string) => void;
		disabled?: boolean;
		playerColor?: 'WHITE' | 'BLACK';
	}

	let { currentFen, onSelectMove, disabled = false, playerColor = 'WHITE' }: Props = $props();

	let candidates = $state<Candidate[]>([]);
	let loading = $state(false);
	let engineAvailable = $state(true);
	let fetchError = $state(false);

	// Active tab — switches between book and engine move lists.
	let activeTab = $state<'book' | 'engine'>('book');

	// Split the flat candidate list into the two source buckets.
	const bookCandidates = $derived(candidates.filter((c) => c.isBook));
	const engineCandidates = $derived(candidates.filter((c) => !c.isBook));

	// Fetch candidates whenever the current position changes.
	// The AbortController ensures that if the position changes before the
	// previous request finishes, the stale response is discarded.
	$effect(() => {
		const fen = currentFen;
		const controller = new AbortController();

		loading = true;
		fetchError = false;
		candidates = [];
		// Reset to book tab on each new position; we'll switch to engine below
		// if there turn out to be no book moves.
		activeTab = 'book';

		fetch('/api/stockfish', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fen }),
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Analysis failed');
				return res.json();
			})
			.then((data) => {
				candidates = data.candidates;
				engineAvailable = data.engineAvailable;
				// Auto-switch to the engine tab when this position has no book moves
				// so the user immediately sees useful content.
				const hasBook = (data.candidates as Candidate[]).some((c) => c.isBook);
				if (!hasBook) activeTab = 'engine';
			})
			.catch((err) => {
				// AbortError is expected when the position changes — not a real error.
				if (err.name !== 'AbortError') {
					fetchError = true;
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					loading = false;
				}
			});

		// Cleanup: abort the in-flight request if the position changes before
		// it completes, preventing stale results from clobbering new ones.
		return () => {
			controller.abort();
		};
	});

	// Format an evaluation score for display from the player's perspective.
	// cp and mate arrive from the server as White's perspective; we flip the
	// sign for Black players so that positive always means "good for me".
	function formatEval(cp: number | null, mate: number | null): string {
		if (mate !== null) {
			const playerMate = playerColor === 'BLACK' ? -mate : mate;
			return playerMate > 0 ? `#${playerMate}` : `-#${Math.abs(playerMate)}`;
		}
		if (cp === null) return '';
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		const pawns = playerCp / 100;
		return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
	}

	// Returns a CSS class name based on the evaluation value from the player's perspective.
	// Green = good for the player, red = bad for the player.
	function evalColorClass(cp: number | null, mate: number | null): string {
		if (mate !== null) {
			const playerMate = playerColor === 'BLACK' ? -mate : mate;
			return playerMate > 0 ? 'eval-white' : 'eval-black';
		}
		if (cp === null) return '';
		const playerCp = playerColor === 'BLACK' ? -cp : cp;
		if (playerCp > 60) return 'eval-white';
		if (playerCp < -60) return 'eval-black';
		return 'eval-equal';
	}

	// The subtitle shown below a book move — opening name takes priority over
	// the curator annotation; show whichever is available.
	function bookSubtitle(c: Candidate): string | null {
		return c.openingName ?? c.annotation ?? null;
	}
</script>

<div class="section">
	<!-- Tab bar -->
	<div class="tab-bar">
		<button
			class="tab"
			class:active={activeTab === 'book'}
			onclick={() => (activeTab = 'book')}
			type="button"
		>
			Book{#if !loading && bookCandidates.length > 0}&nbsp;({bookCandidates.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'engine'}
			onclick={() => (activeTab = 'engine')}
			disabled={!engineAvailable}
			type="button"
			title={engineAvailable ? undefined : 'Stockfish engine is not available'}
		>
			Engine{#if !loading && engineCandidates.length > 0}&nbsp;({engineCandidates.length}){/if}
		</button>
	</div>

	<!-- Content area -->
	{#if loading}
		<div class="loading">Analysing…</div>
	{:else if fetchError}
		<p class="empty-hint">Could not load suggestions.</p>
	{:else if activeTab === 'book'}
		{#if bookCandidates.length === 0}
			<p class="empty-hint">No book moves at this position.</p>
		{:else}
			<div class="candidate-list">
				{#each bookCandidates as c (c.uci)}
					<button
						class="candidate-row"
						onclick={() => onSelectMove(c.san)}
						{disabled}
					>
						<div class="candidate-main">
							<!-- Move name -->
							<span class="candidate-san">{c.san}</span>

							<!-- Spacer pushes the eval to the right -->
							<span class="spacer"></span>

							<!-- Evaluation score -->
							{#if c.evalMate !== null || c.evalCp !== null}
								<span class="eval {evalColorClass(c.evalCp, c.evalMate)}">
									{formatEval(c.evalCp, c.evalMate)}
								</span>
							{/if}
						</div>

						<!-- Opening name or annotation — shown below the move name -->
						{#if bookSubtitle(c)}
							<div class="opening-name">{bookSubtitle(c)}</div>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	{:else}
		{#if engineCandidates.length === 0}
			<p class="empty-hint">
				{engineAvailable ? 'No engine suggestions available.' : 'Stockfish engine is not available.'}
			</p>
		{:else}
			<div class="candidate-list">
				{#each engineCandidates as c (c.uci)}
					<button
						class="candidate-row"
						onclick={() => onSelectMove(c.san)}
						{disabled}
					>
						<div class="candidate-main">
							<span class="candidate-san">{c.san}</span>
							<span class="spacer"></span>
							{#if c.evalMate !== null || c.evalCp !== null}
								<span class="eval {evalColorClass(c.evalCp, c.evalMate)}">
									{formatEval(c.evalCp, c.evalMate)}
								</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	/* ── Section wrapper ─────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ── Tab bar ─────────────────────────────────────────────────────────────── */

	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid #1a2a3a;
	}

	.tab {
		flex: 1;
		padding: 0.3rem 0.5rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #505060;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			color 0.12s,
			border-color 0.12s;
		margin-bottom: -1px; /* overlap the tab-bar border-bottom */
	}

	.tab:hover:not(:disabled) {
		color: #8090a0;
	}

	.tab.active {
		color: #7090c0;
		border-bottom-color: #7090c0;
	}

	.tab:disabled {
		color: #2a3040;
		cursor: default;
	}

	/* ── Loading / empty states ──────────────────────────────────────────────── */

	.loading {
		font-size: 0.82rem;
		color: #404050;
		font-style: italic;
	}

	.empty-hint {
		font-size: 0.82rem;
		color: #404050;
		font-style: italic;
		margin: 0;
	}

	/* ── Candidate list ──────────────────────────────────────────────────────── */

	.candidate-list {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	/* Each candidate is a full-width button laid out as a column */
	.candidate-row {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 100%;
		padding: 0.3rem 0.55rem;
		background: #0a1828;
		border: 1px solid #152535;
		border-radius: 4px;
		color: #c0c0d0;
		font-size: 0.875rem;
		font-family: inherit;
		cursor: pointer;
		text-align: left;
		transition:
			border-color 0.12s,
			background 0.12s;
	}

	.candidate-row:hover:not(:disabled) {
		border-color: #2a4a6a;
		background: #0f1f35;
	}

	.candidate-row:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* The top line of a candidate: SAN on the left, eval on the right */
	.candidate-main {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
	}

	/* Move name — slightly bold so it reads well */
	.candidate-san {
		font-weight: 600;
		min-width: 2.5rem;
	}

	/* Pushes the eval score to the right edge of the row */
	.spacer {
		flex: 1;
	}

	/* Evaluation score */
	.eval {
		font-size: 0.8rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.eval-white {
		color: #a0c080; /* greenish — white has an advantage */
	}

	.eval-black {
		color: #c07070; /* reddish — black has an advantage */
	}

	.eval-equal {
		color: #707080; /* grey — roughly equal */
	}

	/* Opening name or curator annotation — shown below the move in small italic text */
	.opening-name {
		font-size: 0.72rem;
		color: #4a6080;
		font-style: italic;
		line-height: 1.2;
		/* Allow long opening names (e.g. "Sicilian Defense, Najdorf Variation,
		   English Attack") to wrap rather than overflow the button */
		white-space: normal;
	}
</style>
