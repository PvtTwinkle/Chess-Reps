// Dashboard page server load.
//
// The layout's +layout.server.ts already fetches the user's repertoires list
// on every request. Rather than querying the database a second time, we call
// parent() here to get that data and pass the repertoires array into the page.
//
// The dashboard uses this to decide whether to show the onboarding welcome
// screen (0 repertoires) or the normal dashboard content (1+ repertoires).

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	// parent() runs the layout's load function and returns its result.
	// We get { user, repertoires, activeRepertoireId } for free — no extra DB call.
	const { repertoires } = await parent();

	return { repertoires };
};
