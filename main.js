const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { Launch } = require('minecraft-java-core');
const AdmZip = require('adm-zip');
const { Authflow, Titles } = require('prismarine-auth');

let mainWindow;

// Configuration des instances
const CONFIG = {
    DEFAULT_INSTANCE: 'crazycity',
    INSTANCES: {
        crazycity: {
            id: 'crazycity',
            name: 'CrazyCity RP',
            description: 'Pack officiel CrazyCity - NeoForge 1.21.1',
            modsZipUrl: 'http://192.168.1.115:8080/crazycity/mods.zip',
            mcVersion: '1.21.1',
            loader: {
                type: 'neoforge',
                build: '21.1.211',
                enable: true
            },
            server: { ip: '192.168.1.115', port: 25565 },
            jvmArgs: ['-Xmx4G', '-Xms2G'],
            memory: { min: '2G', max: '4G' },
            gameDirName: '.crazycity'
        },
        donut: {
            id: 'donut',
            name: 'Donut SMP',
            description: 'Modpack Donut smp (FABRIC 1.21.5) - Exemple',
            modsZipUrl: 'http://192.168.1.115:8080/donut/modpack.zip',
            mcVersion: '1.21.5',
            loader: {
                type: 'fabric',
                build: 'latest',
                enable: true
            },
            server: { ip: 'play.example.org', port: 25570 },
            jvmArgs: ['-Xmx6G', '-Xms3G'],
            memory: { min: '2G', max: '4G' },
            gameDirName: '.donut'
        }
    }
};

const getAccountPaths = () => {
    const dir = path.join(app.getPath('userData'), 'accounts');
    return {
        dir,
        microsoft: path.join(dir, 'microsoft.json')
    };
};

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
    memory: { min: '2G', max: '4G' },
    javaPath: null,
    javaVersion: null,
    screen: { width: 1280, height: 720, fullscreen: false },
    jvmArgs: [],
    autoConnect: true
};

function loadSettings() {
    try {
        const settingsPath = getSettingsPath();
        if (!fs.existsSync(settingsPath)) return DEFAULT_SETTINGS;
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        const loaded = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...loaded };
    } catch (error) {
        console.error('Unable to load settings:', error);
        return DEFAULT_SETTINGS;
    }
}

function saveSettings(settings) {
    try {
        const settingsPath = getSettingsPath();
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf-8');
        return true;
    } catch (error) {
        console.error('Unable to save settings:', error);
        return false;
    }
}

let cachedMicrosoftAccount = null;
let microsoftLoginInProgress = false;
let authflow = null;

// === AUTHENTIFICATION MICROSOFT ===
// Utilisation du flow "sisu" (Xbox) plus fiable
function initAuthflow() {
    if (!authflow) {
        const cacheDir = path.join(app.getPath('userData'), 'auth-cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        authflow = new Authflow('CrazyCity-Launcher', cacheDir, {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'sisu' // Flow Xbox/Sisu plus moderne
        }, (codeData) => {
            // Le callback reçoit un objet avec l'URL de connexion
            console.log('Données de connexion reçues:', codeData);
            return openMicrosoftLoginWindow(codeData);
        });
    }
    return authflow;
}

