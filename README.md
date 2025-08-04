# MoeDownloader

A modern anime downloader with AniList integration, built with Electron, Svelte, and TypeScript.

## Features

- **RSS Feed Processing**: Monitor multiple RSS feeds for new anime releases
- **Smart Whitelist System**: Automatically download anime based on your preferences
- **AniList Integration**: Sync your AniList account to auto-download from your lists
- **Episode Relations**: Handle continuous numbering schemes across seasons
- **Intelligent Filename Parsing**: Extract metadata from anime filenames using Anitomy
- **Quality Preferences**: Configure preferred video quality and release groups
- **Download Management**: Track and manage your downloads with a clean interface

## AniList Integration

MoeDownloader features deep integration with AniList:

- **Auto-sync Lists**: Automatically download anime from your CURRENT, PLANNING, COMPLETED, DROPPED, and PAUSED lists
- **Episode Mapping**: Handle cases where fansub groups use continuous numbering (e.g., Fate/Zero S2 episodes numbered 14-25 instead of 1-12)
- **Smart Matching**: Match torrents against your AniList entries using multiple title formats and synonyms
- **Configurable Sync**: Set sync intervals from 1-24 hours

See [AniList Integration Guide](docs/ANILIST_INTEGRATION.md) for detailed setup instructions.

To get started you will need to install dependecies in both the root of the project and the `renderer/` folder where all of the ftontend code is contained.

Folder structure:

- **/**
  - readme.md
  - package.json
  - **electron** `(Contains all the electron specific code of the application)`
    - app.ts
    - preload.ts
      `(Sets up comminication between renderer and main process in electron (IPC))`
    - tsconfig.json `(Electron specific tsconfig file.)`
    - ...
  - **renderer**
    `(Contains all code/configs which are required for the frontend of your app)`
    - **src**
    - vite.config.json
    - package.json
    - ...

## Getting Started

### Installation

1. Clone the repository
2. Install dependencies in the root directory:
   ```bash
   npm install
   ```
3. Install renderer dependencies:
   ```bash
   cd renderer && npm install
   ```

### Development

- `npm run dev` - Start development mode with hot reloading
- `npm run test` - Run the complete test suite
- `npm run test:anilist` - Run AniList integration tests only

### Building

- `npm run package` - Package the application for distribution
- `npm run build:electron` - Build electron backend only
- `npm run build:renderer` - Build frontend only

## Configuration

1. **RSS Feeds**: Add your preferred anime RSS feeds (e.g., Nyaa, SubsPlease)
2. **Whitelist**: Add anime titles you want to download automatically
3. **AniList**: Connect your AniList account for automatic list synchronization
4. **Quality**: Set preferred video quality and release groups

## Testing

The application includes comprehensive tests for all major features:

```bash
npm run test
```

This will test:
- AniList API integration
- Anime relations parsing
- Filename parsing (Anitomy port)
- Download matching logic
- Edge cases and error handling

## Architecture

- **Frontend**: Svelte with TypeScript and Tailwind CSS
- **Backend**: Electron with Node.js and SQLite
- **Services**: Modular service architecture for RSS, downloads, and AniList
- **Database**: SQLite for local data storage
- **APIs**: AniList GraphQL API integration
