import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
} from "@chenglou/pretext/rich-inline";
import { extract_pretext_source } from "./source.js";
import { layout_shaped_pretext_lines } from "./shaped_layout.js";
import { render_pretext_lines } from "./render.js";

const PRETEXT_SELECTOR = '[data-sol-pretext="justify"]';
const HYDRATED_ATTRIBUTE = "data-sol-pretext-hydrated";
const SHAPE_ATTRIBUTE = "data-sol-pretext-shape";
const SHAPE_HYDRATED_ATTRIBUTE = "data-sol-pretext-shape-hydrated";

const generated_attribute = (name) =>
  Boolean(name) &&
  (name.startsWith("data-folly-") || name.startsWith("data-sol-pretext-"));

const GENERATED_LAYOUT_CLASSES = new Set([
  "sol__pretext_justified",
  "sol__pretext_shaped",
  "sol__pretext_transitioning",
]);

const strip_generated_classes = (value) =>
  String(value || "")
    .split(/\s+/u)
    .filter((name) => name && !GENERATED_LAYOUT_CLASSES.has(name))
    .join(" ");

const is_element = (value) => value?.nodeType === 1;
const is_root = (value) => is_element(value) && value.matches(PRETEXT_SELECTOR);

const owner_document = (value) =>
  value?.nodeType === 9 ? value : value?.ownerDocument;

const emit = (root, name) => {
  const view = root.ownerDocument.defaultView;
  if (typeof view?.CustomEvent !== "function") return;

  root.dispatchEvent(
    new view.CustomEvent(name, { bubbles: true, detail: { root } }),
  );
};

const source_cache = new WeakMap();
const last_width = new WeakMap();

const rendered_surface = (root) =>
  root.hasAttribute(HYDRATED_ATTRIBUTE) &&
  root.querySelector(".sol__pretext_line") !== null;

export const reset_pretext_source = (root, options = {}) => {
  const source = source_cache.get(root);
  if (!source) return;

  const restore = options.restore !== false;
  if (
    restore &&
    rendered_surface(root) &&
    typeof source.author_html === "string"
  ) {
    root.innerHTML = source.author_html;
    root.classList.remove("sol__pretext_justified", "sol__pretext_shaped");
    root.removeAttribute(HYDRATED_ATTRIBUTE);
    root.removeAttribute(SHAPE_HYDRATED_ATTRIBUTE);
  }

  source_cache.delete(root);
  last_width.delete(root);
};

const read_source = (root) => {
  let source = source_cache.get(root);

  if (!source) {
    if (rendered_surface(root)) return null;

    source = extract_pretext_source(root);
    source_cache.set(root, source);
  }

  return source;
};

const prepared_for = (source) => {
  const signature = source.items
    .map((item) => `${item.text}\u0000${item.font}\u0000${item.letterSpacing}`)
    .join("\u0001");

  if (!source.prepared || source.signature !== signature) {
    source.prepared = prepareRichInline(source.items);
    source.signature = signature;
  }

  return source.prepared;
};

const cursor_is_forward = (before, after) =>
  !before ||
  after.itemIndex > before.itemIndex ||
  (after.itemIndex === before.itemIndex &&
    (after.segmentIndex > before.segmentIndex ||
      (after.segmentIndex === before.segmentIndex &&
        after.graphemeIndex > before.graphemeIndex)));

const layout_plain_lines = (prepared, width) => {
  const lines = [];
  let cursor;

  while (true) {
    const range = layoutNextRichInlineLineRange(prepared, width, cursor);
    if (!range || !cursor_is_forward(cursor, range.end)) break;

    lines.push(materializeRichInlineLineRange(prepared, range));
    cursor = range.end;
  }

  return lines;
};

export const layout_pretext_root = (root) => {
  if (!is_root(root)) return false;

  const width = root.clientWidth;
  if (!Number.isFinite(width) || width <= 0) return false;

  emit(root, "folly:pretext-before-layout");
  const source = read_source(root);
  if (!source || !source.items.length) return false;

  const prepared = prepared_for(source);
  const shape = root.dataset.solPretextShape || null;
  const lines = shape
    ? layout_shaped_pretext_lines({ prepared, width, shape })
    : layout_plain_lines(prepared, width);

  render_pretext_lines({
    root,
    lines,
    metadata: source.metadata,
    width,
    shape,
  });
  last_width.set(root, width);

  return lines.length > 0;
};

const roots_in = (scope) => {
  if (!scope || typeof scope.querySelectorAll !== "function") return [];

  const roots = [];
  if (is_root(scope)) roots.push(scope);

  for (const root of scope.querySelectorAll(PRETEXT_SELECTOR)) {
    if (!roots.includes(root)) roots.push(root);
  }

  return roots;
};

export const hydrate_pretext_justification = (root = document) => {
  const roots = roots_in(root);
  let hydrated = false;

  for (const pretext_root of roots)
    hydrated = layout_pretext_root(pretext_root) || hydrated;

  return hydrated;
};

