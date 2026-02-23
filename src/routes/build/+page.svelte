<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';

	// Track the current position as a FEN string.
	// Starts from the opening position.
	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	let fen = $state(STARTING_FEN);
	let orientation = $state<'white' | 'black'>('white');
	let interactive = $state(true);
	let lastMove = $state<[string, string] | undefined>(undefined);

	// A log of moves made, shown alongside the board for testing.
	let moveLog = $state<{ from: string; to: string; san: string }[]>([]);

	// Called by ChessBoard whenever the user makes a legal move.
	function handleMove(from: string, to: string, san: string, newFen: string) {
		fen = newFen;
		lastMove = [from, to];
		moveLog = [...moveLog, { from, to, san }];
	}

	function reset() {
		fen = STARTING_FEN;
		lastMove = undefined;
		moveLog = [];
	}
</script>

<div class="page">
	<h1>ChessBoard component — test</h1>

	<div class="controls">
		<button onclick={reset}>Reset board</button>
		<button onclick={() => (orientation = orientation === 'white' ? 'black' : 'white')}>
			Flip board
		</button>
		<label>
			<input type="checkbox" bind:checked={interactive} />
			Interactive
		</label>
	</div>

	<div class="layout">
		<!-- Board is constrained to 480 px wide so it renders at a sensible size -->
		<div class="board-container">
			<ChessBoard {fen} {orientation} {interactive} {lastMove} onMove={handleMove} />
		</div>

		<div class="move-log">
			<h2>Move log</h2>
			{#if moveLog.length === 0}
				<p class="empty">No moves yet — drag a piece to start.</p>
			{:else}
				<ol>
					{#each moveLog as move (move.from + move.to + move.san)}
						<li><strong>{move.san}</strong> ({move.from} → {move.to})</li>
					{/each}
				</ol>
			{/if}
		</div>
	</div>
</div>

<style>
	h1 {
		font-size: 1.2rem;
		margin: 0 0 1rem;
		color: #e2b714;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.controls button {
		padding: 0.35rem 0.85rem;
		background: #0f3460;
		border: 1px solid #1a4a80;
		border-radius: 4px;
		color: #e0e0e0;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.controls button:hover {
		background: #1a4a80;
	}

	.controls label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.875rem;
		color: #a0a0b0;
		cursor: pointer;
	}

	.layout {
		display: flex;
		gap: 2rem;
		align-items: flex-start;
	}

	.board-container {
		width: 480px;
		flex-shrink: 0;
	}

	.move-log {
		flex: 1;
		min-width: 180px;
	}

	.move-log h2 {
		font-size: 0.95rem;
		color: #a0a0b0;
		margin: 0 0 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.move-log ol {
		margin: 0;
		padding-left: 1.5rem;
		font-size: 0.875rem;
		color: #c0c0d0;
		line-height: 1.8;
	}

	.empty {
		font-size: 0.875rem;
		color: #606070;
		font-style: italic;
	}
</style>
