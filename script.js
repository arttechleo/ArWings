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
const SMOOTHING_FACTOR = 0.3;

// Gaussian Splatting support
let leftSplat = null;
let rightSplat = null;
const USE_GAUSSIAN_SPLAT = false; // Set to true when you have .splat files
const SPLAT_PATH_LEFT = 'assets/left_wing.splat'; // Path to your left wing splat file
const SPLAT_PATH_RIGHT = 'assets/right_wing.splat'; // Path to your right wing splat file

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

  // Check Gaussian Splatting support
  if (typeof GaussianSplats3D !== 'undefined') {
    debugLogger.log('success', 'Gaussian Splatting library loaded');
  } else {
    debugLogger.log('warning', 'Gaussian Splatting library not available');
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

// === SETUP THREE.JS (with Gaussian Splatting support) ===
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
  if (USE_GAUSSIAN_SPLAT && typeof GaussianSplats3D !== 'undefined') {
    debugLogger.log('info', 'Loading Gaussian Splat assets...');
    debugLogger.updateAssetStatus('Loading Gaussian Splats...');
    
    try {
      // Load Gaussian Splatting models
      const loader = new GaussianSplats3D.Loader();
      
      leftSplat = await loader.loadAsync(SPLAT_PATH_LEFT);
      leftSplat.visible = false;
      scene.add(leftSplat);
      debugLogger.log('success', 'Left wing splat loaded');
      
      rightSplat = await loader.loadAsync(SPLAT_PATH_RIGHT);
      rightSplat.visible = false;
      scene.add(rightSplat);
      debugLogger.log('success', 'Right wing splat loaded');
      
      leftWing = leftSplat;
      rightWing = rightSplat;
      
      debugLogger.updateAssetStatus('Gaussian Splats loaded');
      debugLogger.log('success', 'Gaussian Splat wings ready');
      
    } catch (err) {
      debugLogger.log('error', `Failed to load Gaussian Splats: ${err.message}`);
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

          const depth = -2.0 - (150 / shoulderDist);
          const scale = Math.max(0.5, shoulderDist / 150);

          // FIXED: Don't use body angle for rotation - keep wings locked to back
          let spineCenter = {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
          };

          if (leftHip && rightHip && leftHip.score > 0.2 && rightHip.score > 0.2) {
            const hipCenterX = (leftHip.x + rightHip.x) / 2;
            const hipCenterY = (leftHip.y + rightHip.y) / 2;
            spineCenter.y = (spineCenter.y + hipCenterY) / 2;
          }

          if (CAMERA_MODE === 'user') {
            positionWingOnBack(leftWing, rightShoulder, spineCenter, depth, scale, 'left');
            positionWingOnBack(rightWing, leftShoulder, spineCenter, depth, scale, 'right');
          } else {
            positionWingOnBack(leftWing, leftShoulder, spineCenter, depth, scale, 'left');
            positionWingOnBack(rightWing, rightShoulder, spineCenter, depth, scale, 'right');
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
        }
      } else {
        leftWing.visible = false;
        rightWing.visible = false;
        debugLogger.updatePoseStatus('No person detected');
      }
    } catch (err) {
      debugLogger.log('error', `Pose detection: ${err.message}`);
    }
  }

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION WING ON BACK (FIXED - no spreading on rotation) ===
function positionWingOnBack(wing, shoulder, spineCenter, depth, scale, side) {
  let shoulderX = (shoulder.x / video.videoWidth) * 2 - 1;
  let shoulderY = -(shoulder.y / video.videoHeight) * 2 + 1;

  let spineCenterX = (spineCenter.x / video.videoWidth) * 2 - 1;
  let spineCenterY = -(spineCenter.y / video.videoHeight) * 2 + 1;

  if (CAMERA_MODE === 'user') {
    shoulderX = -shoulderX;
    spineCenterX = -spineCenterX;
  }

  const dx = shoulderX - spineCenterX;
  const dy = shoulderY - spineCenterY;

  // FIXED: Constant offsets to prevent spreading
  const inwardOffset = 0.3;
  const downwardOffset = 0.2;

  const targetX = shoulderX - (dx * inwardOffset);
  const targetY = shoulderY - (Math.abs(dy) * downwardOffset) - (0.1 * scale);
  const targetZ = depth - (0.4 * scale);

  const smoothedPos = side === 'left' ? smoothedLeftPos : smoothedRightPos;
  smoothedPos.x = smoothedPos.x + (targetX - smoothedPos.x) * SMOOTHING_FACTOR;
  smoothedPos.y = smoothedPos.y + (targetY - smoothedPos.y) * SMOOTHING_FACTOR;
  smoothedPos.z = smoothedPos.z + (targetZ - smoothedPos.z) * SMOOTHING_FACTOR;

  wing.position.set(smoothedPos.x, smoothedPos.y, smoothedPos.z);
  wing.scale.set(scale * 0.8, scale * 1.2, scale * 0.6);

  // FIXED: Static rotation - wings don't rotate with body
  const baseRotY = side === 'left' ? 0.6 : -0.6;
  const baseRotX = -0.3;
  const baseRotZ = side === 'left' ? -0.15 : 0.15;

  const smoothedRot = side === 'left' ? smoothedLeftRot : smoothedRightRot;
  smoothedRot.x = smoothedRot.x + (baseRotX - smoothedRot.x) * SMOOTHING_FACTOR;
  smoothedRot.y = smoothedRot.y + (baseRotY - smoothedRot.y) * SMOOTHING_FACTOR;
  smoothedRot.z = smoothedRot.z + (baseRotZ - smoothedRot.z) * SMOOTHING_FACTOR;
  
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
