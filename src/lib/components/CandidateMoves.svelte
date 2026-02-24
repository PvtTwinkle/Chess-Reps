<!--
	CandidateMoves — sidebar panel for Build Mode.

	Shows suggested moves at the current board position, drawn from two sources:
	  • The shared opening book (shown with a BOOK badge and curator annotation)
	  • Stockfish engine analysis (shown with an evaluation score only)

	Two checkboxes let the user independently toggle each source on or off.

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
	}

	interface Props {
		currentFen: string;
		onSelectMove: (san: string) => void;
		disabled?: boolean;
	}

	let { currentFen, onSelectMove, disabled = false }: Props = $props();

	let candidates = $state<Candidate[]>([]);
	let loading = $state(false);
	let engineAvailable = $state(true);
	let fetchError = $state(false);

	// Filter toggles — independently show/hide book and engine candidates.
	let showBook = $state(true);
	let showEngine = $state(true);

	// The visible subset of candidates based on the current toggle state.
	const visibleCandidates = $derived(candidates.filter((c) => (c.isBook ? showBook : showEngine)));

	// Fetch candidates whenever the current position changes.
	// The AbortController ensures that if the position changes before the
	// previous request finishes, the stale response is discarded.
	$effect(() => {
		const fen = currentFen;
		const controller = new AbortController();

		loading = true;
		fetchError = false;
		candidates = [];

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

	// Format an evaluation score for display.
	// cp and mate are from white's perspective.
	function formatEval(cp: number | null, mate: number | null): string {
		if (mate !== null) {
			return mate > 0 ? `#${mate}` : `-#${Math.abs(mate)}`;
		}
		if (cp === null) return '';
		const pawns = cp / 100;
		return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
	}

	// Returns a CSS class name based on the evaluation value.
	// Used to colour the score — green for a clear advantage, red for a clear
	// disadvantage, neutral for roughly equal positions.
	// "Advantage" thresholds are from white's perspective.
	function evalColorClass(cp: number | null, mate: number | null): string {
		if (mate !== null) return mate > 0 ? 'eval-white' : 'eval-black';
		if (cp === null) return '';
		if (cp > 60) return 'eval-white';
		if (cp < -60) return 'eval-black';
		return 'eval-equal';
	}
</script>

<div class="section">
	<!-- Label row with filter toggles -->
	<div class="section-header">
		<span class="section-label">SUGGESTED MOVES</span>
		<div class="filters">
			<label class="filter-toggle" title="Show opening book moves">
				<input type="checkbox" bind:checked={showBook} />
				<span class="filter-label">Book</span>
			</label>
			<label class="filter-toggle" title="Show Stockfish engine suggestions">
				<input type="checkbox" bind:checked={showEngine} disabled={!engineAvailable} />
				<span class="filter-label" class:unavailable={!engineAvailable}>Engine</span>
			</label>
		</div>
	</div>

	{#if loading}
		<div class="loading">Analysing…</div>
	{:else if fetchError}
		<p class="empty-hint">Could not load suggestions.</p>
	{:else if visibleCandidates.length === 0}
		<p class="empty-hint">
			{#if !showBook && !showEngine}
				Both sources are hidden — enable Book or Engine above.
			{:else if candidates.length === 0}
				No suggestions available.
			{:else}
				No {showBook ? 'book' : 'engine'} moves at this position.
			{/if}
		</p>
	{:else}
		<div class="candidate-list">
			{#each visibleCandidates as c (c.uci)}
				<button
					class="candidate-row"
					onclick={() => onSelectMove(c.san)}
					{disabled}
					title={c.annotation ?? undefined}
				>
					<!-- Move name -->
					<span class="candidate-san">{c.san}</span>

					<!-- Book badge -->
					{#if c.isBook}
						<span class="book-badge" title={c.annotation ?? 'Opening book move'}>BOOK</span>
					{/if}

					<!-- Spacer pushes the eval to the right -->
					<span class="spacer"></span>

					<!-- Evaluation score -->
					{#if c.evalMate !== null || c.evalCp !== null}
						<span class="eval {evalColorClass(c.evalCp, c.evalMate)}">
							{formatEval(c.evalCp, c.evalMate)}
						</span>
					{/if}
				</button>

				<!-- Curator annotation (shown below the row if present) -->
				{#if c.annotation}
					<p class="annotation">{c.annotation}</p>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	/* ── Section wrapper ─────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Label + toggles on the same line */
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #505060;
	}

	/* ── Filter toggles ──────────────────────────────────────────────────────── */

	.filters {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}

	.filter-toggle {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		cursor: pointer;
	}

	.filter-toggle input[type='checkbox'] {
		width: 11px;
		height: 11px;
		accent-color: #4a6a9a;
		cursor: pointer;
		flex-shrink: 0;
	}

	.filter-label {
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #5a6a8a;
		user-select: none;
	}

	/* Dim the Engine label when the sidecar is not running */
	.filter-label.unavailable {
		color: #35404a;
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

	/* Each candidate is a full-width button laid out as a row */
	.candidate-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
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

	/* Move name — slightly bold so it reads well */
	.candidate-san {
		font-weight: 600;
		min-width: 2.5rem;
	}

	/* BOOK badge */
	.book-badge {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #7090c0;
		border: 1px solid #2a4060;
		border-radius: 3px;
		padding: 0.1rem 0.3rem;
		flex-shrink: 0;
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

	/* Curator annotation — shown below the row in small italic text */
	.annotation {
		font-size: 0.75rem;
		color: #404858;
		font-style: italic;
		margin: -0.05rem 0 0.1rem 0.55rem;
	}
</style>
