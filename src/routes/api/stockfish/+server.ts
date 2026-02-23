import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// TODO: implement Stockfish proxy (Docker step)
export const POST: RequestHandler = () => {
	return json({ message: 'stockfish endpoint — not yet implemented' }, { status: 501 });
};
