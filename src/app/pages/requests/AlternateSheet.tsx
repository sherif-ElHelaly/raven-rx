import { useLiveQuery } from 'dexie-react-hooks'
import { getAlternatives, substituteItem, undoSubstitute } from '../../../db/repo'
import { db } from '../../../db/schema'
import type { Item } from '../../../db/types'
import { useToast } from '../../../ui/Toast'
import { MedPicker, type SuggestedMed } from '../drugs/MedPicker'
import { TIER_LABELS } from '../drugs/tiers'

interface AlternateSheetProps {
  item: Item
  // The prescribed med's label.
  prescribedLabel: string
  onClose: () => void
}

// "Got a بديل": record which med was actually obtained instead of the
// prescribed one. Suggests known alternates and other strengths first.
export function AlternateSheet({ item, prescribedLabel, onClose }: AlternateSheetProps) {
  const { showToast } = useToast()

  const suggested = useLiveQuery(async (): Promise<SuggestedMed[]> => {
    const pres = await db.presentations.get(item.presentationId)
    if (!pres) return []
    const [alternatives, sameProduct, product] = await Promise.all([
      getAlternatives(db, item.presentationId),
      db.presentations.where('productId').equals(pres.productId).toArray(),
      db.products.get(pres.productId),
    ])
    const otherStrengths: SuggestedMed[] = sameProduct
      .filter((p) => p.id !== pres.id)
      .map((p) => ({
        key: `s-${p.id}`,
        presentationId: p.id!,
        label: [product?.nameEn, p.strength, p.form].filter(Boolean).join(' '),
        hint: 'Other strength of the same med',
      }))
    const alts: SuggestedMed[] = alternatives.map((a) => ({
      key: `a-${a.presentation.id}`,
      presentationId: a.presentation.id!,
      label: [a.product.nameEn, a.presentation.strength, a.presentation.form].filter(Boolean).join(' '),
      hint: TIER_LABELS[a.tier],
    }))
    return [...alts, ...otherStrengths].filter((s) => s.presentationId !== item.substitutedWithId)
  }, [item.presentationId, item.substitutedWithId])

  const choose = async (presentationId: number | null, label: string) => {
    onClose()
    const result = await substituteItem(db, item.id!, presentationId)
    showToast(
      presentationId === null
        ? 'Back to the prescribed med'
        : `بديل: ${label}${result.createdLinkId !== null ? ' · will be suggested next time' : ''}`,
      () => {
        undoSubstitute(db, item.id!, result)
      },
    )
  }

  return (
    <MedPicker
      mode="presentation"
      title={`بديل for ${prescribedLabel}`}
      onClose={onClose}
      suggested={suggested}
      excludePresentationIds={[item.presentationId]}
      header={
        item.substitutedWithId !== undefined && (
          <button
            type="button"
            className="sheet__option sheet__option--muted"
            onClick={() => choose(null, prescribedLabel)}
          >
            ↩ Remove بديل — back to {prescribedLabel}
          </button>
        )
      }
      onPick={(pres, product) =>
        choose(pres.id!, [product.nameEn, pres.strength, pres.form].filter(Boolean).join(' '))
      }
    />
  )
}
