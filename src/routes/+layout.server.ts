// Layout server load function.
//
// Runs on every request before the layout renders. Returns data that is
// available to +layout.svelte and (via inheritance) to every child page.
//
// We use this to pass three things into every page:
//   user              — who is logged in (or null on /login)
//   repertoires       — the full list of this user's repertoires
//   activeRepertoireId — which repertoire is currently selected (from cookie)
//
// The repertoires list powers the RepertoireSelector in the nav bar.
// The activeRepertoireId will be used by build/drill/explorer to scope data.

import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { repertoire } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const load: LayoutServerLoad = ({ locals, cookies }) => {
	// When the user is not logged in (e.g. the /login page), return early
	// with empty values so the nav doesn't try to render repertoire data.
	if (!locals.user) {
		return { user: null, repertoires: [], activeRepertoireId: null };
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

	return {
		user: locals.user,
		repertoires,
		activeRepertoireId
	};
};
