import * as THREE from 'three';

let scene, camera, renderer, leftWing, rightWing, video, poseModel;
let debugLogger;
let frameCount = 0;
let lastFpsUpdate = Date.now();

// === DEBUG LOGGER CLASS ===
class DebugLogger {
  constructor() {
    this.logsContainer = document.getElementById('debug-logs');
    this.statusText = document.getElementById('status-text');
    this.videoStatus = document.getElementById('video-status');
    this.modelStatus = document.getElementById('model-status');
    this.poseStatus = document.getElementById('pose-status');
    this.fpsCounter = document.getElementById('fps-counter');
    this.maxLogs = 50;
    
    this.setupControls();
    this.interceptConsole();
  }

  setupControls() {
    const toggleBtn = document.getElementById('toggle-debug');
    const clearBtn = document.getElementById('clear-debug');
    const panel = document.getElementById('debug-panel');

    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      toggleBtn.textContent = panel.classList.contains('minimized') ? 'Expand' : 'Minimize';
    });

    clearBtn.addEventListener('click', () => {
      this.logsContainer.innerHTML = '';
    });
  }

  interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      originalLog.apply(console, args);
      this.log('info', args.join(' '));
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      this.log('error', args.join(' '));
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      this.log('warning', args.join(' '));
    };
  }

  log(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `debug-log ${type}`;
    logEntry.innerHTML = `<span class="debug-timestamp">[${timestamp}]</span>${message}`;
    
    this.logsContainer.insertBefore(logEntry, this.logsContainer.firstChild);

    // Limit number of logs
    while (this.logsContainer.children.length > this.maxLogs) {
      this.logsContainer.removeChild(this.logsContainer.lastChild);
    }
  }

  updateStatus(status) {
    this.statusText.textContent = status;
    this.log('info', `Status: ${status}`);
  }

  updateVideoStatus(status) {
    this.videoStatus.textContent = status;
  }

  updateModelStatus(status) {
    this.modelStatus.textContent = status;
  }

  updatePoseStatus(detected, details = '') {
    this.poseStatus.textContent = detected ? `Yes ${details}` : 'No';
  }

  updateFPS(fps) {
    this.fpsCounter.textContent = fps.toFixed(1);
  }
}

// === INIT FUNCTION ===
async function init() {
  try {
    debugLogger = new DebugLogger();
    debugLogger.updateStatus('Starting initialization...');
    debugLogger.log('success', '=== AR App Starting ===');

    // Check for required APIs
    debugLogger.log('info', 'Checking browser support...');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not supported in this browser');
    }
    debugLogger.log('success', 'Browser supports getUserMedia');

    // Check if Three.js loaded
    if (typeof THREE === 'undefined') {
      throw new Error('Three.js failed to load');
    }
    debugLogger.log('success', 'Three.js loaded successfully');

    // Check if TensorFlow loaded
    if (typeof tf === 'undefined') {
      throw new Error('TensorFlow.js failed to load');
    }
    debugLogger.log('success', 'TensorFlow.js loaded successfully');

    // Check if Pose Detection loaded
    if (typeof poseDetection === 'undefined') {
      throw new Error('Pose Detection library failed to load');
    }
    debugLogger.log('success', 'Pose Detection library loaded successfully');

    // Setup video feed
    debugLogger.updateStatus('Requesting camera access...');
    video = document.getElementById('video');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      video.srcObject = stream;
      debugLogger.log('success', 'Camera access granted');
      debugLogger.updateVideoStatus('Stream acquired');
    } catch (cameraError) {
      debugLogger.log('error', `Camera error: ${cameraError.message}`);
      throw new Error(`Failed to access camera: ${cameraError.message}`);
    }

    // Wait for video to be ready
    debugLogger.updateStatus('Waiting for video to load...');
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        debugLogger.log('success', `Video ready: ${video.videoWidth}x${video.videoHeight}`);
        debugLogger.updateVideoStatus(`Ready (${video.videoWidth}x${video.videoHeight})`);
        resolve();
      };
    });

    // Setup Three.js with proper camera
    debugLogger.updateStatus('Setting up 3D renderer...');
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);
    debugLogger.log('success', `Renderer created: ${window.innerWidth}x${window.innerHeight}`);

    scene = new THREE.Scene();
    debugLogger.log('success', 'Scene created');

    // Proper perspective camera for AR
    const fov = 75;
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
    camera.position.set(0, 0, 0);
    debugLogger.log('success', `Camera created (FOV: ${fov}, Aspect: ${aspect.toFixed(2)})`);

    // Create wing models
    debugLogger.updateStatus('Creating 3D models...');
    const wingGeometry = new THREE.BoxGeometry(0.15, 0.3, 0.05);
    const wingMaterial = new THREE.MeshNormalMaterial();
    
    leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
    rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
    
    scene.add(leftWing);
    scene.add(rightWing);
    
    leftWing.visible = false;
    rightWing.visible = false;
    debugLogger.log('success', 'Wing models created and added to scene');

    // Load MoveNet model for pose detection
    debugLogger.updateStatus('Loading AI model...');
    debugLogger.updateModelStatus('Loading...');
    debugLogger.log('info', 'Loading MoveNet pose detection model...');
    
    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      }
    );
    
    debugLogger.log('success', 'MoveNet model loaded successfully!');
    debugLogger.updateModelStatus('Loaded (MoveNet Lightning)');

    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    debugLogger.log('info', 'Resize handler attached');

    // Start animation loop
    debugLogger.updateStatus('Running - Point camera at a person');
    debugLogger.log('success', '=== Initialization Complete ===');
    debugLogger.log('info', 'Animation loop starting...');
    animate();
  } catch (error) {
    debugLogger.log('error', `FATAL ERROR: ${error.message}`);
    debugLogger.log('error', `Stack: ${error.stack}`);
    debugLogger.updateStatus(`ERROR: ${error.message}`);
    alert('Error initializing AR: ' + error.message + '\n\nCheck the debug panel for details.');
  }
}

