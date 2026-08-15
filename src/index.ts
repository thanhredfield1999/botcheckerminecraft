import { config } from './config.js'
import { installShutdownHandlers } from './process-shutdown.js'
import { createServer } from './server.js'

const app = createServer()
installShutdownHandlers(app)

try {
  await app.listen({ host: config.apiHost, port: config.apiPort })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
