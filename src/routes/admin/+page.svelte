<script lang="ts">
	import type { PageData } from './$types';
	import { invalidateAll } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	// ── Create User ────────────────────────────────────────────────────────
	let showCreateForm = $state(false);
	let newUsername = $state('');
	let newPassword = $state('');
	let createError = $state('');
	let creating = $state(false);

	async function createUser() {
		createError = '';
		if (!newUsername.trim() || !newPassword) {
			createError = 'Username and password are required.';
			return;
		}
		creating = true;
		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: newUsername.trim(), password: newPassword })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to create user' }));
				createError = err.message ?? 'Failed to create user';
				return;
			}
			newUsername = '';
			newPassword = '';
			showCreateForm = false;
			await invalidateAll();
		} catch {
			createError = 'Network error — please try again.';
		} finally {
			creating = false;
		}
	}

	// ── Toggle Enabled ─────────────────────────────────────────────────────
	async function toggleEnabled(userId: number, currentEnabled: boolean) {
		await fetch(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled: !currentEnabled })
		});
		await invalidateAll();
	}

	// ── Toggle Role ────────────────────────────────────────────────────────
	async function toggleRole(userId: number, currentRole: string) {
		const newRole = currentRole === 'admin' ? 'user' : 'admin';
		const res = await fetch(`/api/admin/users/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: newRole })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			alert(err.message ?? 'Failed to change role');
			return;
		}
		await invalidateAll();
	}

	// ── Rename User ────────────────────────────────────────────────────────
	let renameUserId = $state<number | null>(null);
	let renameUsername = $state('');
	let renameError = $state('');

	async function renameUser() {
		if (!renameUserId) return;
		renameError = '';
		const trimmed = renameUsername.trim();
		if (trimmed.length < 3 || trimmed.length > 30) {
			renameError = 'Username must be 3–30 characters.';
			return;
		}
		const res = await fetch(`/api/admin/users/${renameUserId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: trimmed })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			renameError = err.message ?? 'Failed to rename user';
			return;
		}
		renameUserId = null;
		renameUsername = '';
		await invalidateAll();
	}

	// ── Reset Password ─────────────────────────────────────────────────────
	let resetUserId = $state<number | null>(null);
	let resetPassword = $state('');
	let resetError = $state('');

	async function resetUserPassword() {
		if (!resetUserId) return;
		resetError = '';
		if (!resetPassword || resetPassword.length < 8) {
			resetError = 'Password must be at least 8 characters.';
			return;
		}
		const res = await fetch(`/api/admin/users/${resetUserId}/reset-password`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ newPassword: resetPassword })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			resetError = err.message ?? 'Failed to reset password';
			return;
		}
		resetUserId = null;
		resetPassword = '';
	}

	// ── Delete User ────────────────────────────────────────────────────────
	let confirmDeleteId = $state<number | null>(null);

	async function deleteUser(userId: number) {
		const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
		if (!res.ok) {
			const err = await res.json().catch(() => ({ message: 'Failed' }));
			alert(err.message ?? 'Failed to delete user');
			confirmDeleteId = null;
			return;
		}
		confirmDeleteId = null;
		await invalidateAll();
	}

	function formatDate(d: Date | string) {
		return new Date(d).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Admin — Chessstack</title>
</svelte:head>

<div class="admin-page">
	<h1>User Management</h1>

	<div class="admin-content">
		<!-- ── Info Bar ────────────────────────────────────────────────── -->
		<section class="admin-section info-bar">
			<div class="info-item">
				<span class="info-label">Total Users</span>
				<span class="info-value">{data.users.length}</span>
			</div>
			<div class="info-item">
				<span class="info-label">Registration</span>
				<span class="info-value mode-badge" class:mode-open={data.registrationMode === 'open'}>
					{data.registrationMode}
				</span>
			</div>
		</section>

		<!-- ── Create User ────────────────────────────────────────────── -->
		<section class="admin-section">
			<h2>Create User</h2>
			{#if showCreateForm}
				<div class="create-form">
					<input
						type="text"
						placeholder="Username"
						bind:value={newUsername}
						minlength="3"
						maxlength="30"
					/>
					<input
						type="password"
						placeholder="Password (min 8 characters)"
						bind:value={newPassword}
						minlength="8"
					/>
					{#if createError}
						<p class="error-msg">{createError}</p>
					{/if}
					<div class="form-actions">
						<button class="btn-primary" onclick={createUser} disabled={creating}>
							{creating ? 'Creating...' : 'Create'}
						</button>
						<button
							class="btn-secondary"
							onclick={() => {
								showCreateForm = false;
								createError = '';
							}}
						>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<button class="btn-primary" onclick={() => (showCreateForm = true)}> + New User </button>
			{/if}
		</section>

		<!-- ── User List ──────────────────────────────────────────────── -->
		<section class="admin-section">
			<h2>Users</h2>
			<div class="user-list">
				{#each data.users as u (u.id)}
					<div class="user-card" class:disabled={!u.enabled}>
						<div class="user-info">
							<div class="user-header">
								<span class="user-name">{u.username}</span>
								<span class="role-badge" class:role-admin={u.role === 'admin'}>{u.role}</span>
								{#if !u.enabled}
									<span class="status-badge disabled-badge">disabled</span>
								{/if}
							</div>
							<span class="user-date">Created {formatDate(u.createdAt)}</span>
						</div>

						<div class="user-actions">
							<!-- Toggle enabled -->
							{#if u.id !== data.user?.id}
								<button
									class="action-btn"
									class:action-danger={u.enabled}
									title={u.enabled ? 'Disable account' : 'Enable account'}
									onclick={() => toggleEnabled(u.id, u.enabled)}
								>
									{u.enabled ? 'Disable' : 'Enable'}
								</button>
							{/if}

							<!-- Toggle role -->
							{#if u.id !== data.user?.id}
								<button
									class="action-btn"
									title={u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
									onclick={() => toggleRole(u.id, u.role)}
								>
									{u.role === 'admin' ? 'Demote' : 'Promote'}
								</button>
							{/if}

							<!-- Rename -->
							{#if renameUserId === u.id}
								<div class="inline-form">
									<input
										type="text"
										placeholder="New username"
										bind:value={renameUsername}
										minlength="3"
										maxlength="30"
									/>
									<button class="action-btn" onclick={renameUser}>Set</button>
									<button
										class="action-btn"
										onclick={() => {
											renameUserId = null;
											renameError = '';
										}}
									>
										Cancel
									</button>
									{#if renameError}
										<span class="error-inline">{renameError}</span>
									{/if}
								</div>
							{:else}
								<button
									class="action-btn"
									onclick={() => {
										renameUserId = u.id;
										renameUsername = u.username;
										renameError = '';
									}}
								>
									Rename
								</button>
							{/if}

							<!-- Reset password -->
							{#if resetUserId === u.id}
								<div class="inline-form">
									<input
										type="password"
										placeholder="New password"
										bind:value={resetPassword}
										minlength="8"
									/>
									<button class="action-btn" onclick={resetUserPassword}>Set</button>
									<button
										class="action-btn"
										onclick={() => {
											resetUserId = null;
											resetError = '';
										}}
									>
										Cancel
									</button>
									{#if resetError}
										<span class="error-inline">{resetError}</span>
									{/if}
								</div>
							{:else}
								<button
									class="action-btn"
									onclick={() => {
										resetUserId = u.id;
										resetPassword = '';
										resetError = '';
									}}
								>
									Reset PW
								</button>
							{/if}

							<!-- Delete -->
							{#if u.id !== data.user?.id}
								{#if confirmDeleteId === u.id}
									<span class="confirm-delete">
										Delete all data?
										<button class="action-btn action-danger" onclick={() => deleteUser(u.id)}
											>Yes</button
										>
										<button class="action-btn" onclick={() => (confirmDeleteId = null)}>No</button>
									</span>
								{:else}
									<button class="action-btn action-danger" onclick={() => (confirmDeleteId = u.id)}>
										Delete
									</button>
								{/if}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>

<style>
	/* ── Page Layout ──────────────────────────────────────────────── */

	.admin-page {
		max-width: 700px;
		margin: 0 auto;
	}

	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-display);
		font-size: 1.5rem;
		color: var(--color-text-primary);
	}

	h2 {
		margin: 0 0 var(--space-4);
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--space-3);
	}

	.admin-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.admin-section {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-surface);
		padding: var(--space-6);
	}

	/* ── Info Bar ─────────────────────────────────────────────────── */

	.info-bar {
		display: flex;
		gap: var(--space-8);
		padding: var(--space-4) var(--space-6);
	}

	.info-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.info-label {
		font-size: 11px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
	}

	.info-value {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.mode-badge {
		text-transform: capitalize;
	}

	.mode-open {
		color: var(--color-success);
	}

	/* ── Create Form ──────────────────────────────────────────────── */

	.create-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 320px;
	}

	.create-form input {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface-alt);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 13px;
	}

	.create-form input::placeholder {
		color: var(--color-text-muted);
	}

	.create-form input:focus {
		outline: none;
		border-color: var(--color-gold);
		box-shadow: 0 0 0 3px var(--color-gold-glow);
	}

	.form-actions {
		display: flex;
		gap: var(--space-3);
	}

	/* ── Buttons ──────────────────────────────────────────────────── */

	.btn-primary {
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-md);
		background: var(--color-gold);
		color: var(--color-base);
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition:
			box-shadow var(--dur-fast) var(--ease-snap),
			transform var(--dur-fast) var(--ease-snap);
	}

	.btn-primary:hover:not(:disabled) {
		box-shadow: var(--glow-gold);
	}

	.btn-primary:active:not(:disabled) {
		transform: scale(0.97);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 13px;
		cursor: pointer;
	}

	.btn-secondary:hover {
		border-color: var(--color-text-muted);
	}

	/* ── User List ────────────────────────────────────────────────── */

	.user-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.user-card {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: border-color var(--dur-fast) var(--ease-snap);
	}

	.user-card:hover {
		border-color: var(--color-gold-dim);
	}

	.user-card.disabled {
		opacity: 0.6;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.user-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.user-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.role-badge {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	.role-badge.role-admin {
		background: rgba(226, 183, 20, 0.1);
		color: var(--color-gold);
		border-color: rgba(226, 183, 20, 0.3);
	}

	.status-badge {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}

	.disabled-badge {
		background: rgba(248, 113, 113, 0.1);
		color: var(--color-danger);
		border: 1px solid rgba(248, 113, 113, 0.3);
	}

	.user-date {
		font-size: 11px;
		color: var(--color-text-muted);
	}

	/* ── User Actions ─────────────────────────────────────────────── */

	.user-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		flex-shrink: 0;
	}

	.action-btn {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 11px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.action-btn:hover {
		border-color: var(--color-text-muted);
		color: var(--color-text-primary);
	}

	.action-btn.action-danger {
		color: var(--color-danger);
		border-color: rgba(248, 113, 113, 0.3);
	}

	.action-btn.action-danger:hover {
		background: rgba(248, 113, 113, 0.1);
		border-color: var(--color-danger);
	}

	.confirm-delete {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 12px;
		color: var(--color-danger);
	}

	.inline-form {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.inline-form input {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 12px;
		width: 150px;
	}

	.inline-form input:focus {
		outline: none;
		border-color: var(--color-gold);
		box-shadow: 0 0 0 3px var(--color-gold-glow);
	}

	.error-msg {
		font-size: 13px;
		color: var(--color-danger);
	}

	.error-inline {
		font-size: 11px;
		color: var(--color-danger);
	}

	/* ── Responsive ───────────────────────────────────────────────── */

	@media (max-width: 600px) {
		.user-card {
			flex-direction: column;
		}

		.user-actions {
			width: 100%;
		}

		.info-bar {
			flex-direction: column;
			gap: var(--space-3);
		}
	}
</style>
