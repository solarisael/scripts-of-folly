// interactions.css owns the mobile bottom sheet; desktop uses anchor placement.
const IX_MOBILE_BREAKPOINT_QUERY = "(max-width: 768px)";

const ix_is_mobile_viewport = () => {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(IX_MOBILE_BREAKPOINT_QUERY).matches
  );
};

const IX_TALL_POPUP_THRESHOLD_PX = 180;

const ix_popup_placements = (
  anchor_rect,
  popup_rect,
  viewport_width,
  viewport_height,
  margin,
) => {
  const centered_left =
    anchor_rect.left + anchor_rect.width / 2 - popup_rect.width / 2;
  const centered_top =
    anchor_rect.top + anchor_rect.height / 2 - popup_rect.height / 2;

  const below = { left: centered_left, top: anchor_rect.bottom + margin };
  const above = {
    left: centered_left,
    top: anchor_rect.top - popup_rect.height - margin,
  };
  const to_the_right = { left: anchor_rect.right + margin, top: centered_top };
  const to_the_left = {
    left: anchor_rect.left - popup_rect.width - margin,
    top: centered_top,
  };

  const ordered_placements =
    popup_rect.height > IX_TALL_POPUP_THRESHOLD_PX
      ? [to_the_right, to_the_left, below, above]
      : [below, above, to_the_right, to_the_left];

  return ordered_placements.map((placement) => ({
    ...placement,
    fits:
      placement.left >= margin &&
      placement.left + popup_rect.width <= viewport_width - margin &&
      placement.top >= margin &&
      placement.top + popup_rect.height <= viewport_height - margin,
  }));
};

const position_popup_near = (popup_el, anchor_el) => {
  if (ix_is_mobile_viewport()) {
    popup_el.style.removeProperty("left");
    popup_el.style.removeProperty("top");
    return;
  }

  const anchor_rect = anchor_el.getBoundingClientRect();
  const popup_rect = popup_el.getBoundingClientRect();
  const viewport_width = window.innerWidth;
  const viewport_height = window.innerHeight;
  const margin = 8;

  const placements = ix_popup_placements(
    anchor_rect,
    popup_rect,
    viewport_width,
    viewport_height,
    margin,
  );
  const best_fit =
    placements.find((placement) => placement.fits) ?? placements[0];

  const clamped_left = Math.max(
    margin,
    Math.min(best_fit.left, viewport_width - popup_rect.width - margin),
  );
  const clamped_top = Math.max(
    margin,
    Math.min(best_fit.top, viewport_height - popup_rect.height - margin),
  );

  popup_el.style.left = `${clamped_left}px`;
  popup_el.style.top = `${clamped_top}px`;
};

export { ix_is_mobile_viewport, position_popup_near };
