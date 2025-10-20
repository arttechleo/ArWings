// AR Back Wings — Spark Gaussian Splat (Safari-safe, no import map)
// -----------------------------------------------------------------
// Uses absolute URLs for all imports so older Safari versions work.
// Adds iOS camera flags and user-gesture friendly startup.

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.178.0/three.module.js';
import { SplatMesh /*, SparkRenderer*/ } from 'https://sparkjs.dev/releases/spark/0.1.9/spark.module.js';
import * as tf from 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.15.0/dist/tf.es2017.js';
import * as poseDetection from 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.esm.js';

// --------------------- Config --------------------------
const SPLAT_PATH = '/assets/wings.spz'; // absolute path is safest on Safari hosting
const CAMERA_MODE = 'environment';      // 'environment' | 'user'
const MIN_SHOULDER_SCORE = 0.4;
const SMOOTHING_FACTOR = 0.4;

// --------------------- State ---------------------------
let scene, camera, renderer;
let video, canvas, ctx;
let poseModel;
let isRunning = false;

let frameCount = 0;
let lastFpsUpdate = performance.now();

let wingsMesh = null;
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
    clearBtn.addEventListener('click', () => {
      if (this.logsContainer) this.logsContainer.innerHTML = '';
    });
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

  if (!startBtn || !instructions) {
    console.error('Missing UI elements: #start-btn or #instructions');
    return;
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try {
      instructions.classList.add('hidden');
      await startAR();
    } catch (e) {
      debugLogger.log('error', `Start failed: ${e?.message ?? e}`);
      instructions.classList.remove('hidden');
      startBtn.disabled = false;
    }
  });
});

// -------------------- Start AR ------------------------
async function startAR() {
  debugLogger.updateStatus('status', 'Starting…');

  // iOS/Safari video flags — MUCH more reliable
  video = document.getElementById('video');
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.muted = true; // even though we don't use audio, helps autoplay policies

  // Secure context is required
  if (!window.isSecureContext) {
    throw new Error('This page is not in a secure context. Use HTTPS or http://localhost for camera access.');
  }

  // TFJS backend
  try {
    await tf.setBackend('webgl');
    await tf.ready();
    debugLogger.log('success', `TFJS backend: ${tf.getBackend()}`);
  } catch (e) {
    debugLogger.log('warning', `TFJS backend fallback: ${e?.message ?? e}`);
  }

  canvas = document.getElementById('output-canvas');
  ctx = canvas.getContext('2d', { alpha: true });

  // Camera stream (Safari prefers ideal sizes but will pick supported ones)
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

    // iOS sometimes needs explicit play() after assigning srcObject
    await video.play();
  } catch (e) {
    debugLogger.log('error', `getUserMedia error: ${e?.message ?? e}`);
    debugLogger.updateStatus('video', '❌ Permission / camera error');
    throw e;
  }

  await new Promise(resolve => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  debugLogger.updateStatus('video', `✅ ${video.videoWidth}x${video.videoHeight}`);

  // Sizing
  resizeToVideo();
  window.addEventListener('resize', resizeToVideo);
  window.addEventListener('orientationchange', () => setTimeout(resizeToVideo, 200));

  // Three.js + Spark
  await setupThree();

  // Pose model (tfjs runtime only → no mediapipe mapping needed)
  debugLogger.log('info', '🧠 Loading Pose Detection model…');
  if (!poseDetection?.movenet?.modelType || !poseDetection?.SupportedModels?.MoveNet) {
    throw new Error('pose-detection ESM failed to load (Safari). Check the CDN URL in script imports.');
  }

  const detectorConfig = {
    runtime: 'tfjs',
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
  };

  try {
    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      detectorConfig
    );
    debugLogger.updateStatus('model', '✅ MoveNet loaded');
  } catch (e) {
    debugLogger.log('error', `createDetector failed: ${e?.message ?? e}`);
    throw e;
  }

  isRunning = true;
  renderLoop();
}

function resizeToVideo() {
  if (!video || !canvas) return;
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

  debugLogger.log('info', `Canvas ${canvas.width}×${canvas.height} (CSS ${w}×${h}) DPR ${dpr}`);
}

// -------------------- Three + Spark -------------------
async function setupThree() {
  debugLogger.log('info', '🎨 Setting up Three.js scene…');

  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.width, canvas.height, false);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  camera.position.set(0, 0, 0);

  // Optional SparkRenderer for DOF/post
  // const spark = new SparkRenderer({ renderer });
  // camera.add(spark);

  // Load SplatMesh
  debugLogger.log('info', `🌟 Loading Spark splat: ${SPLAT_PATH}`);
  debugLogger.updateStatus('asset', 'Loading…');

  try {
    wingsMesh = new SplatMesh({ url: SPLAT_PATH });
    scene.add(wingsMesh);

    await wingsMesh.initialized;

    const bbox = wingsMesh.getBoundingBox(true);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    splatBoundingBoxSize = size;

    wingsMesh.visible = false;
    splatLoaded = true;

    debugLogger.updateStatus('asset', '✅ Loaded');
    debugLogger.log('success', `Splat size: ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}`);
  } catch (err) {
    debugLogger.updateStatus('asset', '❌ Load failed');
    debugLogger.log('error', `Splat load error: ${err?.message ?? err} | URL: ${SPLAT_PATH}`);
  }
}

// -------------------- Main Loop -----------------------
async function renderLoop() {
  if (!isRunning) return;
  requestAnimationFrame(renderLoop);

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
    debugLogger.log('warning', `Pose estimate warning: ${e?.message ?? e}`);
  }

  // Render 3D and composite
  if (renderer && camera) {
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0);
  }
}

// ----------- Pose → Splat transform (core) -------------
function applyPoseToSplat(ls, rs, splat) {
  const dx = rs.x - ls.x;
  const dy = rs.y - ls.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const angle = Math.atan2(dy, dx);

  const spine = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + dist * 0.15 };

  const depth = -2.0 - (150 / Math.max(1, dist));
  let scale = Math.max(0.5, dist / 150);

  let nx = (spine.x / video.videoWidth) * 2 - 1;
  let ny = -(spine.y / video.videoHeight) * 2 + 1;
  if (CAMERA_MODE === 'user') nx = -nx;

  const target = new THREE.Vector3(nx, ny, 0.5);
  target.unproject(camera);
  const dir = target.sub(camera.position).normalize();
  const distance = Math.abs(depth / (dir.z || 1e-6));
  const world = camera.position.clone().add(dir.multiplyScalar(distance));

  smoothedWingsPos.lerp(world, SMOOTHING_FACTOR);
  splat.position.copy(smoothedWingsPos);

  let scaleFactor = scale * 0.5;
  if (splatBoundingBoxSize) {
    const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
    if (avg > 0) scaleFactor = (1.5 / avg) * scale;
  }
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1.0;
  splat.scale.setScalar(scaleFactor);

  const bodyRot = (CAMERA_MODE === 'user') ? -angle : angle;
  smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR;
  smoothedWingsRot.y += (bodyRot * 0.5 - smoothedWingsRot.y) * SMOOTHING_FACTOR;
  smoothedWingsRot.z += (bodyRot * 0.2 - smoothedWingsRot.z) * SMOOTHING_FACTOR;
  splat.rotation.copy(smoothedWingsRot);
}
