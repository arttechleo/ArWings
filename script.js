import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';

let scene, camera, renderer;
let leftWing, rightWing;
let video, canvas, ctx;
let poseModel;
let debugLogger;
let isRunning = false;
let frameCount = 0;
let lastFpsUpdate = Date.now();

// Smoothing variables
let smoothedWingsPos = { x: 0, y: 0, z: 0 };
let smoothedWingsRot = { x: 0, y: 0, z: 0 };
let smoothedLeftPos = { x: 0, y: 0, z: 0 };
let smoothedRightPos = { x: 0, y: 0, z: 0 };
let smoothedLeftRot = { x: 0, y: 0, z: 0 };
let smoothedRightRot = { x: 0, y: 0, z: 0 };
const SMOOTHING_FACTOR = 0.4;

let baseShoulderDistance = null;

// Gaussian Splat viewer and mesh
let viewer = null;
let splatMesh = null;
let splatLoaded = false;

// Configuration
const USE_GAUSSIAN_SPLAT = true; // TRUE Gaussian Splatting
const SPLAT_PLY_PATH = 'assets/wings.ply'; // Your Gaussian Splat PLY
const TEST_MODE = false; // Set true to see splat in front of camera

const CAMERA_MODE = 'environment';

// Debug helper
window.debugSplat = () => {
  if (splatMesh) {
    console.log('Splat mesh:', {
      visible: splatMesh.visible,
      position: splatMesh.position,
      scale: splatMesh.scale,
      rotation: splatMesh.rotation
    });
  }
  if (viewer) {
    console.log('Viewer:', viewer);
  }
};

// === DEBUG LOGGER CLASS ===
class DebugLogger {
  constructor() {
    this.logsContainer = document.getElementById('debug-logs');
    this.statusText = document.getElementById('status-text');
    this.videoStatus = document.getElementById('video-status');
    this.modelStatus = document.getElementById('model-status');
    this.poseStatus = document.getElementById('pose-status');
    this.assetStatus = document.getElementById('asset-status');
    this.fpsCounter = document.getElementById('fps-counter');
    this.maxLogs = 50;
    
    this.setupControls();
  }

  setupControls() {
    const toggleBtn = document.getElementById('toggle-debug');
    const clearBtn = document.getElementById('clear-debug');
    const panel = document.getElementById('debug-panel');

    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      toggleBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
    });

    clearBtn.addEventListener('click', () => {
      this.logsContainer.innerHTML = '';
    });
  }

  log(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `debug-log ${type}`;
    logEntry.innerHTML = `<span class="debug-timestamp">[${timestamp}]</span>${message}`;
    
    this.logsContainer.insertBefore(logEntry, this.logsContainer.firstChild);

    while (this.logsContainer.children.length > this.maxLogs) {
      this.logsContainer.removeChild(this.logsContainer.lastChild);
    }

    console[type === 'error' ? 'error' : 'log'](`[${type}] ${message}`);
  }

  updateStatus(status) { this.statusText.textContent = status; }
  updateVideoStatus(status) { this.videoStatus.textContent = status; }
  updateModelStatus(status) { this.modelStatus.textContent = status; }
  updatePoseStatus(status) { this.poseStatus.textContent = status; }
  updateAssetStatus(status) { this.assetStatus.textContent = status; }
  updateFPS(fps) { this.fpsCounter.textContent = fps.toFixed(1); }
}

