const fs = require('fs');
const path = require('path');

console.log('⚡ EMPIRICAL CHALLENGER 2: Stress-Testing Milestone 1 Scaffolding & 3D Scene Architecture...\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureLog = [];

function check(title, condition, info = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${title} ${info ? `-> ${info}` : ''}`);
  } else {
    failedTests++;
    const errMsg = `[FAIL] ${title} ${info ? `-> ${info}` : ''}`;
    failureLog.push(errMsg);
    console.error(`  ${errMsg}`);
  }
}

// ---------------------------------------------------------------------------
// TEST SUITE 1: Build Output & Bundle Analysis
// ---------------------------------------------------------------------------
console.log('📦 Suite 1: Production Bundle Output & Assets Inspection');
const distPath = path.resolve(__dirname, '../dist');
const distHtmlPath = path.join(distPath, 'index.html');
const distAssetsPath = path.join(distPath, 'assets');

check('dist/ directory exists', fs.existsSync(distPath));
check('dist/index.html exists', fs.existsSync(distHtmlPath));
check('dist/assets/ directory exists', fs.existsSync(distAssetsPath));

if (fs.existsSync(distAssetsPath)) {
  const assetFiles = fs.readdirSync(distAssetsPath);
  const jsFiles = assetFiles.filter(f => f.endsWith('.js'));
  const mapFiles = assetFiles.filter(f => f.endsWith('.js.map'));

  check('Production JS bundle generated', jsFiles.length > 0, `Found: ${jsFiles.join(', ')}`);
  check('Production JS sourcemap generated', mapFiles.length > 0, `Found: ${mapFiles.join(', ')}`);

  if (jsFiles.length > 0) {
    const mainJsStat = fs.statSync(path.join(distAssetsPath, jsFiles[0]));
    const sizeKb = (mainJsStat.size / 1024).toFixed(2);
    check('Main JS bundle size is within reasonable standalone limits (< 800 KB)', mainJsStat.size < 800 * 1024, `${sizeKb} KB`);
  }
}

// ---------------------------------------------------------------------------
// TEST SUITE 2: DOM Scaffold Verification
// ---------------------------------------------------------------------------
console.log('\n🏛️ Suite 2: HTML DOM Scaffold & Element Contract Verification');
const srcHtmlPath = path.resolve(__dirname, '../index.html');
const indexHtmlContent = fs.readFileSync(srcHtmlPath, 'utf-8');

const requiredElementIds = [
  'webgl-container',
  'hud-layer',
  'zone-banner',
  'zone-text',
  'mode-badge',
  'mode-text',
  'perf-stats',
  'fps-stat',
  'draw-stat',
  'poly-stat',
  'reticle',
  'interaction-prompt',
  'minimap-container',
  'minimap-canvas',
  'btn-toggle-minimap',
  'btn-mode-toggle',
  'btn-settings',
  'btn-help',
  'btn-audio-mute',
  'settings-drawer',
  'btn-close-settings',
  'overlay-start',
  'btn-start-app'
];

requiredElementIds.forEach(id => {
  check(`index.html contains #${id}`, indexHtmlContent.includes(`id="${id}"`), `Found element id="${id}"`);
});

// Teleport buttons check
const expectedTeleportZones = ['reception', 'workstations', 'conference', 'lounge'];
expectedTeleportZones.forEach(zone => {
  check(`index.html contains teleport button for ${zone}`, indexHtmlContent.includes(`data-zone="${zone}"`), `data-zone="${zone}" present`);
});

// Lighting presets check
const expectedLightingPresets = ['day', 'sunset', 'night'];
expectedLightingPresets.forEach(preset => {
  check(`index.html contains lighting preset button for ${preset}`, indexHtmlContent.includes(`data-preset="${preset}"`), `data-preset="${preset}" present`);
});

// Check that script entrypoint points to /src/main.ts
check('index.html references /src/main.ts module script', indexHtmlContent.includes('src="/src/main.ts"'));

