// core/bridge.js
import { WebSocketServer } from 'ws'
import state from './state.js'

let wss = null

export function startBridge(port = 8787) {
  wss = new WebSocketServer({ port })

  console.log(`🔗 Bridge WS ativa em ws://localhost:${port}`)

  wss.on('connection', (ws) => {
    console.log('🧩 Extensão conectada ao CORE')

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
    mode: state.mode
  })

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload)
    }
  }
}
