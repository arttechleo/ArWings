// Gaussian Splatting loader - inline implementation
// WARNING: This is a very basic PLY parser. It assumes a simple data layout
// (position, then color) and a fixed vertex size. It may fail to load
// standard Gaussian Splat PLY files which have more complex attributes like
// scale and rotation. If your splat appears as a single dot or is distorted,
// this loader is the likely cause.
// === GAUSSIAN SPLAT LOADER (REVISED AND ROBUST) ===
// This new loader correctly parses the PLY header to find the exact location of
// position and color data, making it compatible with standard Gaussian Splat files.
// === GAUSSIAN SPLAT LOADER (FINAL CORRECTED VERSION) ===
// This version fixes a bug in the property search logic to correctly find
// x, y, and z attributes from the PLY header.
class GaussianSplatLoader {
    async load(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load: ${response.status} ${response.statusText}`);
            }
            const buffer = await response.arrayBuffer();
            return this.parsePLY(buffer);
        } catch (error) {
            throw new Error(`Gaussian Splat load failed: ${error.message}`);
        }
    }

    parsePLY(buffer) {
        const headerText = new TextDecoder().decode(buffer.slice(0, 2048));
        const headerEndIndex = headerText.indexOf('end_header\n') + 11;

        const vertexCountMatch = headerText.match(/element vertex (\d+)/);
        if (!vertexCountMatch) throw new Error("Invalid PLY: Missing 'element vertex' count.");
        const vertexCount = parseInt(vertexCountMatch[1]);

        const propertyLines = headerText.slice(0, headerEndIndex).match(/property .+/g);
        if (!propertyLines) throw new Error("Invalid PLY: No properties found in header.");

        // --- PROPERTY PARSING (Corrected Logic) ---
        let vertexStride = 0;
        const properties = [];
        const typeSizeBytes = { 'float': 4, 'double': 8, 'uchar': 1, 'int': 4 };

        for (const line of propertyLines) {
            const [, type, name] = line.split(' ');
            if (typeSizeBytes[type]) {
                properties.push({ name, type, offset: vertexStride });
                vertexStride += typeSizeBytes[type];
            }
        }
        
        // **[DEBUG TIP]** If errors persist, uncomment the next line to see your PLY structure.
        // console.log("PLY Properties Found:", properties);

        // --- ATTRIBUTE OFFSET FINDING (Corrected Logic) ---
        const posOffsets = {
            x: properties.find(p => p.name === 'x')?.offset,
            y: properties.find(p => p.name === 'y')?.offset,
            z: properties.find(p => p.name === 'z')?.offset
        };

        if (posOffsets.x === undefined || posOffsets.y === undefined || posOffsets.z === undefined) {
            throw new Error("Invalid PLY: Could not find all position properties (x, y, z).");
        }

        let colorOffsets = {
            r: properties.find(p => p.name === 'f_dc_0')?.offset,
            g: properties.find(p => p.name === 'f_dc_1')?.offset,
            b: properties.find(p => p.name === 'f_dc_2')?.offset
        };
        let isSphericalHarmonics = (properties.find(p => p.name === 'f_dc_0')?.type === 'float');
        
        if (colorOffsets.r === undefined) {
            isSphericalHarmonics = false;
            colorOffsets = {
                r: properties.find(p => p.name === 'red')?.offset,
                g: properties.find(p => p.name === 'green')?.offset,
                b: properties.find(p => p.name === 'blue')?.offset
            };
        }

        // --- DATA READING ---
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        const dataView = new DataView(buffer, headerEndIndex);
        const SH_C0 = 0.28209479177387814;

        for (let i = 0; i < vertexCount; i++) {
            const offset = i * vertexStride;

            positions[i * 3 + 0] = dataView.getFloat32(offset + posOffsets.x, true);
            positions[i * 3 + 1] = dataView.getFloat32(offset + posOffsets.y, true);
            positions[i * 3 + 2] = dataView.getFloat32(offset + posOffsets.z, true);

            if (colorOffsets.r !== undefined) {
                if (isSphericalHarmonics) {
                    colors[i * 3 + 0] = 0.5 + SH_C0 * dataView.getFloat32(offset + colorOffsets.r, true);
                    colors[i * 3 + 1] = 0.5 + SH_C0 * dataView.getFloat32(offset + colorOffsets.g, true);
                    colors[i * 3 + 2] = 0.5 + SH_C0 * dataView.getFloat32(offset + colorOffsets.b, true);
                } else {
                    colors[i * 3 + 0] = dataView.getUint8(offset + colorOffsets.r) / 255.0;
                    colors[i * 3 + 1] = dataView.getUint8(offset + colorOffsets.g) / 255.0;
                    colors[i * 3 + 2] = dataView.getUint8(offset + colorOffsets.b) / 255.0;
                }
            } else {
                colors.fill(1.0, i * 3, i * 3 + 3);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.computeBoundingBox();

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
const SMOOTHING_FACTOR = 0.4;

let wingsMesh = null;
let splatLoaded = false;
let splatBoundingBoxSize = null;

// Configuration
const USE_GAUSSIAN_SPLAT = true;
const SPLAT_PATH = 'assets/wings.ply';
const TEST_MODE = false;
const CAMERA_MODE = 'environment';


// === DEBUG LOGGER CLASS ===
class DebugLogger {
  constructor() {
    this.logsContainer = document.getElementById('debug-logs');
    this.statusText = document.getElementById('status-text');
    this.fpsCounter = document.getElementById('fps-counter');
    this.maxLogs = 50;
    this.setupControls();
  }

  setupControls() {
    const toggleBtn = document.getElementById('toggle-debug');
    const clearBtn = document.getElementById('clear-debug');
    const panel = document.getElementById('debug-panel');
    if (!toggleBtn || !clearBtn || !panel) return;
    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      toggleBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
    });
    clearBtn.addEventListener('click', () => { this.logsContainer.innerHTML = ''; });
  }

  log(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `debug-log ${type}`;
    logEntry.innerHTML = `<span class="debug-timestamp">[${timestamp}]</span> ${message}`;
    this.logsContainer.insertBefore(logEntry, this.logsContainer.firstChild);
    while (this.logsContainer.children.length > this.maxLogs) {
      this.logsContainer.removeChild(this.logsContainer.lastChild);
    }
    console[type === 'error' ? 'error' : 'log'](`[${type}] ${message}`);
  }

  updateStatus(key, value) {
    const el = document.getElementById(`${key}-status`);
    if (el) el.textContent = value;
  }
  updateFPS(fps) { if(this.fpsCounter) this.fpsCounter.textContent = fps.toFixed(1); }
}

// === INITIALIZATION ===
function init() {
  debugLogger = new DebugLogger();
  debugLogger.log('info', '🚀 AR Gaussian Splat Wings Initializing...');

  if (typeof THREE === 'undefined' || typeof tf === 'undefined' || typeof poseDetection === 'undefined') {
    debugLogger.log('error', '❌ A required library (Three.js, TensorFlow, or Pose Detection) is not loaded.');
    return;
  }
  
  const startBtn = document.getElementById('start-btn');
  const instructions = document.getElementById('instructions');
  startBtn.addEventListener('click', async () => {
    instructions.classList.add('hidden');
    await startAR();
  });
}

// === START AR ===
async function startAR() {
  try {
    debugLogger.log('info', '▶️ Starting AR...');
    canvas = document.getElementById('output-canvas');
    ctx = canvas.getContext('2d');
    video = document.getElementById('video');

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: CAMERA_MODE, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    debugLogger.log('success', `✅ Video stream active: ${video.videoWidth}x${video.videoHeight}`);

    await setupThreeJS();

    debugLogger.log('info', '🧠 Loading Pose Detection model...');
    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );
    debugLogger.log('success', '✅ MoveNet model loaded.');

    isRunning = true;
    renderLoop();
  } catch (error) {
    debugLogger.log('error', `❌ AR Start Failed: ${error.message}`);
    alert(`Failed to start AR. Please ensure you have a camera and have granted permissions. Error: ${error.message}`);
  }
}

// === SETUP THREE.JS ===
async function setupThreeJS() {
  debugLogger.log('info', '🎨 Setting up Three.js scene...');
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(canvas.width, canvas.height);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  camera.position.set(0, 0, 0);

  if (USE_GAUSSIAN_SPLAT) {
    debugLogger.log('info', `🌟 Loading Gaussian Splat from: ${SPLAT_PATH}`);
    try {
      const loader = new GaussianSplatLoader();
      const geometry = await loader.load(SPLAT_PATH);
      debugLogger.log('success', `✅ Splat loaded with ${geometry.attributes.position.count} points.`);

      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox;
      const size = new THREE.Vector3();
      bbox.getSize(size);
      if (isNaN(size.x) || size.x === 0) throw new Error('Invalid bounding box calculated. Check PLY loader.');
      splatBoundingBoxSize = size;
      debugLogger.log('info', `📦 Bounding Box Size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
      
      const material = new THREE.PointsMaterial({
        size: 0.04, vertexColors: true, sizeAttenuation: true, transparent: true,
        opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false
      });
      wingsMesh = new THREE.Points(geometry, material);
      wingsMesh.visible = TEST_MODE;
      if (TEST_MODE) wingsMesh.position.z = -3;
      scene.add(wingsMesh);
      splatLoaded = true;
    } catch (err) {
      debugLogger.log('error', `❌ Splat loading failed: ${err.message}`);
      debugLogger.log('warning', 'Creating fallback box wings.');
      createBoxWings();
    }
  } else {
    createBoxWings();
  }
}

