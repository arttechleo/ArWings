// Gaussian Splatting loader - inline implementation
// NOTE: This is a very basic parser and may not work for all .ply files.
// It assumes a simple structure and does not parse all Gaussian Splat attributes.
class GaussianSplatLoader {
  constructor() {
    this.splatData = null;
  }

  async load(url, onProgress) {
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      
      if (onProgress) {
        onProgress({ loaded: buffer.byteLength, total: buffer.byteLength });
      }

      return this.parsePLY(buffer);
    } catch (error) {
      throw new Error(`Gaussian Splat load failed: ${error.message}`);
    }
  }

  parsePLY(buffer) {
    const ubuf = new Uint8Array(buffer);
    const header = new TextDecoder().decode(ubuf.slice(0, 1024));
    
    let vertexCount = 0;
    const match = header.match(/element vertex (\d+)/);
    if (match) {
      vertexCount = parseInt(match[1]);
    }

    if (vertexCount === 0) {
      throw new Error('Invalid PLY: no vertices found');
    }

    // Find end of header
    const headerEnd = header.indexOf('end_header\n') + 11;
    
    // Parse as simple point cloud for now
    const dataView = new DataView(buffer, headerEnd);
    const vertexSize = 24; // Assuming x, y, z as floats + colors. THIS IS A GUESS.
    
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      const offset = i * vertexSize;
      
      // Read position (x, y, z)
      positions[i * 3] = dataView.getFloat32(offset, true);
      positions[i * 3 + 1] = dataView.getFloat32(offset + 4, true);
      positions[i * 3 + 2] = dataView.getFloat32(offset + 8, true);
      
      // Read color (r, g, b) if available
      if (vertexSize >= 15) {
        colors[i * 3] = dataView.getUint8(offset + 12) / 255;
        colors[i * 3 + 1] = dataView.getUint8(offset + 13) / 255;
        colors[i * 3 + 2] = dataView.getUint8(offset + 14) / 255;
      } else {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 1.0;
        colors[i * 3 + 2] = 1.0;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    geometry.center();

    return geometry;
  }
}

// Main app variables
let scene, camera, renderer;
let leftWing, rightWing;
let video, canvas, ctx;
let poseModel;
let debugLogger;
let isRunning = false;
let frameCount = 0;
let lastFpsUpdate = Date.now();

let smoothedWingsPos = { x: 0, y: 0, z: 0 };
let smoothedWingsRot = { x: 0, y: 0, z: 0 };
let smoothedLeftPos = { x: 0, y: 0, z: 0 };
let smoothedRightPos = { x: 0, y: 0, z: 0 };
let smoothedLeftRot = { x: 0, y: 0, z: 0 };
let smoothedRightRot = { x: 0, y: 0, z: 0 };
const SMOOTHING_FACTOR = 0.4;

let baseShoulderDistance = null;
let wingsMesh = null;
let splatLoaded = false;
let splatBoundingBoxSize = null;

// Configuration
const USE_GAUSSIAN_SPLAT = true;
const SPLAT_PATH = 'assets/wings.ply';
const TEST_MODE = false; // Set true to see splat without tracking
const CAMERA_MODE = 'environment';

window.debugWings = () => {
  console.log('=== DEBUG ===');
  console.log('Splat loaded:', splatLoaded);
  console.log('Wings mesh:', wingsMesh);
  if (wingsMesh) {
    console.log('  Visible:', wingsMesh.visible);
    console.log('  Position:', wingsMesh.position);
    console.log('  Scale:', wingsMesh.scale);
    console.log('  Vertices:', wingsMesh.geometry.attributes.position.count);
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
  console.log('=== INIT ===');
  
  debugLogger = new DebugLogger();
  debugLogger.log('info', '🚀 AR Gaussian Splat Wings');
  debugLogger.log('info', `Splat path: ${SPLAT_PATH}`);
  debugLogger.log('info', `Test mode: ${TEST_MODE}`);

  if (typeof THREE === 'undefined') {
    debugLogger.log('error', '❌ Three.js not loaded');
    return;
  }
  debugLogger.log('success', '✅ Three.js loaded');

  if (typeof tf === 'undefined') {
    debugLogger.log('error', '❌ TensorFlow not loaded');
    return;
  }
  debugLogger.log('success', '✅ TensorFlow loaded');

  if (typeof poseDetection === 'undefined') {
    debugLogger.log('error', '❌ Pose Detection not loaded');
    return;
  }
  debugLogger.log('success', '✅ Pose Detection loaded');

  const startBtn = document.getElementById('start-btn');
  const instructions = document.getElementById('instructions');

  startBtn.addEventListener('click', async () => {
    debugLogger.log('success', '🎯 START CLICKED');
    instructions.classList.add('hidden');
    await startAR();
  });

  // Add test button
  const testBtn = document.getElementById('test-splat-btn');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      if (wingsMesh) {
        wingsMesh.position.set(0, 0, -3);
        wingsMesh.scale.set(1, 1, 1);
        wingsMesh.rotation.set(0, 0, 0);
        wingsMesh.visible = true;
        debugLogger.log('success', '🧪 Test: Splat forced visible at (0,0,-3)');
      } else {
        debugLogger.log('error', 'No splat mesh loaded yet');
      }
    });
  }

  debugLogger.updateStatus('Ready');
  debugLogger.log('success', '✅ Ready to start');
}

