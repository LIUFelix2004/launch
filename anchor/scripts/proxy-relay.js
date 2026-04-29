const net = require('node:net')

const listenHost = process.env.RELAY_LISTEN_HOST || '0.0.0.0'
const listenPort = Number(process.env.RELAY_LISTEN_PORT || 7891)
const targetHost = process.env.RELAY_TARGET_HOST || '127.0.0.1'
const targetPort = Number(process.env.RELAY_TARGET_PORT || 7890)

const server = net.createServer((client) => {
  const target = net.connect(targetPort, targetHost)
  client.pipe(target)
  target.pipe(client)

  const close = () => {
    client.destroy()
    target.destroy()
  }
  client.on('error', close)
  target.on('error', close)
})

server.listen(listenPort, listenHost, () => {
  console.log(`Proxy relay listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`)
})
