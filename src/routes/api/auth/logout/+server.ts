// Logout endpoint — POST /api/auth/logout
//
// Accepts a POST request (from the sign-out form in the layout).
// Deletes the session from the database and clears the cookie.
// Redirects to /login.
//
// Why POST and not GET?
// Using GET for logout is a security anti-pattern. If logout were a plain link
// (GET request), any website could embed an <img src="/api/auth/logout"> and
// silently log you out when you visit their page. POST requires a form
// submission, which SameSite cookies already protect against cross-site use.

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession, SESSION_COOKIE_NAME, SECURE_COOKIE } from '$lib/auth';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE_NAME);

	if (token) {
		// Remove the session from the database so the token is immediately invalid.
		await deleteSession(token);

		// Tell the browser to delete the cookie by clearing it.
		// The path: '/' must match the path used when the cookie was set.
		cookies.delete(SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE });
	}

	// Send the user to the login page.
	redirect(303, '/login');
};
