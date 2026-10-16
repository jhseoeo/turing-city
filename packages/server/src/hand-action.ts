import type { FacilityAction } from '@turing-city/core';

/** The most facilities a priority list can name, and the longest id: a town is far smaller, and nothing a client sends is trusted to be. */
const MAX_ORDER = 64;
const MAX_ID = 64;

function isRecordWith(raw: unknown, keys: readonly string[]): raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const have = Object.keys(raw);
  return have.length === keys.length && keys.every((k) => have.includes(k));
}

const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_ID;

/**
 * The player's hand action as a fresh object of exactly the shape the core takes, or null when `raw` is anything else: the session
 * trusts an action's shape and keeps the caller's object in its record, so what a client sent is rebuilt here, field by field,
 * before it gets that far. The doors of the server check their input too (spec 10-10 §11); this is the last line before the record.
 */
export function exactAction(raw: unknown): FacilityAction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const kind = (raw as { kind?: unknown }).kind;
  switch (kind) {
    case 'process':
    case 'cool':
    case 'harvest':
      return isRecordWith(raw, ['kind']) ? { kind } : null;
    case 'setThermal':
      return isRecordWith(raw, ['kind', 'output']) && typeof raw.output === 'number' && Number.isFinite(raw.output)
        ? { kind, output: raw.output }
        : null;
    case 'setPriority': {
      if (!isRecordWith(raw, ['kind', 'order']) || !Array.isArray(raw.order)) return null;
      const order: unknown[] = raw.order;
      return order.length <= MAX_ORDER && order.every(isId) ? { kind, order: [...(order as string[])] } : null;
    }
    case 'dispatch':
      return isRecordWith(raw, ['kind', 'truck', 'from', 'to', 'amount']) &&
        Number.isSafeInteger(raw.truck) &&
        isId(raw.from) &&
        isId(raw.to) &&
        Number.isSafeInteger(raw.amount)
        ? { kind, truck: raw.truck as number, from: raw.from, to: raw.to, amount: raw.amount as number }
        : null;
    default:
      return null;
  }
}
