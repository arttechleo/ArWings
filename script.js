// Import the libraries defined in our importmap
import * as THREE from 'three';
import { SplatLoader } from 'three-gaussian-splat';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';

// Main app variables
let scene, camera, renderer;
let video; // Removed canvas, ctx
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
let videoPlane = null; // For the AR background

// Configuration
const SPLAT_PATH = 'assets/wings.spz'; // ✅ Updated to use the .spz file
const CAMERA_MODE = 'environment';


// === DebugLogger Class ===
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
            toggleBtn.textContent = panel.classList.contains('minimized') ? '＋' : '−';
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
    updateFPS(fps) { if (this.fpsCounter) this.fpsCounter.textContent = fps.toFixed(1); }
}

// === INITIALIZATION ===
function init() {
    debugLogger = new DebugLogger();
    debugLogger.log('info', '🚀 AR Gaussian Splat Wings Initializing...');
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
        
        video = document.getElementById('video');
        const outputCanvas = document.getElementById('output-canvas');

        debugLogger.updateStatus('video', 'Requesting camera...');
        
        // Request video stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: CAMERA_MODE, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        
        video.srcObject = stream;
        await new Promise(resolve => video.onloadedmetadata = () => { video.play(); resolve(); });
        
        // Set canvas size based on video
        outputCanvas.width = video.videoWidth;
        outputCanvas.height = video.videoHeight;

        debugLogger.log('success', `✅ Video stream active: ${video.videoWidth}x${video.videoHeight}`);
        debugLogger.updateStatus('video', '✅ Active');
        
        // Setup Three.js and load asset
        await setupThreeJS();
        
        debugLogger.log('info', '🧠 Loading Pose Detection model...');
        
        // Use SINGLEPOSE_THUNDER for better accuracy
        const detectorConfig = { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER }; 
        poseModel = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
        
        debugLogger.log('success', '✅ MoveNet model loaded.');
        debugLogger.updateStatus('model', '✅ Loaded');

        isRunning = true;
        renderLoop();
    } catch (error) {
        debugLogger.log('error', `❌ AR Start Failed: ${error.name}: ${error.message}`);
        debugLogger.updateStatus('status', '❌ FAILED');
        alert(`Failed to start AR: ${error.message}. Check camera permissions.`);
    }
}

