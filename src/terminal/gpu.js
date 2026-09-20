import terminal_source from "./terminal_shader.js";
import { build_glyph_atlas } from "./glyph_atlas.js";

const PIXEL_TIERS = [
  { area: 1000000, budget: 98304 },
  { area: 3000000, budget: 163840 },
  { area: 8500000, budget: 262144 },
  { area: Infinity, budget: 524288 },
];

const normalize_glyphs = (glyphs) => {
  if (!Array.isArray(glyphs) || glyphs.length === 0) {
    throw new Error("The Terminal renderer requires at least one glyph.");
  }

  return glyphs.map((glyph, index) => {
    const source = typeof glyph === "string" ? { text: glyph } : glyph;
    const text = String(source?.text ?? "");
    const font = String(source?.font ?? "18px ui-monospace, monospace");
    if (!text) {
      throw new Error(`Terminal glyph ${index} has no text.`);
    }

    return {
      key: String(source?.key ?? `terminal-glyph-${index}`),
      text,
      font,
      glowSmall: Number(source?.glowSmall ?? 1),
      glowWide: Number(source?.glowWide ?? 3),
      outline: Number(source?.outline ?? 0.5),
    };
  });
};

const load_glyph_fonts = async (requests) => {
  const samples_by_font = new Map();
  for (const request of requests) {
    samples_by_font.set(
      request.font,
      `${samples_by_font.get(request.font) ?? ""}${request.text}`,
    );
  }

  await Promise.all(
    Array.from(samples_by_font, ([font, sample]) =>
      document.fonts.load(font, sample),
    ),
  );
  await document.fonts.ready;
};

const terminal_pixel_budget = (resolution) => {
  const width = Math.max(resolution[0], 1);
  const height = Math.max(resolution[1], 1);
  const area = width * height;
  const tier = PIXEL_TIERS.find((candidate) => area <= candidate.area);
  return Math.min(area, tier.budget);
};

const resize_surface = (surface, resolution, pixel_budget) => {
  const width = Math.max(resolution[0], 1);
  const height = Math.max(resolution[1], 1);
  const scale = Math.min(
    1,
    Math.sqrt(pixel_budget / (width * height)),
    pixel_budget / width,
    pixel_budget / height,
  );
  const render_width = Math.max(1, Math.floor(width * scale));
  const render_height = Math.max(1, Math.floor(height * scale));

  if (surface.size[0] !== render_width || surface.size[1] !== render_height) {
    surface.resize([render_width, render_height]);
  }
};

export const create_terminal_gpu = async (
  canvas,
  { glyphs, on_error = () => {}, on_state = () => {} },
) => {
  const glyph_requests = normalize_glyphs(glyphs);
  const [api, { StorageBuffer }] = await Promise.all([
    import("vgpu"),
    import("vgpu/core"),
    load_glyph_fonts(glyph_requests),
  ]);
  const atlas = build_glyph_atlas(glyph_requests);
  let gpu = null;
  let surface = null;
  let shader = null;
  let entries = null;
  let glyph_texture = null;
  let remove_error = null;
  let disposed = false;
  let failure = null;

  const dispose = () => {
    if (disposed) return;

    disposed = true;
    remove_error?.();
    remove_error = null;
    entries?.dispose();
    entries = null;
    glyph_texture?.dispose();
    glyph_texture = null;
    surface?.dispose();
    surface = null;
    gpu?.dispose();
    gpu = null;
    shader = null;
  };

  const fail = (error) => {
    if (disposed || failure) return;

    failure = error;
    dispose();
    on_error(error);
  };

  try {
    on_state("initializing");
    gpu = await api.init();
    on_state("context");
    remove_error = gpu.onError(fail);
    gpu.gpu.lost.then(fail);
    surface = api.surface(gpu, canvas, {
      autoResize: false,
      size: [1, 1],
      alphaMode: "premultiplied",
      clearColor: [0, 0, 0, 0],
    });
    entries = new StorageBuffer(gpu.device, {
      size: atlas.data.byteLength,
      label: "folly-terminal-glyph-metrics",
      visibility: GPUShaderStage.FRAGMENT,
    });
    entries.write(atlas.data);
    glyph_texture = gpu.device.createTexture({
      size: [atlas.width, atlas.height],
      format: "rgba8unorm",
      usage: ["texture_binding", "copy_dst"],
      label: "folly-terminal-glyph-atlas",
    });
    gpu.gpu.queue.writeTexture(
      { texture: glyph_texture.gpu },
      atlas.pixels,
      { bytesPerRow: atlas.width * 4, rowsPerImage: atlas.height },
      { width: atlas.width, height: atlas.height },
    );
    on_state("surface");
    shader = api.effect(gpu, terminal_source, {
      label: "folly-terminal",
      set: {
        window: {
          resolution: [1, 1],
          time: 0,
          intensity: 1,
          motion: 1,
          scheme: 0,
          seed: 0,
          rune_count: atlas.entries.size,
          frame_inset: [16, 16],
          halo_radius: 12,
          frame_radius: 6,
        },
        entries,
        glyph_texture,
        glyph_sampler: api.sampler(gpu, {
          minFilter: "linear",
          magFilter: "linear",
        }),
      },
    });
    on_state("compiling");
    await shader.compile({
      colors: [navigator.gpu.getPreferredCanvasFormat()],
    });
    on_state("ready");

    if (failure) throw failure;

    return {
      rune_count: atlas.entries.size,
      render(values) {
        if (disposed) throw new Error("The Terminal renderer is disposed.");

        resize_surface(
          surface,
          values.resolution,
          terminal_pixel_budget(values.resolution),
        );
        shader.set({ window: values });
        api.frame(gpu, (frame) => frame.pass(surface, shader));
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
};
