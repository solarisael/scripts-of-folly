import { BLUR_RADII } from "./blur_levels.js";

const READY_ATTRIBUTE = "data-folly-gpu-text";
const CAPTURE_ATTRIBUTE = "data-folly-capture";
const PRETEXT_FRAGMENT_SELECTOR = ".sol__pretext_fragment";

function text_nodes(root, view) {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    view.NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return node.nodeValue && node.nodeValue.trim()
          ? view.NodeFilter.FILTER_ACCEPT
          : view.NodeFilter.FILTER_REJECT;
      },
    },
  );
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

function line_runs(node, doc) {
  const text = node.nodeValue;
  const view = doc.defaultView;
  const segmenter =
    typeof Intl?.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  const boundaries = segmenter
    ? Array.from(segmenter.segment(text), (part) => part.index).concat(
        text.length,
      )
    : Array.from({ length: text.length + 1 }, (_, index) => index);
  const probe = doc.createRange();
  const runs = [];
  let start = 0;
  let previous = null;
  for (let index = 1; index < boundaries.length; index += 1) {
    const end = boundaries[index];
    probe.setStart(node, boundaries[index - 1]);
    probe.setEnd(node, end);
    const rect = probe.getClientRects()[0];
    if (!rect) continue;
    if (previous && Math.abs(rect.top - previous.top) > 0.5) {
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, boundaries[index - 1]);
      runs.push({
        start,
        end: boundaries[index - 1],
        rect: range.getBoundingClientRect(),
      });
      start = boundaries[index - 1];
    }
    previous = rect;
  }
  if (start < text.length && previous) {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, text.length);
    runs.push({ start, end: text.length, rect: range.getBoundingClientRect() });
  }
  return runs;
}

