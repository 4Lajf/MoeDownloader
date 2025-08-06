<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Switch } from '$lib/components/ui/switch';
  import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { Trash2, ExternalLink, RefreshCw, Settings } from 'lucide-svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import ipc from '../../ipc';

  let isAuthenticated = false;
  let currentUser: any = null;
  let accounts: any[] = [];
  let activeAccount: any = null;
  let autoLists: any[] = [];
  let isLoading = false;
  let authInProgress = false;
  let syncStatus: any = null;
  let syncInterval = 4; // hours

  // OAuth configuration for implicit grant
  let accessToken = '';

  // Confirmation dialog state
  let confirmDialog = {
    open: false,
    title: '',
    description: '',
    onConfirm: () => {}
  };

  // Sync prompt dialog state
  let showSyncPrompt = false;
  let selectedSyncLists = new Set(['CURRENT']); // Default to CURRENT list

  // Available list statuses
  const listStatuses = [
    { value: 'CURRENT', label: 'Currently Watching', description: 'Anime you are currently watching' },
    { value: 'PLANNING', label: 'Plan to Watch', description: 'Anime you plan to watch' },
    { value: 'COMPLETED', label: 'Completed', description: 'Anime you have finished watching' },
    { value: 'DROPPED', label: 'Dropped', description: 'Anime you dropped' },
    { value: 'PAUSED', label: 'Paused', description: 'Anime you paused watching' }
  ];

  // Quality options
  const qualityOptions = ['480p', '720p', '1080p', '1440p', '2160p'];
  
  // Release group options
  const groupOptions = ['any', 'SubsPlease', 'Erai-raws', 'HorribleSubs', 'Commie'];

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    try {
      isLoading = true;
      
      // Check authentication status
      isAuthenticated = await ipc.anilistIsAuthenticated();

      if (isAuthenticated) {
        currentUser = await ipc.anilistGetCurrentUser();
      }

      // Load accounts and auto-lists
      accounts = await ipc.anilistAccountsGetAll();
      activeAccount = await ipc.anilistAccountsGetActive();

      if (activeAccount) {
        autoLists = await ipc.anilistAutoListsGetByAccount(activeAccount.id);
      }

      // Load sync status
      syncStatus = await ipc.anilistSyncGetStatus();
      syncInterval = syncStatus?.intervalHours || 4;

    } catch (error) {
      console.error('Failed to load AniList data:', error);
      toast.error('Failed to load AniList data');
    } finally {
      isLoading = false;
    }
  }

  async function startAuthentication() {
    try {
      authInProgress = true;
      const authUrl = await ipc.anilistGetAuthUrl();

      // Open auth URL in external browser
      await ipc.openExternal(authUrl);

      toast.info('Please complete authentication in your browser, then copy the access token from the page and paste it below');
    } catch (error) {
      console.error('Failed to start authentication:', error);
      toast.error('Failed to start authentication');
    } finally {
      authInProgress = false;
    }
  }

  async function completeAuthentication() {
    if (!accessToken.trim()) {
      toast.error('Please enter the access token');
      return;
    }

    try {
      isLoading = true;
      const result = await ipc.anilistStoreToken(accessToken);

      if (result.success) {
        toast.success(`Successfully authenticated as ${result.user.name}`);
        await loadData();
        accessToken = ''; // Clear the token input

        // Show sync prompt after successful authentication
        showSyncPrompt = true;
      } else {
        toast.error('Authentication failed: ' + result.error);
      }
    } catch (error) {
      console.error('Authentication failed:', error);
      toast.error('Authentication failed: ' + (error as Error).message);
    } finally {
      isLoading = false;
    }
  }

  async function logout() {
    try {
      await ipc.anilistLogout();
      toast.success('Logged out successfully');
      await loadData();
    } catch (error) {
      console.error('Logout failed:', error);
      toast.error('Logout failed');
    }
  }

  function confirmDeleteAccount(accountId: number) {
    confirmDialog = {
      open: true,
      title: 'Delete Account',
      description: 'Are you sure you want to delete this account?',
      onConfirm: () => deleteAccount(accountId)
    };
  }

  async function deleteAccount(accountId: number) {
    try {
      await ipc.anilistAccountsDelete(accountId);
      toast.success('Account deleted successfully');
      await loadData();
    } catch (error) {
      console.error('Failed to delete account:', error);
      toast.error('Failed to delete account');
    }
  }

  async function setActiveAccount(accountId: number) {
    try {
      await ipc.anilistAccountsSetActive(accountId);
      toast.success('Active account changed');
      await loadData();
    } catch (error) {
      console.error('Failed to set active account:', error);
      toast.error('Failed to set active account');
    }
  }

  async function addAutoList(status: string) {
    if (!activeAccount) {
      toast.error('No active account selected');
      return;
    }

    try {
      await ipc.anilistAutoListsUpsert({
        account_id: activeAccount.id,
        list_status: status,
        enabled: true,
        quality: '1080p',
        preferred_group: 'any'
      });

      toast.success(`Added ${status} list to auto-download`);
      await loadData();
    } catch (error) {
      console.error('Failed to add auto-list:', error);
      toast.error('Failed to add auto-list');
    }
  }

  async function updateAutoList(listId: number, updates: any) {
    try {
      const list = autoLists.find(l => l.id === listId);
      if (!list) return;

      await ipc.anilistAutoListsUpsert({
        ...list,
        ...updates
      });

      await loadData();
    } catch (error) {
      console.error('Failed to update auto-list:', error);
      toast.error('Failed to update auto-list');
    }
  }

  async function toggleAutoList(listId: number, enabled: boolean) {
    try {
      await ipc.anilistAutoListsToggle(listId, enabled);
      await loadData();
    } catch (error) {
      console.error('Failed to toggle auto-list:', error);
      toast.error('Failed to toggle auto-list');
    }
  }

  function confirmDeleteAutoList(listId: number) {
    confirmDialog = {
      open: true,
      title: 'Remove Auto-Download List',
      description: 'Are you sure you want to remove this auto-download list?',
      onConfirm: () => deleteAutoList(listId)
    };
  }

  async function deleteAutoList(listId: number) {
    try {
      await ipc.anilistAutoListsDelete(listId);
      toast.success('Auto-download list removed');
      await loadData();
    } catch (error) {
      console.error('Failed to delete auto-list:', error);
      toast.error('Failed to delete auto-list');
    }
  }



  async function forceSyncAll() {
    try {
      isLoading = true;
      await ipc.anilistSyncForceAll();
      toast.success('AniList sync completed successfully');
      await loadData();
    } catch (error) {
      console.error('Failed to sync AniList:', error);
      toast.error('Failed to sync AniList');
    } finally {
      isLoading = false;
    }
  }

  async function updateSyncInterval(newInterval: number) {
    try {
      await ipc.setConfig('anilist_sync_interval_hours', newInterval.toString());
      syncInterval = newInterval;

      // Restart periodic sync with new interval
      await ipc.anilistSyncStopPeriodic();
      await ipc.anilistSyncStartPeriodic();

      toast.success(`Sync interval updated to ${newInterval} hours`);
    } catch (error) {
      console.error('Failed to update sync interval:', error);
      toast.error('Failed to update sync interval');
    }
  }

  // Sync prompt functions
  function toggleSyncList(status: string) {
    if (selectedSyncLists.has(status)) {
      selectedSyncLists.delete(status);
    } else {
      selectedSyncLists.add(status);
    }
    selectedSyncLists = new Set(selectedSyncLists); // Trigger reactivity
  }

  async function confirmSyncSetup() {
    if (selectedSyncLists.size === 0) {
      toast.error('Please select at least one list to sync');
      return;
    }

    try {
      isLoading = true;

      // Reload data to ensure we have the latest account info
      await loadData();

      if (!activeAccount) {
        toast.error('No active account found. Please try logging in again.');
        return;
      }

      // Add selected lists to auto-download configuration
      for (const status of selectedSyncLists) {
        await ipc.anilistAutoListsUpsert({
          account_id: activeAccount.id,
          list_status: status,
          enabled: true,
          quality: '1080p',
          preferred_group: 'any'
        });
      }

      // Perform initial sync
      await ipc.anilistSyncForceAll();

      toast.success('AniList synchronization setup completed successfully');
      showSyncPrompt = false;
      await loadData();
    } catch (error) {
      console.error('Failed to setup sync:', error);
      toast.error('Failed to setup synchronization');
    } finally {
      isLoading = false;
    }
  }

  function skipSyncSetup() {
    showSyncPrompt = false;
    toast.info('You can configure synchronization later in the settings');
  }


