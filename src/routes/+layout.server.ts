// Layout server load function.
//
// Runs on every request before the layout renders. Returns data that is
// available to +layout.svelte and (via inheritance) to every child page.
//
// We use this to pass four things into every page:
//   user              — who is logged in (or null on /login)
//   repertoires       — the full list of this user's repertoires
//   activeRepertoireId — which repertoire is currently selected (from cookie)
//   settings          — user preferences (board theme, sound, engine depth, etc.)
//
// The repertoires list powers the RepertoireSelector in the nav bar.
// The activeRepertoireId will be used by build/drill to scope data.
// Settings are loaded once here instead of per-page so every ChessBoard
// consumer can access the board theme without duplicating the query.

import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { repertoire, userSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const load: LayoutServerLoad = ({ locals, cookies }) => {
	// When the user is not logged in (e.g. the /login page), return early
	// with empty values so the nav doesn't try to render repertoire data.
	if (!locals.user) {
		return { user: null, repertoires: [], activeRepertoireId: null, settings: null };
	}

	// Fetch all repertoires for this user, oldest first.
	const repertoires = db
		.select()
		.from(repertoire)
		.where(eq(repertoire.userId, locals.user.id))
		.orderBy(repertoire.createdAt)
		.all();

	// The active repertoire ID is persisted in a cookie so it survives
	// navigation between pages without any extra server-side state.
	let activeRepertoireId: number | null = null;

	const cookieValue = cookies.get('active_repertoire_id');
	if (cookieValue) {
		const parsed = parseInt(cookieValue);
		// Only accept the cookie value if it points to a repertoire that still
		// exists and belongs to this user (handles the "deleted while cookie
		// was set" case).
		if (!isNaN(parsed) && repertoires.some((r) => r.id === parsed)) {
			activeRepertoireId = parsed;
		}
	}

	// If no valid active repertoire is set (first visit, or the previously
	// active one was deleted), default to the first in the list.
	if (activeRepertoireId === null && repertoires.length > 0) {
		activeRepertoireId = repertoires[0].id;
	}

	// User settings (board theme, sound, engine depth, etc.).
	// Returns null if the user has never changed any setting — consumers
	// fall back to defaults in that case.
	const settings = db
		.select()
		.from(userSettings)
		.where(eq(userSettings.userId, locals.user.id))
		.get();

	return {
		user: locals.user,
		repertoires,
		activeRepertoireId,
		settings: settings ?? null
	};
};
