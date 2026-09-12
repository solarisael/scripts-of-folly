// Layout supplies the deployment base. Resolve it only when a URL needs it.
const resolve_ix_base_path = () => {
  if (typeof document === "undefined") {
    return "";
  }
  const raw_base = document.documentElement?.dataset?.basePath ?? "";
  return raw_base.replace(/\/+$/, "");
};

const resolve_ix_url = (raw_url) => {
  if (!raw_url.startsWith("/") || raw_url.startsWith("//")) {
    return raw_url;
  }

  const ix_site_base_path = resolve_ix_base_path();
  if (
    !ix_site_base_path ||
    raw_url === ix_site_base_path ||
    raw_url.startsWith(`${ix_site_base_path}/`) ||
    raw_url.startsWith(`${ix_site_base_path}?`) ||
    raw_url.startsWith(`${ix_site_base_path}#`)
  ) {
    return raw_url;
  }

  return `${ix_site_base_path}${raw_url}`;
};

// fetch action: dependency-free (plain fetch + DOMParser, no htmx.ajax) so
// this engine stays copy-paste portable per the vendor README — a host
// page without HTMX still gets working fetch-preview popups. Page-lifetime
// cache keyed by URL means a URL is only ever fetched once, hover it as
// many times as you like; `ix_fetch_prefetch(...)` (called from
// bind_ix_node below) warms that same cache during browser idle time so
// the first real hover is often already a cache hit.
const ix_fetch_cache = new Map();

const extract_selected_fragment = (html_text, select_value) => {
  if (!select_value) {
    return html_text;
  }

  const parsed_document = new DOMParser().parseFromString(
    html_text,
    "text/html",
  );
  const selected_el = parsed_document.querySelector(select_value);

  return selected_el instanceof HTMLElement ? selected_el.innerHTML : html_text;
};

const ix_fetch_fragment = async (raw_url_value, select_value) => {
  const url_value = resolve_ix_url(raw_url_value);
  const cache_key = `${url_value}\u0000${select_value ?? ""}`;

  if (ix_fetch_cache.has(cache_key)) {
    return ix_fetch_cache.get(cache_key);
  }

  const fetch_promise = fetch(url_value)
    .then((response_value) => response_value.text())
    .then((html_text) => extract_selected_fragment(html_text, select_value));

  // Cache the in-flight promise, not just the eventual value — two triggers
  // racing for the same URL (hover + idle-prefetch, or two triggers sharing
  // a target) share one network request instead of firing two.
  ix_fetch_cache.set(cache_key, fetch_promise);

  try {
    return await fetch_promise;
  } catch (fetch_error) {
    ix_fetch_cache.delete(cache_key);
    throw fetch_error;
  }
};

const ix_fetch_prefetch = (url_value, select_value) => {
  ix_fetch_fragment(url_value, select_value).catch(() => {
    // Idle prefetch is a courtesy, not a promise — a real hover will retry
    // and surface the failure state normally.
  });
};

const load_ix_fetch_content = (slot_el, url_value, select_value) => {
  slot_el.dataset.ixFetchUrl = url_value;
  slot_el.dataset.ixFetchPending = "true";

  ix_fetch_fragment(url_value, select_value)
    .then((fragment_html) => {
      // The user may have moved to a different trigger while this was in
      // flight — only paint if this slot is still showing the request we
      // started (the shared popup slot has no other way to know).
      if (slot_el.dataset.ixFetchUrl !== url_value) {
        return;
      }

      slot_el.innerHTML = fragment_html;
      delete slot_el.dataset.ixFetchPending;
    })
    .catch(() => {
      if (slot_el.dataset.ixFetchUrl !== url_value) {
        return;
      }

      slot_el.textContent = "couldn't load this.";
      delete slot_el.dataset.ixFetchPending;
    });
};

export { ix_fetch_prefetch, load_ix_fetch_content, resolve_ix_url };