function font_string(style) {
  return (
    style.font ||
    `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  );
}

function color(style) {
  return style.webkitTextFillColor || style.color || "rgb(0, 0, 0)";
}

function ink_color(style) {
  const fill = color(style);
  return fill === "transparent" || /rgba?\([^)]*,\s*0\s*\)$/u.test(fill)
    ? "rgba(255, 255, 255, 1)"
    : fill;
}

function display_text(value, style) {
  if (style.whiteSpace === "normal" || style.whiteSpace === "nowrap") {
    value = value.replace(/\s+/gu, " ");
  }
  if (style.textTransform === "uppercase") return value.toLocaleUpperCase();
  if (style.textTransform === "lowercase") return value.toLocaleLowerCase();
  if (style.textTransform === "capitalize")
    return value.replace(
      /(^|[\s-])(\p{L})/gu,
      (_, boundary, letter) => `${boundary}${letter.toLocaleUpperCase()}`,
    );
  return value;
}

function text_fragments(element) {
  if (element.matches(PRETEXT_FRAGMENT_SELECTOR)) return [element];
  return Array.from(element.querySelectorAll(PRETEXT_FRAGMENT_SELECTOR));
}

function draw_pretext_fragments({ element, context, bounds, inset }) {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const fragments = text_fragments(element);
  for (const fragment of fragments) {
    const raw_text = fragment.textContent || "";
    if (!raw_text.trim()) continue;

    const range = doc.createRange();
    range.selectNodeContents(fragment);
    const fragment_rect = range.getBoundingClientRect();
    if (!fragment_rect.width && !fragment_rect.height) continue;

    const style = view.getComputedStyle(fragment);
    const text = display_text(raw_text, style);
    context.font = font_string(style);
    context.fillStyle = ink_color(style);
    if ("letterSpacing" in context) {
      const letter_spacing = Number.parseFloat(style.letterSpacing);
      context.letterSpacing = Number.isFinite(letter_spacing)
        ? `${letter_spacing}px`
        : "0px";
    }

    const metrics = context.measureText(text);
    const ascent =
      metrics.fontBoundingBoxAscent || Number.parseFloat(style.fontSize) || 0;
    context.fillText(
      text,
      fragment_rect.left - bounds.left + inset,
      fragment_rect.top - bounds.top + inset + ascent,
    );
  }
  return fragments;
}

function draw_native_text({ element, context, bounds, inset, doc, view }) {
  const nodes = text_nodes(element, view);
  let first_style = null;
  for (const node of nodes) {
    const style = view.getComputedStyle(node.parentElement || element);
    if (!first_style) first_style = style;
    context.font = font_string(style);
    context.fillStyle = ink_color(style);
    if ("letterSpacing" in context) {
      const letter_spacing = Number.parseFloat(style.letterSpacing);
      context.letterSpacing = Number.isFinite(letter_spacing)
        ? `${letter_spacing}px`
        : "0px";
    }

    for (const run of line_runs(node, doc)) {
      const value = display_text(
        node.nodeValue.slice(run.start, run.end),
        style,
      );
      if (!value.trim()) continue;

      const metrics = context.measureText(value);
      const ascent =
        metrics.fontBoundingBoxAscent || Number.parseFloat(style.fontSize) || 0;
      context.fillText(
        value,
        run.rect.left - bounds.left + inset,
        run.rect.top - bounds.top + inset + ascent,
      );
    }
  }
  return first_style;
}

/** Capture settled native text ink into a reusable transparent canvas. */
export function capture_text(
  element,
  { dpr = 1, padding = 8, soft = false } = {},
) {
  if (!element || element.nodeType !== 1) return null;

  const requestedDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const inset = Number.isFinite(padding) && padding >= 0 ? padding : 0;
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const hadReady = element.hasAttribute(READY_ATTRIBUTE);
  const readyValue = element.getAttribute(READY_ATTRIBUTE);
  const hadCapture = element.hasAttribute(CAPTURE_ATTRIBUTE);
  const captureValue = element.getAttribute(CAPTURE_ATTRIBUTE);
  element.removeAttribute(READY_ATTRIBUTE);
  element.setAttribute(CAPTURE_ATTRIBUTE, "");

  try {
    const bounds = element.getBoundingClientRect();
    const width = Math.max(1, bounds.width + inset * 2);
    const height = Math.max(1, bounds.height + inset * 2);
    const canvas = doc.createElement("canvas");
    canvas.width = Math.ceil(width * requestedDpr);
    canvas.height = Math.ceil(height * requestedDpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.scale(requestedDpr, requestedDpr);
    context.textBaseline = "alphabetic";
    const fragments = text_fragments(element);
    const first_style = fragments.length
      ? (draw_pretext_fragments({ element, context, bounds, inset }),
        view.getComputedStyle(fragments[0]))
      : draw_native_text({ element, context, bounds, inset, doc, view });
    let soft_canvas = null;
    if (soft) {
      soft_canvas = doc.createElement("canvas");
      soft_canvas.width = canvas.width;
      soft_canvas.height = canvas.height * BLUR_RADII.length;
      const soft_context = soft_canvas.getContext("2d");
      if (!soft_context || !("filter" in soft_context)) return null;

      for (const [index, radius] of BLUR_RADII.entries()) {
        const top = index * canvas.height;
        soft_context.save();
        soft_context.beginPath();
        soft_context.rect(0, top, canvas.width, canvas.height);
        soft_context.clip();
        soft_context.filter = radius
          ? `blur(${radius * requestedDpr}px)`
          : "none";
        soft_context.drawImage(canvas, 0, top);
        soft_context.restore();
      }
    }

    const font_size = first_style
      ? Number.parseFloat(first_style.fontSize) || 0
      : 0;

    return {
      canvas,
      soft_canvas,
      width,
      height,
      padding: inset,
      rect: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      font_size,
      base_color: first_style ? color(first_style) : "rgba(255, 255, 255, 1)",
    };
  } finally {
    if (hadReady) element.setAttribute(READY_ATTRIBUTE, readyValue);
    else element.removeAttribute(READY_ATTRIBUTE);
    if (hadCapture) element.setAttribute(CAPTURE_ATTRIBUTE, captureValue ?? "");
    else element.removeAttribute(CAPTURE_ATTRIBUTE);
  }
}
