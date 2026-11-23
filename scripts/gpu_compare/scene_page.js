// gpu_compare.js substitutes the tree under test. The shaders here are built
// by Folly itself: both legs get the same scene shader as the image compositor.
import { scene_for } from "__REPO__/src/scene/index.js";
import { open_gpu } from "__REPO__/src/gpu/open_gpu.js";
import scene_shader from "__REPO__/src/scene/wgsl.generated.js";
import { FRAG, VERT } from "__REPO__/src/scene/glsl.generated.js";
import { shader_module } from "__REPO__/src/webgl2/shader_module.js";
import { install_gpu_effects } from "__REPO__/src/gpu/runtime.js";

const shader = shader_module(scene_shader, { frag: FRAG, vert: VERT });
const scene = scene_for(document);
const canvas = document.querySelector("canvas");
const params = new URLSearchParams(location.search);
const backend = params.get("backend");
const kind = params.get("kind");
const faults = [];
const devices = [];
const adapters = [];
const builds = [], releases = [], levels = [];
let moving = false;
const layer = () => scene.layer(document.createElement("div"));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function open(request) {
  // Omit timestamp-query to exercise the real frame-gap budget on WebGPU.
  const opened = await open_gpu(request);
  assert(opened.kind === request, `Requested ${request}, got ${opened.kind}`);
  opened.gpu.onError((error) => faults.push(`${error.code ?? ""}: ${error}; ${error.cause ?? ""}`));
  devices.push(opened.gpu);
  const { gl } = opened.gpu;
  const info = opened.gpu.gpu.adapterInfo;
  adapters.push(gl
    ? gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL)
    : `${info.vendor} ${info.architecture} ${info.description}`);
  return opened;
}
const compositor = await scene.compose(canvas, {
  backend, open_gpu: open, share: 8, levels: [0, 2], wants_frame: () => moving,
});

function image(width, height, paint) {
  const bitmap = document.createElement("canvas");
  bitmap.width = width;
  bitmap.height = height;
  paint(bitmap.getContext("2d"));
  return bitmap;
}

function image_scene() {
  const background = image(16, 16, (ctx) => {
    ctx.fillStyle = "#264071";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#fac648";
    ctx.fillRect(1, 2, 7, 12);
    ctx.fillStyle = "#dc4776";
    ctx.fillRect(9, 1, 6, 10);
  });
  const overlay = image(8, 8, (ctx) => {
    ctx.fillStyle = "rgba(73, 246, 159, 0.67)";
    ctx.fillRect(1, 1, 6, 6);
  });
  compositor.source(layer(), background, { rect: [0, 0, 192, 128] });
  compositor.backdrop(layer(), { rect: [8, 30, 100, 80], effect: "blur", radius: 4 });
  compositor.source(layer(), overlay, { rect: [44, 42, 102, 70] });
  compositor.backdrop(layer(), { rect: [98, 0, 66, 81], effect: "chroma", radius: 5 });
  compositor.backdrop(layer(), { rect: [8, 76, 180, 52], effect: "refraction", radius: 6 });
  compositor.source(layer(), background, { source_effect: "neon", rect: [8, 96, 39, 24] });
}

function program(name, bytes, mesh = false) {
  return (gpu, api) => {
    builds.push([name, devices.indexOf(gpu)]);
    const texture = gpu.device.createTexture({
      kind: "2d", size: [1, 1], format: "rgba8unorm", usage: ["texture_binding", "copy_dst"],
    });
    gpu.gpu.queue.writeTexture({ texture: texture.gpu }, new Uint8Array(bytes), {}, { width: 1, height: 1 });
    const sampler = api.sampler(gpu, { minFilter: "nearest", magFilter: "nearest" });
    const set = {
      plane: { frame: [1, 1, 3, 0], rect: [0, 0, 1, 1], effect: [1, 0, 0, 0] },
      backdrop: texture, image: texture, image_sampler: sampler,
    };
    const effect = mesh ? api.draw(gpu, { shader, vertices: 3, set }) : api.effect(gpu, shader, { set });
    return { effect, dispose() {
      releases.push([name, devices.indexOf(gpu)]);
      effect.dispose?.();
      texture.dispose();
      if (gpu.gl) gpu.gl.deleteSampler(sampler.handle);
    } };
  };
}

