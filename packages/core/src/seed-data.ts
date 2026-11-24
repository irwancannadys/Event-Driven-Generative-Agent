import { timeOfDay } from './time';

// Reference data for the cafe. Stored as-is in the reference tables by the server seed script.
// Quantities are integers (g, ml, pcs), times are virtual seconds, prices are rupiah.

export type Unit = 'g' | 'ml' | 'pcs';

export interface MenuItemSeed {
  id: string;
  name: string;
  price: number;
  cook_time_sec: number;
}

export interface IngredientSeed {
  id: string;
  name: string;
  unit: Unit;
  min_qty: number;
  capacity_qty: number;
  lead_time_sec: number;
  /** Stock at the start of a world. Used by `world_initialized`, not stored in `ingredients`. */
  initial_qty: number;
}

export interface RecipeItemSeed {
  menu_item_id: string;
  ingredient_id: string;
  qty_per_portion: number;
}

export interface UsualOrder {
  items: { menu_item_id: string; qty: number }[];
  note?: string;
}

export interface RegularSeed {
  id: string;
  name: string;
  usual_time_sec: number;
  favorite_table: 1 | 2 | 3;
  usual_order: UsualOrder;
  /** Visits at the start of a world. Used by `world_initialized`, not stored in `regulars`. */
  initial_visits: number;
}

export interface SupplierSeed {
  ingredient_id: string;
  weight_on_time: number;
  weight_late: number;
  weight_out: number;
  late_multiplier_pct: number;
}

export const MENU_ITEMS: MenuItemSeed[] = [
  { id: 'kopi_susu', name: 'Kopi Susu', price: 18000, cook_time_sec: 180 },
  { id: 'kopi_hitam', name: 'Kopi Hitam', price: 12000, cook_time_sec: 150 },
  { id: 'es_teh_manis', name: 'Es Teh Manis', price: 8000, cook_time_sec: 120 },
  { id: 'nasi_goreng', name: 'Nasi Goreng', price: 28000, cook_time_sec: 480 },
  { id: 'mie_goreng', name: 'Mie Goreng', price: 26000, cook_time_sec: 420 },
  { id: 'roti_bakar', name: 'Roti Bakar', price: 15000, cook_time_sec: 300 },
];

// Starting levels are rough: low enough that stock_low appears mid-day. Tuned again in stage 2.
export const INGREDIENTS: IngredientSeed[] = [
  {
    id: 'kopi',
    name: 'Kopi',
    unit: 'g',
    min_qty: 300,
    capacity_qty: 2000,
    lead_time_sec: 7200,
    initial_qty: 1200,
  },
  {
    id: 'susu',
    name: 'Susu',
    unit: 'ml',
    min_qty: 1000,
    capacity_qty: 6000,
    lead_time_sec: 7200,
    initial_qty: 2500,
  },
  {
    id: 'gula',
    name: 'Gula',
    unit: 'g',
    min_qty: 300,
    capacity_qty: 2000,
    lead_time_sec: 7200,
    initial_qty: 1200,
  },
  {
    id: 'teh',
    name: 'Teh',
    unit: 'g',
    min_qty: 100,
    capacity_qty: 500,
    lead_time_sec: 7200,
    initial_qty: 350,
  },
  {
    id: 'nasi',
    name: 'Nasi',
    unit: 'g',
    min_qty: 1000,
    capacity_qty: 8000,
    lead_time_sec: 5400,
    initial_qty: 4000,
  },
  {
    id: 'telur',
    name: 'Telur',
    unit: 'pcs',
    min_qty: 10,
    capacity_qty: 60,
    lead_time_sec: 5400,
    initial_qty: 30,
  },
  {
    id: 'roti',
    name: 'Roti',
    unit: 'pcs',
    min_qty: 10,
    capacity_qty: 60,
    lead_time_sec: 5400,
    initial_qty: 40,
  },
  {
    id: 'mie',
    name: 'Mie',
    unit: 'g',
    min_qty: 500,
    capacity_qty: 4000,
    lead_time_sec: 5400,
    initial_qty: 2000,
  },
];

export const RECIPE_ITEMS: RecipeItemSeed[] = [
  { menu_item_id: 'kopi_susu', ingredient_id: 'kopi', qty_per_portion: 18 },
  { menu_item_id: 'kopi_susu', ingredient_id: 'susu', qty_per_portion: 150 },
  { menu_item_id: 'kopi_susu', ingredient_id: 'gula', qty_per_portion: 10 },
  { menu_item_id: 'kopi_hitam', ingredient_id: 'kopi', qty_per_portion: 18 },
  { menu_item_id: 'kopi_hitam', ingredient_id: 'gula', qty_per_portion: 10 },
  { menu_item_id: 'es_teh_manis', ingredient_id: 'teh', qty_per_portion: 5 },
  { menu_item_id: 'es_teh_manis', ingredient_id: 'gula', qty_per_portion: 20 },
  { menu_item_id: 'nasi_goreng', ingredient_id: 'nasi', qty_per_portion: 200 },
  { menu_item_id: 'nasi_goreng', ingredient_id: 'telur', qty_per_portion: 1 },
  { menu_item_id: 'mie_goreng', ingredient_id: 'mie', qty_per_portion: 100 },
  { menu_item_id: 'mie_goreng', ingredient_id: 'telur', qty_per_portion: 1 },
  { menu_item_id: 'roti_bakar', ingredient_id: 'roti', qty_per_portion: 2 },
  { menu_item_id: 'roti_bakar', ingredient_id: 'gula', qty_per_portion: 10 },
];

export const REGULARS: RegularSeed[] = [
  {
    id: 'pak_budi',
    name: 'Pak Budi',
    usual_time_sec: timeOfDay(8, 30),
    favorite_table: 1,
    usual_order: { items: [{ menu_item_id: 'kopi_susu', qty: 1 }], note: 'kurang gula' },
    initial_visits: 3,
  },
  {
    id: 'bu_sari',
    name: 'Bu Sari',
    usual_time_sec: timeOfDay(12),
    favorite_table: 2,
    usual_order: { items: [{ menu_item_id: 'nasi_goreng', qty: 1 }], note: 'tanpa pedas' },
    initial_visits: 2,
  },
  {
    id: 'mas_joko',
    name: 'Mas Joko',
    usual_time_sec: timeOfDay(17),
    favorite_table: 3,
    usual_order: {
      items: [
        { menu_item_id: 'es_teh_manis', qty: 1 },
        { menu_item_id: 'roti_bakar', qty: 1 },
      ],
    },
    initial_visits: 1,
  },
];

export const SUPPLIERS: SupplierSeed[] = INGREDIENTS.map((ingredient) => ({
  ingredient_id: ingredient.id,
  weight_on_time: 70,
  weight_late: 25,
  weight_out: 5,
  late_multiplier_pct: 200,
}));

/** Stock per ingredient at the start of a world, for the `world_initialized` event. */
export const INITIAL_STOCK: Record<string, number> = Object.fromEntries(
  INGREDIENTS.map((ingredient) => [ingredient.id, ingredient.initial_qty]),
);

/** Visits per regular at the start of a world, for the `world_initialized` event. */
export const INITIAL_VISITS: Record<string, number> = Object.fromEntries(
  REGULARS.map((regular) => [regular.id, regular.initial_visits]),
);
