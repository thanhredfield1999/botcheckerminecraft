import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const supportsCatchableSignals = process.platform !== 'win32'

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`direct Node entrypoint đóng listener và process sau ${signal}`, {
    skip: supportsCatchableSignals ? false : 'Windows cưỡng bức kết thúc child; Node signal handler không nhận SIGINT/SIGTERM',
    timeout: 15_000
  }, async t => {
    const port = await reserveLoopbackPort()
    const reportDir = await mkdtemp(path.join(os.tmpdir(), 'botchecker-shutdown-'))
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: projectRoot,
      env: {
        API_HOST: '127.0.0.1',
        API_PORT: String(port),
        RUN_QUEUE_CAPACITY: '1',
        SCENARIO_DIR: path.join(projectRoot, 'scenarios'),
        REPORT_DIR: reportDir
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const output: string[] = []
    child.stdout?.on('data', chunk => output.push(String(chunk)))
    child.stderr?.on('data', chunk => output.push(String(chunk)))

    t.after(async () => {
      await stopOwnedChild(child)
      await rm(reportDir, { recursive: true, force: true })
    })

    await waitForHealth(port, child, output)
    assert.ok(child.pid, 'direct entrypoint phải có PID do test sở hữu')
    assert.equal(child.kill(signal), true)

    const exit = await waitForExit(child)
    assert.deepEqual(exit, { code: 0, signal: null }, output.join(''))
    await assertListenerClosed(port)
    assertProcessGone(child.pid)
  })
}

async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

async function waitForHealth(port: number, child: ChildProcess, output: string[]): Promise<void> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Direct entrypoint thoát trước readiness: ${output.join('')}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch {
      // Listener chưa sẵn sàng; tiếp tục bounded polling.
    }
    await delay(50)
  }
  throw new Error(`Timeout chờ direct entrypoint trên port ${port}: ${output.join('')}`)
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return await Promise.race([
    new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    delay(5_000).then(() => { throw new Error(`Timeout chờ child PID ${child.pid} thoát`) })
  ]) as { code: number | null; signal: NodeJS.Signals | null }
}

async function assertListenerClosed(port: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) })
    } catch {
      return
    }
    await delay(25)
  }
  assert.fail(`Listener 127.0.0.1:${port} vẫn mở sau shutdown`)
}

function assertProcessGone(pid: number | undefined): void {
  assert.ok(pid)
  assert.throws(() => process.kill(pid, 0), error => {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
  })
}

async function stopOwnedChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await waitForExit(child).catch(() => undefined)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