// === INITIALIZE ===
function init() {
  debugLogger = new DebugLogger();
  debugLogger.log('info', '=== AR Back Wings with Gaussian Splatting ===');
  debugLogger.log('info', `Mode: ${USE_GAUSSIAN_SPLAT ? 'GAUSSIAN SPLATTING' : 'Point Cloud'}`);
  debugLogger.log('info', `Test Mode: ${TEST_MODE ? 'ENABLED' : 'DISABLED'}`);
  debugLogger.log('info', `Camera: ${CAMERA_MODE}`);
  debugLogger.log('success', 'Three.js loaded');

  if (typeof tf === 'undefined') {
    debugLogger.log('error', 'TensorFlow.js not loaded!');
    return;
  }
  debugLogger.log('success', 'TensorFlow.js loaded');

  if (typeof poseDetection === 'undefined') {
    debugLogger.log('error', 'Pose Detection not loaded!');
    return;
  }
  debugLogger.log('success', 'Pose Detection loaded');

  if (USE_GAUSSIAN_SPLAT) {
    if (typeof GaussianSplats3D === 'undefined') {
      debugLogger.log('error', 'Gaussian Splats 3D not loaded!');
      debugLogger.log('warning', 'Will fallback to point cloud');
    } else {
      debugLogger.log('success', 'Gaussian Splats 3D library loaded');
    }
  }

  const startBtn = document.getElementById('start-btn');
  const instructions = document.getElementById('instructions');

  startBtn.addEventListener('click', async () => {
    debugLogger.log('info', 'Start button clicked!');
    instructions.classList.add('hidden');
    await startAR();
  });

  debugLogger.updateStatus('Ready - Tap Start');
  debugLogger.log('success', 'Init complete. Type window.debugSplat() for info');
}

// === START AR ===
async function startAR() {
  try {
    debugLogger.updateStatus('Initializing...');

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera not supported');
    }

    canvas = document.getElementById('output-canvas');
    ctx = canvas.getContext('2d');
    video = document.getElementById('video');

    debugLogger.updateStatus('Requesting camera...');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: CAMERA_MODE,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    await new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    debugLogger.log('success', `Video: ${video.videoWidth}x${video.videoHeight}`);

    await setupThreeJS();

    debugLogger.updateStatus('Loading AI model...');
    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    debugLogger.log('success', 'MoveNet loaded');

    debugLogger.updateStatus(TEST_MODE ? 'TEST MODE Active' : 'Running');
    isRunning = true;
    renderLoop();

  } catch (error) {
    debugLogger.log('error', `Init error: ${error.message}`);
    alert(`Failed: ${error.message}`);
  }
}

// === SETUP THREE.JS with Gaussian Splatting ===
async function setupThreeJS() {
  renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    antialias: false,
    preserveDrawingBuffer: true 
  });
  renderer.setSize(canvas.width, canvas.height);
  debugLogger.log('info', `Renderer: ${canvas.width}x${canvas.height}`);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  camera.position.set(0, 0, 0);

  if (USE_GAUSSIAN_SPLAT && typeof GaussianSplats3D !== 'undefined') {
    debugLogger.log('info', '🌟 Loading Gaussian Splat...');
    debugLogger.updateAssetStatus('Loading Gaussian Splat...');

    try {
      // Create Gaussian Splat Viewer
      viewer = new GaussianSplats3D.Viewer({
        cameraUp: [0, 1, 0],
        initialCameraPosition: [0, 0, 0],
        initialCameraLookAt: [0, 0, -1],
        dynamicScene: true,
        renderer: renderer,
        camera: camera,
        scene: scene,
        useBuiltInControls: false,
        gpuAcceleratedSort: true,
        integerBasedSort: true,
        sharedMemoryForWorkers: false,
        halfPrecisionCovariancesOnGPU: true,
        webXRMode: GaussianSplats3D.WebXRMode.None,
        renderMode: GaussianSplats3D.RenderMode.Always,
        sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant
      });

      debugLogger.log('success', 'Viewer created');

      // Load the PLY as Gaussian Splat
      await viewer.addSplatScene(SPLAT_PLY_PATH, {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1]
      });

      debugLogger.log('success', '✅ Gaussian Splat loaded!');

      // Get the splat mesh
      splatMesh = viewer.splatMesh;
      
      if (TEST_MODE) {
        splatMesh.position.set(0, 0, -3);
        splatMesh.scale.set(0.5, 0.5, 0.5);
        splatMesh.visible = true;
        debugLogger.log('warning', '🧪 TEST: Splat at (0,0,-3) scale=0.5');
      } else {
        splatMesh.visible = false;
      }

      leftWing = splatMesh;
      rightWing = splatMesh;
      splatLoaded = true;

      debugLogger.updateAssetStatus('Gaussian Splat ✓');
      debugLogger.log('success', '🎉 Ready for tracking!');

    } catch (err) {
      debugLogger.log('error', `Splat failed: ${err.message}`);
      debugLogger.log('error', err.stack);
      createBoxWings();
    }
  } else {
    debugLogger.log('info', 'Creating box placeholders');
    createBoxWings();
  }
}

