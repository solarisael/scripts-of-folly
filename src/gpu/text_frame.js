import { LEVELS } from "./budget.js";
import { PANEL_READY_ATTRIBUTE, TEXT_READY_ATTRIBUTE } from "./markers.js";
import { effect_dpr, present_tile } from "./presentation.js";

// One atlas per scale. Keep rows inside the WebGL2 texture limit; an
// oversized tile gets its own batch, just as a single capture did.
const MAX_ATLAS_PIXELS = 4096;
const ATLAS_GAP = 2;
function pack_atlas(items, density) {
  const batches = [];
  let batch, x = 0, y = 0, row_height = 0;
  for (const item of items) {
    const width = Math.max(1, Math.ceil(item.width * density));
    const height = Math.max(1, Math.ceil(item.height * density));
    if (x && x + width > MAX_ATLAS_PIXELS) {
      x = 0;
      y += row_height + ATLAS_GAP;
      row_height = 0;
    }
    if (!batch || (y && y + height > MAX_ATLAS_PIXELS)) {
      batch = { tiles: [], width: 1, height: 1 };
      batches.push(batch);
      x = y = row_height = 0;
    }
    batch.tiles.push({ item, x, y, width, height });
    batch.width = Math.max(batch.width, x + width);
    batch.height = Math.max(batch.height, y + height);
    x += width + ATLAS_GAP;
    row_height = Math.max(row_height, height);
  }
  return batches;
}

export async function draw_text(items, renderer, budget, view, now, frame_ms, seconds, live) {
  const dpr = effect_dpr(view);
  const by_scale = new Map();
  for (const item of items) {
    if (!item.presentation || !budget.due(item, now)) continue;
    const level = budget.level_of(item);
    const marker = String(LEVELS.indexOf(level));
    if (item.target.getAttribute("data-folly-gpu-level") !== marker)
      item.target.setAttribute("data-folly-gpu-level", marker);
    if (!by_scale.has(level.scale)) by_scale.set(level.scale, []);
    by_scale.get(level.scale).push(item);
  }
  for (const [scale, group] of by_scale) {
    const density = dpr * scale;
    for (const batch of pack_atlas(group, density)) {
      renderer.resize(batch.width / density, batch.height / density, dpr, scale);
      await renderer.render(batch.tiles.map(({ item, x, y }) => {
        // A timestamp can come back before render resolves.
        budget.drawn(item, now, frame_ms, item.width * item.height * dpr * dpr, scale);
        const left = x / density, top = y / density;
        const { width, height } = item;
        return {
          handle: item.handle,
          rect: { left, top, width, height },
          clip: { left, top, right: left + width, bottom: top + height },
        };
      }), seconds, now);
      if (!live()) return false;
      for (const tile of batch.tiles) {
        if (tile.item.presentation) present_tile(tile.item, renderer.canvas, tile, dpr);
      }
    }
  }
  for (const item of items) {
    if (item.presentation) item.target.setAttribute(
      item.kind === "panel" ? PANEL_READY_ATTRIBUTE : TEXT_READY_ATTRIBUTE, "ready",
    );
  }
  return by_scale.size > 0;
}
