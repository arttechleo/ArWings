// AR Back Wings — Spark Gaussian Splat version (FULL FILE)
// --------------------------------------------------------
// - Uses Spark SplatMesh with a single URL (prefer .spz for performance)
// - MoveNet (TFJS) for shoulder tracking
// - Renders Three.js to a WebGL canvas and composites onto a 2D canvas
// - Includes robust debug logs + status panel

import * as THREE from 'three';
import { SplatMesh /*, SparkRenderer*/ } from '@sparkjsdev/spark';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';

// --------------------- Config --------------------------
const SPLAT_PATH = 'assets/wings.spz'; // 👈 Path to your Gaussian Splat file (.spz recommended; .ply also works)
const CAMERA_MODE = 'environment';     // 'environment' | 'user'
const MIN_SHOULDER_SCORE = 0.4;        // shoulder keypoint confidence threshold
const SMOOTHING_FACTOR = 0.4;          // smoothing for pose-driven transforms

// --------------------- State ---------------------------
let scene, camera, renderer;
let video, canvas, ctx;
let poseModel;
let isRunning = false;

let frameCount = 0;
let lastFpsUpdate = performance.now();

let wingsMesh = null;          // Spark SplatMesh
let splatLoaded = false;
let splatBoundingBoxSize = null;

const smoothedWingsPos = new THREE.Vector3();
const smoothedWingsRot = new THREE.Euler();

let debugLogger;

// ------------------ Debug Logger -----------------------
class DebugLogger {
  constructor() {
    this.logsContainer = document.getElementById('debug-logs');
    this.statusText = document.getElementById('status-text');
    this.fpsCounter = document.getElementById('fps-counter');
    this.maxLogs = 60;
    this.setupControls();
  }
  setupControls() {
    const toggleBtn = document.getElementById('toggle-debug');
    const clearBtn = document.getElementById('clear-debug');
    const panel = document.getElementById('debug-panel');
    if (!toggleBtn || !clearBtn || !panel) return;
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      toggleBtn.textContent = panel.classList.contains('minimized') ? '＋' : '−';
    });
    clearBtn.addEventListener('click', () => { if (this.logsContainer) this.logsContainer.innerHTML = ''; });
  }
  log(type, message) {
    const ts = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = `debug-log ${type}`;
    div.innerHTML = `<span class="debug-timestamp">[${ts}]</span> ${message}`;
    if (this.logsContainer) {
      this.logsContainer.insertBefore(div, this.logsContainer.firstChild);
      while (this.logsContainer.children.length > this.maxLogs) {
        this.logsContainer.removeChild(this.logsContainer.lastChild);
      }
    }
    const method = type === 'error' ? 'error' : (type === 'warning' ? 'warn' : 'log');
    console[method](`[${type}] ${message}`);
  }
  updateStatus(key, value) {
    const el = document.getElementById(`${key}-status`);
    if (el) el.textContent = value;
  }
  updateFPS(fps) { if (this.fpsCounter) this.fpsCounter.textContent = fps.toFixed(1); }
}

// -------------------- App Init ------------------------
window.addEventListener('DOMContentLoaded', () => {
  debugLogger = new DebugLogger();
  debugLogger.log('info', '🚀 AR Gaussian Splat Wings Initializing...');

  const startBtn = document.getElementById('start-btn');
  const instructions = document.getElementById('instructions');

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      instructions.classList.add('hidden');
      await startAR();
    } catch (e) {
      debugLogger.log('error', `Start failed: ${e.message}`);
      instructions.classList.remove('hidden');
      startBtn.disabled = false;
    }
  });
});

// -------------------- Start AR ------------------------
async function startAR() {
  debugLogger.updateStatus('status', 'Starting…');

  // Choose best TFJS backend
  try {
    await tf.setBackend('webgl');
    await tf.ready();
    debugLogger.log('success', `TFJS backend: ${tf.getBackend()}`);
  } catch (e) {
    debugLogger.log('warning', `TFJS backend fallback: ${e.message}`);
  }

  canvas = document.getElementById('output-canvas');
  ctx = canvas.getContext('2d', { alpha: true });
  video = document.getElementById('video');

  // Camera stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: CAMERA_MODE,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
  } catch (e) {
    debugLogger.log('error', `getUserMedia error: ${e.message}`);
    debugLogger.updateStatus('video', '❌ Permission denied');
    throw e;
  }

  await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
  debugLogger.updateStatus('video', `✅ ${video.videoWidth}x${video.videoHeight}`);

  // Sizing
  resizeToVideo();
  window.addEventListener('resize', resizeToVideo);

  // Three.js + Spark
  await setupThree();

  // Pose model
  debugLogger.log('info', '🧠 Loading Pose Detection model…');
  const detectorConfig = { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING };
  poseModel = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
  debugLogger.updateStatus('model', '✅ MoveNet loaded');

  isRunning = true;
  renderLoop();
}

function resizeToVideo() {
  if (!video) return;
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  if (renderer && camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(canvas.width, canvas.height, false);
  }
}

