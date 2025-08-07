const Database = require('better-sqlite3');
const { join } = require('path');
const { app } = require('electron');
const { mkdirSync } = require('fs');

let db = null;

/**
 * Initialize the SQLite database using better-sqlite3
 * @returns {Promise<Database>}
 */
async function initDatabase() {
	if (db) return db;

	try {
		// Get user data directory
		const userDataPath = app.getPath('userData');
		const dbPath = join(userDataPath, 'moedownloader.db');

		// Ensure directory exists
		mkdirSync(userDataPath, { recursive: true });

		// Create database connection
		db = new Database(dbPath);
		
		// Enable WAL mode for better performance
		db.pragma('journal_mode = WAL');
		
		// Create tables
		await createTables();

		console.log('Database initialized successfully at:', dbPath);
		return db;
	} catch (error) {
		console.error('Failed to initialize database:', error);
		throw error;
	}
}

/**
 * Create database tables
 */
async function createTables() {
	
	// Whitelist table (modified to support AniList integration)
	db.exec(`
		CREATE TABLE IF NOT EXISTS whitelist (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			keywords TEXT DEFAULT '',
			exclude_keywords TEXT DEFAULT '',
			quality TEXT DEFAULT '1080p',
			enabled INTEGER DEFAULT 1,
			preferred_group TEXT NOT NULL DEFAULT 'any',
			source_type TEXT DEFAULT 'manual',
			anilist_id INTEGER,
			anilist_account_id INTEGER,
			auto_sync INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (anilist_account_id) REFERENCES anilist_accounts (id) ON DELETE CASCADE,
			UNIQUE(title, source_type, anilist_account_id)
		)
	`);

	// RSS entries table
	db.exec(`
		CREATE TABLE IF NOT EXISTS rss_entries (
			id INTEGER PRIMARY KEY,
			guid TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			link TEXT NOT NULL,
			pub_date DATETIME,
			processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			status TEXT DEFAULT 'processed'
		)
	`);

	// Downloads table
	db.exec(`
		CREATE TABLE IF NOT EXISTS downloads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			rss_entry_id INTEGER,
			torrent_link TEXT NOT NULL,
			torrent_title TEXT NOT NULL,
			final_title TEXT,
			file_name TEXT,
			file_path TEXT,
			file_size INTEGER,
			progress REAL DEFAULT 0,
			download_speed REAL DEFAULT 0,
			upload_speed REAL DEFAULT 0,
			peers INTEGER DEFAULT 0,
			downloaded INTEGER DEFAULT 0,
			uploaded INTEGER DEFAULT 0,
			total_size INTEGER DEFAULT 0,
			status TEXT DEFAULT 'queued',
			error_message TEXT,
			started_at DATETIME,
			completed_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (rss_entry_id) REFERENCES rss_entries (id)
		)
	`);

	// SubsPlease season mappings table
	db.exec(`
		CREATE TABLE IF NOT EXISTS season_mappings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			original_title TEXT NOT NULL UNIQUE,
			season_title TEXT NOT NULL,
			start_episode INTEGER NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Configuration table
	db.exec(`
		CREATE TABLE IF NOT EXISTS config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// AniList accounts table
	db.exec(`
		CREATE TABLE IF NOT EXISTS anilist_accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL UNIQUE,
			username TEXT NOT NULL,
			access_token TEXT NOT NULL,
			avatar_url TEXT,
			banner_url TEXT,
			about TEXT,
			anime_count INTEGER DEFAULT 0,
			mean_score REAL DEFAULT 0,
			minutes_watched INTEGER DEFAULT 0,
			is_active INTEGER DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// AniList auto-download lists configuration
	db.exec(`
		CREATE TABLE IF NOT EXISTS anilist_auto_lists (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			account_id INTEGER NOT NULL,
			list_status TEXT NOT NULL,
			enabled INTEGER DEFAULT 1,
			quality TEXT DEFAULT '1080p',
			preferred_group TEXT DEFAULT 'any',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (account_id) REFERENCES anilist_accounts (id) ON DELETE CASCADE,
			UNIQUE(account_id, list_status)
		)
	`);

	// AniList anime cache table
	db.exec(`
		CREATE TABLE IF NOT EXISTS anilist_anime_cache (
			id INTEGER PRIMARY KEY,
			anilist_id INTEGER NOT NULL UNIQUE,
			title_romaji TEXT,
			title_english TEXT,
			title_native TEXT,
			synonyms TEXT,
			format TEXT,
			status TEXT,
			episodes INTEGER,
			season TEXT,
			season_year INTEGER,
			average_score INTEGER,
			genres TEXT,
			cover_image_url TEXT,
			banner_image_url TEXT,
			cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Anime relations table (for continuous numbering handling)
	db.exec(`
		CREATE TABLE IF NOT EXISTS anime_relations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_anilist_id INTEGER NOT NULL,
			source_mal_id INTEGER,
			source_kitsu_id INTEGER,
			source_episode_start INTEGER NOT NULL,
			source_episode_end INTEGER NOT NULL,
			dest_anilist_id INTEGER NOT NULL,
			dest_mal_id INTEGER,
			dest_kitsu_id INTEGER,
			dest_episode_start INTEGER NOT NULL,
			dest_episode_end INTEGER NOT NULL,
			has_exclamation INTEGER DEFAULT 0,
			raw_rule TEXT,
			source_anime_title TEXT,
			dest_anime_title TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Processed files table (for tracking downloaded content and preventing duplicates)
	db.exec(`
		CREATE TABLE IF NOT EXISTS processed_files (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			whitelist_entry_id INTEGER NOT NULL,
			original_filename TEXT NOT NULL,
			final_title TEXT NOT NULL,
			episode_number TEXT,
			anime_title TEXT NOT NULL,
			release_group TEXT,
			video_resolution TEXT,
			file_checksum TEXT,
			torrent_link TEXT NOT NULL,
			download_status TEXT DEFAULT 'processed',
			processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (whitelist_entry_id) REFERENCES whitelist (id) ON DELETE CASCADE,
			UNIQUE(anime_title, episode_number)
		)
	`);

	// Activity logs table (for user-relevant application events)
	db.exec(`
		CREATE TABLE IF NOT EXISTS activity_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT,
			metadata TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Processed GUIDs table (for tracking RSS GUIDs to prevent reprocessing)
	db.exec(`
		CREATE TABLE IF NOT EXISTS processed_guids (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guid TEXT NOT NULL UNIQUE,
			processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`);

	// Create indexes for better performance
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_rss_entries_guid ON rss_entries (guid);
		CREATE INDEX IF NOT EXISTS idx_rss_entries_status ON rss_entries (status);
		CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads (status);
		CREATE INDEX IF NOT EXISTS idx_downloads_rss_entry_id ON downloads (rss_entry_id);
		CREATE INDEX IF NOT EXISTS idx_whitelist_title ON whitelist (title);
		CREATE INDEX IF NOT EXISTS idx_anilist_accounts_user_id ON anilist_accounts (user_id);
		CREATE INDEX IF NOT EXISTS idx_anilist_auto_lists_account_id ON anilist_auto_lists (account_id);
		CREATE INDEX IF NOT EXISTS idx_anilist_anime_cache_anilist_id ON anilist_anime_cache (anilist_id);
		CREATE INDEX IF NOT EXISTS idx_anime_relations_source ON anime_relations (source_anilist_id);
		CREATE INDEX IF NOT EXISTS idx_anime_relations_dest ON anime_relations (dest_anilist_id);
		CREATE INDEX IF NOT EXISTS idx_processed_files_whitelist_entry ON processed_files (whitelist_entry_id);
		CREATE INDEX IF NOT EXISTS idx_processed_files_episode ON processed_files (whitelist_entry_id, episode_number);
		CREATE INDEX IF NOT EXISTS idx_processed_files_anime_title ON processed_files (anime_title);
		CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON activity_logs (type);
		CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at);
		CREATE INDEX IF NOT EXISTS idx_processed_guids_guid ON processed_guids (guid);
	`);

	// Migrate existing anime_relations table to add anime title columns
	try {
		// Check if the new columns exist
		const tableInfo = db.prepare("PRAGMA table_info(anime_relations)").all();
		const hasSourceTitle = tableInfo.some(col => col.name === 'source_anime_title');
		const hasDestTitle = tableInfo.some(col => col.name === 'dest_anime_title');

		if (!hasSourceTitle) {
			console.log('Adding source_anime_title column to anime_relations table');
			db.exec('ALTER TABLE anime_relations ADD COLUMN source_anime_title TEXT');
		}

		if (!hasDestTitle) {
			console.log('Adding dest_anime_title column to anime_relations table');
			db.exec('ALTER TABLE anime_relations ADD COLUMN dest_anime_title TEXT');
		}
	} catch (error) {
		console.error('Error migrating anime_relations table:', error);
	}

	// Insert default configuration
	const defaultConfig = [
		['rss_feed_url', 'https://www.tokyotosho.info/rss.php?filter=1&entries=750'],
		['check_interval_minutes', '5'],
		['downloads_directory', 'downloads'],
		['max_concurrent_downloads', '3'],
		['last_processed_id', '0'],
		['theme', 'dark'],
		// Download filtering settings
		['disabled_fansub_groups', ''],
		// OS Notifications settings
		['enable_os_notifications', 'true'],
		['enable_notification_download-completed', 'true'],
		['enable_notification_download-failed', 'true'],
		['enable_notification_download-started', 'true'],
		['enable_notification_rss-processed', 'true'],
		['enable_notification_new-episode-found', 'true'],
		['enable_notification_anilist-sync-failed', 'true'],
		// Tray settings
		['hide_to_tray_on_close', 'true'],
		['start_minimized_to_tray', 'false'],
		// UI settings
		['show_advanced_tabs_in_sidebar', 'false']
	];

	const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
	for (const [key, value] of defaultConfig) {
		insertConfig.run(key, value);
	}

	// Run migrations after tables are created
	await runMigrations();
}

/**
 * Get database instance
 * @returns {Database}
 */
function getDatabase() {
	if (!db) {
		throw new Error('Database not initialized. Call initDatabase() first.');
	}
	return db;
}

/**
 * Close database connection
 */
async function closeDatabase() {
	if (db) {
		db.close();
		db = null;
	}
}

// Whitelist operations
const whitelistOperations = {
	/**
	 * Get all whitelist entries
	 * @returns {Array}
	 */
	getAll() {
		const stmt = db.prepare('SELECT * FROM whitelist ORDER BY title');
		return stmt.all();
	},

	/**
	 * Add a whitelist entry
	 * @param {Object} entry
	 */
	add(entry) {
		try {
			const stmt = db.prepare(`
				INSERT INTO whitelist (title, keywords, exclude_keywords, quality, enabled, preferred_group, source_type, anilist_id, anilist_account_id, auto_sync, title_romaji, title_english, title_synonyms, allowed_groups, allowed_qualities)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			// Handle multi-select fields
			const allowedGroups = entry.allowed_groups || (entry.preferred_group && entry.preferred_group !== 'any' ? [entry.preferred_group] : []);
			const allowedQualities = entry.allowed_qualities || (entry.quality && entry.quality !== 'any' ? [entry.quality] : []);

			const addResult = stmt.run(
				entry.title,
				entry.keywords || '',
				entry.exclude_keywords || '',
				entry.quality || '1080p', // Keep for backward compatibility
				entry.enabled ? 1 : 0,
				entry.preferred_group || 'any', // Keep for backward compatibility
				entry.source_type || 'manual',
				entry.anilist_id || null,
				entry.anilist_account_id || null,
				entry.auto_sync ? 1 : 0,
				entry.title_romaji || null,
				entry.title_english || null,
				entry.title_synonyms ? JSON.stringify(entry.title_synonyms) : null,
				JSON.stringify(allowedGroups),
				JSON.stringify(allowedQualities)
			);
			return addResult;
		} catch (error) {
			if (error.message.includes('UNIQUE constraint failed')) {
				throw new Error('UNIQUE constraint failed: whitelist.title');
			}
			throw error;
		}
	},

	/**
	 * Update a whitelist entry
	 * @param {number} id
	 * @param {Object} entry
	 */
	update(id, entry) {
		try {
			const stmt = db.prepare(`
				UPDATE whitelist
				SET title = ?, keywords = ?, exclude_keywords = ?, quality = ?, enabled = ?,
					preferred_group = ?, source_type = ?, anilist_id = ?, anilist_account_id = ?, auto_sync = ?,
					title_romaji = ?, title_english = ?, title_synonyms = ?, allowed_groups = ?, allowed_qualities = ?, updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`);

			// Handle multi-select fields
			const allowedGroups = entry.allowed_groups || (entry.preferred_group && entry.preferred_group !== 'any' ? [entry.preferred_group] : []);
			const allowedQualities = entry.allowed_qualities || (entry.quality && entry.quality !== 'any' ? [entry.quality] : []);

			const updateResult = stmt.run(
				entry.title,
				entry.keywords || '',
				entry.exclude_keywords || '',
				entry.quality || '1080p', // Keep for backward compatibility
				entry.enabled ? 1 : 0,
				entry.preferred_group || 'any', // Keep for backward compatibility
				entry.source_type || 'manual',
				entry.anilist_id || null,
				entry.anilist_account_id || null,
				entry.auto_sync ? 1 : 0,
				entry.title_romaji || null,
				entry.title_english || null,
				entry.title_synonyms ? JSON.stringify(entry.title_synonyms) : null,
				JSON.stringify(allowedGroups),
				JSON.stringify(allowedQualities),
				id
			);
			return updateResult;
		} catch (error) {
			if (error.message.includes('UNIQUE constraint failed')) {
				throw new Error('UNIQUE constraint failed: whitelist.title');
			}
			throw error;
		}
	},

	/**
	 * Delete a whitelist entry
	 * @param {number} id
	 */
	delete(id) {
		const stmt = db.prepare('DELETE FROM whitelist WHERE id = ?');
		return stmt.run(id);
	},

	/**
	 * Toggle enabled status
	 * @param {number} id
	 * @param {boolean} enabled
	 */
	toggle(id, enabled) {
		const stmt = db.prepare('UPDATE whitelist SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
		return stmt.run(enabled ? 1 : 0, id);
	},

	/**
	 * Check if title is whitelisted
	 * @param {string} title
	 * @returns {Object|null}
	 */
	findByTitle(title) {
		const stmt = db.prepare('SELECT * FROM whitelist WHERE LOWER(title) = LOWER(?) AND enabled = 1');
		return stmt.get(title);
	}
};

// RSS entries operations
const rssOperations = {
	/**
	 * Add RSS entry
	 * @param {number|null} id - If null, auto-generate ID
	 * @param {string} guid
	 * @param {string} title
	 * @param {string} link
	 * @param {string} pubDate
	 */
	add(id, guid, title, link, pubDate) {
		try {
			if (id === null) {
				// Check if entry already exists
				const existingStmt = db.prepare('SELECT id FROM rss_entries WHERE guid = ?');
				const existing = existingStmt.get(guid);

				if (existing) {
					// console.log(`📝 RSS DB: Entry already exists with ID: ${existing.id}`);
					return { lastInsertRowid: existing.id, changes: 0 };
				}

				// Auto-generate ID and insert new entry
				const stmt = db.prepare('INSERT INTO rss_entries (guid, title, link, pub_date) VALUES (?, ?, ?, ?)');
				const result = stmt.run(guid, title, link, pubDate);
				console.log(`📝 RSS DB: Added new entry with ID: ${result.lastInsertRowid}`);
				return result;
			} else {
				// Use provided ID
				const stmt = db.prepare('INSERT OR IGNORE INTO rss_entries (id, guid, title, link, pub_date) VALUES (?, ?, ?, ?, ?)');
				return stmt.run(id, guid, title, link, pubDate);
			}
		} catch (error) {
			console.error(`❌ RSS DB: Error adding RSS entry:`, error);
			throw error;
		}
	},

	/**
	 * Check if RSS entry exists
	 * @param {string} guid
	 * @returns {boolean}
	 */
	exists(guid) {
		const stmt = db.prepare('SELECT 1 FROM rss_entries WHERE guid = ?');
		return stmt.get(guid) !== undefined;
	},

	/**
	 * Get all processed entries
	 * @returns {Array}
	 */
	getProcessed() {
		const stmt = db.prepare('SELECT * FROM rss_entries ORDER BY id DESC');
		return stmt.all();
	}
};

// Downloads operations
const downloadOperations = {
	/**
	 * Add download
	 * @param {Object} downloadData
	 */
	add(downloadData) {
		try {
			console.log(`💾 DB: Adding download to database:`, {
				rssEntryId: downloadData.rssEntryId,
				torrentLink: downloadData.torrentLink,
				torrentTitle: downloadData.torrentTitle,
				finalTitle: downloadData.finalTitle,
				status: downloadData.status || 'queued'
			});

			const stmt = db.prepare(`
				INSERT INTO downloads (rss_entry_id, torrent_link, torrent_title, final_title, status)
				VALUES (?, ?, ?, ?, ?)
			`);
			const result = stmt.run(
				downloadData.rssEntryId,
				downloadData.torrentLink,
				downloadData.torrentTitle,
				downloadData.finalTitle,
				downloadData.status || 'queued'
			);

			console.log(`✅ DB: Successfully added download:`, {
				downloadId: result.lastInsertRowid,
				changes: result.changes
			});

			return result;
		} catch (error) {
			console.error(`❌ DB: Error adding download:`, error);
			console.error(`❌ DB: Download data that failed:`, downloadData);
			throw error;
		}
	},

	/**
	 * Create download (for download manager)
	 * @param {Object} downloadData
	 */
	create(downloadData) {
		const stmt = db.prepare(`
			INSERT INTO downloads (torrent_link, torrent_title, final_title, status, progress, download_speed)
			VALUES (?, ?, ?, ?, ?, ?)
		`);
		const createResult = stmt.run(
			downloadData.torrent_link || downloadData.magnet_uri,
			downloadData.torrent_title,
			downloadData.final_title || downloadData.anime_title,
			downloadData.status || 'queued',
			downloadData.progress || 0,
			downloadData.downloadSpeed || 0
		);

		// Return the created record with ID
		return {
			id: createResult.lastInsertRowid,
			torrent_link: downloadData.torrent_link || downloadData.magnet_uri,
			torrent_title: downloadData.torrent_title,
			final_title: downloadData.final_title || downloadData.anime_title,
			status: downloadData.status || 'queued',
			progress: downloadData.progress || 0,
			downloadSpeed: downloadData.downloadSpeed || 0,
			uploadSpeed: downloadData.uploadSpeed || 0,
			downloaded: downloadData.downloaded || 0,
			uploaded: downloadData.uploaded || 0,
			totalSize: downloadData.totalSize || 0,
			createdAt: downloadData.createdAt
		};
	},

	/**
	 * Update download progress
	 * @param {number} id
	 * @param {Object} updateData
	 */
	updateProgress(id, updateData) {
		const fields = [];
		const values = [];

		if (updateData.progress !== undefined) {
			fields.push('progress = ?');
			values.push(updateData.progress);
		}
		if (updateData.downloadSpeed !== undefined) {
			fields.push('download_speed = ?');
			values.push(updateData.downloadSpeed);
		}
		if (updateData.status !== undefined) {
			fields.push('status = ?');
			values.push(updateData.status);
		}
		if (updateData.fileName !== undefined) {
			fields.push('file_name = ?');
			values.push(updateData.fileName);
		}
		if (updateData.filePath !== undefined) {
			fields.push('file_path = ?');
			values.push(updateData.filePath);
		}
		if (updateData.fileSize !== undefined) {
			fields.push('file_size = ?');
			values.push(updateData.fileSize);
		}
		if (updateData.errorMessage !== undefined) {
			fields.push('error_message = ?');
			values.push(updateData.errorMessage);
		}
		if (updateData.uploadSpeed !== undefined) {
			fields.push('upload_speed = ?');
			values.push(updateData.uploadSpeed);
		}
		if (updateData.peers !== undefined) {
			fields.push('peers = ?');
			values.push(updateData.peers);
		}
		if (updateData.downloaded !== undefined) {
			fields.push('downloaded = ?');
			values.push(updateData.downloaded);
		}
		if (updateData.uploaded !== undefined) {
			fields.push('uploaded = ?');
			values.push(updateData.uploaded);
		}
		if (updateData.totalSize !== undefined) {
			fields.push('total_size = ?');
			values.push(updateData.totalSize);
		}
		if (updateData.startedAt !== undefined) {
			fields.push('started_at = ?');
			values.push(updateData.startedAt);
		}
		if (updateData.completedAt !== undefined) {
			fields.push('completed_at = ?');
			values.push(updateData.completedAt);
		}
		if (updateData.retry_count !== undefined) {
			fields.push('retry_count = ?');
			values.push(updateData.retry_count);
		}
		if (updateData.max_retries !== undefined) {
			fields.push('max_retries = ?');
			values.push(updateData.max_retries);
		}
		if (updateData.last_retry_at !== undefined) {
			fields.push('last_retry_at = ?');
			values.push(updateData.last_retry_at);
		}

		if (updateData.status === 'downloading' && !updateData.startedAt) {
			fields.push('started_at = CURRENT_TIMESTAMP');
		}
		if (updateData.status === 'completed' && !updateData.completedAt) {
			fields.push('completed_at = CURRENT_TIMESTAMP');
		}

		if (fields.length > 0) {
			values.push(id);
			const stmt = db.prepare(`UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`);
			return stmt.run(...values);
		}
		return { changes: 0 };
	},

	/**
	 * Get all downloads
	 * @returns {Array}
	 */
	getAll() {
		const stmt = db.prepare('SELECT * FROM downloads ORDER BY created_at DESC');
		return stmt.all();
	},

	/**
	 * Get active downloads
	 * @returns {Array}
	 */
	getActive() {
		const stmt = db.prepare("SELECT * FROM downloads WHERE status IN ('queued', 'downloading', 'paused') ORDER BY created_at");
		return stmt.all();
	},

	/**
	 * Delete a download
	 * @param {number} id
	 * @returns {Object}
	 */
	delete(id) {
		const stmt = db.prepare('DELETE FROM downloads WHERE id = ?');
		return stmt.run(id);
	}
};

// Configuration operations
const configOperations = {
	/**
	 * Get configuration value
	 * @param {string} key
	 * @returns {string|null}
	 */
	get(key) {
		const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
		const configResult = stmt.get(key);
		return configResult ? configResult.value : null;
	},

	/**
	 * Set configuration value
	 * @param {string} key
	 * @param {string} value
	 */
	set(key, value) {
		const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
		return stmt.run(key, value);
	},

	/**
	 * Get all configuration
	 * @returns {Object}
	 */
	getAll() {
		const stmt = db.prepare('SELECT key, value FROM config');
		const configResults = stmt.all();
		return configResults.reduce((config, row) => {
			config[row.key] = row.value;
			return config;
		}, {});
	},

	/**
	 * Delete configuration value
	 * @param {string} key
	 */
	delete(key) {
		const stmt = db.prepare('DELETE FROM config WHERE key = ?');
		return stmt.run(key);
	}
};

// Season mappings operations
const seasonMappingOperations = {
	/**
	 * Get all season mappings
	 * @returns {Array}
	 */
	getAll() {
		const stmt = db.prepare('SELECT * FROM season_mappings ORDER BY original_title');
		return stmt.all();
	},

	/**
	 * Add season mapping
	 * @param {string} originalTitle
	 * @param {string} seasonTitle
	 * @param {number} startEpisode
	 */
	add(originalTitle, seasonTitle, startEpisode) {
		const stmt = db.prepare('INSERT INTO season_mappings (original_title, season_title, start_episode) VALUES (?, ?, ?)');
		return stmt.run(originalTitle, seasonTitle, startEpisode);
	},

	/**
	 * Find season mapping by original title
	 * @param {string} originalTitle
	 * @returns {Object|null}
	 */
	findByTitle(originalTitle) {
		const stmt = db.prepare('SELECT * FROM season_mappings WHERE original_title = ?');
		return stmt.get(originalTitle);
	}
};

/**
 * AniList accounts operations
 */
const anilistAccountOperations = {
	/**
	 * Add or update AniList account
	 * @param {Object} account
	 */
	upsert(account) {
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO anilist_accounts
			(user_id, username, access_token, avatar_url, banner_url, about, anime_count, mean_score, minutes_watched, is_active, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`);
		return stmt.run(
			account.user_id,
			account.username,
			account.access_token,
			account.avatar_url || null,
			account.banner_url || null,
			account.about || null,
			account.anime_count || 0,
			account.mean_score || 0,
			account.minutes_watched || 0,
			account.is_active !== undefined ? (account.is_active ? 1 : 0) : 1
		);
	},

	/**
	 * Get account by user ID
	 * @param {number} userId
	 */
	getByUserId(userId) {
		const stmt = db.prepare('SELECT * FROM anilist_accounts WHERE user_id = ?');
		return stmt.get(userId);
	},

	/**
	 * Get active account
	 */
	getActive() {
		const stmt = db.prepare('SELECT * FROM anilist_accounts WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1');
		return stmt.get();
	},

	/**
	 * Get all accounts
	 */
	getAll() {
		const stmt = db.prepare('SELECT * FROM anilist_accounts ORDER BY updated_at DESC');
		return stmt.all();
	},

	/**
	 * Delete account
	 * @param {number} id
	 */
	delete(id) {
		const stmt = db.prepare('DELETE FROM anilist_accounts WHERE id = ?');
		return stmt.run(id);
	},

	/**
	 * Set account as active
	 * @param {number} id
	 */
	setActive(id) {
		const transaction = db.transaction(() => {
			// Deactivate all accounts
			db.prepare('UPDATE anilist_accounts SET is_active = 0').run();
			// Activate the specified account
			db.prepare('UPDATE anilist_accounts SET is_active = 1 WHERE id = ?').run(id);
		});
		return transaction();
	}
};

/**
 * AniList auto-download lists operations
 */
const anilistAutoListOperations = {
	/**
	 * Add or update auto-download list configuration
	 * @param {Object} config
	 */
	upsert(config) {
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO anilist_auto_lists
			(account_id, list_status, enabled, quality, preferred_group, updated_at)
			VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`);
		return stmt.run(
			config.account_id,
			config.list_status,
			config.enabled ? 1 : 0,
			config.quality || '1080p',
			config.preferred_group || 'any'
		);
	},

	/**
	 * Get auto-download lists for account
	 * @param {number} accountId
	 */
	getByAccountId(accountId) {
		const stmt = db.prepare('SELECT * FROM anilist_auto_lists WHERE account_id = ?');
		return stmt.all(accountId);
	},

	/**
	 * Get enabled auto-download lists
	 */
	getEnabled() {
		const stmt = db.prepare(`
			SELECT al.*, aa.user_id, aa.username
			FROM anilist_auto_lists al
			JOIN anilist_accounts aa ON al.account_id = aa.id
			WHERE al.enabled = 1 AND aa.is_active = 1
		`);
		return stmt.all();
	},

	/**
	 * Delete auto-download list
	 * @param {number} id
	 */
	delete(id) {
		const stmt = db.prepare('DELETE FROM anilist_auto_lists WHERE id = ?');
		return stmt.run(id);
	},

	/**
	 * Toggle auto-download list
	 * @param {number} id
	 * @param {boolean} enabled
	 */
	toggle(id, enabled) {
		const stmt = db.prepare('UPDATE anilist_auto_lists SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
		return stmt.run(enabled ? 1 : 0, id);
	}
};

/**
 * Run database migrations
 */
async function runMigrations() {
	try {
		// Check if downloads table has the new columns
		const tableInfo = db.prepare("PRAGMA table_info(downloads)").all();
		const columnNames = tableInfo.map(col => col.name);

		// Add missing columns
		const columnsToAdd = [
			{ name: 'upload_speed', type: 'REAL DEFAULT 0' },
			{ name: 'peers', type: 'INTEGER DEFAULT 0' },
			{ name: 'downloaded', type: 'INTEGER DEFAULT 0' },
			{ name: 'uploaded', type: 'INTEGER DEFAULT 0' },
			{ name: 'total_size', type: 'INTEGER DEFAULT 0' },
			{ name: 'retry_count', type: 'INTEGER DEFAULT 0' },
			{ name: 'max_retries', type: 'INTEGER DEFAULT 3' },
			{ name: 'last_retry_at', type: 'DATETIME' }
		];

		for (const column of columnsToAdd) {
			if (!columnNames.includes(column.name)) {
				db.exec(`ALTER TABLE downloads ADD COLUMN ${column.name} ${column.type}`);
				console.log(`Added column ${column.name} to downloads table`);
			}
		}

		// Check if whitelist table has the new columns
		const whitelistInfo = db.prepare("PRAGMA table_info(whitelist)").all();
		const whitelistColumns = whitelistInfo.map(col => col.name);

		const whitelistColumnsToAdd = [
			{ name: 'keywords', type: 'TEXT DEFAULT ""' },
			{ name: 'exclude_keywords', type: 'TEXT DEFAULT ""' },
			{ name: 'quality', type: 'TEXT DEFAULT "1080p"' },
			{ name: 'enabled', type: 'INTEGER DEFAULT 1' }
		];

		for (const column of whitelistColumnsToAdd) {
			if (!whitelistColumns.includes(column.name)) {
				db.exec(`ALTER TABLE whitelist ADD COLUMN ${column.name} ${column.type}`);
				console.log(`Added column ${column.name} to whitelist table`);
			}
		}

		// Add AniList-related columns to whitelist table
		const anilistWhitelistColumns = [
			{ name: 'source_type', type: 'TEXT DEFAULT "manual"' },
			{ name: 'anilist_id', type: 'INTEGER' },
			{ name: 'anilist_account_id', type: 'INTEGER' },
			{ name: 'auto_sync', type: 'INTEGER DEFAULT 0' }
		];

		for (const column of anilistWhitelistColumns) {
			if (!whitelistColumns.includes(column.name)) {
				db.exec(`ALTER TABLE whitelist ADD COLUMN ${column.name} ${column.type}`);
				console.log(`Added column ${column.name} to whitelist table`);
			}
		}

		// Add alternative title columns for enhanced matching
		const alternativeTitleColumns = [
			{ name: 'title_romaji', type: 'TEXT' },
			{ name: 'title_english', type: 'TEXT' },
			{ name: 'title_synonyms', type: 'TEXT' } // JSON array of synonyms
		];

		for (const column of alternativeTitleColumns) {
			if (!whitelistColumns.includes(column.name)) {
				db.exec(`ALTER TABLE whitelist ADD COLUMN ${column.name} ${column.type}`);
				console.log(`Added column ${column.name} to whitelist table`);
			}
		}

		// Add multi-select columns for groups and qualities
		const multiSelectColumns = [
			{ name: 'allowed_groups', type: 'TEXT' }, // JSON array of allowed groups
			{ name: 'allowed_qualities', type: 'TEXT' } // JSON array of allowed qualities
		];

		for (const column of multiSelectColumns) {
			if (!whitelistColumns.includes(column.name)) {
				db.exec(`ALTER TABLE whitelist ADD COLUMN ${column.name} ${column.type}`);
				console.log(`Added column ${column.name} to whitelist table`);
			}
		}

		// Migrate existing single-value data to multi-select format
		const existingEntries = db.prepare('SELECT id, quality, preferred_group FROM whitelist WHERE allowed_groups IS NULL OR allowed_qualities IS NULL').all();

		for (const entry of existingEntries) {
			const allowedGroups = entry.preferred_group && entry.preferred_group !== 'any' ? [entry.preferred_group] : [];
			const allowedQualities = entry.quality && entry.quality !== 'any' ? [entry.quality] : [];

			db.prepare('UPDATE whitelist SET allowed_groups = ?, allowed_qualities = ? WHERE id = ?')
				.run(JSON.stringify(allowedGroups), JSON.stringify(allowedQualities), entry.id);
		}

		console.log(`Migrated ${existingEntries.length} whitelist entries to multi-select format`);

		// Drop the unique constraint on title and recreate with new constraint
		try {
			// Check if we need to update the unique constraint
			const indexInfo = db.prepare("PRAGMA index_list(whitelist)").all();
			const hasOldUniqueConstraint = indexInfo.some(idx =>
				idx.name.includes('title') && idx.unique === 1
			);

			if (hasOldUniqueConstraint) {
				console.log('Updating whitelist table unique constraint...');
				// This would require recreating the table, but for now we'll skip it
				// to avoid data loss. The new constraint will be applied to new installations.
			}
		} catch (error) {
			console.log('Could not update whitelist unique constraint:', error.message);
		}

		// Migrate processed_files table to use global episode-based duplicate prevention
		try {
			const processedFilesInfo = db.prepare("PRAGMA table_info(processed_files)").all();
			const processedFilesIndexes = db.prepare("PRAGMA index_list(processed_files)").all();

			// Check if we have the old unique constraint (whitelist_entry_id, episode_number, anime_title)
			const hasOldConstraint = processedFilesIndexes.some(idx =>
				idx.unique === 1 && idx.name.includes('whitelist_entry_id')
			);

			if (hasOldConstraint) {
				console.log('Migrating processed_files table to global episode-based duplicate prevention...');

				// Create new table with updated constraint
				db.exec(`
					CREATE TABLE processed_files_new (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						whitelist_entry_id INTEGER NOT NULL,
						original_filename TEXT NOT NULL,
						final_title TEXT NOT NULL,
						episode_number TEXT,
						anime_title TEXT NOT NULL,
						release_group TEXT,
						video_resolution TEXT,
						file_checksum TEXT,
						torrent_link TEXT NOT NULL,
						download_status TEXT DEFAULT 'processed',
						processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
						FOREIGN KEY (whitelist_entry_id) REFERENCES whitelist (id) ON DELETE CASCADE,
						UNIQUE(anime_title, episode_number)
					)
				`);

				// Copy data, keeping only the first occurrence of each anime_title + episode_number combination
				db.exec(`
					INSERT INTO processed_files_new
					SELECT * FROM processed_files
					WHERE id IN (
						SELECT MIN(id)
						FROM processed_files
						GROUP BY anime_title, episode_number
					)
				`);

				// Drop old table and rename new one
				db.exec('DROP TABLE processed_files');
				db.exec('ALTER TABLE processed_files_new RENAME TO processed_files');

				console.log('Successfully migrated processed_files table');
			}
		} catch (error) {
			console.log('Could not migrate processed_files table:', error.message);
		}

		// Normalize existing anime titles in processed_files for consistent duplicate detection
		try {
			console.log('Normalizing anime titles in processed_files table...');

			// Function to normalize titles (same as RSS processor)
			const normalizeTitle = (title) => {
				if (!title) return '';
				return title
					.toLowerCase()
					.replace(/[^\w\s]/g, '') // Remove all punctuation
					.replace(/\s+/g, ' ')    // Normalize whitespace
					.trim();
			};

			// Get all processed files
			const allFiles = db.prepare('SELECT id, anime_title FROM processed_files').all();

			// Update each file with normalized title
			const updateStmt = db.prepare('UPDATE processed_files SET anime_title = ? WHERE id = ?');

			let normalizedCount = 0;
			for (const file of allFiles) {
				const normalizedTitle = normalizeTitle(file.anime_title);
				if (normalizedTitle !== file.anime_title) {
					updateStmt.run(normalizedTitle, file.id);
					normalizedCount++;
				}
			}

			console.log(`Successfully normalized ${normalizedCount} anime titles in processed_files table`);
		} catch (error) {
			console.log('Could not normalize anime titles:', error.message);
		}

	} catch (error) {
		console.error('Error running migrations:', error);
		// Don't throw error, let table creation continue
	}
}

/**
 * AniList anime cache operations
 */
const anilistAnimeCacheOperations = {
	/**
	 * Add or update anime in cache
	 * @param {Object} anime
	 */
	upsert(anime) {
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO anilist_anime_cache
			(anilist_id, title_romaji, title_english, title_native, synonyms, format, status, episodes, season, season_year, average_score, genres, cover_image_url, banner_image_url, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`);
		return stmt.run(
			anime.anilist_id,
			anime.title_romaji,
			anime.title_english,
			anime.title_native,
			Array.isArray(anime.synonyms) ? JSON.stringify(anime.synonyms) : anime.synonyms,
			anime.format,
			anime.status,
			anime.episodes,
			anime.season,
			anime.season_year,
			anime.average_score,
			Array.isArray(anime.genres) ? JSON.stringify(anime.genres) : anime.genres,
			anime.cover_image_url,
			anime.banner_image_url
		);
	},

	/**
	 * Get anime by AniList ID
	 * @param {number} anilistId
	 */
	getByAnilistId(anilistId) {
		const stmt = db.prepare('SELECT * FROM anilist_anime_cache WHERE anilist_id = ?');
		const result = stmt.get(anilistId);
		if (result) {
			// Parse JSON fields
			if (result.synonyms) {
				try {
					result.synonyms = JSON.parse(result.synonyms);
				} catch (e) {
					result.synonyms = [];
				}
			}
			if (result.genres) {
				try {
					result.genres = JSON.parse(result.genres);
				} catch (e) {
					result.genres = [];
				}
			}
		}
		return result;
	},

	/**
	 * Search anime in cache
	 * @param {string} query
	 */
	search(query) {
		const stmt = db.prepare(`
			SELECT * FROM anilist_anime_cache
			WHERE title_romaji LIKE ? OR title_english LIKE ? OR title_native LIKE ?
			ORDER BY title_romaji
		`);
		const searchTerm = `%${query}%`;
		return stmt.all(searchTerm, searchTerm, searchTerm);
	},

	/**
	 * Delete old cache entries
	 * @param {number} daysOld
	 */
	deleteOld(daysOld = 30) {
		const stmt = db.prepare('DELETE FROM anilist_anime_cache WHERE updated_at < datetime("now", "-" || ? || " days")');
		return stmt.run(daysOld);
	}
};

/**
 * Anime relations operations
 */
const animeRelationsOperations = {
	/**
	 * Add anime relation
	 * @param {Object} relation
	 */
	add(relation) {
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO anime_relations
			(source_anilist_id, source_mal_id, source_kitsu_id, source_episode_start, source_episode_end,
			 dest_anilist_id, dest_mal_id, dest_kitsu_id, dest_episode_start, dest_episode_end,
			 has_exclamation, raw_rule, source_anime_title, dest_anime_title, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`);
		return stmt.run(
			relation.source_anilist_id,
			relation.source_mal_id,
			relation.source_kitsu_id,
			relation.source_episode_start,
			relation.source_episode_end,
			relation.dest_anilist_id,
			relation.dest_mal_id,
			relation.dest_kitsu_id,
			relation.dest_episode_start,
			relation.dest_episode_end,
			relation.has_exclamation ? 1 : 0,
			relation.raw_rule,
			relation.source_anime_title,
			relation.dest_anime_title
		);
	},

	/**
	 * Get relations by source AniList ID
	 * @param {number} anilistId
	 */
	getBySourceId(anilistId) {
		const stmt = db.prepare('SELECT * FROM anime_relations WHERE source_anilist_id = ?');
		return stmt.all(anilistId);
	},

	/**
	 * Get all relations
	 */
	getAll() {
		const stmt = db.prepare('SELECT * FROM anime_relations ORDER BY source_anilist_id, source_episode_start');
		return stmt.all();
	},

	/**
	 * Clear all relations
	 */
	clear() {
		const stmt = db.prepare('DELETE FROM anime_relations');
		return stmt.run();
	},

	/**
	 * Get episode mapping
	 * @param {number} anilistId
	 * @param {number} episodeNumber
	 */
	getEpisodeMapping(anilistId, episodeNumber) {
		const stmt = db.prepare(`
			SELECT * FROM anime_relations
			WHERE source_anilist_id = ?
			AND ? BETWEEN source_episode_start AND source_episode_end
		`);
		return stmt.get(anilistId, episodeNumber);
	}
};

/**
 * Processed files operations (for duplicate prevention and download tracking)
 */
const processedFilesOperations = {
	/**
	 * Add processed file record
	 * @param {Object} data
	 */
	add(data) {
		try {
			console.log(`📝 DB: Adding processed file record:`, {
				whitelist_entry_id: data.whitelist_entry_id,
				episode_number: data.episode_number,
				anime_title: data.anime_title,
				final_title: data.final_title
			});

			const stmt = db.prepare(`
				INSERT INTO processed_files (
					whitelist_entry_id, original_filename, final_title,
					episode_number, anime_title, release_group,
					video_resolution, file_checksum, torrent_link, download_status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);
			const result = stmt.run(
				data.whitelist_entry_id, data.original_filename, data.final_title,
				data.episode_number, data.anime_title, data.release_group,
				data.video_resolution, data.file_checksum, data.torrent_link,
				data.download_status || 'processed'
			);

			console.log(`✅ DB: Successfully added processed file record:`, {
				insertId: result.lastInsertRowid,
				changes: result.changes
			});

			return result;
		} catch (error) {
			console.error(`❌ DB: Error adding processed file record:`, error);
			console.error(`❌ DB: Data that failed to insert:`, data);
			throw error;
		}
	},

	/**
	 * Check if file was already processed (globally across all groups)
	 * @param {string} episodeNumber
	 * @param {string} animeTitle - Should be normalized title
	 */
	exists(episodeNumber, animeTitle) {
		try {
			// Check both normalized and original titles for backward compatibility
			const stmt = db.prepare(`
				SELECT COUNT(*) as count FROM processed_files
				WHERE episode_number = ? AND anime_title = ?
			`);
			const result = stmt.get(episodeNumber, animeTitle);
			console.log(`🔍 DB: Checking processed files exists (global):`, {
				episodeNumber,
				animeTitle,
				count: result.count,
				exists: result.count > 0
			});
			return result.count > 0;
		} catch (error) {
			console.error(`❌ DB: Error checking processed files exists:`, error);
			return false; // If there's an error, assume it doesn't exist to allow processing
		}
	},

	/**
	 * Check if file was already processed for specific whitelist entry (legacy method)
	 * @param {number} whitelistEntryId
	 * @param {string} episodeNumber
	 * @param {string} animeTitle
	 */
	existsForEntry(whitelistEntryId, episodeNumber, animeTitle) {
		try {
			const stmt = db.prepare(`
				SELECT COUNT(*) as count FROM processed_files
				WHERE whitelist_entry_id = ? AND episode_number = ? AND anime_title = ?
			`);
			const result = stmt.get(whitelistEntryId, episodeNumber, animeTitle);
			console.log(`🔍 DB: Checking processed files exists for entry:`, {
				whitelistEntryId,
				episodeNumber,
				animeTitle,
				count: result.count,
				exists: result.count > 0
			});
			return result.count > 0;
		} catch (error) {
			console.error(`❌ DB: Error checking processed files exists for entry:`, error);
			return false; // If there's an error, assume it doesn't exist to allow processing
		}
	},

	/**
	 * Get processed files by whitelist entry
	 * @param {number} whitelistEntryId
	 */
	getByWhitelistEntry(whitelistEntryId) {
		const stmt = db.prepare(`
			SELECT * FROM processed_files
			WHERE whitelist_entry_id = ?
			ORDER BY processed_at DESC
		`);
		return stmt.all(whitelistEntryId);
	},

	/**
	 * Get all processed files with whitelist info
	 */
	getAll() {
		const stmt = db.prepare(`
			SELECT pf.*, w.title as whitelist_title
			FROM processed_files pf
			LEFT JOIN whitelist w ON pf.whitelist_entry_id = w.id
			ORDER BY pf.processed_at DESC
		`);
		return stmt.all();
	},

	/**
	 * Delete processed file record
	 * @param {number} id
	 */
	delete(id) {
		const stmt = db.prepare('DELETE FROM processed_files WHERE id = ?');
		return stmt.run(id);
	},

	/**
	 * Delete all processed files for a whitelist entry
	 * @param {number} whitelistEntryId
	 */
	deleteByWhitelistEntry(whitelistEntryId) {
		const stmt = db.prepare('DELETE FROM processed_files WHERE whitelist_entry_id = ?');
		return stmt.run(whitelistEntryId);
	},

	/**
	 * Update processed file record
	 * @param {number} id
	 * @param {Object} data
	 */
	update(id, data) {
		const stmt = db.prepare(`
			UPDATE processed_files
			SET final_title = ?, download_status = ?
			WHERE id = ?
		`);
		return stmt.run(data.final_title, data.download_status, id);
	},

	/**
	 * Clear all processed files
	 */
	clear() {
		const stmt = db.prepare('DELETE FROM processed_files');
		return stmt.run();
	}
};

/**
 * Activity logs operations (for user-relevant application events)
 */
const activityLogsOperations = {
	/**
	 * Add activity log entry
	 * @param {Object} data
	 */
	add(data) {
		try {
			const stmt = db.prepare(`
				INSERT INTO activity_logs (type, title, description, metadata)
				VALUES (?, ?, ?, ?)
			`);
			return stmt.run(
				data.type,
				data.title,
				data.description || null,
				data.metadata ? JSON.stringify(data.metadata) : null
			);
		} catch (error) {
			console.error('❌ DB: Error adding activity log:', error);
			throw error;
		}
	},

	/**
	 * Get recent activity logs
	 * @param {number} limit
	 * @param {string} type - Optional type filter
	 */
	getRecent(limit = 100, type = null) {
		try {
			let query = 'SELECT * FROM activity_logs';
			let params = [];

			if (type) {
				query += ' WHERE type = ?';
				params.push(type);
			}

			query += ' ORDER BY created_at DESC LIMIT ?';
			params.push(limit);

			const stmt = db.prepare(query);
			const logs = stmt.all(...params);

			// Parse metadata JSON
			return logs.map(log => ({
				...log,
				metadata: log.metadata ? JSON.parse(log.metadata) : null
			}));
		} catch (error) {
			console.error('❌ DB: Error getting activity logs:', error);
			return [];
		}
	},

	/**
	 * Clear old activity logs (keep only recent ones)
	 * @param {number} keepCount - Number of logs to keep
	 */
	cleanup(keepCount = 1000) {
		try {
			const stmt = db.prepare(`
				DELETE FROM activity_logs
				WHERE id NOT IN (
					SELECT id FROM activity_logs
					ORDER BY created_at DESC
					LIMIT ?
				)
			`);
			return stmt.run(keepCount);
		} catch (error) {
			console.error('❌ DB: Error cleaning up activity logs:', error);
			throw error;
		}
	},

	/**
	 * Clear all activity logs
	 */
	clear() {
		try {
			const stmt = db.prepare('DELETE FROM activity_logs');
			return stmt.run();
		} catch (error) {
			console.error('❌ DB: Error clearing activity logs:', error);
			throw error;
		}
	}
};

/**
 * Processed GUIDs operations (for RSS GUID tracking)
 */
const processedGuidsOperations = {
	/**
	 * Check if GUID was already processed
	 * @param {string} guid
	 */
	exists(guid) {
		try {
			const stmt = db.prepare('SELECT 1 FROM processed_guids WHERE guid = ?');
			return stmt.get(guid) !== undefined;
		} catch (error) {
			console.error('❌ DB: Error checking processed GUID:', error);
			return false;
		}
	},

	/**
	 * Add processed GUID
	 * @param {string} guid
	 */
	add(guid) {
		try {
			const stmt = db.prepare('INSERT OR IGNORE INTO processed_guids (guid) VALUES (?)');
			return stmt.run(guid);
		} catch (error) {
			console.error('❌ DB: Error adding processed GUID:', error);
			throw error;
		}
	},

	/**
	 * Get all processed GUIDs
	 */
	getAll() {
		try {
			const stmt = db.prepare('SELECT * FROM processed_guids ORDER BY processed_at DESC');
			return stmt.all();
		} catch (error) {
			console.error('❌ DB: Error getting processed GUIDs:', error);
			return [];
		}
	},

	/**
	 * Clear all processed GUIDs
	 */
	clear() {
		try {
			const stmt = db.prepare('DELETE FROM processed_guids');
			return stmt.run();
		} catch (error) {
			console.error('❌ DB: Error clearing processed GUIDs:', error);
			throw error;
		}
	}
};

// Export all functions and operations
module.exports = {
	initDatabase,
	getDatabase,
	closeDatabase,
	whitelistOperations,
	rssOperations,
	downloadOperations,
	configOperations,
	seasonMappingOperations,
	anilistAccountOperations,
	anilistAutoListOperations,
	anilistAnimeCacheOperations,
	animeRelationsOperations,
	processedFilesOperations,
	activityLogsOperations,
	processedGuidsOperations
};
