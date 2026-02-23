// Type declarations for SvelteKit's built-in interfaces.
//
// These are not imported anywhere — SvelteKit reads this file automatically
// and uses the types globally across the entire app.

declare global {
	namespace App {
		// `locals` is an object that lives for the duration of a single HTTP request.
		// The middleware (hooks.server.ts) sets `locals.user` after checking the session
		// cookie. Every +page.server.ts and +server.ts can then read `locals.user`
		// without touching the database again.
		//
		// null means the request is unauthenticated.
		interface Locals {
			user: { id: number; username: string } | null;
		}
	}
}

export {};
