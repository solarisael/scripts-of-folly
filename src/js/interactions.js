// This module owns the page's active popup, pin state, timers, and listeners.
import { IX_BASE_CLASS, parse_ix_descriptor } from "./contract.js";
import {
  ix_is_mobile_viewport,
  position_popup_near,
} from "./interaction/placement.js";
import { ix_fetch_prefetch } from "./interaction/fetch.js";
import {
  IX_POPUP_SLOT_ID,
  is_real_navigation_link,
  populate_popup,
} from "./interaction/content.js";

const IX_POPUP_ID = "sol_ix_popup";
const IX_HIDE_DELAY_MS = 120;

const window_any = /** @type {any} */ (globalThis);

let active_trigger_el = null;
let is_pinned = false;
let hide_timer_id = null;

const clear_hide_timer = () => {
  if (hide_timer_id !== null) {
    clearTimeout(hide_timer_id);
    hide_timer_id = null;
  }
};

const ensure_popup_el = () => {
  const existing_popup_el = document.getElementById(IX_POPUP_ID);

  if (existing_popup_el instanceof HTMLElement) {
    return existing_popup_el;
  }

  const popup_el = document.createElement("div");
  popup_el.id = IX_POPUP_ID;
  popup_el.className = `${IX_BASE_CLASS}_popup`;
  popup_el.hidden = true;
  popup_el.setAttribute("role", "tooltip");

  const ring_el = document.createElement("div");
  ring_el.className = `${IX_BASE_CLASS}_popup_ring`;

  const slot_el = document.createElement("div");
  slot_el.id = IX_POPUP_SLOT_ID;
  slot_el.className = `${IX_BASE_CLASS}_popup_slot`;

  const door_el = document.createElement("a");
  door_el.className = `${IX_BASE_CLASS}_popup_door`;
  door_el.hidden = true;

  popup_el.append(ring_el, slot_el, door_el);
  document.body.append(popup_el);

  popup_el.addEventListener("mouseenter", clear_hide_timer);
  popup_el.addEventListener("mouseleave", () => schedule_hide());

  return popup_el;
};

const schedule_hide = () => {
  clear_hide_timer();

  if (is_pinned) {
    return;
  }

  hide_timer_id = setTimeout(() => hide_popup(), IX_HIDE_DELAY_MS);
};

const hide_popup = () => {
  if (is_pinned) {
    return;
  }

  const popup_el = document.getElementById(IX_POPUP_ID);

  if (popup_el instanceof HTMLElement) {
    popup_el.hidden = true;
  }

  active_trigger_el = null;
};

const show_popup_for = (anchor_el, descriptor) => {
  clear_hide_timer();

  const popup_el = ensure_popup_el();
  active_trigger_el = anchor_el;
  popup_el.hidden = false;
  popup_el.classList.toggle(`${IX_BASE_CLASS}_popup_pinned`, is_pinned);
  populate_popup(popup_el, descriptor, anchor_el, is_pinned);
  position_popup_near(popup_el, anchor_el);
};

const pin_popup = (anchor_el, descriptor) => {
  is_pinned = true;
  show_popup_for(anchor_el, descriptor);
};

const unpin_popup = () => {
  is_pinned = false;

  const popup_el = document.getElementById(IX_POPUP_ID);

  if (popup_el instanceof HTMLElement) {
    popup_el.classList.remove(`${IX_BASE_CLASS}_popup_pinned`);
  }

  schedule_hide();
};

const bind_ix_node = (node_value) => {
  if (!(node_value instanceof HTMLElement)) {
    return;
  }

  if (node_value.dataset.ixHydrated === "true") {
    return;
  }

  const descriptor = parse_ix_descriptor(node_value.dataset.ix ?? "");

  if (!descriptor) {
    return;
  }

  node_value.dataset.ixHydrated = "true";
  node_value.classList.add(IX_BASE_CLASS);

  if (descriptor.action === "fetch") {
    const prefetch_url = descriptor.payload;
    const prefetch_select = node_value.dataset.ixSelect || null;
    const schedule_idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : setTimeout;

    schedule_idle(() => ix_fetch_prefetch(prefetch_url, prefetch_select));
  }
  if (descriptor.trigger === "hover") {
    node_value.addEventListener("mouseenter", () =>
      show_popup_for(node_value, descriptor),
    );
    node_value.addEventListener("mouseleave", () => schedule_hide());
    node_value.addEventListener("focus", () =>
      show_popup_for(node_value, descriptor),
    );
    node_value.addEventListener("blur", () => schedule_hide());
  }

  node_value.addEventListener("click", (click_event) => {
    if (
      descriptor.trigger === "hover" &&
      is_real_navigation_link(node_value) &&
      !ix_is_mobile_viewport()
    ) {
      // Native navigation wins for real links; the preview was just a hint.
      return;
    }

    // Mobile links reach the same pin toggle; the popup door owns navigation.

    click_event.preventDefault();

    if (is_pinned && active_trigger_el === node_value) {
      unpin_popup();
      return;
    }

    pin_popup(node_value, descriptor);
  });
};

const find_ix_nodes = (root_node = document) => {
  if (!root_node || typeof root_node.querySelectorAll !== "function") {
    return [];
  }

  return Array.from(root_node.querySelectorAll("[data-ix]"));
};

const hydrate_interactions = (root_node = document) => {
  find_ix_nodes(root_node).forEach(bind_ix_node);
};

if (typeof document !== "undefined" && !window_any.__ix_global_dismiss_bound) {
  document.addEventListener("click", (click_event) => {
    if (!is_pinned) {
      return;
    }

    const popup_el = document.getElementById(IX_POPUP_ID);
    const click_target = click_event.target;

    if (popup_el instanceof HTMLElement && popup_el.contains(click_target)) {
      return;
    }

    if (
      active_trigger_el instanceof HTMLElement &&
      active_trigger_el.contains(click_target)
    ) {
      return;
    }

    unpin_popup();
  });

  document.addEventListener("keydown", (key_event) => {
    if (is_pinned && key_event.key === "Escape") {
      unpin_popup();
    }
  });

  window_any.__ix_global_dismiss_bound = true;
}

export { hydrate_interactions };
