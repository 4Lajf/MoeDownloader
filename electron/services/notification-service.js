let mainWindow = null;

function createNotificationService() {
  const service = {
    setMainWindow(window) {
      mainWindow = window;
    },

    sendNotification(type, data) {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('app-notification', { type, data });
      }
    },

    // Specific notification types
    downloadCompleted(downloadInfo) {
      this.sendNotification('download-completed', downloadInfo);
    },

    downloadFailed(downloadInfo) {
      this.sendNotification('download-failed', downloadInfo);
    },

    downloadStarted(downloadInfo) {
      this.sendNotification('download-started', downloadInfo);
    },

    downloadRetrying(downloadInfo) {
      this.sendNotification('download-retrying', downloadInfo);
    },

    downloadPaused(downloadInfo) {
      this.sendNotification('download-paused', downloadInfo);
    },

    downloadResumed(downloadInfo) {
      this.sendNotification('download-resumed', downloadInfo);
    },

    rssProcessed(result) {
      this.sendNotification('rss-processed', result);
    },

    newEpisodeFound(episodeInfo) {
      this.sendNotification('new-episode-found', episodeInfo);
    }
  };

  return service;
}

module.exports = { createNotificationService };
