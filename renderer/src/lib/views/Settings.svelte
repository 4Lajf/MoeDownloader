<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	import { Switch } from '$lib/components/ui/switch';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Save, Folder, RefreshCw, ChevronDown, ChevronRight, TestTube, Download } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import ipc from '../../ipc';

	let settings = $state({
		downloadPath: '',
		rssUrl: '',
		checkInterval: 30,
		enableNotifications: true,
		enableAutoStart: false,
		maxConcurrentDownloads: 3,
		torrentPort: 6881,
		enableDHT: true,
		enablePEX: true,
		enableLSD: true
	});

	let loading = $state(true);
	let saving = $state(false);
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	let advancedSettingsOpen = $state(false);

	onMount(async () => {
		await loadSettings();
	});

	onDestroy(() => {
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}
	});

	async function loadSettings() {
		try {
			const appSettings = await ipc.getSettings();

			// Map backend fields to frontend fields
			const mappedSettings = {
				downloadPath: appSettings.downloads_directory || settings.downloadPath,
				rssUrl: appSettings.rss_feed_url || settings.rssUrl,
				checkInterval: parseInt(appSettings.check_interval_minutes) || settings.checkInterval,
				enableNotifications: appSettings.enable_notifications !== undefined ? appSettings.enable_notifications : settings.enableNotifications,
				enableAutoStart: appSettings.enable_auto_start !== undefined ? appSettings.enable_auto_start : settings.enableAutoStart,
				maxConcurrentDownloads: parseInt(appSettings.max_concurrent_downloads) || settings.maxConcurrentDownloads,
				torrentPort: parseInt(appSettings.torrent_port) || settings.torrentPort,
				enableDHT: appSettings.enable_dht !== undefined ? appSettings.enable_dht : settings.enableDHT,
				enablePEX: appSettings.enable_pex !== undefined ? appSettings.enable_pex : settings.enablePEX,
				enableLSD: appSettings.enable_lsd !== undefined ? appSettings.enable_lsd : settings.enableLSD
			};

			settings = { ...settings, ...mappedSettings };
		} catch (error: any) {
			console.error('Error loading settings:', error);
			toast.error('Failed to load settings', {
				description: `Error loading settings: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			loading = false;
		}
	}

	// Helper function to create a serializable settings object
	function getSerializableSettings() {
		return {
			downloads_directory: settings.downloadPath, // Map frontend field to backend field
			rss_feed_url: settings.rssUrl, // Map frontend field to backend field
			check_interval_minutes: settings.checkInterval, // Map frontend field to backend field
			enable_notifications: settings.enableNotifications,
			enable_auto_start: settings.enableAutoStart,
			max_concurrent_downloads: settings.maxConcurrentDownloads,
			torrent_port: settings.torrentPort,
			enable_dht: settings.enableDHT,
			enable_pex: settings.enablePEX,
			enable_lsd: settings.enableLSD
		};
	}

	async function saveSettings() {
		saving = true;
		try {
			await ipc.saveSettings(getSerializableSettings());
			toast.success('Settings saved', {
				description: 'Your settings have been saved successfully.',
				duration: 3000
			});
		} catch (error: any) {
			console.error('Error saving settings:', error);
			toast.error('Failed to save settings', {
				description: `An error occurred while saving your settings: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			saving = false;
		}
	}

	// Debounced auto-save function
	function autoSaveSettings() {
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}

		saveTimeout = setTimeout(async () => {
			try {
				await ipc.saveSettings(getSerializableSettings());
				toast.success('Settings auto-saved', {
					description: 'Your changes have been saved automatically.',
					duration: 2000
				});
			} catch (error: any) {
				console.error('Error auto-saving settings:', error);
				toast.error('Auto-save failed', {
					description: `Failed to automatically save settings: ${error?.message || 'Unknown error'}`,
					duration: 3000
				});
			}
		}, 1000); // 1 second delay
	}

	async function selectDownloadPath() {
		try {
			const path = await ipc.selectDirectory();
			if (path) {
				settings.downloadPath = path;
				autoSaveSettings(); // Auto-save when path is selected
				toast.success('Download path updated', {
					description: `Download path set to: ${path}`,
					duration: 4000
				});
			}
		} catch (error: any) {
			console.error('Error selecting directory:', error);
			toast.error('Failed to select directory', {
				description: `Error selecting directory: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	async function testRSSFeed() {
		if (!settings.rssUrl.trim()) {
			toast.error('Invalid RSS URL', {
				description: 'Please enter a valid RSS feed URL.',
				duration: 3000
			});
			return;
		}

		try {
			toast.loading('Testing RSS feed...', {
				description: 'Checking if the RSS feed is accessible.',
				duration: 10000
			});

			const result = await ipc.testRSSFeed(settings.rssUrl);

			toast.dismiss();
			toast.success('RSS feed test successful', {
				description: `RSS feed is accessible. Found ${(result as any)?.itemCount || 0} items.`,
				duration: 5000
			});
		} catch (error: any) {
			console.error('Error testing RSS feed:', error);
			toast.dismiss();
			toast.error('RSS feed test failed', {
				description: `Failed to access RSS feed: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		}
	}

	let testRssUrl = $state('');
	let testResults = $state<any[]>([]);
	let showResults = $state(false);
	let testInProgress = $state(false);

	async function testContinuousNumeration() {
		if (!testRssUrl.trim()) {
			toast.error('Invalid RSS URL', {
				description: 'Please enter a valid RSS feed URL.',
				duration: 3000
			});
			return;
		}

		try {
			testInProgress = true;
			showResults = false;
			testResults = [];

			toast.loading('Testing continuous numeration...', {
				description: 'Parsing RSS feed and checking episode numbering.',
				duration: 15000
			});

			const result = await ipc.testRSSContinuousNumeration(testRssUrl);

			toast.dismiss();

			if (result.success) {
				const summary = result.summary;

				// Store results for UI display and enhance with AniList data
				testResults = result.results || [];

				// Enhance results with AniList search data
				for (let i = 0; i < testResults.length; i++) {
					const testResult = testResults[i];
					if (testResult.parsedData?.animeTitle) {
						try {
							const anilistResults = await searchAniListForTitle(testResult.parsedData.animeTitle);
							testResults[i] = { ...testResult, anilistResults };
						} catch (error) {
							console.error('Error searching AniList for', testResult.parsedData.animeTitle, error);
						}
					}
				}

				showResults = true;

				toast.success('Continuous numeration test completed', {
					description: `Processed ${summary.totalItems} items. ${summary.successfullyParsed} parsed successfully, ${summary.withEpisodeNumbers} with episode numbers.`,
					duration: 8000
				});

				// Log detailed results to console for debugging
				console.log('🧪 Continuous Numeration Test Results:', JSON.stringify(result, null, 2));
			} else {
				toast.error('Continuous numeration test failed', {
					description: `Test failed: ${result.error}`,
					duration: 5000
				});
			}
		} catch (error: any) {
			console.error('Error testing continuous numeration:', error);
			toast.dismiss();
			toast.error('Continuous numeration test failed', {
				description: `Test failed: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			testInProgress = false;
		}
	}

	async function searchAniListForTitle(animeTitle: string) {
		if (!animeTitle) return null;

		try {
			const searchResult = await ipc.anilistSearchAnime(animeTitle, 1, 5);
			return searchResult?.media || [];
		} catch (error) {
			console.error('Error searching AniList:', error);
			return [];
		}
	}

	// Test RSS Download functionality
	let testDownloadResults = $state<any[]>([]);
	let showDownloadResults = $state(false);
	let downloadTestInProgress = $state(false);
	let testDownloadOptions = $state({
		maxItems: 5,
		ignoreProcessedFiles: false,
		sendNotifications: false
	});

	async function testRSSDownload() {
		if (!testRssUrl.trim()) {
			toast.error('Invalid RSS URL', {
				description: 'Please enter a valid RSS feed URL.',
				duration: 3000
			});
			return;
		}

		try {
			downloadTestInProgress = true;
			showDownloadResults = false;
			testDownloadResults = [];

			toast.loading('Testing RSS download...', {
				description: 'Processing RSS feed and attempting downloads.',
				duration: 15000
			});

			// Create a plain object to avoid cloning issues
			const options = {
				maxItems: testDownloadOptions.maxItems,
				ignoreProcessedFiles: testDownloadOptions.ignoreProcessedFiles,
				sendNotifications: testDownloadOptions.sendNotifications
			};

			const result = await ipc.testRSSDownload(testRssUrl, options);

			toast.dismiss();

			if (result.success) {
				const summary = result.summary;

				// Store results for UI display
				testDownloadResults = result.results || [];
				showDownloadResults = true;

				toast.success('RSS download test completed', {
					description: `Processed ${summary.processedItems} items. ${summary.downloadedCount} downloads queued, ${summary.noMatches} no matches, ${summary.alreadyProcessed} already processed.`,
					duration: 8000
				});

				// Log detailed results to console for debugging
				console.log('🧪 RSS Download Test Results:', JSON.stringify(result, null, 2));
			} else {
				toast.error('RSS download test failed', {
					description: `Test failed: ${result.error}`,
					duration: 5000
				});
			}
		} catch (error: any) {
			console.error('Error testing RSS download:', error);
			toast.dismiss();
			toast.error('RSS download test failed', {
				description: `Test failed: ${error?.message || 'Unknown error'}`,
				duration: 5000
			});
		} finally {
			downloadTestInProgress = false;
		}
	}
</script>

<div class="p-6">
	<div class="mb-6">
		<h1 class="text-3xl font-bold">Settings</h1>
		<p class="text-muted-foreground">Configure MoeDownloader preferences</p>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
		</div>
	{:else}
		<div class="space-y-6">
			<!-- General Settings -->
			<Card>
				<CardHeader>
					<CardTitle>General Settings</CardTitle>
					<CardDescription>Basic application configuration</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div>
						<Label for="downloadPath" class="py-2">Download Directory</Label>
						<div class="flex gap-2">
							<Input 
								id="downloadPath" 
								bind:value={settings.downloadPath} 
								placeholder="Select download directory"
								readonly
							/>
							<Button variant="outline" onclick={selectDownloadPath}>
								<Folder class="w-4 h-4" />
							</Button>
						</div>
					</div>

					<div>
						<Label for="maxDownloads" class="py-2">Max Concurrent Downloads</Label>
						<Input
							id="maxDownloads"
							type="number"
							bind:value={settings.maxConcurrentDownloads}
							min="1"
							max="10"
							oninput={autoSaveSettings}
						/>
					</div>

					<div class="flex items-center space-x-2">
						<Switch
							id="notifications"
							bind:checked={settings.enableNotifications}
							onCheckedChange={autoSaveSettings}
						/>
						<Label for="notifications">Enable Notifications</Label>
					</div>

					<div class="flex items-center space-x-2">
						<Switch
							id="autostart"
							bind:checked={settings.enableAutoStart}
							onCheckedChange={autoSaveSettings}
						/>
						<Label for="autostart">Start RSS monitoring on app launch</Label>
					</div>
				</CardContent>
			</Card>

			<!-- RSS Settings -->
			<Card>
				<CardHeader>
					<CardTitle>RSS Settings</CardTitle>
					<CardDescription>Configure RSS feed monitoring</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
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
							<Button variant="outline" onclick={testRSSFeed}>
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
							<p class="text-sm text-yellow-600 mt-1">
								⚠️ Warning: Checking RSS feeds more frequently than 5 minutes may result in your IP being temporarily banned by the RSS provider.
							</p>
						{/if}
					</div>

					<div class="border-t pt-4">
						<Label>Testing & Debugging</Label>
						<div class="space-y-2 mt-2">
							<div>
								<Label for="testRssUrl" class="py-2">Test RSS URL</Label>
								<Input
									id="testRssUrl"
									bind:value={testRssUrl}
									placeholder="https://nyaa.si/?page=rss&q=anime+title"
									type="url"
								/>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<Button variant="outline" onclick={testContinuousNumeration} disabled={testInProgress || downloadTestInProgress}>
									{#if testInProgress}
										<RefreshCw class="w-4 h-4 mr-2 animate-spin" />
										Testing...
									{:else}
										<TestTube class="w-4 h-4 mr-2" />
										Test Parsing
									{/if}
								</Button>
								<Button variant="outline" onclick={testRSSDownload} disabled={testInProgress || downloadTestInProgress}>
									{#if downloadTestInProgress}
										<RefreshCw class="w-4 h-4 mr-2 animate-spin" />
										Testing...
									{:else}
										<Download class="w-4 h-4 mr-2" />
										Test Download
									{/if}
								</Button>
							</div>

							<!-- Test Download Options -->
							<div class="border-t pt-3 mt-3">
								<Label class="text-sm font-medium">Download Test Options</Label>
								<div class="grid grid-cols-2 gap-4 mt-2">
									<div>
										<Label for="maxItems" class="text-xs">Max Items to Process</Label>
										<Input
											id="maxItems"
											type="number"
											bind:value={testDownloadOptions.maxItems}
											min="1"
											max="50"
											class="text-xs"
										/>
									</div>
									<div class="space-y-2">
										<div class="flex items-center space-x-2">
											<Switch
												id="ignoreProcessed"
												bind:checked={testDownloadOptions.ignoreProcessedFiles}
											/>
											<Label for="ignoreProcessed" class="text-xs">Ignore Already Processed</Label>
										</div>
										<div class="flex items-center space-x-2">
											<Switch
												id="sendNotifications"
												bind:checked={testDownloadOptions.sendNotifications}
											/>
											<Label for="sendNotifications" class="text-xs">Send Notifications</Label>
										</div>
									</div>
								</div>
							</div>
						</div>
						<div class="space-y-1 text-sm text-muted-foreground">
							<p><strong>Test Parsing:</strong> Test episode numbering resolution using a custom RSS feed URL</p>
							<p><strong>Test Download:</strong> Actually process RSS feed and queue downloads (uses real whitelist and database)</p>
						</div>
					</div>
				</CardContent>
			</Card>

			<!-- Test Results -->
			{#if showResults && testResults.length > 0}
				<Card>
					<CardHeader>
						<CardTitle>Continuous Numeration Test Results</CardTitle>
						<CardDescription>
							Parsed filename information and AniList mapping details for {testResults.length} items
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="space-y-4 max-h-96 overflow-y-auto">
							{#each testResults as result, index}
								<div class="border rounded-lg p-4 space-y-3">
									<div class="flex items-start justify-between">
										<div class="space-y-1 flex-1">
											<h4 class="font-medium text-sm">{result.originalTitle}</h4>
											{#if result.error}
												<p class="text-sm text-red-600">Error: {result.error}</p>
											{/if}
										</div>
										<div class="text-xs text-muted-foreground">#{index + 1}</div>
									</div>

									<!-- Show transformation example if episode mapping was applied -->
									{#if result.parsedData?.episodeMappingApplied}
										<div class="bg-green-50 border border-green-300 rounded p-3">
											<div class="font-medium text-green-800 text-sm mb-2">🔄 Episode Mapping Transformation</div>
											<div class="space-y-1 text-sm">
												<div class="font-mono text-xs">
													<span class="text-red-600">Original:</span> {result.parsedData.originalAnimeTitle} - {result.parsedData.originalEpisodeNumber}
												</div>
												<div class="font-mono text-xs">
													<span class="text-green-600">Mapped:</span> {result.parsedData.animeTitle} - {result.parsedData.episodeNumber}
												</div>
											</div>
										</div>
									{/if}

									<!-- Show title overrides results -->
									{#if result.titleOverridesResult}
										<div class="bg-blue-50 border border-blue-300 rounded p-3">
											<div class="font-medium text-blue-800 text-sm mb-2">🎯 Title Overrides System</div>
											{#if result.titleOverridesResult.error}
												<p class="text-sm text-red-600">Error: {result.titleOverridesResult.error}</p>
											{:else}
												<div class="space-y-2 text-sm">
													<!-- Title Override -->
													{#if result.titleOverridesResult.titleChanged}
														<div class="space-y-1">
															<div class="font-medium text-blue-700">Title Override Applied:</div>
															<div class="font-mono text-xs">
																<span class="text-red-600">Original:</span> {result.titleOverridesResult.originalTitle}
															</div>
															<div class="font-mono text-xs">
																<span class="text-green-600">Override:</span> {result.titleOverridesResult.overriddenTitle}
															</div>
														</div>
													{:else}
														<div class="text-xs text-muted-foreground">No title override applied</div>
													{/if}

													<!-- Episode Mapping -->
													{#if result.titleOverridesResult.episodeMapping && result.titleOverridesResult.episodeChanged}
														<div class="space-y-1">
															<div class="font-medium text-blue-700">Episode Mapping Applied:</div>
															<div class="font-mono text-xs">
																<span class="text-red-600">Original:</span> {result.titleOverridesResult.overriddenTitle} - Episode {result.parsedData?.episodeNumber || 'N/A'}
															</div>
															<div class="font-mono text-xs">
																<span class="text-green-600">Mapped:</span> {result.titleOverridesResult.episodeMapping.transformedTitle} - Episode {result.titleOverridesResult.episodeMapping.transformedEpisode}
															</div>
														</div>
													{:else if result.titleOverridesResult.episodeMapping}
														<div class="text-xs text-muted-foreground">No episode mapping applied</div>
													{/if}
												</div>
											{/if}
										</div>
									{/if}

									{#if result.parsedData}
										<div class="space-y-3">
											<!-- Basic Information -->
											<div>
												<h5 class="text-sm font-medium mb-2">Parsed Filename Information</h5>
												<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Anime Title:</span>
														<div class="font-mono p-1 rounded text-xs {result.parsedData.titleOverrideApplied || result.parsedData.episodeMappingApplied ? 'bg-blue-100 border border-blue-300' : 'bg-muted'}">
															{result.parsedData.animeTitle || 'N/A'}
															{#if (result.parsedData.titleOverrideApplied || result.parsedData.episodeMappingApplied) && result.parsedData.originalAnimeTitle}
																<div class="text-blue-700 font-medium text-xs mt-1">
																	{#if result.parsedData.titleOverrideApplied && result.parsedData.episodeMappingApplied}
																		Override + Mapping from: "{result.parsedData.originalAnimeTitle}"
																	{:else if result.parsedData.titleOverrideApplied}
																		Override from: "{result.parsedData.originalAnimeTitle}"
																	{:else}
																		Mapped from: "{result.parsedData.originalAnimeTitle}"
																	{/if}
																</div>
															{/if}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Episode:</span>
														<div class="font-mono p-1 rounded text-xs {result.parsedData.episodeMappingApplied ? 'bg-blue-100 border border-blue-300' : 'bg-muted'}">
															{result.parsedData.episodeNumber || 'N/A'}
															{#if result.parsedData.episodeMappingApplied && result.parsedData.originalEpisodeNumber}
																<span class="text-blue-700 font-medium"> (mapped from {result.parsedData.originalEpisodeNumber})</span>
															{/if}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Release Group:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.releaseGroup || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Resolution:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.videoResolution || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Video Codec:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.videoTerm || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Audio Codec:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.audioTerm || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Source:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.source || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">File Extension:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.fileExtension || 'N/A'}
														</div>
													</div>
												</div>
											</div>

											<!-- Additional Information -->
											<div>
												<h5 class="text-sm font-medium mb-2">Additional Information</h5>
												<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Episode Title:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.episodeTitle || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Release Version:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.releaseVersion || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Release Info:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.releaseInformation || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">File Checksum:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.fileChecksum || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Anime Year:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.animeYear || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Season:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.animeSeason || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Anime Type:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.animeType || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Language:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.language || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Subtitles:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.subtitles || 'N/A'}
														</div>
													</div>
													<div class="space-y-1">
														<span class="font-medium text-muted-foreground">Volume:</span>
														<div class="font-mono bg-muted p-1 rounded text-xs">
															{result.parsedData.volumeNumber || 'N/A'}
														</div>
													</div>
												</div>
											</div>

											<!-- Anime Relations Result -->
											{#if result.animeRelationsResult}
												<div>
													<h5 class="text-sm font-medium mb-2">Episode Relations Mapping Test</h5>
													<div class="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
														<div class="space-y-2">
															<div><span class="font-medium">Parsed Title:</span> {result.animeRelationsResult.parsedTitle}</div>
															<div><span class="font-medium">Input Episode:</span> {result.animeRelationsResult.inputEpisode}</div>
															{#if result.animeRelationsResult.searchedAnilistId}
																<div><span class="font-medium">Found AniList ID:</span> {result.animeRelationsResult.searchedAnilistId}</div>
															{/if}
															<div><span class="font-medium">Relations Database:</span> {result.animeRelationsResult.totalRelationsCount} anime with episode mappings</div>

															{#if result.animeRelationsResult.specificMappingFound}
																<div class="bg-green-50 border border-green-300 rounded p-2">
																	<div class="font-medium text-green-800">✅ Episode Mapping Applied</div>
																	{#if result.parsedData.originalAnimeTitle && result.parsedData.animeTitle !== result.parsedData.originalAnimeTitle}
																		<div class="text-sm">
																			<div>Title: "{result.parsedData.originalAnimeTitle}" → "{result.parsedData.animeTitle}"</div>
																			<div>Episode: {result.animeRelationsResult.specificMapping.original.episode} → {result.animeRelationsResult.specificMapping.mapped.episode}</div>
																		</div>
																	{:else}
																		<div class="text-sm">
																			Episode {result.animeRelationsResult.specificMapping.original.episode}
																			→ Episode {result.animeRelationsResult.specificMapping.mapped.episode}
																		</div>
																	{/if}
																	<div class="text-xs text-muted-foreground mt-1">
																		AniList ID {result.animeRelationsResult.specificMapping.original.anilistId}
																		→ {result.animeRelationsResult.specificMapping.mapped.anilistId}
																	</div>
																</div>
															{:else}
																<div class="bg-blue-50 border border-blue-200 rounded p-2">
																	<div class="font-medium text-blue-800">Result:</div>
																	<div>{result.animeRelationsResult.explanation}</div>
																</div>
															{/if}

															{#if result.animeRelationsResult.mappings && result.animeRelationsResult.mappings.length > 0 && !result.animeRelationsResult.specificMappingFound}
																<div><span class="font-medium">Other Episode Mappings for Episode {result.animeRelationsResult.inputEpisode}:</span></div>
																<div class="text-xs text-muted-foreground mb-2">
																	These are other anime that have episode {result.animeRelationsResult.inputEpisode} mapped, but don't match your parsed title.
																</div>
																{#each result.animeRelationsResult.mappings as mapping, index}
																	<div class="bg-gray-50 border border-gray-300 rounded p-2 space-y-1">
																		<div class="font-medium text-gray-700">Example {index + 1}:</div>
																		<div>
																			<span class="font-medium">Original:</span>
																			{#if mapping.original.title}
																				{mapping.original.title} (AniList ID {mapping.original.anilistId}), Episode {mapping.original.episode}
																			{:else}
																				AniList ID {mapping.original.anilistId}, Episode {mapping.original.episode}
																			{/if}
																		</div>
																		<div>
																			<span class="font-medium">Maps to:</span>
																			{#if mapping.mapped.title}
																				{mapping.mapped.title} (AniList ID {mapping.mapped.anilistId}), Episode {mapping.mapped.episode}
																			{:else}
																				AniList ID {mapping.mapped.anilistId}, Episode {mapping.mapped.episode}
																			{/if}
																		</div>
																		<div class="text-xs text-muted-foreground">
																			Some fansub groups number episode {mapping.original.episode}
																			{#if mapping.original.title}of "{mapping.original.title}"{:else}of anime {mapping.original.anilistId}{/if}
																			as episode {mapping.mapped.episode}
																			{#if mapping.mapped.title}of "{mapping.mapped.title}"{:else}of anime {mapping.mapped.anilistId}{/if}
																		</div>
																	</div>
																{/each}
															{/if}

															{#if result.animeRelationsResult.error}
																<div class="text-red-600"><span class="font-medium">Error:</span> {result.animeRelationsResult.error}</div>
															{/if}
														</div>
													</div>
												</div>
											{/if}

											<!-- AniList Search Results -->
											{#if result.anilistResults && result.anilistResults.length > 0}
												<div>
													<h5 class="text-sm font-medium mb-2">AniList Search Results</h5>
													<div class="space-y-2">
														{#each result.anilistResults.slice(0, 3) as anime}
															<div class="bg-green-50 border border-green-200 rounded p-3 text-xs">
																<div class="flex items-start gap-3">
																	{#if anime.coverImage?.medium}
																		<img
																			src={anime.coverImage.medium}
																			alt={anime.title?.userPreferred || anime.title?.romaji}
																			class="w-12 h-16 object-cover rounded"
																		/>
																	{/if}
																	<div class="flex-1 space-y-1">
																		<div class="font-medium">
																			{anime.title?.userPreferred || anime.title?.romaji || anime.title?.english}
																		</div>
																		<div><span class="font-medium">AniList ID:</span> {anime.id}</div>
																		{#if anime.title?.english && anime.title.english !== anime.title?.romaji}
																			<div><span class="font-medium">English:</span> {anime.title.english}</div>
																		{/if}
																		{#if anime.title?.native}
																			<div><span class="font-medium">Native:</span> {anime.title.native}</div>
																		{/if}
																		{#if anime.format}
																			<div><span class="font-medium">Format:</span> {anime.format}</div>
																		{/if}
																		{#if anime.status}
																			<div><span class="font-medium">Status:</span> {anime.status}</div>
																		{/if}
																		{#if anime.episodes}
																			<div><span class="font-medium">Episodes:</span> {anime.episodes}</div>
																		{/if}
																		{#if anime.seasonYear}
																			<div><span class="font-medium">Year:</span> {anime.seasonYear}</div>
																		{/if}
																		{#if anime.season}
																			<div><span class="font-medium">Season:</span> {anime.season}</div>
																		{/if}
																		{#if anime.averageScore}
																			<div><span class="font-medium">Score:</span> {anime.averageScore}/100</div>
																		{/if}
																		{#if anime.genres && anime.genres.length > 0}
																			<div><span class="font-medium">Genres:</span> {anime.genres.join(', ')}</div>
																		{/if}
																		{#if anime.synonyms && anime.synonyms.length > 0}
																			<div><span class="font-medium">Synonyms:</span> {anime.synonyms.slice(0, 3).join(', ')}</div>
																		{/if}
																	</div>
																</div>
															</div>
														{/each}
														{#if result.anilistResults.length > 3}
															<div class="text-xs text-muted-foreground text-center">
																... and {result.anilistResults.length - 3} more results
															</div>
														{/if}
													</div>
												</div>
											{:else if result.parsedData?.animeTitle}
												<div>
													<h5 class="text-sm font-medium mb-2">AniList Search Results</h5>
													<div class="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-muted-foreground">
														No AniList results found for "{result.parsedData.animeTitle}"
													</div>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			{/if}

			<!-- Download Test Results -->
			{#if showDownloadResults && testDownloadResults.length > 0}
				<Card>
					<CardHeader>
						<CardTitle>RSS Download Test Results</CardTitle>
						<CardDescription>
							Download processing results for {testDownloadResults.length} items from RSS feed
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="space-y-4 max-h-96 overflow-y-auto">
							{#each testDownloadResults as result, index}
								<div class="border rounded-lg p-4 space-y-3">
									<div class="flex items-start justify-between">
										<div class="space-y-1 flex-1">
											<h4 class="font-medium text-sm">{result.originalTitle}</h4>
											<div class="flex items-center gap-2">
												{#if result.status === 'processed' && result.downloaded}
													<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
														✅ Downloaded
													</span>
												{:else if result.status === 'already_processed'}
													<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
														⏭️ Already Processed
													</span>
												{:else if result.status === 'no_match'}
													<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
														❌ No Match
													</span>
												{:else if result.status === 'error'}
													<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
														💥 Error
													</span>
												{:else if result.status === 'skipped'}
													<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
														⏭️ Skipped
													</span>
												{:else}
													<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
														🔄 {result.status}
													</span>
												{/if}
											</div>
											{#if result.error}
												<p class="text-sm text-red-600">Error: {result.error}</p>
											{/if}
											{#if result.reason}
												<p class="text-sm text-muted-foreground">Reason: {result.reason}</p>
											{/if}
										</div>
										<div class="text-xs text-muted-foreground">#{index + 1}</div>
									</div>

									<!-- Download Details -->
									{#if result.downloaded && result.finalTitle}
										<div class="bg-green-50 border border-green-300 rounded p-3">
											<div class="font-medium text-green-800 text-sm mb-2">📥 Download Queued</div>
											<div class="space-y-1 text-sm">
												<div><span class="font-medium">Final Title:</span> {result.finalTitle}</div>
												{#if result.downloadId}
													<div><span class="font-medium">Download ID:</span> {result.downloadId}</div>
												{/if}
												{#if result.processedFileId}
													<div><span class="font-medium">Processed File ID:</span> {result.processedFileId}</div>
												{/if}
											</div>
										</div>
									{/if}

									<!-- Title Transformation Details -->
									{#if result.matchResult?.parsedData}
										<div class="bg-purple-50 border border-purple-300 rounded p-3">
											<div class="font-medium text-purple-800 text-sm mb-2">🔄 Title Processing</div>
											<div class="space-y-2 text-sm">
												<div class="grid grid-cols-2 gap-2 text-xs">
													<div><span class="font-medium">Original Anime:</span> {result.matchResult.parsedData.originalAnimeTitle || result.matchResult.parsedData.animeTitle}</div>
													<div><span class="font-medium">Transformed Anime:</span> {result.matchResult.parsedData.animeTitle}</div>
													<div><span class="font-medium">Episode:</span> {result.matchResult.parsedData.episodeNumber || 'N/A'}</div>
													<div><span class="font-medium">Release Group:</span> {result.matchResult.parsedData.releaseGroup || 'N/A'}</div>
													<div><span class="font-medium">Quality:</span> {result.matchResult.parsedData.videoResolution || 'N/A'}</div>
												</div>

												{#if result.matchResult.parsedData.titleOverrideApplied}
													<div class="bg-green-100 border border-green-300 rounded p-2 text-xs">
														<div class="font-medium text-green-800">✅ Title Override Applied</div>
														<div>"{result.matchResult.parsedData.originalAnimeTitle}" → "{result.matchResult.parsedData.animeTitle}"</div>
													</div>
												{/if}

												{#if result.matchResult.parsedData.episodeMappingApplied}
													<div class="bg-blue-100 border border-blue-300 rounded p-2 text-xs">
														<div class="font-medium text-blue-800">🔄 Episode Mapping Applied</div>
														<div>Episode {result.matchResult.parsedData.originalEpisodeNumber} → Episode {result.matchResult.parsedData.episodeNumber}</div>
													</div>
												{/if}

												<div class="bg-yellow-100 border border-yellow-300 rounded p-2 text-xs">
													<div class="font-medium text-yellow-800">🎯 Whitelist Search</div>
													<div>Looking for whitelist entry: <span class="font-mono font-bold">"{result.matchResult.parsedData.animeTitle}"</span></div>
												</div>
											</div>
										</div>
									{/if}

									<!-- Whitelist Match Details -->
									{#if result.matchResult?.entry}
										<div class="bg-blue-50 border border-blue-300 rounded p-3">
											<div class="font-medium text-blue-800 text-sm mb-2">🎯 Whitelist Match Found</div>
											<div class="space-y-1 text-sm">
												<div><span class="font-medium">Matched Entry:</span> {result.matchResult.entry.title}</div>
											</div>
										</div>
									{:else if result.status === 'no_match' && result.matchResult?.parsedData}
										<div class="bg-red-50 border border-red-300 rounded p-3">
											<div class="font-medium text-red-800 text-sm mb-2">❌ No Whitelist Match</div>
											<div class="space-y-1 text-sm">
												<div>No whitelist entry found for: <span class="font-mono font-bold">"{result.matchResult.parsedData.animeTitle}"</span></div>
												<div class="text-xs text-red-600 mt-2">
													💡 <strong>Tip:</strong> Add a whitelist entry with the title "{result.matchResult.parsedData.animeTitle}" to download this anime.
												</div>
											</div>
										</div>
									{/if}

									<!-- Technical Details -->
									<div class="bg-gray-50 border border-gray-200 rounded p-3">
										<div class="font-medium text-gray-800 text-sm mb-2">🔧 Technical Details</div>
										<div class="space-y-1 text-xs">
											{#if result.guid}
												<div><span class="font-medium">GUID:</span> <span class="font-mono">{result.guid}</span></div>
											{/if}
											{#if result.link}
												<div><span class="font-medium">Torrent Link:</span> <a href={result.link} target="_blank" class="text-blue-600 hover:underline font-mono">{result.link}</a></div>
											{/if}
											{#if result.pubDate}
												<div><span class="font-medium">Published:</span> {result.pubDate}</div>
											{/if}
											{#if result.rssId}
												<div><span class="font-medium">RSS Entry ID:</span> {result.rssId}</div>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			{/if}

			<!-- Advanced Settings -->
			<Card>
				<CardHeader>
					<CardTitle>Advanced Settings</CardTitle>
					<CardDescription>Advanced torrent and network configuration (only change if you know what you're doing)</CardDescription>
				</CardHeader>
				<CardContent>
					<Collapsible.Root bind:open={advancedSettingsOpen}>
						<Collapsible.Trigger class="flex items-center justify-between w-full p-2 text-left hover:bg-gray-50 rounded">
							<span class="font-medium">Torrent Settings</span>
							{#if advancedSettingsOpen}
								<ChevronDown class="w-4 h-4" />
							{:else}
								<ChevronRight class="w-4 h-4" />
							{/if}
						</Collapsible.Trigger>
						<Collapsible.Content class="space-y-4 pt-4">
							<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
								<p class="text-sm text-yellow-800">
									⚠️ <strong>Warning:</strong> These are advanced settings. Only modify them if you understand their impact on torrent performance and network behavior.
								</p>
							</div>

							<div>
								<Label for="torrentPort" class="py-2">Torrent Port</Label>
								<Input
									id="torrentPort"
									type="number"
									bind:value={settings.torrentPort}
									min="1024"
									max="65535"
									oninput={autoSaveSettings}
								/>
								<p class="text-xs text-gray-500 mt-1">Port used for incoming torrent connections (1024-65535)</p>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="dht"
									bind:checked={settings.enableDHT}
									onCheckedChange={autoSaveSettings}
								/>
								<div>
									<Label for="dht">Enable DHT (Distributed Hash Table)</Label>
									<p class="text-xs text-gray-500">Helps find peers without trackers</p>
								</div>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="pex"
									bind:checked={settings.enablePEX}
									onCheckedChange={autoSaveSettings}
								/>
								<div>
									<Label for="pex">Enable PEX (Peer Exchange)</Label>
									<p class="text-xs text-gray-500">Allows peers to share information about other peers</p>
								</div>
							</div>

							<div class="flex items-center space-x-2">
								<Switch
									id="lsd"
									bind:checked={settings.enableLSD}
									onCheckedChange={autoSaveSettings}
								/>
								<div>
									<Label for="lsd">Enable LSD (Local Service Discovery)</Label>
									<p class="text-xs text-gray-500">Discovers peers on the local network</p>
								</div>
							</div>
						</Collapsible.Content>
					</Collapsible.Root>
				</CardContent>
			</Card>

			<!-- Save Button -->
			<div class="flex justify-end">
				<Button onclick={saveSettings} disabled={saving}>
					{#if saving}
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
						Saving...
					{:else}
						<Save class="w-4 h-4 mr-2" />
						Save Settings
					{/if}
				</Button>
			</div>
		</div>
	{/if}
</div>