// === SETUP THREE.JS (Refactored for AR background) ===
async function setupThreeJS() {
    debugLogger.log('info', '🎨 Setting up Three.js scene...');
    
    const outputCanvas = document.getElementById('output-canvas');

    // 1. Setup Renderer
    renderer = new THREE.WebGLRenderer({ 
        alpha: false, // Set to false since the video will be the background
        antialias: true,
        canvas: outputCanvas // Render directly to the existing canvas
    });
    renderer.setSize(outputCanvas.width, outputCanvas.height);
    
    // 2. Setup Scene and Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, outputCanvas.width / outputCanvas.height, 0.1, 1000);
    camera.position.set(0, 0, 0);

    // 3. Video Background Plane (The AR Fix)
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    
    const videoAspect = video.videoWidth / video.videoHeight;
    const screenAspect = outputCanvas.width / outputCanvas.height;

    const planeGeometry = new THREE.PlaneGeometry(2, 2 / screenAspect * videoAspect);
    const planeMaterial = new THREE.MeshBasicMaterial({ 
        map: videoTexture, 
        depthTest: false, 
        depthWrite: false 
    });
    
    videoPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    videoPlane.position.z = -10; // Place it far back in the scene
    videoPlane.scale.x = screenAspect; // Scale to fit the full screen
    scene.add(videoPlane);
    debugLogger.log('info', '🖼️ Video background plane added to scene.');

    // 4. Load Gaussian Splat Asset
    debugLogger.log('info', `🌟 Loading Gaussian Splat from: ${SPLAT_PATH}`);
    debugLogger.updateStatus('asset', 'Loading splat...');
    try {
        const loader = new SplatLoader();
        wingsMesh = await loader.load(SPLAT_PATH);

        const bbox = new THREE.Box3().setFromObject(wingsMesh);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        splatBoundingBoxSize = size;

        debugLogger.log('success', '✅ Splat loaded successfully!');
        debugLogger.log('info', `📦 Bounding Box Size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
        debugLogger.updateStatus('asset', '✅ Splat loaded');

        wingsMesh.visible = false;
        scene.add(wingsMesh);
        splatLoaded = true;

    } catch (err) {
        debugLogger.log('error', `❌ Splat loading failed: ${err.message}`);
        debugLogger.updateStatus('asset', '❌ Load failed');
    }
}

// === RENDER LOOP ===
async function renderLoop() {
    if (!isRunning) return;
    requestAnimationFrame(renderLoop);
    
    // FPS Update
    frameCount++;
    const now = Date.now();
    if (now - lastFpsUpdate >= 1000) {
        debugLogger.updateFPS(frameCount);
        frameCount = 0;
        lastFpsUpdate = now;
    }
    
    // Pose Detection
    if (poseModel && video.readyState === video.HAVE_ENOUGH_DATA) {
        const poses = await poseModel.estimatePoses(video);
        const pose = poses[0];
        
        // Check for shoulder confidence
        if (pose && 
            pose.keypoints.find(k => k.name === 'left_shoulder').score > 0.3 && 
            pose.keypoints.find(k => k.name === 'right_shoulder').score > 0.3
        ) {
            debugLogger.updateStatus('pose', '✅ Pose Detected');
            
            const ls = pose.keypoints.find(k => k.name === 'left_shoulder');
            const rs = pose.keypoints.find(k => k.name === 'right_shoulder');
            
            // Core calculations (distance, depth, scaling, angle)
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
            }
        } else {
            if (wingsMesh) wingsMesh.visible = false;
            debugLogger.updateStatus('pose', '❌ No Pose or Low Confidence');
        }
    }
    
    // Render the Three.js scene (with video texture and splat mesh)
    renderer.render(scene, camera);
}

// === POSITION SPLAT ===
function positionSplat(splat, spine, depth, scale, angle, shoulderDist) {
    if (!splat) return;
    
    // 1. Normalize screen coordinates
    spine.y += shoulderDist * 0.15; // Anchor slightly lower than the midpoint
    let spineX = (spine.x / video.videoWidth) * 2 - 1;
    let spineY = -(spine.y / video.videoHeight) * 2 + 1;
    if (CAMERA_MODE === 'user') spineX = -spineX; // Mirror for front camera (if used)
    
    // 2. Convert to World Space
    const worldPosition = new THREE.Vector3(spineX, spineY, 0.5);
    worldPosition.unproject(camera);
    const dir = worldPosition.sub(camera.position).normalize();
    const distance = Math.abs(depth / dir.z);
    const targetPos = camera.position.clone().add(dir.multiplyScalar(distance));
    
    // 3. Smoothing Position
    smoothedWingsPos.x += (targetPos.x - smoothedWingsPos.x) * SMOOTHING_FACTOR;
    smoothedWingsPos.y += (targetPos.y - smoothedWingsPos.y) * SMOOTHING_FACTOR;
    smoothedWingsPos.z += (targetPos.z - smoothedWingsPos.z) * SMOOTHING_FACTOR;
    splat.position.set(smoothedWingsPos.x, smoothedWingsPos.y, smoothedWingsPos.z);
    
    // 4. Scaling
    let scaleFactor = scale * 0.5;
    if (splatBoundingBoxSize) {
        const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
        if (avg > 0) scaleFactor = (1.5 / avg) * scale;
    }
    if (isNaN(scaleFactor) || scaleFactor <= 0) scaleFactor = 1.0;
    splat.scale.set(scaleFactor, scaleFactor, scaleFactor);
    
    // 5. Rotation and Smoothing
    const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
    smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR;
    smoothedWingsRot.y += (bodyRot * 0.5 - smoothedWingsRot.y) * SMOOTHING_FACTOR;
    smoothedWingsRot.z += (bodyRot * 0.2 - smoothedWingsRot.z) * SMOOTHING_FACTOR;
    splat.rotation.set(smoothedWingsRot.x, smoothedWingsRot.y, smoothedWingsRot.z);
}

// === START ===
window.addEventListener('DOMContentLoaded', init);
