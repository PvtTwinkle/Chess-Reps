// Shared time-window-to-timestamp conversion for opponent prep endpoints.

const MS_PER_DAY = 86_400_000;

const WINDOW_MS: Record<string, number> = {
	'1m': 30 * MS_PER_DAY,
	'3m': 90 * MS_PER_DAY,
	'6m': 180 * MS_PER_DAY,
	'1y': 365 * MS_PER_DAY
};

/** Convert a time window code to a Unix timestamp (ms) for the "since" parameter. */
export function timeWindowToSince(timeWindow: string | undefined): number | undefined {
	if (!timeWindow || timeWindow === 'all') return undefined;
	const ms = WINDOW_MS[timeWindow];
	if (!ms) return undefined;
	return Date.now() - ms;
}
