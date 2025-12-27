// extension/background.js

let ws = null;
let reconnectTimer = null;

function isTargetTab(url = '') {
  return (
    url.startsWith('https://www.gate.io/') ||
    url.startsWith('https://www.gate.com/') ||
    url.startsWith('https://www.mexc.com/')
  );
}

async function broadcastToTargetTabs(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    if (!isTargetTab(tab.url)) continue;

    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // Ignora: conteúdo pode não estar carregado ainda
    });
  }
}

function connectWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log('🧠 [BG] Tentando conectar em ws://localhost:8787 ...');

  try {
    ws = new WebSocket('ws://localhost:8787');

    ws.onopen = async () => {
      console.log('🟢 [BG] Conectado ao CORE ws://localhost:8787');
      await broadcastToTargetTabs({ type: 'CORE_STATUS', ok: true });
    };

    ws.onmessage = async (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      await broadcastToTargetTabs({ type: 'CORE_DATA', data });
    };

    ws.onclose = async () => {
      console.log('⚠️ [BG] WS do CORE fechado. Reconectando em 2s...');
      await broadcastToTargetTabs({ type: 'CORE_STATUS', ok: false });
      reconnectTimer = setTimeout(connectWs, 2000);
    };

    ws.onerror = async () => {
      console.log('❌ [BG] Erro no WS do CORE. Reconectando em 2s...');
      await broadcastToTargetTabs({ type: 'CORE_STATUS', ok: false });

      try { ws.close(); } catch {}
      reconnectTimer = setTimeout(connectWs, 2000);
    };
  } catch (err) {
    console.log('❌ [BG] Falha ao iniciar WS:', err?.message || err);
    reconnectTimer = setTimeout(connectWs, 2000);
  }
}

connectWs();

chrome.runtime.onStartup.addListener(() => connectWs());
chrome.runtime.onInstalled.addListener(() => connectWs());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'UI_COMMAND') return;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'COMMAND', command: message.command }));
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false, error: 'CORE_WS_OFFLINE' });
  }
});
