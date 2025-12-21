// extension/content_mexc.js

console.log('🧩 content_mexc.js carregado');

(function () {
  const OVERLAY_ID = 'arb-assistant-overlay-wrapper';

  function ensureOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const htmlUrl = chrome.runtime.getURL('overlay/panel.html');
    const cssUrl = chrome.runtime.getURL('overlay/panel.css');

    fetch(htmlUrl)
      .then((res) => res.text())
      .then((html) => {
        const wrapper = document.createElement('div');
        wrapper.id = OVERLAY_ID;
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = cssUrl;
        document.head.appendChild(css);

        const panel = document.getElementById('arb-panel');
        if (panel) panel.style.display = 'block';

        const btn = document.getElementById('confirmBtn');
        if (btn) btn.disabled = true;

        console.log('🟣 Overlay injetado com sucesso');

        setText('askGate', '--');
        setText('bidMexc', '--');
        setText('spread', '--');
        setText('coreStatus', 'CORE: aguardando...');
        setText('riskStatus', 'RISCO: --');
        setText('queueStatus', 'FILA: --');

        setupActions();
      })
      .catch((err) => {
        console.error('❌ Falha ao injetar overlay:', err);
      });
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function setButtonEnabled(enabled) {
    const btn = document.getElementById('confirmBtn');
    if (!btn) return;
    btn.disabled = !enabled;
  }

  function sendCommand(command) {
    chrome.runtime.sendMessage({ type: 'UI_COMMAND', command });
  }

  function setupActions() {
    const confirmBtn = document.getElementById('confirmBtn');
    const autoBtn = document.getElementById('autoBtn');
    const assistBtn = document.getElementById('assistBtn');
    const panicBtn = document.getElementById('panicBtn');
    const testBtn = document.getElementById('testBtn');

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!confirmBtn.dataset.orderId) return;
        sendCommand({ action: 'CONFIRM_ORDER', id: confirmBtn.dataset.orderId });
      });
    }

    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        sendCommand({ action: 'SET_MODE', autoMode: true, assistedMode: false });
      });
    }

    if (assistBtn) {
      assistBtn.addEventListener('click', () => {
        sendCommand({ action: 'SET_MODE', autoMode: false, assistedMode: true });
      });
    }

    if (panicBtn) {
      panicBtn.addEventListener('click', () => {
        sendCommand({ action: 'PANIC' });
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', () => {
        const askGate = Number(testBtn.dataset.askGate || 0);
        const bidMexc = Number(testBtn.dataset.bidMexc || 0);
        const assetGate = testBtn.dataset.pairGate || 'TEST_GATE';
        const assetMexc = testBtn.dataset.pairMexc || 'TEST_MEXC';

        sendCommand({
          action: 'TEST_BURST',
          orders: [
            {
              asset: assetGate,
              exchange: 'GATE',
              side: 'BUY',
              volume: 25,
              price: askGate || 0,
              priority: 20
            },
            {
              asset: assetMexc,
              exchange: 'MEXC',
              side: 'SELL',
              volume: 25,
              price: bidMexc || 0,
              priority: 20
            }
          ]
        });
      });
    }
  }

  function renderQueue(queue = [], history = []) {
    const list = document.getElementById('queueList');
    if (!list) return;

    const combined = [...queue, ...history].slice(0, 6);
    if (!combined.length) {
      list.textContent = 'Nenhuma ordem na fila.';
      return;
    }

    list.innerHTML = '';
    combined.forEach((order) => {
      const row = document.createElement('div');
      row.className = 'queue-item';
      row.innerHTML = `
        <span>${order.asset || '--'} • ${order.side || '--'} • ${order.volume}</span>
        <span class="badge">${order.status}</span>
      `;
      list.appendChild(row);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureOverlay);
  } else {
    ensureOverlay();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'CORE_STATUS') {
      setText('coreStatus', msg.ok ? 'CORE: conectado' : 'CORE: desconectado');
      return;
    }

    if (msg.type === 'CORE_DATA') {
      const data = msg.data || {};

      if (typeof data.askGate === 'number') setText('askGate', data.askGate.toFixed(11));
      if (typeof data.bidMexc === 'number') setText('bidMexc', data.bidMexc.toFixed(11));
      if (typeof data.spread === 'number') setText('spread', data.spread.toFixed(3) + '%');

      const pendingSuggested = (data.queue || []).find(
        (order) => order.suggested && !order.confirmed
      );
      const confirmBtn = document.getElementById('confirmBtn');
      if (confirmBtn) {
        confirmBtn.dataset.orderId = pendingSuggested?.id || '';
      }

      setButtonEnabled(!!pendingSuggested);

      const riskStatus = document.getElementById('riskStatus');
      if (riskStatus) {
        const panicFlag = data.panic ? 'PANIC' : 'OK';
        const cooldownFlag =
          data.cooldownUntil && Date.now() < data.cooldownUntil
            ? 'COOLDOWN'
            : 'ON';
        riskStatus.textContent = `RISCO: ${panicFlag} | ${cooldownFlag}`;
      }

      const queueStatus = document.getElementById('queueStatus');
      if (queueStatus) {
        const queueCount = Array.isArray(data.queue) ? data.queue.length : 0;
        queueStatus.textContent = `FILA: ${queueCount} | PERDAS: ${data.losses || 0}`;
      }

      const testBtn = document.getElementById('testBtn');
      if (testBtn) {
        testBtn.dataset.askGate = data.askGate || '';
        testBtn.dataset.bidMexc = data.bidMexc || '';
        testBtn.dataset.pairGate = data.pairGate || '';
        testBtn.dataset.pairMexc = data.pairMexc || '';
      }

      renderQueue(data.queue || [], data.history || []);
    }
  });
})();
