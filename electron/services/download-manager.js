const { join } = require('path');
const { app } = require('electron');
const {
  downloadOperations,
  configOperations
} = require("../lib/database");

function createDownloadManager(notificationService = null) {
  let client = null;
  let WebTorrent = null;
  const activeTorrents = new Map();

  const manager = {
    async initialize() {
      try {
        // Dynamically import WebTorrent
        const WebTorrentModule = await import('webtorrent');
        WebTorrent = WebTorrentModule.default;
        client = new WebTorrent();

        console.log('Download manager initialized');

        // Resume any active downloads - mark downloading as queued to restart
        const activeDownloads = downloadOperations.getActive();
        for (const download of activeDownloads) {
          if (download.status === 'downloading') {
            // Mark as queued to restart
            downloadOperations.updateProgress(download.id, { status: 'queued' });
          }
        }

        // Keep paused downloads as paused (they can be resumed manually)

        // Clean up any orphaned torrents
        this.cleanupOrphanedTorrents();

        // Start processing queue
        this.processQueue();

        return { success: true };
      } catch (error) {
        console.error('Failed to initialize download manager:', error);
        throw error;
      }
    },

    async processQueue() {
      try {
        const maxConcurrent = parseInt(configOperations.get('max_concurrent_downloads') || '3');
        // Only count actually downloading torrents (not paused ones)
        const currentDownloading = Array.from(activeTorrents.values()).filter(t => !t.done && !t.paused).length;

        if (currentDownloading >= maxConcurrent) {
          return;
        }

        const allDownloads = downloadOperations.getAll();
        const queuedDownloads = allDownloads.filter(d => d.status === 'queued');

        const downloadsToStart = queuedDownloads.slice(0, maxConcurrent - currentDownloading);

        for (const download of downloadsToStart) {
          await this.startDownload(download);
        }
      } catch (error) {
        console.error('💥 QUEUE: Error processing download queue:', error);
      }

      // Periodic cleanup of orphaned torrents (every 60 cycles = 5 minutes)
      if (!this.cleanupCounter) this.cleanupCounter = 0;
      this.cleanupCounter++;
      if (this.cleanupCounter >= 60) {
        console.log('🧹 Running automatic cleanup of orphaned torrents and deleted files...');
        this.cleanupOrphanedTorrents();
        this.cleanupCounter = 0;
      }

      // Schedule next queue check
      setTimeout(() => this.processQueue(), 5000);
    },

    async startDownload(download) {
      try {
        if (!client) {
          throw new Error('WebTorrent client not initialized');
        }

        // Starting download

        // Update status to downloading
        downloadOperations.updateProgress(download.id, {
          status: 'downloading',
          startedAt: new Date().toISOString()
        });

        // Notify frontend about download start
        if (notificationService) {
          notificationService.downloadStarted({
            id: download.id,
            title: download.final_title || download.torrent_title
          });
        }

        const downloadPath = this.getDownloadPath();

        // Check if torrent already exists in client
        let torrent = client.torrents.find(t =>
          t.magnetURI === download.torrent_link ||
          (t.torrentFile && t.torrentFile.name && download.torrent_link.includes(t.torrentFile.name))
        );

        if (torrent) {
          // If torrent already exists, remove it first
          client.remove(torrent, { destroyStore: true });
        }

        // Add torrent to WebTorrent client
        torrent = client.add(download.torrent_link, {
          path: downloadPath
        });

        activeTorrents.set(download.id, torrent);

        // Set up event listeners
        torrent.on('ready', () => {
          downloadOperations.updateProgress(download.id, {
            fileName: torrent.name,
            totalSize: torrent.length
          });
        });

        torrent.on('download', () => {
          const progress = torrent.progress;
          const downloadSpeed = torrent.downloadSpeed;
          const uploadSpeed = torrent.uploadSpeed;

          downloadOperations.updateProgress(download.id, {
            progress,
            downloadSpeed,
            uploadSpeed,
            downloaded: torrent.downloaded,
            uploaded: torrent.uploaded,
            peers: torrent.numPeers
          });
        });

        torrent.on('done', () => {
          downloadOperations.updateProgress(download.id, {
            status: 'completed',
            progress: 1,
            completedAt: new Date().toISOString(),
            filePath: join(downloadPath, torrent.name)
          });

          // Notify frontend about download completion
          if (notificationService) {
            notificationService.downloadCompleted({
              id: download.id,
              title: download.final_title || download.torrent_title || torrent.name,
              fileName: torrent.name,
              filePath: join(downloadPath, torrent.name)
            });
          }

          activeTorrents.delete(download.id);
        });

        torrent.on('error', (error) => {
          console.error(`Download error for ${download.final_title}:`, error);
          this.handleDownloadError(download.id, error.message);
          activeTorrents.delete(download.id);
        });

      } catch (error) {
        console.error(`Failed to start download ${download.id}:`, error);
        this.handleDownloadError(download.id, error.message);
      }
    },

    async handleDownloadError(downloadId, errorMessage) {
      try {
        const download = downloadOperations.getAll().find(d => d.id === downloadId);
        if (!download) return;

        const retryCount = (download.retry_count || 0) + 1;
        const maxRetries = download.max_retries || 3;

        console.log(`Download ${downloadId} failed (attempt ${retryCount}/${maxRetries}): ${errorMessage}`);

        if (retryCount <= maxRetries) {
          // Update retry count and schedule retry
          downloadOperations.updateProgress(downloadId, {
            status: 'queued',
            retry_count: retryCount,
            last_retry_at: new Date().toISOString(),
            errorMessage: `Retry ${retryCount}/${maxRetries}: ${errorMessage}`
          });

          // Schedule retry with exponential backoff (2^retry * 5 seconds)
          const retryDelay = Math.pow(2, retryCount - 1) * 5000;
          console.log(`Scheduling retry for download ${downloadId} in ${retryDelay}ms`);

          setTimeout(() => {
            this.processQueue();
          }, retryDelay);

          // Notify about retry
          if (notificationService) {
            notificationService.downloadRetrying({
              id: downloadId,
              title: download.final_title || download.torrent_title,
              attempt: retryCount,
              maxRetries: maxRetries
            });
          }
        } else {
          // Max retries exceeded, mark as permanently failed
          downloadOperations.updateProgress(downloadId, {
            status: 'failed',
            errorMessage: `Failed after ${maxRetries} attempts: ${errorMessage}`
          });

          // Notify about permanent failure
          if (notificationService) {
            notificationService.downloadFailed({
              id: downloadId,
              title: download.final_title || download.torrent_title,
              error: `Failed after ${maxRetries} attempts: ${errorMessage}`
            });
          }
        }
      } catch (error) {
        console.error(`Error handling download error for ${downloadId}:`, error);
      }
    },

    async retryDownload(downloadId) {
      try {
        const download = downloadOperations.getAll().find(d => d.id === downloadId);
        if (!download) {
          throw new Error('Download not found');
        }

        // Reset retry count and status
        downloadOperations.updateProgress(downloadId, {
          status: 'queued',
          retry_count: 0,
          errorMessage: null,
          last_retry_at: null
        });

        console.log(`Manual retry initiated for download ${downloadId}`);

        // Trigger queue processing
        setTimeout(() => this.processQueue(), 500);

        return { success: true };
      } catch (error) {
        console.error(`Failed to retry download ${downloadId}:`, error);
        throw error;
      }
    },

    async pauseDownload(downloadId) {
      try {
        const download = downloadOperations.getAll().find(d => d.id === downloadId);
        if (!download) {
          throw new Error('Download not found');
        }

        if (download.status !== 'downloading') {
          throw new Error('Download is not currently active');
        }

        const torrent = activeTorrents.get(downloadId);
        if (!torrent) {
          throw new Error('Active torrent not found');
        }

        // Store current progress before removing torrent
        const currentProgress = torrent.progress;
        const currentDownloaded = torrent.downloaded;
        const currentUploaded = torrent.uploaded;

        // Completely remove the torrent from WebTorrent client to stop downloading
        // We use destroyStore: false to keep the downloaded data on disk
        if (client && client.torrents.includes(torrent)) {
          client.remove(torrent, { destroyStore: false });
        }

        // Remove from active torrents map
        activeTorrents.delete(downloadId);

        // Update status in database with current progress
        downloadOperations.updateProgress(downloadId, {
          status: 'paused',
          progress: currentProgress,
          downloaded: currentDownloaded,
          uploaded: currentUploaded
        });

        // Download paused, torrent removed from client, data preserved on disk

        // Notify frontend about download pause
        if (notificationService) {
          notificationService.downloadPaused({
            id: downloadId,
            title: download.final_title || download.torrent_title
          });
        }

        return { success: true };
      } catch (error) {
        console.error(`Failed to pause download ${downloadId}:`, error);
        throw error;
      }
    },

    async resumeDownload(downloadId) {
      try {
        const download = downloadOperations.getAll().find(d => d.id === downloadId);
        if (!download) {
          throw new Error('Download not found');
        }

        if (download.status !== 'paused') {
          throw new Error('Download is not currently paused');
        }

        // Since we completely removed the torrent when pausing, we need to restart it
        // Update status to queued and let the queue processor handle restarting
        downloadOperations.updateProgress(downloadId, {
          status: 'queued'
        });

        // Download queued for restart, will continue from existing progress

        // Notify frontend about download resume
        if (notificationService) {
          notificationService.downloadResumed({
            id: downloadId,
            title: download.final_title || download.torrent_title
          });
        }

        // Trigger queue processing to restart the download
        setTimeout(() => this.processQueue(), 500);

        return { success: true };
      } catch (error) {
        console.error(`Failed to resume download ${downloadId}:`, error);
        throw error;
      }
    },

    async pauseAllDownloads() {
      try {
        const allDownloads = downloadOperations.getAll();
        const activeDownloads = allDownloads.filter(d => d.status === 'downloading');

        let pausedCount = 0;
        const errors = [];

        for (const download of activeDownloads) {
          try {
            await this.pauseDownload(download.id);
            pausedCount++;
          } catch (error) {
            console.error(`Failed to pause download ${download.id}:`, error);
            errors.push({ id: download.id, error: error.message });
          }
        }

        return {
          success: true,
          pausedCount,
          totalActive: activeDownloads.length,
          errors
        };
      } catch (error) {
        console.error('💥 PAUSE ALL: Error pausing all downloads:', error);
        throw error;
      }
    },

    async removeDownload(downloadId) {
      try {
        const torrent = activeTorrents.get(downloadId);
        if (torrent) {
          // Remove from WebTorrent client first
          if (client && client.torrents.includes(torrent)) {
            client.remove(torrent, { destroyStore: true });
          } else {
            // Fallback to destroy if not in client
            torrent.destroy();
          }
          activeTorrents.delete(downloadId);
        }

        // Also check if there are any torrents in the client that match this download
        // by checking the magnet link from the database
        const download = downloadOperations.getAll().find(d => d.id === downloadId);
        if (download && client) {
          const existingTorrent = client.torrents.find(t => t.magnetURI === download.torrent_link);
          if (existingTorrent) {
            client.remove(existingTorrent, { destroyStore: true });
          }
        }

        downloadOperations.delete(downloadId);
        console.log(`Download removed: ${downloadId}`);
        return { success: true };
      } catch (error) {
        console.error(`Failed to remove download ${downloadId}:`, error);
        throw error;
      }
    },

    async addManualDownload(torrentInput, title) {
      try {
        if (!torrentInput) {
          throw new Error('No torrent input provided');
        }

        // Check if input is a magnet link or torrent file URL
        const isMagnetLink = torrentInput.startsWith('magnet:');
        const isTorrentFile = torrentInput.startsWith('http') && torrentInput.includes('.torrent');

        if (!isMagnetLink && !isTorrentFile) {
          throw new Error('Invalid input: must be a magnet link or .torrent file URL');
        }

        console.log(`Adding ${isMagnetLink ? 'magnet link' : 'torrent file'}: ${torrentInput}`);

        // Check if this torrent already exists in the client
        if (client) {
          const existingTorrent = client.torrents.find(t =>
            (isMagnetLink && t.magnetURI === torrentInput) ||
            (!isMagnetLink && t.torrentFile && t.torrentFile.name === torrentInput)
          );
          if (existingTorrent) {
            // Remove the existing torrent first
            console.log('Removing existing torrent before adding new one');
            client.remove(existingTorrent, { destroyStore: true });
          }
        }

        // Check if this download already exists in the database
        const existingDownload = downloadOperations.getAll().find(d => d.torrent_link === torrentInput);
        if (existingDownload) {
          // Remove the existing download first
          console.log('Removing existing download record before adding new one');
          await this.removeDownload(existingDownload.id);
        }

        // Create download entry in database
        const downloadData = {
          torrent_link: torrentInput,
          torrent_title: title || 'Manual Download',
          anime_title: title || 'Manual Download',
          final_title: title || 'Manual Download',
          status: 'queued',
          progress: 0,
          downloadSpeed: 0
        };

        const result = downloadOperations.create(downloadData);
        console.log(`Manual download added: ${title || 'Manual Download'}`);

        // Trigger queue processing
        setTimeout(() => this.processQueue(), 1000);

        return { success: true, id: result.id };
      } catch (error) {
        console.error('Failed to add manual download:', error);
        throw error;
      }
    },

    getDownloadPath() {
      const configPath = configOperations.get('downloads_directory');

      if (configPath && configPath !== 'downloads') {
        return configPath;
      }

      // Default to downloads folder in user data directory
      return join(app.getPath('userData'), 'downloads');
    },

    getActiveDownloads() {
      return Array.from(activeTorrents.entries()).map(([id, torrent]) => ({
        id,
        name: torrent.name,
        progress: torrent.progress,
        downloadSpeed: torrent.downloadSpeed,
        uploadSpeed: torrent.uploadSpeed,
        peers: torrent.numPeers
      }));
    },

    // Clean up any orphaned torrents in the WebTorrent client and check for externally deleted files
    cleanupOrphanedTorrents() {
      if (!client) {
        console.log('⚠️ WebTorrent client not available, skipping torrent cleanup but checking for deleted files...');
        // Still check for deleted files even if client is not available
        const dbDownloads = downloadOperations.getAll();
        this.checkForDeletedFiles(dbDownloads);
        return;
      }

      try {
        const dbDownloads = downloadOperations.getAll();
        const activeDownloads = dbDownloads
          .filter(d => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused');

        // Always check for completed downloads with externally deleted files first
        console.log('🔍 Checking for externally deleted files...');
        this.checkForDeletedFiles(dbDownloads);

        // Skip torrent cleanup if there are actively downloading torrents to avoid interrupting them
        const hasActiveDownloads = activeDownloads.some(d => d.status === 'downloading');
        if (hasActiveDownloads) {
          console.log('⚠️ Skipping torrent cleanup - active downloads in progress, but deleted files check completed');
          return;
        }

        // Remove any torrents from client that are not in the database
        client.torrents.forEach(torrent => {
          // Check if this torrent belongs to any active download
          const belongsToActiveDownload = activeDownloads.some(download => {
            // Check if it matches by magnet URI (for magnet links)
            if (torrent.magnetURI === download.torrent_link) {
              return true;
            }

            // Check if it's in the activeTorrents map (for both magnet and .torrent files)
            for (const [downloadId, activeTorrent] of activeTorrents.entries()) {
              if (activeTorrent === torrent && download.id === downloadId) {
                return true;
              }
            }

            return false;
          });

          if (!belongsToActiveDownload) {
            console.log(`Removing orphaned torrent: ${torrent.name || torrent.infoHash}`);
            client.remove(torrent, { destroyStore: true });
          }
        });

        // Clean up activeTorrents map
        for (const [downloadId, torrent] of activeTorrents.entries()) {
          const download = dbDownloads.find(d => d.id === downloadId);
          if (!download || download.status === 'completed' || download.status === 'failed') {
            console.log(`Removing orphaned active torrent for download ${downloadId}`);
            if (client.torrents.includes(torrent)) {
              client.remove(torrent, { destroyStore: true });
            }
            activeTorrents.delete(downloadId);
          }
        }
      } catch (error) {
        console.error('Error cleaning up orphaned torrents:', error);
      }
    },

    // Check for completed downloads where files were deleted externally
    checkForDeletedFiles(dbDownloads) {
      const fs = require('fs');
      const path = require('path');

      try {
        const completedDownloads = dbDownloads.filter(d => d.status === 'completed');
        const downloadPath = this.getDownloadPath();
        let deletedCount = 0;

        console.log(`🔍 Checking ${completedDownloads.length} completed downloads for deleted files...`);
        console.log(`📁 Download path: ${downloadPath}`);

        for (const download of completedDownloads) {
          // Check both fileName (camelCase) and file_name (snake_case) for compatibility
          const fileName = download.fileName || download.file_name;

          if (fileName) {
            const filePath = path.join(downloadPath, fileName);
            console.log(`🔍 Checking file: ${filePath}`);

            // Check if the file still exists
            if (!fs.existsSync(filePath)) {
              console.log(`🗑️ File deleted externally, removing from downloads: ${fileName}`);

              // Remove from database
              downloadOperations.delete(download.id);

              // Also remove from active torrents if it exists
              const torrent = activeTorrents.get(download.id);
              if (torrent) {
                if (client && client.torrents.includes(torrent)) {
                  client.remove(torrent, { destroyStore: true });
                }
                activeTorrents.delete(download.id);
              }

              deletedCount++;
            } else {
              console.log(`✅ File exists: ${fileName}`);
            }
          } else {
            console.log(`⚠️ Download ${download.id} has no fileName or file_name: ${JSON.stringify(download)}`);
          }
        }

        if (deletedCount > 0) {
          console.log(`🧹 Cleaned up ${deletedCount} externally deleted file(s) from downloads list`);
        } else {
          console.log(`✅ No deleted files found during cleanup`);
        }
      } catch (error) {
        console.error('Error checking for deleted files:', error);
      }
    },

    async shutdown() {
      try {
        // Destroy all active torrents
        for (const torrent of activeTorrents.values()) {
          torrent.destroy();
        }
        activeTorrents.clear();

        // Destroy WebTorrent client
        if (client) {
          client.destroy();
          client = null;
        }
        console.log('Download manager shut down');
      } catch (error) {
        console.error('Error shutting down download manager:', error);
      }
    }
  };

  // Initialize the manager
  manager.initialize();

  return manager;
}

module.exports = { createDownloadManager };
