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

        new Notice("Fetching Last.fm scrobbles...");
        try {
            const url = `https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${this.settings.username}&api_key=${this.settings.apiKey}&format=json&limit=50`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.error) throw new Error(data.message);

            const tracks = data.toptracks.track;
            const folderPath = normalizePath(this.settings.folderName);
            
            if (!await this.app.vault.adapter.exists(folderPath)) {
                await this.app.vault.createFolder(folderPath);
            }

            for (const track of tracks) {
                const safeTitle = track.name.replace(/[^a-zA-Z0-9 -]/g, '').trim();
                if (!safeTitle) continue;
                
                const filePath = normalizePath(`${folderPath}/${safeTitle}.md`);
                const imageUrl = track.image[3] ? track.image[3]['#text'] : "";
                
                const content = `---
artist: "${track.artist.name}"
playcount: ${track.playcount}
url: "${track.url}"
image: "${imageUrl}"
---
# ${track.name}
**Artist**: ${track.artist.name}
**Total Plays**: ${track.playcount}

![Cover Art](${imageUrl})
`;
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await this.app.vault.modify(file, content);
                } else {
                    await this.app.vault.create(filePath, content);
                }
            }
            new Notice("Last.fm Sync Complete!");
        } catch (e) {
            new Notice("Last.fm Sync Failed: " + (e as Error).message);
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