// -------------------- Three + Spark -------------------
async function setupThree() {
  debugLogger.log('info', '🎨 Setting up Three.js scene…');

  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,                // better perf; splats don’t benefit
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.width, canvas.height, false);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  camera.position.set(0, 0, 0);

  // Optional: Spark renderer for big scenes / DOF, etc.
  // import { SparkRenderer } from '@sparkjsdev/spark';
  // const spark = new SparkRenderer({ renderer });
  // camera.add(spark);

  // Load SplatMesh
  debugLogger.log('info', `🌟 Loading Spark splat: ${SPLAT_PATH}`);
  debugLogger.updateStatus('asset', 'Loading…');

  try {
    wingsMesh = new SplatMesh({ url: SPLAT_PATH });
    scene.add(wingsMesh);

    // Ensure it’s ready before we read bounds or show it
    await wingsMesh.initialized;

    // Bounding box for scale normalization
    const bbox = wingsMesh.getBoundingBox(true); // true = use centers only (tighter)
    const size = new THREE.Vector3();
    bbox.getSize(size);
    splatBoundingBoxSize = size;

    wingsMesh.visible = false;
    splatLoaded = true;

    debugLogger.updateStatus('asset', '✅ Loaded');
    debugLogger.log('success', `Splat ready — size: ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`);
  } catch (err) {
    debugLogger.updateStatus('asset', '❌ Load failed');
    debugLogger.log('error', `Splat load error: ${err.message}`);
  }
}

// -------------------- Main Loop -----------------------
async function renderLoop() {
  if (!isRunning) return;
  requestAnimationFrame(renderLoop);

  // FPS counter
  frameCount++;
  const now = performance.now();
  if (now - lastFpsUpdate >= 1000) {
    debugLogger.updateFPS(frameCount);
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Draw camera image first
  ctx.save();
  if (CAMERA_MODE === 'user') ctx.scale(-1, 1);
  const drawX = CAMERA_MODE === 'user' ? -canvas.width : 0;
  ctx.drawImage(video, drawX, 0, canvas.width, canvas.height);
  ctx.restore();

  // Pose estimation
  try {
    if (poseModel && video.readyState === video.HAVE_ENOUGH_DATA) {
      const poses = await poseModel.estimatePoses(video);
      const pose = poses?.[0];
      const ls = pose?.keypoints?.find(k => k.name === 'left_shoulder');
      const rs = pose?.keypoints?.find(k => k.name === 'right_shoulder');

      if (ls && rs && ls.score > MIN_SHOULDER_SCORE && rs.score > MIN_SHOULDER_SCORE) {
        debugLogger.updateStatus('pose', '✅ Pose detected');
        if (splatLoaded && wingsMesh) {
          applyPoseToSplat(ls, rs, wingsMesh);
          if (!wingsMesh.visible) {
            wingsMesh.visible = true;
            debugLogger.log('success', '👁️ Wings visible');
          }
        }
      } else {
        if (wingsMesh) wingsMesh.visible = false;
        debugLogger.updateStatus('pose', '❌ No pose / low confidence');
      }
    }
  } catch (e) {
    debugLogger.log('warning', `Pose estimate warning: ${e.message}`);
  }

  // Render 3D to WebGL canvas, then composite to 2D
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0);
}

// ----------- Pose → Splat transform (core) -------------
function applyPoseToSplat(ls, rs, splat) {
  // Shoulder distance & angle in screen space
  const dx = rs.x - ls.x;
  const dy = rs.y - ls.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  // Upper-back anchor (slightly below shoulder mid-point)
  const spine = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + dist * 0.15 };

  // Approximate depth & scale from shoulder span
  const depth = -2.0 - (150 / Math.max(1, dist));
  let scale = Math.max(0.5, dist / 150);

  // Convert normalized screen coords to world space in front of camera
  let nx = (spine.x / video.videoWidth) * 2 - 1;
  let ny = -(spine.y / video.videoHeight) * 2 + 1;
  if (CAMERA_MODE === 'user') nx = -nx;

  const target = new THREE.Vector3(nx, ny, 0.5);
  target.unproject(camera);
  const dir = target.sub(camera.position).normalize();
  const distance = Math.abs(depth / dir.z);
  const world = camera.position.clone().add(dir.multiplyScalar(distance));

  // Smooth position
  smoothedWingsPos.lerp(world, SMOOTHING_FACTOR);
  splat.position.copy(smoothedWingsPos);

  // Scale using average bbox size to normalize across different assets
  let scaleFactor = scale * 0.5;
  if (splatBoundingBoxSize) {
    const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
    if (avg > 0) scaleFactor = (1.5 / avg) * scale;
  }
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1.0;
  splat.scale.setScalar(scaleFactor);

  // Orientation: slight downward pitch, yaw/roll from body angle
  const bodyRot = (CAMERA_MODE === 'user') ? -angle : angle;
  smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR; // gentle forward tilt
  smoothedWingsRot.y += (bodyRot * 0.5 - smoothedWingsRot.y) * SMOOTHING_FACTOR; // yaw follow
  smoothedWingsRot.z += (bodyRot * 0.2 - smoothedWingsRot.z) * SMOOTHING_FACTOR; // roll follow
  splat.rotation.copy(smoothedWingsRot);
}