// Ouvre une fenêtre Electron pour la connexion Microsoft
function openMicrosoftLoginWindow(codeData) {
    return new Promise((resolve, reject) => {
        // Pour le flow sisu, on utilise directement connectUrl
        const loginUrl = codeData.connectUrl || codeData.sisuAuthUrl || 
                        `https://www.microsoft.com/link?otc=${codeData.user_code}`;
        
        console.log('Ouverture de:', loginUrl);
        
        let authWindow = new BrowserWindow({
            width: 600,
            height: 750,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            },
            title: 'Connexion Microsoft',
            autoHideMenuBar: true,
            modal: true,
            parent: mainWindow
        });

        authWindow.loadURL(loginUrl).catch(err => {
            console.error('Erreur chargement URL:', err);
            reject(err);
        });

        // Timer pour vérifier l'expiration
        const expirationTimer = setTimeout(() => {
            if (authWindow && !authWindow.isDestroyed()) {
                authWindow.close();
                reject(new Error('Délai d\'authentification expiré'));
            }
        }, (codeData.expires_in || 900) * 1000);

        authWindow.on('closed', () => {
            clearTimeout(expirationTimer);
            authWindow = null;
            // Ne pas rejeter ici, laisser prismarine-auth gérer le polling
        });

        // Prismarine-auth gère le polling automatiquement
        // On résout immédiatement pour laisser le processus continuer
        resolve();
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1080,
        height: 640,
        minWidth: 900,
        minHeight: 550,
        resizable: true,
        frame: false,
        backgroundColor: '#0f3460',
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

ipcMain.on('close-app', () => app.quit());
ipcMain.on('minimize-app', () => mainWindow.minimize());

ipcMain.handle('launcher:get-instances', async () => {
    const instances = Object.values(CONFIG.INSTANCES).map((instance) => ({
        id: instance.id,
        name: instance.name,
        description: instance.description,
        mcVersion: instance.mcVersion,
        loader: instance.loader,
        server: instance.server,
        memory: instance.memory
    }));
    return instances;
});

ipcMain.handle('app:get-version', async () => app.getVersion());
ipcMain.handle('settings:get', async () => loadSettings());
ipcMain.handle('settings:save', async (event, settings) => {
    const merged = { ...loadSettings(), ...settings };
    return saveSettings(merged);
});

ipcMain.handle('auth:get-microsoft-profile', async () => {
    try {
        const account = await refreshMicrosoftAccount();
        return sanitizeMicrosoftAccount(account);
    } catch (error) {
        console.error('Unable to load Microsoft account:', error);
        return null;
    }
});

// === CONNEXION MICROSOFT ===
ipcMain.handle('auth:microsoft-login', async () => {
    if (microsoftLoginInProgress) {
        throw new Error('Une connexion Microsoft est déjà en cours.');
    }
    
    microsoftLoginInProgress = true;
    
    try {
        console.log('=== DEBUT CONNEXION MICROSOFT ===');
        console.log('Ouverture de la fenêtre de connexion...');
        
        const flow = initAuthflow();
        
        // Le callback openMicrosoftLoginWindow va ouvrir une fenêtre Electron
        const token = await flow.getMinecraftJavaToken({ fetchProfile: true });

        if (!token || !token.profile) {
            throw new Error('Impossible de récupérer le profil Minecraft.');
        }

        console.log('✓ Connexion réussie pour:', token.profile.name);

        // Formater le compte pour minecraft-java-core
        const account = {
            name: token.profile.name,
            uuid: token.profile.id,
            access_token: token.token,
            user_properties: '{}',
            client_token: token.token,
            meta: {
                type: 'msa',
                demo: false
            },
            profile: {
                id: token.profile.id,
                name: token.profile.name,
                skins: token.profile.skins || []
            }
        };

        persistMicrosoftAccount(account);
        cachedMicrosoftAccount = account;
        
        console.log('=== CONNEXION MICROSOFT TERMINEE ===');
        return sanitizeMicrosoftAccount(account);
        
    } catch (error) {
        console.error('=== ERREUR CONNEXION MICROSOFT ===');
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        
        // Messages d'erreur plus explicites
        let errorMessage = 'Impossible de se connecter avec Microsoft.';
        
        if (error.message.includes('fermée par l\'utilisateur') || error.message.includes('User cancelled')) {
            errorMessage = 'Connexion annulée.';
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Délai d\'attente dépassé. Veuillez réessayer.';
        } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
            errorMessage = 'Erreur réseau. Vérifiez votre connexion internet.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        throw new Error(errorMessage);
    } finally {
        microsoftLoginInProgress = false;
    }
});

ipcMain.handle('auth:logout', async () => {
    console.log('Déconnexion du compte Microsoft...');
    
    clearMicrosoftAccount();
    
    // Nettoyer le cache d'authentification
    const cacheDir = path.join(app.getPath('userData'), 'auth-cache');
    if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
            try {
                fs.unlinkSync(path.join(cacheDir, file));
            } catch (err) {
                console.error('Erreur suppression cache:', err);
            }
        }
    }
    
    authflow = null;
    console.log('✓ Déconnexion réussie');
    return true;
});

