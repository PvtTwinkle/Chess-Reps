<!--
	CandidateMoves — sidebar panel for Build Mode and Review Mode.

	Shows suggested moves at the current board position, drawn from three
	independent sources — each with its own loading state so results appear
	as soon as they're available:

	  • Book — shared opening book moves (instant, local DB)
	  • Masters — Chessmont master game statistics & W/D/L stats (instant, local DB)
	  • Engine — Stockfish top-N analysis (~2-10s)

	Three tabs switch between the sources. Book tab is shown first; if there
	are no book moves the Masters tab is activated automatically, then Engine.

	When the user clicks a candidate, onSelectMove is called with the SAN of
	that move. When the user hovers over a candidate, onHoverMove is called
	with the SAN (or null on mouse leave) so the parent can draw arrows.

	The evaluation score (Engine tab) is always shown from white's perspective:
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

	interface MastersMove {
		san: string;
		white: number;
		draws: number;
		black: number;
		totalGames: number;
	}

	interface Props {
		currentFen: string;
		onSelectMove: (san: string) => void;
		onHoverMove?: (san: string | null) => void;
		disabled?: boolean;
		playerColor?: 'WHITE' | 'BLACK';
		/** Index of the keyboard-highlighted candidate (parent-controlled). */
		highlightedIndex?: number | null;
		/** Fires whenever the active tab's candidate SAN list changes. */
		onCandidatesChanged?: (sans: string[]) => void;
		/** Parent requests a tab switch (set to null after applying). */
		requestedTab?: 'book' | 'engine' | 'masters' | null;
		/** Fires whenever the active tab changes. */
		onTabChanged?: (tab: 'book' | 'engine' | 'masters') => void;
		/** Fires whenever the top-line engine eval changes. */
		onEvalChanged?: (evalCp: number | null, evalMate: number | null, loading: boolean) => void;
	}

	let {
		currentFen,
		onSelectMove,
		onHoverMove,
		disabled = false,
		playerColor = 'WHITE',
		highlightedIndex = null,
		onCandidatesChanged,
		requestedTab = null,
		onTabChanged,
		onEvalChanged
	}: Props = $props();

	// ── Book state ────────────────────────────────────────────────────────────
	let bookCandidates = $state<Candidate[]>([]);
	let bookLoading = $state(false);
	let bookError = $state(false);

	// ── Engine state ──────────────────────────────────────────────────────────
	let engineCandidates = $state<Candidate[]>([]);
	let engineLoading = $state(false);
	let engineError = $state(false);
	let engineAvailable = $state(true);

	// ── Masters state ─────────────────────────────────────────────────────────
	let mastersMoves = $state<MastersMove[]>([]);
	let mastersLoading = $state(false);
	let mastersError = $state(false);

	// ── Tab state ─────────────────────────────────────────────────────────────
	let activeTab = $state<'book' | 'engine' | 'masters'>('book');
	// Prevents auto-switch from overriding a deliberate user tab click.
	let userClickedTab = $state(false);

	function selectTab(tab: 'book' | 'engine' | 'masters') {
		activeTab = tab;
		userClickedTab = true;
	}

	// ── Notify parent when the visible candidate list changes ────────────────
	$effect(() => {
		const sans =
			activeTab === 'book'
				? bookCandidates.map((c) => c.san)
				: activeTab === 'masters'
					? mastersMoves.map((m) => m.san)
					: engineCandidates.map((c) => c.san);
		onCandidatesChanged?.(sans);
	});

	// ── Notify parent when activeTab changes ──────────────────────────────────
	$effect(() => {
		onTabChanged?.(activeTab);
	});

	// ── Apply parent-requested tab switch ─────────────────────────────────────
	$effect(() => {
		if (requestedTab && requestedTab !== activeTab) {
			activeTab = requestedTab;
			userClickedTab = true;
		}
	});

	// ── Notify parent of top-line engine eval ─────────────────────────────────
	$effect(() => {
		const top = engineCandidates[0];
		onEvalChanged?.(top?.evalCp ?? null, top?.evalMate ?? null, engineLoading);
	});

	// ── Keyboard highlight triggers hover arrow ───────────────────────────────
	$effect(() => {
		if (highlightedIndex === null || highlightedIndex === undefined) {
			return;
		}
		const sans =
			activeTab === 'book'
				? bookCandidates.map((c) => c.san)
				: activeTab === 'masters'
					? mastersMoves.map((m) => m.san)
					: engineCandidates.map((c) => c.san);
		const san = sans[highlightedIndex] ?? null;
		onHoverMove?.(san);
	});

	// ── Book fetch — near-instant (local DB query) ────────────────────────────
	$effect(() => {
		const fen = currentFen;
		const controller = new AbortController();

		bookLoading = true;
		bookError = false;
		bookCandidates = [];
		// Reset tab and user-click flag on every position change.
		activeTab = 'book';
		userClickedTab = false;

		fetch('/api/stockfish', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fen, mode: 'book' }),
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Book fetch failed');
				return res.json();
			})
			.then((data) => {
				bookCandidates = (data.candidates as Candidate[]).filter((c) => c.isBook);
				// Auto-switch to masters if no book moves and user hasn't clicked a tab.
				// Masters is now instant (local DB), so cascade: book → masters → engine.
				if (bookCandidates.length === 0 && !userClickedTab) {
					activeTab = 'masters';
				}
			})
			.catch((err) => {
				if (err.name !== 'AbortError') bookError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) bookLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Engine fetch — slow (~2-10s, Stockfish analysis) ──────────────────────
	$effect(() => {
		const fen = currentFen;
		const controller = new AbortController();

		engineLoading = true;
		engineError = false;
		engineCandidates = [];

		fetch('/api/stockfish', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fen, mode: 'engine' }),
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Engine fetch failed');
				return res.json();
			})
			.then((data) => {
				engineCandidates = (data.candidates as Candidate[]).filter((c) => !c.isBook);
				engineAvailable = data.engineAvailable;
			})
			.catch((err) => {
				if (err.name !== 'AbortError') engineError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) engineLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Masters fetch — local Chessmont DB, instant response ─────────────────
	// Fetches move statistics from the local chessmont_moves table when the
	// Masters tab is active. No debounce or rate limiting needed — the query
	// hits the local PostgreSQL database directly.
	$effect(() => {
		const fen = currentFen;
		const tab = activeTab;

		// Not viewing Masters tab — reset state and do nothing.
		if (tab !== 'masters') {
			mastersMoves = [];
			mastersLoading = false;
			mastersError = false;
			return;
		}

		const controller = new AbortController();

		mastersLoading = true;
		mastersError = false;
		mastersMoves = [];

		fetch(`/api/masters?fen=${encodeURIComponent(fen)}`, {
			signal: controller.signal
		})
			.then((res) => {
				if (!res.ok) throw new Error('Masters fetch failed');
				return res.json();
			})
			.then((data) => {
				mastersMoves = data.moves ?? [];
				// Auto-cascade to engine if masters also empty and user hasn't clicked.
				if (mastersMoves.length === 0 && !userClickedTab) {
					activeTab = 'engine';
				}
			})
			.catch((err) => {
				if (err.name !== 'AbortError') mastersError = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) mastersLoading = false;
			});

		return () => {
			controller.abort();
		};
	});

	// ── Eval formatting (Engine tab only) ─────────────────────────────────────
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

	// ── Scroll-into-view for keyboard navigation ─────────────────────────
	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (highlightedIndex == null || !listEl) return;
		const row = listEl.children[highlightedIndex] as HTMLElement | undefined;
		row?.scrollIntoView({ block: 'nearest' });
	});

	// The subtitle shown below a book move — opening name takes priority.
	function bookSubtitle(c: Candidate): string | null {
		return c.openingName ?? c.annotation ?? null;
	}

	// Format game count with locale separators (e.g. 1,234).
	function formatCount(n: number): string {
		return n.toLocaleString();
	}
