type Closable = { close(): Promise<unknown> }

type ProcessSignals = {
  exitCode?: string | number | null
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export function installShutdownHandlers(app: Closable, targetProcess: ProcessSignals = process): () => Promise<void> {
  let shutdown: Promise<void> | undefined

  const removeHandlers = () => {
    targetProcess.off('SIGINT', handleSignal)
    targetProcess.off('SIGTERM', handleSignal)
  }
  const handleSignal = () => {
    shutdown ??= Promise.resolve(app.close())
      .then(() => undefined)
      .catch(() => { targetProcess.exitCode = 1 })
      .finally(removeHandlers)
  }

  targetProcess.on('SIGINT', handleSignal)
  targetProcess.on('SIGTERM', handleSignal)
  return async () => { await shutdown }
}
