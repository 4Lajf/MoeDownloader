const { Notification } = require('electron');
const { configOperations } = require('../lib/database');

let mainWindow = null;

function createNotificationService() {
  const service = {
    setMainWindow(window) {
      mainWindow = window;
    },

    // Check if OS notifications are enabled in settings
    isOSNotificationsEnabled() {
      try {
        const enabled = configOperations.get('enable_os_notifications');
        return enabled === 'true' || enabled === true;
      } catch (error) {
        console.error('Error checking OS notifications setting:', error);
        return false;
      }
    },

    // Check if specific notification type is enabled
    isNotificationTypeEnabled(type) {
      try {
        const key = `enable_notification_${type}`;
        const enabled = configOperations.get(key);
        return enabled === 'true' || enabled === true || enabled === null; // Default to true if not set
      } catch (error) {
        console.error(`Error checking notification type ${type}:`, error);
        return true; // Default to enabled
      }
    },

    // Send in-app notification (existing functionality)
    sendNotification(type, data) {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('app-notification', { type, data });
      }
    },

    // Check if main window is focused
    isMainWindowFocused() {
      return mainWindow && mainWindow.isFocused();
    },

    // Send OS notification
    sendOSNotification(title, body, options = {}) {
      if (!this.isOSNotificationsEnabled()) {
        return;
      }

      // Don't show OS notifications when the app is focused (unless forced)
      if (this.isMainWindowFocused() && !options.forceShow) {
        return;
      }

      try {
        const notification = new Notification({
          title,
          body,
          icon: options.icon,
          silent: options.silent || false,
          urgency: options.urgency || 'normal'
        });

        if (options.onClick) {
          notification.on('click', options.onClick);
        }

        notification.show();
        return notification;
      } catch (error) {
        console.error('Error showing OS notification:', error);
      }
    },

    // Combined notification method (both in-app and OS)
    notify(type, data, osNotificationConfig = null) {
      // Always send in-app notification
      this.sendNotification(type, data);

      // Send OS notification if configured and enabled for this type
      if (osNotificationConfig && this.isNotificationTypeEnabled(type)) {
        this.sendOSNotification(
          osNotificationConfig.title,
          osNotificationConfig.body,
          osNotificationConfig.options || {}
        );
      }
    },

    // Specific notification types with OS notification support
    downloadCompleted(downloadInfo) {
      this.notify('download-completed', downloadInfo, {
        title: 'Download Completed',
        body: `${downloadInfo.title || downloadInfo.fileName} has finished downloading`,
        options: {
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
    },

    downloadFailed(downloadInfo) {
      this.notify('download-failed', downloadInfo, {
        title: 'Download Failed',
        body: `${downloadInfo.title || downloadInfo.fileName} failed to download`,
        options: {
          urgency: 'critical',
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
    },

    downloadStarted(downloadInfo) {
      this.notify('download-started', downloadInfo, {
        title: 'Download Started',
        body: `Started downloading ${downloadInfo.title || downloadInfo.fileName}`,
        options: {
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
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
      this.notify('rss-processed', result, {
        title: 'RSS Feed Processed',
        body: result.newEntries > 0
          ? `Found ${result.newEntries} new episodes`
          : 'RSS feed processed, no new episodes found',
        options: {
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
    },

    newEpisodeFound(episodeInfo) {
      this.notify('new-episode-found', episodeInfo, {
        title: 'New Episode Available',
        body: `${episodeInfo.title} - Episode ${episodeInfo.episode} is now available`,
        options: {
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
    },

    // New notification types for important events
    anilistSyncCompleted(syncInfo) {
      this.notify('anilist-sync-completed', syncInfo, {
        title: 'AniList Sync Complete',
        body: `Synced ${syncInfo.totalSynced} anime entries from your lists`,
        options: {
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
    },

    anilistSyncFailed(error) {
      this.notify('anilist-sync-failed', { error }, {
        title: 'AniList Sync Failed',
        body: 'Failed to sync your AniList data',
        options: {
          urgency: 'critical',
          onClick: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
          }
        }
      });
    }
  };

  return service;
}

module.exports = { createNotificationService };
