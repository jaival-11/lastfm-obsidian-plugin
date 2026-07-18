import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';

interface LastFmSettings {
    apiKey: string;
    username: string;
    folderName: string;
}

const DEFAULT_SETTINGS: LastFmSettings = {
    apiKey: '',
    username: '',
    folderName: 'LastFM'
}

export default class LastFmPlugin extends Plugin {
    settings: LastFmSettings;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new LastFmSettingTab(this.app, this));

        this.addCommand({
            id: 'sync-lastfm',
            name: 'Sync Last.fm',
            callback: () => this.syncLastFm()
        });
    }

    async syncLastFm() {
        if (!this.settings.apiKey || !this.settings.username) {
            new Notice("Last.fm: Please configure API Key and Username in settings.");
            return;
        }

        new Notice("Fetching Last.fm data...");
        try {
            const folderPath = normalizePath(this.settings.folderName);
            const artistsPath = normalizePath(`${folderPath}/Artists`);
            const albumsPath = normalizePath(`${folderPath}/Albums`);
            
            // 1. Ensure all folders exist
            for (const path of [folderPath, artistsPath, albumsPath]) {
                if (!await this.app.vault.adapter.exists(path)) {
                    await this.app.vault.createFolder(path);
                }
            }

            // 2. Fetch Artists (up to 1000)
            new Notice("Syncing Artists...");
            const artistsUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=1000`;
            const artistsRes = await fetch(artistsUrl);
            const artistsData = await artistsRes.json();
            
            if (artistsData.topartists && artistsData.topartists.artist) {
                for (const artist of artistsData.topartists.artist) {
                    const safeTitle = artist.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                    if (!safeTitle) continue;
                    
                    const filePath = normalizePath(`${artistsPath}/${safeTitle}.md`);
                    const content = `---
lastfm_type: "artist"
lastfm_name: "${artist.name.replace(/"/g, "'")}"
lastfm_playcount: ${artist.playcount}
lastfm_url: "${artist.url}"
---
# ${artist.name}
**Total Plays**: ${artist.playcount}
[View on Last.fm](${artist.url})
`;
                    await this.saveFile(filePath, content);
                }
            }

            // 3. Fetch Albums (up to 1000)
            new Notice("Syncing Albums...");
            const albumsUrl = `https://ws.audioscrobbler.com/2.0/?method=user.gettopalbums&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=1000`;
            const albumsRes = await fetch(albumsUrl);
            const albumsData = await albumsRes.json();
            
            if (albumsData.topalbums && albumsData.topalbums.album) {
                for (const album of albumsData.topalbums.album) {
                    const safeTitle = album.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                    if (!safeTitle) continue;
                    
                    const filePath = normalizePath(`${albumsPath}/${safeTitle}.md`);
                    // Albums reliably return cover art in the API
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
`;
                    await this.saveFile(filePath, content);
                }
            }

            // 4. Fetch Tracks (Using Recent Tracks for extended data + working images)
            new Notice("Syncing Tracks...");
            const tracksUrl = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${this.settings.username}&api_key=${this.settings.apiKey}&extended=1&format=json&limit=200`;
            const tracksRes = await fetch(tracksUrl);
            const tracksData = await tracksRes.json();

            if (tracksData.recenttracks && tracksData.recenttracks.track) {
                for (const track of tracksData.recenttracks.track) {
                    const safeTitle = track.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                    if (!safeTitle) continue;
                    
                    const filePath = normalizePath(`${folderPath}/${safeTitle}.md`);
                    
                    // Recent tracks pull the album image, which fixes the broken image issue
                    const imageUrl = track.image && track.image[3] ? track.image[3]['#text'] : "";
                    const albumName = track.album ? track.album['#text'] : "Unknown";
                    const isLiked = track.loved === "1";
                    const lastScrobble = track.date ? track.date['#text'] : "Now Playing";
                    
                    const content = `---
lastfm_type: "track"
lastfm_name: "${track.name.replace(/"/g, "'")}"
lastfm_artist: "${track.artist.name.replace(/"/g, "'")}"
lastfm_album: "${albumName.replace(/"/g, "'")}"
lastfm_liked: ${isLiked}
lastfm_last_scrobble: "${lastScrobble}"
lastfm_url: "${track.url}"
lastfm_image: "${imageUrl}"
---
# ${track.name}
**Artist**: [[${track.artist.name}]]
**Album**: [[${albumName}]]
**Liked**: ${isLiked ? "Yes" : "No"}
**Last Scrobble**: ${lastScrobble}

![Cover Art](${imageUrl})
`;
                    await this.saveFile(filePath, content);
                }
            }

            new Notice("Last.fm Sync Complete!");
        } catch (e) {
            new Notice("Last.fm Sync Failed: " + (e as Error).message);
        }
    }

    // Helper function to handle creating vs updating files
    async saveFile(filePath: string, content: string) {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
        } else {
            await this.app.vault.create(filePath, content);
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

        new Setting(containerEl)
            .setName('Last.fm API Key')
            .setDesc('Get this from the Last.fm developer portal')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Last.fm Username')
            .setDesc('Your Last.fm account username')
            .addText(text => text
                .setPlaceholder('Username')
                .setValue(this.plugin.settings.username)
                .onChange(async (value) => {
                    this.plugin.settings.username = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Folder Name')
            .setDesc('Vault folder to store scrobble files')
            .addText(text => text
                .setPlaceholder('LastFM')
                .setValue(this.plugin.settings.folderName)
                .onChange(async (value) => {
                    this.plugin.settings.folderName = value;
                    await this.plugin.saveSettings();
                }));
    }
}
