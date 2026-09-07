export interface Position3 {
  x: number
  y: number
  z: number
}

export interface CrossingOptions {
  approach: Position3
  exit: Position3
  entryClearance: number
  exitClearance: number
  verticalTolerance: number
  requiredExitSamples: number
  planeEpsilon: number
  corridorHalfWidth: number
  /**
   * DF-08 (dogfooding 2026-09-07): bề ngang NỬA thân entity. Mặc định 0 giữ
   * nguyên hành vi cũ (point check trên tâm entity).
   *
   * Vì sao cần: LivingNPC bắt được `PASS dù NPC cạ tường ở z=8.0018
   * (lateral 0.4982 < 0.6)`. Corridor check chỉ so tâm nên một NPC rộng 0.6
   * (nửa 0.3) có tâm ở 0.4982 — mép thân ở 0.798 — vẫn được tính là qua gate
   * hợp lệ, dù thực tế nó đang cạ vào tường. Đặt giá trị này để corridor tính
   * theo mép thân thay vì tâm.
   */
  entityHalfWidth?: number
  maxStepDistance: number
  exitDwellMs: number
}

export interface CrossingObservation {
  position: Position3
  monotonicMs: number
  signedProgress: number
  lateralOffset: number
  /**
   * Khoảng cách còn lại từ mép thân entity tới tường hành lang. Âm nghĩa là thân
   * đã vượt aperture. Số này khiến biên nhìn thấy được khi đọc lại evidence,
   * thay vì chỉ một boolean pass/fail — chính thứ lẽ ra phải làm DF-08 lộ sớm.
   */
  lateralClearance: number
  withinVertical: boolean
  withinCorridor: boolean
  stepDistance: number
  entryObserved: boolean
  crossingObserved: boolean
  crossingPoint?: Position3
  discontinuityDetected: boolean
  exitConfirmations: number
  exitDwellMs: number
  crossed: boolean
}

export class CrossingTracker {
  private entryObserved = false
  private crossingObserved = false
  private discontinuityDetected = false
  private exitConfirmations = 0
  private exitDwellStartedMs?: number
  private previous?: { position: Position3; signedProgress: number; monotonicMs: number }
  private crossingPoint?: Position3
  private readonly directionX: number
  private readonly directionZ: number
  private readonly tangentX: number
  private readonly tangentZ: number
  private readonly planeX: number
  private readonly planeZ: number

  constructor(private readonly options: CrossingOptions) {
    const coordinates = [
      options.approach.x, options.approach.y, options.approach.z,
      options.exit.x, options.exit.y, options.exit.z
    ]
    const thresholds = [
      options.entryClearance, options.exitClearance, options.verticalTolerance,
      options.requiredExitSamples, options.planeEpsilon, options.corridorHalfWidth,
      options.maxStepDistance, options.exitDwellMs
    ]
    if (![...coordinates, ...thresholds].every(Number.isFinite)) {
      throw new Error('Crossing geometry và thresholds phải là số hữu hạn')
    }
    const dx = options.exit.x - options.approach.x
    const dz = options.exit.z - options.approach.z
    const length = Math.hypot(dx, dz)
    if (!Number.isFinite(dx) || !Number.isFinite(dz) || !Number.isFinite(length) || length <= 1e-9) {
      throw new Error('Approach và exit phải tạo crossing geometry hữu hạn trong mặt phẳng XZ')
    }
    if (options.entryClearance < 0 || options.exitClearance < 0 || options.verticalTolerance <= 0
      || options.requiredExitSamples < 1 || options.planeEpsilon <= 0 || options.corridorHalfWidth <= 0
      || options.maxStepDistance <= 0 || options.exitDwellMs < 0) {
      throw new Error('Crossing thresholds không hợp lệ')
    }
    // DF-08: thân rộng hơn hành lang thì mọi run đều fail — đó là lỗi cấu hình,
    // phải báo ngay chứ không để chạy xong rồi mới thấy fail khó hiểu.
    const entityHalfWidth = options.entityHalfWidth ?? 0
    if (!Number.isFinite(entityHalfWidth) || entityHalfWidth < 0
      || entityHalfWidth >= options.corridorHalfWidth) {
      throw new Error(
        'entityHalfWidth phải nằm trong [0, corridorHalfWidth) — thân entity không lọt qua aperture')
    }
    const halfLength = length / 2
    if (halfLength < Math.max(options.entryClearance, options.exitClearance, options.planeEpsilon)) {
      throw new Error('Approach và exit không đủ xa mặt phẳng để thỏa clearance crossing')
    }
    if (Math.abs(options.approach.y - options.exit.y) >= options.verticalTolerance) {
      throw new Error('Approach và exit lệch cao độ ngoài vertical tolerance')
    }
    this.directionX = dx / length
    this.directionZ = dz / length
    this.tangentX = -this.directionZ
    this.tangentZ = this.directionX
    this.planeX = (options.approach.x + options.exit.x) / 2
    this.planeZ = (options.approach.z + options.exit.z) / 2
  }

