<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
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
		HardDrive
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
	let downloadDirectory = $state('');

	// Subscribe to stores
	stats.subscribe(value => currentStats = value);
	recentDownloads.subscribe(value => downloads = value);
	isRSSMonitoring.subscribe(value => rssMonitoring = value);

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
			activeDownloads = allDownloads.filter((d: any) =>
				d.status === 'downloading' || d.status === 'queued' || d.status === 'paused'
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
		try {
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
		}
	}

	async function manualRSSCheck() {
		try {
			toast.loading('Checking RSS feed...', {
				description: 'Processing RSS feed for new episodes.',
				duration: 10000
			});

			const result = await ipc.processRSSFeed();
			loadStats();
			loadRecentDownloads();

			toast.dismiss();
			toast.success('RSS check completed', {
				description: `Found ${(result as any)?.newEntries || 0} new entries.`,
				duration: 4000
			});
		} catch (error: any) {
			console.error('Manual RSS check failed:', error);
			toast.dismiss();
			toast.error('RSS check failed', {
				description: `Failed to process RSS feed: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	function getStatusIcon(status: string) {
		switch (status) {
			case 'completed': return CheckCircle;
			case 'downloading': return Download;
			case 'queued': return Clock;
			case 'failed': return AlertCircle;
			default: return Clock;
		}
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'completed': return 'text-green-500';
			case 'downloading': return 'text-blue-500';
			case 'queued': return 'text-yellow-500';
			case 'failed': return 'text-red-500';
			default: return 'text-gray-500';
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
	<div class="flex gap-4 mb-6">
		<Button onclick={toggleRSSMonitoring} variant={rssMonitoring ? 'destructive' : 'default'}>
			{#if rssMonitoring}
				<Pause class="w-4 h-4 mr-2" />
				Stop RSS Monitor
			{:else}
				<Play class="w-4 h-4 mr-2" />
				Start RSS Monitor
			{/if}
		</Button>

		<Button onclick={manualRSSCheck} variant="outline">
			<Rss class="w-4 h-4 mr-2" />
			Check RSS Now
		</Button>
	</div>

	<!-- Active Downloads Status -->
	{#if activeDownloads.length > 0}
		<Card class="mb-6">
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Download class="w-5 h-5" />
					Active Downloads ({activeDownloads.length})
				</CardTitle>
				<CardDescription>
					Currently downloading torrents
					{#if downloadDirectory}
						<span class="block text-xs mt-1">Downloading to: {downloadDirectory}</span>
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-3">
					{#each activeDownloads as download}
						{@const StatusIcon = getStatusIcon(download.status)}
						<div class="flex items-center justify-between p-3 border rounded-lg">
							<div class="flex items-center gap-3 flex-1 min-w-0">
								<StatusIcon class="w-4 h-4 {getStatusColor(download.status)}" />
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium truncate">
										{download.final_title || download.torrent_title}
									</p>
									{#if download.progress > 0}
										<div class="mt-1">
											<Progress value={download.progress * 100} class="h-1.5" />
											<p class="text-xs text-muted-foreground mt-1">
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
											<ArrowDown class="w-3 h-3 text-green-500" />
											<span class="text-xs">{formatSpeed(download.download_speed || 0)}</span>
										</div>
										<div class="flex items-center gap-1">
											<ArrowUp class="w-3 h-3 text-blue-500" />
											<span class="text-xs">{formatSpeed(download.upload_speed || 0)}</span>
										</div>
										<div class="flex items-center gap-1">
											<Users class="w-3 h-3 text-orange-500" />
											<span class="text-xs">{download.peers || 0}</span>
										</div>
									</div>
								{/if}
								<Badge variant={download.status === 'completed' ? 'default' : 'secondary'} class="text-xs">
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
	<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Whitelist Entries</CardTitle>
				<List class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{currentStats.whitelistCount}</div>
				<p class="text-xs text-muted-foreground">Anime titles tracked</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Total Downloads</CardTitle>
				<Download class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{currentStats.totalDownloads}</div>
				<p class="text-xs text-muted-foreground">All time downloads</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">Active Downloads</CardTitle>
				<div class="h-4 w-4 rounded-full bg-green-500"></div>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{currentStats.activeDownloads}</div>
				<p class="text-xs text-muted-foreground">Currently downloading</p>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">RSS Entries</CardTitle>
				<Rss class="h-4 w-4 text-muted-foreground" />
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">{currentStats.processedEntries}</div>
				<p class="text-xs text-muted-foreground">Processed entries</p>
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
						<div class="flex items-center justify-between p-3 border rounded-lg">
							<div class="flex items-center gap-3">
								<StatusIcon class="w-4 h-4 {getStatusColor(download.status)}" />
								<div class="min-w-0 flex-1">
									<p class="text-sm font-medium truncate">
										{download.final_title || download.torrent_title}
									</p>
									<p class="text-xs text-muted-foreground">
										{new Date(download.created_at).toLocaleString()}
									</p>
								</div>
							</div>

							<div class="flex items-center gap-2">
								<Badge variant={download.status === 'completed' ? 'default' : 'secondary'}>
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
				<div class="text-center py-8">
					<Download class="w-12 h-12 text-muted-foreground mx-auto mb-4" />
					<h3 class="text-lg font-semibold mb-2">No downloads yet</h3>
					<p class="text-muted-foreground">Downloads will appear here once RSS processing begins</p>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
