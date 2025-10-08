let scene, camera, renderer;
let leftWing, rightWing;
let video, canvas, ctx;
let poseModel;
let debugLogger;
let isRunning = false;
let frameCount = 0;
let lastFpsUpdate = Date.now();

// Smoothing variables for stable positioning
let smoothedLeftPos = { x: 0, y: 0, z: 0 };
let smoothedRightPos = { x: 0, y: 0, z: 0 };
let smoothedLeftRot = { x: 0, y: 0, z: 0 };
let smoothedRightRot = { x: 0, y: 0, z: 0 };
const SMOOTHING_FACTOR = 0.4;

// Store initial shoulder distance to maintain wing spacing
let baseShoulderDistance = null;

// PLY Model support
let leftPlyMesh = null;
let rightPlyMesh = null;
const USE_PLY_MODEL = false; // Set to true when you have .ply files
const PLY_PATH_LEFT = 'assets/left_wing.ply'; // Path to your left wing PLY file
const PLY_PATH_RIGHT = 'assets/right_wing.ply'; // Path to your right wing PLY file

// Camera configuration
const CAMERA_MODE = 'environment';

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
    this.maxLogs = 30;
    
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

  updateStatus(status) {
    this.statusText.textContent = status;
  }

  updateVideoStatus(status) {
    this.videoStatus.textContent = status;
  }

  updateModelStatus(status) {
    this.modelStatus.textContent = status;
  }

  updatePoseStatus(status) {
    this.poseStatus.textContent = status;
  }

  updateAssetStatus(status) {
    this.assetStatus.textContent = status;
  }

  updateFPS(fps) {
    this.fpsCounter.textContent = fps.toFixed(1);
  }
}

// === INITIALIZE ===
function init() {
  debugLogger = new DebugLogger();
  debugLogger.log('info', '=== AR Back Wings Starting ===');
  debugLogger.log('info', `Camera Mode: ${CAMERA_MODE === 'user' ? 'Front (Selfie)' : 'Rear'}`);
  
  if (typeof THREE === 'undefined') {
    debugLogger.log('error', 'Three.js not loaded!');
    alert('Three.js failed to load. Please refresh the page.');
    return;
  }
  debugLogger.log('success', 'Three.js loaded');

  if (typeof tf === 'undefined') {
    debugLogger.log('error', 'TensorFlow.js not loaded!');
    alert('TensorFlow.js failed to load. Please refresh the page.');
    return;
  }
  debugLogger.log('success', 'TensorFlow.js loaded');

  if (typeof poseDetection === 'undefined') {
    debugLogger.log('error', 'Pose Detection not loaded!');
    alert('Pose Detection failed to load. Please refresh the page.');
    return;
  }
  debugLogger.log('success', 'Pose Detection loaded');

  // Check PLYLoader availability
  if (typeof THREE.PLYLoader !== 'undefined') {
    debugLogger.log('success', 'PLYLoader available');
  } else {
    debugLogger.log('warning', 'PLYLoader not available');
  }

  const startBtn = document.getElementById('start-btn');
  const instructions = document.getElementById('instructions');

  debugLogger.log('info', 'Setting up start button listener');
  
  startBtn.addEventListener('click', async () => {
    debugLogger.log('info', 'Start button clicked!');
    instructions.classList.add('hidden');
    await startAR();
  });

  debugLogger.updateStatus('Ready - Tap Start');
  debugLogger.log('success', 'Initialization complete');
}

