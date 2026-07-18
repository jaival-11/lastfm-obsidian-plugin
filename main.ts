import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath } from 'obsidian';

interface LastFmSettings {
    apiKey: string;
    username: string;
    folderName: string;
    lastSync: number;
    syncArtists: boolean;
    syncAlbums: boolean;
    linkArtists: boolean;
    linkAlbums: boolean;
    tzOffset: number;
    bfTracks: string;
    bfAlbums: string;
    bfArtists: string;
    syncOnStart: boolean;
}

const DEFAULT_SETTINGS: LastFmSettings = {
    apiKey: '',
    username: '',
    folderName: 'LastFM',
    lastSync: 0,
    syncArtists: true,
    syncAlbums: true,
    linkArtists: true,
    linkAlbums: true,
    tzOffset: 5.5,
    bfTracks: '50',
    bfAlbums: '20',
    bfArtists: '20',
    syncOnStart: false
}

export default class LastFmPlugin extends Plugin {
    isBackfillActive: boolean = false;
    isBackfillCancelled: boolean = false;
    settings: LastFmSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new LastFmSettingTab(this.app, this));

        this.addCommand({
            id: 'sync-lastfm',
            name: 'Sync from Last.fm',
            callback: () => this.syncLastFm(false)
        });

        try {
            this.addRibbonIcon('sync', 'Sync Last.fm', () => {
                this.syncLastFm(false);
            });
        } catch (e) {
            console.error("Last.fm: Failed to load ribbon icon", e);
        }

        if (this.settings.syncOnStart) {
            this.app.workspace.onLayoutReady(() => {
                this.syncLastFm(false);
            });
        }
    }

    formatOffsetDate(uts: number, offsetHours: number): string {
        const safeOffset = isNaN(offsetHours) ? 0 : offsetHours;
        const date = new Date((uts * 1000) + (safeOffset * 3600 * 1000));
        return date.toISOString().replace('T', ' ').substring(0, 16);
    }

    async syncLastFm(isBackfill: boolean, limits = { tracks: 50, albums: 50, artists: 50 }) {
        if (!this.settings.apiKey || !this.settings.username) {
            new Notice("Last.fm: Please configure API Key and Username.");
            return;
        }

        if (isBackfill) {
            this.isBackfillActive = true;
            this.isBackfillCancelled = false;
        }
        let stats = { artists: 0, albums: 0, tracksAdded: 0, tracksUpdated: 0 };
        const baseDir = normalizePath(this.settings.folderName);
        const tracksDir = normalizePath(`${baseDir}/Tracks`);
        const artistsDir = normalizePath(`${baseDir}/Artists`);
        const albumsDir = normalizePath(`${baseDir}/Albums`);
        
        try {
            const dirsToCreate = [baseDir, tracksDir];
            if (this.settings.syncArtists) dirsToCreate.push(artistsDir);
            if (this.settings.syncAlbums) dirsToCreate.push(albumsDir);

            for (const path of dirsToCreate) {
                if (!await this.app.vault.adapter.exists(path)) {
                    await this.app.vault.createFolder(path);
                }
            }
        } catch (e) {
            new Notice("Folder creation error: " + (e as Error).message);
            this.isBackfillActive = false;
            return;
        }

        // Fetch Artists
        if (this.settings.syncArtists && limits.artists > 0) {
            new Notice("Syncing Artists...");
            try {
                const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=${limits.artists}&_=${Date.now()}`;
                const res = await fetch(url, { cache: 'no-store' });
                const data = await res.json();
                
                if (data.topartists && data.topartists.artist) {
                    const artists = Array.isArray(data.topartists.artist) ? data.topartists.artist : [data.topartists.artist];
                    for (const artist of artists) {
                        if (isBackfill && this.isBackfillCancelled) {
                            new Notice(`Backfill stopped. Imported: ${stats.artists} artists, ${stats.albums} albums, ${stats.tracksAdded + stats.tracksUpdated} tracks.`);
                            this.isBackfillActive = false;
                            return;
                        }
                        const safeTitle = artist.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                        if (!safeTitle) continue;
                        
                        const filePath = normalizePath(`${artistsDir}/${safeTitle}.md`);
                        const content = `---
lastfm_type: "artist"
lastfm_name: "${artist.name.replace(/"/g, "'")}"
lastfm_playcount: ${artist.playcount}
lastfm_url: "${artist.url}"
---
# ${artist.name}
**Total Plays**: ${artist.playcount}
[View on Last.fm](${artist.url})

## Tracks
`;
                        if (!await this.app.vault.adapter.exists(filePath)) {
                            await this.saveFile(filePath, content);
                            stats.artists++;
                        }
                    }
                }
            } catch (e) {
                new Notice("Error fetching Artists: " + (e as Error).message);
            }
        }

        // Fetch Albums
        if (this.settings.syncAlbums && limits.albums > 0) {
            new Notice("Syncing Albums...");
            try {
                const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=${limits.albums}&_=${Date.now()}`;
                const res = await fetch(url, { cache: 'no-store' });
                const data = await res.json();
                
                if (data.topalbums && data.topalbums.album) {
                    const albums = Array.isArray(data.topalbums.album) ? data.topalbums.album : [data.topalbums.album];
                    for (const album of albums) {
                        if (isBackfill && this.isBackfillCancelled) {
                            new Notice(`Backfill stopped. Imported: ${stats.artists} artists, ${stats.albums} albums, ${stats.tracksAdded + stats.tracksUpdated} tracks.`);
                            this.isBackfillActive = false;
                            return;
                        }
                        const safeTitle = album.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                        if (!safeTitle) continue;
                        
                        const filePath = normalizePath(`${albumsDir}/${safeTitle}.md`);
                        const imageUrl = album.image && album.image[3] ? album.image[3]['#text'] : "";
                        const content = `---
lastfm_type: "album"
lastfm_name: "${album.name.replace(/"/g, "'")}"
lastfm_artist: "${album.artist.name.replace(/"/g, "'")}"
lastfm_playcount: ${album.playcount}
lastfm_url: "${album.url}"
lastfm_image: "${imageUrl}"
---
# ${album.name}
**Artist**: ${album.artist.name}
**Total Plays**: ${album.playcount}

![Cover Art](${imageUrl})

## Tracks
`;
                        if (!await this.app.vault.adapter.exists(filePath)) {
                            await this.saveFile(filePath, content);
                            stats.albums++;
                        }
                    }
                }
            } catch (e) {
                new Notice("Error fetching Albums: " + (e as Error).message);
            }
        }

        // Fetch Tracks
        let trackLimit = isBackfill ? limits.tracks : 200; 
        if (trackLimit > 0) {
            new Notice("Syncing Tracks...");
            try {
                let tracksUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${this.settings.username}&api_key=${this.settings.apiKey}&extended=1&format=json&limit=${trackLimit}`;
                
                if (!isBackfill && this.settings.lastSync > 0) {
                    tracksUrl += `&from=${this.settings.lastSync + 1}`;
                }
                
                // Cache buster
                tracksUrl += `&_=${Date.now()}`;

                const tracksRes = await fetch(tracksUrl, { cache: 'no-store' });
                const tracksData = await tracksRes.json();
                let latestSyncTime = this.settings.lastSync;

                if (tracksData.recenttracks && tracksData.recenttracks.track) {
                    const tracks = Array.isArray(tracksData.recenttracks.track) ? tracksData.recenttracks.track : [tracksData.recenttracks.track];
                    
                    for (const track of tracks) {
                        if (isBackfill && this.isBackfillCancelled) {
                            new Notice(`Backfill stopped. Imported: ${stats.artists} artists, ${stats.albums} albums, ${stats.tracksAdded + stats.tracksUpdated} tracks.`);
                            this.isBackfillActive = false;
                            return;
                        }
                        if (track['@attr'] && track['@attr'].nowplaying) continue;

                        const trackUts = parseInt(track.date.uts, 10);
                        if (trackUts > latestSyncTime) latestSyncTime = trackUts;

                        const safeTitle = track.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                        if (!safeTitle) continue;
                        
                        const artistName = track.artist.name || track.artist['#text'];
                        const albumName = track.album['#text'] || "Unknown";
                        const imageUrl = track.image && track.image[3] ? track.image[3]['#text'] : "";

                        let playcount = 1;
                        let isLiked = (track.loved === "1");
                        
                        try {
                            const infoUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&user=${this.settings.username}&api_key=${this.settings.apiKey}&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(track.name)}&format=json&_=${Date.now()}`;
                            const infoRes = await fetch(infoUrl, { cache: 'no-store' });
                            const infoData = await infoRes.json();
                            if (infoData.track) {
                                playcount = parseInt(infoData.track.userplaycount, 10) || 1;
                                isLiked = (infoData.track.userloved === "1");
                            }
                        } catch(e) { }

                        const lastScrobble = this.formatOffsetDate(trackUts, this.settings.tzOffset);

                        const filePath = normalizePath(`${tracksDir}/${safeTitle}.md`);
                        const content = `---
lastfm_type: "track"
lastfm_name: "${track.name.replace(/"/g, "'")}"
lastfm_artist: "${artistName.replace(/"/g, "'")}"
lastfm_album: "${albumName.replace(/"/g, "'")}"
lastfm_playcount: ${playcount}
lastfm_liked: ${isLiked}
lastfm_uts: ${trackUts}
lastfm_last_scrobble: "${lastScrobble}"
lastfm_url: "${track.url}"
lastfm_image: "${imageUrl}"
---
# ${track.name}
**Artist**: [[${artistName}]]
**Album**: [[${albumName}]]
**Total Plays**: ${playcount}
**Liked**: ${isLiked ? "Yes" : "No"}
**Last Scrobble**: ${lastScrobble}

![Cover Art](${imageUrl})
`;
                        const fileStats = { added: 0, updated: 0 };
                        await this.saveFile(filePath, content, fileStats);
                        stats.tracksAdded += fileStats.added;
                        stats.tracksUpdated += fileStats.updated;

                        if (this.settings.syncArtists) {
                            const safeArtist = artistName.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                            await this.appendBacklink(artistsDir, safeArtist, track.name, this.settings.linkArtists, safeTitle);
                        }
                        if (this.settings.syncAlbums && albumName !== "Unknown") {
                            const safeAlbum = albumName.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                            await this.appendBacklink(albumsDir, safeAlbum, track.name, this.settings.linkAlbums, safeTitle);
                        }
                    }
                }

                if (!isBackfill) {
                    this.settings.lastSync = latestSyncTime;
                    await this.saveSettings();
                }
            } catch (e) {
                new Notice("Error fetching Tracks: " + (e as Error).message);
            }
        }

        this.isBackfillActive = false;

        if (isBackfill) {
            new Notice(`Backfill Complete! Artists: ${stats.artists}, Albums: ${stats.albums}, Tracks: ${stats.tracksAdded + stats.tracksUpdated}`);
        } else {
            new Notice(`Sync Complete! Tracks Added: ${stats.tracksAdded}, Updated: ${stats.tracksUpdated}`);
        }
    }

    async restampDates() {
        const tracksDir = normalizePath(`${this.settings.folderName}/Tracks`);
        const folder = this.app.vault.getAbstractFileByPath(tracksDir);
        if (!folder || !(folder instanceof TFolder)) {
            new Notice("No Tracks folder found.");
            return;
        }

        let updated = 0;
        for (const file of folder.children) {
            if (file instanceof TFile) {
                let content = await this.app.vault.read(file);
                const utsMatch = content.match(/lastfm_uts:\s*(\d+)/);
                if (utsMatch) {
                    const uts = parseInt(utsMatch[1], 10);
                    const newDateStr = this.formatOffsetDate(uts, this.settings.tzOffset);
                    
                    content = content.replace(/lastfm_last_scrobble:\s*".*?"/, `lastfm_last_scrobble: "${newDateStr}"`);
                    content = content.replace(/\*\*Last Scrobble\*\*: .*/, `**Last Scrobble**: ${newDateStr}`);
                    
                    await this.app.vault.modify(file, content);
                    updated++;
                }
            }
        }
        new Notice(`Successfully re-stamped ${updated} tracks!`);
    }

    async saveFile(filePath: string, content: string, fileStats?: { added: number, updated: number }) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
            if (fileStats) fileStats.updated++;
        } else {
            await this.app.vault.create(filePath, content);
            if (fileStats) fileStats.added++;
        }
    }

    async appendBacklink(folder: string, safeName: string, rawTrackName: string, linkEnabled: boolean, safeTitle: string) {
        if (!safeName) return;
        const filePath = normalizePath(`${folder}/${safeName}.md`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            if (!content.includes(rawTrackName)) {
                const linkStr = linkEnabled ? `- [[${safeTitle}]]` : `- ${rawTrackName}`;
                await this.app.vault.append(file, `\n${linkStr}`);
            }
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class LastFmSettingTab extends PluginSettingTab {
    plugin: LastFmPlugin;

    constructor(app: App, plugin: LastFmPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        
        containerEl.createEl('h3', {text: 'General Settings'});

        new Setting(containerEl).setName('Last.fm API Key').addText(text => text.setValue(this.plugin.settings.apiKey).onChange(async (v) => { this.plugin.settings.apiKey = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Last.fm Username').addText(text => text.setValue(this.plugin.settings.username).onChange(async (v) => { this.plugin.settings.username = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Folder Name').addText(text => text.setValue(this.plugin.settings.folderName).onChange(async (v) => { this.plugin.settings.folderName = v; await this.plugin.saveSettings(); }));
        
        new Setting(containerEl)
            .setName('Sync on Start')
            .setDesc('Automatically sync from Last.fm when Obsidian opens')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.syncOnStart).onChange(async (v) => { this.plugin.settings.syncOnStart = v; await this.plugin.saveSettings(); }));
        
        new Setting(containerEl)
            .setName('Timezone Offset (Hours)')
            .setDesc('Shift UTC time. Use positive for ahead, negative for behind (e.g., 5.5 for IST).')
            .addText(text => text.setValue(this.plugin.settings.tzOffset.toString()).onChange(async (v) => { this.plugin.settings.tzOffset = parseFloat(v) || 0; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Re-stamp Scrobble Dates')
            .setDesc('Recalculate last scrobble times for existing files using the current Timezone offset. Does not use the API.')
            .addButton(btn => btn.setButtonText('Re-stamp').onClick(async () => await this.plugin.restampDates()));

        containerEl.createEl('h3', {text: 'Sync Preferences'});

        new Setting(containerEl).setName('Sync Artists').addToggle(toggle => toggle.setValue(this.plugin.settings.syncArtists).onChange(async (v) => { this.plugin.settings.syncArtists = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Sync Albums').addToggle(toggle => toggle.setValue(this.plugin.settings.syncAlbums).onChange(async (v) => { this.plugin.settings.syncAlbums = v; await this.plugin.saveSettings(); }));
        
        new Setting(containerEl)
            .setName('Link Tracks in Artists (beta)')
            .setDesc('Attempts to list tracks under it and link them')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.linkArtists).onChange(async (v) => { this.plugin.settings.linkArtists = v; await this.plugin.saveSettings(); }));
        
        new Setting(containerEl)
            .setName('Link Tracks in Albums (beta)')
            .setDesc('Attempts to list tracks under it and link them')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.linkAlbums).onChange(async (v) => { this.plugin.settings.linkAlbums = v; await this.plugin.saveSettings(); }));

        containerEl.createEl('h3', {text: 'Experimental'});

        new Setting(containerEl)
            .setName('Backfill History')
            .setDesc('Fetch historical data based on limits below. Note: This feature is experimental')
            .addButton(btn => btn.setButtonText('Start Backfill').onClick(() => {
                this.plugin.syncLastFm(true, {
                    tracks: parseInt(this.plugin.settings.bfTracks) || 0,
                    albums: parseInt(this.plugin.settings.bfAlbums) || 0,
                    artists: parseInt(this.plugin.settings.bfArtists) || 0
                });
            }));

        new Setting(containerEl).setName('Backfill Tracks Limit').addText(t => t.setValue(this.plugin.settings.bfTracks).onChange(async v => {this.plugin.settings.bfTracks = v; await this.plugin.saveSettings()}));
        new Setting(containerEl).setName('Backfill Albums Limit').addText(t => t.setValue(this.plugin.settings.bfAlbums).onChange(async v => {this.plugin.settings.bfAlbums = v; await this.plugin.saveSettings()}));
        new Setting(containerEl).setName('Backfill Artists Limit').addText(t => t.setValue(this.plugin.settings.bfArtists).onChange(async v => {this.plugin.settings.bfArtists = v; await this.plugin.saveSettings()}));

        new Setting(containerEl)
            .setName('Force Stop Backfill')
            .setDesc('Immediately stop an ongoing backfill operation.')
            .addButton(btn => btn.setButtonText('Stop').setWarning().onClick(() => {
                if (this.plugin.isBackfillActive) {
                    this.plugin.isBackfillCancelled = true;
                } else {
                    new Notice("Backfill is not currently running.");
                }
            }));
    }
}
