import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// TODO: implement repertoire management (Step 2+)
export const GET: RequestHandler = () => {
	return json({ message: 'repertoires endpoint — not yet implemented' }, { status: 501 });
};