</script>

<div class="section">
	<!-- Tab bar -->
	<div class="tab-bar">
		<button
			class="tab"
			class:active={activeTab === 'book'}
			onclick={() => selectTab('book')}
			type="button"
		>
			Book{#if !bookLoading && bookCandidates.length > 0}&nbsp;({bookCandidates.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'masters'}
			onclick={() => selectTab('masters')}
			type="button"
		>
			Masters{#if !mastersLoading && mastersMoves.length > 0}&nbsp;({mastersMoves.length}){/if}
		</button>
		<button
			class="tab"
			class:active={activeTab === 'engine'}
			onclick={() => selectTab('engine')}
			disabled={!engineAvailable && !engineLoading}
			type="button"
			title={!engineAvailable && !engineLoading ? 'Stockfish engine is not available' : undefined}
		>
			Engine{#if !engineLoading && engineCandidates.length > 0}&nbsp;({engineCandidates.length}){/if}
		</button>
	</div>

	<!-- ── Book tab content ─────────────────────────────────────────────────── -->
	{#if activeTab === 'book'}
		{#if bookLoading}
			<div class="loading">Loading book…</div>
		{:else if bookError}
			<p class="empty-hint">Could not load book moves.</p>
		{:else if bookCandidates.length === 0}
			<p class="empty-hint">No book moves at this position.</p>
		{:else}
			<div class="candidate-list" bind:this={listEl}>
				{#each bookCandidates as c, idx (c.uci)}
					<button
						class="candidate-row"
						class:candidate-highlighted={highlightedIndex === idx}
						onclick={() => onSelectMove(c.san)}
						onmouseenter={() => onHoverMove?.(c.san)}
						onmouseleave={() => onHoverMove?.(null)}
						{disabled}
					>
						<div class="candidate-main">
							<span class="candidate-san">{c.san}</span>
							{#if bookSubtitle(c)}
								<span class="opening-name" title={bookSubtitle(c)}>{bookSubtitle(c)}</span>
							{:else}
								<span class="spacer"></span>
							{/if}
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

		<!-- ── Masters tab content ───────────────────────────────────────────── -->
	{:else if activeTab === 'masters'}
		{#if mastersLoading}
			<div class="loading">Loading masters…</div>
		{:else if mastersError}
			<p class="empty-hint">Masters database unavailable.</p>
		{:else if mastersMoves.length === 0}
			<p class="empty-hint">No master games from this position.</p>
		{:else}
			<div class="candidate-list" bind:this={listEl}>
				{#each mastersMoves as m, idx (m.san)}
					{@const winPct = m.totalGames > 0 ? (m.white / m.totalGames) * 100 : 0}
					{@const drawPct = m.totalGames > 0 ? (m.draws / m.totalGames) * 100 : 0}
					{@const lossPct = m.totalGames > 0 ? (m.black / m.totalGames) * 100 : 0}
					<button
						class="candidate-row"
						class:candidate-highlighted={highlightedIndex === idx}
						onclick={() => onSelectMove(m.san)}
						onmouseenter={() => onHoverMove?.(m.san)}
						onmouseleave={() => onHoverMove?.(null)}
						{disabled}
					>
						<div class="candidate-main">
							<span class="candidate-san">{m.san}</span>
							<span
								class="wdl-bar-inline"
								title="{winPct.toFixed(1)}% W / {drawPct.toFixed(1)}% D / {lossPct.toFixed(1)}% L"
							>
								<span class="wdl-white" style="width: {winPct}%"></span>
								<span class="wdl-draw" style="width: {drawPct}%"></span>
								<span class="wdl-black" style="width: {lossPct}%"></span>
							</span>
							<span class="masters-games">{formatCount(m.totalGames)}</span>
						</div>
						<div class="wdl-labels">
							<span class="wdl-label-white">{winPct.toFixed(0)}%</span>
							<span class="wdl-label-draw">{drawPct.toFixed(0)}%</span>
							<span class="wdl-label-black">{lossPct.toFixed(0)}%</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}

		<!-- ── Engine tab content ────────────────────────────────────────────── -->
	{:else if engineLoading}
		<div class="loading">Analysing…</div>
	{:else if engineError}
		<p class="empty-hint">Could not load engine suggestions.</p>
	{:else if engineCandidates.length === 0}
		<p class="empty-hint">
			{engineAvailable ? 'No engine suggestions available.' : 'Stockfish engine is not available.'}
		</p>
	{:else}
		<div class="candidate-list" bind:this={listEl}>
			{#each engineCandidates as c, idx (c.uci)}
				<button
					class="candidate-row"
					class:candidate-highlighted={highlightedIndex === idx}
					onclick={() => onSelectMove(c.san)}
					onmouseenter={() => onHoverMove?.(c.san)}
					onmouseleave={() => onHoverMove?.(null)}
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
</div>

<style>
	/* ── Section wrapper ─────────────────────────────────────────────────────── */

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* ── Tab bar ─────────────────────────────────────────────────────────────── */

	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		flex: 1;
		padding: var(--space-2);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-text-muted);
		font-family: var(--font-body);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			color var(--dur-fast) var(--ease-snap),
			border-color var(--dur-fast) var(--ease-snap);
		margin-bottom: -1px;
	}

	.tab:hover:not(:disabled) {
		color: var(--color-text-secondary);
	}

	.tab.active {
		color: var(--color-gold);
		border-bottom-color: var(--color-gold);
	}

	.tab:disabled {
		color: rgba(82, 82, 106, 0.4);
		cursor: default;
	}

	/* ── Loading / empty states ──────────────────────────────────────────────── */

	.loading {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
	}

	.empty-hint {
		font-size: 12px;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	/* ── Candidate list ──────────────────────────────────────────────────────── */

	.candidate-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 180px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border) transparent;
	}

	.candidate-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.candidate-row:hover:not(:disabled),
	.candidate-row.candidate-highlighted:not(:disabled) {
		border-color: var(--color-gold-dim);
		background: rgba(30, 30, 53, 0.8);
	}

	.candidate-row:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.candidate-main {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
	}

	.candidate-san {
		font-weight: 600;
		color: var(--color-text-primary);
		min-width: 2.5rem;
	}

	.spacer {
		flex: 1;
	}

	.eval {
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.eval-white {
		color: var(--color-success);
	}

	.eval-black {
		color: var(--color-danger);
	}

	.eval-equal {
		color: var(--color-text-muted);
	}

	.opening-name {
		flex: 1;
		min-width: 0;
		font-size: 11px;
		color: var(--color-text-muted);
		font-style: italic;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Masters tab — stats and W/D/L bar ──────────────────────────────────── */

	.masters-games {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.wdl-bar-inline {
		flex: 1;
		display: flex;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		min-width: 0;
	}

	.wdl-white {
		background: var(--color-success);
	}

	.wdl-draw {
		background: var(--color-text-muted);
	}

	.wdl-black {
		background: var(--color-danger);
	}

	.wdl-labels {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.wdl-label-white {
		color: var(--color-success);
	}

	.wdl-label-draw {
		color: var(--color-text-muted);
	}

	.wdl-label-black {
		color: var(--color-danger);
	}

	/* ── Mobile compact mode ── --bp-md */
	@media (max-width: 767px) {
		.tab {
			min-height: 44px;
			padding: var(--space-3);
			font-size: 13px;
		}

		.candidate-row {
			min-height: 44px;
			padding: var(--space-3);
		}

		.candidate-list {
			display: grid;
			grid-template-columns: 1fr 1fr;
			max-height: 180px;
		}

		.opening-name {
			display: none;
		}
	}
</style>
