// Tutorial step definitions.
//
// Each step describes what the user sees and how they advance.
// Steps with autoAdvance = true are advanced by page-level code
// (e.g. after moves are played or cards are graded), not by a button.

export interface TutorialStepDef {
	page: string; // expected pathname prefix
	title: string;
	body: string;
	nextLabel?: string; // button text (omitted for auto-advance steps)
	navTo?: string; // if set, next/button navigates here
	autoAdvance?: boolean; // step advances by code, not by button click
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
	// Step 0 is handled by OnboardingWelcome — no overlay needed
	{
		page: '/',
		title: 'Welcome',
		body: '',
		autoAdvance: true
	},
	{
		page: '/build',
		title: 'Build Your Repertoire',
		body: 'Play moves on the board to build your repertoire. Drag a piece or click to move. Each move saves automatically. Use the suggestion tabs on the right (Book, Masters, Stars, Players, Engine) to find the best moves. Play 8 moves to continue.',
		autoAdvance: true
	},
	{
		page: '/build',
		title: 'More Build Tools',
		body: 'Switch to Explore mode to try moves without saving them. You can also import or export PGN, and use arrow keys to navigate through your lines.',
		nextLabel: 'Got it'
	},
	{
		page: '/build',
		title: "You're Off to a Great Start!",
		body: "You've built the beginning of your repertoire. Now let's practice these moves with spaced repetition.",
		nextLabel: 'Go to Drill',
		navTo: '/drill'
	},
	{
		page: '/drill',
		title: 'Drill Mode',
		body: 'The board will replay your opening line, then pause at your turn. Play the correct move from memory. After each card, grade yourself: Again, Good, or Easy. Try a few cards now!',
		autoAdvance: true
	},
	{
		page: '/drill',
		title: 'Drill Options',
		body: 'In Cards mode you can focus on Foundation, Mainlines, or Deep Lines. Switch to Lines mode to practice entire variations. Try Blindfold mode for an extra challenge.',
		nextLabel: 'Continue',
		navTo: '/puzzles'
	},
	{
		page: '/puzzles',
		title: 'Puzzle Training',
		body: 'Solve puzzles drawn from your repertoire openings. Filter further by rating, theme, or color to target specific weaknesses.',
		nextLabel: 'Continue',
		navTo: '/review'
	},
	{
		page: '/review',
		title: 'Game Review',
		body: 'Paste a PGN or import games from Lichess/Chess.com. The app shows where you or your opponent deviated from your repertoire so you can add new lines or assign training for missed moves.',
		nextLabel: 'Continue',
		navTo: '/prep'
	},
	{
		page: '/prep',
		title: 'Opponent Prep',
		body: 'Prepare for a specific opponent by entering their username (e.g. PvtTwinkleToes on Chess.com) to download their games. See what they play, prepare your responses, and export to a repertoire to drill.',
		nextLabel: 'Continue',
		navTo: '/'
	},
	{
		page: '/',
		title: 'Your Dashboard',
		body: 'Welcome to your home base. Track due cards, mastery, streaks, and your health score at a glance. Scroll down to find gaps in your repertoire and moves you keep getting wrong.',
		nextLabel: 'Finish Tutorial'
	}
];

export const TOTAL_STEPS = TUTORIAL_STEPS.length;
