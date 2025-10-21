const { ipcRenderer } = require('electron');

const launchBtn = document.getElementById('launch-btn');
const usernameInput = document.getElementById('username');
const progressBar = document.getElementById('progress-bar');
const step = document.getElementById('status-step');
const detail = document.getElementById('status-detail');
const logBox = document.getElementById('log');

launchBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim() || "Joueur";
    ipcRenderer.send('launch-game', username);
    step.innerText = "Initialisation...";
    progressBar.style.width = "5%";
    progressBar.style.background = "#03a9f4";
});

ipcRenderer.on('status', (event, data) => {
    const { step: s, detail: d, progress, color } = data;
    step.innerText = s || '';
    detail.innerText = d || '';
    if (progress !== undefined) progressBar.style.width = `${progress}%`;
    if (color) progressBar.style.background = color;
});

ipcRenderer.on('log', (event, line) => {
    const div = document.createElement('div');
    div.textContent = line;
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
});
