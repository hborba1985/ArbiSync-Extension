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
        setText('riskStatus', 'FILTROS: --');
        setText('conversionStatus', 'FUTUROS: -- contratos');

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

  function sendCommand(command) {
    chrome.runtime.sendMessage({ type: 'UI_COMMAND', command });
  }

  function setupActions() {
    const saveBtn = document.getElementById('saveSettingsBtn');
    const testBtn = document.getElementById('testBtn');

    const readNumber = (id) => {
      const input = document.getElementById(id);
      if (!input) return null;
      const value = Number(input.value);
      return Number.isFinite(value) ? value : null;
    };

    const readSettings = () => ({
      spotVolume: readNumber('spotVolume'),
      futuresContractSize: readNumber('futuresContractSize'),
      spreadMin: readNumber('spreadMin'),
      minVolume: readNumber('minVolume'),
      slippageMax: readNumber('slippageMax'),
      slippageEstimate: readNumber('slippageEstimate'),
      maxAlertsPerMinute: readNumber('maxAlertsPerMinute'),
      exposurePerAsset: readNumber('exposurePerAsset'),
      exposurePerExchange: readNumber('exposurePerExchange'),
      exposureGlobal: readNumber('exposureGlobal'),
      allowPartialExecution:
        document.getElementById('allowPartialExecution')?.checked ?? false,
      testVolume: readNumber('testVolume')
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        sendCommand({ action: 'UPDATE_SETTINGS', settings: readSettings() });
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', () => {
        const settings = readSettings();
        sendCommand({ action: 'UPDATE_SETTINGS', settings });
        sendCommand({
          action: 'TEST_EXECUTION',
          volume: settings.testVolume
        });
      });
    }
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

      const riskStatus = document.getElementById('riskStatus');
      if (riskStatus) {
        const reasons = data.alert?.reasons?.length
          ? data.alert.reasons.join(', ')
          : 'OK';
        riskStatus.textContent = `FILTROS: ${reasons}`;
      }

      const conversionStatus = document.getElementById('conversionStatus');
      if (conversionStatus) {
        const contracts = data.alert?.futuresContracts ?? 0;
        conversionStatus.textContent = `FUTUROS: ${contracts.toFixed(4)} contratos`;
      }

      const panel = document.getElementById('arb-panel');
      if (panel) {
        panel.classList.toggle('signal', !!data.signal);
      }

      const settings = data.settings || {};
      const updateInput = (id, value) => {
        const input = document.getElementById(id);
        if (!input || document.activeElement === input) return;
        if (value === null || value === undefined) return;
        input.value = value;
      };

      updateInput('spotVolume', settings.spotVolume);
      updateInput('futuresContractSize', settings.futuresContractSize);
      updateInput('spreadMin', settings.spreadMin);
      updateInput('minVolume', settings.minVolume);
      updateInput('slippageMax', settings.slippageMax);
      updateInput('slippageEstimate', settings.slippageEstimate);
      updateInput('maxAlertsPerMinute', settings.maxAlertsPerMinute);
      updateInput('exposurePerAsset', settings.exposurePerAsset);
      updateInput('exposurePerExchange', settings.exposurePerExchange);
      updateInput('exposureGlobal', settings.exposureGlobal);
      updateInput('testVolume', settings.testVolume);

      const allowPartial = document.getElementById('allowPartialExecution');
      if (allowPartial && document.activeElement !== allowPartial) {
        allowPartial.checked = !!settings.allowPartialExecution;
      }
    }
  });
})();
