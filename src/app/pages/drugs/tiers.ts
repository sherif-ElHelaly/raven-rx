import type { AlternativeTier } from '../../../db/repo'

export const TIER_LABELS: Record<AlternativeTier, string> = {
  exact: '🟢 Exact',
  close: '🟡 Close',
  linked: '🔗 Linked by you',
  class: '🔴 Same class — needs prescriber approval',
}