// === BOX FALLBACK ===
function createBoxWings() {
  const geo = new THREE.BoxGeometry(0.15, 0.35, 0.08);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
  leftWing = new THREE.Mesh(geo, mat);
  rightWing = new THREE.Mesh(geo, mat.clone());
  rightWing.material.color.setHex(0x00ccff);
  scene.add(leftWing, rightWing);
  leftWing.visible = false;
  rightWing.visible = false;
}

// === RENDER LOOP ===
async function renderLoop() {
  if (!isRunning) return;
  requestAnimationFrame(renderLoop);

  // FPS Counter
  frameCount++;
  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    debugLogger.updateFPS(frameCount);
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Draw video background
  ctx.save();
  if (CAMERA_MODE === 'user') ctx.scale(-1, 1);
  ctx.drawImage(video, CAMERA_MODE === 'user' ? -canvas.width : 0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Pose Tracking Logic
  if (poseModel && video.readyState === video.HAVE_ENOUGH_DATA && !TEST_MODE) {
    const poses = await poseModel.estimatePoses(video);
    const pose = poses[0];
    
    if (pose) {
      const ls = pose.keypoints.find(k => k.name === 'left_shoulder');
      const rs = pose.keypoints.find(k => k.name === 'right_shoulder');

      if (ls.score > 0.4 && rs.score > 0.4) {
        debugLogger.updateStatus('pose', '✅ Pose Detected');
        const dist = Math.hypot(rs.x - ls.x, rs.y - ls.y);
        const depth = -2.0 - (150 / dist);
        const scale = Math.max(0.5, dist / 150);
        const spine = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);

        if (splatLoaded && wingsMesh) {
          positionSplat(wingsMesh, spine, depth, scale, angle, dist);
          if (!wingsMesh.visible) {
            wingsMesh.visible = true;
            debugLogger.log('success', '👁️ Wings Visible');
          }
        } else if (leftWing) { /* Fallback logic here */ }
      } else {
        if (wingsMesh) wingsMesh.visible = false;
        debugLogger.updateStatus('pose', '⚠️ Low Confidence');
      }
    } else {
      if (wingsMesh) wingsMesh.visible = false;
      debugLogger.updateStatus('pose', '❌ No Pose');
    }
  }

  // Render 3D scene and overlay it
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION SPLAT (REVISED FOR BACK ATTACHMENT) ===
// This version correctly converts 2D screen coordinates to 3D world space
// and precisely anchors the wings to the user's upper back.
function positionSplat(splat, spine, depth, scale, angle, shoulderDist) {
    if (!splat) return;

    // Anchor wings to the upper back, slightly below the shoulder line
    spine.y += shoulderDist * 0.15;

    // 1. Convert 2D screen point to 3D Normalized Device Coordinates
    let spineX = (spine.x / video.videoWidth) * 2 - 1;
    let spineY = -(spine.y / video.videoHeight) * 2 + 1;
    if (CAMERA_MODE === 'user') spineX = -spineX;

    // 2. Unproject point from 2D screen to 3D world space
    const worldPosition = new THREE.Vector3(spineX, spineY, 0.5);
    worldPosition.unproject(camera);
    const dir = worldPosition.sub(camera.position).normalize();
    const distance = Math.abs(depth / dir.z);
    const targetPos = camera.position.clone().add(dir.multiplyScalar(distance));
    
    // 3. Smooth position for fluid movement
    smoothedWingsPos.x += (targetPos.x - smoothedWingsPos.x) * SMOOTHING_FACTOR;
    smoothedWingsPos.y += (targetPos.y - smoothedWingsPos.y) * SMOOTHING_FACTOR;
    smoothedWingsPos.z += (targetPos.z - smoothedWingsPos.z) * SMOOTHING_FACTOR;
    splat.position.set(smoothedWingsPos.x, smoothedWingsPos.y, smoothedWingsPos.z);

    // 4. Calculate scale based on model's bounding box and user's distance
    let scaleFactor = scale * 0.5; // Fallback scale
    if (splatBoundingBoxSize) {
        const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
        if (avg > 0) scaleFactor = (1.5 / avg) * scale;
    }
    if (isNaN(scaleFactor) || scaleFactor <= 0) scaleFactor = 1.0; 
    splat.scale.set(scaleFactor, scaleFactor, scaleFactor);

    // 5. Calculate rotation based on shoulder angle
    const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
    smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR;
    smoothedWingsRot.y += (bodyRot * 0.5 - smoothedWingsRot.y) * SMOOTHING_FACTOR;
    smoothedWingsRot.z += (bodyRot * 0.2 - smoothedWingsRot.z) * SMOOTHING_FACTOR;
    splat.rotation.set(smoothedWingsRot.x, smoothedWingsRot.y, smoothedWingsRot.z);
}

// === START ===
window.addEventListener('DOMContentLoaded', init);
