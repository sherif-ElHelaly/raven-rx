// VISION §5.8: partly hidden card numbers in lists, full number on detail.
export function maskCardNumber(cardNumber: string): string {
  if (cardNumber.length <= 4) return cardNumber
  return `••••${cardNumber.slice(-4)}`
}
