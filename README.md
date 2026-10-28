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

The text effect CSS sets layout and fonts only.
The GPU draws all colour, glow, shadow, and motion.
Without a GPU, the text shows as plain text.
The runtime sends `folly:gpu-settled` on the document when all the effects are prepared.
A host page can show its text effects after this event.

## Page transitions

Import page transitions from `scripts-of-folly/transitions`.
A transition closes a cover over the page, changes the page, and opens the cover again.

```js
const transition = create_page_transition({ open_gpu, mode: () => "shader" });
await transition.run(() => apply_new_state());
bind_htmx_navigation(htmx, transition, { target: "#page", ready });
```

The mode can be `shader`, `fade`, or `off`.
The `shader` mode draws the cover with one WGSL shader on WebGPU or on the WebGL2 leg.
When both fail, the transition uses `fade` for the rest of the page.
Reduced motion always uses `off`.
The cover uses the page background as its paper and the page text colour as its ink.

`bind_htmx_navigation()` holds each request for the target at `htmx:confirm`.
It closes the cover, and then it sends the request.
Thus the swap occurs under a closed cover.
The request never waits longer than `max_hold_ms` (2 seconds) for the cover.
Then `close_now()` closes the cover at once on the fade sheet, and the request goes out.
It opens the cover after the swap and after `ready()` resolves.
A failed request, or a response without a swap, opens the cover on the old page.
Preload requests and requests with an `hx-confirm` question do not start a cover.

A transition never waits for the shader to compile.
Until the shader is open, transitions use the fade cover, and the shader opens in the background.
`warm()` opens the shader before the first transition.
The covered event tells which cover played: `detail.mode` is `shader` or `fade`.
The cover uses the colours of `document.body` by default.
Pass `colors: () => colors_of(element)` to use the element that holds the reading text.
The shader cover renders at half the CSS size, because it is soft noise.
The cover sends `folly:transition-covered` and `folly:transition-revealed` on the document.

The Pretext sentence transitions are at `scripts-of-folly/pretext/transitions`.