function field_scene() {
  const draw = (pass, { state }) => pass.draw(state.effect);
  const field_layer = layer();
  field_layer.set_order(99);
  const field = compositor.field(field_layer, {
    scale: 0.5, format: "rgba16float", build: program("field", [48, 64, 112, 255]),
    draw(pass, { state, size, now, level }) {
      if (kind === "shared") levels.push([level, ...size]);
      else assert(!pass.pass && size[0] === 96 && size[1] === 64 && now === 123 && level === 0, "wrong field pass, time or scale");
      pass.draw(state.effect);
    },
  });
  // Distinct build textures make a field that is not bound to its reader visible as black.
  compositor.plane(layer(), {
    blend: "replace", reads: [field], build: program("reader", [0, 0, 0, 255]),
    draw(pass, { state, size, reads }) {
      assert(!pass.pass && (kind === "shared" || size[0] === 192) && reads.length === 1 && reads[0].format === "rgba16float", "wrong plane pass or field texture");
      state.effect.set({ backdrop: reads[0] });
      pass.draw(state.effect);
    },
  });
  compositor.plane(layer(), { blend: "add", build: program("add", [32, 12, 4, 40], true), draw });
  compositor.plane(layer(), { blend: "over", build: program("over", [0, 32, 64, 128]), draw });
}

if (kind === "image") image_scene();
else if (kind === "planes" || kind === "shared") field_scene();
else throw new Error(`Unknown test scene ${kind}`);

let text;
let original_presenter;
let finish_old_build;
if (kind === "shared") {
  const target = document.createElement("p");
  target.className = "fx-glow";
  target.style.cssText = "margin:12px;color:white;font:24px sans-serif";
  target.textContent = "Folly in orbit";
  document.body.append(target);
  text = install_gpu_effects({ root: document, backend, open_gpu: open });
  await text.refresh();
}

async function render() {
  original_presenter ??= document.querySelector(".folly-gpu-presenter");
  await compositor.render({ now: 123 });
  const gpu = devices.at(-1);
  await gpu.settled();
  assert(!faults.length, faults.join("; "));
  return { backend: compositor.backend, stats: compositor.stats, builds, releases };
}
window.scene_test = {
  render,
  snapshot: () => ({
    opens: devices.length, backend: compositor.backend, builds, releases, levels, stats: compositor.stats,
    ready: document.querySelector(".fx-glow")?.getAttribute("data-folly-gpu-text"),
    text_backend: document.querySelector(".folly-gpu-canvas")?.dataset.follyRenderer,
    faults,
    adapters, new_presenter: original_presenter !== document.querySelector(".folly-gpu-presenter"),
  }),
  async move() {
    document.documentElement.setAttribute("data-site-fps", "1000");
    text.budget.tune({ frame_share: 0.000001 });
    moving = true;
    await render();
  },
  stop() { moving = false; },
  async hold_build() {
    const started = Promise.withResolvers();
    const pending = Promise.withResolvers();
    finish_old_build = pending.resolve;
    const build = program("pending", [1, 2, 3, 255]);
    const last = layer();
    last.set_order(100);
    compositor.field(last, {
      build(gpu, api) {
        const state = build(gpu, api);
        if (gpu !== devices[0]) return state;
        started.resolve();
        return pending.promise.then(() => state);
      },
      draw: (pass, { state }) => pass.draw(state.effect),
    });
    // The old render rejects when the page loses its device.
    void compositor.render().catch(() => {});
    await started.promise;
  },
  finish_build() { finish_old_build(); },
  async lose(index = 0) {
    const gpu = devices[index];
    if (gpu.gl) gpu.gl.getExtension("WEBGL_lose_context").loseContext();
    else gpu.gpu.destroy();
    await gpu.gpu.lost;
  },
  dispose() { compositor.dispose(); text?.dispose(); },
};