</script>

<div class="space-y-6 p-6">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-2xl font-bold">AniList Integration</h2>
      <p class="text-muted-foreground">Connect your AniList account to automatically download anime from your lists</p>
    </div>
    <div class="flex gap-2">
      {#if isAuthenticated}
        <Button onclick={forceSyncAll} variant="outline-purple" disabled={isLoading}>
          <RefreshCw class="w-4 h-4 mr-2" />
          Sync Now
        </Button>
      {/if}
    </div>
  </div>

  {#if !isAuthenticated}
    <!-- Authentication Section -->
    <Card>
      <CardContent class="space-y-4">
        <div class="space-y-4">
          <div class="bg-blue-950/30 dark:bg-blue-950/50 border border-blue-800/30 dark:border-blue-700/50 rounded-lg p-4">
            <h4 class="font-medium text-blue-100 dark:text-blue-200 mb-2">How to authenticate:</h4>
            <ol class="text-sm text-blue-200 dark:text-blue-300 space-y-1 list-decimal list-inside">
              <li>Click "Start Authentication" to open AniList in your browser</li>
              <li>Log in to AniList and approve the application</li>
              <li>Paste the code into field below and click "Complete"</li>
            </ol>
          </div>

          <Button variant="info" onclick={startAuthentication} disabled={authInProgress}>
            {#if authInProgress}
              <RefreshCw class="w-4 h-4 mr-2 animate-spin" />
              Starting Authentication...
            {:else}
              <ExternalLink class="w-4 h-4 mr-2" />
              Start Authentication
            {/if}
          </Button>

          <div class="space-y-2">
            <Label for="accessToken">Access Token</Label>
            <div class="flex gap-2">
              <Input
                id="accessToken"
                type="password"
                bind:value={accessToken}
                placeholder="Paste your access token here"
                disabled={isLoading}
              />
              <Button variant="success" onclick={completeAuthentication} disabled={isLoading || !accessToken.trim()}>
                {#if isLoading}
                  <RefreshCw class="w-4 h-4 mr-2 animate-spin" />
                  Authenticating...
                {:else}
                  Complete
                {/if}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  {:else}
    <!-- Authenticated User Section -->
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center justify-between">
          <span>Connected Account</span>
          <Button variant="outline-destructive" size="sm" onclick={logout}>
            Logout
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {#if currentUser}
          <div class="flex items-center space-x-4">
            {#if currentUser.avatar?.large}
              <img src={currentUser.avatar.large} alt="Avatar" class="w-12 h-12 rounded-full" />
            {/if}
            <div>
              <h3 class="font-semibold">{currentUser.name}</h3>
              {#if currentUser.statistics?.anime}
                <p class="text-sm text-muted-foreground">
                  {currentUser.statistics.anime.count} anime watched • 
                  {Math.round(currentUser.statistics.anime.minutesWatched / 60)} hours
                </p>
              {/if}
            </div>
          </div>
        {/if}
      </CardContent>
    </Card>

    <!-- Auto-Download Lists Section -->
    {#if activeAccount}
      <Card>
        <CardHeader>
          <CardTitle class="flex items-center justify-between">
            <span>Auto-Download Lists</span>
            <div class="flex gap-2">
              <Select type="single" onValueChange={(value: string) => addAutoList(value)}>
                <SelectTrigger class="w-48">
                  Add list...
                </SelectTrigger>
                <SelectContent>
                  {#each listStatuses as status}
                    {#if !autoLists.some(list => list.list_status === status.value)}
                      <SelectItem value={status.value}>
                        {status.label}
                      </SelectItem>
                    {/if}
                  {/each}
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
          <CardDescription>
            Configure which AniList lists should automatically add anime to your download whitelist
          </CardDescription>
        </CardHeader>
        <CardContent>
          {#if autoLists.length === 0}
            <div class="text-center py-8 text-muted-foreground">
              <Settings class="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No auto-download lists configured</p>
              <p class="text-sm">Add a list above to get started</p>
            </div>
          {:else}
            <div class="space-y-4">
              {#each autoLists as list}
                {@const statusInfo = listStatuses.find(s => s.value === list.list_status)}
                <div class="border rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center space-x-3">
                      <Switch
                        checked={list.enabled}
                        onCheckedChange={(checked) => toggleAutoList(list.id, checked)}
                      />
                      <div>
                        <h4 class="font-medium">{statusInfo?.label || list.list_status}</h4>
                        <p class="text-sm text-muted-foreground">{statusInfo?.description}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => confirmDeleteAutoList(list.id)}
                      class="text-muted-foreground hover:text-red-700 hover:bg-red-700/10 dark:hover:bg-red-600/10 dark:hover:text-red-300 transition-all duration-200"
                    >
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>

                  {#if list.enabled}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t">
                      <div class="space-y-2">
                        <Label>Quality Preference</Label>
                        <Select
                          type="single"
                          value={list.quality}
                          onValueChange={(value: string) => updateAutoList(list.id, { quality: value })}
                        >
                          <SelectTrigger>
                            {list.quality || 'Select quality...'}
                          </SelectTrigger>
                          <SelectContent>
                            {#each qualityOptions as quality}
                              <SelectItem value={quality}>{quality}</SelectItem>
                            {/each}
                          </SelectContent>
                        </Select>
                      </div>

                      <div class="space-y-2">
                        <Label>Preferred Release Group</Label>
                        <Select
                          type="single"
                          value={list.preferred_group}
                          onValueChange={(value: string) => updateAutoList(list.id, { preferred_group: value })}
                        >
                          <SelectTrigger>
                            {list.preferred_group === 'any' ? 'Any Group' : list.preferred_group || 'Select group...'}
                          </SelectTrigger>
                          <SelectContent>
                            {#each groupOptions as group}
                              <SelectItem value={group}>
                                {group === 'any' ? 'Any Group' : group}
                              </SelectItem>
                            {/each}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </CardContent>
      </Card>

      <!-- Sync Configuration Section -->
      <Card>
        <CardHeader>
          <CardTitle>Sync Configuration</CardTitle>
          <CardDescription>
            Configure how often the app should sync with your AniList account
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label>Sync Interval</Label>
              <Select
                type="single"
                value={syncInterval.toString()}
                onValueChange={(value: string) => updateSyncInterval(parseInt(value))}
              >
                <SelectTrigger>
                  {syncInterval === 1 ? 'Every hour' :
                   syncInterval === 2 ? 'Every 2 hours' :
                   syncInterval === 4 ? 'Every 4 hours' :
                   syncInterval === 6 ? 'Every 6 hours' :
                   syncInterval === 12 ? 'Every 12 hours' :
                   syncInterval === 24 ? 'Once daily' :
                   `Every ${syncInterval} hours`}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every hour</SelectItem>
                  <SelectItem value="2">Every 2 hours</SelectItem>
                  <SelectItem value="4">Every 4 hours</SelectItem>
                  <SelectItem value="6">Every 6 hours</SelectItem>
                  <SelectItem value="12">Every 12 hours</SelectItem>
                  <SelectItem value="24">Once daily</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label>Sync Status</Label>
              <div class="flex items-center space-x-2">
                {#if syncStatus?.isRunning}
                  <Badge variant="secondary">
                    <RefreshCw class="w-3 h-3 mr-1 animate-spin" />
                    Syncing...
                  </Badge>
                {:else if syncStatus?.hasPeriodicSync}
                  <Badge variant="default">
                    Active (every {syncStatus.intervalHours}h)
                  </Badge>
                {:else}
                  <Badge variant="outline">
                    Inactive
                  </Badge>
                {/if}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    {/if}

    <!-- Information Section -->
    <Card>
      <CardHeader>
        <CardTitle>How It Works</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <h4 class="font-medium">Automatic Synchronization</h4>
          <p class="text-sm text-muted-foreground">
            The app will periodically check your selected AniList lists and automatically add new anime to your download whitelist.
            This happens every few hours and when you start the application.
          </p>
        </div>

        <Separator />

        <div class="space-y-2">
          <h4 class="font-medium">Episode Mapping</h4>
          <p class="text-sm text-muted-foreground">
            The app uses anime relations data to handle cases where fansub groups use continuous numbering across seasons.
            For example, if Fate/Zero Season 2 episodes are numbered 14-25 instead of 1-12, the app will correctly identify them.
          </p>
        </div>

        <Separator />

        <div class="space-y-2">
          <h4 class="font-medium">Manual Override</h4>
          <p class="text-sm text-muted-foreground">
            You can still manually add or remove entries from your whitelist. Auto-synced entries will be marked as such
            and can be distinguished from manual entries.
          </p>
        </div>
      </CardContent>
    </Card>
  {/if}
</div>

<!-- Sync Setup Prompt Dialog -->
{#if showSyncPrompt}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <Card class="w-full max-w-md mx-4">
      <CardHeader>
        <CardTitle>Setup AniList Synchronization</CardTitle>
        <CardDescription>
          Choose which lists you want to automatically sync to your download whitelist
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-3">
          {#each listStatuses as status}
            <div class="flex items-center space-x-3">
              <input
                type="checkbox"
                id="sync-{status.value}"
                checked={selectedSyncLists.has(status.value)}
                onchange={() => toggleSyncList(status.value)}
                class="w-4 h-4 text-primary bg-background border-border rounded focus:ring-primary focus:ring-2"
              />
              <div class="flex-1">
                <Label for="sync-{status.value}" class="font-medium cursor-pointer">
                  {status.label}
                </Label>
                <p class="text-sm text-muted-foreground">
                  {status.description}
                </p>
              </div>
            </div>
          {/each}
        </div>

        <div class="bg-blue-950/30 dark:bg-blue-950/50 border border-blue-800/30 dark:border-blue-700/50 rounded-lg p-3">
          <p class="text-sm text-blue-200 dark:text-blue-300">
            <strong>Note:</strong> Auto-synced entries will appear at the bottom of your whitelist with the title locked.
            You can still edit quality and sub group preferences.
          </p>
        </div>
      </CardContent>
      <CardFooter class="flex gap-2">
        <Button onclick={confirmSyncSetup} variant="success" disabled={isLoading}>
          {#if isLoading}
            <RefreshCw class="w-4 h-4 mr-2 animate-spin" />
          {/if}
          Setup Sync
        </Button>
        <Button onclick={skipSyncSetup} variant="outline" disabled={isLoading}>
          Skip for Now
        </Button>
      </CardFooter>
    </Card>
  </div>
{/if}

<ConfirmDialog
  bind:open={confirmDialog.open}
  title={confirmDialog.title}
  description={confirmDialog.description}
  onConfirm={confirmDialog.onConfirm}
/>
