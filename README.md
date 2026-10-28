# Scripts of Folly

Collection of text and overlay effects for digital books and novels.

The Drown shader uses white water with light text and black water with dark text.
This default follows the page ink for dark and light themes.
Explicit effect colors keep their colored water and pale blue highlights.

GPU effects use one shared GPU surface sized for the largest visible effect.
Each effect renders separately into this surface.
The runtime copies each result to a small canvas inside its target.
These canvases follow document scrolling, nested scrolling, fixed elements, and sticky elements between shader frames.
DOM ancestors apply clipping to the canvases.

The effect FPS setting limits rendering and canvas copies, including during scrolling.
Copies use `drawImage` without CPU pixel readback.
Copy cost increases with the visible effect area.
The runtime removes each canvas when its effect ends.
Reduced motion uses a settled frame.

Each GPU effect has one shader, written in WGSL.
On WebGPU, vgpu runs the WGSL.
Without WebGPU, the WebGL2 leg in `src/webgl2/` runs the same shader.
Naga converts the WGSL to GLSL for this leg.

After a change to a shader, run `bun run glsl:build` and commit the `glsl.generated.js` files.
This needs naga-cli 30.0.1 on PATH: `cargo install naga-cli --version 30.0.1`.
`bun run glsl:check` fails when a generated file does not match its WGSL.

The WebGL2 leg mirrors the part of the vgpu API that Folly and its host pages use.
Import it from `scripts-of-folly/webgl2`.
Pair each WGSL source with its GLSL through `shader_module()`.
A host page can pass `open_gpu(kind)` to `install_gpu_effects()`.
Then the text effects open their GPU through the page's own backend selection.
