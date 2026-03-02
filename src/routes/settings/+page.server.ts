// Settings page server load.
//
// User settings come from the layout load (no duplicate query needed).
// This file exists so the page can access layout data via parent().

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { settings } = await parent();
	return { settings };
};
