export type Cleanup = () => void | Promise<void>
export type Operation<T> = (signal: AbortSignal) => Promise<T> | T

export class RunLifecycle {
  private readonly controller = new AbortController()
  private active?: Promise<unknown>
  private cleanup?: Cleanup
  private cleaned = false

  get signal(): AbortSignal {
    return this.controller.signal
  }

  run<T>(operation: Operation<T>, cleanup: Cleanup): Promise<T> {
    if (this.active) throw new Error('Lifecycle operation already started')
    if (this.cleaned) throw new Error('Lifecycle already finished')

    this.cleanup = cleanup
    const active = Promise.resolve().then(() => operation(this.signal))
    this.active = active
    return active.finally(() => this.finish()) as Promise<T>
  }

  cancel(reason = 'cancelled'): void {
    if (this.cleaned || this.controller.signal.aborted) return
    this.controller.abort(new Error(reason))
  }

  async finish(): Promise<void> {
    if (this.cleaned) return
    this.cleaned = true
    await this.cleanup?.()
  }
}
