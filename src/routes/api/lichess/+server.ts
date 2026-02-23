import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// TODO: implement Lichess game import (later step)
export const GET: RequestHandler = () => {
	return json({ message: 'lichess endpoint — not yet implemented' }, { status: 501 });
};
