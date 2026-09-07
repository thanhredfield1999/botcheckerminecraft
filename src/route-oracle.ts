import { CrossingTracker, type CrossingObservation, type Position3 } from './crossing.js'

export interface RouteCheckpoint {
  id: string
  position: Position3
  radius: number
}

export interface RouteFence {
  x: number
  y: number
  z: number
  expectedName?: string
}

export interface RouteGate {
  checkpointId: string
  block: { x: number; y: number; z: number }
  approach: Position3
  exit: Position3
  crossing: CrossingOptions
}

export interface CrossingOptions {
  entryClearance: number
  exitClearance: number
  verticalTolerance: number
  requiredExitSamples: number
  planeEpsilon: number
  corridorHalfWidth: number
  /** DF-08: nửa bề ngang thân entity; 0 = point check trên tâm (hành vi cũ). */
  entityHalfWidth?: number
  maxStepDistance: number
  exitDwellMs: number
}

export interface RouteObservation {
  position: Position3
  stepDistance: number
  visited: string[]
  nextCheckpoint?: string
  shortcutDetected: boolean
  backtrackDetected: boolean
  gateOrderViolation: boolean
  segmentIndex: number
  discontinuityDetected: boolean
  gateCrossings: Record<string, CrossingObservation>
  passed: boolean
}

export class RouteOracle {
  private previous?: Position3
  private nextIndex = 0
  private readonly visited: string[] = []
  private readonly crossingTrackers: Map<string, CrossingTracker>
  private readonly gateOpen = new Set<string>()
  private readonly gatePassed = new Set<string>()
  private shortcutDetected = false
  private backtrackDetected = false
  private gateOrderViolation = false
  private discontinuityDetected = false

  constructor(
    private readonly checkpoints: readonly RouteCheckpoint[],
    gates: readonly RouteGate[],
    private readonly maxStepDistance: number
  ) {
    if (checkpoints.length < 2) throw new Error('Route cần ít nhất hai checkpoint')
    if (!Number.isFinite(maxStepDistance) || maxStepDistance <= 0) throw new Error('maxStepDistance không hợp lệ')
    const ids = new Set<string>()
    for (const checkpoint of checkpoints) {
      if (ids.has(checkpoint.id) || !checkpoint.id.trim()) throw new Error('Checkpoint ID bị trùng hoặc rỗng')
      ids.add(checkpoint.id)
      if (!Number.isFinite(checkpoint.radius) || checkpoint.radius <= 0) throw new Error(`Checkpoint ${checkpoint.id} radius không hợp lệ`)
    }
    this.crossingTrackers = new Map(gates.map(gate => [gate.checkpointId, new CrossingTracker({
      approach: gate.approach,
      exit: gate.exit,
      ...gate.crossing
    })]))
    for (const gate of gates) {
      if (!ids.has(gate.checkpointId)) throw new Error(`Gate ${gate.checkpointId} không có checkpoint tương ứng`)
    }
  }

  observe(position: Position3, monotonicMs: number, openGates: readonly string[] = []): RouteObservation {
    const segmentIndex = Math.min(this.nextIndex, Math.max(0, this.checkpoints.length - 2))
    const stepDistance = this.previous === undefined ? 0 : distance(this.previous, position)
    if (this.previous !== undefined && stepDistance > this.maxStepDistance) this.discontinuityDetected = true
    for (const gateId of openGates) this.gateOpen.add(gateId)

    const gateCrossings: Record<string, CrossingObservation> = {}
    for (const [checkpointId, tracker] of this.crossingTrackers) {
      gateCrossings[checkpointId] = tracker.observe(position, monotonicMs)
      if (gateCrossings[checkpointId].crossed) {
        const checkpointIndex = this.checkpoints.findIndex(checkpoint => checkpoint.id === checkpointId)
        if (checkpointIndex > this.nextIndex) this.gateOrderViolation = true
        else this.gatePassed.add(checkpointId)
      }
    }

    if (this.nextIndex < this.checkpoints.length) {
      const next = this.checkpoints[this.nextIndex]
      if (within(position, next.position, next.radius)) {
        if (!this.discontinuityDetected) {
          this.visited.push(next.id)
          this.nextIndex++
        }
      } else {
        const laterIndex = this.checkpoints.findIndex((checkpoint, index) => index > this.nextIndex && within(position, checkpoint.position, checkpoint.radius))
        if (laterIndex >= 0) this.shortcutDetected = true
      }
    }

    const priorCheckpoint = this.checkpoints
      .slice(0, Math.max(0, this.nextIndex - 1))
      .some(checkpoint => within(position, checkpoint.position, checkpoint.radius))
    if (priorCheckpoint) this.backtrackDetected = true

    const passed = !this.discontinuityDetected && !this.shortcutDetected && !this.backtrackDetected && !this.gateOrderViolation
      && this.nextIndex === this.checkpoints.length
      && [...this.crossingTrackers.entries()].every(([checkpointId, tracker]) =>
        this.gateOpen.has(checkpointId) && this.gatePassed.has(checkpointId))
    this.previous = { ...position }
    return {
      position: { ...position },
      stepDistance,
      visited: [...this.visited],
      nextCheckpoint: this.checkpoints[this.nextIndex]?.id,
      shortcutDetected: this.shortcutDetected,
      backtrackDetected: this.backtrackDetected,
      gateOrderViolation: this.gateOrderViolation,
      segmentIndex,
      discontinuityDetected: this.discontinuityDetected,
      gateCrossings,
      passed
    }
  }
}

export function fenceBlockMatches(name: string, expectedName?: string): boolean {
  const normalized = name.trim().toLowerCase()
  const expected = expectedName?.trim().toLowerCase().replace(/^minecraft:/, '')
  return expected === undefined
    ? normalized.endsWith('_fence') && !normalized.endsWith('_fence_gate')
    : normalized.replace(/^minecraft:/, '') === expected
}

export function fenceBlocksDirectPath(
  start: Position3,
  end: Position3,
  fences: readonly RouteFence[],
  clearance = 0.35
): boolean {
  if (!Number.isFinite(clearance) || clearance < 0) return false
  const steps = Math.max(1, Math.ceil(distance(start, end) * 8))
  for (let index = 0; index <= steps; index++) {
    const ratio = index / steps
    const point = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      z: start.z + (end.z - start.z) * ratio
    }
    if (fences.some(fence => Math.abs(point.x - (fence.x + 0.5)) <= 0.5 + clearance
      && Math.abs(point.y - (fence.y + 0.5)) <= 1.0 + clearance
      && Math.abs(point.z - (fence.z + 0.5)) <= 0.5 + clearance)) return true
  }
  return false
}

function distance(first: Position3, second: Position3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function within(position: Position3, center: Position3, radius: number): boolean {
  return distance(position, center) <= radius
}

export type { Position3 }
