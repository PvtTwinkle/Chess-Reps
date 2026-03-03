// SvelteKit server hooks — middleware that runs on every request.
//
// The `handle` function here is the gatekeeper for the entire app.
// It runs before any page or API route does, giving us a single place
// to enforce authentication across every route.
//
// What it does on each request:
//   1. Sets locals.user to null (unauthenticated by default)
//   2. Reads the session cookie from the browser
//   3. If a valid session cookie exists, looks it up in the database
//   4. If the session is valid, attaches the user to locals.user
//   5. If the user is not authenticated and the route requires auth, redirects to /login
//   6. If the user IS authenticated and is trying to visit /login, redirects to /

import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { validateSession, SESSION_COOKIE_NAME } from '$lib/auth';
import { db, dbReady } from '$lib/db';
import { user } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// Routes that anyone can access without being logged in.
// Everything not on this list requires a valid session.
const PUBLIC_ROUTES = [
	'/login', // the login form itself
	'/api/health' // monitoring endpoint — must be publicly accessible
];

// Ensure the database is fully initialised (migrations + default user)
// before we handle any requests. This awaits the promise exported from db/index.ts.
await dbReady;

export const handle: Handle = async ({ event, resolve }) => {
	// Start every request as unauthenticated. We will upgrade this below
	// if we find a valid session cookie.
	event.locals.user = null;

	// Read the session cookie. This is the random UUID token we set at login.
	const token = event.cookies.get(SESSION_COOKIE_NAME);

	if (token) {
		// Look up the token in the session table.
		const sessionData = await validateSession(token);

		if (sessionData) {
			// Session is valid — fetch the user record so we have the username.
			const [foundUser] = await db
				.select({ id: user.id, username: user.username })
				.from(user)
				.where(eq(user.id, sessionData.userId));

			if (foundUser) {
				event.locals.user = foundUser;
			}
		} else {
			// The token exists in the browser but is not valid (expired or deleted).
			// Clear the stale cookie so the browser stops sending it on every request.
			event.cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
		}
	}

	const { pathname } = event.url;

	// Check if this route is public (no auth required).
	// The startsWith check handles sub-paths, e.g. /api/health/details.
	const isPublicRoute = PUBLIC_ROUTES.some(
		(route) => pathname === route || pathname.startsWith(route + '/')
	);

	// Unauthenticated user trying to access a protected route → send to login.
	if (!event.locals.user && !isPublicRoute) {
		redirect(302, '/login');
	}

	// Authenticated user trying to visit /login → send to dashboard.
	// This prevents the login page showing to someone already logged in.
	if (event.locals.user && pathname === '/login') {
		redirect(302, '/');
	}

	// All checks passed — continue to the actual page or API handler.
	return resolve(event);
};
