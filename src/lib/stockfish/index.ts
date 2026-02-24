// Stockfish UCI wrapper — connects to the Stockfish sidecar over TCP.
//
// Stockfish speaks the UCI (Universal Chess Interface) protocol over
// stdin/stdout. In Docker, a socat process bridges a TCP port to Stockfish's
// stdio, so each TCP connection gets a fresh, dedicated Stockfish process.
//
// Analysis flow per request:
//   1. Open a TCP socket to stockfish:3001
//   2. Send "uci" and "setoption name MultiPV value N" then "isready"
//   3. Wait for "readyok", then send "position fen <fen>" and "go depth <d>"
//   4. Collect "info" lines — each carries a candidate move and its score
//   5. When "bestmove" arrives, close the socket and return the results
//
// If the engine is unreachable (e.g. running `npm run dev` outside Docker),
// getTopMoves returns [] instead of throwing so the app degrades gracefully.

import * as net from 'net';

const STOCKFISH_HOST = process.env.STOCKFISH_HOST ?? 'stockfish';
const STOCKFISH_PORT = parseInt(process.env.STOCKFISH_PORT ?? '3001', 10);

// How long we wait before giving up on an analysis request.
// Depth 15 typically finishes in 1–3 seconds; 10 s is a generous safety net.
const ANALYSIS_TIMEOUT_MS = 10_000;

export interface StockfishMove {
	// The move in UCI notation: from-square + to-square + optional promotion piece.
	// e.g. "e2e4", "g1f3", "e7e8q" (pawn promotes to queen)
	uci: string;

	// Evaluation in centipawns from the CURRENT SIDE TO MOVE's perspective.
	// Positive = good for the side to move. null when the engine returns a
	// mate score instead.
	scoreCp: number | null;

	// Moves to mate, from the CURRENT SIDE TO MOVE's perspective.
	// Positive = the side to move is delivering mate.
	// null when the engine returns a centipawn score instead.
	scoreMate: number | null;
}

// Asks Stockfish to analyse a position and return its top candidate moves.
//
// fen      — position to analyse, in FEN notation
// depth    — search depth in half-moves (higher = stronger but slower)
// numMoves — how many candidates to return (controls the MultiPV setting)
//
// Returns [] without throwing if the engine is unavailable.
export async function getTopMoves(
	fen: string,
	depth: number,
	numMoves: number
): Promise<StockfishMove[]> {
	return new Promise((resolve) => {
		// bestResults maps MultiPV index (1-based) → latest result for that PV.
		// We overwrite on every new "info" line so we always keep the deepest result.
		const bestResults = new Map<number, StockfishMove>();
		let buffer = '';

		const socket = new net.Socket();

		// Tear down the socket and resolve with whatever results we have so far.
		const finish = () => {
			clearTimeout(timer);
			socket.destroy();
			const sorted = [...bestResults.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
			resolve(sorted);
		};

		// Safety net: if analysis takes too long, return partial results rather
		// than hanging the request indefinitely.
		const timer = setTimeout(finish, ANALYSIS_TIMEOUT_MS);

		socket.on('connect', () => {
			// UCI handshake. "uci" puts Stockfish in UCI mode. We set MultiPV before
			// "isready" so the option is in place before analysis begins.
			socket.write(`uci\n`);
			socket.write(`setoption name MultiPV value ${numMoves}\n`);
			socket.write(`isready\n`);
		});

		socket.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();

			// Split on newlines. lines.pop() removes the last (potentially incomplete)
			// line and puts it back in the buffer for the next data event.
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				if (line.startsWith('readyok')) {
					// Engine is warmed up — send the position and kick off analysis.
					socket.write(`position fen ${fen}\n`);
					socket.write(`go depth ${depth}\n`);
				} else if (line.startsWith('info') && line.includes('multipv') && line.includes(' pv ')) {
					// Example "info" line:
					//   info depth 15 seldepth 22 multipv 1 score cp 45 nodes 1234 pv e2e4 e7e5 ...
					//   info depth 12 seldepth 14 multipv 2 score mate 3 nodes 5678 pv d1h5 ...
					//
					// We extract: multipv index, score (cp or mate), first move of the pv.
					const multipvMatch = line.match(/multipv (\d+)/);
					const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
					if (!multipvMatch || !pvMatch) continue;

					const pvIdx = parseInt(multipvMatch[1], 10);
					const uci = pvMatch[1];

					const cpMatch = line.match(/score cp (-?\d+)/);
					const mateMatch = line.match(/score mate (-?\d+)/);

					bestResults.set(pvIdx, {
						uci,
						scoreCp: cpMatch ? parseInt(cpMatch[1], 10) : null,
						scoreMate: mateMatch ? parseInt(mateMatch[1], 10) : null
					});
				} else if (line.startsWith('bestmove')) {
					// "bestmove" signals that Stockfish has finished. Return what we have.
					finish();
				}
			}
		});

		// If the engine sidecar is not running (e.g. in local dev mode without
		// Docker), resolve with an empty array instead of letting the request hang
		// or throw an unhandled error.
		socket.on('error', () => resolve([]));

		socket.connect(STOCKFISH_PORT, STOCKFISH_HOST);
	});
}
