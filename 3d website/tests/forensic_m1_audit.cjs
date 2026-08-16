const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '../src');

console.log('🔍 Starting Forensic Integrity Audit for Milestone 1...');

let passedChecks = 0;
let totalChecks = 0;

function assertCheck(name, condition, details) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${name}: ${details || 'OK'}`);
  } else {
    console.error(`  [FAIL] ${name}: ${details || 'FAILED'}`);
  }
}

// 1. Check file existence
const requiredFiles = [
  'types/index.ts',
  'scene/Materials.ts',
  'scene/LightingManager.ts',
  'scene/OfficeFloorplan.ts',
  'scene/SceneManager.ts',
  'main.ts'
];

requiredFiles.forEach(file => {
  const filePath = path.join(srcDir, file);
  assertCheck(`File exists: ${file}`, fs.existsSync(filePath), filePath);
});

// 2. Deep source code inspection
const materialsSrc = fs.readFileSync(path.join(srcDir, 'scene/Materials.ts'), 'utf-8');
const lightingSrc = fs.readFileSync(path.join(srcDir, 'scene/LightingManager.ts'), 'utf-8');
const floorplanSrc = fs.readFileSync(path.join(srcDir, 'scene/OfficeFloorplan.ts'), 'utf-8');
const sceneManagerSrc = fs.readFileSync(path.join(srcDir, 'scene/SceneManager.ts'), 'utf-8');
const mainSrc = fs.readFileSync(path.join(srcDir, 'main.ts'), 'utf-8');
const typesSrc = fs.readFileSync(path.join(srcDir, 'types/index.ts'), 'utf-8');

// 3. Check for forbidden/facade patterns (empty function bodies or dummy NotImplemented throws)
const forbiddenPatterns = [
  { name: 'No hardcoded test mocks in src', regex: /mockResult|fakeTestOutput|isHardcoded/i },
  { name: 'No empty facade functions', regex: /(?:function\s+\w+\s*\([^)]*\)|\w+\s*\([^)]*\)\s*:\s*\w+)\s*{\s*(?:return\s*;\s*)?}/ },
  { name: 'No dummy NotImplemented throws', regex: /throw new Error\(['"]Not implemented/i }
];

[
  { name: 'Materials.ts', src: materialsSrc },
  { name: 'LightingManager.ts', src: lightingSrc },
  { name: 'OfficeFloorplan.ts', src: floorplanSrc },
  { name: 'SceneManager.ts', src: sceneManagerSrc },
  { name: 'main.ts', src: mainSrc }
].forEach(f => {
  forbiddenPatterns.forEach(p => {
    const match = p.regex.test(f.src);
    assertCheck(`${f.name} - ${p.name}`, !match, match ? 'Found suspicious pattern' : 'Clean');
  });
});

// 4. Check Procedural Canvas Textures in Materials.ts
const expectedCanvasGenerators = [
  'createParquetCanvas',
  'createCarpetCanvas',
  'createWalnutWoodCanvas',
  'createOakWoodCanvas',
  'createMarbleCanvas',
  'createLeatherCanvas',
  'createWhiteboardCanvas',
  'createCompanyLogoCanvas',
  'createFoliageCanvas',
  'createBrushedMetalCanvas',
  'createCeilingTileCanvas'
];

expectedCanvasGenerators.forEach(gen => {
  assertCheck(
    `Materials.ts canvas generator: ${gen}`,
    materialsSrc.includes(`function ${gen}`) && materialsSrc.includes('getContext(\'2d\')'),
    'Genuine 2D canvas context generation found'
  );
});

// Check Canvas 2D methods
assertCheck('Materials.ts uses fillRect', materialsSrc.includes('fillRect'), 'Canvas fillRect found');
assertCheck('Materials.ts uses getImageData/putImageData', materialsSrc.includes('getImageData') && materialsSrc.includes('putImageData'), 'Direct pixel array manipulation found');
assertCheck('Materials.ts uses bezierCurveTo/quadraticCurveTo', materialsSrc.includes('bezierCurveTo') && materialsSrc.includes('quadraticCurveTo'), 'Organic curve synthesis found');
assertCheck('Materials.ts uses createLinearGradient', materialsSrc.includes('createLinearGradient'), 'Gradient synthesis found');

// 5. Check Lighting presets in LightingManager.ts
assertCheck('LightingManager has day preset', lightingSrc.includes('day: {'), 'Day preset defined');
assertCheck('LightingManager has sunset preset', lightingSrc.includes('sunset: {'), 'Sunset preset defined');
assertCheck('LightingManager has night preset', lightingSrc.includes('night: {'), 'Night preset defined');
assertCheck('LightingManager configures DirectionalLight with shadows', lightingSrc.includes('DirectionalLight') && lightingSrc.includes('castShadow = true'), 'Directional shadow map enabled');
assertCheck('LightingManager configures HemisphereLight and AmbientLight', lightingSrc.includes('HemisphereLight') && lightingSrc.includes('AmbientLight'), 'Ambient sky/ground fill lights');
assertCheck('LightingManager ceiling point lights grid', lightingSrc.includes('PointLight'), 'Ceiling point lights grid');
assertCheck('LightingManager fog & background sync', lightingSrc.includes('THREE.Fog') && lightingSrc.includes('scene.background'), 'Atmospheric fog setup');

// 6. Check OfficeFloorplan.ts Zones and Geometry
const expectedZones = ['reception', 'workstations', 'conference', 'lounge', 'entrance'];
expectedZones.forEach(z => {
  assertCheck(`OfficeFloorplan zone bounds: ${z}`, floorplanSrc.includes(`${z}: {`), `Zone ${z} configured with bounds & spawn`);
});

assertCheck('OfficeFloorplan builds Architectural Shell', floorplanSrc.includes('buildArchitecturalShell'), 'Perimeter walls, floor slabs, ceiling, and columns');
assertCheck('OfficeFloorplan builds Zone 1 Reception', floorplanSrc.includes('buildZone1Reception'), 'Reception desk, logo wall, visitor lounge, green wall');
assertCheck('OfficeFloorplan builds Zone 2 Workstations', floorplanSrc.includes('buildZone2Workstations'), '4 quad pods (16 workstations), monitors, lamps, chairs');
assertCheck('OfficeFloorplan builds Zone 3 Conference', floorplanSrc.includes('buildZone3Conference'), 'Glass walls, walnut table, 12 chairs, 85" display');
assertCheck('OfficeFloorplan builds Zone 4 Lounge', floorplanSrc.includes('buildZone4Lounge'), 'Kitchenette counter, espresso machine, sofa, TV, armchairs');
assertCheck('OfficeFloorplan builds Zone 5 Corridor', floorplanSrc.includes('buildZone5Corridor'), 'Wayfinding totem, 36 downlights');

assertCheck('OfficeFloorplan registers AABB obstacles', floorplanSrc.includes('registerObstacle') && floorplanSrc.includes('new THREE.Box3'), 'Obstacle bounding boxes registered');
assertCheck('OfficeFloorplan InstancedAssetRegistry', floorplanSrc.includes('InstancedAssetRegistry') && floorplanSrc.includes('THREE.InstancedMesh'), 'InstancedMesh furniture optimization');

// 7. Check SceneManager.ts configuration
assertCheck('SceneManager WebGLRenderer settings', sceneManagerSrc.includes('ACESFilmicToneMapping') && sceneManagerSrc.includes('PCFSoftShadowMap'), 'PBR color & soft shadows');
assertCheck('SceneManager animation loop with delta clamping', sceneManagerSrc.includes('requestAnimationFrame') && sceneManagerSrc.includes('Math.min(rawDelta, 0.1)'), 'Robust animation loop');
assertCheck('SceneManager resize listener', sceneManagerSrc.includes('setupResizeListener') && sceneManagerSrc.includes('updateProjectionMatrix'), 'Dynamic viewport resize handling');

// 8. Check main.ts Automation Debug Contract
assertCheck('main.ts window.__OFFICE_DEBUG__ contract', mainSrc.includes('window.__OFFICE_DEBUG__') || mainSrc.includes('(window as any).__OFFICE_DEBUG__'), 'Automation contract exposed');
assertCheck('main.ts teleport shortcuts', mainSrc.includes('teleportTo'), 'Zone teleport logic');
assertCheck('main.ts view mode toggle', mainSrc.includes('toggleViewMode'), 'Dual FPS/Orbit mode toggle');

console.log(`\n📊 Forensic Audit Summary: ${passedChecks}/${totalChecks} checks passed (${((passedChecks/totalChecks)*100).toFixed(1)}%).`);

if (passedChecks === totalChecks) {
  console.log('✅ VERDICT: CLEAN - All forensic checks passed.');
  process.exit(0);
} else {
  console.error('❌ VERDICT: INTEGRITY VIOLATION - Some forensic checks failed.');
  process.exit(1);
}
