// No imports - using global THREE from CDN
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
let wingsMesh = null;
let plyLoaded = false;
let plyBoundingBoxSize = null;

// Configuration
const USE_PLY_MODEL = true;
const PLY_PATH_WINGS = './assets/wings.ply';
const TEST_MODE = false; // Set true to see PLY without tracking
const CAMERA_MODE = 'environment';

// Make accessible for debugging
window.debugWings = () => {
  console.log('=== DEBUG INFO ===');
  console.log('PLY Loaded:', plyLoaded);
  console.log('Wings Mesh:', wingsMesh);
  if (wingsMesh) {
    console.log('  Visible:', wingsMesh.visible);
    console.log('  Position:', wingsMesh.position);
    console.log('  Scale:', wingsMesh.scale);
    console.log('  Rotation:', wingsMesh.rotation);
  }
  console.log('Scene children:', scene?.children.length);
  console.log('Renderer:', renderer);
  console.log('Camera:', camera);
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
  console.log('=== INIT CALLED ===');
  
  debugLogger = new DebugLogger();
  debugLogger.log('info', '🚀 AR Back Wings Starting...');
  debugLogger.log('info', `Test Mode: ${TEST_MODE ? 'ENABLED' : 'DISABLED'}`);
  debugLogger.log('info', `Camera: ${CAMERA_MODE}`);
  debugLogger.log('info', `PLY: ${USE_PLY_MODEL ? 'ENABLED' : 'DISABLED'}`);

  // Check libraries
  if (typeof THREE === 'undefined') {
    debugLogger.log('error', '❌ Three.js NOT loaded!');
    alert('Three.js failed to load!');
    return;
  }
  debugLogger.log('success', '✅ Three.js loaded');

  if (typeof THREE.PLYLoader === 'undefined') {
    debugLogger.log('error', '❌ PLYLoader NOT loaded!');
    alert('PLYLoader failed to load!');
    return;
  }
  debugLogger.log('success', '✅ PLYLoader available');

  if (typeof tf === 'undefined') {
    debugLogger.log('error', '❌ TensorFlow NOT loaded!');
    alert('TensorFlow failed to load!');
    return;
  }
  debugLogger.log('success', '✅ TensorFlow loaded');

  if (typeof poseDetection === 'undefined') {
    debugLogger.log('error', '❌ Pose Detection NOT loaded!');
    alert('Pose Detection failed to load!');
    return;
  }
  debugLogger.log('success', '✅ Pose Detection loaded');

  const startBtn = document.getElementById('start-btn');
  const instructions = document.getElementById('instructions');

  if (!startBtn) {
    debugLogger.log('error', '❌ Start button not found!');
    return;
  }

  debugLogger.log('info', '🔘 Setting up button listener...');
  
  startBtn.addEventListener('click', async () => {
    debugLogger.log('success', '🎯 START BUTTON CLICKED!');
    instructions.classList.add('hidden');
    
    try {
      await startAR();
    } catch (error) {
      debugLogger.log('error', `Button click error: ${error.message}`);
      console.error(error);
    }
  });

  debugLogger.updateStatus('Ready - Tap Start');
  debugLogger.log('success', '✅ Init complete. Click Start!');
  debugLogger.log('info', 'Type window.debugWings() for debug info');
}

// === START AR ===
async function startAR() {
  debugLogger.log('info', '▶️ startAR() called');
  
  try {
    debugLogger.updateStatus('Checking camera...');

    if (!navigator.mediaDevices) {
      throw new Error('navigator.mediaDevices not available');
    }

    if (!navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia not available');
    }

    debugLogger.log('success', '✅ Camera API available');

    canvas = document.getElementById('output-canvas');
    ctx = canvas.getContext('2d');
    video = document.getElementById('video');

    debugLogger.updateStatus('Requesting camera...');
    debugLogger.log('info', `📹 Requesting ${CAMERA_MODE} camera...`);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: CAMERA_MODE,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    debugLogger.log('success', '✅ Camera permission granted');

    video.srcObject = stream;
    
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        debugLogger.log('success', `✅ Video playing: ${video.videoWidth}x${video.videoHeight}`);
        resolve();
      };
    });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    debugLogger.updateVideoStatus(`${video.videoWidth}x${video.videoHeight}`);

    debugLogger.updateStatus('Setting up 3D...');
    await setupThreeJS();

    debugLogger.updateStatus('Loading AI...');
    debugLogger.updateModelStatus('Loading...');
    debugLogger.log('info', '🤖 Loading MoveNet...');

    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );

    debugLogger.log('success', '✅ MoveNet loaded');
    debugLogger.updateModelStatus('Ready');

    if (TEST_MODE) {
      debugLogger.updateStatus('🧪 TEST MODE - PLY visible');
    } else {
      debugLogger.updateStatus('✅ Running - Show back!');
    }

    isRunning = true;
    debugLogger.log('success', '🎬 Starting render loop...');
    renderLoop();

  } catch (error) {
    debugLogger.log('error', `❌ startAR ERROR: ${error.message}`);
    debugLogger.log('error', `Stack: ${error.stack}`);
    debugLogger.updateStatus(`Error: ${error.message}`);
    alert(`Failed to start: ${error.message}`);
  }
}

