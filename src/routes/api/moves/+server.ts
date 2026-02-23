import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// TODO: implement move CRUD (Step 2+)
export const GET: RequestHandler = () => {
	return json({ message: 'moves endpoint — not yet implemented' }, { status: 501 });
};
