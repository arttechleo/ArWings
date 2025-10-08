// Import the libraries defined in our importmap
import * as THREE from 'three';
import { SplatLoader } from 'three-gaussian-splat';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';

//
// Your old GaussianSplatLoader class has been completely removed.
//

// Main app variables
let scene, camera, renderer;
let video, canvas, ctx;
let poseModel;
let debugLogger;
let isRunning = false;
let frameCount = 0;
let lastFpsUpdate = Date.now();
let smoothedWingsPos = { x: 0, y: 0, z: 0 };
let smoothedWingsRot = { x: 0, y: 0, z: 0 };
const SMOOTHING_FACTOR = 0.4;
let wingsMesh = null; // This will now hold the high-quality SplatMesh
let splatLoaded = false;
let splatBoundingBoxSize = null;

// Configuration
const SPLAT_PATH = 'assets/wings.ply'; // The new loader handles .ply, .splat, and .spz
const CAMERA_MODE = 'environment';


// === The DebugLogger Class remains unchanged ===
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
        const detectorConfig = { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING };
        poseModel = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
        debugLogger.log('success', '✅ MoveNet model loaded.');
        isRunning = true;
        renderLoop();
    } catch (error) {
        debugLogger.log('error', `❌ AR Start Failed: ${error.message}`);
        alert(`Failed to start AR: ${error.message}`);
    }
}

// === SETUP THREE.JS (Refactored) ===
async function setupThreeJS() {
    debugLogger.log('info', '🎨 Setting up Three.js scene...');
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(canvas.width, canvas.height);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
    camera.position.set(0, 0, 0);

    debugLogger.log('info', `🌟 Loading Gaussian Splat from: ${SPLAT_PATH}`);
    debugLogger.updateStatus('asset', 'Loading splat...');
    try {
        // Use the new, powerful SplatLoader from the library
        const loader = new SplatLoader();
        wingsMesh = await loader.load(SPLAT_PATH); // The loader returns a complete SplatMesh

        // Get the bounding box for our scaling calculations
        const bbox = new THREE.Box3().setFromObject(wingsMesh);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        splatBoundingBoxSize = size;

        debugLogger.log('success', `✅ Splat loaded successfully!`);
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

// === RENDER LOOP (Unchanged) ===
async function renderLoop() {
    if (!isRunning) return;
    requestAnimationFrame(renderLoop);
    frameCount++;
    const now = Date.now();
    if (now - lastFpsUpdate >= 1000) {
        debugLogger.updateFPS(frameCount);
        frameCount = 0;
        lastFpsUpdate = now;
    }
    ctx.save();
    if (CAMERA_MODE === 'user') ctx.scale(-1, 1);
    ctx.drawImage(video, CAMERA_MODE === 'user' ? -canvas.width : 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (poseModel && video.readyState === video.HAVE_ENOUGH_DATA) {
        const poses = await poseModel.estimatePoses(video);
        const pose = poses[0];
        if (pose && pose.keypoints.find(k => k.name === 'left_shoulder').score > 0.4 && pose.keypoints.find(k => k.name === 'right_shoulder').score > 0.4) {
            debugLogger.updateStatus('pose', '✅ Pose Detected');
            const ls = pose.keypoints.find(k => k.name === 'left_shoulder');
            const rs = pose.keypoints.find(k => k.name === 'right_shoulder');
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
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0);
}

// === POSITION SPLAT (Unchanged - it works perfectly with the new SplatMesh object) ===
function positionSplat(splat, spine, depth, scale, angle, shoulderDist) {
    if (!splat) return;
    // Anchor wings to the upper back
    spine.y += shoulderDist * 0.15;
    let spineX = (spine.x / video.videoWidth) * 2 - 1;
    let spineY = -(spine.y / video.videoHeight) * 2 + 1;
    if (CAMERA_MODE === 'user') spineX = -spineX;
    const worldPosition = new THREE.Vector3(spineX, spineY, 0.5);
    worldPosition.unproject(camera);
    const dir = worldPosition.sub(camera.position).normalize();
    const distance = Math.abs(depth / dir.z);
    const targetPos = camera.position.clone().add(dir.multiplyScalar(distance));
    smoothedWingsPos.x += (targetPos.x - smoothedWingsPos.x) * SMOOTHING_FACTOR;
    smoothedWingsPos.y += (targetPos.y - smoothedWingsPos.y) * SMOOTHING_FACTOR;
    smoothedWingsPos.z += (targetPos.z - smoothedWingsPos.z) * SMOOTHING_FACTOR;
    splat.position.set(smoothedWingsPos.x, smoothedWingsPos.y, smoothedWingsPos.z);
    let scaleFactor = scale * 0.5;
    if (splatBoundingBoxSize) {
        const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
        if (avg > 0) scaleFactor = (1.5 / avg) * scale;
    }
    if (isNaN(scaleFactor) || scaleFactor <= 0) scaleFactor = 1.0;
    splat.scale.set(scaleFactor, scaleFactor, scaleFactor);
    const bodyRot = CAMERA_MODE === 'user' ? -angle : angle;
    smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR;
    smoothedWingsRot.y += (bodyRot * 0.5 - smoothedWingsRot.y) * SMOOTHING_FACTOR;
    smoothedWingsRot.z += (bodyRot * 0.2 - smoothedWingsRot.z) * SMOOTHING_FACTOR;
    splat.rotation.set(smoothedWingsRot.x, smoothedWingsRot.y, smoothedWingsRot.z);
}

// === START ===
window.addEventListener('DOMContentLoaded', init);
