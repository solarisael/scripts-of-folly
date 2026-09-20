const MAX_DIMENSION = 4096;
const METRICS = [
  "width",
  "fontBoundingBoxAscent",
  "fontBoundingBoxDescent",
  "actualBoundingBoxLeft",
  "actualBoundingBoxRight",
  "actualBoundingBoxAscent",
  "actualBoundingBoxDescent",
];

const create_context = (width, height) => {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("The glyph atlas requires native OffscreenCanvas support.");
  }
  const context = new OffscreenCanvas(width, height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) {
    throw new Error("The glyph atlas could not create a Canvas2D context.");
  }
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.direction = "ltr";
  return context;
};

const validate_effects = (request) => {
  for (const name of ["glowSmall", "glowWide", "outline"]) {
    if (!Number.isFinite(request[name]) || request[name] < 0) {
      throw new Error(
        `Glyph ${String(request.key)} has invalid ${name}: ${request[name]}.`,
      );
    }
  }
};

const validate_metrics = (metrics, key) => {
  for (const name of METRICS) {
    if (!Number.isFinite(Math.fround(metrics[name]))) {
      throw new Error(
        `Glyph ${String(key)} has missing or nonfinite Canvas2D metric ${name}.`,
      );
    }
  }
  const extents = [
    metrics.width,
    metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent,
    metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
  ];
  if (extents.some((extent) => extent < 0)) {
    throw new Error(
      `Glyph ${String(key)} has invalid negative Canvas2D extents.`,
    );
  }
};

const measure_glyph = (context, request, index, scale) => {
  validate_effects(request);
  context.font = request.font;
  const metrics = context.measureText(request.text);
  validate_metrics(metrics, request.key);
  // Three blur radii cover the shadow kernel; one device pixel guards antialiasing.
  const padding =
    Math.max(3 * request.glowSmall, 3 * request.glowWide, request.outline) *
      scale +
    1;
  const left = Math.floor(-metrics.actualBoundingBoxLeft * scale - padding);
  const top = Math.floor(-metrics.actualBoundingBoxAscent * scale - padding);
  const right = Math.ceil(metrics.actualBoundingBoxRight * scale + padding);
  const bottom = Math.ceil(metrics.actualBoundingBoxDescent * scale + padding);
  const width = right - left;
  const height = bottom - top;
  if (
    !Number.isFinite(width + height) ||
    Math.max(width, height) > MAX_DIMENSION
  ) {
    throw new Error(
      `Glyph ${String(request.key)} exceeds the ${MAX_DIMENSION}px atlas limit at scale ${scale}.`,
    );
  }
  const bounds = [left / scale, top / scale, width / scale, height / scale];
  if (bounds.some((value) => !Number.isFinite(Math.fround(value)))) {
    throw new Error(
      `Glyph ${String(request.key)} has unrepresentable atlas bounds at scale ${scale}.`,
    );
  }
  return {
    request,
    index,
    width,
    height,
    bounds,
    advance: metrics.width,
    ascent: metrics.fontBoundingBoxAscent,
    descent: metrics.fontBoundingBoxDescent,
    x: 0,
    y: 0,
  };
};

const measure_glyphs = (requests, scale) => {
  const context = create_context(1, 1);
  const keys = new Set();
  return requests.map((request, index) => {
    if (keys.has(request.key)) {
      throw new Error(
        `The glyph atlas received duplicate key ${String(request.key)}.`,
      );
    }
    keys.add(request.key);
    return measure_glyph(context, request, index, scale);
  });
};

const place_shelves = (glyphs, width) => {
  let x = 0;
  let y = 0;
  let shelf_height = 0;
  for (const glyph of glyphs) {
    if (x + glyph.width > width) {
      y += shelf_height;
      x = 0;
      shelf_height = 0;
    }
    if (y + glyph.height > MAX_DIMENSION) return null;
    glyph.x = x;
    glyph.y = y;
    x += glyph.width;
    shelf_height = Math.max(shelf_height, glyph.height);
  }
  return { width, height: Math.max(1, y + shelf_height) };
};

const pack_glyphs = (glyphs) => {
  const ordered = glyphs.slice().sort((a, b) => b.height - a.height);
  let area = 0;
  let widest = 1;
  for (const glyph of ordered) {
    area += glyph.width * glyph.height;
    widest = Math.max(widest, glyph.width);
  }
  let width = Math.min(
    MAX_DIMENSION,
    Math.max(widest, Math.ceil(Math.sqrt(area))),
  );
  while (true) {
    const packed = place_shelves(ordered, width);
    if (packed) return packed;
    if (width === MAX_DIMENSION) {
      throw new Error(
        `The ${glyphs.length} glyphs cannot fit in a ${MAX_DIMENSION} × ${MAX_DIMENSION} shelf-packed atlas.`,
      );
    }
    width = Math.min(MAX_DIMENSION, width * 2);
  }
};

const paint_glyph = (context, glyph, channel, scale) => {
  const { request, bounds } = glyph;
  if (channel === 3 && request.outline === 0) return;
  context.save();
  context.beginPath();
  context.rect(
    glyph.x / scale,
    glyph.y / scale,
    glyph.width / scale,
    glyph.height / scale,
  );
  context.clip();
  context.font = request.font;
  const x = glyph.x / scale - bounds[0];
  const y = glyph.y / scale - bounds[1];
  const blur = [0, request.glowSmall, request.glowWide, 0][channel];
  // Canvas shadows ignore the current transform.
  context.shadowBlur = blur * scale;
  context.shadowColor =
    channel === 1 || channel === 2 ? "white" : "transparent";
  if (channel === 3) {
    context.lineWidth = 2 * request.outline;
    context.strokeText(request.text, x, y);
  }
  context.fillText(request.text, x, y);
  context.restore();
};

const paint_plane = (glyphs, width, height, channel, scale) => {
  const context = create_context(width, height);
  context.scale(scale, scale);
  context.fillStyle = "white";
  context.strokeStyle = "white";
  // Round joins keep the outline inside its measured padding.
  context.lineJoin = "round";
  for (const glyph of glyphs) paint_glyph(context, glyph, channel, scale);
  return context.getImageData(0, 0, width, height).data;
};

const assemble_channels = (glyphs, width, height, scale) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let channel = 0; channel < 4; channel += 1) {
    const plane = paint_plane(glyphs, width, height, channel, scale);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset + channel] = plane[offset + 3];
    }
  }
  return pixels;
};

const build_entries = (glyphs, width, height) => {
  const entries = new Map();
  const data = new Float32Array(glyphs.length * 12);
  for (const glyph of glyphs) {
    const { index, bounds, advance, ascent, descent } = glyph;
    const uv = [
      glyph.x / width,
      glyph.y / height,
      (glyph.x + glyph.width) / width,
      (glyph.y + glyph.height) / height,
    ];
    entries.set(glyph.request.key, {
      index,
      uv,
      bounds,
      advance,
      ascent,
      descent,
    });
    data.set(uv, index * 12);
    data.set(bounds, index * 12 + 4);
    data.set([advance, ascent, descent, 0], index * 12 + 8);
  }
  return { entries, data };
};

// Atlas dimensions are device pixels. Entry bounds and metrics are CSS pixels.
export const build_glyph_atlas = (requests, scale = 2) => {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("The glyph atlas scale must be a finite positive number.");
  }
  const glyphs = measure_glyphs(requests, scale);
  const { width, height } = pack_glyphs(glyphs);
  const pixels = assemble_channels(glyphs, width, height, scale);
  const { entries, data } = build_entries(glyphs, width, height);
  return { width, height, pixels, entries, data };
};
