import * as THREE from 'three';
import { CollisionEngine } from '../src/navigation/CollisionEngine.ts';
import { OfficeFloorplan } from '../src/scene/OfficeFloorplan.ts';
import { Materials } from '../src/scene/Materials.ts';
import { AudioManager } from '../src/audio/AudioManager.ts';
import { InteractionManager } from '../src/interaction/InteractionManager.ts';
import { InteractiveProps } from '../src/interaction/InteractiveProps.ts';

// Mock Web Audio API for headless environment verification
class MockAudioParam {
  value = 1;
  setValueAtTime(val) { this.value = val; }
  linearRampToValueAtTime(val) { this.value = val; }
  exponentialRampToValueAtTime(val) { this.value = Math.max(0.0001, val); }
  cancelScheduledValues() {}
}

class MockAudioNode {
  connect() {}
  disconnect() {}
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockOscillatorNode extends MockAudioNode {
  frequency = new MockAudioParam();
  type = 'sine';
  start() {}
  stop() {}
}

class MockBufferSourceNode extends MockAudioNode {
  buffer = null;
  loop = false;
  start() {}
  stop() {}
}

class MockBiquadFilterNode extends MockAudioNode {
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  type = 'lowpass';
}

class MockAudioContext {
  state = 'suspended';
  sampleRate = 44100;
  currentTime = 0.5;
  destination = new MockAudioNode();

  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBufferSource() { return new MockBufferSourceNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length)
    };
  }
  async resume() {
    this.state = 'running';
  }
}

globalThis.window = {
  AudioContext: MockAudioContext,
  addEventListener: () => {},
  removeEventListener: () => {}
};

