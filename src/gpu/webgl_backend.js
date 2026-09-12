import * as THREE from "three/webgpu";
import { create_effect_material } from "./material.js";

function dispose_renderer(renderer) {
  try {
    renderer?.dispose?.();
  } catch {
    // Three owns backend teardown and may already have released the context.
  }
}

export async function create_webgl_backend(canvas, options = {}) {
  const { is_alive = () => true, on_lost = () => {} } = options;
  const renderer = new THREE.WebGPURenderer({
    canvas,
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    forceWebGL: true,
  });

  try {
    await renderer.init();
    if (!is_alive())
      throw new Error("WebGL backend became stale during initialization");
    if (!renderer.backend?.isWebGLBackend) {
      throw new Error("Forced WebGL2 backend did not initialize as WebGL2");
    }
  } catch (error) {
    dispose_renderer(renderer);
    throw error;
  }

  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = false;
  renderer.setClearColor(0, 0);
  renderer.setScissorTest(false);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 10);
  camera.position.z = 1;
  const handles = new Set();
  let width = 1;
  let height = 1;
  let dpr = 1;
  let disposed = false;

  const context_lost = (event) => {
    event.preventDefault?.();
    on_lost(event instanceof Error ? event : new Error("WebGL context lost"));
  };
  canvas.addEventListener?.("webglcontextlost", context_lost, false);

  function resize(next_width, next_height, next_dpr = 1) {
    if (disposed) return;
    width = Math.max(1, Number(next_width) || 1);
    height = Math.max(1, Number(next_height) || 1);
    dpr = Math.max(1, Number(next_dpr) || 1);
    camera.left = 0;
    camera.right = width;
    camera.top = height;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  }

  async function prepare(
    captured,
    effect_names,
    parameter_sets,
    kind = "text",
  ) {
    if (disposed || !is_alive()) return null;
    let texture;
    let built;
    let geometry;
    try {
      const source =
        captured?.canvas ??
        Object.assign(canvas.ownerDocument.createElement("canvas"), {
          width: 1,
          height: 1,
        });
      texture = new THREE.CanvasTexture(source);
      texture.colorSpace = THREE.NoColorSpace;
      built = create_effect_material(texture, effect_names, parameter_sets);
      geometry = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geometry, built.material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      const handle = {
        kind,
        mesh,
        material: built.material,
        texture,
        geometry,
        time: built.time,
        width: captured?.width ?? 1,
        height: captured?.height ?? 1,
        disposed: false,
        dispose() {
          if (handle.disposed) return;
          handle.disposed = true;
          handles.delete(handle);
          scene.remove(mesh);
          built.dispose();
          geometry.dispose();
          texture.dispose();
        },
      };
      handles.add(handle);
      return handle;
    } catch (error) {
      built?.dispose?.();
      geometry?.dispose?.();
      texture?.dispose?.();
      throw error;
    }
  }

  async function render(entries, time_seconds = 0) {
    if (disposed || !is_alive()) return;
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    for (const handle of handles) handle.mesh.visible = false;
    for (const entry of entries ?? []) {
      const handle = entry?.handle;
      if (!handle || handle.disposed) continue;
      const rect = entry.rect ?? {};
      const clip = entry.clip ?? {
        left: rect.left,
        top: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      };
      const left = Math.max(0, Math.min(width, Number(clip.left) || 0));
      const top = Math.max(0, Math.min(height, Number(clip.top) || 0));
      const right = Math.max(left, Math.min(width, Number(clip.right) || 0));
      const bottom = Math.max(top, Math.min(height, Number(clip.bottom) || 0));
      if (right <= left || bottom <= top) continue;
      const mesh = handle.mesh;
      mesh.position.set(
        (Number(rect.left) || 0) + (Number(rect.width) || 0) / 2,
        height - ((Number(rect.top) || 0) + (Number(rect.height) || 0) / 2),
        0,
      );
      mesh.scale.set(
        Math.max(0, Number(rect.width) || 0),
        Math.max(0, Number(rect.height) || 0),
        1,
      );
      handle.time.value = Number(time_seconds) || 0;
      mesh.visible = true;
      renderer.setScissor(
        left,
        top,
        Math.max(1, right - left),
        Math.max(1, bottom - top),
      );
      renderer.render(scene, camera);
      mesh.visible = false;
    }
    renderer.setScissorTest(false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener?.("webglcontextlost", context_lost, false);
    for (const handle of [...handles]) handle.dispose();
    renderer.setScissorTest(false);
    dispose_renderer(renderer);
  }

  return {
    canvas,
    backend: "webgl2",
    resize,
    prepare,
    render,
    dispose,
  };
}
