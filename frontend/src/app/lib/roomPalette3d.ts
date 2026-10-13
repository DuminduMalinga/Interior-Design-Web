/**
 * Colours of the 3D furniture models: the finishes they are made of, and the
 * main colour of each furniture type.
 *
 * Kept apart from the scene builder so pages can show the same colours (in a
 * legend, a list) without loading three.js.
 */

/** The finishes the models are made of. */
export const FINISH = {
  oak: "#cfa97c", oakDark: "#ad875c", walnut: "#77563c",
  white: "#f4f1eb", linen: "#e8e2d6", greige: "#bdb5a8", charcoal: "#3a3d42", black: "#1d1e21",
  sage: "#8fa48a", terracotta: "#c77b5c", blush: "#d9a59c", mustard: "#d2a54a", teal: "#5f8a87", caramel: "#b0743e",
  steel: "#dcdfe3", chrome: "#eceef0", brass: "#c9a45c", stone: "#d8d7d2", ceramic: "#fafaf6",
};

export const PALETTE: Record<string, string> = {
  sofa: FINISH.greige, loveseat: FINISH.greige, l_sofa: FINISH.greige,
  chair: FINISH.teal, reading_chair: FINISH.caramel, desk_chair: FINISH.charcoal,
  dining_chair: FINISH.blush, stool: FINISH.blush,
  coffee_table: FINISH.oak, side_table: FINISH.oak, bedside_table: FINISH.oak, dining_table: FINISH.oak,
  desk: FINISH.oak, dressing_table: FINISH.oak,
  tv: FINISH.black, tv_console: FINISH.oak, storage_cabinet: FINISH.charcoal, sideboard: FINISH.charcoal,
  dresser: FINISH.oak, bookshelf: FINISH.oak, wardrobe: FINISH.white,
  lamp: "#ffe9c4", bedside_lamp: "#ffe9c4", desk_lamp: "#ffe9c4", pendant_light: "#ffe9c4",
  ceiling_light: "#fff4dc", mirror_light: "#fff4dc",
  rug: FINISH.linen, bed: FINISH.greige,
  counter: FINISH.oak, sink: FINISH.steel, stove: FINISH.steel, utensil_drawers: FINISH.oak, fridge: FINISH.steel,
  shower: "#cfe3ea", toilet: FINISH.ceramic, washbasin: FINISH.ceramic, bathroom_cabinet: FINISH.oak,
  mirror: "#cfe0ea", towel_rail: FINISH.sage, towel_ring: FINISH.terracotta, grab_bar: FINISH.steel,
  floor_drain: "#8b8f94",
};
const DEFAULT_COLOR = "#a1a1aa";

export function furnitureColor(type: string): string {
  return PALETTE[type] ?? DEFAULT_COLOR;
}