// === START AR EXPERIENCE ===
async function startAR() {
  try {
    debugLogger.updateStatus('Initializing...');
    debugLogger.log('info', 'Starting AR experience');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported in this browser');
    }
    debugLogger.log('success', 'Browser supports camera API');

    canvas = document.getElementById('output-canvas');
    ctx = canvas.getContext('2d');
    debugLogger.log('success', 'Canvas context created');

    video = document.getElementById('video');
    debugLogger.updateStatus('Requesting camera...');
    debugLogger.log('info', `Requesting ${CAMERA_MODE === 'user' ? 'front-facing' : 'rear-facing'} camera`);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: CAMERA_MODE,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      video.srcObject = stream;
      debugLogger.log('success', 'Camera access granted');
      debugLogger.updateVideoStatus('Stream acquired');

      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      debugLogger.log('success', `Video ready: ${video.videoWidth}x${video.videoHeight}`);
      debugLogger.updateVideoStatus(`${video.videoWidth}x${video.videoHeight}`);

    } catch (err) {
      debugLogger.log('error', `Camera error: ${err.message}`);
      throw new Error(`Camera access denied: ${err.message}`);
    }

    debugLogger.updateStatus('Setting up 3D renderer...');
    await setupThreeJS();
    debugLogger.log('success', '3D renderer ready');

    debugLogger.updateStatus('Loading AI model...');
    debugLogger.updateModelStatus('Loading...');
    debugLogger.log('info', 'Loading MoveNet model...');

    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      }
    );

    debugLogger.log('success', 'AI model loaded!');
    debugLogger.updateModelStatus('Ready');
    debugLogger.updateStatus('Running - Show back!');

    isRunning = true;
    renderLoop();

  } catch (error) {
    debugLogger.log('error', `INIT ERROR: ${error.message}`);
    debugLogger.updateStatus(`Error: ${error.message}`);
    alert(`Failed to start AR: ${error.message}\n\nPlease check camera permissions and try again.`);
  }
}

// === SETUP THREE.JS (with PLY support) ===
async function setupThreeJS() {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(canvas.width, canvas.height);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    75,
    canvas.width / canvas.height,
    0.1,
    1000
  );
  camera.position.set(0, 0, 0);

  // Load assets based on configuration
  if (USE_PLY_MODEL && typeof THREE.PLYLoader !== 'undefined') {
    debugLogger.log('info', 'Loading PLY model assets...');
    debugLogger.updateAssetStatus('Loading PLY models...');
    
    try {
      const loader = new THREE.PLYLoader();
      
      // Load left wing
      const leftGeometry = await new Promise((resolve, reject) => {
        loader.load(
          PLY_PATH_LEFT,
          (geometry) => resolve(geometry),
          (progress) => {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            debugLogger.log('info', `Loading left wing: ${percent}%`);
          },
          (error) => reject(error)
        );
      });
      
      // Create mesh from geometry
      const leftMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true, // Use colors from PLY file if available
        side: THREE.DoubleSide
      });
      leftPlyMesh = new THREE.Mesh(leftGeometry, leftMaterial);
      leftPlyMesh.visible = false;
      
      // Center and scale the geometry
      leftGeometry.center();
      leftGeometry.computeBoundingBox();
      
      scene.add(leftPlyMesh);
      debugLogger.log('success', 'Left wing PLY loaded');
      
      // Load right wing
      const rightGeometry = await new Promise((resolve, reject) => {
        loader.load(
          PLY_PATH_RIGHT,
          (geometry) => resolve(geometry),
          (progress) => {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            debugLogger.log('info', `Loading right wing: ${percent}%`);
          },
          (error) => reject(error)
        );
      });
      
      const rightMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide
      });
      rightPlyMesh = new THREE.Mesh(rightGeometry, rightMaterial);
      rightPlyMesh.visible = false;
      
      rightGeometry.center();
      rightGeometry.computeBoundingBox();
      
      scene.add(rightPlyMesh);
      debugLogger.log('success', 'Right wing PLY loaded');
      
      leftWing = leftPlyMesh;
      rightWing = rightPlyMesh;
      
      debugLogger.updateAssetStatus('PLY models loaded');
      debugLogger.log('success', 'PLY wing models ready');
      
    } catch (err) {
      debugLogger.log('error', `Failed to load PLY models: ${err.message}`);
      debugLogger.log('info', 'Falling back to box placeholders');
      createBoxWings();
    }
  } else {
    // Create box placeholders
    createBoxWings();
  }

  debugLogger.log('success', 'Wing assets created');
}

