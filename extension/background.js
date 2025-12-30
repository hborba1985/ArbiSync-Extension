// extension/background.js

let ws = null;
let reconnectTimer = null;
const tabLinks = new Map();
let coreStatusOk = false;

function normalizeGroup(group) {
  return String(group || '').trim();
}

function updateTabLink(tabId, data) {
  const current = tabLinks.get(tabId) || {};
  tabLinks.set(tabId, { ...current, ...data });
}

function getGroupStatus(group) {
  const normalized = normalizeGroup(group);
  const status = {
    group: normalized,
    hasGate: false,
    hasMexc: false,
    gateTabs: [],
    mexcTabs: []
  };
  if (!normalized) return status;
  for (const [tabId, info] of tabLinks.entries()) {
    if (!info?.group || info.group !== normalized) continue;
    if (info.exchange === 'GATE') {
      status.hasGate = true;
      status.gateTabs.push(tabId);
    }
    if (info.exchange === 'MEXC') {
      status.hasMexc = true;
      status.mexcTabs.push(tabId);
    }
  }
  return status;
}

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
      coreStatusOk = true;
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
      coreStatusOk = false;
      await broadcastToTargetTabs({ type: 'CORE_STATUS', ok: false });
      reconnectTimer = setTimeout(connectWs, 2000);
    };

    ws.onerror = async () => {
      console.log('❌ [BG] Erro no WS do CORE. Reconectando em 2s...');
      coreStatusOk = false;
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
chrome.tabs.onRemoved.addListener((tabId) => {
  tabLinks.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'UI_COMMAND') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'COMMAND', command: message.command }));
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'CORE_WS_OFFLINE' });
    }
    return;
  }

  if (message.type === 'REGISTER_TAB') {
    if (sender.tab?.id) {
      updateTabLink(sender.tab.id, {
        exchange: message.exchange,
        group: normalizeGroup(message.group)
      });
    }
    sendResponse({ ok: true, status: getGroupStatus(message.group) });
    return;
  }

  if (message.type === 'UPDATE_GROUP') {
    if (sender.tab?.id) {
      updateTabLink(sender.tab.id, {
        exchange: message.exchange,
        group: normalizeGroup(message.group)
      });
    }
    sendResponse({ ok: true, status: getGroupStatus(message.group) });
    return;
  }

  if (message.type === 'REQUEST_GROUP_STATUS') {
    sendResponse({ ok: true, status: getGroupStatus(message.group) });
    return;
  }

  if (message.type === 'REQUEST_CORE_STATUS') {
    sendResponse({ ok: coreStatusOk });
    return;
  }

  if (message.type === 'SYNC_TEST_EXECUTION') {
    const group = normalizeGroup(message.group);
    const status = getGroupStatus(group);
    const payload = message.payload || {};
    const targetTabs = new Set();
    status.gateTabs.forEach((tabId) => targetTabs.add(tabId));
    status.mexcTabs.forEach((tabId) => targetTabs.add(tabId));

    if (targetTabs.size === 0 && sender.tab?.id) {
      targetTabs.add(sender.tab.id);
    }

    for (const tabId of targetTabs) {
      chrome.tabs.sendMessage(tabId, {
        type: 'RUN_TEST_EXECUTION',
        payload
      }).catch(() => {
        // Ignore missing content scripts
      });
    }

    if (!group) {
      sendResponse({ ok: false, reason: 'NO_GROUP', status });
      return;
    }
    if (!(status.hasGate && status.hasMexc)) {
      sendResponse({ ok: false, reason: 'MISSING_PAIR', status });
      return;
    }
    sendResponse({ ok: true, status });
    return;
  }

  if (message.type === 'DOM_BOOK') {
    broadcastToTargetTabs({ type: 'DOM_BOOK', payload: message.payload });
    sendResponse({ ok: true });
  }

  if (message.type === 'EXECUTION_LOG') {
    broadcastToTargetTabs({ type: 'EXECUTION_LOG', payload: message.payload });
    sendResponse({ ok: true });
  }
});
