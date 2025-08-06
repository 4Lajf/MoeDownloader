<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$lib/stores';
	import ipc from '../../ipc';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Save, Folder, RefreshCw, Moon, Sun, ScrollText, Database, ExternalLink, Settings } from 'lucide-svelte';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';

	import { toast } from 'svelte-sonner';

	// Settings state
	let settings = $state({
		// Download settings
		downloadPath: '',
		maxConcurrentDownloads: 3,
		torrentPort: 6881,
		// RSS settings
		rssUrl: 'https://nyaa.si/?page=rss&c=1_2&f=0',
		checkInterval: 5,
		enableAutoStart: false,
		// Download filtering settings
		disabledFansubGroups: '',
		// Notification settings
		enableNotifications: true,
		notificationSound: true,
		notifyDownloadStart: true,
		notifyDownloadComplete: true,
		notifyDownloadError: true,
		notifyRSSNewItems: true,
		notifyRSSError: true,
		// AniList settings
		anilistAccessToken: '',
		anilistUsername: '',
		anilistUserId: null,
		// Tray settings
		hideToTrayOnClose: true,
		startMinimizedToTray: false,
		// UI settings
		showAdvancedTabsInSidebar: false,
		// Advanced torrent settings
		enableDHT: true,
		enablePEX: true,
		enableLSD: true
	});

	let isLoading = $state(false);
	let isDarkMode = $state(false);
	let appVersion = $state('1.0.0');
	let versionClickCount = $state(0);
	let isAppPackaged = $state(true);

	// AniList state
	let isAniListAuthenticated = $state(false);
	let aniListUser = $state(null);

	// Load settings on component mount
	onMount(async () => {
		await loadSettings();
		await loadAppVersion();
		await loadAppPackagedStatus();
		await loadAniListData();
		// Load theme from localStorage or system preference
		isDarkMode = document.documentElement.classList.contains('dark');
	});

	async function loadSettings() {
		try {
			const loadedSettings = await ipc.getSettings();
			settings = { ...settings, ...loadedSettings };
		} catch (error) {
			console.error('Error loading settings:', error);
			toast.error('Failed to load settings');
		}
	}

	async function loadAppVersion() {
		try {
			appVersion = await ipc.getAppVersion();
		} catch (error) {
			console.error('Error loading app version:', error);
		}
	}

	async function loadAppPackagedStatus() {
		try {
			isAppPackaged = await ipc.isAppPackaged();
		} catch (error) {
			console.error('Error loading app packaged status:', error);
		}
	}

	async function loadAniListData() {
		try {
			isAniListAuthenticated = await ipc.anilistIsAuthenticated();
			if (isAniListAuthenticated) {
				aniListUser = await ipc.anilistGetCurrentUser();
			}
		} catch (error) {
			console.error('Error loading AniList data:', error);
		}
	}

	async function saveSettings() {
		isLoading = true;
		try {
			// Create a clean copy of settings without any non-serializable properties
			const cleanSettings = JSON.parse(JSON.stringify(settings));
			await ipc.saveSettings(cleanSettings);
			toast.success('Settings saved successfully');
		} catch (error) {
			console.error('Error saving settings:', error);
			toast.error('Failed to save settings');
		} finally {
			isLoading = false;
		}
	}

	async function autoSaveSettings() {
		try {
			// Create a clean copy of settings without any non-serializable properties
			const cleanSettings = JSON.parse(JSON.stringify(settings));
			await ipc.saveSettings(cleanSettings);
		} catch (error) {
			console.error('Error auto-saving settings:', error);
		}
	}

	async function selectDownloadPath() {
		try {
			const result = await ipc.selectDirectory();
			if (result) {
				settings.downloadPath = result;
				await autoSaveSettings();
			}
		} catch (error) {
			console.error('Error selecting download path:', error);
			toast.error('Failed to select download path');
		}
	}

	async function testRSSFeed() {
		if (!settings.rssUrl) {
			toast.error('Please enter an RSS URL first');
			return;
		}

		try {
			const result = await ipc.testRSSFeed(settings.rssUrl);
			if (result.success) {
				toast.success(`RSS feed test successful! Found ${result.itemCount} items`);
			} else {
				toast.error(`RSS feed test failed: ${result.error}`);
			}
		} catch (error) {
			console.error('Error testing RSS feed:', error);
			toast.error('Failed to test RSS feed');
		}
	}

	async function toggleTheme() {
		try {
			const newTheme = isDarkMode ? 'light' : 'dark';
			// Toggle theme by manipulating the document class
			if (newTheme === 'dark') {
				document.documentElement.classList.add('dark');
			} else {
				document.documentElement.classList.remove('dark');
			}
			isDarkMode = !isDarkMode;
			// Store preference in localStorage
			localStorage.setItem('theme', newTheme);
			toast.success(`Switched to ${newTheme} mode`);
		} catch (error) {
			console.error('Error toggling theme:', error);
			toast.error('Failed to toggle theme');
		}
	}

	function navigateToAniList() {
		page.set('anilist');
	}

	function navigateToActivityLogs() {
		page.set('activity-logs');
	}

	function navigateToDatabase() {
		page.set('database');
	}

	// Handle version click for developer mode (only in packaged mode)
	function handleVersionClick() {
		if (!isAppPackaged) {
			toast.info('Developer mode is already enabled in development environment');
			return;
		}

		// Check if developer mode is already enabled
		if (settings.showAdvancedTabsInSidebar) {
			toast.info('Developer mode is already enabled');
			return;
		}

		versionClickCount++;

		if (versionClickCount >= 5) {
			// Enable developer mode by showing advanced tabs
			settings.showAdvancedTabsInSidebar = true;
			autoSaveSettings();
			versionClickCount = 0; // Reset counter
			toast.success('Developer mode enabled! Advanced tabs are now visible in the sidebar.');
		} else {
			toast.info(`Click ${5 - versionClickCount} more times to enable developer mode`);
		}
	}
