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
