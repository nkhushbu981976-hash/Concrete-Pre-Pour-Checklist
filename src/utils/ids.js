let fallbackSequence = 0

export function createId(prefix = 'id') {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `${prefix}-${globalThis.crypto.randomUUID()}`
    }
  } catch {
    // Use the local fallback if a restricted context blocks crypto access.
  }

  fallbackSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${fallbackSequence.toString(36)}`
}