// === SETUP THREE.JS ===
async function setupThreeJS() {
  debugLogger.log('info', '🎨 Setting up Three.js...');

  renderer = new THREE.WebGLRenderer({ 
    alpha: true, 
    antialias: true,
    preserveDrawingBuffer: true 
  });
  renderer.setSize(canvas.width, canvas.height);
  debugLogger.log('success', `Renderer: ${canvas.width}x${canvas.height}`);

  scene = new THREE.Scene();
  debugLogger.log('success', 'Scene created');

  camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  camera.position.set(0, 0, 0);
  debugLogger.log('success', 'Camera created at (0,0,0)');

  if (USE_PLY_MODEL) {
    debugLogger.log('info', `📦 Loading PLY: ${PLY_PATH_WINGS}`);
    debugLogger.updateAssetStatus('Loading PLY...');

    try {
      const loader = new THREE.PLYLoader();
      debugLogger.log('info', '✓ PLYLoader instantiated');

      const geometry = await new Promise((resolve, reject) => {
        loader.load(
          PLY_PATH_WINGS,
          (geo) => {
            debugLogger.log('success', `✅ PLY loaded! ${geo.attributes.position.count} vertices`);
            resolve(geo);
          },
          (xhr) => {
            if (xhr.lengthComputable) {
              const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
              debugLogger.log('info', `Loading: ${percent}%`);
            }
          },
          (err) => {
            debugLogger.log('error', `Load error: ${err}`);
            reject(err);
          }
        );
      });

      geometry.center();
      geometry.computeBoundingBox();
      if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
      }

      const bbox = geometry.boundingBox;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      plyBoundingBoxSize = size;

      debugLogger.log('success', `📦 Size: (${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);

      // Create point cloud material
      const material = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: geometry.attributes.color ? true : false,
        color: geometry.attributes.color ? 0xffffff : 0xff0000,
        sizeAttenuation: false,
        transparent: false,
        opacity: 1.0
      });

      wingsMesh = new THREE.Points(geometry, material);

      if (TEST_MODE) {
        wingsMesh.position.set(0, 0, -3);
        wingsMesh.scale.set(1, 1, 1);
        wingsMesh.visible = true;
        debugLogger.log('warning', '🧪 TEST: Wings at (0,0,-3)');
      } else {
        wingsMesh.visible = false;
      }

      scene.add(wingsMesh);
      debugLogger.log('success', '✅ Wings added to scene');

      leftWing = wingsMesh;
      rightWing = wingsMesh;
      plyLoaded = true;

      debugLogger.updateAssetStatus('PLY loaded ✓');

    } catch (err) {
      debugLogger.log('error', `PLY failed: ${err.message}`);
      createBoxWings();
    }
  } else {
    createBoxWings();
  }

  debugLogger.log('success', '✅ Three.js setup complete');
}

// === BOX FALLBACK ===
function createBoxWings() {
  debugLogger.log('info', '📦 Creating box placeholders...');
  
  const geo = new THREE.BoxGeometry(0.15, 0.35, 0.08);
  const mat = new THREE.MeshBasicMaterial({ 
    color: 0x00ff88, 
    transparent: true, 
    opacity: 0.8 
  });

  leftWing = new THREE.Mesh(geo, mat);
  rightWing = new THREE.Mesh(geo, mat.clone());
  rightWing.material.color.setHex(0x00ccff);

  scene.add(leftWing);
  scene.add(rightWing);

  leftWing.visible = false;
  rightWing.visible = false;

  debugLogger.updateAssetStatus('Box placeholders');
  debugLogger.log('success', '✅ Boxes created');
}

// === RENDER LOOP ===
async function renderLoop() {
  if (!isRunning) return;
  requestAnimationFrame(renderLoop);

  frameCount++;
  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    const fps = frameCount / ((now - lastFpsUpdate) / 1000);
    debugLogger.updateFPS(fps);
    
    if (wingsMesh) {
      const vis = wingsMesh.visible ? '👁️' : '🚫';
      debugLogger.log('info', `${vis} Wings: pos=(${wingsMesh.position.z.toFixed(2)}), scale=${wingsMesh.scale.x.toFixed(4)}`);
    }
    
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Draw video
  ctx.save();
  if (CAMERA_MODE === 'user') ctx.scale(-1, 1);
  ctx.drawImage(video, CAMERA_MODE === 'user' ? -canvas.width : 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Pose detection
  if (video.readyState === video.HAVE_ENOUGH_DATA && !TEST_MODE) {
    try {
      const poses = await poseModel.estimatePoses(video);

      if (poses.length > 0) {
        const kp = poses[0].keypoints;
        const ls = kp.find(k => k.name === 'left_shoulder');
        const rs = kp.find(k => k.name === 'right_shoulder');
        const lh = kp.find(k => k.name === 'left_hip');
        const rh = kp.find(k => k.name === 'right_hip');

        if (ls?.score > 0.3 && rs?.score > 0.3) {
          const dist = Math.hypot(rs.x - ls.x, rs.y - ls.y);
          
          if (!baseShoulderDistance) {
            baseShoulderDistance = dist;
          }

          const depth = -2.0 - (150 / dist);
          const scale = Math.max(0.5, dist / 150);

          let spine = {
            x: (ls.x + rs.x) / 2,
            y: (ls.y + rs.y) / 2
          };

          if (lh?.score > 0.2 && rh?.score > 0.2) {
            spine.y = (spine.y + (lh.y + rh.y) / 2) / 2;
          }

          const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);

          if (plyLoaded && wingsMesh) {
            positionWings(wingsMesh, ls, rs, spine, depth, scale, angle);
            if (!wingsMesh.visible) {
              wingsMesh.visible = true;
              debugLogger.log('success', '👁️ Wings NOW VISIBLE');
            }
          } else if (leftWing && rightWing) {
            positionBox(leftWing, ls, spine, depth, scale, angle, 'left');
            positionBox(rightWing, rs, spine, depth, scale, angle, 'right');
            leftWing.visible = true;
            rightWing.visible = true;
          }

          debugLogger.updatePoseStatus(`Detected (${ls.score.toFixed(2)})`);
          drawDebugPoints(ctx, [ls, rs, lh, rh].filter(Boolean));
        } else {
          if (wingsMesh) wingsMesh.visible = false;
          if (leftWing) leftWing.visible = false;
          if (rightWing) rightWing.visible = false;
          debugLogger.updatePoseStatus('Low confidence');
        }
      } else {
        if (wingsMesh) wingsMesh.visible = false;
        if (leftWing) leftWing.visible = false;
        if (rightWing) rightWing.visible = false;
        debugLogger.updatePoseStatus('No person');
      }
    } catch (err) {
      debugLogger.log('error', `Pose: ${err.message}`);
    }
  }

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION WINGS ===
function positionWings(wings, ls, rs, spine, depth, scale, angle) {
  if (!wings) return;

  let spineX = (spine.x / video.videoWidth) * 2 - 1;
  let spineY = -(spine.y / video.videoHeight) * 2 + 1;

  if (CAMERA_MODE === 'user') spineX = -spineX;

  const targetX = spineX;
  const targetY = spineY - (0.1 * scale);
  const targetZ = depth - (0.3 * scale);

  smoothedWingsPos.x += (targetX - smoothedWingsPos.x) * SMOOTHING_FACTOR;
  smoothedWingsPos.y += (targetY - smoothedWingsPos.y) * SMOOTHING_FACTOR;
  smoothedWingsPos.z += (targetZ - smoothedWingsPos.z) * SMOOTHING_FACTOR;

  wings.position.set(smoothedWingsPos.x, smoothedWingsPos.y, smoothedWingsPos.z);

  // Auto-scale based on bbox
  let scaleFactor;
  if (plyBoundingBoxSize) {
    const avg = (plyBoundingBoxSize.x + plyBoundingBoxSize.y + plyBoundingBoxSize.z) / 3;
    scaleFactor = (0.4 / avg) * scale;
  } else {
    scaleFactor = scale * 0.5;
  }

  wings.scale.set(scaleFactor, scaleFactor, scaleFactor);

  const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
  smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR;
  smoothedWingsRot.y += ((bodyRot * 0.5) - smoothedWingsRot.y) * SMOOTHING_FACTOR;
  smoothedWingsRot.z += ((bodyRot * 0.2) - smoothedWingsRot.z) * SMOOTHING_FACTOR;

  wings.rotation.set(smoothedWingsRot.x, smoothedWingsRot.y, smoothedWingsRot.z);
}

// === POSITION BOX ===
function positionBox(wing, shoulder, spine, depth, scale, angle, side) {
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
  
  const rot = side === 'left' ? smoothedLeftRot : smoothedRightRot;
  rot.y += ((baseRotY + bodyRot * 0.5) - rot.y) * SMOOTHING_FACTOR;
  wing.rotation.y = rot.y;
}

// === DEBUG POINTS ===
function drawDebugPoints(ctx, keypoints) {
  ctx.fillStyle = '#00ff88';
  keypoints.forEach(kp => {
    if (kp?.score > 0.3) {
      let x = kp.x;
      if (CAMERA_MODE === 'user') x = canvas.width - x;
      ctx.beginPath();
      ctx.arc(x, kp.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// === START ON LOAD ===
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, calling init()');
  init();
});
