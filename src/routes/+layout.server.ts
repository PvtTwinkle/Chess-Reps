// Layout server load function.
//
// In SvelteKit, every +layout.server.ts `load` function runs on the server
// before the layout renders. Whatever it returns becomes the `data` prop
// available in +layout.svelte.
//
// We use this to pass the currently logged-in user (from locals, set by
// hooks.server.ts) into the layout template. This lets the nav bar show
// the username and the sign-out button without any extra database queries.

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	// locals.user is set by hooks.server.ts. It is either:
	//   { id: number; username: string }  — logged in
	//   null                              — not logged in (only possible on /login)
	return {
		user: locals.user
	};
};
