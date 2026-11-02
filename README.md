# Kelpie: The Shape of Patience

<!-- public-film-portfolio -->

![Frame from the completed film](docs/preview.jpg)

[Watch/download the finished film and editable source](https://github.com/cryptokali007/kelpie-the-shape-of-patience/releases/tag/v1.0.0)


Completed film, 300 seconds at 60 fps. This repository contains the editable composition and source media; finished video exports are distributed separately.

The procedural horse in this film was authored using hosted GPT-6 Astra and integrated into the composition.

## Source and production

The composition starts at `index.html` and `film.js`; local source assets are in `assets/`. Subtitle files, when present, are editable. A package lock is included. Declared dependencies: @fontsource/cormorant-garamond 5.3.0, @fontsource/manrope 5.3.0, gsap 3.15.0, hyperframes 0.8.206, playwright 1.64.1, three 0.186.1.

Install Node.js and the locked dependencies with `npm ci`. Then use `npm run preview`, `npm run check`, or `npm run render`. The portable wrapper resolves the CLI from this project's installed, pinned HyperFrames package. Rendering also requires a compatible Chromium browser and full FFmpeg/FFprobe installation; configure these for your environment as supported by the pinned HyperFrames version. GPU support depends on the host. These commands have not yet been validated with a clean-machine production render. Ready audio is included; regenerating synthesized voice requires separately provisioned models and tooling.

Some source-generation helpers containing machine-specific paths were omitted. The composition and included source media remain unchanged.

Sui and Walrus are named as ecosystem technologies; their names and marks belong to their respective owners. See included notices and licenses for third-party components. No new blanket license is assigned to the film source.
