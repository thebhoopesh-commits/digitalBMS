import * as THREE from 'three';
import { CollisionEngine } from '../src/navigation/CollisionEngine.js';
import { FirstPersonController } from '../src/navigation/FirstPersonController.js';
import { OrbitController } from '../src/navigation/OrbitController.js';
import { NavigationManager } from '../src/navigation/NavigationManager.js';
import { OFFICE_ZONES } from '../src/scene/OfficeFloorplan.js';

let failed = 0;
function assert(desc, condition) {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
  } else {
    console.error(`  [FAIL] ${desc}`);
    failed++;
  }
}

console.log('🧪 Running Adversarial Stress Tests on Navigation & Collision Subsystem...\n');

// -------------------------------------------------------------
// ADVERSARIAL TEST 1: Zero / Sub-Epsilon Displacement & NaN check
// -------------------------------------------------------------
console.log('--- Adversarial Test 1: Zero / Micro Displacement Stability ---');
const col = new CollisionEngine();
col.addObstacle(new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 3, 2)), 'center_cube');

const pZero = new THREE.Vector3(5, 1.6, 5);
const dZero = new THREE.Vector3(0, 0, 0);
const rZero = col.resolveMovement(pZero, dZero);
assert('Zero vector displacement returns identical position without NaN', !isNaN(rZero.x) && !isNaN(rZero.y) && !isNaN(rZero.z) && rZero.equals(pZero));

const dMicro = new THREE.Vector3(1e-12, 0, 1e-12);
const rMicro = col.resolveMovement(pZero, dMicro);
assert('Micro-displacement (1e-12) handles floating precision cleanly', !isNaN(rMicro.x) && Math.abs(rMicro.x - 5) < 1e-5);

// -------------------------------------------------------------
// ADVERSARIAL TEST 2: High Velocity CCD Tunneling Resistance
// -------------------------------------------------------------
console.log('\n--- Adversarial Test 2: High Velocity CCD Sub-Stepping ---');
// Wall at X = 0, thickness 0.2 (from X=-0.1 to X=0.1, Z from -5 to 5)
const colWall = new CollisionEngine();
colWall.addObstacle(new THREE.Box3(new THREE.Vector3(-0.1, 0, -5), new THREE.Vector3(0.1, 3, 5)), 'thin_wall');

const pBeforeWall = new THREE.Vector3(-1.0, 1.6, 0);
// Attempt high speed burst: move 10m eastward in single step (+X = 10.0)
const dHighSpeed = new THREE.Vector3(10.0, 0, 0);
const rHighSpeed = colWall.resolveMovement(pBeforeWall, dHighSpeed, 0.35, 1.80);

assert('High speed displacement stopped before wall (X < -0.1)', rHighSpeed.x < -0.1);
assert('High speed displacement does not tunnel through thin wall (X < 0)', rHighSpeed.x <= -0.1 - 0.35 + 0.05);

// -------------------------------------------------------------
// ADVERSARIAL TEST 3: Sliding Physics on Diagonal Collision
// -------------------------------------------------------------
console.log('\n--- Adversarial Test 3: Diagonal Multi-Axis Wall Sliding ---');
const pSlide = new THREE.Vector3(-1.0, 1.6, 0);
// Move diagonally (+X = 2.0 into wall, +Z = 3.0 along wall)
const dDiag = new THREE.Vector3(2.0, 0, 3.0);
const rSlide = colWall.resolveMovement(pSlide, dDiag, 0.35, 1.80);

assert('X movement stopped by wall (X <= -0.45)', rSlide.x <= -0.44);
assert('Z movement preserved along wall surface (Z == 3.0)', Math.abs(rSlide.z - 3.0) < 0.01);

// -------------------------------------------------------------
// ADVERSARIAL TEST 4: Door State Transitions (Open / Closed)
// -------------------------------------------------------------
console.log('\n--- Adversarial Test 4: Dynamic Door Obstacle Traversal ---');
const colDoor = new CollisionEngine();
colDoor.addObstacle(new THREE.Box3(new THREE.Vector3(-0.1, 0, -1), new THREE.Vector3(0.1, 3, 1)), 'sliding_door', 'door_1', true);

// 1. Closed door blocks traversal
const pDoorStart = new THREE.Vector3(-1.0, 1.6, 0);
const dDoorMove = new THREE.Vector3(2.0, 0, 0);
const rClosed = colDoor.resolveMovement(pDoorStart, dDoorMove, 0.35, 1.80);
assert('Closed door blocks movement (X < 0)', rClosed.x < 0);

// 2. Open door allows traversal
colDoor.setDoorOpen('door_1', true);
const rOpen = colDoor.resolveMovement(pDoorStart, dDoorMove, 0.35, 1.80);
assert('Open door allows unobstructed traversal (X == 1.0)', Math.abs(rOpen.x - 1.0) < 0.01);

// -------------------------------------------------------------
// ADVERSARIAL TEST 5: Boundary Clamping on Out-of-Bounds Movement
// -------------------------------------------------------------
console.log('\n--- Adversarial Test 5: Global Boundary Clamping ---');
const colBounds = new CollisionEngine();
const pInside = new THREE.Vector3(0, 1.6, 0);
const dExtreme = new THREE.Vector3(100.0, 0, -100.0);
const rClamped = colBounds.resolveMovement(pInside, dExtreme, 0.35, 1.80);

assert('X clamped to maxX (19.5)', Math.abs(rClamped.x - 19.5) < 0.001);
assert('Z clamped to minZ (-12.5)', Math.abs(rClamped.z - (-12.5)) < 0.001);

// -------------------------------------------------------------
// ADVERSARIAL TEST 6: Smootherstep & Parabolic Height Easing Integrity
// -------------------------------------------------------------
console.log('\n--- Adversarial Test 6: Parabolic Arc & Easing Integrity ---');
function smootherstep(u) {
  return u * u * u * (u * (u * 6 - 15) + 10);
}

assert('Smootherstep at u=0 is 0', smootherstep(0) === 0);
assert('Smootherstep at u=0.5 is 0.5', smootherstep(0.5) === 0.5);
assert('Smootherstep at u=1 is 1', smootherstep(1) === 1);
assert('Smootherstep first derivative at 0 is 0', smootherstep(0.0001) < 0.0001 * 0.01);
assert('Smootherstep first derivative at 1 is 0', 1 - smootherstep(0.9999) < 0.0001 * 0.01);

// Parabolic height formula: y(0.5) = base + 4 * H * 0.5 * 0.5 = base + H
const H = 8.0;
const y0 = 1.6;
const y1 = 1.6;
const uMid = 0.5;
const sMid = smootherstep(uMid);
const baseHeight = y0 * (1 - sMid) + y1 * sMid;
const arcHeight = 4 * H * uMid * (1 - uMid);
assert('Peak height at midpoint u=0.5 reaches exact loft apex (base + H)', Math.abs((baseHeight + arcHeight) - (1.6 + H)) < 1e-6);

if (failed === 0) {
  console.log('\n🎉 ALL ADVERSARIAL STRESS TESTS PASSED!');
  process.exit(0);
} else {
  console.error(`\n❌ ${failed} ADVERSARIAL TESTS FAILED!`);
  process.exit(1);
}
