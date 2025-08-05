<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { Trash2, Plus, RefreshCw, Download, Upload } from 'lucide-svelte';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import ipc from '../../ipc';

  interface ExactMatch {
    originalTitle: string;
    newTitle: string;
  }

  interface EpisodeMapping {
    sourceTitle: string;
    sourceEpisodeStart: number;
    sourceEpisodeEnd: number;
    destTitle: string;
    destEpisodeStart: number;
    destEpisodeEnd: number;
    description?: string;
  }

  let isLoading = $state(true);
  let isSaving = $state(false);
  let exactMatches: ExactMatch[] = $state([]);
  let episodeMappings: EpisodeMapping[] = $state([]);
  
  // Form states for adding new overrides
  let newExactMatch = $state({ originalTitle: '', newTitle: '' });
  let newEpisodeMapping = $state({
    sourceTitle: '',
    sourceEpisodeStart: 1,
    sourceEpisodeEnd: 12,
    destTitle: '',
    destEpisodeStart: 1,
    destEpisodeEnd: 12,
    description: ''
  });

  let exactMatchesOpen = $state(true);
  let episodeMappingsOpen = $state(true);

  onMount(async () => {
    await loadUserOverrides();
  });

  async function loadUserOverrides() {
    try {
      isLoading = true;
      const overrides = await ipc.getUserTitleOverrides();
      
      if (overrides?.overrides) {
        // Load exact matches
        exactMatches = Object.entries(overrides.overrides.exact_match || {}).map(([original, newTitle]) => ({
          originalTitle: original,
          newTitle: newTitle as string
        }));

        // Load episode mappings
        episodeMappings = (overrides.overrides.episode_mappings || []).map((mapping: any) => ({
          sourceTitle: mapping.source_title,
          sourceEpisodeStart: mapping.source_episode_start,
          sourceEpisodeEnd: mapping.source_episode_end,
          destTitle: mapping.dest_title,
          destEpisodeStart: mapping.dest_episode_start,
          destEpisodeEnd: mapping.dest_episode_end,
          description: mapping.description || ''
        }));
      }
    } catch (error) {
      console.error('Failed to load user overrides:', error);
      toast.error('Failed to load title overrides');
    } finally {
      isLoading = false;
    }
  }

  async function saveUserOverrides() {
    try {
      isSaving = true;
      
      const overridesData = {
        version: "1.0",
        last_updated: new Date().toISOString(),
        description: "User-specific title overrides for MoeDownloader",
        overrides: {
          exact_match: Object.fromEntries(
            exactMatches.map(match => [match.originalTitle, match.newTitle])
          ),
          episode_mappings: episodeMappings.map(mapping => ({
            source_title: mapping.sourceTitle,
            source_episode_start: mapping.sourceEpisodeStart,
            source_episode_end: mapping.sourceEpisodeEnd,
            dest_title: mapping.destTitle,
            dest_episode_start: mapping.destEpisodeStart,
            dest_episode_end: mapping.destEpisodeEnd,
            description: mapping.description
          }))
        },
        metadata: {
          notes: [
            "This file contains user-specific overrides that take priority over global overrides",
            "Only exact_match and episode_mappings are supported for user overrides",
            "Changes to this file take effect immediately without needing to restart the application",
            "This file is not synced with GitHub - it's local to your installation"
          ]
        }
      };

      await ipc.saveUserTitleOverrides(overridesData);
      toast.success('Title overrides saved successfully');
    } catch (error) {
      console.error('Failed to save user overrides:', error);
      toast.error('Failed to save title overrides');
    } finally {
      isSaving = false;
    }
  }

  function addExactMatch() {
    if (newExactMatch.originalTitle.trim() && newExactMatch.newTitle.trim()) {
      exactMatches = [...exactMatches, { ...newExactMatch }];
      newExactMatch = { originalTitle: '', newTitle: '' };
      saveUserOverrides();
    }
  }

  function removeExactMatch(index: number) {
    exactMatches = exactMatches.filter((_, i) => i !== index);
    saveUserOverrides();
  }

  function addEpisodeMapping() {
    if (newEpisodeMapping.sourceTitle.trim() && newEpisodeMapping.destTitle.trim()) {
      episodeMappings = [...episodeMappings, { ...newEpisodeMapping }];
      newEpisodeMapping = {
        sourceTitle: '',
        sourceEpisodeStart: 1,
        sourceEpisodeEnd: 12,
        destTitle: '',
        destEpisodeStart: 1,
        destEpisodeEnd: 12,
        description: ''
      };
      saveUserOverrides();
    }
  }

  function removeEpisodeMapping(index: number) {
    episodeMappings = episodeMappings.filter((_, i) => i !== index);
    saveUserOverrides();
  }

  async function refreshGlobalOverrides() {
    try {
      await ipc.refreshTitleOverrides();
      toast.success('Global title overrides refreshed');
    } catch (error) {
      console.error('Failed to refresh global overrides:', error);
      toast.error('Failed to refresh global overrides');
    }
  }
