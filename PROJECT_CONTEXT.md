# Project Context: Last.fm Sync for Obsidian

## Overview
An Obsidian community plugin that seamlessly fetches a user's Last.fm scrobble history, top artists, and top albums directly into their Obsidian vault. It generates rich, linked Markdown notes with YAML frontmatter properties for integration with tools like Dataview.

**Author:** Jaival (GitHub: jaival-11)
**License:** MIT

## Tech Stack & Environment
*   **Language:** TypeScript
*   **Target:** Obsidian Plugin API (`minAppVersion`: 1.12.7)
*   **Build Tool:** esbuild / Node.js
*   **External API:** Last.fm API (`https://ws.audioscrobbler.com/2.0/`)

## Core Features
1.  **Incremental Syncing:** Pulls only new tracks since the last sync timestamp to minimize API requests.
2.  **Historical Backfill:** Allows pulling historical data up to custom limits, with a "Force Stop" cancellation flag.
3.  **Data Extraction:** Creates dedicated folders and notes for Tracks, Artists, and Albums, complete with playcounts and cover image URLs.
4.  **Smart Backlinking:** Automatically links scrobbled tracks directly into their respective Artist and Album notes.
5.  **Timezone Adjustments:** Manually offsets UTC time (e.g., `5.5` for IST) and includes a "Re-stamp" feature to recalculate local timestamps for existing files without hitting the API.
6.  **Live Stats:** Utilizes Obsidian `Notice` popups for detailed error handling and sync completion stats (e.g., "Artists Added: X, Albums Added: Y, Tracks Added: Z").

## Architecture & API Constraints

### Obsidian Plugin Rules (Strictly Enforced)
*   **Network Requests:** Standard web `fetch()` is strictly forbidden due to CORS and security rules. All network calls MUST use Obsidian's native `requestUrl` from the `obsidian` module.
*   **File System:** To bypass a known Obsidian AST linter bug with newer APIs, always use `this.app.vault.getAbstractFileByPath(path)` instead of `adapter.exists()` to check if a folder or file exists. 
*   **Settings UI:** Use modern UI methods like `.setHeading()` and `.setDestructive()`. Avoid using generic names like "General Settings" for headings.
*   **Command IDs:** Command IDs defined in `this.addCommand()` must not include the plugin ID (e.g., use `id: 'sync'`, not `id: 'sync-lastfm'`) to prevent linter conflicts.
*   **Linter Bypasses:** Do not use `eslint-disable` comments to bypass Obsidian's validation checks. Code must natively pass the strict TypeScript and Obsidian API linters.

### Last.fm API Limitations
*   **Rate Limiting:** The Last.fm API strictly rate-limits requests. Features that require iterating through the entire Obsidian vault and making 1:1 API calls for each file (e.g., verifying if a historical scrobble was deleted from the website) are explicitly out of scope to prevent IP bans.
*   **Strict Typing:** The Last.fm API returns complex JSON structures that can vary (e.g., returning a single object vs. an array if only one item exists). All API responses must be strictly typed using TypeScript interfaces; do not use `any` or `unsafe` assignments.

## Repository Standards
*   **README Structure:** The `README.md` follows a strict structure including a Markdown table of contents, side-by-side mobile screenshots (using HTML `<img>` tags), a Network Usage disclosure, an API Key Guide, and collapsible `<details>` blocks for installation methods.
*   **Reproducible Builds:** The repository requires a `package-lock.json` and GitHub Actions configured with artifact attestations to prove provenance.