ipcMain.on('launch-game', async (event, launchPayload) => {
    try {
        console.log("Instance demandée:", launchPayload?.instanceId);

        const instance = getInstanceConfig(launchPayload?.instanceId);
        if (!instance) {
            throw new Error('Instance introuvable. Veuillez en sélectionner une autre.');
        }

        const { authenticator, username, type } = await resolveAuthenticator(launchPayload?.account);

        const gameDir = path.join(app.getPath('home'), instance.gameDirName || path.join('.crazycity', instance.id));
        const modsDir = path.join(gameDir, 'mods');

        console.log(`[${instance.id}] Game directory:`, gameDir);
        console.log(`[${instance.id}] Mods directory:`, modsDir);

        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });
        if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

        const modFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
        if (modFiles.length === 0) {
            event.reply('status', { step: 'Téléchargement', detail: `Téléchargement des mods ${instance.name}...`, progress: 10, color: '#2196f3' });
            await downloadAndExtractMods(instance, modsDir, event);
        } else {
            event.reply('status', { step: 'Mods détectés', detail: `${modFiles.length} mods déjà installés !`, progress: 40, color: '#4caf50' });
        }

        event.reply('status', { step: 'Lancement', detail: `Initialisation de ${instance.name}...`, progress: 60, color: '#9c27b0' });

        const settings = loadSettings();
        const launcher = new Launch();

        // Build JVM args: memory settings + additional JVM args
        const jvmArgs = [];
        if (settings.memory?.min) {
            jvmArgs.push(`-Xms${settings.memory.min}`);
        }
        if (settings.memory?.max) {
            jvmArgs.push(`-Xmx${settings.memory.max}`);
        }
        if (settings.jvmArgs && Array.isArray(settings.jvmArgs) && settings.jvmArgs.length > 0) {
            jvmArgs.push(...settings.jvmArgs);
        }

        const opts = {
            url: null,
            authenticator,
            path: gameDir,
            version: instance.mcVersion,
            loader: {
                path: null,
                type: instance.loader?.type || null,
                build: instance.loader?.build || 'latest',
                enable: !!instance.loader?.enable
            },
            verify: false,
            ignored: ['options.txt', 'servers.dat'],
            JVM_ARGS: jvmArgs.length > 0 ? jvmArgs : ['-Xmx4G', '-Xms2G'],
            GAME_ARGS: instance.server && settings.autoConnect
                ? ['--server', instance.server.ip, '--port', instance.server.port.toString()]
                : [],
            java: {
                path: settings.javaPath || null,
                version: settings.javaVersion || null,
                type: 'jre'
            },
            screen: settings.screen || { width: 1280, height: 720, fullscreen: false },
            memory: settings.memory || instance.memory || { min: '2G', max: '4G' }
        };

        launcher.on('progress', (progress, size, element) => {
            const percent = Math.round((progress / size) * 100);
            event.reply('status', { step: 'Téléchargement Minecraft', detail: element, progress: 60 + (percent * 0.35), color: '#ff9800' });
        });

        launcher.on('data', (data) => {
            const line = data.toString().trim();
            if (line) {
                console.log(`[${instance.id}][Minecraft]`, line);
                event.reply('log', line);
            }
        });

        launcher.on('close', (code) => {
            event.reply('status', { step: 'Jeu fermé', detail: `${instance.name} s'est arrêté avec le code ${code}`, progress: 100, color: '#607d8b' });
            event.reply('game-closed', { code });
        });

        launcher.on('error', (err) => {
            event.reply('status', { step: 'Erreur', detail: err.message, progress: 0, color: '#f44336' });
            event.reply('launch-error', { error: err.message });
        });

        console.log(`Lancement de l'instance ${instance.name}...`);
        await launcher.Launch(opts);

        event.reply('status', { step: 'Terminé', detail: `${instance.name} lancé avec succès !`, progress: 100, color: '#4caf50' });
        event.reply('launch-complete', { type, instanceId: instance.id });

    } catch (error) {
        event.reply('status', { step: 'Erreur', detail: error.message, progress: 0, color: '#f44336' });
        event.reply('launch-error', { error: error.message });
    }
});

