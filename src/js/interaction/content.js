import { IX_BASE_CLASS } from "../contract.js";
import { load_ix_fetch_content, resolve_ix_url } from "./fetch.js";

const IX_POPUP_SLOT_ID = "sol_ix_popup_slot";
const IX_PROFILES = ["float", "explanation", "compact", "reliquary"];

const is_real_navigation_link = (node_value) => {
  return (
    node_value instanceof HTMLAnchorElement && node_value.hasAttribute("href")
  );
};

const create_explanation_body = (slot_el, anchor_el) => {
  slot_el.innerHTML = "";
  const term_el = document.createElement("strong");
  term_el.className = `${IX_BASE_CLASS}_popup_term`;
  term_el.textContent = anchor_el.textContent ?? "";
  const body_el = document.createElement("div");
  body_el.className = `${IX_BASE_CLASS}_popup_explanation_body`;
  slot_el.append(term_el, body_el);
  return body_el;
};

const apply_popup_profile = (popup_el, slot_el, anchor_el) => {
  const raw_profile = anchor_el.dataset.ixProfile;
  const profile = IX_PROFILES.includes(raw_profile) ? raw_profile : null;
  for (const known_profile of IX_PROFILES) {
    popup_el.classList.toggle(
      `${IX_BASE_CLASS}_popup_profile_${known_profile}`,
      profile === known_profile,
    );
  }
  if (profile === "explanation") {
    return create_explanation_body(slot_el, anchor_el);
  }
  return slot_el;
};

const reveal_content = (payload) => {
  const reveal_target_el = payload ? document.querySelector(payload) : null;
  return reveal_target_el instanceof HTMLElement
    ? reveal_target_el.innerHTML
    : "";
};

const populate_action_content = (content_target_el, descriptor, anchor_el) => {
  if (descriptor.action === "preview") {
    content_target_el.textContent = descriptor.payload;
    return;
  }
  if (descriptor.action === "reveal") {
    content_target_el.innerHTML = reveal_content(descriptor.payload);
    return;
  }
  if (descriptor.action === "fetch") {
    // HTMX owns click navigation on this anchor; popup fetch uses a separate slot.
    load_ix_fetch_content(
      content_target_el,
      descriptor.payload,
      anchor_el.dataset.ixSelect || null,
    );
  }
};

const popup_door_href = (anchor_el) => {
  return (
    anchor_el.dataset.ixHref ||
    (is_real_navigation_link(anchor_el) ? anchor_el.getAttribute("href") : null)
  );
};

const populate_popup_door = (door_el, anchor_el, is_pinned) => {
  // A mobile peek needs a navigation door because the next tap unpins it.
  const door_href = popup_door_href(anchor_el);
  door_el.hidden = !(is_pinned && door_href);
  if (!door_el.hidden && door_href) {
    door_el.href = resolve_ix_url(door_href);
    door_el.textContent = anchor_el.dataset.ixDoorLabel || "\u2192 open";
  }
};

const populate_popup = (popup_el, descriptor, anchor_el, is_pinned) => {
  const slot_el = popup_el.querySelector(`#${IX_POPUP_SLOT_ID}`);
  const door_el = popup_el.querySelector(`.${IX_BASE_CLASS}_popup_door`);
  if (
    !(slot_el instanceof HTMLElement) ||
    !(door_el instanceof HTMLAnchorElement)
  ) {
    return;
  }

  delete slot_el.dataset.ixFetchPending;
  const content_target_el = apply_popup_profile(popup_el, slot_el, anchor_el);
  populate_action_content(content_target_el, descriptor, anchor_el);
  populate_popup_door(door_el, anchor_el, is_pinned);
};

export { IX_POPUP_SLOT_ID, is_real_navigation_link, populate_popup };
