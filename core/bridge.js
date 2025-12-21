// core/bridge.js
import { WebSocketServer } from 'ws'
import cfg from './config.js'
import state from './state.js'
import { enqueueOrder, emergencyStop, confirmOrder, clearQueue } from './executionQueue.js'
import { clearPanic, triggerPanic } from './riskManager.js'

let wss = null

function handleCommand(command) {
  if (!command || !command.action) return

  switch (command.action) {
    case 'SET_MODE':
      state.mode = command.mode ?? state.mode
      state.autoMode = !!command.autoMode
      state.assistedMode = !!command.assistedMode
      break
    case 'PANIC':
      triggerPanic()
      emergencyStop()
      break
    case 'CLEAR_PANIC':
      clearPanic()
      break
    case 'CONFIRM_ORDER':
      if (command.id) {
        confirmOrder(command.id)
      }
      break
    case 'CLEAR_QUEUE':
      clearQueue()
      break
    case 'ENQUEUE_ORDER':
      enqueueOrder(command.payload)
      break
    case 'TEST_BURST':
      if (Array.isArray(command.orders)) {
        command.orders.forEach((order) =>
          enqueueOrder({ ...order, bypassLimits: true })
        )
      }
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
    autoMode: state.autoMode,
    assistedMode: state.assistedMode,
    panic: state.panic,
    losses: state.losses,
    cooldownUntil: state.cooldownUntil,
    exposure: state.exposure,
    queue: state.executionQueue,
    history: state.queueHistory
  })

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload)
    }
  }
}
