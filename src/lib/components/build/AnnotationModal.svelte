<!--
	AnnotationModal — modal dialog for adding/editing move annotations.

	Shows a textarea with character count, save/cancel buttons, and error display.
	The backdrop click and Escape key both close the modal.

	Props:
	  move — the RepertoireMove being annotated (san is shown in the header)
	  draft — the current textarea value (bound two-way)
	  saving — true while a PATCH request is in-flight
	  error — error message to display, or null

	Events:
	  onSave() — called when the user clicks Save
	  onClose() — called when the user cancels or clicks outside
-->

<script lang="ts">
	import type { RepertoireMove } from './buildState.svelte';

	interface Props {
		move: RepertoireMove;
		draft: string;
		saving: boolean;
		error: string | null;
		onSave: () => void;
		onClose: () => void;
	}

	let { move, draft = $bindable(), saving, error, onSave, onClose }: Props = $props();
</script>

<div
	class="modal-backdrop"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div
		class="modal"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<div class="modal-header">
			<span class="modal-title">Annotation — <strong>{move.san}</strong></span>
			<button class="modal-close" onclick={onClose} aria-label="Close">✕</button>
		</div>
		<textarea
			class="annotation-textarea"
			bind:value={draft}
			placeholder="Add a note about this move…"
			maxlength="500"
			rows="4"
			disabled={saving}
		></textarea>
		<div class="annotation-char-count">{draft.length}/500</div>
		{#if error}
			<p class="annotation-error">{error}</p>
		{/if}
		<div class="modal-actions">
			<button class="modal-btn modal-btn--cancel" onclick={onClose} disabled={saving}>
				Cancel
			</button>
			<button class="modal-btn modal-btn--save" onclick={onSave} disabled={saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: #111827;
		border: 1px solid #1a3a5c;
		border-radius: 8px;
		padding: 1.25rem;
		width: 360px;
		max-width: calc(100vw - 2rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-title {
		font-size: 0.875rem;
		color: #c0c0d0;
	}

	.modal-close {
		background: none;
		border: none;
		color: #505060;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0.1rem 0.2rem;
		line-height: 1;
	}

	.modal-close:hover {
		color: #a0a0b0;
	}

	.annotation-textarea {
		width: 100%;
		background: #0d1520;
		border: 1px solid #1a3a5c;
		border-radius: 4px;
		color: #c0c0d0;
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.5;
		padding: 0.5rem 0.65rem;
		resize: vertical;
		box-sizing: border-box;
	}

	.annotation-textarea:focus {
		outline: none;
		border-color: #4a6a9a;
	}

	.annotation-textarea:disabled {
		opacity: 0.5;
	}

	.annotation-char-count {
		font-size: 0.72rem;
		color: #404050;
		text-align: right;
		margin-top: -0.4rem;
	}

	.annotation-error {
		font-size: 0.8rem;
		color: #e06060;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.modal-btn {
		padding: 0.4rem 1rem;
		border-radius: 4px;
		font-size: 0.875rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.12s,
			background 0.12s,
			color 0.12s;
	}

	.modal-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.modal-btn--cancel {
		background: none;
		border: 1px solid #1a3a5c;
		color: #a0a0b0;
	}

	.modal-btn--cancel:hover:not(:disabled) {
		border-color: #4a6a9a;
		color: #d0d0e0;
	}

	.modal-btn--save {
		background: #0f3460;
		border: 1px solid #1a5090;
		color: #c8d8f0;
	}

	.modal-btn--save:hover:not(:disabled) {
		background: #1a4a7a;
		border-color: #2a6aaa;
		color: #e0eeff;
	}
</style>
