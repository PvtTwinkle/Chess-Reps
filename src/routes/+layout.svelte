<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';
	import RepertoireSelector from '$lib/components/RepertoireSelector.svelte';

	// `data` comes from +layout.server.ts and includes `user`, `repertoires`,
	// and `activeRepertoireId`.
	// `children` is the content of the current page — rendered with {@render children()}.
	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// Mobile hamburger menu state
	let mobileMenuOpen = $state(false);

	// Navigation link definitions — Admin link only shown for admin users.
	const navLinks = $derived([
		{ href: `${base}/`, label: 'Dashboard' },
		{ href: `${base}/build`, label: 'Build' },
		{ href: `${base}/drill`, label: 'Drill' },
		{ href: `${base}/puzzles`, label: 'Puzzles' },
		{ href: `${base}/review`, label: 'Review' },
		{ href: `${base}/settings`, label: 'Settings' },
		...(data.user?.role === 'admin' ? [{ href: `${base}/admin`, label: 'Admin' }] : [])
	]);

	// Determine if a nav link is the active page.
	// Dashboard matches exact "/", others match by prefix.
	function isActive(href: string): boolean {
		const path = $page.url.pathname;
		if (href === `${base}/`) return path === `${base}/` || path === base;
		return path.startsWith(href);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!--
	Only show the nav bar when the user is logged in.
	On the /login page, data.user is null so the nav is hidden.
-->
{#if data.user}
	<header class="app-header">
		<a href="{base}/" class="brand">
			<!-- Knight SVG glyph -->
			<svg class="brand-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M19 22H5v-2h14v2M13 2c-1.25 0-2.42.62-3.11 1.66L7 8l2 2 2.1-2.81a1 1 0 0 1 1.34-.28c.48.3.63.94.33 1.42L10.5 12H7.5c-.28 0-.5.22-.5.5v2c0 .28.22.5.5.5h5.1l-1.1 5h3l1.5-5.34c.5-1.76.16-3.62-.9-5.16l.9-1.5c1 .75 1.6 1.94 1.6 3.2V14h2V11.3c0-2.35-1.1-4.55-2.94-5.97L18 3.66C17.03 2.63 15.58 2 14 2h-1Z"/>
			</svg>
			<span class="brand-text">Chess Reps</span>
		</a>

		<!-- Desktop nav links -->
		<nav class="nav-links">
			{#each navLinks as link (link.href)}
				<a
					href={link.href}
					class="nav-link"
					class:active={isActive(link.href)}
					aria-current={isActive(link.href) ? 'page' : undefined}
				>{link.label}</a>
			{/each}
		</nav>

		<!-- Repertoire selector between nav and user area -->
		<RepertoireSelector
			repertoires={data.repertoires}
			activeRepertoireId={data.activeRepertoireId}
		/>

		<!-- Sign-out (POST form prevents CSRF via crafted URL) -->
		<form method="POST" action="/api/auth/logout" class="signout-form">
			<span class="username">{data.user.username}</span>
			<button type="submit" class="signout-btn">Sign out</button>
		</form>

		<!-- Mobile hamburger toggle -->
		<button
			class="hamburger"
			onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			aria-label="Toggle navigation menu"
			aria-expanded={mobileMenuOpen}
		>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
		</button>
	</header>

	<!-- Mobile slide-down drawer -->
	{#if mobileMenuOpen}
		<nav class="mobile-drawer">
			{#each navLinks as link (link.href)}
				<a
					href={link.href}
					class="mobile-link"
					class:active={isActive(link.href)}
					aria-current={isActive(link.href) ? 'page' : undefined}
					onclick={() => (mobileMenuOpen = false)}
				>{link.label}</a>
			{/each}
		</nav>
	{/if}
{/if}

<main class="app-main">
	{@render children()}
</main>

<style>
	@import '$lib/styles/tokens.css';

	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		background: var(--color-base);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(::selection) {
		background: var(--color-gold);
		color: var(--color-base);
	}

	:global(:focus-visible) {
		outline: 2px solid var(--color-gold);
		outline-offset: 2px;
	}

	/* Scrollbar styling for Webkit browsers */
	:global(::-webkit-scrollbar) {
		width: 6px;
		height: 6px;
	}

	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(::-webkit-scrollbar-thumb) {
		background: var(--color-border);
		border-radius: 3px;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: var(--color-text-muted);
	}

	/* Respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		:global(*) {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
		}
	}

	/* Page entry animation */
	@keyframes -global-fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ── Fixed top bar ─────────────────────────────────────────────────── */

	.app-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 900;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: 0 var(--space-6);
		height: 56px;
		background: rgba(26, 26, 46, 0.85);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--color-border);
	}

	/* ── Brand ─────────────────────────────────────────────────────────── */

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.brand-icon {
		width: 22px;
		height: 22px;
		color: var(--color-gold);
	}

	.brand-text {
		font-family: var(--font-display);
		font-size: 1.15rem;
		color: var(--color-text-primary);
		letter-spacing: 0.01em;
	}

	/* ── Desktop nav links ─────────────────────────────────────────────── */

	.nav-links {
		display: flex;
		gap: var(--space-1);
		flex: 1;
	}

	.nav-link {
		position: relative;
		color: var(--color-text-secondary);
		text-decoration: none;
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition: color var(--dur-fast) var(--ease-snap);
	}

	.nav-link:hover {
		color: var(--color-text-primary);
	}

	/* Gold underline on active link */
	.nav-link.active {
		color: var(--color-gold);
	}

	.nav-link.active::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: var(--space-3);
		right: var(--space-3);
		height: 2px;
		background: var(--color-gold);
		border-radius: 1px;
		animation: navUnderline var(--dur-base) var(--ease-snap);
	}

	@keyframes navUnderline {
		from { transform: scaleX(0); }
		to { transform: scaleX(1); }
	}

	/* ── Right side: user area ────────────────────────────────────────── */

	.signout-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-shrink: 0;
	}

	.username {
		font-size: 12px;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.signout-btn {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) var(--ease-snap),
			color var(--dur-fast) var(--ease-snap);
	}

	.signout-btn:hover {
		border-color: var(--color-gold-dim);
		color: var(--color-gold);
	}

	/* ── Hamburger (mobile only) ──────────────────────────────────────── */

	.hamburger {
		display: none;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		width: 36px;
		height: 36px;
		padding: 8px;
		background: none;
		border: none;
		cursor: pointer;
		margin-left: auto;
	}

	.hamburger-line {
		display: block;
		width: 100%;
		height: 2px;
		background: var(--color-text-secondary);
		border-radius: 1px;
		transition: transform var(--dur-fast) var(--ease-snap),
			opacity var(--dur-fast) var(--ease-snap);
	}

	.hamburger-line.open:nth-child(1) {
		transform: rotate(45deg) translate(4px, 4px);
	}

	.hamburger-line.open:nth-child(2) {
		opacity: 0;
	}

	.hamburger-line.open:nth-child(3) {
		transform: rotate(-45deg) translate(4px, -4px);
	}

	/* ── Mobile drawer ────────────────────────────────────────────────── */

	.mobile-drawer {
		display: none;
		position: fixed;
		top: 56px;
		left: 0;
		right: 0;
		z-index: 899;
		flex-direction: column;
		background: rgba(26, 26, 46, 0.95);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-2) 0;
		animation: drawerSlide var(--dur-base) var(--ease-snap);
	}

	@keyframes drawerSlide {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.mobile-link {
		display: block;
		padding: var(--space-3) var(--space-6);
		color: var(--color-text-secondary);
		text-decoration: none;
		font-size: 14px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition: color var(--dur-fast) var(--ease-snap),
			background var(--dur-fast) var(--ease-snap);
	}

	.mobile-link:hover {
		color: var(--color-text-primary);
		background: var(--color-surface-alt);
	}

	.mobile-link.active {
		color: var(--color-gold);
		border-left: 2px solid var(--color-gold);
	}

	/* ── Main content area ────────────────────────────────────────────── */

	.app-main {
		max-width: 1200px;
		margin: 0 auto;
		padding: var(--space-6);
		padding-top: calc(56px + var(--space-6));
		animation: fadeSlideIn var(--dur-base) var(--ease-snap);
	}

	/* ── Responsive ───────────────────────────────────────────────────── */

	@media (max-width: 768px) {
		.nav-links {
			display: none;
		}

		.signout-form {
			display: none;
		}

		.hamburger {
			display: flex;
		}

		.mobile-drawer {
			display: flex;
		}

		.app-main {
			padding: var(--space-4);
			padding-top: calc(56px + var(--space-4));
		}
	}
</style>