// === ANIMATION LOOP ===
async function animate() {
  requestAnimationFrame(animate);

  // Calculate FPS
  frameCount++;
  const now = Date.now();
  if (now - lastFpsUpdate >= 1000) {
    const fps = frameCount / ((now - lastFpsUpdate) / 1000);
    debugLogger.updateFPS(fps);
    frameCount = 0;
    lastFpsUpdate = now;
  }

  if (video.readyState === video.HAVE_ENOUGH_DATA && poseModel) {
    try {
      const poses = await poseModel.estimatePoses(video, {
        flipHorizontal: false
      });

      if (poses.length > 0) {
        const keypoints = poses[0].keypoints;
        
        // Get shoulder keypoints
        const leftShoulder = keypoints.find(kp => kp.name === 'left_shoulder');
        const rightShoulder = keypoints.find(kp => kp.name === 'right_shoulder');
        
        // Debug: Log keypoint confidence
        if (frameCount % 30 === 0) { // Log every 30 frames to avoid spam
          const leftConf = leftShoulder ? leftShoulder.score.toFixed(2) : 'N/A';
          const rightConf = rightShoulder ? rightShoulder.score.toFixed(2) : 'N/A';
          debugLogger.log('info', `Shoulder confidence - Left: ${leftConf}, Right: ${rightConf}`);
        }
        
        // Check confidence threshold
        if (leftShoulder && rightShoulder && 
            leftShoulder.score > 0.3 && rightShoulder.score > 0.3) {
          
          // Calculate shoulder distance for depth estimation
          const shoulderDistance = Math.sqrt(
            Math.pow(rightShoulder.x - leftShoulder.x, 2) +
            Math.pow(rightShoulder.y - leftShoulder.y, 2)
          );
          
          // Estimate depth based on shoulder width
          const estimatedDepth = -1.5 - (200 / shoulderDistance);
          const scale = shoulderDistance / 200;
          
          // Position wings
          positionWing(leftWing, leftShoulder, estimatedDepth, scale, 'left');
          positionWing(rightWing, rightShoulder, estimatedDepth, scale, 'right');
          
          leftWing.visible = true;
          rightWing.visible = true;
          
          debugLogger.updatePoseStatus(true, `(conf: ${leftShoulder.score.toFixed(2)})`);
        } else {
          leftWing.visible = false;
          rightWing.visible = false;
          debugLogger.updatePoseStatus(false);
        }
      } else {
        leftWing.visible = false;
        rightWing.visible = false;
        debugLogger.updatePoseStatus(false);
      }
    } catch (error) {
      debugLogger.log('error', `Pose detection error: ${error.message}`);
    }
  }

  renderer.render(scene, camera);
}

// === POSITION WING ON SHOULDER ===
function positionWing(wing, shoulder, depth, scale, side) {
  // Normalize coordinates to [-1, 1] clip space
  const x = (shoulder.x / video.videoWidth) * 2 - 1;
  const y = -(shoulder.y / video.videoHeight) * 2 + 1;
  
  // Offset backwards and outwards from shoulder
  const offsetX = side === 'left' ? -0.1 * scale : 0.1 * scale;
  const offsetY = 0.05 * scale; // slightly down
  
  wing.position.set(x + offsetX, y + offsetY, depth);
  wing.scale.set(scale, scale, scale);
  
  // Rotate wings slightly outward
  const rotationY = side === 'left' ? -0.3 : 0.3;
  wing.rotation.set(0, rotationY, 0);
}

// === HANDLE RESIZE ===
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  debugLogger.log('info', `Window resized: ${window.innerWidth}x${window.innerHeight}`);
}

// === START ===
init();
