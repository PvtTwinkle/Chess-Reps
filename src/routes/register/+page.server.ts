// Server-side logic for the registration page.
//
// Only accessible when REGISTRATION_MODE=open.
// Creates a new user with role='user', creates a session, and redirects to the dashboard.
// Includes basic rate limiting to prevent registration abuse.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { createSession, SESSION_COOKIE_NAME } from '$lib/auth';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

// Simple in-memory rate limiter: max 5 registrations per hour per IP.
// Resets on server restart — fine for a self-hosted app.
const registrationAttempts = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const entry = registrationAttempts.get(ip);
	if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
		registrationAttempts.set(ip, { count: 1, windowStart: now });
		return false;
	}
	if (entry.count >= RATE_LIMIT_MAX) return true;
	entry.count++;
	return false;
}

export const load: PageServerLoad = async () => {
	if (REGISTRATION_MODE !== 'open') {
		error(404, 'Registration is not available');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		if (REGISTRATION_MODE !== 'open') {
			error(404, 'Registration is not available');
		}

		const ip = getClientAddress();
		if (isRateLimited(ip)) {
			return fail(429, { error: 'Too many registration attempts. Please try again later.' });
		}

		const formData = await request.formData();
		const username = formData.get('username')?.toString().trim();
		const password = formData.get('password')?.toString();
		const confirmPassword = formData.get('confirmPassword')?.toString();

		// Validation
		if (!username || !password) {
			return fail(400, { error: 'Username and password are required.' });
		}
		if (username.length < 3 || username.length > 30) {
			return fail(400, { error: 'Username must be 3–30 characters.' });
		}
		if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
			return fail(400, {
				error: 'Username may only contain letters, numbers, hyphens, and underscores.'
			});
		}
		if (password.length < 8) {
			return fail(400, { error: 'Password must be at least 8 characters.' });
		}
		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		// Check for duplicate username
		const [existing] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.username, username));
		if (existing) {
			return fail(400, { error: 'That username is already taken.' });
		}

		// Create user
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
			.returning({ id: user.id });

		// Create session and set cookie
		const token = await createSession(newUser.id);
		const secureCookies = process.env.SECURE_COOKIES === 'true';
		cookies.set(SESSION_COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: secureCookies,
			maxAge: 60 * 60 * 24 * 30
		});

		redirect(303, '/');
	}
};
