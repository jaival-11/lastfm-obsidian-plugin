import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, Modal } from 'obsidian';

interface LastFmSettings {
    apiKey: string;
    username: string;
    folderName: string;
    lastSync: number;
    syncArtists: boolean;
    syncAlbums: boolean;
    linkTracks: boolean;
    tzOffset: number;
}

const DEFAULT_SETTINGS: LastFmSettings = {
    apiKey: '',
    username: '',
    folderName: 'LastFM',
    lastSync: 0,
    syncArtists: true,
    syncAlbums: true,
    linkTracks: true,
    tzOffset: 0
}

export default class LastFmPlugin extends Plugin {
    settings: LastFmSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new LastFmSettingTab(this.app, this));

        this.addCommand({
            id: 'sync-lastfm',
            name: 'Sync Last.fm (Incremental)',
            callback: () => this.syncLastFm(false)
        });

        this.addCommand({
            id: 'backfill-lastfm',
            name: 'Backfill Last.fm History',
            callback: () => {
                new BackfillModal(this.app, this).open();
            }
        });
    }

    async syncLastFm(isBackfill: boolean, limits = { tracks: 50, albums: 50, artists: 50 }) {
        if (!this.settings.apiKey || !this.settings.username) {
            new Notice("Last.fm: Please configure API Key and Username in settings.");
            return;
        }

        try {
            const baseDir = normalizePath(this.settings.folderName);
            const tracksDir = normalizePath(`${baseDir}/Tracks`);
            const artistsDir = normalizePath(`${baseDir}/Artists`);
            const albumsDir = normalizePath(`${baseDir}/Albums`);
            
            // Create required folders
            const dirsToCreate = [baseDir, tracksDir];
            if (this.settings.syncArtists) dirsToCreate.push(artistsDir);
            if (this.settings.syncAlbums) dirsToCreate.push(albumsDir);

            for (const path of dirsToCreate) {
                if (!await this.app.vault.adapter.exists(path)) {
                    await this.app.vault.createFolder(path);
                }
            }

            // Fetch Artists
            if (this.settings.syncArtists && limits.artists > 0) {
                new Notice("Syncing Artists...");
                const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=${limits.artists}`;
                const res = await fetch(url);
                const data = await res.json();
                
                if (data.topartists && data.topartists.artist) {
                    const artists = Array.isArray(data.topartists.artist) ? data.topartists.artist : [data.topartists.artist];
                    for (const artist of artists) {
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
                        // Only create if it doesn't exist to avoid overwriting backlinks
                        if (!await this.app.vault.adapter.exists(filePath)) {
                            await this.saveFile(filePath, content);
                        }
                    }
                }
            }

            // Fetch Albums
            if (this.settings.syncAlbums && limits.albums > 0) {
                new Notice("Syncing Albums...");
                const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=${limits.albums}`;
                const res = await fetch(url);
                const data = await res.json();
                
                if (data.topalbums && data.topalbums.album) {
                    const albums = Array.isArray(data.topalbums.album) ? data.topalbums.album : [data.topalbums.album];
                    for (const album of albums) {
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
                        }
                    }
                }
            }

            // Fetch Tracks
            new Notice("Syncing Tracks...");
            let tracksUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${this.settings.username}&api_key=${this.settings.apiKey}&extended=1&format=json&limit=${limits.tracks}`;
            
            // Apply incremental sync logic
            if (!isBackfill && this.settings.lastSync > 0) {
                tracksUrl += `&from=${this.settings.lastSync}`;
            }

            const tracksRes = await fetch(tracksUrl);
            const tracksData = await tracksRes.json();
            let latestSyncTime = this.settings.lastSync;

            if (tracksData.recenttracks && tracksData.recenttracks.track) {
                const tracks = Array.isArray(tracksData.recenttracks.track) ? tracksData.recenttracks.track : [tracksData.recenttracks.track];
                
                for (const track of tracks) {
                    // Skip 'now playing' tracks as they don't have a final timestamp yet
                    if (track['@attr'] && track['@attr'].nowplaying) continue;

                    const trackUts = parseInt(track.date.uts, 10);
                    if (trackUts > latestSyncTime) latestSyncTime = trackUts;

                    const safeTitle = track.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                    if (!safeTitle) continue;
                    
                    const artistName = track.artist.name || track.artist['#text'];
                    const albumName = track.album['#text'] || "Unknown";
                    const imageUrl = track.image && track.image[3] ? track.image[3]['#text'] : "";

                    // Fetch playcount individually for accuracy
                    let playcount = 1;
                    let isLiked = (track.loved === "1");
                    try {
                        const infoUrl = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&user=${this.settings.username}&api_key=${this.settings.apiKey}&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(track.name)}&format=json`;
                        const infoRes = await fetch(infoUrl);
                        const infoData = await infoRes.json();
                        if (infoData.track) {
                            playcount = parseInt(infoData.track.userplaycount, 10) || 1;
                            isLiked = (infoData.track.userloved === "1");
                        }
                    } catch(e) { }

                    // Apply time zone offset
                    const adjustedTime = new Date((trackUts + (this.settings.tzOffset * 3600)) * 1000);
                    const lastScrobble = adjustedTime.toLocaleString();

                    const filePath = normalizePath(`${tracksDir}/${safeTitle}.md`);
                    const content = `---
lastfm_type: "track"
lastfm_name: "${track.name.replace(/"/g, "'")}"
lastfm_artist: "${artistName.replace(/"/g, "'")}"
lastfm_album: "${albumName.replace(/"/g, "'")}"
lastfm_playcount: ${playcount}
lastfm_liked: ${isLiked}
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
                    await this.saveFile(filePath, content);

                    // Add backlinks to Artists/Albums if enabled
                    if (this.settings.linkTracks) {
                        const trackLink = `- [[${safeTitle}]]`;
                        if (this.settings.syncArtists) {
                            const safeArtist = artistName.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                            await this.appendBacklink(artistsDir, safeArtist, trackLink);
                        }
                        if (this.settings.syncAlbums && albumName !== "Unknown") {
                            const safeAlbum = albumName.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                            await this.appendBacklink(albumsDir, safeAlbum, trackLink);
                        }
                    }
                }
            }

            if (!isBackfill) {
                this.settings.lastSync = latestSyncTime;
                await this.saveSettings();
            }
            new Notice("Last.fm Sync Complete!");
        } catch (e) {
            new Notice("Last.fm Sync Failed: " + (e as Error).message);
        }
    }

    async saveFile(filePath: string, content: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
        } else {
            await this.app.vault.create(filePath, content);
        }
    }

    async appendBacklink(folder: string, safeName: string, trackLink: string) {
        if (!safeName) return;
        const filePath = normalizePath(`${folder}/${safeName}.md`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            if (!content.includes(trackLink)) {
                await this.app.vault.append(file, `\n${trackLink}`);
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

class BackfillModal extends Modal {
    plugin: LastFmPlugin;
    tracks: string = "50";
    albums: string = "20";
    artists: string = "20";

    constructor(app: App, plugin: LastFmPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const {containerEl} = this;
        containerEl.empty();
        
        containerEl.createEl("h2", {text: "Backfill Last.fm History"});

        new Setting(containerEl).setName("Number of Tracks").addText(text => text.setValue(this.tracks).onChange(v => this.tracks = v));
        new Setting(containerEl).setName("Number of Albums").addText(text => text.setValue(this.albums).onChange(v => this.albums = v));
        new Setting(containerEl).setName("Number of Artists").addText(text => text.setValue(this.artists).onChange(v => this.artists = v));

        new Setting(containerEl).addButton(btn => btn
            .setButtonText("Start Backfill")
            .setCta()
            .onClick(() => {
                this.close();
                this.plugin.syncLastFm(true, {
                    tracks: parseInt(this.tracks) || 0,
                    albums: parseInt(this.albums) || 0,
                    artists: parseInt(this.artists) || 0
                });
            }));
    }

    onClose() {
        this.containerEl.empty();
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

        new Setting(containerEl)
            .setName('Last.fm API Key')
            .addText(text => text.setValue(this.plugin.settings.apiKey).onChange(async (v) => { this.plugin.settings.apiKey = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Last.fm Username')
            .addText(text => text.setValue(this.plugin.settings.username).onChange(async (v) => { this.plugin.settings.username = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Folder Name')
            .addText(text => text.setValue(this.plugin.settings.folderName).onChange(async (v) => { this.plugin.settings.folderName = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Timezone Offset (Hours)')
            .setDesc('Adjust if scrobble dates are incorrect (e.g., 5.5 for IST)')
            .addText(text => text.setValue(this.plugin.settings.tzOffset.toString()).onChange(async (v) => { this.plugin.settings.tzOffset = parseFloat(v) || 0; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Sync Artists')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.syncArtists).onChange(async (v) => { this.plugin.settings.syncArtists = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Sync Albums')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.syncAlbums).onChange(async (v) => { this.plugin.settings.syncAlbums = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl)
            .setName('Link Tracks in Artist/Album Files')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.linkTracks).onChange(async (v) => { this.plugin.settings.linkTracks = v; await this.plugin.saveSettings(); }));
    }
}
