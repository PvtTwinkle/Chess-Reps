<!--
	ImportPgnModal.svelte
	─────────────────────
	Multi-step modal for importing PGN with variations into a repertoire.

	Steps:
	  1. Input   — paste PGN or upload .pgn file
	  2. Preview — show what will be imported, resolve conflicts
	  3. Importing — spinner while batch insert runs
	  4. Done    — summary of what was imported

	Props:
	  open             — two-way bound boolean controlling visibility
	  repertoireId     — which repertoire to import into
	  repertoireColor  — 'WHITE' | 'BLACK' (for display context)
	  onComplete       — callback after successful import (triggers data reload)
-->

<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { ImportConflict, ImportPreview } from '$lib/pgn/detectConflicts';
	import type { PgnEdge } from '$lib/pgn/parseVariations';
	import type { DrawShape } from '@lichess-org/chessground/draw';
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import { Chess } from 'chess.js';

	let {
		open = $bindable(false),
		repertoireId,
		repertoireColor,
		onComplete = () => {}
	}: {
		open: boolean;
		repertoireId: number;
		repertoireColor: 'WHITE' | 'BLACK';
		onComplete?: () => void;
	} = $props();

	// ── State machine ────────────────────────────────────────────────────────

	type Step = 'input' | 'preview' | 'importing' | 'done';
	let step = $state<Step>('input');

	// ── Input state ──────────────────────────────────────────────────────────

	let pgnText = $state('');
	let parsing = $state(false);
	let parseError = $state('');

	// ── Preview state ────────────────────────────────────────────────────────

	let preview = $state<ImportPreview | null>(null);
	let currentConflictIdx = $state(0);
	let resolvedConflicts = $state(new SvelteMap<string, string>());

	// ── Result state ─────────────────────────────────────────────────────────

	let result = $state<{ inserted: number; replaced: number; skipped: number } | null>(null);
	let importError = $state('');

	// ── Derived ──────────────────────────────────────────────────────────────

	const unresolvedCount = $derived(preview ? preview.conflicts.length - resolvedConflicts.size : 0);

	const totalNewMoves = $derived(
		preview ? preview.newUserMoves.length + preview.newOpponentMoves.length : 0
	);

	const currentConflict = $derived<ImportConflict | null>(
		preview && currentConflictIdx < preview.conflicts.length
			? preview.conflicts[currentConflictIdx]
			: null
	);

	// Arrow colors for each alternative move on the conflict board.
	// Green for the first, blue for the second, red for the third, etc.
	const ARROW_COLORS = ['green', 'blue', 'red', 'yellow'];

	/** Build arrow shapes showing each alternative move on the conflict board. */
	const conflictArrows = $derived.by<DrawShape[]>(() => {
		if (!currentConflict) return [];
		try {
			const chess = new Chess(currentConflict.fromFen);
			const shapes: DrawShape[] = [];
			for (let i = 0; i < currentConflict.alternatives.length; i++) {
				const san = currentConflict.alternatives[i];
				const color = ARROW_COLORS[i % ARROW_COLORS.length];
				// Reset to conflict position before each move resolution
				chess.load(currentConflict.fromFen);
				const result = chess.move(san);
				if (result) {
					shapes.push({
						orig: result.from,
						dest: result.to,
						brush: color
					});
				}
			}
			return shapes;
		} catch {
			return [];
		}
	});

	// ── Close / reset ────────────────────────────────────────────────────────

	function close() {
		open = false;
		// Reset state for next open
		step = 'input';
		pgnText = '';
		parsing = false;
		parseError = '';
		preview = null;
		currentConflictIdx = 0;
		resolvedConflicts = new SvelteMap();
		result = null;
		importError = '';
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	// ── File upload ──────────────────────────────────────────────────────────

	function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = () => {
			pgnText = reader.result as string;
		};
		reader.readAsText(file);

		// Reset input so the same file can be re-selected
		input.value = '';
	}

	// ── Parse ────────────────────────────────────────────────────────────────

	async function handleParse() {
		if (!pgnText.trim() || parsing) return;
		parsing = true;
		parseError = '';

		try {
			const res = await fetch('/api/import/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, pgn: pgnText })
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Parse failed' }));
				parseError = data.message || `Parse failed (${res.status})`;
				return;
			}

			preview = await res.json();
			currentConflictIdx = 0;
			resolvedConflicts = new SvelteMap();

			// If no conflicts, go straight to preview summary
			step = 'preview';
		} catch (e) {
			parseError = e instanceof Error ? e.message : 'Network error';
		} finally {
			parsing = false;
		}
	}

	// ── Conflict resolution ──────────────────────────────────────────────────

	function resolveConflict(fromFen: string, chosenSan: string) {
		resolvedConflicts.set(fromFen, chosenSan);

		// Advance to next unresolved conflict
		if (preview) {
			let next = currentConflictIdx + 1;
			while (
				next < preview.conflicts.length &&
				resolvedConflicts.has(preview.conflicts[next].fromFen)
			) {
				next++;
			}
			currentConflictIdx = next;
		}
	}

	// ── Execute import ───────────────────────────────────────────────────────

	/** Find annotation for a move from the preview edges. */
	function findAnnotation(fromFen: string, san: string): string | null {
		if (!preview) return null;
		const allEdges: PgnEdge[] = [...preview.newUserMoves, ...preview.newOpponentMoves];
		const edge = allEdges.find((e) => e.fromFen === fromFen && e.san === san);
		return edge?.annotation ?? null;
	}

	async function handleImport() {
		if (!preview) return;
		step = 'importing';
		importError = '';

		// Build the full move list: new user moves + new opponent moves + resolved conflicts
		const moves: { fromFen: string; san: string; annotation?: string | null }[] = [];

		// Add non-conflicting new moves (with annotations)
		for (const edge of preview.newUserMoves) {
			moves.push({ fromFen: edge.fromFen, san: edge.san, annotation: edge.annotation });
		}
		for (const edge of preview.newOpponentMoves) {
			moves.push({ fromFen: edge.fromFen, san: edge.san, annotation: edge.annotation });
		}

		// Add resolved conflict moves
		const replacements: { fromFen: string; san: string }[] = [];
		for (const conflict of preview.conflicts) {
			const chosen = resolvedConflicts.get(conflict.fromFen);
			if (chosen) {
				moves.push({
					fromFen: conflict.fromFen,
					san: chosen,
					annotation: findAnnotation(conflict.fromFen, chosen)
				});
				// If the chosen move differs from the existing repertoire move, it's a replacement
				if (conflict.existingMove && chosen !== conflict.existingMove) {
					replacements.push({ fromFen: conflict.fromFen, san: chosen });
				}
			}
		}

		if (moves.length === 0) {
			step = 'done';
			result = { inserted: 0, replaced: 0, skipped: 0 };
			return;
		}

		try {
			const res = await fetch('/api/import/execute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId, moves, replacements })
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Import failed' }));
				importError = data.message || `Import failed (${res.status})`;
				step = 'preview'; // go back to preview so user can retry
				return;
			}

			result = await res.json();
			step = 'done';
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Network error';
			step = 'preview';
		}
	}

	// ── Done ─────────────────────────────────────────────────────────────────

	function handleDone() {
		onComplete();
		close();
	}

	/** Shorten a FEN to a human-readable position hint (active color + piece info). */
	function positionHint(fen: string): string {
		const turn = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
		return `${turn} to move`;
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="backdrop" onclick={handleBackdropClick}>
		<div class="modal" role="dialog" aria-modal="true">
			<!-- ── Header ─────────────────────────────────────────────── -->
			<div class="modal-header">
				<h2>Import PGN</h2>
				<button class="close-btn" onclick={close} aria-label="Close">&times;</button>
			</div>

			<!-- ── Step: Input ────────────────────────────────────────── -->
			{#if step === 'input'}
				<div class="step-input">
					<p class="hint">
						Paste a PGN with variations to import moves into your
						{repertoireColor === 'WHITE' ? 'White' : 'Black'} repertoire.
					</p>

					<textarea
						class="pgn-textarea"
						bind:value={pgnText}
						placeholder="1. d4 Nf6 2. Nc3 d5 3. Bf4 ..."
						rows="10"
					></textarea>

					<div class="input-actions">
						<label class="file-label">
							<input
								type="file"
								accept=".pgn,.txt"
								onchange={handleFileUpload}
								class="file-input"
							/>
							Upload .pgn
						</label>

						<button class="btn-primary" onclick={handleParse} disabled={!pgnText.trim() || parsing}>
							{parsing ? 'Parsing...' : 'Parse & Preview'}
						</button>
					</div>

					{#if parseError}
						<p class="error">{parseError}</p>
					{/if}
				</div>

				<!-- ── Step: Preview ──────────────────────────────────────── -->
			{:else if step === 'preview'}
				{#if preview}
					<div class="step-preview">
						<!-- Summary stats -->
						<div class="stats">
							<div class="stat">
								<span class="stat-value">{preview.newUserMoves.length}</span>
								<span class="stat-label">your moves</span>
							</div>
							<div class="stat">
								<span class="stat-value">{preview.newOpponentMoves.length}</span>
								<span class="stat-label">opponent responses</span>
							</div>
							<div class="stat">
								<span class="stat-value">{preview.duplicates}</span>
								<span class="stat-label">already saved</span>
							</div>
							{#if preview.conflicts.length > 0}
								<div class="stat stat--warn">
									<span class="stat-value">{preview.conflicts.length}</span>
									<span class="stat-label">conflicts</span>
								</div>
							{/if}
						</div>

						<!-- Parse warnings -->
						{#if preview.parseErrors.length > 0}
							<div class="warnings">
								<p class="warnings-label">{preview.parseErrors.length} move(s) skipped:</p>
								{#each preview.parseErrors as err, i (i)}
									<p class="warning-item">{err}</p>
								{/each}
							</div>
						{/if}

						<!-- Import error from previous attempt -->
						{#if importError}
							<p class="error">{importError}</p>
						{/if}

						<!-- Conflict resolution -->
						{#if preview.conflicts.length > 0 && unresolvedCount > 0}
							<div class="conflict-section">
								<h3>
									Choose your move ({resolvedConflicts.size}/{preview.conflicts.length} resolved)
								</h3>

								{#if currentConflict}
									<div class="conflict-card">
										<p class="conflict-context">
											{positionHint(currentConflict.fromFen)}
											{#if currentConflict.source === 'REPERTOIRE_VS_PGN'}
												— your repertoire has a different move
											{:else}
												— PGN has multiple options
											{/if}
										</p>

										<div class="conflict-body">
											<div class="conflict-board">
												{#key currentConflict.fromFen}
													<ChessBoard
														fen={currentConflict.fromFen}
														orientation={repertoireColor === 'WHITE' ? 'white' : 'black'}
														interactive={false}
														autoShapes={conflictArrows}
													/>
												{/key}
											</div>

											<div class="conflict-choices">
												{#each currentConflict.alternatives as alt, i (alt)}
													<button
														class="choice-btn"
														class:choice-existing={alt === currentConflict.existingMove}
														onclick={() => resolveConflict(currentConflict!.fromFen, alt)}
													>
														<span class="choice-row">
															<span
																class="arrow-dot"
																style:background={ARROW_COLORS[i % ARROW_COLORS.length]}
															></span>
															<span class="choice-san">{alt}</span>
														</span>
														{#if alt === currentConflict.existingMove}
															<span class="choice-tag">current</span>
														{:else}
															<span class="choice-tag">PGN</span>
														{/if}
													</button>
												{/each}
											</div>
										</div>
									</div>
								{/if}
							</div>
						{/if}

						<!-- Action buttons -->
						<div class="preview-actions">
							<button
								class="btn-ghost"
								onclick={() => {
									step = 'input';
								}}
							>
								Back
							</button>

							{#if totalNewMoves === 0 && preview.conflicts.length === 0}
								<p class="nothing-hint">Nothing to import — all moves already saved.</p>
							{:else}
								<button class="btn-primary" onclick={handleImport} disabled={unresolvedCount > 0}>
									{unresolvedCount > 0
										? `Resolve ${unresolvedCount} conflict${unresolvedCount > 1 ? 's' : ''}`
										: `Import ${totalNewMoves + resolvedConflicts.size} move${totalNewMoves + resolvedConflicts.size !== 1 ? 's' : ''}`}
								</button>
							{/if}
						</div>
					</div>
				{/if}

				<!-- ── Step: Importing ────────────────────────────────────── -->
			{:else if step === 'importing'}
				<div class="step-importing">
					<div class="spinner"></div>
					<p>Importing moves...</p>
				</div>

				<!-- ── Step: Done ─────────────────────────────────────────── -->
			{:else if step === 'done'}
				<div class="step-done">
					{#if result}
						<h3>Import complete</h3>
						<div class="result-stats">
							{#if result.inserted > 0}
								<p>{result.inserted} move{result.inserted !== 1 ? 's' : ''} added</p>
							{/if}
							{#if result.replaced > 0}
								<p>{result.replaced} move{result.replaced !== 1 ? 's' : ''} replaced</p>
							{/if}
							{#if result.skipped > 0}
								<p>{result.skipped} duplicate{result.skipped !== 1 ? 's' : ''} skipped</p>
							{/if}
							{#if result.inserted === 0 && result.replaced === 0}
								<p>No changes made — all moves were already in your repertoire.</p>
							{/if}
						</div>
					{/if}

					<button class="btn-primary" onclick={handleDone}>Done</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ── Modal backdrop + panel (matches ManageRepertoireModal) ───────────── */

	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.65);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: #1a2840;
		border: 1px solid #0f3460;
		border-radius: 8px;
		width: 600px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 4rem);
		overflow-y: auto;
		padding: 1.5rem;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.1rem;
		color: #f0f0f0;
		font-weight: 600;
	}

	.close-btn {
		background: none;
		border: none;
		color: #606070;
		font-size: 1rem;
		cursor: pointer;
		padding: 0.25rem 0.4rem;
		border-radius: 3px;
		transition: color 0.15s;
		line-height: 1;
	}

	.close-btn:hover {
		color: #e0e0e0;
	}

	/* ── Step: Input ──────────────────────────────────────────────────────── */

	.hint {
		color: #a0a0b0;
		font-size: 0.875rem;
		margin: 0 0 0.75rem;
		line-height: 1.4;
	}

	.pgn-textarea {
		width: 100%;
		padding: 0.6rem 0.75rem;
		background: #0a1828;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #e0e0e0;
		font-family: monospace;
		font-size: 0.825rem;
		resize: vertical;
		box-sizing: border-box;
		line-height: 1.5;
	}

	.pgn-textarea:focus {
		outline: none;
		border-color: #e2b714;
	}

	.input-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.75rem;
		gap: 0.75rem;
	}

	.file-label {
		padding: 0.35rem 0.65rem;
		background: transparent;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #909098;
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.file-label:hover {
		border-color: #a0a0b0;
		color: #e0e0e0;
	}

	.file-input {
		display: none;
	}

	/* ── Step: Preview ────────────────────────────────────────────────────── */

	.stats {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: 0.5rem 0.75rem;
		background: #0f1f35;
		border: 1px solid #1a3a5c;
		border-radius: 6px;
		flex: 1;
		min-width: 80px;
	}

	.stat--warn {
		border-color: #7a5a18;
		background: #1a1a10;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: #f0f0f0;
	}

	.stat--warn .stat-value {
		color: #e2b714;
	}

	.stat-label {
		font-size: 0.7rem;
		color: #707080;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.warnings {
		padding: 0.6rem 0.75rem;
		background: #1a1808;
		border: 1px solid #3a3010;
		border-radius: 4px;
		margin-bottom: 1rem;
	}

	.warnings-label {
		margin: 0 0 0.3rem;
		font-size: 0.8rem;
		color: #c0a040;
		font-weight: 600;
	}

	.warning-item {
		margin: 0;
		font-size: 0.75rem;
		color: #a09060;
		line-height: 1.4;
	}

	/* ── Conflict resolution ──────────────────────────────────────────────── */

	.conflict-section {
		margin-bottom: 1rem;
	}

	.conflict-section h3 {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		color: #e2b714;
		font-weight: 600;
	}

	.conflict-card {
		padding: 0.75rem;
		background: #0f1f35;
		border: 1px solid #1a4a7a;
		border-radius: 6px;
	}

	.conflict-context {
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
		color: #a0a0b0;
		line-height: 1.4;
	}

	.conflict-body {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.conflict-board {
		width: 200px;
		flex-shrink: 0;
	}

	.conflict-choices {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
	}

	.choice-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		padding: 0.65rem 0.75rem;
		background: #0a1828;
		border: 2px solid #1a3a5c;
		border-radius: 6px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.choice-btn:hover {
		border-color: #e2b714;
		background: #12253a;
	}

	.choice-existing {
		border-color: #2a5a3c;
	}

	.choice-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.arrow-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.choice-san {
		font-size: 1.1rem;
		font-weight: 700;
		color: #f0f0f0;
		font-family: monospace;
	}

	.choice-tag {
		font-size: 0.65rem;
		color: #707080;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* ── Preview actions ──────────────────────────────────────────────────── */

	.preview-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.nothing-hint {
		color: #707080;
		font-size: 0.85rem;
		margin: 0;
	}

	/* ── Step: Importing ──────────────────────────────────────────────────── */

	.step-importing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 0;
		color: #a0a0b0;
		font-size: 0.9rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #1a3a5c;
		border-top-color: #e2b714;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Step: Done ───────────────────────────────────────────────────────── */

	.step-done {
		text-align: center;
		padding: 1rem 0;
	}

	.step-done h3 {
		margin: 0 0 1rem;
		font-size: 1rem;
		color: #50c070;
		font-weight: 600;
	}

	.result-stats {
		margin-bottom: 1.25rem;
	}

	.result-stats p {
		margin: 0.25rem 0;
		font-size: 0.9rem;
		color: #c0c0d0;
	}

	/* ── Shared ───────────────────────────────────────────────────────────── */

	.error {
		color: #e06060;
		font-size: 0.85rem;
		margin: 0.6rem 0 0;
		line-height: 1.4;
	}

	.btn-primary {
		padding: 0.45rem 1rem;
		background: #e2b714;
		border: none;
		border-radius: 4px;
		color: #1a1a2e;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.88;
	}

	.btn-primary:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.btn-ghost {
		padding: 0.35rem 0.65rem;
		background: transparent;
		border: 1px solid #1a4a7a;
		border-radius: 4px;
		color: #909098;
		font-size: 0.8rem;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.btn-ghost:hover:not(:disabled) {
		border-color: #a0a0b0;
		color: #e0e0e0;
	}
</style>
