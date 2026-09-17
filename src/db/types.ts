// Entity types — see VISION.md §3 for the data model this mirrors.

export type Plan = 'monthly' | 'bimonthly'

export type ItemStatus =
  | 'searching'
  | 'found'
  | 'transferred'
  | 'delivered'
  | 'unavailable'
  | 'cancelled'

export const LOCATION_TYPES = [
  'hospital_pharmacy',
  'storage',
  'external_hospital',
  'civilian_pharmacy',
] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

// seed/SEED_FORMAT.md — allowed `form` values.
export const FORMS = [
  'tablet',
  'film-coated tablet',
  'extended-release tablet',
  'chewable tablet',
  'effervescent tablet',
  'orally disintegrating tablet',
  'sublingual tablet',
  'capsule',
  'extended-release capsule',
  'sachet',
  'powder for oral suspension',
  'syrup',
  'suspension',
  'oral solution',
  'oral drops',
  'injection',
  'eye drops',
  'eye ointment',
  'eye gel',
  'ear drops',
  'nasal spray',
  'nasal drops',
  'inhaler',
  'dry powder inhaler',
  'nebulizer solution',
  'cream',
  'ointment',
  'gel',
  'lotion',
  'topical solution',
  'spray',
  'shampoo',
  'suppository',
  'vaginal suppository',
  'vaginal cream',
  'patch',
  'lozenge',
  'mouthwash',
  'oral gel',
  'enema',
] as const
export type Form = (typeof FORMS)[number]

// seed/SEED_FORMAT.md — allowed `categories` values.
export const CATEGORIES = [
  'cardiac',
  'anticoagulant',
  'lipid',
  'antidiabetic',
  'endocrine',
  'gastric',
  'hepatic',
  'antibiotic',
  'antifungal',
  'antiviral',
  'antiparasitic',
  'analgesic',
  'anti-inflammatory',
  'musculoskeletal',
  'respiratory',
  'allergy',
  'cold-flu',
  'psychiatric',
  'neurology',
  'ophthalmic',
  'ent',
  'dermatology',
  'vitamins-supplements',
  'hematology',
  'urology',
  'womens-health',
  'corticosteroid',
  'oral-dental',
] as const
export type Category = (typeof CATEGORIES)[number]

export type Confidence = 'high' | 'medium'

export interface RegularMed {
  presentationId: number
  qty: number
}

export interface Person {
  id?: number
  cardNumber: string
  name?: string
  rank?: string
  unit?: string
  phone?: string
  notes?: string
  regularMeds?: RegularMed[]
}

export interface Request {
  id?: number
  personId: number
  createdAt: number
  plan: Plan
  feePerItem: number
  registered: boolean
  registeredAt?: number
  approved: boolean
  approvedAt?: number
  paid: boolean
  paidAt?: number
  notes?: string
  nextDueDate: number
}

export interface StatusHistoryEntry {
  status: ItemStatus
  at: number
  locationId?: number
}

export interface Item {
  id?: number
  requestId: number
  presentationId: number
  qty: number
  substitutedWithId?: number
  status: ItemStatus
  foundAtLocationId?: number
  transferToLocationId?: number
  transferSlipRef?: string
  deliveredAt?: number
  feeRefunded: boolean
  feeRefundedAt?: number
  statusHistory: StatusHistoryEntry[]
}

export interface Product {
  id?: number
  nameEn: string
  nameAr: string
  aliases?: string[]
  manufacturer?: string
  categories: Category[]
  photo?: Blob
  verified: boolean
  notes?: string
}

export interface Presentation {
  id?: number
  productId: number
  strength?: string
  form: Form
  packSize?: string
  photo?: Blob
  fridge: boolean
  controlled: boolean
}

export interface Ingredient {
  id?: number
  nameEn: string
  nameAr?: string
  drugClass?: string
}

export interface ProductIngredient {
  id?: number
  productId: number
  ingredientId: number
}

export interface Location {
  id?: number
  name: string
  type: LocationType
  phone?: string
  notes?: string
  needsTransferSlip: boolean
}
