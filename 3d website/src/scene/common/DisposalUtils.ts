import * as THREE from 'three';

export interface DisposalOptions {
  disposeSharedMaterials?: boolean;
}

/**
 * Deeply disposes all Three.js WebGL GPU resources in an Object3D hierarchy:
 * - BufferGeometry (attributes, index buffers)
 * - InstancedMesh instance matrices and colors
 * - Materials (standard, physical, basic, multi-materials)
 * - CanvasTextures, DataTextures, VideoTextures attached to material slots
 * - Disconnects child nodes from root
 */
export function disposeHierarchy(root: THREE.Object3D, options: DisposalOptions = {}): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    // 1. InstancedMesh Buffer Arrays
    if ((obj as THREE.InstancedMesh).isInstancedMesh) {
      const inst = obj as THREE.InstancedMesh;
      if (inst.instanceMatrix) {
        inst.instanceMatrix.array = new Float32Array(0);
      }
      if (inst.instanceColor) {
        inst.instanceColor.array = new Float32Array(0);
      }
    }

    // 2. Geometries
    if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine || (obj as THREE.Points).isPoints) {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry);
        mesh.geometry.dispose();
      }

      // 3. Materials & Textures
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          if (!disposedMaterials.has(mat)) {
            disposedMaterials.add(mat);

            // Traverse texture map properties
            const textureSlots: Array<keyof THREE.MeshStandardMaterial> = [
              'map',
              'alphaMap',
              'aoMap',
              'bumpMap',
              'displacementMap',
              'emissiveMap',
              'envMap',
              'lightMap',
              'metalnessMap',
              'normalMap',
              'roughnessMap'
            ];

            for (const slot of textureSlots) {
              const tex = (mat as any)[slot];
              if (tex && (tex as THREE.Texture).isTexture && !disposedTextures.has(tex)) {
                disposedTextures.add(tex);
                tex.dispose();
              }
            }

            // Only dispose material if it is not marked as a shared singleton material
            const isShared = (mat as any).__isSharedMaterial === true;
            if (options.disposeSharedMaterials || !isShared) {
              mat.dispose();
            }
          }
        }
      }
    }
  });

  // 4. Detach child nodes from root
  while (root.children.length > 0) {
    const child = root.children[0];
    root.remove(child);
  }
}
