# Original User Request

## 2026-08-15T08:50:11Z

<USER_REQUEST>
Build a high-performance, immersive 3D corporate office web application using Three.js, featuring a modern tech workspace with multi-zone layouts, dual exploration modes (first-person FPS and bird's-eye orbit view), interactive objects, and a sleek HUD overlay.

Working directory: C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d
Integrity mode: development

## Requirements

### R1. Architectural Environment & Multi-Zone Office Floorplan
Create a visually rich, modern tech corporate office floor containing distinct functional areas:
- **Welcome Reception:** Branded front desk, visitor seating, company logo display, and glass entrance partition.
- **Open Workstations & Cubicles:** Desks equipped with dual monitors, keyboards, ergonomic chairs, desk lamps, and ambient workspace props.
- **Glass-Walled Conference Room:** Central conference table, ergonomic conference chairs, large presentation screen/whiteboard, and transparent glass walls.
- **Lounge & Breakroom:** Coffee bar/kitchenette, casual sofa/seating area, and indoor potted greenery.
- **Atmospheric Lighting:** Realistic lighting setup combining ambient light, directional sunlight/shadows through exterior windows, point lights for ceiling fixtures, and emissive screen glows.

### R2. Dual Navigation & Camera Control Modes
Implement seamless navigation with two switchable modes:
- **First-Person Walkthrough Mode:** WASD keyboard movement + mouse pointer-lock look, head bobbing, sprint toggle (Shift), and collision detection preventing walking through walls/furniture.
- **Overview / Orbit Mode:** Top-down / isometric orbit controls with smooth pan, zoom, and rotate for inspecting the entire floorplan layout.
- Smooth animated transitions when toggling between first-person and overview modes.

### R3. Interactive 3D Objects & Raycasting Hotspots
- Raycasting interaction on hover and click for key office elements (monitors, lights, doors, presentation displays, coffee machine).
- Interactive monitors/screens that can display switchable slide decks, charts, or terminal dashboards.
- Visual feedback on hover (subtle highlight/glow outline) and informational modal/tooltip popups upon clicking objects.
- Ambient audio effects (office chatter/hum toggle, footsteps sound effect, interaction click sound).

### R4. HUD Interface & Spatial Minimap
- **Minimap Overlay:** Real-time 2D floorplan showing player position and orientation vector.
- **Quick-Teleport Menu:** Instant navigation shortcuts to jump camera/player to Reception, Conference Room, Workstations, or Lounge.
- **Settings & Lighting Controls:** Toggle between Day/Sunset/Night lighting presets, toggle shadows, and adjust graphics quality.
- **Help & Shortcuts Overlay:** Onscreen guide for keybindings and interactions.

### R5. Optimization & Standalone Web Execution
- Optimized Three.js rendering pipeline targeting 60 FPS across standard modern web browsers.
- Fully runnable locally with zero setup beyond standard static serving or Vite dev server.

## Acceptance Criteria

### Scene Rendering & Architecture
- [ ] Office scene renders complete multi-zone environment (reception, open workstations, conference room, lounge) with PBR materials, shadows, and clean geometry.
- [ ] Lighting system includes ambient, directional window light, and emissive interior fixtures with working day/night or lighting presets.

### Navigation & Collision
- [ ] WASD + Mouse look first-person controller functions with pointer lock and boundary/wall collision constraints.
- [ ] Orbit/Top-down overview mode works with smooth transition animations between view modes.

### Interactivity & HUD
- [ ] Hovering over interactive objects displays visual focus/cursor change, and clicking triggers contextual action or details popup.
- [ ] 2D minimap accurately tracks player location and facing angle in real-time.
- [ ] Quick-teleport buttons reliably move the camera/player to the specified room.
- [ ] Key controls modal (e.g. pressing 'H' or clicking 'Controls') displays navigation instructions.

### Performance & Build Verification
- [ ] Web application runs smoothly at 60 FPS without memory leaks or uncaught JavaScript runtime errors.
- [ ] Project can be launched and verified with `npm run dev` or a local static HTTP server.

</USER_REQUEST>
