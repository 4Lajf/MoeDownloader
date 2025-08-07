const { get } = require('../lib/http-client');
const fs = require('fs');
const path = require('path');
const { configOperations } = require('../lib/database');

// Placeholder URL - replace with your actual GitHub repository URL
const TITLE_OVERRIDES_URL = 'https://raw.githubusercontent.com/4Lajf/MoeDownloader-assets/refs/heads/main/title-overrides.jsonc';
const USER_OVERRIDES_FILE = 'user-title-overrides.json';

/**
 * Title Overrides Manager
 * Handles fetching, caching, and applying custom title overrides for AniList compatibility
 */
function createTitleOverridesManager() {
  let globalOverridesData = null;
  let userOverridesData = null;
  let lastFetchTime = null;
  let periodicRefreshInterval = null;

  const manager = {
    /**
     * Initialize the title overrides manager
     */
    async initialize() {
      try {
        // Load existing global overrides from config
        await this.loadGlobalOverridesFromConfig();

        // Load user overrides from local file
        await this.loadUserOverrides();

        // Fetch fresh global data on startup
        console.log('🔄 Fetching global title overrides on app startup...');
        await this.fetchAndParseOverrides();

        // Start periodic refresh every 6 hours (only for global overrides)
        this.startPeriodicRefresh();

        console.log('✅ Title overrides manager initialized successfully');
      } catch (error) {
        console.error('❌ Failed to initialize title overrides manager:', error);
        // Continue with cached data if available
        if (!globalOverridesData && !userOverridesData) {
          console.log('⚠️  No title overrides available, continuing without overrides');
        }
      }
    },

    /**
     * Start periodic refresh of title overrides
     */
    startPeriodicRefresh() {
      if (periodicRefreshInterval) {
        clearInterval(periodicRefreshInterval);
      }

      // Refresh every 6 hours
      periodicRefreshInterval = setInterval(async () => {
        try {
          console.log('🔄 Periodic title overrides refresh...');
          await this.fetchAndParseOverrides();
        } catch (error) {
          console.error('❌ Periodic title overrides refresh failed:', error);
        }
      }, 6 * 60 * 60 * 1000);
    },

    /**
     * Stop periodic refresh
     */
    stopPeriodicRefresh() {
      if (periodicRefreshInterval) {
        clearInterval(periodicRefreshInterval);
        periodicRefreshInterval = null;
      }
    },

    /**
     * Fetch and parse title overrides from the remote source
     */
    async fetchAndParseOverrides() {
      try {
        console.log('Fetching title overrides data...');
        const response = await get(TITLE_OVERRIDES_URL, {
          headers: {
            'Cache-Control': 'no-cache'
          }
        });

        // Parse JSONC (JSON with Comments)
        console.log('🔧 Parsing global title overrides as JSONC format...');
        const parsedData = this.parseJSONC(response.data);

        // Validate the response structure
        if (!this.validateOverridesData(parsedData)) {
          throw new Error('Invalid title overrides data structure');
        }

        globalOverridesData = parsedData;
        lastFetchTime = new Date();

        // Save to config for caching
        await this.saveGlobalOverridesToConfig(globalOverridesData);

        // Update last fetch time
        if (configOperations && typeof configOperations.set === 'function') {
          configOperations.set('title_overrides_last_fetch', lastFetchTime.toISOString());
        }

        console.log(`✅ Loaded global title overrides with ${this.getGlobalOverridesCount()} total rules`);
        return globalOverridesData;
      } catch (error) {
        console.error('❌ Failed to fetch title overrides:', error);
        throw error;
      }
    },

    /**
     * Parse JSONC (JSON with Comments) format
     */
    parseJSONC(text) {
      try {
        // Step 1: Remove single-line comments (// ...) but preserve strings
        let cleanText = text.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/gm, (match, string) => {
          return string || ''; // Keep strings, remove comments
        });

        // Step 2: Remove multi-line comments (/* ... */) but preserve strings
        cleanText = cleanText.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (match, string) => {
          return string || ''; // Keep strings, remove comments
        });

        // Step 3: Remove trailing commas before closing brackets/braces
        cleanText = cleanText.replace(/,(\s*[}\]])/g, '$1');

        // Step 4: Clean up extra whitespace left by comment removal
        cleanText = cleanText.replace(/\n\s*\n/g, '\n'); // Remove empty lines

        console.log('🔧 JSONC parsing completed, attempting JSON.parse...');
        return JSON.parse(cleanText);
      } catch (error) {
        console.error('❌ JSONC parsing failed:', error.message);
        console.error('❌ Problematic content around:', text.substring(0, 200) + '...');
        throw new Error(`JSONC parsing failed: ${error.message}`);
      }
    },

    /**
     * Validate the structure of title overrides data
     */
    validateOverridesData(data) {
      if (!data) {
        console.error('❌ Validation failed: No data provided');
        return false;
      }



      if (!data.overrides) {
        console.error('❌ Validation failed: Missing overrides field');
        return false;
      }

      if (typeof data.overrides !== 'object') {
        console.error('❌ Validation failed: overrides field is not an object');
        return false;
      }

      console.log('✅ Title overrides data validation passed');
      return true;
    },

    /**
     * Load user overrides from local file
     */
    async loadUserOverrides() {
      try {
        console.log(`🔍 Checking for user overrides file: ${USER_OVERRIDES_FILE}`);
        console.log(`🔍 File exists: ${fs.existsSync(USER_OVERRIDES_FILE)}`);

        if (fs.existsSync(USER_OVERRIDES_FILE)) {
          const content = fs.readFileSync(USER_OVERRIDES_FILE, 'utf8');
          console.log('🔧 Parsing user title overrides as JSONC format...');
          const parsedData = this.parseJSONC(content);

          if (this.validateUserOverridesData(parsedData)) {
            userOverridesData = parsedData;
            console.log(`📦 Loaded user title overrides successfully`);

            // Debug: Show what was loaded
            if (parsedData.overrides && parsedData.overrides.exact_match) {
              const exactMatches = Object.entries(parsedData.overrides.exact_match);
              console.log(`  📝 Loaded ${exactMatches.length} exact matches:`);
              exactMatches.forEach(([original, override]) => {
                console.log(`    "${original}" -> "${override}"`);
              });
            }
          } else {
            console.warn('⚠️  Invalid user overrides data structure, ignoring user overrides');
            userOverridesData = null;
          }
        } else {
          console.log('ℹ️  No user overrides file found, using only global overrides');
          userOverridesData = null;
        }
      } catch (error) {
        console.error('❌ Error loading user overrides:', error);
        console.error('❌ Error details:', error.stack);
        userOverridesData = null;
      }
    },

    /**
     * Validate user overrides data structure (only supports exact_match and episode_overrides)
     */
    validateUserOverridesData(data) {
      return data &&
             data.overrides &&
             typeof data.overrides === 'object';
    },

    /**
     * Get total count of global override rules
     */
    getGlobalOverridesCount() {
      if (!globalOverridesData || !globalOverridesData.overrides) return 0;

      const exact = Object.keys(globalOverridesData.overrides.exact_match || {}).length;
      const patterns = (globalOverridesData.overrides.pattern_match || []).length;
      const anilist = Object.keys(globalOverridesData.overrides.anilist_specific || {}).length;
      const groups = Object.values(globalOverridesData.overrides.group_specific || {})
        .reduce((sum, groupOverrides) => sum + Object.keys(groupOverrides).length, 0);

      return exact + patterns + anilist + groups;
    },

    /**
     * Apply title overrides to a given title (checks user overrides first, then global)
     * @param {string} originalTitle - The original title to transform
     * @param {Object} options - Additional options for override application
     * @param {string} options.releaseGroup - The release group (e.g., 'SubsPlease', 'Erai-raws')
     * @param {number} options.anilistId - The AniList ID if known
     * @param {number} options.episodeNumber - The episode number for episode overrides
     * @returns {string} - The transformed title or original if no override applies
     */
    applyOverrides(originalTitle, options = {}) {
      if (!originalTitle) {
        return originalTitle;
      }

      const { releaseGroup, anilistId } = options;
      let transformedTitle = originalTitle;

      // console.log(`🔍 Applying title overrides to: "${originalTitle}"`);

      try {
        // 1. Check user overrides first (highest priority)
        if (userOverridesData && userOverridesData.overrides.exact_match) {
          const userOverride = userOverridesData.overrides.exact_match[originalTitle];
          if (userOverride) {
            console.log(`✅ Applied user exact match override: "${originalTitle}" -> "${userOverride}"`);
            return userOverride;
          }
        }

        // 2. Check global overrides
        if (!globalOverridesData) {
          return originalTitle;
        }
        // 3. AniList-specific overrides (global)
        if (anilistId && globalOverridesData.overrides.anilist_specific) {
          const anilistOverride = globalOverridesData.overrides.anilist_specific[anilistId.toString()];
          if (anilistOverride && anilistOverride.override_title) {
            console.log(`✅ Applied AniList-specific override: "${originalTitle}" -> "${anilistOverride.override_title}"`);
            return anilistOverride.override_title;
          }
        }

        // 4. Group-specific exact matches (global)
        if (releaseGroup && globalOverridesData.overrides.group_specific && globalOverridesData.overrides.group_specific[releaseGroup]) {
          const groupOverrides = globalOverridesData.overrides.group_specific[releaseGroup];
          if (groupOverrides[originalTitle]) {
            transformedTitle = groupOverrides[originalTitle];
            console.log(`✅ Applied group-specific override (${releaseGroup}): "${originalTitle}" -> "${transformedTitle}"`);
            return transformedTitle;
          }
        }

        // 5. Global exact matches
        if (globalOverridesData.overrides.exact_match && globalOverridesData.overrides.exact_match[originalTitle]) {
          transformedTitle = globalOverridesData.overrides.exact_match[originalTitle];
          console.log(`✅ Applied exact match override: "${originalTitle}" -> "${transformedTitle}"`);
          return transformedTitle;
        }

        // 6. Pattern-based matches (global)
        if (globalOverridesData.overrides.pattern_match) {
          for (const patternRule of globalOverridesData.overrides.pattern_match) {
            const regex = new RegExp(patternRule.pattern, 'i');
            if (regex.test(transformedTitle)) {
              const newTitle = transformedTitle.replace(regex, patternRule.replacement);
              if (newTitle !== transformedTitle) {
                console.log(`✅ Applied pattern override: "${transformedTitle}" -> "${newTitle}" (pattern: ${patternRule.pattern})`);
                return newTitle;
              }
            }
          }
        }

        // 7. Fallback patterns (global, lowest priority)
        if (globalOverridesData.overrides.fallback_patterns) {
          const sortedPatterns = globalOverridesData.overrides.fallback_patterns
            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

          for (const fallbackRule of sortedPatterns) {
            const regex = new RegExp(fallbackRule.pattern, 'gi');
            if (regex.test(transformedTitle)) {
              const newTitle = transformedTitle.replace(regex, fallbackRule.replacement);
              if (newTitle !== transformedTitle) {
                console.log(`✅ Applied fallback pattern: "${transformedTitle}" -> "${newTitle}"`);
                return newTitle;
              }
            }
          }
        }

        // console.log(`ℹ️  No title override applied for: "${originalTitle}"`);
        return originalTitle;

      } catch (error) {
        console.error(`❌ Error applying title overrides to "${originalTitle}":`, error);
        return originalTitle;
      }
    },

    /**
     * Apply episode mappings using title-based rules (checks user mappings first, then global)
     * @param {string} animeTitle - The anime title (after title overrides)
     * @param {number} episodeNumber - The original episode number
     * @returns {Object} - Object with transformedTitle and transformedEpisode, or original values if no mapping applies
     */
    applyEpisodeMappings(animeTitle, episodeNumber) {
      if (!animeTitle || !episodeNumber) {
        return { transformedTitle: animeTitle, transformedEpisode: episodeNumber };
      }

      try {
        // 1. Check user episode mappings first (highest priority)
        if (userOverridesData && userOverridesData.overrides.episode_mappings) {
          const userMappings = userOverridesData.overrides.episode_mappings;
          for (const mapping of userMappings) {
            if (mapping.source_title === animeTitle &&
                episodeNumber >= mapping.source_episode_start &&
                episodeNumber <= mapping.source_episode_end) {

              const offset = episodeNumber - mapping.source_episode_start;
              const newEpisode = mapping.dest_episode_start + offset;

              console.log(`✅ Applied user episode mapping for "${animeTitle}": episode ${episodeNumber} -> "${mapping.dest_title}" episode ${newEpisode}`);
              return {
                transformedTitle: mapping.dest_title,
                transformedEpisode: newEpisode
              };
            }
          }
        }

        // 2. Check global episode mappings
        if (globalOverridesData && globalOverridesData.overrides.episode_mappings) {
          const globalMappings = globalOverridesData.overrides.episode_mappings;
          for (const mapping of globalMappings) {
            if (mapping.source_title === animeTitle &&
                episodeNumber >= mapping.source_episode_start &&
                episodeNumber <= mapping.source_episode_end) {

              const offset = episodeNumber - mapping.source_episode_start;
              const newEpisode = mapping.dest_episode_start + offset;

              console.log(`✅ Applied global episode mapping for "${animeTitle}": episode ${episodeNumber} -> "${mapping.dest_title}" episode ${newEpisode}`);
              return {
                transformedTitle: mapping.dest_title,
                transformedEpisode: newEpisode
              };
            }
          }
        }

        return { transformedTitle: animeTitle, transformedEpisode: episodeNumber };
      } catch (error) {
        console.error(`❌ Error applying episode mappings for "${animeTitle}" episode ${episodeNumber}:`, error);
        return { transformedTitle: animeTitle, transformedEpisode: episodeNumber };
      }
    },

    /**
     * Apply episode number overrides (legacy method for backward compatibility)
     * @param {string} animeTitle - The anime title (after title overrides)
     * @param {number} episodeNumber - The original episode number
     * @returns {number} - The transformed episode number or original if no override applies
     */
    applyEpisodeOverrides(animeTitle, episodeNumber) {
      const result = this.applyEpisodeMappings(animeTitle, episodeNumber);
      return result.transformedEpisode;
    },

    /**
     * Load global overrides from config (cache)
     */
    async loadGlobalOverridesFromConfig() {
      try {
        // Check if configOperations is available and properly initialized
        if (!configOperations || typeof configOperations.get !== 'function') {
          console.warn('⚠️  Config operations not available, skipping cached global overrides');
          return;
        }

        const cachedData = configOperations.get('title_overrides_data');
        const lastFetch = configOperations.get('title_overrides_last_fetch');

        if (cachedData) {
          globalOverridesData = JSON.parse(cachedData);
          lastFetchTime = lastFetch ? new Date(lastFetch) : null;
          console.log(`📦 Loaded cached global title overrides`);
        } else {
          console.log('ℹ️  No cached global title overrides found');
        }
      } catch (error) {
        console.error('❌ Error loading global title overrides from config:', error);
        globalOverridesData = null;
      }
    },

    /**
     * Save global overrides to config (cache)
     */
    async saveGlobalOverridesToConfig(data) {
      try {
        // Check if configOperations is available and properly initialized
        if (!configOperations || typeof configOperations.set !== 'function') {
          console.warn('⚠️  Config operations not available, skipping global overrides cache save');
          return;
        }

        configOperations.set('title_overrides_data', JSON.stringify(data));
        console.log('💾 Saved global title overrides to config cache');
      } catch (error) {
        console.error('❌ Error saving global title overrides to config:', error);
      }
    },

    /**
     * Get current global overrides data
     */
    getGlobalOverridesData() {
      return globalOverridesData;
    },

    /**
     * Get current user overrides data
     */
    getUserOverridesData() {
      return userOverridesData;
    },

    /**
     * Get last fetch time
     */
    getLastFetchTime() {
      return lastFetchTime;
    },

    /**
     * Force refresh overrides
     */
    async forceRefresh() {
      console.log('🔄 Force refreshing title overrides...');
      return await this.fetchAndParseOverrides();
    },

    /**
     * Cleanup resources
     */
    cleanup() {
      this.stopPeriodicRefresh();
      globalOverridesData = null;
      userOverridesData = null;
      lastFetchTime = null;
    }
  };

  return manager;
}

module.exports = { createTitleOverridesManager };