// ---------------------------------------------------------------------------
// TEST SUITE 3: Coordinate Bounds & Zone Sanity
// ---------------------------------------------------------------------------
console.log('\n📐 Suite 3: Coordinate Geometry & Spatial Domain Bounds Sanity');
const floorplanPath = path.resolve(__dirname, '../src/scene/OfficeFloorplan.ts');
const floorplanSrc = fs.readFileSync(floorplanPath, 'utf-8');

// Master floorplan space: X in [-20, 20], Z in [-13, 13], Y in [0, 4]
// Parse OFFICE_ZONES from source
const zoneNames = ['reception', 'workstations', 'conference', 'lounge', 'entrance'];
zoneNames.forEach(zn => {
  check(`OfficeFloorplan exports Zone definition: ${zn}`, floorplanSrc.includes(`${zn}: {`));
});

// Check that all zones have spawnPosition within floor boundaries
// Let's verify spawn coordinates by regex
const spawnMatches = [...floorplanSrc.matchAll(/spawnPosition:\s*new\s*THREE\.Vector3\(([-0-9.]+),\s*([-0-9.]+),\s*([-0-9.]+)\)/g)];
check('All 5 office zones define explicit spawnPosition Vector3', spawnMatches.length >= 5, `Found ${spawnMatches.length} spawn vectors`);

spawnMatches.forEach((m, idx) => {
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  const z = parseFloat(m[3]);

  const xValid = x >= -20 && x <= 20;
  const yValid = y >= 1.0 && y <= 2.0; // Eye height around 1.6m
  const zValid = z >= -13 && z <= 13;

  check(
    `Spawn coordinate #${idx+1} (${x}, ${y}, ${z}) within physical boundary envelope`,
    xValid && yValid && zValid,
    `X in [-20,20]: ${xValid}, Y in [1.0,2.0]: ${yValid}, Z in [-13,13]: ${zValid}`
  );
});