</script>

<div class="space-y-6 p-6">
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-2xl font-bold">Title Overrides</h2>
      <p class="text-muted-foreground">Manage custom title transformations and episode mappings</p>
      <p class="text-muted-foreground">If title from fansub is not like on Anilist/MyAnimeList<br> and the app doesn't have overrides yet for that, you can add them here.</p>
    </div>
    <div class="flex gap-2">
      <Button onclick={refreshGlobalOverrides} variant="outline" disabled={isLoading}>
        <RefreshCw class="w-4 h-4 mr-2" />
        Refresh Global
      </Button>
    </div>
  </div>

  {#if isLoading}
    <div class="flex items-center justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  {:else}
    <!-- Exact Match Overrides -->
    <Card>
      <CardHeader>
        <CardTitle>Exact Title Matches</CardTitle>
        <CardDescription>
          Direct string-to-string title replacements. These have the highest priority.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Collapsible.Root bind:open={exactMatchesOpen}>
          <Collapsible.Trigger class="flex items-center justify-between w-full p-2 text-left hover:bg-gray-50 rounded">
            <span class="font-medium">Manage Exact Matches ({exactMatches.length})</span>
          </Collapsible.Trigger>
          <Collapsible.Content class="space-y-4 pt-4">
            <!-- Add new exact match -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-gray-50">
              <div>
                <Label for="originalTitle">Original Title</Label>
                <Input
                  id="originalTitle"
                  bind:value={newExactMatch.originalTitle}
                  placeholder="e.g., Grand Blue S2"
                />
              </div>
              <div>
                <Label for="newTitle">New Title</Label>
                <Input
                  id="newTitle"
                  bind:value={newExactMatch.newTitle}
                  placeholder="e.g., Grand Blue Season 2"
                />
              </div>
              <div class="flex items-end">
                <Button onclick={addExactMatch} disabled={!newExactMatch.originalTitle.trim() || !newExactMatch.newTitle.trim()}>
                  <Plus class="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>
            </div>

            <!-- List existing exact matches -->
            {#if exactMatches.length > 0}
              <div class="space-y-2">
                {#each exactMatches as match, index}
                  <div class="flex items-center justify-between p-3 border rounded-lg">
                    <div class="flex-1">
                      <span class="font-medium">{match.originalTitle}</span>
                      <span class="mx-2 text-muted-foreground">→</span>
                      <span>{match.newTitle}</span>
                    </div>
                    <Button variant="outline" size="sm" onclick={() => removeExactMatch(index)}>
                      <Trash2 class="w-4 h-4" />
                    </Button>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-muted-foreground text-center py-4">No exact matches configured</p>
            {/if}
          </Collapsible.Content>
        </Collapsible.Root>
      </CardContent>
    </Card>

    <!-- Episode Mappings -->
    <Card>
      <CardHeader>
        <CardTitle>Episode Mappings</CardTitle>
        <CardDescription>
          Map episode ranges from one title to another. Useful for handling continuous numbering across seasons.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Collapsible.Root bind:open={episodeMappingsOpen}>
          <Collapsible.Trigger class="flex items-center justify-between w-full p-2 text-left hover:bg-gray-50 rounded">
            <span class="font-medium">Manage Episode Mappings ({episodeMappings.length})</span>
          </Collapsible.Trigger>
          <Collapsible.Content class="space-y-4 pt-4">
            <!-- Add new episode mapping -->
            <div class="p-4 border rounded-lg bg-gray-50 space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label for="sourceTitle">Source Title</Label>
                  <Input
                    id="sourceTitle"
                    bind:value={newEpisodeMapping.sourceTitle}
                    placeholder="e.g., Grand Blue"
                  />
                </div>
                <div>
                  <Label for="destTitle">Destination Title</Label>
                  <Input
                    id="destTitle"
                    bind:value={newEpisodeMapping.destTitle}
                    placeholder="e.g., Grand Blue Season 2"
                  />
                </div>
              </div>
              
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label for="sourceStart">Source Start</Label>
                  <Input
                    id="sourceStart"
                    type="number"
                    bind:value={newEpisodeMapping.sourceEpisodeStart}
                    min="1"
                  />
                </div>
                <div>
                  <Label for="sourceEnd">Source End</Label>
                  <Input
                    id="sourceEnd"
                    type="number"
                    bind:value={newEpisodeMapping.sourceEpisodeEnd}
                    min="1"
                  />
                </div>
                <div>
                  <Label for="destStart">Dest Start</Label>
                  <Input
                    id="destStart"
                    type="number"
                    bind:value={newEpisodeMapping.destEpisodeStart}
                    min="1"
                  />
                </div>
                <div>
                  <Label for="destEnd">Dest End</Label>
                  <Input
                    id="destEnd"
                    type="number"
                    bind:value={newEpisodeMapping.destEpisodeEnd}
                    min="1"
                  />
                </div>
              </div>
              
              <div>
                <Label for="description">Description (Optional)</Label>
                <Input
                  id="description"
                  bind:value={newEpisodeMapping.description}
                  placeholder="e.g., Map episodes 14-25 to Season 2 episodes 1-12"
                />
              </div>
              
              <Button onclick={addEpisodeMapping} disabled={!newEpisodeMapping.sourceTitle.trim() || !newEpisodeMapping.destTitle.trim()}>
                <Plus class="w-4 h-4 mr-2" />
                Add Episode Mapping
              </Button>
            </div>

            <!-- List existing episode mappings -->
            {#if episodeMappings.length > 0}
              <div class="space-y-3">
                {#each episodeMappings as mapping, index}
                  <div class="p-4 border rounded-lg">
                    <div class="flex items-center justify-between mb-2">
                      <div class="font-medium">
                        {mapping.sourceTitle} (eps {mapping.sourceEpisodeStart}-{mapping.sourceEpisodeEnd})
                        →
                        {mapping.destTitle} (eps {mapping.destEpisodeStart}-{mapping.destEpisodeEnd})
                      </div>
                      <Button variant="outline" size="sm" onclick={() => removeEpisodeMapping(index)}>
                        <Trash2 class="w-4 h-4" />
                      </Button>
                    </div>
                    {#if mapping.description}
                      <p class="text-sm text-muted-foreground">{mapping.description}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-muted-foreground text-center py-4">No episode mappings configured</p>
            {/if}
          </Collapsible.Content>
        </Collapsible.Root>
      </CardContent>
    </Card>

    <!-- Information Card -->
    <Card>
      <CardHeader>
        <CardTitle>How It Works</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="text-sm space-y-2">
          <p><strong>Your overrides will take precedence over the app built-in overrides</strong></p>
          <p class="pt-2"><strong>Example:</strong></p>
          <p class="ml-4 text-muted-foreground">
            If you add "Grand Blue S2" → "Grand Blue Season 2" as an exact match,
            any title containing exactly "Grand Blue S2" will be changed to "Grand Blue Season 2".
          </p>
          
          <p class="pt-2"><strong>Episode Mapping Example:</strong></p>
          <p class="ml-4 text-muted-foreground">
            Source: "Grand Blue" episodes 14-25 → Destination: "Grand Blue Season 2" episodes 1-12<br/>
            This means episode 14 becomes episode 1, episode 15 becomes episode 2, etc.
          </p>
        </div>
      </CardContent>
    </Card>
  {/if}
</div>
