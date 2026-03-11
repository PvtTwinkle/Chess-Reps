<!--
	ResizableBoard — a resize container for the chessboard area.

	Wraps the board (and optionally adjacent elements like EvalBar) and adds a
	drag handle at the bottom-right corner. The container's width is set
	explicitly when a size is active, or left at 100% in auto mode.

	On pointer-up the `onResize` callback fires so the page can persist the
	new size to the database.
-->

<script lang="ts">
	import { untrack } from 'svelte';
	import type { Snippet } from 'svelte';

	// ---------------------------------------------------------------------------
	// Props
	// ---------------------------------------------------------------------------

	interface Props {
		/** Saved board size in pixels. 0 = auto (fill parent). */
		boardSize?: number;
		/** Called on drag-end with the new pixel width. */
		onResize?: (size: number) => void;
		/** Board content to render inside the resize container. */
		children: Snippet;
	}

	let { boardSize = 0, onResize = undefined, children }: Props = $props();

	// ---------------------------------------------------------------------------
	// Resize state
	// ---------------------------------------------------------------------------

	const MIN_SIZE = 320;
	const MAX_SIZE = 800;

	let containerEl: HTMLElement;
	let dragging = $state(false);
	let dragStartX = 0;
	let dragStartWidth = 0;

	/**
	 * Local override for the board width. Set during/after a drag so the board
	 * keeps its new size immediately (the DB write is async and data.settings
	 * won't update until the next navigation). Reset when the boardSize prop
	 * changes (e.g. after invalidateAll).
	 */
	let localWidth = $state<number | null>(null);

	// If the parent passes an updated boardSize (e.g. after navigation), clear
	// the local override so we respect the prop. Skip during an active drag so
	// an async data reload can't snap the board back mid-resize.
	$effect(() => {
		// Read boardSize to subscribe to it.
		void boardSize;
		if (!untrack(() => dragging)) localWidth = null;
	});

	/** The effective width style to apply. */
	let effectiveWidth = $derived.by(() => {
		const w = localWidth ?? (boardSize > 0 ? boardSize : 0);
		return w > 0 ? `${w}px` : '100%';
	});

	// ---------------------------------------------------------------------------
	// Drag handlers
	// ---------------------------------------------------------------------------

	function onPointerDown(e: PointerEvent) {
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);

		dragging = true;
		dragStartX = e.clientX;
		// Use the container's actual rendered width as the starting point
		dragStartWidth = containerEl.getBoundingClientRect().width;
		localWidth = dragStartWidth;
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		const delta = e.clientX - dragStartX;
		const newWidth = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(dragStartWidth + delta)));
		localWidth = newWidth;
	}

	function onPointerUp() {
		if (!dragging) return;
		dragging = false;
		// Keep localWidth set — don't null it. The visual size stays until
		// the next navigation reloads data.settings with the persisted value.
		if (localWidth !== null) {
			onResize?.(localWidth);
		}
	}
</script>

<div bind:this={containerEl} class="resizable-board" class:dragging style:width={effectiveWidth}>
	{@render children()}

	<!-- Drag handle — hidden on mobile where the board is always full-width -->
	<div
		class="resize-handle"
		role="separator"
		aria-orientation="horizontal"
		aria-label="Resize chessboard"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
	></div>
</div>

<style>
	.resizable-board {
		position: relative;
		/* width is set via style binding; max-width prevents overflow on mobile */
		max-width: 100%;
	}

	/* Prevent Chessground from capturing pointer events during resize drag */
	.resizable-board.dragging {
		pointer-events: none;
	}

	/* Re-enable pointer events on the handle itself during drag */
	.resizable-board.dragging .resize-handle {
		pointer-events: auto;
	}

	/* ── Drag handle ─────────────────────────────────────────────────────────── */

	.resize-handle {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 20px;
		height: 20px;
		cursor: nwse-resize;
		touch-action: none;
		z-index: 10;
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	/* Triangular grip indicator (CSS border trick) */
	.resize-handle::after {
		content: '';
		position: absolute;
		bottom: 0;
		right: 0;
		width: 0;
		height: 0;
		border-style: solid;
		border-width: 0 0 14px 14px;
		border-color: transparent transparent var(--color-text-muted, #888) transparent;
		opacity: 0.5;
	}

	.resizable-board:hover .resize-handle,
	.resize-handle:hover {
		opacity: 1;
	}

	.resize-handle:hover::after,
	.resizable-board.dragging .resize-handle::after {
		opacity: 0.8;
	}

	.resizable-board.dragging .resize-handle {
		opacity: 1;
	}

	/* Hide on mobile — board is always full-width */
	@media (max-width: 767px) {
		.resize-handle {
			display: none;
		}
	}
</style>
