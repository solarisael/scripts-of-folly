const sync_viewport_breakout = (banner) => {
  if (!banner.classList.contains("sol__vision_banner_page_top")) return;
  const current_shift =
    Number.parseFloat(
      banner.style.getPropertyValue("--vision-viewport-shift"),
    ) || 0;
  const banner_rect = banner.getBoundingClientRect();
  const unshifted_left = banner_rect.left - current_shift;
  const centered_left = (window.innerWidth - banner_rect.width) * 0.5;
  const next_shift = centered_left - unshifted_left;
  if (Math.abs(next_shift - current_shift) > 0.5) {
    banner.style.setProperty(
      "--vision-viewport-shift",
      `${next_shift.toFixed(2)}px`,
    );
  }
};

export const observe_banner_viewport = (
  banner,
  state,
  listener_cleanups,
  is_alive,
  dispose,
  refresh_texture,
  dom_image,
) => {
  const handle_banner_resize = () => {
    if (!is_alive()) {
      dispose();
      return;
    }
    sync_viewport_breakout(banner);
    refresh_texture(dom_image);
  };
  if (typeof ResizeObserver === "function") {
    state.breakout_observer = new ResizeObserver(handle_banner_resize);
    state.breakout_observer.observe(banner.parentElement ?? banner);
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", handle_banner_resize, {
      passive: true,
    });
    listener_cleanups.push(() =>
      window.removeEventListener("resize", handle_banner_resize),
    );
  }
  sync_viewport_breakout(banner);
};
