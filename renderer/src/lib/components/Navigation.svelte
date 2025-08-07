<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page, isRSSMonitoring, activeDownloads } from '$lib/stores';
	import { Button } from '$lib/components/ui/button';
	import {
		House,
		List,
		Download,
		Settings,
		Play,
		Pause,
		FileText,
		Database,
		ScrollText,
		Code,
		Clock,
		RefreshCw,
		Search
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	let currentPage = $state('home');
	let rssMonitoring = $state(false);
	let rssToggleLoading = $state(false);
	let currentDownload = $state<any>(null);
	let queueCount = $state(0);
	let nextRSSCheck = $state<Date | null>(null);
	let rssInterval = $state<NodeJS.Timeout | null>(null);
	let showAdvancedTabs = $state(false);
	let developerModeEnabled = $state(false);
	let isAppPackaged = $state(true);

	let countdownInterval = $state<NodeJS.Timeout | null>(null);
	let countdownText = $state('');
	let downloads = $state<any[]>([]);

	// Subscribe to store changes
	page.subscribe(value => currentPage = value);
	isRSSMonitoring.subscribe(value => {
		rssMonitoring = value;
		updateRSSStatus();
	});
	activeDownloads.subscribe(value => {
		downloads = value;
		updateDownloadStatus();
	});

	// Load advanced tabs setting
	async function loadAdvancedTabsSetting() {
		try {
			const settings = await ipc.getSettings();
			showAdvancedTabs = settings.showAdvancedTabsInSidebar === true || settings.showAdvancedTabsInSidebar === 'true';
		} catch (error) {
			console.error('Error loading advanced tabs setting:', error);
		}
	}

	// Load developer mode settings
	async function loadDeveloperMode() {
		try {
			isAppPackaged = await ipc.isAppPackaged();
			// Enable developer mode by default if app is not packaged
			if (!isAppPackaged) {
				developerModeEnabled = true;
			}
		} catch (error) {
			console.error('Error loading developer mode settings:', error);
		}
	}



	// Load downloads periodically to keep status widget updated
	async function loadDownloads() {
		try {
			const allDownloads = await ipc.getAllDownloads();
			const active = allDownloads.filter(d =>
				d.status === 'downloading' || d.status === 'queued' || d.status === 'paused'
			);
			activeDownloads.set(active);
		} catch (error) {
			console.error('Error loading downloads for status widget:', error);
		}
	}

	// Start periodic download updates
	let downloadUpdateInterval: NodeJS.Timeout | null = null;

	// Load downloads on component mount and start periodic updates
	onMount(() => {
		loadAdvancedTabsSetting();
		loadDeveloperMode();
		loadDownloads();
		downloadUpdateInterval = setInterval(loadDownloads, 3000); // Update every 3 seconds

		// Check for settings changes every 2 seconds
		const settingsInterval = setInterval(() => {
			loadAdvancedTabsSetting();
		}, 2000);

		// Clean up on destroy
		return () => {
			if (settingsInterval) clearInterval(settingsInterval);
		};
	});

	// Update download status
	function updateDownloadStatus() {
		const downloading = downloads.find(d => d.status === 'downloading');
		const queued = downloads.filter(d => d.status === 'queued');

		currentDownload = downloading;
		queueCount = queued.length;
	}

	// Update RSS status and next check time
	async function updateRSSStatus() {
		if (rssMonitoring) {
			try {
				// Get RSS check interval from config
				const intervalMinutes = parseInt(await ipc.getConfig('check_interval_minutes') || '5');
				const intervalMs = intervalMinutes * 60 * 1000;

				// Calculate next check time (approximate)
				const now = new Date();
				const nextCheck = new Date(now.getTime() + intervalMs);
				nextRSSCheck = nextCheck;

				// Update every minute to keep countdown accurate
				if (rssInterval) clearInterval(rssInterval);
				rssInterval = setInterval(() => {
					const now = new Date();
					if (nextRSSCheck && now >= nextRSSCheck) {
						// RSS check should have happened, update next time
						const newNext = new Date(now.getTime() + intervalMs);
						nextRSSCheck = newNext;
					}
				}, 60000); // Update every minute

				// Start countdown timer for UI updates
				if (countdownInterval) clearInterval(countdownInterval);
				countdownInterval = setInterval(() => {
					updateCountdownText();
				}, 1000); // Update every second for smooth countdown

				// Initial countdown update
				updateCountdownText();
			} catch (error) {
				console.error('Error updating RSS status:', error);
			}
		} else {
			nextRSSCheck = null;
			countdownText = '';
			if (rssInterval) {
				clearInterval(rssInterval);
				rssInterval = null;
			}
			if (countdownInterval) {
				clearInterval(countdownInterval);
				countdownInterval = null;
			}
		}
	}

	// Update countdown text
	function updateCountdownText() {
		if (!nextRSSCheck) {
			countdownText = '';
			return;
		}

		const now = new Date();
		const diff = nextRSSCheck.getTime() - now.getTime();

		if (diff <= 0) {
			countdownText = 'Due now';
			return;
		}

		const minutes = Math.floor(diff / 60000);
		const seconds = Math.floor((diff % 60000) / 1000);

		if (minutes > 0) {
			countdownText = `${minutes}m ${seconds}s`;
		} else {
			countdownText = `${seconds}s`;
		}
	}

	// Format time until next RSS check (legacy function for compatibility)
	function formatTimeUntilNext() {
		return countdownText;
	}

	// Format download speed
	function formatSpeed(bytesPerSecond: number): string {
		if (!bytesPerSecond || bytesPerSecond === 0) return '0 B/s';

		const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
		let size = bytesPerSecond;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}

	// Cleanup intervals on component destroy
	onDestroy(() => {
		if (rssInterval) {
			clearInterval(rssInterval);
		}
		if (countdownInterval) {
			clearInterval(countdownInterval);
		}
		if (downloadUpdateInterval) {
			clearInterval(downloadUpdateInterval);
		}
	});

	function navigateTo(newPage: string) {
		page.set(newPage);
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
</script>

<nav class="w-64 bg-card border-r border-border flex flex-col">
	<div class="p-4">
		<h1 class="text-xl font-bold text-foreground">MoeDownloader</h1>
		<p class="text-sm text-muted-foreground">Anime Download Manager</p>
	</div>

	<div class="flex-1 px-4 py-2">
		<div class="space-y-2">
			<Button
				variant={currentPage === 'home' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('home')}
			>
				<House class="w-4 h-4 mr-2" />
				Dashboard
			</Button>

			<Button
				variant={currentPage === 'downloads' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('downloads')}
			>
				<Download class="w-4 h-4 mr-2" />
				Downloads
				{#if downloads.length > 0}
					<span class="ml-auto bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">
						{downloads.length}
					</span>
				{/if}
			</Button>

			<Button
				variant={currentPage === 'search' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('search')}
			>
				<Search class="w-4 h-4 mr-2" />
				Search
			</Button>

			<Button
				variant={currentPage === 'whitelist' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('whitelist')}
			>
				<List class="w-4 h-4 mr-2" />
				Whitelist
			</Button>

			<Button
				variant={currentPage === 'title-overrides' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('title-overrides')}
			>
				<FileText class="w-4 h-4 mr-2" />
				Title Overrides
			</Button>

			<Button
				variant={currentPage === 'settings' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('settings')}
			>
				<Settings class="w-4 h-4 mr-2" />
				Settings
			</Button>

			{#if developerModeEnabled}
				<Button
					variant={currentPage === 'developer' ? 'default' : 'ghost'}
					class="w-full justify-start"
					onclick={() => navigateTo('developer')}
				>
					<Code class="w-4 h-4 mr-2" />
					Developer
				</Button>
			{/if}

			{#if showAdvancedTabs}
				<Button
					variant={currentPage === 'activity-logs' ? 'default' : 'ghost'}
					class="w-full justify-start"
					onclick={() => navigateTo('activity-logs')}
				>
					<ScrollText class="w-4 h-4 mr-2" />
					Activity Logs
				</Button>

				<Button
					variant={currentPage === 'database' ? 'default' : 'ghost'}
					class="w-full justify-start"
					onclick={() => navigateTo('database')}
				>
					<Database class="w-4 h-4 mr-2" />
					Database
				</Button>
			{/if}
		</div>
	</div>

	<!-- Status Widget -->
	<div class="p-3 border-t border-border bg-muted/30">
		<div class="space-y-2 text-xs">
			<!-- Current Download -->
			{#if currentDownload}
				<div class="flex items-center gap-2">
					<Download class="w-3 h-3 text-blue-500" />
					<div class="flex-1 min-w-0">
						<div class="font-medium truncate">{currentDownload.final_title || currentDownload.torrent_title}</div>
						<div class="text-muted-foreground">
							{Math.round((currentDownload.progress || 0) * 100)}% • {formatSpeed(currentDownload.download_speed || 0)}
						</div>
					</div>
				</div>
			{:else}
				<div class="flex items-center gap-2 text-muted-foreground">
					<Download class="w-3 h-3" />
					<span>No active downloads</span>
				</div>
			{/if}

			<!-- Queue Status -->
			{#if queueCount > 0}
				<div class="flex items-center gap-2 text-muted-foreground">
					<Clock class="w-3 h-3" />
					<span>{queueCount} in queue</span>
				</div>
			{/if}

			<!-- RSS Status -->
			<div class="flex items-center gap-2">
				{#if rssMonitoring}
					<div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
					<div class="flex-1">
						<div class="text-green-600 font-medium">RSS Active</div>
						{#if nextRSSCheck}
							<div class="text-muted-foreground">Next: {formatTimeUntilNext()}</div>
						{/if}
					</div>
				{:else}
					<div class="w-2 h-2 bg-gray-400 rounded-full"></div>
					<span class="text-muted-foreground">RSS Off</span>
				{/if}
			</div>
		</div>
	</div>

	<div class="p-4 border-t border-border">
		<Button
			variant={rssMonitoring ? 'warning' : 'success'}
			class="w-full"
			onclick={toggleRSSMonitoring}
			disabled={rssToggleLoading}
		>
			{#if rssToggleLoading}
				<RefreshCw class="w-4 h-4 mr-2 animate-spin" />
				{rssMonitoring ? 'Stopping...' : 'Starting...'}
			{:else if rssMonitoring}
				<Pause class="w-4 h-4 mr-2" />
				Stop Auto-Download
			{:else}
				<Play class="w-4 h-4 mr-2" />
				Start Auto-Download
			{/if}
		</Button>
	</div>


</nav>
