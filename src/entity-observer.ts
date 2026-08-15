export interface ObserverPosition {
  x: number
  y: number
  z: number
}

export interface ObservedEntity {
  id: number
  uuid?: string
  name?: string
  username?: string
  displayName?: string
  type?: string
  position: ObserverPosition
  getCustomName?: () => { toString(): string } | null
}

export interface PinnedEntityIdentity {
  id: number
  uuid?: string
  label: string
}

export interface PinnedEntity<T extends ObservedEntity> {
  entity: T
  identity: PinnedEntityIdentity
}

export function entityIdentityLabels(entity: ObservedEntity): string[] {
  const labels = [entity.name, entity.displayName, entity.username]
  try {
    labels.push(entity.getCustomName?.()?.toString())
  } catch {
    // Metadata không hợp lệ không được làm hỏng việc quét các entity còn lại.
  }
  return [...new Set(labels.filter((label): label is string => typeof label === 'string' && label.length > 0))]
}

export function pinUniqueEntity<T extends ObservedEntity>(
  entities: Iterable<T>,
  observerPosition: ObserverPosition,
  nameIncludes: string,
  maxDistance: number,
  requireUuid: boolean,
  expectedUuid?: string
): PinnedEntity<T> {
  const query = nameIncludes.toLocaleLowerCase()
  const nameMatches = [...entities].filter(entity => {
    return entityIdentityLabels(entity).some(label => label.toLocaleLowerCase().includes(query))
      && distance(entity.position, observerPosition) <= maxDistance
  })
  const matches = expectedUuid === undefined
    ? nameMatches
    : nameMatches.filter(entity => entity.uuid === expectedUuid)
  if (matches.length === 0) {
    if (expectedUuid !== undefined && nameMatches.length > 0) {
      throw new Error(`INCONCLUSIVE_IDENTITY: no entity matching ${nameIncludes} has UUID ${expectedUuid}`)
    }
    throw new Error(`INCONCLUSIVE_TRACKING: no entity matching ${nameIncludes} within ${maxDistance} blocks`)
  }
  if (matches.length !== 1) {
    throw new Error(`INCONCLUSIVE_IDENTITY: ${matches.length} entities match ${nameIncludes}`)
  }
  const entity = matches[0]
  if (requireUuid && !entity.uuid) {
    throw new Error(`INCONCLUSIVE_IDENTITY: entity ${entity.id} has no UUID`)
  }
  const label = entityIdentityLabels(entity).find(value => value.toLocaleLowerCase().includes(query))
  return {
    entity,
    identity: {
      id: entity.id,
      uuid: entity.uuid,
      label: label ?? nameIncludes
    }
  }
}

export function validatePinnedEntity<T extends ObservedEntity>(
  entity: T | undefined,
  identity: PinnedEntityIdentity,
  originalEntity?: T
): T {
  if (!entity) {
    throw new Error(`INCONCLUSIVE_TRACKING: observed entity ${identity.id} disappeared`)
  }
  if (entity.id !== identity.id) {
    throw new Error(`INCONCLUSIVE_IDENTITY: entity ID changed from ${identity.id} to ${entity.id}`)
  }
  if (identity.uuid && entity.uuid !== identity.uuid) {
    throw new Error(`INCONCLUSIVE_IDENTITY: entity UUID changed for ID ${identity.id}`)
  }
  if (originalEntity && entity !== originalEntity) {
    throw new Error(`INCONCLUSIVE_IDENTITY: entity object replaced for ID ${identity.id}`)
  }
  return entity
}

export function validateUniquePinnedEntity<T extends ObservedEntity>(
  entities: Iterable<T>,
  observerPosition: ObserverPosition,
  nameIncludes: string,
  maxDistance: number,
  identity: PinnedEntityIdentity,
  originalEntity: T,
  expectedUuid?: string
): T {
  const query = nameIncludes.toLocaleLowerCase()
  const nameMatches = [...entities].filter(entity => {
    return entityIdentityLabels(entity).some(label => label.toLocaleLowerCase().includes(query))
      && distance(entity.position, observerPosition) <= maxDistance
  })
  const matches = expectedUuid === undefined
    ? nameMatches
    : nameMatches.filter(entity => entity.uuid === expectedUuid)
  if (matches.length === 0) {
    if (expectedUuid !== undefined && nameMatches.length > 0) {
      throw new Error(`INCONCLUSIVE_IDENTITY: no entity matching ${nameIncludes} has UUID ${expectedUuid}`)
    }
    throw new Error(`INCONCLUSIVE_TRACKING: no entity matching ${nameIncludes} within ${maxDistance} blocks`)
  }
  if (matches.length !== 1) {
    throw new Error(`INCONCLUSIVE_IDENTITY: ${matches.length} entities match ${nameIncludes}`)
  }
  return validatePinnedEntity(matches[0], identity, originalEntity)
}

function distance(first: ObserverPosition, second: ObserverPosition): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}