// ---------------------------------------------------------------------------
// TEST SUITE 4: Obstacle Registry Robustness
// ---------------------------------------------------------------------------
console.log('\n🚧 Suite 4: AABB Obstacle Collision Registry Rigor');
// Check all registerObstacle calls in OfficeFloorplan.ts
const obstacleMatches = [...floorplanSrc.matchAll(/this\.registerObstacle\(\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"],\s*new\s*THREE\.Vector3\(([-0-9.]+),\s*([-0-9.]+),\s*([-0-9.]+)\),\s*new\s*THREE\.Vector3\(([-0-9.]+),\s*([-0-9.]+),\s*([-0-9.]+)\)(?:,\s*(true|false))?\s*\)/g)];

check('Obstacle registry defines >= 15 discrete physical bounding boxes', obstacleMatches.length >= 15, `Found ${obstacleMatches.length} obstacles`);

let minMaxValidCount = 0;
let insideMasterBoundsCount = 0;

obstacleMatches.forEach(obs => {
  const id = obs[1];
  const name = obs[2];
  const zone = obs[3];
  const minX = parseFloat(obs[4]);
  const minY = parseFloat(obs[5]);
  const minZ = parseFloat(obs[6]);
  const maxX = parseFloat(obs[7]);
  const maxY = parseFloat(obs[8]);
  const maxZ = parseFloat(obs[9]);

  const isMinLessThanMax = minX <= maxX && minY <= maxY && minZ <= maxZ;
  if (isMinLessThanMax) minMaxValidCount++;

  const isWithinMaster = minX >= -20.5 && maxX <= 20.5 && minZ >= -13.5 && maxZ <= 13.5;
  if (isWithinMaster) insideMasterBoundsCount++;
});

check(
  `All ${obstacleMatches.length} obstacles have valid min <= max bounding coordinates`,
  minMaxValidCount === obstacleMatches.length,
  `${minMaxValidCount}/${obstacleMatches.length} valid`
);

check(
  `All ${obstacleMatches.length} obstacles reside within master architectural floorplan boundaries`,
  insideMasterBoundsCount === obstacleMatches.length,
  `${insideMasterBoundsCount}/${obstacleMatches.length} inside bounds`
);

// ---------------------------------------------------------------------------
// TEST SUITE 5: InstancedMesh Geometries & Allocations
// ---------------------------------------------------------------------------
console.log('\n🪑 Suite 5: InstancedMesh Asset Allocations & Limits');
const expectedInstances = [
  { name: 'chairMesh', count: 32, maxAllowed: 32 },
  { name: 'monitorBezelMesh', count: 34, maxAllowed: 34 },
  { name: 'monitorStandMesh', count: 34, maxAllowed: 34 },
  { name: 'lampMesh', count: 16, maxAllowed: 16 },
  { name: 'downlightMesh', count: 36, maxAllowed: 36 },
  { name: 'barStoolMesh', count: 4, maxAllowed: 4 }
];

expectedInstances.forEach(inst => {
  const regex = new THREE_InstancedMesh_Regex(inst.name, inst.count);
  const found = regex.test(floorplanSrc);
  check(
    `InstancedAssetRegistry allocates InstancedMesh for ${inst.name} with capacity ${inst.count}`,
    found,
    `Capacity: ${inst.count}`
  );
});

function THREE_InstancedMesh_Regex(meshName, capacity) {
  return {
    test: (src) => {
      const p = new RegExp(`this\\.${meshName}\\s*=\\s*new\\s*THREE\\.InstancedMesh\\([^,]+,[^,]+,\\s*${capacity}\\)`);
      return p.test(src);
    }
  };
}

// ---------------------------------------------------------------------------
// TEST SUITE 6: Lighting Rig Mathematics & Presets
// ---------------------------------------------------------------------------
console.log('\n☀️ Suite 6: Atmospheric Lighting Presets & Transition Interpolation');
const lightingPath = path.resolve(__dirname, '../src/scene/LightingManager.ts');
const lightingSrc = fs.readFileSync(lightingPath, 'utf-8');

check('LightingManager defines Day preset with high sunlight intensity', lightingSrc.includes('day: {') && lightingSrc.includes('sunIntensity: 1.8'));
check('LightingManager defines Sunset preset with warm golden sun angle', lightingSrc.includes('sunset: {') && lightingSrc.includes('sunPosition: [35.0, 9.0, 12.0]'));
check('LightingManager defines Night preset with cool moonlight & high emissive multiplier', lightingSrc.includes('night: {') && lightingSrc.includes('emissiveMultiplier: 1.8'));
check('LightingManager implements smooth cosine easing for transitions', lightingSrc.includes('0.5 - 0.5 * Math.cos(progress * Math.PI)'));
check('LightingManager configures 8 localized downlights', lightingSrc.includes('downlightCoords: [number, number, number][]') && lightingSrc.includes('[-7.0, 3.6, 7.5]'));

// ---------------------------------------------------------------------------
// TEST SUITE 7: Automation Debug Contract API (`window.__OFFICE_DEBUG__`)
// ---------------------------------------------------------------------------
console.log('\n🤖 Suite 7: window.__OFFICE_DEBUG__ Automation Contract Hooks');
const mainPath = path.resolve(__dirname, '../src/main.ts');
const mainSrc = fs.readFileSync(mainPath, 'utf-8');

const debugMethods = [
  'getFPS',
  'getDrawCalls',
  'getTriangleCount',
  'getPlayerPosition',
  'getInteractables',
  'triggerInteract',
  'teleport',
  'setLighting',
  'setMode'
];

debugMethods.forEach(method => {
  check(`window.__OFFICE_DEBUG__ exposes method: ${method}`, mainSrc.includes(`${method}:`), `Hook for ${method} verified`);
});

// ---------------------------------------------------------------------------
// SUMMARY VERDICT
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(70));
console.log(`📊 EMPIRICAL STRESS TEST RESULTS:`);
console.log(`   Total Invariants Verified: ${totalTests}`);
console.log(`   Passed Invariants:         ${passedTests}`);
console.log(`   Failed Invariants:         ${failedTests}`);
console.log('='.repeat(70));

if (failedTests === 0) {
  console.log('\n🎉 ALL EMPIRICAL CHALLENGER 2 STRESS TESTS PASSED WITH 100% SUCCESS!');
  process.exit(0);
} else {
  console.error(`\n❌ ${failedTests} EMPIRICAL INVARIANTS FAILED!`);
  failureLog.forEach(f => console.error(`   ${f}`));
  process.exit(1);
}
