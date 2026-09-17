import type { ItemStatus } from '../../../db/types'

export const STATUS_LABELS: Record<ItemStatus, string> = {
  searching: 'Searching',
  found: 'Found',
  transferred: 'Transferred',
  delivered: 'Delivered',
  unavailable: 'Unavailable',
  cancelled: 'Cancelled',
}

export const STATUS_ORDER: ItemStatus[] = [
  'searching',
  'found',
  'transferred',
  'delivered',
  'unavailable',
  'cancelled',
]

export const CLOSED_STATUSES: ItemStatus[] = ['delivered', 'unavailable', 'cancelled']
