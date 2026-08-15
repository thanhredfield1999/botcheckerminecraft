export interface QueueTask {
  id: string
  run: () => Promise<void> | void
  cancel: () => void
}

export interface QueueSnapshot {
  active: number
  pending: number
  capacity: number
}

export class RunQueue {
  private readonly pending: QueueTask[] = []
  private active?: QueueTask
  private idleResolvers: Array<() => void> = []

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Queue capacity must be a positive integer')
  }

  enqueue(task: QueueTask): string {
    if (this.active?.id === task.id || this.pending.some(candidate => candidate.id === task.id)) {
      throw new Error(`Duplicate queue task: ${task.id}`)
    }
    if (this.pending.length >= this.capacity) throw new Error('Run queue is full')
    this.pending.push(task)
    void this.pump()
    return task.id
  }

  cancel(id: string): boolean {
    const pendingIndex = this.pending.findIndex(task => task.id === id)
    if (pendingIndex >= 0) {
      const [task] = this.pending.splice(pendingIndex, 1)
      task.cancel()
      this.resolveIdleIfEmpty()
      return true
    }
    if (this.active?.id === id) {
      this.active.cancel()
      return true
    }
    return false
  }

  snapshot(): QueueSnapshot {
    return { active: this.active ? 1 : 0, pending: this.pending.length, capacity: this.capacity }
  }

  idle(): Promise<void> {
    if (!this.active && this.pending.length === 0) return Promise.resolve()
    return new Promise(resolve => this.idleResolvers.push(resolve))
  }

  private async pump(): Promise<void> {
    if (this.active || this.pending.length === 0) return
    this.active = this.pending.shift()
    if (!this.active) return
    const task = this.active
    try {
      await task.run()
    } catch {
      // The task owns its failure state/report. A failed run must not stop the queue.
    } finally {
      if (this.active === task) this.active = undefined
      void this.pump()
      this.resolveIdleIfEmpty()
    }
  }

  private resolveIdleIfEmpty(): void {
    if (this.active || this.pending.length > 0) return
    const resolvers = this.idleResolvers.splice(0)
    for (const resolve of resolvers) resolve()
  }
}

export type { QueueTask as RunQueueTask }
