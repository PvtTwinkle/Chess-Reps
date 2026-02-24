<!--
	OpeningName.svelte
	──────────────────
	Displays the ECO code and opening name for the current board position.
	Example: "B90 · Sicilian Defence, Najdorf Variation"

	How it works:
	  1. Receives the current FEN and the move history FENs (newest → oldest).
	  2. POSTs to /api/eco with the full list whenever the position changes.
	  3. The server walks the list and returns the most specific recognised name.
	  4. If no match, renders nothing (the component takes up no space).

	Usage:
	  <OpeningName {currentFen} {fenHistory} />

	Where fenHistory is the FENs from navHistory in reverse order (most recent
	position first, starting position last), NOT including currentFen itself.
-->

<script lang="ts">
	interface Props {
		currentFen: string;
		// FENs from the move history, ordered newest-to-oldest.
		// The current FEN should NOT be included — it is passed separately.
		fenHistory: string[];
	}

	let { currentFen, fenHistory }: Props = $props();

	// The resolved ECO match, or null if the position isn't recognised.
	let ecoResult = $state<{ code: string; name: string } | null>(null);

	// Fetch the ECO name whenever the position changes.
	// We pass currentFen first so the server checks it before the history.
	$effect(() => {
		const fens = [currentFen, ...fenHistory];

		fetch('/api/eco', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fens })
		})
			.then((r) => r.json())
			.then((data: { code: string; name: string } | null) => {
				ecoResult = data;
			})
			.catch(() => {
				// Silently swallow errors — a missing ECO name is not fatal.
				ecoResult = null;
			});
	});
</script>

{#if ecoResult}
	<div class="opening-name">
		<span class="eco-code">{ecoResult.code}</span>
		<span class="eco-sep">·</span>
		<span class="eco-name">{ecoResult.name}</span>
	</div>
{/if}

<style>
	.opening-name {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		font-size: 0.8rem;
		line-height: 1.3;
		overflow: hidden;
	}

	.eco-code {
		font-weight: 700;
		color: #e2b714;
		letter-spacing: 0.03em;
		flex-shrink: 0;
	}

	.eco-sep {
		color: #404050;
		flex-shrink: 0;
	}

	.eco-name {
		color: #909098;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