async function downloadAndExtractMods(instance, modsDir, event) {
    if (!instance.modsZipUrl) {
        event.reply('status', { step: 'Mods', detail: 'Aucun pack de mods configuré pour cette instance.', progress: 40, color: '#ffc107' });
        return;
    }
    const zipPath = path.join(app.getPath('temp'), `${instance.id}-mods.zip`);
    try {
        event.reply('status', { step: 'Téléchargement', detail: `Téléchargement du pack de mods ${instance.name}...`, progress: 15, color: '#2196f3' });
        await downloadFile(instance.modsZipUrl, zipPath, (progress) => {
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

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getInstanceConfig(instanceId) {
    if (!instanceId) return CONFIG.INSTANCES[CONFIG.DEFAULT_INSTANCE];
    return CONFIG.INSTANCES[instanceId] || CONFIG.INSTANCES[CONFIG.DEFAULT_INSTANCE];
}

async function resolveAuthenticator(payload) {
    const normalized = typeof payload === 'string' || !payload ? {
        type: 'offline',
        username: typeof payload === 'string' ? payload : 'Joueur'
    } : payload;

    if (normalized.type === 'microsoft') {
        const account = await refreshMicrosoftAccount();
        if (!account) {
            mainWindow?.webContents?.send('auth:microsoft-expired');
            throw new Error('Veuillez vous reconnecter à Microsoft avant de lancer le jeu.');
        }
        return {
            type: 'microsoft',
            username: account.name,
            authenticator: account
        };
    }

    const safeUsername = (normalized.username || 'Joueur').slice(0, 16);
    return {
        type: 'online',
        username: safeUsername,
        authenticator: {
            name: safeUsername,
            uuid: generateUUID(),
            user_properties: '{}',
            access_token: 'null',
            client_token: 'null',
            meta: { type: 'offline', offline: true }
        }
    };
}

function sanitizeMicrosoftAccount(account) {
    if (!account) return null;
    const activeSkin = account.profile?.skins?.find((skin) => skin.state === 'ACTIVE') || account.profile?.skins?.[0];
    return {
        type: 'microsoft',
        username: account.name,
        uuid: account.uuid,
        avatar: activeSkin?.base64 || null,
        avatarUrl: activeSkin?.url || null
    };
}

async function refreshMicrosoftAccount() {
    const stored = cachedMicrosoftAccount || readMicrosoftAccount();
    if (!stored) return null;
    
    try {
        console.log('Tentative de refresh du compte Microsoft...');
        const flow = initAuthflow();
        const token = await flow.getMinecraftJavaToken({ fetchProfile: true });

        if (!token || !token.profile) {
            console.warn('Refresh échoué, compte expiré');
            clearMicrosoftAccount();
            return null;
        }

        console.log('✓ Refresh réussi pour:', token.profile.name);

        const refreshed = {
            name: token.profile.name,
            uuid: token.profile.id,
            access_token: token.token,
            user_properties: '{}',
            client_token: token.token,
            meta: {
                type: 'msa',
                demo: false
            },
            profile: {
                id: token.profile.id,
                name: token.profile.name,
                skins: token.profile.skins || []
            }
        };

        persistMicrosoftAccount(refreshed);
        cachedMicrosoftAccount = refreshed;
        return refreshed;
        
    } catch (error) {
        console.error('Erreur refresh Microsoft:', error.message);
        return stored;
    }
}

function readMicrosoftAccount() {
    try {
        const { microsoft } = getAccountPaths();
        if (!fs.existsSync(microsoft)) return null;
        const raw = fs.readFileSync(microsoft, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        console.error('Unable to read Microsoft account:', error);
        return null;
    }
}

function persistMicrosoftAccount(account) {
    const { dir, microsoft } = getAccountPaths();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(microsoft, JSON.stringify(account, null, 4), 'utf-8');
}

function clearMicrosoftAccount() {
    const { microsoft } = getAccountPaths();
    if (fs.existsSync(microsoft)) {
        fs.unlinkSync(microsoft);
    }
    cachedMicrosoftAccount = null;
}