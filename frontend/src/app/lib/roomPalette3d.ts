/**
 * Surface colours of the 3D furniture models, by furniture type.
 *
 * Kept apart from the scene builder so pages can show the same colours (in a
 * legend, a list) without loading three.js.
 */

export const PALETTE: Record<string, string> = {
  sofa: "#5f8f8b", loveseat: "#5f8f8b", l_sofa: "#5f8f8b",
  chair: "#5b7fa6", reading_chair: "#7a6aa8", desk_chair: "#475569", dining_chair: "#8a6f52", stool: "#8a6f52",
  coffee_table: "#b08455", side_table: "#b08455", bedside_table: "#b08455", dining_table: "#a97c50",
  desk: "#c19a6b", dressing_table: "#c19a6b",
  tv: "#111827", tv_console: "#6b4f3a", storage_cabinet: "#8b6b4a", sideboard: "#8b6b4a", dresser: "#8b6b4a",
  bookshelf: "#8b6b4a", wardrobe: "#9a7b5b",
  lamp: "#fde68a", bedside_lamp: "#fde68a", desk_lamp: "#fde68a", pendant_light: "#fde68a",
  ceiling_light: "#fef3c7", mirror_light: "#fef3c7",
  rug: "#b97a7a", bed: "#8b6b4a",
  counter: "#d4d4d8", sink: "#d4d4d8", stove: "#d4d4d8", utensil_drawers: "#d4d4d8", fridge: "#cbd5e1",
  shower: "#e2e8f0", toilet: "#f8fafc", washbasin: "#f8fafc", bathroom_cabinet: "#a3b8c2",
  mirror: "#bfdbfe", towel_rail: "#d6a87c", towel_ring: "#d6a87c", grab_bar: "#cbd5e1", floor_drain: "#52525b",
};
const DEFAULT_COLOR = "#a1a1aa";

export function furnitureColor(type: string): string {
  return PALETTE[type] ?? DEFAULT_COLOR;
}
