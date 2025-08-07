<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import {
		Download,
		List,
		Rss,
		Play,
		Pause,
		CheckCircle,
		Clock,
		AlertCircle,
		Users,
		ArrowDown,
		ArrowUp,
		HardDrive,
		RefreshCw
	} from 'lucide-svelte';
	import { stats, isRSSMonitoring, recentDownloads } from '$lib/stores';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	let currentStats = $state({
		whitelistCount: 0,
		totalDownloads: 0,
		activeDownloads: 0,
		completedDownloads: 0,
		failedDownloads: 0,
		processedEntries: 0
	});

	let downloads = $state<any[]>([]);
	let activeDownloads = $state<any[]>([]);
	let rssMonitoring = $state(false);
	let rssToggleLoading = $state(false);
	let downloadDirectory = $state('');

	// Subscribe to stores
	stats.subscribe((value) => (currentStats = value));
	recentDownloads.subscribe((value) => (downloads = value));
	isRSSMonitoring.subscribe((value) => (rssMonitoring = value));

	onMount(() => {
		loadStats();
		loadRecentDownloads();
		loadActiveDownloads();
		loadDownloadDirectory();

		// Update status periodically
		const interval = setInterval(async () => {
			try {
				const status = await ipc.getAppStatus();
				isRSSMonitoring.set(status.rssScheduleActive);
				stats.set(status.stats || currentStats);

				// Also update active downloads
				await loadActiveDownloads();
			} catch (error) {
				console.error('Error getting app status:', error);
			}
		}, 2000);

		return () => clearInterval(interval);
	});

	async function loadStats() {
		try {
			const appStats = await ipc.getStats();
			stats.set(appStats);
		} catch (error) {
			console.error('Error loading stats:', error);
		}
	}

	async function loadRecentDownloads() {
		try {
			const downloads = await ipc.getRecentDownloads();
			recentDownloads.set(downloads);
		} catch (error) {
			console.error('Error loading recent downloads:', error);
		}
	}

	async function loadActiveDownloads() {
		try {
			const allDownloads = await ipc.getAllDownloads();
			activeDownloads = allDownloads.filter(
				(d: any) => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused'
			);
		} catch (error) {
			console.error('Error loading active downloads:', error);
		}
	}

	async function loadDownloadDirectory() {
		try {
			downloadDirectory = await ipc.getDownloadDirectory();
		} catch (error) {
			console.error('Error loading download directory:', error);
		}
	}

	async function toggleRSSMonitoring() {
		if (rssToggleLoading) return; // Prevent double-clicks

		try {
			rssToggleLoading = true;

			if (rssMonitoring) {
				await ipc.stopRSSMonitoring();
				toast.success('RSS monitoring stopped', {
					description: 'RSS feed monitoring has been stopped.',
					duration: 3000
				});
			} else {
				await ipc.startRSSMonitoring();
				toast.success('RSS monitoring started', {
					description: 'RSS feed monitoring is now active.',
					duration: 3000
				});
			}
		} catch (error: any) {
			console.error('Error toggling RSS monitoring:', error);
			toast.error('RSS monitoring error', {
				description: `Failed to ${rssMonitoring ? 'stop' : 'start'} RSS monitoring: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			rssToggleLoading = false;
		}
	}

	async function manualRSSCheck() {
		let loadingToast: any = null;
		try {
			loadingToast = toast.loading('Checking RSS feed...', {
				description: 'Processing RSS feed for new episodes...',
				duration: Infinity // Keep showing until we dismiss it
			});

			const result = await ipc.processRSSFeed();
			loadStats();
			loadRecentDownloads();

			toast.dismiss(loadingToast);
			toast.success('RSS check completed', {
				description: `Found ${(result as any)?.newEntries || 0} new entries.`,
				duration: 4000
			});
		} catch (error: any) {
			console.error('Manual RSS check failed:', error);

			if (loadingToast) {
				toast.dismiss(loadingToast);
			}

			// Provide user-friendly error messages
			let errorMessage = 'Unknown error occurred';
			let errorDescription = error?.message || 'Please try again later';

			if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') {
				errorMessage = 'No internet connection';
				errorDescription = 'Please check your internet connection and try again';
			} else if (error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')) {
				errorMessage = 'Request timed out';
				errorDescription = 'The RSS server is taking too long to respond. Please try again';
			} else if (error?.code === 'ECONNREFUSED') {
				errorMessage = 'Connection refused';
				errorDescription = 'The RSS server appears to be down. Please try again later';
			} else if (error?.message?.includes('Invalid RSS')) {
				errorMessage = 'Invalid RSS feed';
				errorDescription = 'The RSS feed format is invalid. Please check the RSS URL in settings';
			} else if (error?.message?.includes('404')) {
				errorMessage = 'RSS feed not found';
				errorDescription =
					'The RSS feed URL appears to be incorrect. Please check the URL in settings';
			}

			toast.error(errorMessage, {
				description: errorDescription,
				duration: 8000
			});
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'completed':
				return CheckCircle;
			case 'downloading':
				return Download;
			case 'queued':
				return Clock;
			case 'failed':
				return AlertCircle;
			default:
				return Clock;
		}
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'completed':
				return 'text-green-700 dark:text-green-300';
			case 'downloading':
				return 'text-blue-700 dark:text-blue-300';
			case 'queued':
				return 'text-amber-700 dark:text-amber-300';
			case 'failed':
				return 'text-red-700 dark:text-red-300';
			case 'paused':
				return 'text-orange-700 dark:text-orange-300';
			default:
				return 'text-gray-700 dark:text-gray-300';
		}
	}

	function getStatusBadgeVariant(status: string) {
		switch (status) {
			case 'completed':
				return 'default';
			case 'downloading':
				return 'secondary';
			case 'queued':
				return 'outline';
			case 'failed':
				return 'destructive';
			case 'paused':
				return 'secondary';
			default:
				return 'outline';
		}
	}

	function formatBytes(bytes: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	function formatSpeed(bytesPerSecond: number): string {
		if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s';
		return formatBytes(bytesPerSecond) + '/s';
	}
</script>

<div class="p-6">
	<div class="mb-6">
		<h1 class="text-3xl font-bold">Dashboard</h1>
		<p class="text-muted-foreground">Overview of your anime download activity</p>
	</div>

	<!-- Quick Actions -->
	<div class="mb-6 flex gap-4">
		<Button
			onclick={toggleRSSMonitoring}
			variant={rssMonitoring ? 'warning' : 'success'}
			disabled={rssToggleLoading}
		>
			{#if rssToggleLoading}
				<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
				{rssMonitoring ? 'Stopping...' : 'Starting...'}
			{:else if rssMonitoring}
				<Pause class="mr-2 h-4 w-4" />
				Stop Auto-Download
			{:else}
				<Play class="mr-2 h-4 w-4" />
				Start Auto-Download
			{/if}
		</Button>

		<Button onclick={manualRSSCheck} variant="outline-info">
			<Rss class="mr-2 h-4 w-4" />
			Check New Releases Now
		</Button>
	</div>

	<!-- Active Downloads Status -->
	{#if activeDownloads.length > 0}
		<Card class="mb-6">
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Download class="h-5 w-5" />
					Active Downloads ({activeDownloads.length})
				</CardTitle>
				<CardDescription>
					Currently downloading torrents
					{#if downloadDirectory}
						<span class="mt-1 block text-xs">Downloading to: {downloadDirectory}</span>
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-3">
					{#each activeDownloads as download}
						{@const StatusIcon = getStatusIcon(download.status)}
						<div class="flex items-center justify-between rounded-lg border p-3">
							<div class="flex min-w-0 flex-1 items-center gap-3">
								<StatusIcon class="h-4 w-4 {getStatusColor(download.status)}" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">
										{download.final_title || download.torrent_title}
									</p>
									{#if download.progress > 0}
										<div class="mt-1">
											<Progress value={download.progress * 100} class="h-1.5" />
											<p class="text-muted-foreground mt-1 text-xs">
												{Math.round(download.progress * 100)}% complete
											</p>
										</div>
									{/if}
								</div>
							</div>

							<div class="flex items-center gap-4 text-sm">
								{#if download.status === 'downloading'}
									<div class="flex items-center gap-3">
										<div class="flex items-center gap-1">
											<ArrowDown class="h-3 w-3 text-green-500" />
											<span class="text-xs">{formatSpeed(download.download_speed || 0)}</span>
										</div>
										<div class="flex items-center gap-1">
											<ArrowUp class="h-3 w-3 text-blue-500" />
											<span class="text-xs">{formatSpeed(download.upload_speed || 0)}</span>
										</div>
										<div class="flex items-center gap-1">
											<Users class="h-3 w-3 text-orange-500" />
											<span class="text-xs">{download.peers || 0}</span>
										</div>
									</div>
								{/if}
								<Badge
									variant={download.status === 'completed' ? 'default' : 'secondary'}
									class="text-xs"
								>
									{download.status}
								</Badge>
							</div>
						</div>
					{/each}
				</div>
			</CardContent>
		</Card>
	{/if}

	<!-- Stats Cards -->
	<div class="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		<Card class="border-l-4 border-l-purple-700 hover:shadow-md transition-shadow">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Whitelist Entries</CardTitle>
				<List class="text-purple-700 dark:text-purple-400 h-4 w-4" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold text-purple-800 dark:text-purple-300">{currentStats.whitelistCount}</div>
				<p class="text-muted-foreground text-xs">Anime titles tracked</p>
			</CardContent>
		</Card>

		<Card class="border-l-4 border-l-blue-700 hover:shadow-md transition-shadow">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Total Downloads</CardTitle>
				<Download class="text-blue-700 dark:text-blue-400 h-4 w-4" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold text-blue-800 dark:text-blue-300">{currentStats.totalDownloads}</div>
				<p class="text-muted-foreground text-xs">All time downloads</p>
			</CardContent>
		</Card>

		<Card class="border-l-4 border-l-green-700 hover:shadow-md transition-shadow">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Active Downloads</CardTitle>
				<Download class="text-green-700 dark:text-green-400 h-4 w-4" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold text-green-800 dark:text-green-300">{currentStats.activeDownloads}</div>
				<p class="text-muted-foreground text-xs">Currently downloading</p>
			</CardContent>
		</Card>

		<Card class="border-l-4 border-l-amber-700 hover:shadow-md transition-shadow">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">RSS Entries</CardTitle>
				<Rss class="text-amber-700 dark:text-amber-400 h-4 w-4" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold text-amber-800 dark:text-amber-300">{currentStats.processedEntries}</div>
				<p class="text-muted-foreground text-xs">Processed entries</p>
			</CardContent>
		</Card>
	</div>

	<!-- Recent Downloads -->
	<Card>
		<CardHeader>
			<CardTitle>Recent Downloads</CardTitle>
			<CardDescription>Latest download activity</CardDescription>
		</CardHeader>
		<CardContent>
			{#if downloads.length > 0}
				<div class="space-y-4">
					{#each downloads as download}
						{@const StatusIcon = getStatusIcon(download.status)}
						<div class="flex items-center justify-between rounded-lg border p-3">
							<div class="flex items-center gap-3">
								<StatusIcon class="h-4 w-4 {getStatusColor(download.status)}" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">
										{download.final_title || download.torrent_title}
									</p>
									<p class="text-muted-foreground text-xs">
										{new Date(download.created_at).toLocaleString()}
									</p>
								</div>
							</div>

							<div class="flex items-center gap-2">
								<Badge variant={getStatusBadgeVariant(download.status)}>
									{download.status}
								</Badge>
								{#if download.progress > 0}
									<div class="w-20">
										<Progress value={download.progress * 100} class="h-2" />
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="py-8 text-center">
					<Download class="text-muted-foreground mx-auto mb-4 h-12 w-12" />
					<h3 class="mb-2 text-lg font-semibold">No downloads yet</h3>
					<p class="text-muted-foreground">Downloads will appear here once RSS processing begins</p>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
