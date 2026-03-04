// Server-side logic for the login page.
//
// In SvelteKit, "actions" are functions that handle form submissions.
// When the user fills in the login form and clicks "Sign in", the browser
// sends a POST request here. This code runs on the server — never in the browser.
//
// If login succeeds: create a session, set a cookie, redirect to dashboard.
// If login fails:    return an error message that the page can display.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { createSession, SESSION_COOKIE_NAME } from '$lib/auth';

const REGISTRATION_MODE = process.env.REGISTRATION_MODE ?? 'invite';

export const load: PageServerLoad = async () => {
	return { registrationOpen: REGISTRATION_MODE === 'open' };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		// Read the values the user typed into the form.
		const formData = await request.formData();
		const username = formData.get('username')?.toString().trim();
		const password = formData.get('password')?.toString();

		// Basic presence check — both fields must be filled in.
		if (!username || !password) {
			return fail(400, { error: 'Username and password are required.' });
		}

		// Look up the user by username.
		const [foundUser] = await db.select().from(user).where(eq(user.username, username));

		// We use the same error message whether the username is wrong or the password
		// is wrong. This is intentional — telling an attacker which one is wrong
		// helps them narrow down valid usernames, which is a security risk.
		if (!foundUser || !(await bcrypt.compare(password, foundUser.passwordHash))) {
			return fail(400, { error: 'Invalid username or password.' });
		}

		// Account disabled by admin — specific message since the user already knows their username.
		if (!foundUser.enabled) {
			return fail(403, { error: 'This account has been disabled.' });
		}

		// Credentials are correct. Create a session in the database.
		// createSession() returns the random UUID token to put in the cookie.
		const token = await createSession(foundUser.id);

		// Set the session cookie in the browser.
		//
		// httpOnly: true  — JavaScript on the page cannot read this cookie.
		//                   Protects against XSS attacks that try to steal tokens.
		// sameSite: 'lax' — Cookie is not sent with cross-site requests.
		//                   Protects against CSRF attacks from other websites.
		// path: '/'       — Cookie applies to all routes, not just /login.
		// secure           — Controlled by SECURE_COOKIES env var. Set to true in
		//                   production when accessed over HTTPS. Leave false (default)
		//                   when Nginx handles HTTPS termination and the app receives
		//                   plain HTTP internally.
		// maxAge: 30 days — How long the cookie lives in the browser.
		const secureCookies = process.env.SECURE_COOKIES === 'true';
		cookies.set(SESSION_COOKIE_NAME, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: secureCookies,
			maxAge: 60 * 60 * 24 * 30 // 30 days in seconds
		});

		// Redirect to the dashboard. The browser follows this automatically.
		// The 303 status tells the browser to use GET for the redirect
		// (important after a POST — prevents "resubmit form?" warnings on refresh).
		redirect(303, '/');
	}
};