</script>

<div class="container mx-auto p-6 space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Settings</h1>
			<p class="text-muted-foreground">Configure your MoeDownloader preferences</p>
		</div>
		<Button variant="success" onclick={saveSettings} disabled={isLoading} class="flex items-center gap-2">
			<Save class="w-4 h-4" />
			{isLoading ? 'Saving...' : 'Save Settings'}
		</Button>
	</div>

	<Tabs.Root value="general" class="w-full">
		<Tabs.List class="grid w-full grid-cols-3">
			<Tabs.Trigger value="general">General</Tabs.Trigger>
			<Tabs.Trigger value="notifications">Notifications</Tabs.Trigger>
			<Tabs.Trigger value="advanced">Advanced</Tabs.Trigger>
		</Tabs.List>



		<Tabs.Content value="general" class="space-y-6 mt-6">
			<!-- AniList Integration -->
			<Card>
				<CardHeader>
					<CardTitle>AniList Integration</CardTitle>
					<CardDescription>Connect your AniList account to automatically download anime from your lists</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !isAniListAuthenticated}
						<div class="text-center py-8">
							<p class="text-muted-foreground mb-4">Connect your AniList account to get started</p>
							<Button variant="info" onclick={() => navigateToAniList()}>
								<ExternalLink class="w-4 h-4 mr-2" />
								Connect AniList Account
							</Button>
						</div>
					{:else}
						<div class="flex items-center space-x-4 p-4 border rounded-lg">
							{#if aniListUser?.avatar?.large}
								<img src={aniListUser.avatar.large} alt="Avatar" class="w-12 h-12 rounded-full" />
							{/if}
							<div class="flex-1">
								<h3 class="font-semibold">{aniListUser?.name || 'Connected User'}</h3>
								{#if aniListUser?.statistics?.anime}
									<p class="text-sm text-muted-foreground">
										{aniListUser.statistics.anime.count} anime watched •
										{Math.round(aniListUser.statistics.anime.minutesWatched / 60)} hours
									</p>
								{/if}
							</div>
							<Button variant="outline" onclick={() => navigateToAniList()}>
								<Settings class="w-4 h-4 mr-2" />
								Manage
							</Button>
						</div>
					{/if}
				</CardContent>
			</Card>

			<!-- General Settings -->
			<Card>
				<CardHeader>
					<CardTitle>General Settings</CardTitle>
					<CardDescription>Basic application settings and preferences</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div>
						<Label for="downloadPath" class="py-2">Download Directory</Label>
						<div class="flex gap-2">
							<Input
								id="downloadPath"
								bind:value={settings.downloadPath}
								placeholder="Select download directory..."
								readonly
							/>
							<Button variant="outline" onclick={selectDownloadPath}>
								<Folder class="w-4 h-4" />
							</Button>
						</div>
					</div>

					<div class="flex items-center space-x-2">
						<Button variant="outline" onclick={toggleTheme} class="flex items-center gap-2">
							{#if isDarkMode}
								<Sun class="w-4 h-4" />
								Light Mode
							{:else}
								<Moon class="w-4 h-4" />
								Dark Mode
							{/if}
						</Button>
					</div>

					<div>
						<Label for="maxConcurrentDownloads" class="py-2">Max Concurrent Downloads</Label>
						<Input
							id="maxConcurrentDownloads"
							type="number"
							bind:value={settings.maxConcurrentDownloads}
							min="1"
							max="10"
							oninput={autoSaveSettings}
						/>
						<p class="text-xs text-muted-foreground mt-1">Maximum number of simultaneous downloads (1-10)</p>
					</div>

					<div class="flex items-center space-x-2">
						<Switch
							id="autostart"
							bind:checked={settings.enableAutoStart}
							onCheckedChange={autoSaveSettings}
						/>
						<Label for="autostart">Start RSS monitoring on app launch</Label>
					</div>

					<!-- RSS Settings -->
					<div class="border-t pt-4 mt-4">
						<h4 class="font-medium mb-3">RSS Settings</h4>
						<div class="space-y-4">
							<div>
								<Label for="rssUrl" class="py-2">RSS Feed URL</Label>
								<div class="flex gap-2">
									<Input
										id="rssUrl"
										bind:value={settings.rssUrl}
										placeholder="https://example.com/rss.xml"
										type="url"
										oninput={autoSaveSettings}
									/>
									<Button variant="outline-info" onclick={testRSSFeed}>
										<RefreshCw class="w-4 h-4" />
									</Button>
								</div>
							</div>

							<div>
								<Label for="checkInterval" class="py-2">Check Interval (minutes)</Label>
								<Input
									id="checkInterval"
									type="number"
									bind:value={settings.checkInterval}
									min="5"
									max="1440"
									oninput={autoSaveSettings}
								/>
								{#if settings.checkInterval < 5}
									<p class="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
										⚠️ Warning: Checking RSS feeds more frequently than 5 minutes may result in your IP being temporarily banned by the RSS provider.
									</p>
								{/if}
							</div>
						</div>
					</div>

					<!-- Download Filtering Settings -->
					<div class="border-t pt-4 mt-4">
						<h4 class="font-medium mb-3">Download Filtering</h4>
						<div class="space-y-4">
							<div>
								<Label for="disabledGroups" class="py-2">Disabled Fansub Groups</Label>
								<Input
									id="disabledGroups"
									type="text"
									bind:value={settings.disabledFansubGroups}
									placeholder="e.g., BadGroup, AnotherBadGroup"
									oninput={autoSaveSettings}
								/>
								<p class="text-xs text-muted-foreground mt-1">
									Comma-separated list of fansub groups to globally disable. These groups will be ignored even when "Any" is selected in whitelist entries, unless explicitly overridden by setting a specific group preference.
								</p>
							</div>
						</div>
					</div>

					<!-- System Tray Settings -->
					<div class="border-t pt-4 mt-4">
						<h4 class="font-medium mb-3">System Tray Settings</h4>
						<div class="space-y-4">
							<div class="flex items-center space-x-2">
								<Switch
									id="hideToTray"
									bind:checked={settings.hideToTrayOnClose}
									onCheckedChange={autoSaveSettings}
								/>
								<div>
									<Label for="hideToTray">Hide to tray when closing</Label>
									<p class="text-xs text-muted-foreground">When disabled, closing the window will exit the application</p>
								</div>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="startMinimized"
									bind:checked={settings.startMinimizedToTray}
									onCheckedChange={autoSaveSettings}
								/>
								<div>
									<Label for="startMinimized">Start minimized to tray</Label>
									<p class="text-xs text-muted-foreground">Application will start hidden in the system tray</p>
								</div>
							</div>


						</div>
					</div>

					<!-- Version Information -->
					<div class="border-t pt-4 mt-4">
						<div class="flex items-center justify-between">
							<div>
								<h4 class="font-medium">Application Version</h4>
								<p class="text-xs text-muted-foreground">Current version of MoeDownloader</p>
							</div>
							<button
								class="text-sm font-mono px-3 py-1 rounded border hover:bg-muted cursor-pointer transition-colors"
								onclick={handleVersionClick}
								title="Click 5 times to enable developer mode"
							>
								v{appVersion}
							</button>
						</div>
						{#if isAppPackaged && versionClickCount > 0 && versionClickCount < 5 && !settings.showAdvancedTabsInSidebar}
							<p class="text-xs text-muted-foreground mt-2">
								Click {5 - versionClickCount} more times to enable developer mode
							</p>
						{/if}
					</div>
				</CardContent>
			</Card>
		</Tabs.Content>

		<Tabs.Content value="notifications" class="space-y-6 mt-6">
			<!-- Notification Settings -->
			<Card>
				<CardHeader>
					<CardTitle>Notification Settings</CardTitle>
					<CardDescription>Configure system notifications and in-app notifications</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="flex items-center space-x-2">
						<Switch
							id="enableNotifications"
							bind:checked={settings.enableNotifications}
							onCheckedChange={autoSaveSettings}
						/>
						<div>
							<Label for="enableNotifications">Enable notifications</Label>
							<p class="text-xs text-muted-foreground">Master toggle for all system notifications</p>
						</div>
					</div>

					<!-- Download Notifications -->
					<div class="border-t pt-4 mt-4">
						<h4 class="font-medium mb-3">Download Notifications</h4>
						<div class="space-y-4">
							<div class="flex items-center space-x-2">
								<Switch
									id="notifyDownloadStart"
									bind:checked={settings.notifyDownloadStart}
									onCheckedChange={autoSaveSettings}
									disabled={!settings.enableNotifications}
								/>
								<div>
									<Label for="notifyDownloadStart" class={!settings.enableNotifications ? 'text-muted-foreground' : ''}>
										Download started
									</Label>
									<p class="text-xs text-muted-foreground">Show notification when a download begins</p>
								</div>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="notifyDownloadComplete"
									bind:checked={settings.notifyDownloadComplete}
									onCheckedChange={autoSaveSettings}
									disabled={!settings.enableNotifications}
								/>
								<div>
									<Label for="notifyDownloadComplete" class={!settings.enableNotifications ? 'text-muted-foreground' : ''}>
										Download completed
									</Label>
									<p class="text-xs text-muted-foreground">Show notification when a download finishes successfully</p>
								</div>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="notifyDownloadError"
									bind:checked={settings.notifyDownloadError}
									onCheckedChange={autoSaveSettings}
									disabled={!settings.enableNotifications}
								/>
								<div>
									<Label for="notifyDownloadError" class={!settings.enableNotifications ? 'text-muted-foreground' : ''}>
										Download errors
									</Label>
									<p class="text-xs text-muted-foreground">Show notification when a download fails</p>
								</div>
							</div>
						</div>
					</div>

					<!-- RSS Notifications -->
					<div class="border-t pt-4 mt-4">
						<h4 class="font-medium mb-3">RSS Notifications</h4>
						<div class="space-y-4">
							<div class="flex items-center space-x-2">
								<Switch
									id="notifyRSSNewItems"
									bind:checked={settings.notifyRSSNewItems}
									onCheckedChange={autoSaveSettings}
									disabled={!settings.enableNotifications}
								/>
								<div>
									<Label for="notifyRSSNewItems" class={!settings.enableNotifications ? 'text-muted-foreground' : ''}>
										New RSS items found
									</Label>
									<p class="text-xs text-muted-foreground">Show notification when new items are found in RSS feed</p>
								</div>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="notifyRSSError"
									bind:checked={settings.notifyRSSError}
									onCheckedChange={autoSaveSettings}
									disabled={!settings.enableNotifications}
								/>
								<div>
									<Label for="notifyRSSError" class={!settings.enableNotifications ? 'text-muted-foreground' : ''}>
										RSS feed errors
									</Label>
									<p class="text-xs text-muted-foreground">Show notification when RSS feed cannot be accessed</p>
								</div>
							</div>
						</div>
					</div>

					<!-- Sound Settings -->
					<div class="border-t pt-4 mt-4">
						<h4 class="font-medium mb-3">Sound Settings</h4>
						<div class="space-y-4">
							<div class="flex items-center space-x-2">
								<Switch
									id="notificationSound"
									bind:checked={settings.notificationSound}
									onCheckedChange={autoSaveSettings}
									disabled={!settings.enableNotifications}
								/>
								<div>
									<Label for="notificationSound" class={!settings.enableNotifications ? 'text-muted-foreground' : ''}>
										Play notification sound
									</Label>
									<p class="text-xs text-muted-foreground">Play a sound when notifications are shown</p>
								</div>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</Tabs.Content>





		<Tabs.Content value="advanced" class="space-y-6 mt-6">
			<!-- Developer Mode Settings -->
			<Card>
				<CardHeader>
					<CardTitle>Developer Mode</CardTitle>
					<CardDescription>Enable advanced features and tools for developers</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="flex items-center space-x-2">
						<Switch
							id="showAdvancedTabs"
							bind:checked={settings.showAdvancedTabsInSidebar}
							onCheckedChange={autoSaveSettings}
						/>
						<div>
							<Label for="showAdvancedTabs">Show advanced tabs in sidebar</Label>
							<p class="text-xs text-muted-foreground">Show Activity Logs and Database tabs in the main sidebar</p>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Advanced Tools -->
			<Card>
				<CardHeader>
					<CardTitle>Advanced Tools</CardTitle>
					<CardDescription>Advanced debugging and database management tools</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="space-y-4">
						<Button variant="outline-purple" onclick={() => navigateToActivityLogs()} class="w-full h-auto p-4 flex flex-col items-start">
							<div class="flex items-center w-full mb-2">
								<ScrollText class="w-5 h-5 mr-2" />
								<span class="font-medium">Activity Logs</span>
							</div>
							<p class="text-sm text-muted-foreground text-left">View detailed logs of all application activities and RSS processing</p>
						</Button>

						<Button variant="outline-info" onclick={() => navigateToDatabase()} class="w-full h-auto p-4 flex flex-col items-start">
							<div class="flex items-center w-full mb-2">
								<Database class="w-5 h-5 mr-2" />
								<span class="font-medium">Database Management</span>
							</div>
							<p class="text-sm text-muted-foreground text-left">Manage processed files, clear download history, and database maintenance</p>
						</Button>
					</div>
				</CardContent>
			</Card>
		</Tabs.Content>
	</Tabs.Root>
</div>