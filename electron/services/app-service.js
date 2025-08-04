const {
  whitelistOperations,
  downloadOperations,
  rssOperations,
  configOperations
} = require("../lib/database");
const { createRSSProcessor } = require("./rss-processor");
const { createDownloadManager } = require("./download-manager");
const { createTitleOverridesManager } = require("./title-overrides");

function createAppService() {
  let rssProcessor = null;
  let downloadManager = null;
  let titleOverridesManager = null;
  let rssScheduleActive = false;
  let rssInterval = null;

  const service = {
    async initialize() {
      try {
        // Initialize RSS processor and download manager
        rssProcessor = createRSSProcessor();
        downloadManager = createDownloadManager();

        // Initialize title overrides manager
        titleOverridesManager = createTitleOverridesManager();
        await titleOverridesManager.initialize();

        console.log('App service initialized successfully');
        return { success: true };
      } catch (error) {
        console.error('Failed to initialize app service:', error);
        throw error;
      }
    },

    getStatus() {
      const activeDownloads = downloadOperations.getActive();
      return {
        rssScheduleActive,
        activeDownloads: activeDownloads.length,
        stats: this.getStats()
      };
    },

    getStats() {
      try {
        const whitelist = whitelistOperations.getAll();
        const downloads = downloadOperations.getAll();
        const rssEntries = rssOperations.getProcessed();

        return {
          whitelistCount: whitelist.length,
          totalDownloads: downloads.length,
          activeDownloads: downloads.filter(d => ['queued', 'downloading'].includes(d.status)).length,
          completedDownloads: downloads.filter(d => d.status === 'completed').length,
          failedDownloads: downloads.filter(d => d.status === 'failed').length,
          processedEntries: rssEntries.length
        };
      } catch (error) {
        console.error('Error getting stats:', error);
        return {
          whitelistCount: 0,
          totalDownloads: 0,
          activeDownloads: 0,
          completedDownloads: 0,
          failedDownloads: 0,
          processedEntries: 0
        };
      }
    },

    async startRSSMonitoring() {
      if (rssScheduleActive) {
        console.log('RSS monitoring is already active');
        return;
      }

      try {
        const intervalMinutes = parseInt(configOperations.get('check_interval_minutes') || '5');
        const intervalMs = intervalMinutes * 60 * 1000;

        // Start immediate check
        await this.processRSSFeed();

        // Schedule periodic checks
        rssInterval = setInterval(async () => {
          try {
            await this.processRSSFeed();
          } catch (error) {
            console.error('Error in scheduled RSS check:', error);
          }
        }, intervalMs);

        rssScheduleActive = true;
        console.log(`RSS monitoring started with ${intervalMinutes} minute interval`);
      } catch (error) {
        console.error('Failed to start RSS monitoring:', error);
        throw error;
      }
    },

    stopRSSMonitoring() {
      if (rssInterval) {
        clearInterval(rssInterval);
        rssInterval = null;
      }
      rssScheduleActive = false;
      console.log('RSS monitoring stopped');
    },

    async processRSSFeed() {
      if (!rssProcessor) {
        throw new Error('RSS processor not initialized');
      }

      try {
        const rssUrl = configOperations.get('rss_feed_url');
        if (!rssUrl) {
          throw new Error('RSS feed URL not configured');
        }

        console.log('Processing RSS feed:', rssUrl);
        const result = await rssProcessor.processFeed(rssUrl);
        console.log('RSS processing completed:', result);
        return result;
      } catch (error) {
        console.error('Error processing RSS feed:', error);
        throw error;
      }
    },

    getDownloadManager() {
      return downloadManager;
    },

    getRSSProcessor() {
      return rssProcessor;
    }
  };

  return service;
}

module.exports = { createAppService };
