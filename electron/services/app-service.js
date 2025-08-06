const {
  whitelistOperations,
  downloadOperations,
  rssOperations,
  configOperations
} = require("../lib/database");
const { createRSSProcessor } = require("./rss-processor");
const { createDownloadManager } = require("./download-manager");
const { createTitleOverridesManager } = require("./title-overrides");
const { createActivityLogger } = require("./activity-logger");

function createAppService(sharedRSSProcessor = null, sharedDownloadManager = null, sharedActivityLogger = null) {
  let rssProcessor = sharedRSSProcessor;
  let downloadManager = sharedDownloadManager;
  let titleOverridesManager = null;
  let activityLogger = sharedActivityLogger;
  let rssScheduleActive = false;
  let rssInterval = null;

  const service = {
    async initialize() {
      try {
        // Create activity logger if not provided
        if (!activityLogger) {
          activityLogger = createActivityLogger();
        }

        // Use shared instances if provided, otherwise create new ones
        if (!rssProcessor) {
          rssProcessor = createRSSProcessor(null, null, activityLogger);
          await rssProcessor.initialize();
        }

        if (!downloadManager) {
          downloadManager = createDownloadManager();
        }

        // Initialize title overrides manager
        titleOverridesManager = createTitleOverridesManager();
        await titleOverridesManager.initialize();

        // Log app initialization
        activityLogger.appEvent('Application Started', 'MoeDownloader has been initialized and is ready to use');
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

        const result = await rssProcessor.processFeed(rssUrl);
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