export const install_pretext = ({ root = document } = {}) => {
  const doc = owner_document(root);
  if (!doc || typeof doc.querySelectorAll !== "function") {
    return { refresh() {}, dispose() {} };
  }

  let disposed = false;
  let refresh_pending = false;
  const observed = new Set();
  const pending = new Set();

  const resize_observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          if (disposed) return;

          for (const entry of entries) {
            const target = entry.target;
            if (!is_root(target)) continue;

            const width = target.clientWidth;
            if (width > 0 && width !== last_width.get(target))
              layout_pretext_root(target);
          }
        })
      : null;

  const observe_root = (pretext_root) => {
    if (observed.has(pretext_root)) return;

    observed.add(pretext_root);
    resize_observer?.observe(pretext_root);
  };

  const schedule = (pretext_root) => {
    if (disposed || !is_root(pretext_root)) return;

    pending.add(pretext_root);
    if (refresh_pending) return;

    refresh_pending = true;
    queueMicrotask(() => {
      refresh_pending = false;
      if (disposed) return;

      for (const target of pending) {
        pending.delete(target);
        if (target.isConnected !== false) layout_pretext_root(target);
      }
    });
  };

  const refresh = (scope = root) => {
    if (disposed) return;

    for (const pretext_root of roots_in(scope)) {
      observe_root(pretext_root);
      schedule(pretext_root);
    }

    for (const pretext_root of observed) {
      if (!pretext_root.isConnected) {
        resize_observer?.unobserve(pretext_root);
        observed.delete(pretext_root);
        source_cache.delete(pretext_root);
      }
    }
  };

  const mutation_observer =
    typeof MutationObserver === "function"
      ? new MutationObserver((records) => {
          if (disposed) return;

          for (const record of records) {
            if (record.type === "childList") {
              const changed_nodes = [
                ...record.addedNodes,
                ...record.removedNodes,
              ];
              if (
                changed_nodes.length &&
                changed_nodes.every((node) =>
                  node.matches?.(".folly-gpu-canvas"),
                )
              )
                continue;
            }

            const target = is_element(record.target)
              ? record.target
              : record.target.parentElement || record.target.documentElement;
            let pretext_root =
              target?.closest?.(PRETEXT_SELECTOR) ||
              (is_root(target) ? target : null);
            if (!pretext_root) {
              for (const candidate of observed) {
                if (target?.contains?.(candidate)) {
                  pretext_root = candidate;
                  break;
                }
              }
            }

            if (pretext_root && rendered_surface(pretext_root)) {
              const own_children =
                record.type === "childList" &&
                target === pretext_root &&
                Array.from(record.addedNodes).every(
                  (node) =>
                    node.nodeType === 3 || node.matches?.(".sol__pretext_line"),
                );
              const own_root_class =
                record.type === "attributes" &&
                target === pretext_root &&
                record.attributeName === "class" &&
                strip_generated_classes(record.oldValue) ===
                  strip_generated_classes(pretext_root.className);
              if (
                own_children ||
                own_root_class ||
                (target !== pretext_root && pretext_root.contains(target))
              )
                continue;
            }
            if (
              record.type === "attributes" &&
              generated_attribute(record.attributeName)
            )
              continue;

            if (pretext_root) {
              reset_pretext_source(pretext_root);
              observe_root(pretext_root);
              schedule(pretext_root);
            }

            if (record.type === "childList") {
              for (const node of record.addedNodes) {
                if (!is_element(node)) continue;

                for (const added_root of roots_in(node)) {
                  observe_root(added_root);
                  schedule(added_root);
                }
              }
            }
          }
        })
      : null;
  mutation_observer?.observe(root, {
    attributes: true,
    attributeOldValue: true,
    childList: true,
    characterData: true,
    subtree: true,
  });

  const on_swap = (event) => {
    if (!disposed) refresh(event?.detail?.target || root);
  };
  doc.addEventListener("htmx:afterSwap", on_swap);
  doc.addEventListener("htmx:historyRestore", on_swap);

  const fonts = doc.fonts;
  const on_fonts = () => {
    for (const pretext_root of observed) {
      reset_pretext_source(pretext_root);
      schedule(pretext_root);
    }
  };
  fonts?.addEventListener?.("loadingdone", on_fonts);
  fonts?.addEventListener?.("loadingerror", on_fonts);
  Promise.resolve(fonts?.ready).then(() => {
    if (!disposed) refresh(root);
  });

  refresh(root);

  return {
    refresh(scope = root) {
      refresh(scope);
    },

    dispose() {
      if (disposed) return;

      disposed = true;
      mutation_observer?.disconnect();
      resize_observer?.disconnect();

      doc.removeEventListener("htmx:afterSwap", on_swap);
      doc.removeEventListener("htmx:historyRestore", on_swap);
      fonts?.removeEventListener?.("loadingdone", on_fonts);
      fonts?.removeEventListener?.("loadingerror", on_fonts);

      pending.clear();
      observed.clear();
    },
  };
};

export { extract_pretext_source } from "./source.js";
export { split_text_for_pretext_items } from "./source.js";
export { compute_justified_gap_extra } from "./render.js";
