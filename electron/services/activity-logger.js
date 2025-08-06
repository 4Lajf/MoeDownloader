const { activityLogsOperations } = require('../lib/database');

/**
 * Activity Logger Service
 * Logs user-relevant events to the database for display in the UI
 */
function createActivityLogger() {
  const logger = {
    /**
     * Log a download started event
     * @param {Object} downloadInfo
     */
    downloadStarted(downloadInfo) {
      this.log('download', 'Download Started', `Started downloading "${downloadInfo.title}"`, {
        torrentLink: downloadInfo.torrentLink,
        finalTitle: downloadInfo.finalTitle
      });
    },

    /**
     * Log a download completed event
     * @param {Object} downloadInfo
     */
    downloadCompleted(downloadInfo) {
      this.log('download', 'Download Completed', `Successfully downloaded "${downloadInfo.title}"`, {
        filePath: downloadInfo.filePath,
        fileSize: downloadInfo.fileSize
      });
    },

    /**
     * Log a download failed event
     * @param {Object} downloadInfo
     */
    downloadFailed(downloadInfo) {
      this.log('download', 'Download Failed', `Failed to download "${downloadInfo.title}": ${downloadInfo.error}`, {
        error: downloadInfo.error,
        torrentLink: downloadInfo.torrentLink
      });
    },

    /**
     * Log a download paused event
     * @param {Object} downloadInfo
     */
    downloadPaused(downloadInfo) {
      this.log('download', 'Download Paused', `Paused download of "${downloadInfo.title}"`, {
        progress: downloadInfo.progress
      });
    },

    /**
     * Log a download resumed event
     * @param {Object} downloadInfo
     */
    downloadResumed(downloadInfo) {
      this.log('download', 'Download Resumed', `Resumed download of "${downloadInfo.title}"`, {
        progress: downloadInfo.progress
      });
    },

    /**
     * Log RSS processing results
     * @param {Object} result
     */
    rssProcessed(result) {
      if (result.downloadedCount > 0) {
        this.log('rss', 'RSS Processing', `Found ${result.downloadedCount} new episodes to download`, {
          processedCount: result.processedCount,
          downloadedCount: result.downloadedCount,
          totalItems: result.totalItems
        });
      }
    },

    /**
     * Log when an episode matches whitelist
     * @param {string} episodeTitle
     * @param {string} whitelistTitle
     * @param {Object} parsedData
     */
    whitelistMatch(episodeTitle, whitelistTitle, parsedData) {
      this.log('whitelist', 'Whitelist Match', `"${episodeTitle}" matched whitelist entry "${whitelistTitle}"`, {
        episodeTitle,
        whitelistTitle,
        episodeNumber: parsedData?.episodeNumber,
        animeTitle: parsedData?.animeTitle
      });
    },

    /**
     * Log when an episode doesn't match any whitelist entry
     * @param {string} episodeTitle
     */
    whitelistNoMatch(episodeTitle) {
      this.log('whitelist', 'No Whitelist Match', `"${episodeTitle}" did not match any whitelist entries`, {
        episodeTitle
      });
    },

    /**
     * Log when an episode is skipped because it was already processed
     * @param {string} episodeTitle
     * @param {string} reason
     */
    episodeSkipped(episodeTitle, reason = 'Already processed') {
      this.log('skip', 'Episode Skipped', `Skipped "${episodeTitle}": ${reason}`, {
        episodeTitle,
        reason
      });
    },

    /**
     * Log application events
     * @param {string} event
     * @param {string} description
     * @param {Object} metadata
     */
    appEvent(event, description, metadata = {}) {
      this.log('app', event, description, metadata);
    },

    /**
     * Log RSS monitoring events
     * @param {string} event
     * @param {string} description
     * @param {Object} metadata
     */
    rssEvent(event, description, metadata = {}) {
      this.log('rss', event, description, metadata);
    },

    /**
     * Generic log method
     * @param {string} type - Log type (download, rss, whitelist, skip, app)
     * @param {string} title - Log title
     * @param {string} description - Log description
     * @param {Object} metadata - Additional metadata
     */
    log(type, title, description, metadata = {}) {
      try {
        activityLogsOperations.add({
          type,
          title,
          description,
          metadata
        });
      } catch (error) {
        console.error('Failed to log activity:', error);
      }
    },

    /**
     * Clean up old logs (keep only recent ones)
     * @param {number} keepCount
     */
    cleanup(keepCount = 1000) {
      try {
        activityLogsOperations.cleanup(keepCount);
      } catch (error) {
        console.error('Failed to cleanup activity logs:', error);
      }
    }
  };

  return logger;
}

module.exports = { createActivityLogger };
