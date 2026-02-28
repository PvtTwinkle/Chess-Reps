/**
 * Browser utilities for downloading files and copying to clipboard.
 */

/** Trigger a file download with the given text content. */
export function downloadTextFile(
	content: string,
	filename: string,
	mimeType = 'application/x-chess-pgn'
): void {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** Copy text to the clipboard. Returns true on success, false on failure. */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
