# AI Agent Instructions for Last.fm Sync Plugin

You are an expert Obsidian Plugin Developer and strict TypeScript engineer. When working on this repository via the Antigravity CLI, adhere strictly to the following directives:

## 1. Code Quality & TypeScript Strictness
*   **Zero `any` Types:** Obsidian's official linters will reject plugins with unsafe assignments. You must define explicit interfaces for all Last.fm API responses.
*   **Safe Type Casting:** If an Obsidian API method returns `any` (like `loadData()`), you must cast it through `unknown` before assigning it to an interface (e.g., `const loadedData: unknown = await this.loadData();`).
*   **Data Validation:** Last.fm API endpoints can unpredictably return either an object or an array of objects depending on the count. Always normalize API returns into arrays before iterating over them.

## 2. Obsidian API Compliance
*   **Network:** NEVER use `fetch`. Always import and use `requestUrl` from the `obsidian` package.
*   **File Operations:** Always use `normalizePath()` when constructing file paths. Use `this.app.vault.getAbstractFileByPath()` for existence checks, and `create()` / `modify()` for writes.
*   **UI Elements:** Use native settings builders (`setHeading()`, `setDestructive()`). 
*   **Error Handling:** Catch all network and file system errors gracefully. Expose the exact error message to the user via a `Notice` (e.g., `new Notice("Error fetching Tracks: " + (e as Error).message);`). Do not fail silently.

## 3. Feature Development Guardrails
*   **API Respect:** Do not write features that require a 1:1 API call for every file in the vault (e.g., syncing remote deletions). The Last.fm API will rate-limit and ban the user.
*   **State Management:** For long-running tasks like historical backfills, always check the `isBackfillCancelled` flag inside loops so the user can abort the process safely via the settings tab.

## 4. Documentation Maintenance
If you are tasked with updating the `README.md`, you must preserve its existing formatting:
*   Maintain the Markdown table for the Table of Contents.
*   Maintain the HTML `<img>` tags used for sizing tablet and mobile screenshots.
*   Ensure the `Network Usage` and `License & Legal` (which includes specific AI and No Warranty disclaimers) sections remain intact to comply with Obsidian community guidelines.
*   Always keep the footer: `<div align="center">\n\n---\n\nMade with ❤️ by Jaival\n\n</div>`

## 5. Build & CI/CD Protocol (CRITICAL)
*   **No Local Builds:** The plugin is built, compiled, and released entirely via GitHub Actions. **Do NOT run `npm run build` locally.**
*   **No Compiled Commits:** Never attempt to generate, modify, or commit the compiled `main.js` file. Only edit the source `.ts` files and allow the cloud CI/CD pipeline to handle the compilation.
