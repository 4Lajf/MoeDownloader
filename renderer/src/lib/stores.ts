import { writable } from 'svelte/store';

// Page routing state
export const page = writable('home');
export const overlay = writable('none');
export const view = writable(null);

// Application state
export const isInitialized = writable(false);
export const initError = writable(null);

// RSS monitoring state
export const isRSSMonitoring = writable(false);

// Download state
export const activeDownloads = writable<any[]>([]);
export const recentDownloads = writable<any[]>([]);

// Stats
export const stats = writable({
	whitelistCount: 0,
	totalDownloads: 0,
	activeDownloads: 0,
	completedDownloads: 0,
	failedDownloads: 0,
	processedEntries: 0
});

// Navigation history management
let ignoreNext = false;

function addPage(value: string, type: 'page' | 'view' | 'overlay') {
	if (ignoreNext) {
		ignoreNext = false;
		return;
	}
	history.pushState(
		{ type, value },
		'',
		location.origin + location.pathname + '?id=' + Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString()
	);
}

// Subscribe to page changes for history management
page.subscribe((value) => {
	addPage(value, 'page');
});

view.subscribe((value) => {
	if (value) addPage(value, 'view');
});

overlay.subscribe((value) => {
	if (value && value !== 'none') addPage(value, 'overlay');
});

// Handle browser back/forward navigation
if (typeof window !== 'undefined') {
	window.addEventListener('popstate', (e) => {
		const { state } = e;
		if (!state) return;
		
		ignoreNext = true;
		
		// Reset overlays and views when navigating back
		view.set(null);
		overlay.set('none');
		
		// Exit fullscreen if active
		if (document.fullscreenElement) {
			document.exitFullscreen();
			if (state.type === 'view') page.set('home');
		}
		
		// Set the appropriate state based on history
		if (state.type === 'page') {
			page.set(state.value);
		} else if (state.type === 'view') {
			view.set(state.value);
		} else if (state.type === 'overlay') {
			overlay.set(state.value);
		}
	});
	
	// Initialize with home page
	addPage('home', 'page');
}