// === BOX FALLBACK ===
function createBoxWings() {
  const geo = new THREE.BoxGeometry(0.15, 0.35, 0.08);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8 });

  leftWing = new THREE.Mesh(geo, mat);
  rightWing = new THREE.Mesh(geo, mat.clone());
  rightWing.material.color.setHex(0x00ccff);

  scene.add(leftWing);
  scene.add(rightWing);
  leftWing.visible = false;
  rightWing.visible = false;

  debugLogger.updateAssetStatus('Box placeholders');
  debugLogger.log('success', 'Boxes created');
}

// === RENDER LOOP ===
async function renderLoop() {
  if (!isRunning) return;
  requestAnimationFrame(renderLoop);

  frameCount++;
  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    debugLogger.updateFPS(frameCount / ((now - lastFpsUpdate) / 1000));
    
    if (splatMesh) {
      debugLogger.log('info', `Splat: visible=${splatMesh.visible}, pos=(${splatMesh.position.x.toFixed(2)},${splatMesh.position.y.toFixed(2)},${splatMesh.position.z.toFixed(2)})`);
    }
    
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Draw video
  ctx.save();
  if (CAMERA_MODE === 'user') ctx.scale(-1, 1);
  ctx.drawImage(video, CAMERA_MODE === 'user' ? -canvas.width : 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Pose tracking
  if (video.readyState === video.HAVE_ENOUGH_DATA && !TEST_MODE) {
    try {
      const poses = await poseModel.estimatePoses(video);

      if (poses.length > 0) {
        const kp = poses[0].keypoints;
        const lShoulder = kp.find(k => k.name === 'left_shoulder');
        const rShoulder = kp.find(k => k.name === 'right_shoulder');
        const lHip = kp.find(k => k.name === 'left_hip');
        const rHip = kp.find(k => k.name === 'right_hip');

        if (lShoulder?.score > 0.3 && rShoulder?.score > 0.3) {
          const shoulderDist = Math.hypot(rShoulder.x - lShoulder.x, rShoulder.y - lShoulder.y);
          
          if (!baseShoulderDistance) {
            baseShoulderDistance = shoulderDist;
            debugLogger.log('info', `Shoulder dist: ${shoulderDist.toFixed(2)}px`);
          }

          const depth = -2.0 - (150 / shoulderDist);
          const scale = Math.max(0.5, shoulderDist / 150);

          let spine = {
            x: (lShoulder.x + rShoulder.x) / 2,
            y: (lShoulder.y + rShoulder.y) / 2
          };

          if (lHip?.score > 0.2 && rHip?.score > 0.2) {
            spine.y = (spine.y + (lHip.y + rHip.y) / 2) / 2;
          }

          const angle = Math.atan2(rShoulder.y - lShoulder.y, rShoulder.x - lShoulder.x);

          if (splatLoaded && splatMesh) {
            positionSplatOnBack(splatMesh, lShoulder, rShoulder, spine, depth, scale, angle);
            if (!splatMesh.visible) {
              splatMesh.visible = true;
              debugLogger.log('success', '✅ Splat visible');
            }
          } else if (leftWing && rightWing) {
            // Box fallback positioning
            positionBoxWing(leftWing, lShoulder, spine, depth, scale, angle, 'left');
            positionBoxWing(rightWing, rShoulder, spine, depth, scale, angle, 'right');
            leftWing.visible = true;
            rightWing.visible = true;
          }

          debugLogger.updatePoseStatus(`Detected (${lShoulder.score.toFixed(2)})`);
          drawDebugPoints(ctx, [lShoulder, rShoulder, lHip, rHip].filter(Boolean));
        } else {
          if (splatMesh) splatMesh.visible = false;
          if (leftWing) leftWing.visible = false;
          if (rightWing) rightWing.visible = false;
          debugLogger.updatePoseStatus('Low confidence');
        }
      } else {
        if (splatMesh) splatMesh.visible = false;
        if (leftWing) leftWing.visible = false;
        if (rightWing) rightWing.visible = false;
        debugLogger.updatePoseStatus('No person');
      }
    } catch (err) {
      debugLogger.log('error', `Pose: ${err.message}`);
    }
  }

  // Render
  if (viewer && splatLoaded) {
    viewer.update();
    viewer.render();
  } else {
    renderer.render(scene, camera);
  }
  
  ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION GAUSSIAN SPLAT ===
function positionSplatOnBack(splat, lSh, rSh, spine, depth, scale, angle) {
  if (!splat) return;

  let spineX = (spine.x / video.videoWidth) * 2 - 1;
  let spineY = -(spine.y / video.videoHeight) * 2 + 1;

  if (CAMERA_MODE === 'user') spineX = -spineX;

  const targetX = spineX;
  const targetY = spineY - (0.1 * scale);
  const targetZ = depth - (0.3 * scale);

  smoothedWingsPos.x += (targetX - smoothedWingsPos.x) * SMOOTHING_FACTOR;
  smoothedWingsPos.y += (targetY - smoothedWingsPos.y) * SMOOTHING_FACTOR;
  smoothedWingsPos.z += (targetZ - smoothedWingsPos.z) * SMOOTHING_FACTOR;

  splat.position.set(smoothedWingsPos.x, smoothedWingsPos.y, smoothedWingsPos.z);
  
  const scaleFactor = scale * 0.3; // Adjust based on your splat size
  splat.scale.set(scaleFactor, scaleFactor, scaleFactor);

  const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
  const targetRotX = -0.2;
  const targetRotY = bodyRot * 0.5;
  const targetRotZ = bodyRot * 0.2;

  smoothedWingsRot.x += (targetRotX - smoothedWingsRot.x) * SMOOTHING_FACTOR;
  smoothedWingsRot.y += (targetRotY - smoothedWingsRot.y) * SMOOTHING_FACTOR;
  smoothedWingsRot.z += (targetRotZ - smoothedWingsRot.z) * SMOOTHING_FACTOR;

  splat.rotation.set(smoothedWingsRot.x, smoothedWingsRot.y, smoothedWingsRot.z);
}

// === POSITION BOX (fallback) ===
function positionBoxWing(wing, shoulder, spine, depth, scale, angle, side) {
  if (!wing) return;
  
  let shX = (shoulder.x / video.videoWidth) * 2 - 1;
  let shY = -(shoulder.y / video.videoHeight) * 2 + 1;
  let spX = (spine.x / video.videoWidth) * 2 - 1;
  let spY = -(spine.y / video.videoHeight) * 2 + 1;

  if (CAMERA_MODE === 'user') {
    shX = -shX;
    spX = -spX;
  }

  const dx = shX - spX;
  const dy = shY - spY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  const targetX = spX + (dx / dist) * dist * 0.7;
  const targetY = spY + (dy / dist) * dist * 0.7 - (0.15 * scale);
  const targetZ = depth - (0.4 * scale);

  const pos = side === 'left' ? smoothedLeftPos : smoothedRightPos;
  pos.x += (targetX - pos.x) * SMOOTHING_FACTOR;
  pos.y += (targetY - pos.y) * SMOOTHING_FACTOR;
  pos.z += (targetZ - pos.z) * SMOOTHING_FACTOR;

  wing.position.set(pos.x, pos.y, pos.z);
  wing.scale.set(scale * 0.8, scale * 1.2, scale * 0.6);

  const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
  const baseRotY = side === 'left' ? 0.5 : -0.5;
  const targetRotY = baseRotY + (bodyRot * 0.5);

  const rot = side === 'left' ? smoothedLeftRot : smoothedRightRot;
  rot.y += (targetRotY - rot.y) * SMOOTHING_FACTOR;
  wing.rotation.y = rot.y;
}

// === DEBUG POINTS ===
function drawDebugPoints(ctx, keypoints) {
  ctx.fillStyle = '#00ff88';
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      let x = kp.x;
      if (CAMERA_MODE === 'user') x = canvas.width - x;
      ctx.beginPath();
      ctx.arc(x, kp.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// === START ===
window.addEventListener('DOMContentLoaded', init);
