// POST /api/admin/users/[id]/reset-password — Admin resets a user's password.
// Hashes the new password, updates the user row, and invalidates all their sessions.

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user, session } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Admin only');

	const targetId = parseInt(params.id);
	if (isNaN(targetId)) throw error(400, 'Invalid user ID');

	const body = await request.json();
	const newPassword = body.newPassword?.toString();

	if (!newPassword || newPassword.length < 8) {
		throw error(400, 'Password must be at least 8 characters.');
	}

	// Verify target exists
	const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId));
	if (!target) throw error(404, 'User not found');

	// Hash and update
	const passwordHash = await bcrypt.hash(newPassword, 10);
	await db.update(user).set({ passwordHash }).where(eq(user.id, targetId));

	// Invalidate all target user's sessions (force re-login)
	await db.delete(session).where(eq(session.userId, targetId));

	return json({ success: true });
};
