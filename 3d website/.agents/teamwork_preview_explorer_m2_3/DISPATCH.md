## 2026-08-15T09:11:26Z
Formulate the concrete implementation blueprint for `src/navigation/OrbitController.ts` and `src/navigation/NavigationManager.ts`:
- `OrbitController.ts`: Top-down / isometric camera view, damping, min/max polar angles, min/max zoom distances, pan and rotate controls.
- `NavigationManager.ts`: Master navigation state machine (`'fps'`, `'orbit'`, `'transitioning'`), active controller delegation, teleportation coordinator.
- Smooth Parabolic Camera Transitions: Quintic smoothstep easing, vertical arc lofting ($y(t) = \text{lerp}(y_0, y_1, t) + 4 H_{\text{arc}} t (1-t)$), quaternion slerp between FPS eye perspective and top-down isometric view.
- Integration with `src/scene/SceneManager.ts` and `src/main.ts`.
