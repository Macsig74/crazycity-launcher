// main.js - Process principal
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { Launch } = require('minecraft-java-core');
const AdmZip = require('adm-zip');

let mainWindow;

// Configuration
const CONFIG = {
    MODS_ZIP_URL: "http://192.168.1.115:8080/mods.zip",
    MC_VERSION: '1.21.1',
    NEOFORGE_VERSION: '21.1.211',
    SERVER_IP: '192.168.1.115',
    SERVER_PORT: 25565
};

// Création de la fenêtre
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 550,
        resizable: false,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('ready', createWindow);
app.on('window-all-closed', () => app.quit());

// Boutons
ipcMain.on('close-app', () => app.quit());
ipcMain.on('minimize-app', () => mainWindow.minimize());

// Lancer le jeu
ipcMain.on('launch-game', async (event, username) => {
    try {
        const gameDir = path.join(app.getPath('home'), '.crazycity');
        const modsDir = path.join(gameDir, 'mods');

        console.log('Game directory:', gameDir);
        console.log('Mods directory:', modsDir);

        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
        if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

        const modFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
        if (modFiles.length === 0) {
            event.reply('status', { step: 'Téléchargement', detail: 'Téléchargement des mods...', progress: 10, color: '#2196f3' });
            await downloadAndExtractMods(modsDir, event);
        } else {
            event.reply('status', { step: 'Mods détectés', detail: `${modFiles.length} mods déjà installés !`, progress: 40, color: '#4caf50' });
        }

        // Lancement du jeu
        event.reply('status', { step: 'Lancement', detail: 'Initialisation de Minecraft...', progress: 60, color: '#9c27b0' });

        const launcher = new Launch();
        const opts = {
            url: null,
            authenticator: {
                name: username,
                uuid: generateUUID(),
                user_properties: '{}',
                access_token: 'null',
                client_token: 'null',
                meta: { type: 'offline', offline: true }
            },
            path: gameDir,
            version: CONFIG.MC_VERSION,
            loader: {
                path: null,
                type: 'neoforge',
                build: CONFIG.NEOFORGE_VERSION,
                enable: true
            },
            verify: false,
            ignored: ['options.txt', 'servers.dat'],
            JVM_ARGS: ['-Xmx4G', '-Xms2G'],
            GAME_ARGS: [
                '--server', CONFIG.SERVER_IP,
                '--port', CONFIG.SERVER_PORT.toString()
            ],
            java: { path: null, version: null, type: 'jre' },
            screen: { width: 1280, height: 720 },
            memory: { min: '2G', max: '4G' }
        };

        launcher.on('progress', (progress, size, element) => {
            const percent = Math.round((progress / size) * 100);
            event.reply('status', { step: 'Téléchargement Minecraft', detail: element, progress: 60 + (percent * 0.35), color: '#ff9800' });
        });

        launcher.on('data', (data) => {
            const line = data.toString().trim();
            if (line) {
                console.log('[Minecraft]', line);
                event.reply('log', line);
            }
        });

        launcher.on('close', (code) => {
            event.reply('status', { step: 'Jeu fermé', detail: `Minecraft s'est arrêté avec le code ${code}`, progress: 100, color: '#607d8b' });
        });

        launcher.on('error', (err) => {
            event.reply('status', { step: 'Erreur', detail: err.message, progress: 0, color: '#f44336' });
        });

        console.log('Lancement du jeu...');
        await launcher.Launch(opts);

        event.reply('status', { step: 'Terminé', detail: '🎮 Minecraft lancé avec succès !', progress: 100, color: '#4caf50' });

    } catch (error) {
        event.reply('status', { step: 'Erreur', detail: error.message, progress: 0, color: '#f44336' });
    }
});

// Télécharger et extraire les mods
async function downloadAndExtractMods(modsDir, event) {
    const zipPath = path.join(app.getPath('temp'), 'mods.zip');
    try {
        event.reply('status', { step: 'Téléchargement', detail: 'Téléchargement du pack de mods...', progress: 15, color: '#2196f3' });
        await downloadFile(CONFIG.MODS_ZIP_URL, zipPath, (progress) => {
            event.reply('status', { step: 'Téléchargement', detail: `Téléchargement... ${progress}%`, progress: 15 + (progress * 0.35), color: '#2196f3' });
        });

        event.reply('status', { step: 'Extraction', detail: 'Extraction des mods...', progress: 50, color: '#ff9800' });
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(modsDir, true);

        const modFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
        fs.unlinkSync(zipPath);

        event.reply('status', { step: 'Installation terminée', detail: `${modFiles.length} mods installés !`, progress: 60, color: '#4caf50' });

    } catch (error) {
        throw new Error('Erreur lors du téléchargement ou extraction : ' + error.message);
    }
}

// Télécharger un fichier
function downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const client = url.startsWith('https') ? https : http;
        client.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadFile(response.headers.location, dest, onProgress).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) return reject(new Error(`Erreur HTTP ${response.statusCode}`));

            const total = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;

            response.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total && onProgress) onProgress(Math.round((downloaded / total) * 100));
            });

            response.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', reject);
        }).on('error', reject);
    });
}

// Générer UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
