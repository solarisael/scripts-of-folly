// Whether a GPU effect is on screen. These functions read layout and style,
// and keep no state.

function finite_rect(rect) {
  return (
    rect &&
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
  );
}

function clipping_overflow(style) {
  return [style.overflow, style.overflowX, style.overflowY].some(
    (value) =>
      value === "hidden" ||
      value === "clip" ||
      value === "scroll" ||
      value === "auto",
  );
}

function is_hidden(style) {
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  );
}

function viewport_size(document_value, view) {
  return {
    width: Math.max(
      1,
      view.innerWidth || document_value.documentElement.clientWidth || 1,
    ),
    height: Math.max(
      1,
      view.innerHeight || document_value.documentElement.clientHeight || 1,
    ),
  };
}

// The part of `item` that the viewport and its clipping ancestors show, in
// viewport pixels. Null when nothing shows.
export function visible_clip(item, document_value, view) {
  if (document_value.visibilityState === "hidden") return null;

  const target = item.target;
  if (is_hidden(view.getComputedStyle(target))) return null;

  const target_rect = target.getBoundingClientRect();
  const rect = {
    left: target_rect.left + (target_rect.width - item.width) / 2,
    top: target_rect.top + (target_rect.height - item.height) / 2,
    right: target_rect.left + (target_rect.width - item.width) / 2 + item.width,
    bottom:
      target_rect.top + (target_rect.height - item.height) / 2 + item.height,
    width: item.width,
    height: item.height,
  };
  if (!finite_rect(rect) || rect.width <= 0 || rect.height <= 0) return null;

  const viewport = viewport_size(document_value, view);
  const clip = {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(viewport.width, rect.right),
    bottom: Math.min(viewport.height, rect.bottom),
  };
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== document_value.documentElement) {
    const ancestor_style = view.getComputedStyle(ancestor);
    if (is_hidden(ancestor_style)) return null;
    if (clipping_overflow(ancestor_style)) {
      const ancestor_rect = ancestor.getBoundingClientRect();
      clip.left = Math.max(clip.left, ancestor_rect.left);
      clip.top = Math.max(clip.top, ancestor_rect.top);
      clip.right = Math.min(clip.right, ancestor_rect.right);
      clip.bottom = Math.min(clip.bottom, ancestor_rect.bottom);
    }
    ancestor = ancestor.parentElement;
  }
  if (clip.right <= clip.left || clip.bottom <= clip.top) return null;

  return clip;
}
