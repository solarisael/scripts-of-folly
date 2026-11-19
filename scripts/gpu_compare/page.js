// The test page of scripts/gpu_compare.js. The driver replaces __REPO__ with
// the Folly tree under test. The counters go in before Folly loads.
const counts = { canvases: 0, settled: 0, copies: 0 };
const create = document.createElement.bind(document);
document.createElement = (name, ...rest) => {
  if (String(name).toLowerCase() === "canvas") counts.canvases += 1;
  return create(name, ...rest);
};
const draw_image = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas.classList.contains("folly-gpu-presenter")) counts.copies += 1;
  return draw_image.apply(this, args);
};
const gl_contexts = [];
const get_offscreen = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (...args) {
  const context = get_offscreen.apply(this, args);
  if (args[0] === "webgl2" && context) gl_contexts.push(context);
  return context;
};
const gpu_devices = [];
if (globalThis.GPUAdapter) {
  const request_device = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await request_device.apply(this, args);
    gpu_devices.push(device);
    return device;
  };
}
document.addEventListener("folly:gpu-settled", () => (counts.settled += 1));

await import("__REPO__/src/css/index.css");
await import("__REPO__/src/js/index.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function hash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function snapshot() {
  const out = {};
  for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
    const element = document.getElementById(id);
    if (!element) {
      out[id] = null;
      continue;
    }
    const presenter = [...element.children].find((child) =>
      child.classList.contains("folly-gpu-presenter"),
    );
    out[id] = {
      text_ready: element.getAttribute("data-folly-gpu-text"),
      panel_ready: element.getAttribute("data-folly-gpu-panel"),
      level: element.getAttribute("data-folly-gpu-level"),
      positioned: element.hasAttribute("data-folly-positioned"),
      capture: element.hasAttribute("data-folly-capture"),
      presenter: presenter
        ? {
            width: presenter.width,
            height: presenter.height,
            css: [presenter.style.width, presenter.style.height],
            visibility: presenter.style.visibility,
            pixels: await hash(presenter.toDataURL()),
          }
        : null,
    };
  }
  const renderer = document.querySelector(".folly-gpu-canvas");
  out.renderer = renderer?.dataset.follyRenderer ?? null;
  out.presenters = document.querySelectorAll(".folly-gpu-presenter").length;
  out.counts = { ...counts };
  return out;
}

const folly = () => globalThis[Symbol.for("scripts-of-folly.gpu")];

const steps = {
  initial() {},
  text() {
    document.getElementById("a").firstChild.data = "changed glow";
  },
  outside_class() {
    document.getElementById("outside").className = "x";
  },
  outside_style() {
    document.getElementById("outside").style.color = "red";
  },
  add_node() {
    const p = document.createElement("p");
    p.id = "g";
    p.className = "fx-glow";
    p.textContent = "a new glowing paragraph";
    document.getElementById("outside").before(p);
  },
  change_effect() {
    document.getElementById("b").className = "fx-neon";
  },
  remove_node() {
    document.getElementById("e").remove();
  },
  intensity() {
    document.getElementById("c").setAttribute("data-text-fx-intensity", "2");
  },
  nested_text() {
    document.getElementById("d").firstChild.data = "nested wiggle changed";
  },
  scroll() {
    window.scrollTo(0, 12);
  },
  unclip() {
    document.getElementById("clip").style.height = "200px";
  },
  swap_event() {
    document.dispatchEvent(new CustomEvent("htmx:afterSwap"));
  },
  hide() {
    document.getElementById("c").style.display = "none";
  },
  show() {
    document.getElementById("c").style.display = "";
  },
  lose_gpu() {
    const gl = gl_contexts.at(-1);
    if (gl) gl.getExtension("WEBGL_lose_context").loseContext();
    else gpu_devices.at(-1)?.destroy();
  },
  refresh_api() {
    folly().refresh();
  },
  text_again() {
    document.getElementById("a").firstChild.data = "third glow";
  },
  dispose_api() {
    folly().dispose();
  },
  after_dispose() {
    document.getElementById("outside").className = "y";
  },
};

window.__step = async (name, settle_ms) => {
  steps[name]();
  await sleep(settle_ms);
  return snapshot();
};

// The longest gap between two animation frames while nothing recaptures.
window.__idle_gap = async () => {
  let max_gap = 0;
  let last = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    max_gap = Math.max(max_gap, now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await sleep(100);
  max_gap = 0;
  await sleep(600);
  running = false;
  return max_gap;
};

// One round recaptures every effect: the time until Folly is settled, the
// longest gap between two animation frames, and the canvases it made.
window.__bench = async (rounds) => {
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    let max_gap = 0;
    let last = performance.now();
    let running = true;
    const tick = () => {
      const now = performance.now();
      max_gap = Math.max(max_gap, now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await sleep(50);
    max_gap = 0;
    const settled = new Promise((resolve) =>
      document.addEventListener("folly:gpu-settled", resolve, { once: true }),
    );
    const canvases = counts.canvases;
    const start = performance.now();
    document.dispatchEvent(new CustomEvent("htmx:afterSwap"));
    await settled;
    const settle_ms = performance.now() - start;
    await sleep(50);
    running = false;
    results.push({ settle_ms, max_gap, canvases: counts.canvases - canvases });
    await sleep(150);
  }
  return results;
};
// A capture is stale when a full recapture of the same DOM gives another
// picture. Each round changes the intensity of #c: the attribute first, then
// the hydration writes a style variable one animation frame later.
window.__stale = async (rounds, wait_ms) => {
  const pixels = async (id) => (await snapshot())[id]?.presenter?.pixels;
  let stale = 0;
  for (let round = 0; round < rounds; round += 1) {
    document
      .getElementById("c")
      .setAttribute("data-text-fx-intensity", String(1.5 + (round % 5) * 0.5));
    await sleep(wait_ms);
    const seen = [await pixels("c"), await pixels("d")];
    document.dispatchEvent(new CustomEvent("htmx:afterSwap"));
    await sleep(wait_ms);
    const truth = [await pixels("c"), await pixels("d")];
    if (seen[0] !== truth[0] || seen[1] !== truth[1]) stale += 1;
  }
  return stale;
};
window.__snapshot = snapshot;
window.__counts = counts;
window.__ready = true;