  observe(position: Position3, monotonicMs = 0, confirmExitSample = true): CrossingObservation {
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      throw new Error('INCONCLUSIVE_TRACKING: vị trí entity không hữu hạn')
    }
    if (!Number.isFinite(monotonicMs) || monotonicMs < 0
      || (this.previous && monotonicMs < this.previous.monotonicMs)) {
      throw new Error('Monotonic timestamp không hợp lệ')
    }
    const cloned = { ...position }
    const signedProgress = this.signedProgress(cloned)
    const lateralOffset = this.lateralOffset(cloned)
    const withinVertical = Math.abs(cloned.y - this.options.exit.y) < this.options.verticalTolerance
    // DF-08: so mép thân, không so tâm. halfWidth = 0 → hệt hành vi cũ.
    const lateralClearance = this.options.corridorHalfWidth
      - (Math.abs(lateralOffset) + (this.options.entityHalfWidth ?? 0))
    const withinCorridor = lateralClearance >= 0
    const stepDistance = this.previous ? distance(this.previous.position, cloned) : 0

    if (this.previous && stepDistance > this.options.maxStepDistance) {
      this.discontinuityDetected = true
      this.crossingObserved = false
      this.crossingPoint = undefined
      this.exitConfirmations = 0
      this.exitDwellStartedMs = undefined
    }

    if (!withinVertical || !withinCorridor) {
      this.entryObserved = false
      this.crossingObserved = false
      this.crossingPoint = undefined
      this.exitConfirmations = 0
      this.exitDwellStartedMs = undefined
    }

    if (this.crossingObserved && signedProgress <= 0) {
      this.entryObserved = false
      this.crossingObserved = false
      this.crossingPoint = undefined
      this.exitConfirmations = 0
      this.exitDwellStartedMs = undefined
    }

    if (!this.discontinuityDetected && withinVertical && withinCorridor
      && signedProgress <= -Math.max(this.options.entryClearance, this.options.planeEpsilon)) {
      this.entryObserved = true
    }

    const previousWithinVertical = this.previous !== undefined
      && Math.abs(this.previous.position.y - this.options.exit.y) < this.options.verticalTolerance
    const previousWithinCorridor = this.previous !== undefined
      && this.withinCorridorAt(this.previous.position)
    if (!this.discontinuityDetected && this.entryObserved && this.previous
      && previousWithinVertical && previousWithinCorridor && withinVertical && withinCorridor
      && this.previous.signedProgress <= 0
      && signedProgress > 0
      && stepDistance <= this.options.maxStepDistance) {
      const alpha = -this.previous.signedProgress / (signedProgress - this.previous.signedProgress)
      const crossingPoint = interpolate(this.previous.position, cloned, alpha)
      // Điểm cắt mặt phẳng gate là chỗ quan trọng nhất: nếu chỉ kiểm tâm ở đây
      // thì thân entity vẫn có thể đang xuyên tường đúng lúc băng qua.
      if (this.withinCorridorAt(crossingPoint)
        && Math.abs(crossingPoint.y - this.options.exit.y) < this.options.verticalTolerance) {
        this.crossingObserved = true
        this.crossingPoint = crossingPoint
      }
    }

    if (this.crossingObserved && withinVertical && withinCorridor
      && signedProgress >= this.options.exitClearance) {
      if (confirmExitSample) {
        this.exitConfirmations++
        this.exitDwellStartedMs ??= monotonicMs
      }
    } else {
      this.exitConfirmations = 0
      this.exitDwellStartedMs = undefined
    }

    const exitDwellMs = this.exitDwellStartedMs === undefined ? 0 : monotonicMs - this.exitDwellStartedMs
    const crossed = confirmExitSample && !this.discontinuityDetected
      && this.entryObserved && this.crossingObserved
      && this.exitConfirmations >= this.options.requiredExitSamples
      && exitDwellMs >= this.options.exitDwellMs

    this.previous = { position: cloned, signedProgress, monotonicMs }
    return {
      position: cloned,
      monotonicMs,
      signedProgress,
      lateralOffset,
      lateralClearance,
      withinVertical,
      withinCorridor,
      stepDistance,
      entryObserved: this.entryObserved,
      crossingObserved: this.crossingObserved,
      crossingPoint: this.crossingPoint ? { ...this.crossingPoint } : undefined,
      discontinuityDetected: this.discontinuityDetected,
      exitConfirmations: this.exitConfirmations,
      exitDwellMs,
      crossed
    }
  }

  private signedProgress(position: Position3): number {
    return (position.x - this.planeX) * this.directionX
      + (position.z - this.planeZ) * this.directionZ
  }

  private lateralOffset(position: Position3): number {
    return (position.x - this.planeX) * this.tangentX
      + (position.z - this.planeZ) * this.tangentZ
  }

  /** DF-08: corridor check tính theo mép thân entity, không phải tâm. */
  private withinCorridorAt(position: Position3): boolean {
    return Math.abs(this.lateralOffset(position)) + (this.options.entityHalfWidth ?? 0)
      <= this.options.corridorHalfWidth
  }
}

function interpolate(first: Position3, second: Position3, alpha: number): Position3 {
  return {
    x: first.x + (second.x - first.x) * alpha,
    y: first.y + (second.y - first.y) * alpha,
    z: first.z + (second.z - first.z) * alpha
  }
}

function distance(first: Position3, second: Position3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}
