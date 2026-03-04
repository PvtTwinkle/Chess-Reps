<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Chessground } from '@lichess-org/chessground';
	import { Chess } from 'chess.js';
	import type { Square } from 'chess.js';
	import type { Api } from '@lichess-org/chessground/api';
	import type { Key } from '@lichess-org/chessground/types';
	import type { DrawShape } from '@lichess-org/chessground/draw';

	// Chessground base CSS (layout + positioning) is always needed.
	// Board square colors come from our generated theme CSS (class-scoped),
	// and the cburnett piece set is the default (piece set selection deferred).
	import '@lichess-org/chessground/assets/chessground.base.css';
	import '$lib/themes/board-themes.css';
	import '@lichess-org/chessground/assets/chessground.cburnett.css';

	// ---------------------------------------------------------------------------
	// Props
	// ---------------------------------------------------------------------------

	interface Props {
		/** FEN string for the position to display. Defaults to the starting position. */
		fen?: string;
		/** Which colour appears at the bottom of the board. */
		orientation?: 'white' | 'black';
		/** Board color theme name (matches a .board-theme-{name} CSS class). */
		boardTheme?: string;
		/**
		 * When true, the player whose turn it is can drag/click their pieces.
		 * Set to false during opponent auto-play in drill mode.
		 */
		interactive?: boolean;
		/**
		 * Highlight a move on the board (e.g. the last move played).
		 * Pass [fromSquare, toSquare], e.g. ['e2', 'e4'].
		 */
		lastMove?: [string, string];
		/**
		 * Called after the user makes a legal move.
		 * Receives the origin square, destination square, the SAN notation (e.g. "Nf3"),
		 * the new FEN after the move, and whether a piece was captured (for sound selection).
		 */
		onMove?: (from: string, to: string, san: string, newFen: string, isCapture: boolean) => void;
		/**
		 * Programmatic arrows/dots to draw on the board (e.g. repertoire move arrows
		 * in build mode). Uses Chessground's autoShapes — these are distinct from
		 * user-drawn right-click arrows. Defaults to an empty array (no shapes).
		 */
		autoShapes?: DrawShape[];
	}

	const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	let {
		fen = STARTING_FEN,
		orientation = 'white',
		boardTheme = 'brown',
		interactive = true,
		lastMove = undefined,
		onMove = undefined,
		autoShapes = []
	}: Props = $props();

	// ---------------------------------------------------------------------------
	// Internal state
	// ---------------------------------------------------------------------------

	// boardEl: the div that Chessground attaches its DOM tree into.
	// set by Svelte's bind:this once the div is in the DOM.
	let boardEl: HTMLElement;

	// The Chessground API handle — lets us call cg.set() to update the board later.
	let cg: Api | undefined;

	// A reactive flag that flips to true inside onMount once Chessground is ready.
	// The $effect below watches this so it knows when it is safe to call cg.set().
	let initialized = $state(false);

	// ---------------------------------------------------------------------------
	// Helper functions
	// ---------------------------------------------------------------------------

	/**
	 * Build the legal-move destinations map that Chessground uses to draw the
	 * green dots when a piece is selected.
	 *
	 * Returns a Map<fromSquare, toSquare[]>.  Chessground calls this the "dests"
	 * map.  We compute it from Chess.js because Chessground itself has no idea
	 * which moves are legal — it is purely a visual component.
	 *
	 * Deduplication: when a pawn can promote, Chess.js returns 4 separate moves
	 * (one per promotion piece) to the same destination square.  We deduplicate
	 * so Chessground only sees one destination per square.
	 */
	function buildDests(chess: Chess): Map<Key, Key[]> {
		const dests = new SvelteMap<Key, Key[]>();
		for (const move of chess.moves({ verbose: true })) {
			const from = move.from as Key;
			const to = move.to as Key;
			if (!dests.has(from)) dests.set(from, []);
			const arr = dests.get(from)!;
			// Only add the destination once (promotion generates duplicates)
			if (!arr.includes(to)) arr.push(to);
		}
		return dests;
	}

	/** Translate Chess.js 'w'/'b' to Chessground 'white'/'black'. */
	function toColor(chess: Chess): 'white' | 'black' {
		return chess.turn() === 'w' ? 'white' : 'black';
	}

	// ---------------------------------------------------------------------------
	// Move handler
	// ---------------------------------------------------------------------------

	/**
	 * Called by Chessground after the user drags or clicks a piece to a new square.
	 *
	 * At this point Chessground has already moved the piece visually.  Our job is to:
	 *   1. Validate the move through Chess.js (to get the SAN string and new FEN).
	 *   2. Update Chessground's legal-move map for the next turn.
	 *   3. Notify the parent component via the onMove callback.
	 *
	 * Note: reading `fen`, `interactive`, `onMove` here always gives the *current*
	 * values because they are Svelte 5 reactive props ($props), not stale closures.
	 */
	function handleAfterMove(orig: Key, dest: Key): void {
		const chess = new Chess(fen);
		// Cast to Square: Chessground's Key includes the sentinel 'a0', but after()
		// is only ever called with real board squares, so this cast is safe.
		const piece = chess.get(orig as Square);

		// Detect pawn promotion: pawn on the 7th rank moving to the 8th (white)
		// or pawn on 2nd rank moving to 1st (black).
		// We auto-promote to queen for now — a promotion dialog comes in a later step.
		const isPromotion =
			piece?.type === 'p' &&
			((piece.color === 'w' && dest[1] === '8') || (piece.color === 'b' && dest[1] === '1'));

		const result = chess.move({
			from: orig as Square,
			to: dest as Square,
			promotion: isPromotion ? 'q' : undefined
		});

		if (!result) {
			// Should not happen because we pre-computed dests from Chess.js,
			// but snap the board back to the last known-good FEN just in case.
			cg?.set({ fen });
			return;
		}

		// Update the board's turn colour and legal-move map for the next ply.
		cg?.set({
			turnColor: toColor(chess),
			movable: {
				color: interactive ? toColor(chess) : undefined,
				dests: interactive ? buildDests(chess) : new Map()
			}
		});

		// Tell the parent what happened. `result.captured` is set when a piece
		// was taken — pass it as a boolean so the parent can pick the right sound.
		onMove?.(orig, dest, result.san, chess.fen(), !!result.captured);
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	onMount(() => {
		const chess = new Chess(fen);

		cg = Chessground(boardEl, {
			fen,
			orientation,
			turnColor: toColor(chess),
			movable: {
				// free: false means only allow squares listed in `dests` (i.e. legal moves).
				// If free were true, any piece could move anywhere — no rules enforced.
				free: false,
				color: interactive ? toColor(chess) : undefined,
				dests: interactive ? buildDests(chess) : new Map(),
				events: {
					after: handleAfterMove
				}
			},
			highlight: {
				lastMove: true, // yellow tint on origin and destination of last move
				check: true // red tint on the king when in check
			},
			animation: {
				enabled: true,
				duration: 200 // milliseconds for piece movement animation
			},
			lastMove: lastMove as [Key, Key] | undefined
		});

		// Signal the $effect below that the board is ready.
		initialized = true;

		// Cleanup: called by Svelte when this component is removed from the DOM.
		return () => {
			cg?.destroy();
		};
	});

	/**
	 * Keep the board in sync with props.
	 *
	 * This effect re-runs whenever `initialized`, `fen`, `orientation`,
	 * `interactive`, or `lastMove` change.  The `initialized` guard means it
	 * is a no-op until onMount has finished setting up the board.
	 *
	 * Why not put all of this in onMount?  Because onMount runs once.  We need
	 * the board to update whenever the parent passes a new FEN (e.g. after an
	 * opponent move is played in drill mode, or when the user navigates to a
	 * different position in build mode).
	 */
	$effect(() => {
		if (!initialized || !cg) return;

		const chess = new Chess(fen);
		cg.set({
			fen,
			orientation,
			turnColor: toColor(chess),
			movable: {
				color: interactive ? toColor(chess) : undefined,
				dests: interactive ? buildDests(chess) : new Map()
			},
			lastMove: lastMove as [Key, Key] | undefined,
			drawable: {
				autoShapes
			}
		});
	});
</script>

<!--
	boardEl is bound to this div.  Chessground appends its own child elements
	(cg-container, cg-board, piece elements, square elements) inside here, and
	adds the `cg-wrap` CSS class automatically.

	The width is controlled by the parent — set a width on the parent element
	and the board will fill it.  Height is kept equal to width via aspect-ratio.
-->
<div bind:this={boardEl} class="board-wrap board-theme-{boardTheme}"></div>

<style>
	/*
		The board must always be a perfect square.
		aspect-ratio: 1/1 means height = width automatically.

		Chessground's base CSS positions its child elements absolutely inside
		the .cg-wrap wrapper (which Chessground adds to this div), so the
		wrapper must have explicit pixel dimensions — percentage heights alone
		would not work without this trick.
	*/
	.board-wrap {
		width: 100%;
		aspect-ratio: 1 / 1;
		/* Prevent browser from hijacking touch events for scroll/zoom —
		   Chessground handles its own touch events internally. */
		touch-action: none;
	}

	/* Shrink coordinate labels on small phones — --bp-sm */
	@media (max-width: 479px) {
		.board-wrap :global(coords) {
			font-size: 9px !important;
		}
	}
</style>
