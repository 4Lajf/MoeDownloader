# AniList Integration Guide

This document explains how to set up and use the AniList integration in MoeDownloader.

## Overview

The AniList integration allows you to:
- Connect your AniList account to automatically download anime from your lists
- Handle continuous numbering schemes across seasons (e.g., Fate/Zero episodes 14-25 mapping to Season 2 episodes 1-12)
- Parse anime filenames intelligently using the ported Anitomy library
- Sync your anime lists automatically at configurable intervals

## Features

### 1. Automatic List Synchronization
- **CURRENT**: Currently watching anime
- **PLANNING**: Anime you plan to watch
- **COMPLETED**: Finished anime (useful for rewatching)
- **DROPPED**: Dropped anime (can be excluded)
- **PAUSED**: Paused anime

### 2. Episode Relations Handling
The app automatically fetches and parses the [anime-relations](https://github.com/erengy/anime-relations) database to handle cases where fansub groups use continuous numbering across seasons.

**Example**: 
- Fate/Zero Season 1 has 13 episodes
- Some groups number Season 2 episodes as 14-25 instead of 1-12
- The app automatically maps episode 14 → Season 2 Episode 1

### 3. Intelligent Filename Parsing
Uses a JavaScript port of the [Anitomy](https://github.com/erengy/anitomy) library to extract:
- Anime title
- Episode number
- Release group
- Video quality
- Audio codec
- File checksum
- And more...

## Setup Instructions

### 1. Create AniList Application

1. Go to [AniList Developer Settings](https://anilist.co/settings/developer)
2. Click "Create New Client"
3. Fill in the details:
   - **Name**: MoeDownloader (or your preferred name)
   - **Redirect URI**: `http://localhost:3000/auth/anilist/callback`
4. Save your **Client ID** and **Client Secret**

### 2. Connect Your Account

1. Open MoeDownloader
2. Go to **AniList** in the sidebar
3. Enter your **Client ID** and **Client Secret**
4. Click **Start Authentication**
5. Complete the OAuth flow in your browser
6. Enter the authorization code back in the app

### 3. Configure Auto-Download Lists

1. After authentication, you'll see your connected account
2. Click **Add list...** to select which lists to auto-download
3. Configure quality preferences and release groups for each list
4. Enable/disable lists as needed

### 4. Configure Sync Settings

- **Sync Interval**: How often to check for list updates (1-24 hours)
- **Manual Sync**: Force sync immediately with the "Sync Now" button
- **Anime Relations**: Refresh the episode mapping database

## How It Works

### Automatic Synchronization Process

1. **Periodic Check**: Every few hours (configurable), the app checks your AniList lists
2. **Compare Lists**: Compares current AniList entries with local whitelist
3. **Add New Entries**: Automatically adds new anime to your download whitelist
4. **Remove Dropped**: Removes anime you've dropped or completed (optional)
5. **Update Metadata**: Caches anime information for faster matching

### Download Matching Process

1. **RSS Processing**: When processing RSS feeds, the app parses each filename
2. **Title Extraction**: Uses Anitomy to extract anime title and episode number
3. **Whitelist Matching**: Matches against both manual and auto-synced entries
4. **Episode Mapping**: Applies anime relations if needed (e.g., continuous numbering)
5. **Quality Check**: Ensures the torrent matches your quality preferences
6. **Download**: Adds matching torrents to the download queue

### Episode Mapping Example

```
Original filename: [SubsPlease] Fate Zero - 14 (1080p).mkv
Parsed title: "Fate Zero"
Parsed episode: 14

Relations lookup:
- Source: Fate/Zero (AniList ID: 10087) episodes 14-25
- Maps to: Fate/Zero 2nd Season (AniList ID: 11741) episodes 1-12
- Episode 14 → Episode 1

Final match: Fate/Zero 2nd Season - Episode 01
```

## Configuration Options

### List Configuration
- **Quality**: Preferred video quality (480p, 720p, 1080p, etc.)
- **Release Group**: Preferred fansub group or "any"
- **Enabled**: Whether this list should auto-download

### Sync Configuration
- **Interval**: 1, 2, 4, 6, 12, or 24 hours
- **Auto-cleanup**: Remove entries when removed from AniList
- **Quality override**: Global quality preference

## Troubleshooting

### Authentication Issues
- **Invalid Client ID/Secret**: Double-check your AniList app credentials
- **Redirect URI mismatch**: Ensure you used `http://localhost:3000/auth/anilist/callback`
- **Token expired**: Re-authenticate if you get authentication errors

### Sync Issues
- **No new downloads**: Check if your lists have new entries and quality matches
- **Wrong episodes**: Verify anime relations are up to date (click "Refresh Relations")
- **Missing anime**: Some anime might not be in the relations database

### Matching Issues
- **Filename not recognized**: The Anitomy parser might not recognize the format
- **Wrong anime matched**: Check for title conflicts in your whitelist
- **Quality mismatch**: Ensure your quality preferences match available torrents

## API Rate Limits

AniList has rate limits on their API:
- **90 requests per minute** for authenticated users
- The app respects these limits and will retry if rate limited
- Sync intervals help distribute API usage over time

## Privacy and Security

- **Access Token**: Stored locally and encrypted
- **API Calls**: Only made to AniList's official API
- **Data Storage**: All data stored locally in SQLite database
- **No Tracking**: The app doesn't send usage data anywhere

## Advanced Usage

### Custom Episode Mapping
If you encounter anime with incorrect episode mapping:
1. Check the [anime-relations repository](https://github.com/erengy/anime-relations)
2. Submit a pull request with the correct mapping
3. Use "Refresh Relations" to update your local database

### Multiple Accounts
- The app supports multiple AniList accounts
- Switch between accounts in the settings
- Each account can have different list configurations

### Manual Override
- Auto-synced entries can be manually disabled
- Manual whitelist entries take precedence
- You can mix manual and auto entries freely

## Testing

Run the integration tests to verify everything is working:

```bash
npm run test:anilist
```

This will test:
- Anime relations parsing
- Filename parsing (Anitomy port)
- AniList API integration
- Episode mapping scenarios
- Edge cases and error handling

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Run the test suite to identify problems
3. Check the console logs for detailed error messages
4. Report issues with specific anime titles and filenames that aren't working
