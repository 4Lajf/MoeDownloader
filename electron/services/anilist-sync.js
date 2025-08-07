const { createAniListService, MediaListStatus } = require('./anilist-service');
const { 
  anilistAccountOperations, 
  anilistAutoListOperations, 
  anilistAnimeCacheOperations,
  whitelistOperations,
  configOperations
} = require('../lib/database');

/**
 * AniList Synchronization Service
 * Handles automatic synchronization of AniList lists with the download whitelist
 */
function createAniListSyncService(notificationService, sharedAniListService = null) {
  let syncInterval = null;
  let isSyncing = false;
  let anilistService = sharedAniListService;

  const service = {
    /**
     * Initialize the sync service
     */
    async initialize() {
      try {
        // Use shared instance if provided, otherwise create new one
        if (!anilistService) {
          anilistService = createAniListService();
          await anilistService.initialize();
        }

        // Start periodic sync
        this.startPeriodicSync();

        // Perform initial sync on app launch if user is authenticated and has enabled lists
        if (anilistService.isAuthenticated()) {
          const enabledLists = anilistAutoListOperations.getEnabled();
          if (enabledLists.length > 0) {
            console.log('Performing initial AniList sync on app launch...');
            // Run sync in background without blocking initialization
            setTimeout(async () => {
              try {
                await this.syncAllLists();
                console.log('Initial AniList sync completed');
              } catch (error) {
                console.error('Initial AniList sync failed:', error);
              }
            }, 2000); // Wait 2 seconds after app initialization
          }
        }

        console.log('AniList sync service initialized');
        return { success: true };
      } catch (error) {
        console.error('Failed to initialize AniList sync service:', error);
        throw error;
      }
    },

    /**
     * Start periodic synchronization
     */
    startPeriodicSync() {
      // Clear existing interval
      if (syncInterval) {
        clearInterval(syncInterval);
      }

      // Get sync interval from config (default: 4 hours)
      const intervalHours = parseInt(configOperations.get('anilist_sync_interval_hours') || '4');
      const intervalMs = intervalHours * 60 * 60 * 1000;

      // Start interval
      syncInterval = setInterval(async () => {
        try {
          await this.syncAllLists();
        } catch (error) {
          console.error('Periodic sync failed:', error);
        }
      }, intervalMs);

      console.log(`AniList periodic sync started (every ${intervalHours} hours)`);
    },

    /**
     * Stop periodic synchronization
     */
    stopPeriodicSync() {
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('AniList periodic sync stopped');
      }
    },

    /**
     * Sync all enabled auto-download lists
     */
    async syncAllLists() {
      if (isSyncing) {
        console.log('Sync already in progress, skipping');
        return;
      }

      try {
        isSyncing = true;
        console.log('Starting AniList sync...');

        // Get all enabled auto-download lists
        const enabledLists = anilistAutoListOperations.getEnabled();
        
        if (enabledLists.length === 0) {
          console.log('No enabled auto-download lists found');
          return;
        }

        let totalSynced = 0;
        let totalErrors = 0;

        for (const listConfig of enabledLists) {
          try {
            const synced = await this.syncList(listConfig);
            totalSynced += synced;
          } catch (error) {
            console.error(`Failed to sync list ${listConfig.list_status} for user ${listConfig.username}:`, error);
            totalErrors++;
          }
        }

        console.log(`AniList sync completed: ${totalSynced} entries synced, ${totalErrors} errors`);

        if (notificationService && totalSynced > 0) {
          notificationService.anilistSyncCompleted({ totalSynced, totalErrors });
        }

      } catch (error) {
        console.error('AniList sync failed:', error);
        if (notificationService) {
          notificationService.anilistSyncFailed(error.message || 'Unknown error');
        }
      } finally {
        isSyncing = false;
      }
    },

    /**
     * Sync a specific list configuration
     * @param {Object} listConfig - Auto-download list configuration
     * @returns {number} - Number of entries synced
     */
    async syncList(listConfig) {
      console.log(`Syncing ${listConfig.list_status} list for user ${listConfig.username}`);

      // Get the user's anime list from AniList
      const collection = await anilistService.getUserAnimeList(listConfig.user_id, listConfig.list_status);
      
      if (!collection || !collection.lists) {
        console.log(`No lists found for status ${listConfig.list_status}`);
        return 0;
      }

      // Extract all entries from the collection
      const entries = [];
      for (const list of collection.lists) {
        if (list.entries) {
          entries.push(...list.entries);
        }
      }

      console.log(`Found ${entries.length} entries in ${listConfig.list_status} list`);

      let syncedCount = 0;

      for (const entry of entries) {
        try {
          const synced = await this.syncAnimeEntry(entry, listConfig);
          if (synced) {
            syncedCount++;
          }
        } catch (error) {
          console.error(`Failed to sync anime entry ${entry.media.id}:`, error);
        }
      }

      // Clean up removed entries
      await this.cleanupRemovedEntries(entries, listConfig);

      return syncedCount;
    },

    /**
     * Sync a single anime entry
     * @param {Object} entry - AniList media list entry
     * @param {Object} listConfig - Auto-download list configuration
     * @returns {boolean} - True if entry was synced
     */
    async syncAnimeEntry(entry, listConfig) {
      const media = entry.media;
      
      // Cache anime data
      await this.cacheAnimeData(media);

      // Get the best title to use for whitelist (romaji preferred)
      const title = this.getBestTitle(media);
      if (!title) {
        console.log(`No suitable title found for anime ${media.id}`);
        return false;
      }

      // Get all title variants for enhanced matching
      const titleVariants = this.getAllTitleVariants(media);

      // Check if this entry already exists in whitelist
      const existingEntry = whitelistOperations.getAll().find(w => 
        w.anilist_id === media.id && 
        w.anilist_account_id === listConfig.account_id &&
        w.source_type === 'anilist'
      );

      if (existingEntry) {
        // Update existing entry if needed, but preserve user's quality and preferred_group settings
        const updates = {
          title: title,
          // Only update quality and preferred_group if they match the default list config values
          // This preserves user customizations
          quality: existingEntry.quality || listConfig.quality,
          preferred_group: existingEntry.preferred_group || listConfig.preferred_group,
          enabled: 1,
          auto_sync: 1,
          source_type: 'anilist',
          anilist_id: media.id,
          anilist_account_id: listConfig.account_id,
          // Store all title variants for enhanced matching
          title_romaji: titleVariants.romaji,
          title_english: titleVariants.english,
          title_synonyms: titleVariants.synonyms,
          updated_at: new Date().toISOString()
        };

        // Check if update is needed (excluding quality and preferred_group from comparison to preserve user settings)
        const needsUpdate = existingEntry.title !== title ||
                           existingEntry.enabled !== 1 ||
                           existingEntry.auto_sync !== 1 ||
                           existingEntry.title_romaji !== titleVariants.romaji ||
                           existingEntry.title_english !== titleVariants.english ||
                           JSON.stringify(existingEntry.title_synonyms) !== JSON.stringify(titleVariants.synonyms);

        if (needsUpdate) {
          whitelistOperations.update(existingEntry.id, updates);
          console.log(`Updated whitelist entry for: ${title}`);
          return true;
        }
        return false;
      } else {
        // Add new entry
        try {
          whitelistOperations.add({
            title: title,
            keywords: '',
            exclude_keywords: '',
            quality: listConfig.quality,
            enabled: true,
            preferred_group: listConfig.preferred_group,
            source_type: 'anilist',
            anilist_id: media.id,
            anilist_account_id: listConfig.account_id,
            auto_sync: true,
            // Store all title variants for enhanced matching
            title_romaji: titleVariants.romaji,
            title_english: titleVariants.english,
            title_synonyms: titleVariants.synonyms
          });

          console.log(`Added whitelist entry for: ${title} (romaji: ${titleVariants.romaji}, english: ${titleVariants.english})`);
          return true;
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            // Title already exists as manual entry, skip
            console.log(`Title already exists in whitelist: ${title}`);
            return false;
          }
          throw error;
        }
      }
    },

    /**
     * Cache anime data for faster lookups
     * @param {Object} media - AniList media object
     */
    async cacheAnimeData(media) {
      try {
        const cacheData = {
          anilist_id: media.id,
          title_romaji: media.title?.romaji || '',
          title_english: media.title?.english || '',
          title_native: media.title?.native || '',
          synonyms: media.synonyms || [],
          format: media.format || '',
          status: media.status || '',
          episodes: media.episodes || 0,
          season: media.season || '',
          season_year: media.seasonYear || 0,
          average_score: media.averageScore || 0,
          genres: media.genres || [],
          cover_image_url: media.coverImage?.large || media.coverImage?.medium || '',
          banner_image_url: media.bannerImage || ''
        };

        anilistAnimeCacheOperations.upsert(cacheData);
      } catch (error) {
        console.error('Failed to cache anime data:', error);
      }
    },

    /**
     * Get the best title to use for whitelist matching
     * @param {Object} media - AniList media object
     * @returns {string} - Best title or null
     */
    getBestTitle(media) {
      const titles = media.title || {};

      // Prefer romaji title first, then English, then native
      return titles.romaji || titles.english || titles.native || null;
    },

    /**
     * Get all title variants for enhanced matching
     * @param {Object} media - AniList media object
     * @returns {Object} - Object containing all title variants
     */
    getAllTitleVariants(media) {
      const titles = media.title || {};
      return {
        romaji: titles.romaji || null,
        english: titles.english || null,
        synonyms: media.synonyms || []
      };
    },

    /**
     * Clean up whitelist entries that were removed from AniList
     * @param {Array} currentEntries - Current entries from AniList
     * @param {Object} listConfig - Auto-download list configuration
     */
    async cleanupRemovedEntries(currentEntries, listConfig) {
      try {
        // Get all auto-synced entries for this account and list status
        const whitelistEntries = whitelistOperations.getAll().filter(w => 
          w.source_type === 'anilist' &&
          w.anilist_account_id === listConfig.account_id &&
          w.auto_sync === 1
        );

        const currentAnilistIds = new Set(currentEntries.map(e => e.media.id));
        
        for (const whitelistEntry of whitelistEntries) {
          if (whitelistEntry.anilist_id && !currentAnilistIds.has(whitelistEntry.anilist_id)) {
            // This entry was removed from AniList, remove from whitelist
            whitelistOperations.delete(whitelistEntry.id);
            console.log(`Removed whitelist entry for removed anime: ${whitelistEntry.title}`);
          }
        }
      } catch (error) {
        console.error('Failed to cleanup removed entries:', error);
      }
    },

    /**
     * Force sync all lists immediately
     */
    async forceSyncAll() {
      return await this.syncAllLists();
    },

    /**
     * Check if sync is currently running
     */
    isSyncRunning() {
      return isSyncing;
    },

    /**
     * Get sync status
     */
    getSyncStatus() {
      return {
        isRunning: isSyncing,
        hasPeriodicSync: !!syncInterval,
        intervalHours: parseInt(configOperations.get('anilist_sync_interval_hours') || '4')
      };
    }
  };

  return service;
}

module.exports = { createAniListSyncService };
