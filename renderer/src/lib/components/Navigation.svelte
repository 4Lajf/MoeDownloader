<script lang="ts">
	import { page, isRSSMonitoring, activeDownloads } from '$lib/stores';
	import { Button } from '$lib/components/ui/button';
	import {
		Home,
		List,
		Download,
		Rss,
		Settings,
		Play,
		Pause,
		ExternalLink,
		Database,
		FileText
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	let currentPage = $state('home');
	let rssMonitoring = $state(false);
	let downloads = $state<any[]>([]);

	// Subscribe to store changes
	page.subscribe(value => currentPage = value);
	isRSSMonitoring.subscribe(value => rssMonitoring = value);
	activeDownloads.subscribe(value => downloads = value);

	function navigateTo(newPage: string) {
		page.set(newPage);
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
				<Home class="w-4 h-4 mr-2" />
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
				variant={currentPage === 'whitelist' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('whitelist')}
			>
				<List class="w-4 h-4 mr-2" />
				Whitelist
			</Button>

			<Button
				variant={currentPage === 'database' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('database')}
			>
				<Database class="w-4 h-4 mr-2" />
				Database
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

			<Button
				variant={currentPage === 'anilist' ? 'default' : 'ghost'}
				class="w-full justify-start"
				onclick={() => navigateTo('anilist')}
			>
				<ExternalLink class="w-4 h-4 mr-2" />
				AniList
			</Button>
		</div>
	</div>

	<div class="p-4 border-t border-border">
		<Button
			variant={rssMonitoring ? 'destructive' : 'default'}
			class="w-full"
			onclick={toggleRSSMonitoring}
		>
			{#if rssMonitoring}
				<Pause class="w-4 h-4 mr-2" />
				Stop RSS Monitor
			{:else}
				<Play class="w-4 h-4 mr-2" />
				Start RSS Monitor
			{/if}
		</Button>
		
		{#if rssMonitoring}
			<div class="flex items-center justify-center mt-2 text-xs text-muted-foreground">
				<div class="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
				RSS Monitoring Active
			</div>
		{/if}
	</div>
</nav>