// === START AR ===
async function startAR() {
  try {
    debugLogger.log('info', '▶️ Starting AR...');

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
    
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    debugLogger.log('success', `✅ Video: ${video.videoWidth}x${video.videoHeight}`);

    await setupThreeJS();

    debugLogger.updateStatus('Loading AI...');
    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );

    debugLogger.log('success', '✅ MoveNet loaded');
    debugLogger.updateStatus(TEST_MODE ? '🧪 TEST MODE' : '✅ Running');

    isRunning = true;
    renderLoop();

  } catch (error) {
    debugLogger.log('error', `❌ Error: ${error.message}`);
    alert(`Failed: ${error.message}`);
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

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  camera.position.set(0, 0, 0);

  if (USE_GAUSSIAN_SPLAT) {
    debugLogger.log('info', '🌟 Loading Gaussian Splat...');
    debugLogger.updateAssetStatus('Loading splat...');

    try {
      const loader = new GaussianSplatLoader();
      
      debugLogger.log('info', `Fetching: ${SPLAT_PATH}`);
      
      const geometry = await loader.load(SPLAT_PATH, (progress) => {
        debugLogger.log('info', `Loaded: ${(progress.loaded / 1024).toFixed(1)} KB`);
      });

      const vertexCount = geometry.attributes.position.count;
      debugLogger.log('success', `✅ Splat loaded: ${vertexCount} points`);

      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox;
      
      if (!bbox) {
        debugLogger.log('error', 'Bounding box is null!');
        throw new Error('Failed to compute bounding box');
      }

      const size = new THREE.Vector3();
      bbox.getSize(size);
      
      if (isNaN(size.x) || isNaN(size.y) || isNaN(size.z)) {
        debugLogger.log('error', `Invalid bbox size: ${size.x}, ${size.y}, ${size.z}`);
        debugLogger.log('warning', 'Setting default bbox size');
        size.set(1, 1, 1);
      }
      
      splatBoundingBoxSize = size;

      debugLogger.log('success', `📦 Bbox: Min(${bbox.min.x.toFixed(2)}, ${bbox.min.y.toFixed(2)}, ${bbox.min.z.toFixed(2)})`);
      debugLogger.log('success', `📦 Bbox: Max(${bbox.max.x.toFixed(2)}, ${bbox.max.y.toFixed(2)}, ${bbox.max.z.toFixed(2)})`);
      debugLogger.log('success', `📦 Size: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`);

      const material = new THREE.PointsMaterial({
        size: 0.04,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });

      wingsMesh = new THREE.Points(geometry, material);

      if (TEST_MODE) {
        wingsMesh.position.set(0, 0, -3);
        wingsMesh.scale.set(0.5, 0.5, 0.5);
        wingsMesh.visible = true;
        debugLogger.log('warning', '🧪 TEST: Splat at (0,0,-3) scale=0.5');
      } else {
        wingsMesh.visible = false;
        debugLogger.log('info', 'Splat hidden, waiting for pose detection');
      }

      scene.add(wingsMesh);
      
      leftWing = wingsMesh;
      rightWing = wingsMesh;
      splatLoaded = true;

      debugLogger.updateAssetStatus('✅ Splat loaded');
      debugLogger.log('success', '🎉 Ready for tracking!');

    } catch (err) {
      debugLogger.log('error', `❌ Splat failed: ${err.message}`);
      debugLogger.log('error', err.stack);
      debugLogger.log('warning', 'Creating fallback boxes...');
      createBoxWings();
    }
  } else {
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
  debugLogger.log('success', '✅ Boxes created');
}

// === RENDER LOOP ===
async function renderLoop() {
  if (!isRunning) return;
  requestAnimationFrame(renderLoop);

  frameCount++;
  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    debugLogger.updateFPS(frameCount / ((now - lastFpsUpdate) / 1000));
    
    if (wingsMesh) {
      const vis = wingsMesh.visible ? '👁️ VISIBLE' : '🚫 HIDDEN';
      const pos = `pos=(${wingsMesh.position.x.toFixed(2)}, ${wingsMesh.position.y.toFixed(2)}, ${wingsMesh.position.z.toFixed(2)})`;
      const scl = `scale=${wingsMesh.scale.x.toFixed(4)}`;
      debugLogger.log('info', `${vis} | ${pos} | ${scl}`);
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
        const ls = kp.find(k => k.name === 'left_shoulder');
        const rs = kp.find(k => k.name === 'right_shoulder');
        const lh = kp.find(k => k.name === 'left_hip');
        const rh = kp.find(k => k.name === 'right_hip');

        if (ls?.score > 0.3 && rs?.score > 0.3) {
          const dist = Math.hypot(rs.x - ls.x, rs.y - ls.y);
          
          if (!baseShoulderDistance) {
            baseShoulderDistance = dist;
            debugLogger.log('info', `👤 Shoulder width: ${dist.toFixed(2)}px`);
          }

          const depth = -2.0 - (150 / dist);
          const scale = Math.max(0.5, dist / 150);

          let spine = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
          
          if (lh?.score > 0.2 && rh?.score > 0.2) {
            spine.y = (spine.y + (lh.y + rh.y) / 2) / 2;
          }

          const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);

          if (splatLoaded && wingsMesh) {
            positionSplat(wingsMesh, ls, rs, spine, depth, scale, angle);
            
            if (!wingsMesh.visible) {
              wingsMesh.visible = true;
              debugLogger.log('success', '👁️ SPLAT NOW VISIBLE');
            }
          } else if (leftWing && rightWing) {
            positionBox(leftWing, ls, spine, depth, scale, angle, 'left');
            positionBox(rightWing, rs, spine, depth, scale, angle, 'right');
            leftWing.visible = true;
            rightWing.visible = true;
          }

          debugLogger.updatePoseStatus(`✅ Shoulders (${ls.score.toFixed(2)})`);
          drawDebugPoints(ctx, [ls, rs, lh, rh].filter(Boolean));
        } else {
          if (wingsMesh) wingsMesh.visible = false;
          if (leftWing) leftWing.visible = false;
          if (rightWing) rightWing.visible = false;
          debugLogger.updatePoseStatus('⚠️ Low confidence');
          baseShoulderDistance = null;
        }
      } else {
        if (wingsMesh) wingsMesh.visible = false;
        if (leftWing) leftWing.visible = false;
        if (rightWing) rightWing.visible = false;
        debugLogger.updatePoseStatus('❌ No person');
        baseShoulderDistance = null;
      }
    } catch (err) {
      debugLogger.log('error', `Pose error: ${err.message}`);
    }
  }

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION SPLAT (REVISED) ===
// This version correctly converts 2D screen coordinates to 3D world space.
// The key is using vector.unproject(camera) to translate the point from the
// screen into the 3D scene at the correct depth.
function positionSplat(splat, ls, rs, spine, depth, scale, angle) {
    if (!splat) {
        debugLogger.log('error', 'positionSplat: splat is null');
        return;
    }

    // 1. Convert screen coordinates to Normalized Device Coordinates (-1 to +1)
    let spineX = (spine.x / video.videoWidth) * 2 - 1;
    let spineY = -(spine.y / video.videoHeight) * 2 + 1;

    if (CAMERA_MODE === 'user') {
        spineX = -spineX;
    }

    // 2. Create a 3D vector and "unproject" it into the world
    // This is the CRUCIAL FIX. We project the 2D point into 3D space.
    const worldPosition = new THREE.Vector3(spineX, spineY, 0.5);
    worldPosition.unproject(camera);

    // We get the direction from the camera to this point and scale it by depth
    const dir = worldPosition.sub(camera.position).normalize();
    const distance = Math.abs(depth / dir.z); // Adjust distance based on depth
    const targetPos = camera.position.clone().add(dir.multiplyScalar(distance));
    
    // Apply a slight downward shift relative to the user
    const downwardShift = 0.1 * scale;
    targetPos.y -= downwardShift;

    // 3. Smooth the final position
    smoothedWingsPos.x += (targetPos.x - smoothedWingsPos.x) * SMOOTHING_FACTOR;
    smoothedWingsPos.y += (targetPos.y - smoothedWingsPos.y) * SMOOTHING_FACTOR;
    smoothedWingsPos.z += (targetPos.z - smoothedWingsPos.z) * SMOOTHING_FACTOR;

    splat.position.set(smoothedWingsPos.x, smoothedWingsPos.y, smoothedWingsPos.z);

    // --- The rest of your scaling and rotation logic can remain the same ---
    let scaleFactor;
    if (splatBoundingBoxSize && !isNaN(splatBoundingBoxSize.x)) {
        const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
        if (avg > 0) {
            // Target size: make wings about 1.5 world units wide relative to the user
            scaleFactor = (1.5 / avg) * scale;
        } else {
            scaleFactor = scale * 0.5; // Fallback
        }
    } else {
        scaleFactor = scale * 0.5; // Fallback
    }
    
    if (isNaN(scaleFactor) || scaleFactor <= 0) {
        scaleFactor = 1.0; 
    }
    splat.scale.set(scaleFactor, scaleFactor, scaleFactor);

    // Rotation
    const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
    const targetRotX = -0.2; 
    const targetRotY = bodyRot * 0.5;
    const targetRotZ = bodyRot * 0.2;

    smoothedWingsRot.x += (targetRotX - smoothedWingsRot.x) * SMOOTHING_FACTOR;
    smoothedWingsRot.y += (targetRotY - smoothedWingsRot.y) * SMOOTHING_FACTOR;
    smoothedWingsRot.z += (targetRotZ - smoothedWingsRot.z) * SMOOTHING_FACTOR;
    splat.rotation.set(smoothedWingsRot.x, smoothedWingsRot.y, smoothedWingsRot.z);
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

// === START ===
window.addEventListener('DOMContentLoaded', init);
