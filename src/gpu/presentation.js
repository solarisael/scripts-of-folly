// The presenter of an effect: a small 2D canvas inside the target. It shows
// the last picture that the shared GPU surface drew for this effect.
import { is_internal_node } from "./targets.js";

// Device pixels for each CSS pixel of a capture and of its presenter.
export function effect_dpr(view) {
  return Math.min(1.5, Math.max(1, view.devicePixelRatio || 1));
}

// Adds a presenter to `target`. Null when the target cannot hold one.
export function create_presentation(target, width, height) {
  const document_value = target.ownerDocument;
  const view = document_value.defaultView;
  const canvas = document_value.createElement("canvas");
  const needs_position_marker = !target.hasAttribute("data-folly-positioned");
  const needs_position = view.getComputedStyle(target).position === "static";
  if (
    needs_position &&
    [...target.querySelectorAll("*")].some(
      (descendant) =>
        !is_internal_node(descendant) &&
        view.getComputedStyle(descendant).position === "absolute",
    )
  )
    return null;
  if (needs_position) target.setAttribute("data-folly-positioned", "");
  canvas.className = "folly-gpu-presenter";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = "50%";
  canvas.style.top = "50%";
  canvas.style.transform = "translate(-50%, -50%)";
  target.append(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    if (needs_position && needs_position_marker)
      target.removeAttribute("data-folly-positioned");
    return null;
  }
  return {
    canvas,
    context,
    owns_position: needs_position && needs_position_marker,
  };
}

export function dispose_presentation(item) {
  const presentation = item.presentation;
  if (!presentation) return;
  presentation.canvas.remove();
  const { target } = item;
  if (presentation.owns_position)
    target.removeAttribute("data-folly-positioned");
  item.presentation = null;
}

// False when the item has no presenter, or the page removed the presenter
// from its target.
export function presentation_is_attached(item) {
  return item.presentation?.canvas.parentNode === item.target;
}

export function hide_presentation(item) {
  if (item?.presentation) item.presentation.canvas.style.visibility = "hidden";
}

// Copies the tile of `item` from the GPU surface to its presenter. The tile
// is in device pixels of the surface. The copy keeps the full size, so a
// lower render scale is drawn larger.
export function present_tile(item, source_canvas, tile, dpr) {
  const { canvas, context } = item.presentation;
  const full_width = Math.max(1, Math.ceil(item.width * dpr));
  const full_height = Math.max(1, Math.ceil(item.height * dpr));
  if (canvas.width !== full_width || canvas.height !== full_height) {
    canvas.width = full_width;
    canvas.height = full_height;
  }
  context.clearRect(0, 0, full_width, full_height);
  context.drawImage(
    source_canvas,
    tile.x,
    tile.y,
    tile.width,
    tile.height,
    0,
    0,
    full_width,
    full_height,
  );
  canvas.style.width = `${item.width}px`;
  canvas.style.height = `${item.height}px`;
  canvas.style.visibility = "visible";
}
