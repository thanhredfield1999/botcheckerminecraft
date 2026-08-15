interface ManagedBot {
  currentWindow: unknown | null
  pathfinder?: { stop(): void }
  closeWindow(window: any): void
  quit(reason?: string): void
  on(event: string, listener: (...args: any[]) => void): unknown
  once(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
}

interface ListenerBinding {
  event: string
  listener: (...args: any[]) => void
}

const abortError = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason
  return new Error(signal.reason === undefined ? 'Operation cancelled' : String(signal.reason))
}

export const waitForSpawn = (bot: ManagedBot, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  let settled = false

  const cleanup = () => {
    bot.off('spawn', onSpawn)
    bot.off('error', onError)
    bot.off('kicked', onKicked)
    bot.off('end', onEnd)
    signal.removeEventListener('abort', onAbort)
  }
  const settle = (operation: () => void) => {
    if (settled) return
    settled = true
    cleanup()
    operation()
  }
  const onSpawn = () => settle(resolve)
  const onError = (error: Error) => settle(() => reject(error))
  const onKicked = (reason: unknown) => settle(() => reject(new Error(`Kicked: ${String(reason)}`)))
  const onEnd = (reason: unknown) => settle(() => reject(new Error(`Connection ended before spawn: ${String(reason ?? 'unknown')}`)))
  const onAbort = () => settle(() => reject(abortError(signal)))

  if (signal.aborted) {
    onAbort()
    return
  }
  bot.once('spawn', onSpawn)
  bot.once('error', onError)
  bot.once('kicked', onKicked)
  bot.once('end', onEnd)
  signal.addEventListener('abort', onAbort, { once: true })
})

export class BotSession {
  private readonly listeners: ListenerBinding[] = []
  private cleanupPromise?: Promise<void>

  constructor(private readonly bot: ManagedBot, private readonly disconnectTimeoutMs: number = 5_000) {}

  on(event: string, listener: (...args: any[]) => void): () => void {
    const binding = { event, listener }
    this.listeners.push(binding)
    this.bot.on(event, listener)
    return () => {
      const index = this.listeners.indexOf(binding)
      if (index >= 0) this.listeners.splice(index, 1)
      this.bot.off(event, listener)
    }
  }

  cleanup(reason: string): Promise<void> {
    this.cleanupPromise ??= this.cleanupOnce(reason)
    return this.cleanupPromise
  }

  private async cleanupOnce(reason: string): Promise<void> {
    try {
      this.bot.pathfinder?.stop()
    } catch {}

    if (this.bot.currentWindow) {
      try {
        this.bot.closeWindow(this.bot.currentWindow)
      } catch {}
    }

    for (const { event, listener } of this.listeners.splice(0)) this.bot.off(event, listener)

    await new Promise<void>(resolve => {
      let settled = false
      let timer: NodeJS.Timeout | undefined
      const finish = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.bot.off('end', finish)
        resolve()
      }

      this.bot.once('end', finish)
      timer = setTimeout(finish, this.disconnectTimeoutMs)
      timer.unref?.()
      try {
        this.bot.quit(reason)
      } catch {
        finish()
      }
    })
  }
}
