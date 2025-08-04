<script lang="ts">
	import './app.css';
	import { onMount } from 'svelte';
	import { page, isInitialized, initError } from '$lib/stores';
	import Navigation from '$lib/components/Navigation.svelte';
	import Router from '$lib/components/Router.svelte';
	import TitleBar from '$lib/components/TitleBar.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';
	import ipc from './ipc';

	let currentPage = $state('home');
	let currentOverlay = $state('none');
	let initialized = $state(false);
	let error = $state(null);

	// Subscribe to stores
	page.subscribe(value => currentPage = value);
	isInitialized.subscribe(value => initialized = value);
	initError.subscribe(value => error = value);

	onMount(async () => {
		try {
			// Initialize the app
			await ipc.initializeApp();
			isInitialized.set(true);

			// Set up notification listeners
			setupNotificationListeners();

			// Show welcome notification
			setTimeout(() => {
				toast.success('MoeDownloader initialized', {
					description: 'Application is ready to use.',
					duration: 4000
				});
			}, 1000);
		} catch (err: any) {
			console.error('Failed to initialize app:', err);
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
	<Toaster richColors/>
</div>
