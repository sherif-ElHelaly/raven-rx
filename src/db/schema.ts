import Dexie, { type EntityTable } from 'dexie'
import type {
  Ingredient,
  Item,
  Location,
  Person,
  Presentation,
  Product,
  ProductIngredient,
  Request,
} from './types'

export class SarfDB extends Dexie {
  people!: EntityTable<Person, 'id'>
  requests!: EntityTable<Request, 'id'>
  items!: EntityTable<Item, 'id'>
  products!: EntityTable<Product, 'id'>
  presentations!: EntityTable<Presentation, 'id'>
  ingredients!: EntityTable<Ingredient, 'id'>
  productIngredients!: EntityTable<ProductIngredient, 'id'>
  locations!: EntityTable<Location, 'id'>

  constructor(name = 'sarf') {
    super(name)

    this.version(1).stores({
      people: '++id, cardNumber, name',
      requests: '++id, personId, createdAt, nextDueDate',
      items: '++id, requestId, presentationId, status',
      products: '++id, nameEn, nameAr, verified',
      presentations: '++id, productId, form',
      ingredients: '++id, nameEn',
      productIngredients: '++id, productId, ingredientId',
      locations: '++id, name, type',
    })
  }
}

export const db = new SarfDB()
