# TODO

## Core Behavior:
- ✅ **Agent Steering:** ~~Trails are currently straight. They must be made organic and curved by implementing a blended steering model ("slime mold" behavior) where agents are influenced by both their target and existing trails.~~ **DONE** - Core parameters can be tweaked in:
  - `src/shaders/agentUpdate.frag` line 73: `attractionWeight = 0.03` (lower = more trail-following)
  - `src/systems/GPUSystem.ts` line 293: `uTurnStrength = 0.15` (higher = sharper turns)
  - `src/systems/GPUSystem.ts` lines 291-292: sensor distance & angle for trail detection
= **Trail Hierarchy:** Ecosystem agents are currently creating faint trails. This is incorrect. Only Frontier agents will be allowed to create trails.
- **Agent Cleanup:** Agents currently live for their full lifespan. They must now also be removed ("die") when they reach their target destination.
- **Particle Rendering:** The large, yellow square particles are a visual bug. They will be replaced with the "starfield" system: all 2744 projects rendered as small, circular dots that are dim grey by default and only become bright with their cluster's color when in the active time window.

## Spawning & Narrative:
- ✅ **"Trio" Spawnng System:** ~~The current system highlights one "MVP" bridge at a time. This will be replaced. The new system will randomly select 3 "protagonist" clusters every 5 simulation years. Only these 3 clusters will be allowed to originate Frontier agents during that period.~~ **DONE** - System implemented with:
  - 3 protagonist clusters selected every 5 years from clusters with active projects
  - Protagonist cluster colors: #db4135, #ecb92e, #101d43
  - Visual cluster highlights with boundaries, centroids, and labels
  - Agent spawning restricted to protagonist clusters only

## Aesthetics & UI:
- ✅ **Color Palette:** ~~The current dark charcoal theme will be replaced with a minimalist, off-white (`#fafafa`) background. All UI and visual elements will be adjusted for high contrast against this new background.~~ **DONE** - Ledger updated with off-white background and high contrast elements
- ✅ **Ledger Overhaul:** ~~The Ledger UI will be enhanced. Each entry will have a left border color-coded to its agent's source cluster. It will also display the text label of that source cluster (e.g., "AI / Machine Learning").~~ **DONE** - Features implemented:
  - Cluster color-coded left borders and status badges
  - Status tags show cluster subjects from topTerms
  - Single-column layout with display-sized typography
  - Enhanced readability with proper padding and contrast
  - Special contrast handling for yellow (#ecb92e) backgrounds
- **"Ping" Animation:** A new visual effect will be added. When a Frontier agent reaches its target and dies, a fast, bright, circular ripple animation will emanate from that point.

## Final Polish:
- **Cyclical Reset:** The simulation must be able to loop cleanly. When the timeline ends, a fade-out/fade-in transition will occur, during which all systems (agents, trails, history) are reset to their initial state for the next cycle.
- **Particle Visibility:** The base size of all project particles (both dim "starfield" and active "constellation" dots) will be increased to ensure they are clearly visible.

## Performance (Low Priority):
- The idea of updating the trail map every other frame is noted as a potential optimization, but will be shelved unless performance becomes an issue after the primary fixes are implemented.