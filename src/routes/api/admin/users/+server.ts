// POST /api/admin/users — Create a new user (admin only).
// Used by the admin panel to add accounts in both open and invite modes.

import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || locals.user.role !== 'admin') throw error(403, 'Admin only');

	const body = await request.json();
	const username = body.username?.toString().trim();
	const password = body.password?.toString();

	if (!username || !password) {
		throw error(400, 'Username and password are required.');
	}
	if (username.length < 3 || username.length > 30) {
		throw error(400, 'Username must be 3–30 characters.');
	}
	if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
		throw error(400, 'Username may only contain letters, numbers, hyphens, and underscores.');
	}
	if (password.length < 8) {
		throw error(400, 'Password must be at least 8 characters.');
	}

	// Check uniqueness
	const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.username, username));
	if (existing) {
		throw error(409, 'That username is already taken.');
	}

	const passwordHash = await bcrypt.hash(password, 10);
	const [newUser] = await db
		.insert(user)
		.values({
			username,
			passwordHash,
			role: 'user',
			enabled: true,
			createdAt: new Date()
		})
		.returning({
			id: user.id,
			username: user.username,
			role: user.role,
			enabled: user.enabled,
			createdAt: user.createdAt
		});

	return json(newUser, { status: 201 });
};