// === CREATE BOX WING PLACEHOLDERS ===
function createBoxWings() {
  const wingGeometry = new THREE.BoxGeometry(0.15, 0.35, 0.08);
  const wingMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.8
  });

  leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  rightWing = new THREE.Mesh(wingGeometry, wingMaterial.clone());
  rightWing.material.color.setHex(0x00ccff);

  scene.add(leftWing);
  scene.add(rightWing);

  leftWing.visible = false;
  rightWing.visible = false;

  debugLogger.updateAssetStatus('Box placeholders');
  debugLogger.log('success', 'Wing boxes created');
}

// === MAIN RENDER LOOP ===
async function renderLoop() {
  if (!isRunning) return;

  requestAnimationFrame(renderLoop);

  frameCount++;
  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    const fps = frameCount / ((now - lastFpsUpdate) / 1000);
    debugLogger.updateFPS(fps);
    frameCount = 0;
    lastFpsUpdate = now;
  }

  ctx.save();
  if (CAMERA_MODE === 'user') {
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, CAMERA_MODE === 'user' ? -canvas.width : 0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    try {
      const poses = await poseModel.estimatePoses(video);

      if (poses.length > 0) {
        const keypoints = poses[0].keypoints;
        const leftShoulder = keypoints.find(kp => kp.name === 'left_shoulder');
        const rightShoulder = keypoints.find(kp => kp.name === 'right_shoulder');
        const leftHip = keypoints.find(kp => kp.name === 'left_hip');
        const rightHip = keypoints.find(kp => kp.name === 'right_hip');

        if (leftShoulder && rightShoulder &&
            leftShoulder.score > 0.3 && rightShoulder.score > 0.3) {

          const shoulderDist = Math.hypot(
            rightShoulder.x - leftShoulder.x,
            rightShoulder.y - leftShoulder.y
          );

          if (baseShoulderDistance === null) {
            baseShoulderDistance = shoulderDist;
            debugLogger.log('info', `Base shoulder distance set: ${baseShoulderDistance.toFixed(2)}px`);
          }

          const depth = -2.0 - (150 / shoulderDist);
          const scale = Math.max(0.5, shoulderDist / 150);

          let spineCenter = {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
          };

          if (leftHip && rightHip && leftHip.score > 0.2 && rightHip.score > 0.2) {
            const hipCenterX = (leftHip.x + rightHip.x) / 2;
            const hipCenterY = (leftHip.y + rightHip.y) / 2;
            spineCenter.y = (spineCenter.y + hipCenterY) / 2;
          }

          const shoulderAngle = Math.atan2(
            rightShoulder.y - leftShoulder.y,
            rightShoulder.x - leftShoulder.x
          );

          if (CAMERA_MODE === 'user') {
            positionWingGluedToBack(leftWing, rightShoulder, leftShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'left');
            positionWingGluedToBack(rightWing, leftShoulder, rightShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'right');
          } else {
            positionWingGluedToBack(leftWing, leftShoulder, rightShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'left');
            positionWingGluedToBack(rightWing, rightShoulder, leftShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'right');
          }

          leftWing.visible = true;
          rightWing.visible = true;

          debugLogger.updatePoseStatus(`Detected (${leftShoulder.score.toFixed(2)})`);

          const debugPoints = [leftShoulder, rightShoulder];
          if (leftHip && rightHip) debugPoints.push(leftHip, rightHip);
          drawDebugPoints(ctx, debugPoints);
        } else {
          leftWing.visible = false;
          rightWing.visible = false;
          debugLogger.updatePoseStatus('Low confidence');
          baseShoulderDistance = null;
        }
      } else {
        leftWing.visible = false;
        rightWing.visible = false;
        debugLogger.updatePoseStatus('No person detected');
        baseShoulderDistance = null;
      }
    } catch (err) {
      debugLogger.log('error', `Pose detection: ${err.message}`);
    }
  }

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION WING GLUED TO BACK ===
function positionWingGluedToBack(wing, thisShoulder, otherShoulder, spineCenter, depth, scale, shoulderAngle, currentShoulderDist, side) {
  let shoulderX = (thisShoulder.x / video.videoWidth) * 2 - 1;
  let shoulderY = -(thisShoulder.y / video.videoHeight) * 2 + 1;
  
  let spineCenterX = (spineCenter.x / video.videoWidth) * 2 - 1;
  let spineCenterY = -(spineCenter.y / video.videoHeight) * 2 + 1;

  if (CAMERA_MODE === 'user') {
    shoulderX = -shoulderX;
    spineCenterX = -spineCenterX;
  }

  const shoulderToSpineDx = shoulderX - spineCenterX;
  const shoulderToSpineDy = shoulderY - spineCenterY;
  const distFromSpine = Math.sqrt(shoulderToSpineDx * shoulderToSpineDx + shoulderToSpineDy * shoulderToSpineDy);
  
  const normalizedDx = shoulderToSpineDx / distFromSpine;
  const normalizedDy = shoulderToSpineDy / distFromSpine;

  const wingDistanceFromSpine = distFromSpine * 0.7;
  const downwardShift = 0.15 * scale;

  const targetX = spineCenterX + (normalizedDx * wingDistanceFromSpine);
  const targetY = spineCenterY + (normalizedDy * wingDistanceFromSpine) - downwardShift;
  const targetZ = depth - (0.4 * scale);

  const smoothedPos = side === 'left' ? smoothedLeftPos : smoothedRightPos;
  smoothedPos.x = smoothedPos.x + (targetX - smoothedPos.x) * SMOOTHING_FACTOR;
  smoothedPos.y = smoothedPos.y + (targetY - smoothedPos.y) * SMOOTHING_FACTOR;
  smoothedPos.z = smoothedPos.z + (targetZ - smoothedPos.z) * SMOOTHING_FACTOR;

  wing.position.set(smoothedPos.x, smoothedPos.y, smoothedPos.z);
  
  // Scale differently for PLY models vs boxes
  if (USE_PLY_MODEL) {
    wing.scale.set(scale * 0.1, scale * 0.1, scale * 0.1); // PLY models might need different scaling
  } else {
    wing.scale.set(scale * 0.8, scale * 1.2, scale * 0.6);
  }

  const baseRotY = side === 'left' ? 0.5 : -0.5;
  const baseRotX = -0.2;
  const baseRotZ = side === 'left' ? -0.1 : 0.1;

  const bodyRotationInfluence = CAMERA_MODE === 'user' ? -shoulderAngle : shoulderAngle;
  const targetRotY = baseRotY + (bodyRotationInfluence * 0.5);
  const targetRotX = baseRotX;
  const targetRotZ = baseRotZ + (bodyRotationInfluence * 0.2);

  const smoothedRot = side === 'left' ? smoothedLeftRot : smoothedRightRot;
  smoothedRot.x = smoothedRot.x + (targetRotX - smoothedRot.x) * SMOOTHING_FACTOR;
  smoothedRot.y = smoothedRot.y + (targetRotY - smoothedRot.y) * SMOOTHING_FACTOR;
  smoothedRot.z = smoothedRot.z + (targetRotZ - smoothedRot.z) * SMOOTHING_FACTOR;
  
  wing.rotation.set(smoothedRot.x, smoothedRot.y, smoothedRot.z);
}

// === DRAW DEBUG POINTS ===
function drawDebugPoints(ctx, keypoints) {
  ctx.fillStyle = '#00ff88';
  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      let x = kp.x;
      const y = kp.y;
      
      if (CAMERA_MODE === 'user') {
        x = canvas.width - x;
      }
      
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// === START WHEN PAGE LOADS ===
window.addEventListener('DOMContentLoaded', () => {
  init();
});
