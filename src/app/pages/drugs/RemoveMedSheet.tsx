import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  deleteMeds,
  mergePresentation,
  mergeProduct,
  presentationUsage,
  restoreSnapshot,
} from '../../../db/medEdit'
import { db } from '../../../db/schema'
import type { Presentation, Product } from '../../../db/types'
import { useToast } from '../../../ui/Toast'
import { MedPicker } from './MedPicker'

export type RemoveTarget =
  | { kind: 'drug'; product: Product }
  | { kind: 'strength'; product: Product; presentation: Presentation }

function presLabel(p: Presentation): string {
  return [p.strength ?? 'no strength', p.form].join(' ')
}

// Remove an unregistered med: either it was misread (replace it with the right
// med everywhere it's used) or it shouldn't exist (delete it).
export function RemoveMedSheet({ target, onClose }: { target: RemoveTarget; onClose: () => void }) {
  const { showToast } = useToast()
  const [replacing, setReplacing] = useState(false)
  const name =
    target.kind === 'drug'
      ? target.product.nameAr
      : `${target.product.nameEn} ${presLabel(target.presentation)}`

  const usage = useLiveQuery(async () => {
    const presIds =
      target.kind === 'drug'
        ? (await db.presentations.where('productId').equals(target.product.id!).primaryKeys())
        : [target.presentation.id!]
    return presentationUsage(db, presIds as number[])
  }, [target])

  const otherStrengths = useLiveQuery(
    () =>
      target.kind === 'strength'
        ? db.presentations
            .where('productId')
            .equals(target.product.id!)
            .filter((p) => p.id !== target.presentation.id)
            .toArray()
        : Promise.resolve<Presentation[]>([]),
    [target],
  )

  const withUndo = (message: string, run: () => Promise<Parameters<typeof restoreSnapshot>[1]>) => async () => {
    onClose()
    try {
      const snap = await run()
      showToast(message, () => {
        restoreSnapshot(db, snap)
      })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove it')
    }
  }

  const used = (usage?.itemIds.length ?? 0) > 0
  const usageText = usage
    ? [
        usage.caseCount > 0 &&
          `${usage.itemIds.length + usage.substituteCount} med line${usage.itemIds.length + usage.substituteCount === 1 ? '' : 's'} in ${usage.caseCount} case${usage.caseCount === 1 ? '' : 's'}`,
        usage.peopleCount > 0 &&
          `${usage.peopleCount} person${usage.peopleCount === 1 ? '’s' : 's’'} regular meds`,
      ]
        .filter(Boolean)
        .join(' and ')
    : ''

  if (replacing) {
    return target.kind === 'drug' ? (
      <MedPicker
        mode="product"
        title={`Replace ${target.product.nameAr} with`}
        excludeProductIds={[target.product.id!]}
        onClose={onClose}
        onPick={(right) =>
          withUndo(`Replaced with ${right.nameEn} everywhere`, () =>
            mergeProduct(db, target.product.id!, right.id!),
          )()
        }
      />
    ) : (
      <MedPicker
        mode="presentation"
        title={`Replace ${name} with`}
        excludePresentationIds={[target.presentation.id!]}
        suggested={(otherStrengths ?? []).map((p) => ({
          key: `s-${p.id}`,
          presentationId: p.id!,
          label: `${target.product.nameEn} ${presLabel(p)}`,
          hint: 'Same med, saved strength',
        }))}
        onClose={onClose}
        onPick={(right, product) =>
          withUndo(`Replaced with ${product.nameEn} ${presLabel(right)} everywhere`, () =>
            mergePresentation(db, target.presentation.id!, right.id!),
          )()
        }
      />
    )
  }

  const deleteTarget =
    target.kind === 'drug'
      ? { productId: target.product.id!, presentationIds: [] }
      : { presentationIds: [target.presentation.id!] }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__handle" />
        <p className="sheet__title" dir="auto">
          Remove {name}
        </p>
        <p className="settings-section__hint">
          {usage === undefined ? 'Checking where it’s used…' : usageText ? `Used in ${usageText}.` : 'Not used anywhere.'}
        </p>

        <button type="button" className="sheet__option" onClick={() => setReplacing(true)}>
          Replace with the right med…
          <span className="sheet__option-hint">
            Scan misread it? Every case using it switches to the med you pick
            {target.kind === 'drug' ? ', and the next scan of this name matches it directly' : ''}.
          </span>
        </button>

        {usage && (
          <button
            type="button"
            className="sheet__option sheet__option--danger"
            onClick={withUndo(
              used ? `Deleted with ${usage.itemIds.length} case line${usage.itemIds.length === 1 ? '' : 's'}` : 'Deleted',
              () => deleteMeds(db, deleteTarget, { removeCaseLines: used }),
            )}
          >
            {used
              ? `Delete it and its ${usage.itemIds.length} case line${usage.itemIds.length === 1 ? '' : 's'}`
              : 'Delete'}
            {used && (
              <span className="sheet__option-hint">
                Only if it isn’t a real med (e.g. a scan read junk as a med).
              </span>
            )}
          </button>
        )}

        <button type="button" className="sheet__cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
