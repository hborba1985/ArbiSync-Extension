// core/bridge.js
import { WebSocketServer } from 'ws'
import cfg from './config.js'
import state from './state.js'

let wss = null

function handleCommand(command) {
  if (!command || !command.action) return

  switch (command.action) {
    case 'UPDATE_SETTINGS':
      state.settings = {
        ...state.settings,
        ...command.settings
      }
      break
    case 'TEST_EXECUTION':
      state.lastTestExecution = {
        volume: command.volume ?? null,
        at: Date.now(),
        status: 'REQUESTED',
        error: null
      }
      console.log('🧪 Teste de execução solicitado', state.lastTestExecution)
      break
    default:
      break
  }
}

export function startBridge(port = 8787) {
  wss = new WebSocketServer({ port })

  console.log(`🔗 Bridge WS ativa em ws://localhost:${port}`)

  wss.on('connection', (ws) => {
    console.log('🧩 Extensão conectada ao CORE')

    ws.on('message', (message) => {
      let data = null
      try {
        data = JSON.parse(message.toString())
      } catch {
        return
      }

      if (data?.type === 'COMMAND') {
        handleCommand(data.command)
      }
    })

    ws.on('close', () => {
      console.log('❌ Extensão desconectada')
    })
  })
}

export function broadcastState() {
  if (!wss) return

  const payload = JSON.stringify({
    askGate: state.askGate,
    bidMexc: state.bidMexc,
    spread: state.spread,
    signal: state.signal,
    mode: state.mode,
    pairGate: cfg.PAIR_GATE,
    pairMexc: cfg.PAIR_MEXC,
    settings: state.settings,
    alert: state.alert,
    lastTestExecution: state.lastTestExecution
  })

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload)
    }
  }
}
