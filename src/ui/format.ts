// VISION §5.8: partly hidden card numbers in lists, full number on detail.
export function maskCardNumber(cardNumber: string): string {
  if (cardNumber.length <= 4) return cardNumber
  return `••••${cardNumber.slice(-4)}`
}

// "Ahmed Ali · عقيد" — the name/rank you know a person by, card as fallback.
export function personTitle(person: { name?: string; rank?: string; cardNumber: string } | undefined): string {
  if (!person) return '…'
  const name = person.name?.trim()
  const rank = person.rank?.trim()
  if (name && rank) return `${rank} ${name}`
  return name || (rank ? `${rank} · ${maskCardNumber(person.cardNumber)}` : maskCardNumber(person.cardNumber))
}
