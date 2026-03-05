// PATCH /api/admin/users/[id] — Update user properties (enable/disable, change role).
// DELETE /api/admin/users/[id] — Hard-delete a user and all their data.
//
// Access is guarded by hooks.server.ts (admin role required).

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import {
	user,
	session,
	userSettings,
	repertoire,
	userMove,
	userRepertoireMove,
	reviewedGame,
	drillSession,
	puzzleAttempt,
	importedGame
} from '$lib/db/schema';
import { eq, and, count } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Admin only');

	const targetId = parseInt(params.id);
	if (isNaN(targetId)) throw error(400, 'Invalid user ID');

	const body = await request.json();

	// Look up the target user
	const [target] = await db
		.select({ id: user.id, username: user.username, role: user.role, enabled: user.enabled })
		.from(user)
		.where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	// Toggle enabled
	if (typeof body.enabled === 'boolean') {
		// Cannot disable yourself
		if (targetId === locals.user.id) {
			throw error(400, 'You cannot disable your own account.');
		}

		await db.update(user).set({ enabled: body.enabled }).where(eq(user.id, targetId));

		// When disabling, immediately invalidate all their sessions
		if (!body.enabled) {
			await db.delete(session).where(eq(session.userId, targetId));
		}
	}

	// Change role
	if (body.role === 'admin' || body.role === 'user') {
		// Cannot demote yourself
		if (targetId === locals.user.id && body.role !== 'admin') {
			throw error(400, 'You cannot remove your own admin role.');
		}

		// Cannot remove the last admin
		if (body.role === 'user' && target.role === 'admin') {
			const [adminCount] = await db
				.select({ count: count() })
				.from(user)
				.where(and(eq(user.role, 'admin'), eq(user.enabled, true)));
			if (adminCount.count <= 1) {
				throw error(400, 'Cannot remove the last admin. Promote another user first.');
			}
		}

		await db.update(user).set({ role: body.role }).where(eq(user.id, targetId));
	}

	// Change username
	if (typeof body.username === 'string') {
		const newUsername = body.username.trim();
		if (newUsername.length < 3 || newUsername.length > 30) {
			throw error(400, 'Username must be 3–30 characters.');
		}
		if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
			throw error(400, 'Username may only contain letters, numbers, hyphens, and underscores.');
		}
		// Check uniqueness (skip if unchanged)
		if (newUsername !== target.username) {
			const [existing] = await db
				.select({ id: user.id })
				.from(user)
				.where(eq(user.username, newUsername));
			if (existing) {
				throw error(409, 'That username is already taken.');
			}
			await db.update(user).set({ username: newUsername }).where(eq(user.id, targetId));
		}
	}

	// Return updated user
	const [updated] = await db
		.select({
			id: user.id,
			username: user.username,
			role: user.role,
			enabled: user.enabled,
			createdAt: user.createdAt
		})
		.from(user)
		.where(eq(user.id, targetId));

	return json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Admin only');

	const targetId = parseInt(params.id);
	if (isNaN(targetId)) throw error(400, 'Invalid user ID');

	// Cannot delete yourself
	if (targetId === locals.user.id) {
		throw error(400, 'You cannot delete your own account.');
	}

	// Verify target exists
	const [target] = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	// Cannot delete the last admin
	if (target.role === 'admin') {
		const [adminCount] = await db
			.select({ count: count() })
			.from(user)
			.where(and(eq(user.role, 'admin'), eq(user.enabled, true)));
		if (adminCount.count <= 1) {
			throw error(400, 'Cannot delete the last admin. Promote another user first.');
		}
	}

	// Cascade-delete all user data in FK-safe order (children before parents).
	await db.transaction(async (tx) => {
		await tx.delete(session).where(eq(session.userId, targetId));
		await tx.delete(puzzleAttempt).where(eq(puzzleAttempt.userId, targetId));
		await tx.delete(drillSession).where(eq(drillSession.userId, targetId));
		await tx.delete(importedGame).where(eq(importedGame.userId, targetId));
		await tx.delete(reviewedGame).where(eq(reviewedGame.userId, targetId));
		await tx.delete(userRepertoireMove).where(eq(userRepertoireMove.userId, targetId));
		await tx.delete(userMove).where(eq(userMove.userId, targetId));
		await tx.delete(repertoire).where(eq(repertoire.userId, targetId));
		await tx.delete(userSettings).where(eq(userSettings.userId, targetId));
		await tx.delete(user).where(eq(user.id, targetId));
	});

	return json({ success: true });
};