console.log('🧪 Running Milestone 3 Challenger Stress Test Suite...\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

// -------------------------------------------------------------
// SUITE 1: AudioManager Stress & Lifecycle Tests
// -------------------------------------------------------------
console.log('--- SUITE 1: AudioManager Stress & Lifecycle ---');

const audio = new AudioManager();
await audio.init();

// Test 1.1: AudioContext State
assert(audio.masterVolume === 0.7, 'Default master volume is 0.7');
assert(!audio.isMuted, 'Default is not muted');

// Test 1.2: Rapid Audio Triggering (200 footsteps + 200 chirps)
let audioGlitch = false;
try {
  for (let i = 0; i < 200; i++) {
    audio.playFootstep('carpet');
    audio.playFootstep('tile');
    audio.playFootstep('wood');
    audio.playFootstep('metal');
    audio.playClick();
    audio.playChime();
    audio.playDoorSound(true);
    audio.playLightSwitch(true);
  }
} catch (e) {
  audioGlitch = true;
  console.error(e);
}
assert(!audioGlitch, 'Rapid triggering of 1600 audio events executed with 0 errors');

// Test 1.3: Volume Clamping & Bounds Checking
audio.setMasterVolume(1.5);
assert(audio.masterVolume === 1.0, `Volume clamped at upper bound: 1.5 -> ${audio.masterVolume}`);

audio.setMasterVolume(-0.8);
assert(audio.masterVolume === 0.0, `Volume clamped at lower bound: -0.8 -> ${audio.masterVolume}`);

audio.setMasterVolume(0.42);
assert(Math.abs(audio.masterVolume - 0.42) < 1e-5, `Volume set correctly within range: 0.42`);

// Test 1.4: Mute / Unmute State Persistence
const mutedState = audio.toggleMute();
assert(mutedState === true && audio.isMuted === true, 'Mute toggles to true');

// While muted, change volume
audio.setMasterVolume(0.85);
assert(audio.masterVolume === 0.85, 'Master volume property persists while muted');

const unmutedState = audio.toggleMute();
assert(unmutedState === false && audio.isMuted === false, 'Mute toggles back to false');
assert(audio.masterVolume === 0.85, 'Restored volume preserves updated volume level');

// -------------------------------------------------------------
// SUITE 2: Door Collision & Dynamic Obstacle Synchronization
// -------------------------------------------------------------
console.log('\n--- SUITE 2: Door Collision & Dynamic Obstacle Synchronization ---');

const materials = Materials.getInstance();
const floorplan = new OfficeFloorplan(materials);
floorplan.build();

const collisionEngine = new CollisionEngine();

// Register floorplan obstacles into CollisionEngine as in main.ts
const floorplanObstacles = floorplan.getObstacles();
for (const obs of floorplanObstacles) {
  collisionEngine.addObstacle(obs.box, obs.name, obs.id, obs.isDoor);
}

// Find door obstacle in both floorplan and collisionEngine
const fpDoorObs = floorplanObstacles.find(o => o.id === 'conf_door_sliding');
const ceDoorObs = collisionEngine.obstacles.find(o => o.id === 'conf_door_sliding');

assert(!!fpDoorObs, 'Door obstacle registered in OfficeFloorplan');
assert(!!ceDoorObs, 'Door obstacle registered in CollisionEngine');
assert(fpDoorObs.isDoor === true, 'Floorplan door has isDoor = true');
assert(ceDoorObs.isDoor === true, 'CollisionEngine door has isDoor = true');
assert(fpDoorObs.isOpen === false, 'Initial Floorplan door isOpen = false (closed)');
assert(ceDoorObs.isOpen === false, 'Initial CollisionEngine door isOpen = false (closed)');

// Setup mock scene & interaction manager
const scene = new THREE.Scene();
const im = new InteractionManager();
const interactiveProps = new InteractiveProps(scene, floorplan, im, audio, materials);
interactiveProps.init();

// Closed door collision test: Player tries to walk through closed door at (x=5.8, z=-2.75)
// Player moves from (5.0, 1.6, -2.75) towards (6.5, 1.6, -2.75)
const startPosClosed = new THREE.Vector3(5.0, 1.6, -2.75);
const desiredMoveClosed = new THREE.Vector3(1.5, 0, 0); // Walk across boundary x=5.8
const resolvedPosClosed = collisionEngine.resolveMovement(startPosClosed, desiredMoveClosed);

assert(resolvedPosClosed.x < 5.75, `Player blocked by closed door: resolved X = ${resolvedPosClosed.x.toFixed(3)} (< 5.75)`);

// Toggle Door Open via InteractiveProps
console.log('  -> Executing interactiveProps.toggleDoor()...');
interactiveProps.toggleDoor();

assert(interactiveProps.isDoorOpen === true, 'InteractiveProps.isDoorOpen is true');
assert(fpDoorObs.isOpen === true, 'OfficeFloorplan door obstacle isOpen is true');

// CRITICAL CHECK: Did CollisionEngine obstacle get updated?
const ceDoorIsOpen = ceDoorObs.isOpen;
console.log(`  -> CollisionEngine door obstacle isOpen = ${ceDoorIsOpen}`);

assert(ceDoorIsOpen === true, `CRITICAL: CollisionEngine.obstacles['conf_door_sliding'].isOpen must be true after toggleDoor()`);

// Open door collision test: Player tries to walk through open door at x=5.8
const startPosOpen = new THREE.Vector3(5.0, 1.6, -2.75);
const desiredMoveOpen = new THREE.Vector3(1.5, 0, 0);
const resolvedPosOpen = collisionEngine.resolveMovement(startPosOpen, desiredMoveOpen);

assert(resolvedPosOpen.x > 6.0, `Player can traverse open door into conference room: resolved X = ${resolvedPosOpen.x.toFixed(3)} (> 6.0)`);

// -------------------------------------------------------------
// SUITE 3: Particle Emitter Stability & Cleanup
// -------------------------------------------------------------
console.log('\n--- SUITE 3: Particle Emitter Stability & Cleanup ---');

assert(!interactiveProps.isBrewing, 'Espresso machine is idle before trigger');

interactiveProps.triggerBrewEspresso();
assert(interactiveProps.isBrewing === true, 'Espresso machine isBrewing is true');

// Simulate 100 frames of brewing update
for (let f = 0; f < 100; f++) {
  interactiveProps.update(0.016);
}
assert(interactiveProps.isBrewing === true, 'Brewing continues during 1.6s elapsed');

// Simulate remaining frames until brew completion (> 2.4s total)
for (let f = 0; f < 100; f++) {
  interactiveProps.update(0.016);
}
assert(interactiveProps.isBrewing === false, 'Espresso machine finishes brewing and returns to idle');

// Trigger 50 rapid brew clicks (re-entrancy test)
for (let i = 0; i < 50; i++) {
  interactiveProps.triggerBrewEspresso();
}
assert(interactiveProps.isBrewing === true, 'Re-entrant brew triggers handled without exception');

// Final summary
console.log(`\n========================================`);
console.log(`TOTAL: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
console.log(`========================================\n`);

if (failedTests > 0) {
  console.error(`💥 SUITE FAILED WITH ${failedTests} FAILURE(S)!`);
  process.exit(1);
} else {
  console.log(`🎉 ALL TESTS PASSED!`);
  process.exit(0);
}
