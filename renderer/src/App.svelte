<script lang="ts">
	import './app.css';
	import { onMount } from 'svelte';
	import { page, isInitialized, initError, loadingState, setLoadingMessage, hideLoading, theme, setTheme, getSystemTheme } from '$lib/stores';
	import Navigation from '$lib/components/Navigation.svelte';
	import Router from '$lib/components/Router.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import LoadingScreen from '$lib/components/LoadingScreen.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';
	import ipc from './ipc';

	let currentPage = $state('home');
	let currentOverlay = $state('none');
	let initialized = $state(false);
	let error = $state(null);
	let loading = $state({ isLoading: true, message: 'Loading MoeDownloader...' });

	// Subscribe to stores
	page.subscribe(value => currentPage = value);
	isInitialized.subscribe(value => initialized = value);
	initError.subscribe(value => error = value);
	loadingState.subscribe(value => loading = value);

	onMount(async () => {
		const loadingStartTime = Date.now();
		const minimumLoadingTime = 3000; // 3 seconds minimum

		try {
			// Initialize theme first (before any UI is shown)
			try {
				const settings = await ipc.getSettings();
				let themeToUse: 'light' | 'dark';

				if (settings.theme) {
					// Use saved theme preference
					themeToUse = settings.theme as 'light' | 'dark';
				} else {
					// No saved preference, detect system theme with dark as fallback
					themeToUse = getSystemTheme();
				}

				setTheme(themeToUse);
			} catch (error) {
				console.warn('Failed to load theme setting, using system theme with dark fallback:', error);
				setTheme(getSystemTheme()); // Use system theme with dark fallback
			}

			// Show initial loading state immediately
			setLoadingMessage('Starting MoeDownloader...');

			// Small delay to ensure loading screen is visible
			await new Promise(resolve => setTimeout(resolve, 200));

			setLoadingMessage('Initializing database...');

			// Initialize the app
			await ipc.initializeApp();

			setLoadingMessage('Setting up services...');

			// Set up notification listeners
			setupNotificationListeners();

			setLoadingMessage('Loading components...');

			// Simulate some additional loading time for better UX
			await new Promise(resolve => setTimeout(resolve, 400));

			setLoadingMessage('Finalizing setup...');

			await new Promise(resolve => setTimeout(resolve, 300));

			setLoadingMessage('Almost ready...');

			// Calculate remaining time to meet minimum loading duration
			const elapsedTime = Date.now() - loadingStartTime;
			const remainingTime = Math.max(0, minimumLoadingTime - elapsedTime);

			if (remainingTime > 0) {
				// Wait for the remaining time while showing "Almost ready..."
				await new Promise(resolve => setTimeout(resolve, remainingTime));
			}

			console.log('Svelte app: Ready - hiding loader');
			// Hide loading screen and show app immediately
			hideLoading();
			isInitialized.set(true);

			// Ensure window is visible
			try {
				await ipc.windowShow();
			} catch (err) {
				console.warn('Failed to show window:', err);
			}

			// Close the loader window now that we're fully ready
			try {
				await ipc.closeLoader();
			} catch (err) {
				console.warn('Failed to close loader window:', err);
			}

			// Show welcome notification after loading is complete
			setTimeout(() => {
				toast.success('MoeDownloader initialized', {
					description: 'Application is ready to use.',
					duration: 4000
				});
			}, 500);

		} catch (err: any) {
			console.error('Failed to initialize app:', err);

			// Still respect minimum loading time even on error
			const elapsedTime = Date.now() - loadingStartTime;
			const remainingTime = Math.max(0, minimumLoadingTime - elapsedTime);

			if (remainingTime > 0) {
				await new Promise(resolve => setTimeout(resolve, remainingTime));
			}

			hideLoading();
			initError.set(err?.message || 'Failed to initialize application');

			toast.error('Initialization failed', {
				description: `Failed to initialize MoeDownloader: ${err?.message || 'Unknown error'}`,
				duration: 8000
			});
		}
	});

	function setupNotificationListeners() {
		// Listen for app notifications from the backend
		if (window.bridge && window.bridge.onAppNotification) {
			window.bridge.onAppNotification((notification: any) => {
				const { type, data } = notification;

				switch (type) {
					case 'download-completed':
						toast.success('Download completed', {
							description: `${data.title} has finished downloading.`,
							duration: 5000,
							action: {
								label: 'Open folder',
								onClick: () => ipc.openFolder(data.filePath)
							}
						});
						break;

					case 'download-failed':
						toast.error('Download failed', {
							description: `${data.title} failed to download: ${data.error}`,
							duration: 6000
						});
						break;

					case 'download-started':
						toast.info('Download started', {
							description: `Started downloading ${data.title}.`,
							duration: 3000
						});
						break;

					case 'download-paused':
						toast.warning('Download paused', {
							description: `${data.title} has been paused.`,
							duration: 3000
						});
						break;

					case 'download-resumed':
						toast.info('Download resumed', {
							description: `${data.title} has been resumed.`,
							duration: 3000
						});
						break;

					case 'rss-processed':
						if (data.newEntries > 0) {
							toast.success('RSS feed processed', {
								description: `Found ${data.newEntries} new episodes.`,
								duration: 4000
							});
						}
						break;

					case 'new-episode-found':
						toast.info('New episode available', {
							description: `${data.title} - Episode ${data.episode} is now available.`,
							duration: 5000
						});
						break;

					default:
						console.log('Unknown notification type:', type, data);
				}
			});
		}
	}
</script>

{#if loading.isLoading}
	<LoadingScreen />
{:else}
	<div class="min-h-screen bg-background">
		<TitleBar />
		{#if error}
			<div class="flex items-center justify-center" style="height: calc(100vh - 2rem);">
				<div class="text-center">
					<h1 class="text-2xl font-bold text-destructive mb-4">Initialization Error</h1>
					<p class="text-muted-foreground">{error}</p>
				</div>
			</div>
		{:else if !initialized}
			<div class="flex items-center justify-center" style="height: calc(100vh - 2rem);">
				<div class="text-center">
					<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
					<p class="text-muted-foreground">Initializing MoeDownloader...</p>
				</div>
			</div>
		{:else}
			<div class="flex" style="height: calc(100vh - 2rem);">
				<Navigation />
				<main class="flex-1 overflow-auto">
					<Router bind:currentPage bind:currentOverlay />
				</main>
			</div>
		{/if}
		<Toaster richColors />
	</div>
{/if}
