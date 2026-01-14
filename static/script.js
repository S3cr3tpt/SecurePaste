// GLOBAL VARIABLES
let cryptoKey = null;
let socket = null;
let myUsername = "Ghost-" + Math.floor(Math.random() * 1000); 

// --- INITIALIZATION ---
window.onload = async () => {
    const hash = window.location.hash.substring(1);
    
    if (hash.startsWith("paste_")) {
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('view-paste-ui').classList.remove('hidden');
        await loadPaste(hash);
    } 
    else if (hash.startsWith("chat_")) {
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('chat-ui').classList.remove('hidden');
        await joinChat(hash);
    }
};

function goHome() { window.location.href = "/"; }
function showPasteMode() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('paste-ui').classList.remove('hidden');
}
function goToAdmin() { window.location.href = "/admin.html"; }

// --- PASTE LOGIC ---
async function savePaste() {
    const text = document.getElementById('paste-input').value;
    const isBurn = document.getElementById('burn-check').checked;
    if (!text) return;
    
    const key = await generateKey();
    const encryptedData = await encryptData(key, text); 
    const response = await fetch('/api/pastes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: encryptedData, is_burn_after_reading: isBurn })
    });
    const result = await response.json();
    const keyStr = await exportKey(key);
    const link = `${window.location.origin}/#paste_${result.id}_${keyStr}`;
    let msg = isBurn ? "Paste Created (Single Use)" : "Paste Created";
    document.getElementById('paste-ui').innerHTML = `<h2>${msg}</h2><div class="link-box">${link}</div><button onclick="goHome()">HOME</button>`;
}

async function loadPaste(hash) {
    const parts = hash.split('_');
    try {
        const response = await fetch(`/api/pastes/${parts[1]}`);
        if (response.status === 404) {
             document.getElementById('paste-output').value = "ERROR 404: Paste burned or not found.";
             return;
        }
        const json = await response.json();
        const key = await importKey(parts[2]);
        const text = await decryptData(key, json.content);
        document.getElementById('paste-output').value = text;
        document.getElementById('burn-warning').classList.remove('hidden');
    } catch (e) {
        document.getElementById('paste-output').value = "ERROR: Decryption Failed.";
    }
}

// --- CHAT LOGIC ---
async function startChatMode() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('chat-ui').classList.remove('hidden');
    document.getElementById('chat-link-container').classList.remove('hidden');
    const roomId = generateUUID();
    const key = await generateKey();
    cryptoKey = key; 
    connectWebSocket(roomId);
    const keyStr = await exportKey(key);
    const link = `${window.location.origin}/#chat_${roomId}_${keyStr}`;
    document.getElementById('chat-share-link').innerText = link;
    addSystemMessage(`Identity: ${myUsername}`);
}

async function joinChat(hash) {
    const parts = hash.split('_');
    cryptoKey = await importKey(parts[2]);
    connectWebSocket(parts[1]);
    addSystemMessage(`Identity: ${myUsername}`);
}

function connectWebSocket(roomId) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/ws/${roomId}`;
    socket = new WebSocket(wsUrl);

    socket.onopen = async () => {
        document.getElementById('status').innerText = "Status: Encrypted Tunnel Active";
        const joinMsg = JSON.stringify({ sender: "System", text: `${myUsername} joined.` });
        const encryptedJoin = await encryptData(cryptoKey, joinMsg);
        socket.send(encryptedJoin);
    };

    socket.onmessage = async (event) => {
        if (event.data.startsWith("SYSTEM_NUKE:")) {
            alert("CHAT DESTROYED");
            window.location.href = "/";
            return;
        }
        if (event.data.startsWith("SYSTEM_ERROR")) {
            alert(event.data);
            return;
        }

        try {
            const jsonStr = await decryptData(cryptoKey, event.data);
            const msgObj = JSON.parse(jsonStr);
            if (msgObj.sender === "System") addSystemMessage(msgObj.text);
            else addMessageToUI(msgObj.sender, msgObj.text, 'them');
        } catch (e) {
            console.error("Decryption error:", e);
        }
    };
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value;
    if (!text || !socket) return;
    const payload = JSON.stringify({ sender: myUsername, text: text });
    const encryptedData = await encryptData(cryptoKey, payload);
    socket.send(encryptedData);
    addMessageToUI("Me", text, 'me');
    input.value = "";
}

function handleChatEnter(e) { if (e.key === 'Enter') sendChatMessage(); }

async function nukeChat() {
    if (!confirm("Destroy this chat?")) return;
    const hash = window.location.hash.substring(1);
    await fetch('/api/chat/nuke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: hash.split('_')[1] })
    });
}

function addMessageToUI(sender, text, type) {
    const div = document.createElement('div');
    div.className = `msg ${type}`;
    div.innerHTML = `<strong style="font-size:0.8em;opacity:0.7;display:block">${sender}:</strong><span>${text}</span>`;
    const win = document.getElementById('chat-window');
    win.appendChild(div);
    win.scrollTop = win.scrollHeight;
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = `sys-msg`;
    div.innerText = `[ ${text} ]`;
    div.style.color = "#00ff41"; div.style.textAlign="center"; div.style.margin="10px";
    document.getElementById('chat-window').appendChild(div);
}

// --- CRYPTO UTILS ---
async function generateKey() { return await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]); }
async function importKey(str) { return await window.crypto.subtle.importKey("raw", base64ToArrayBuffer(str), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]); }
async function exportKey(key) { return arrayBufferToBase64(await window.crypto.subtle.exportKey("raw", key)); }
async function encryptData(key, txt) {
    const enc = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const buf = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(txt));
    return `${arrayBufferToBase64(iv)}:${arrayBufferToBase64(buf)}`;
}
async function decryptData(key, str) {
    const p = str.split(':');
    const dec = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToArrayBuffer(p[0]) }, key, base64ToArrayBuffer(p[1]));
    return new TextDecoder().decode(dec);
}
function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); }
function arrayBufferToBase64(buf) { return window.btoa(String.fromCharCode(...new Uint8Array(buf))); }
function base64ToArrayBuffer(b64) { return Uint8Array.from(window.atob(b64), c => c.charCodeAt(0)); }