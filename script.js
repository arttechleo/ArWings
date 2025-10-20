// Global variables for the scene and pose detection
let scene, camera;
let sparkRenderer; 
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

// Gaussian Splatting support - ***UPDATED FOR SINGLE .SPZ ASSET***
const USE_GAUSSIAN_SPLAT = true; 
// NOTE: We now use a single path for the combined wings model
const SPLAT_PATH_WINGS = 'assets/wings.spz'; 

// Camera configuration
const CAMERA_MODE = 'environment'; // 'environment' (rear) or 'user' (front)

// === DEBUG LOGGER CLASS (omitted for brevity, assume it's included) ===
class DebugLogger {
    // ... (Code from previous response)
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
    setupControls() { /* ... */ }
    log(type, message) { /* ... */ }
    updateStatus(status) { /* ... */ }
    updateVideoStatus(status) { /* ... */ }
    updateModelStatus(status) { /* ... */ }
    updatePoseStatus(status) { /* ... */ }
    updateAssetStatus(status) { /* ... */ }
    updateFPS(fps) { /* ... */ }
}
// === END DEBUG LOGGER CLASS ===

// === INITIALIZE (No change) ===
function init() {
    // ... (Code from previous response)
    debugLogger = new DebugLogger();
    debugLogger.log('info', '=== AR Back Wings Starting ===');
    debugLogger.log('info', `Camera Mode: ${CAMERA_MODE === 'user' ? 'Front (Selfie)' : 'Rear'}`);
    
    // Check for core libraries
    if (typeof THREE === 'undefined' || typeof tf === 'undefined' || typeof poseDetection === 'undefined') {
        debugLogger.log('error', 'One or more required libraries (Three.js, TF.js, Pose Detection) failed to load!');
        alert('Required libraries failed to load. Check console for details.');
        return;
    }
    debugLogger.log('success', 'Core libraries loaded');

    // Check for Spark.js (The required Gaussian Splatting library)
    if (typeof window.SplatMesh === 'undefined' || typeof window.SparkRenderer === 'undefined') {
        debugLogger.log('error', 'Spark.js (SplatMesh/SparkRenderer) not loaded!');
        debugLogger.log('warning', 'Falling back to Box Placeholders regardless of USE_GAUSSIAN_SPLAT flag.');
    } else {
        debugLogger.log('success', 'Spark.js loaded');
    }

    const startBtn = document.getElementById('start-btn');
    const instructions = document.getElementById('instructions');

    if (startBtn && instructions) {
        debugLogger.log('info', 'Setting up start button listener');
        startBtn.addEventListener('click', async () => {
            debugLogger.log('info', 'Start button clicked!');
            instructions.classList.add('hidden');
            await startAR();
        });
    }

    debugLogger.updateStatus('Ready - Tap Start');
    debugLogger.log('success', 'Initialization complete');
}
// === END INITIALIZE ===

// === START AR EXPERIENCE (No change) ===
async function startAR() {
    // ... (Code from previous response)
    try {
        debugLogger.updateStatus('Initializing...');
        // ... camera setup logic ...
        const threeContainer = document.getElementById('three-container');
        canvas = document.getElementById('output-canvas');
        ctx = canvas.getContext('2d');
        video = document.getElementById('video');
        // ... (camera setup and video loading success) ...
        
        // ... (size setting logic) ...
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        video.style.width = `${vw}px`;
        video.style.height = `${vh}px`;
        canvas.width = vw;
        canvas.height = vh;
        threeContainer.style.width = `${vw}px`;
        threeContainer.style.height = `${vh}px`;

        debugLogger.updateStatus('Setting up 3D renderer...');
        await setupThreeJS();
        debugLogger.log('success', '3D renderer ready');

        debugLogger.updateStatus('Loading AI model...');
        poseModel = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );

        debugLogger.log('success', 'AI model loaded!');
        debugLogger.updateStatus('Running - Show back!');

        isRunning = true;
        renderLoop();
    } catch (error) {
        // ... (error handling logic) ...
         debugLogger.log('error', `INIT ERROR: ${error.message}`);
    }
}
// === END START AR EXPERIENCE ===


// === SETUP THREE.JS (MODIFIED for single .spz loading) ===
async function setupThreeJS() {
    const threeContainer = document.getElementById('three-container');

    // 1. Create a standard THREE.WebGLRenderer
    const threeRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    threeRenderer.setPixelRatio(window.devicePixelRatio);
    threeRenderer.setSize(canvas.width, canvas.height);
    threeContainer.appendChild(threeRenderer.domElement);

    // 2. Wrap it in SparkRenderer
    sparkRenderer = new window.SparkRenderer(threeRenderer);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        75,
        canvas.width / canvas.height,
        0.01, 
        1000
    );
    camera.position.set(0, 0, 0); 

    if (USE_GAUSSIAN_SPLAT && typeof window.SplatMesh !== 'undefined') {
        debugLogger.log('info', `Loading single Spark.js asset: ${SPLAT_PATH_WINGS}`);
        debugLogger.updateAssetStatus('Loading Gaussian Splat...');
        
        try {
            // Load the single combined wings model
            const splatModel = new window.SplatMesh({ url: SPLAT_PATH_WINGS });
            
            splatModel.on('loaded', () => {
                debugLogger.log('success', 'Combined wings splat loaded.');

                // *** CLONE THE LOADED MODEL FOR LEFT AND RIGHT WINGS ***
                leftWing = splatModel;
                rightWing = splatModel.clone(); // Create a separate instance for positioning

                leftWing.visible = false;
                rightWing.visible = false;

                scene.add(leftWing);
                scene.add(rightWing);
                
                debugLogger.updateAssetStatus('Gaussian Splats ready');
            });
            
            splatModel.on('error', (e) => {
                debugLogger.log('error', `Splat loading error: ${e.message || 'Unknown error'}`);
                debugLogger.log('info', 'Falling back to box placeholders');
                createBoxWings();
            });

            debugLogger.updateAssetStatus('Gaussian Splat requested');
            
        } catch (err) {
            debugLogger.log('error', `Failed to initialize Spark.js: ${err.message}`);
            debugLogger.log('info', 'Falling back to box placeholders');
            createBoxWings();
        }
    } else {
        createBoxWings();
    }

    debugLogger.log('success', '3D wing assets setup complete');
}
// === END SETUP THREE.JS ===

// === CREATE BOX WING PLACEHOLDERS (No change) ===
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
// === END CREATE BOX WING PLACEHOLDERS ===


// === MAIN RENDER LOOP (No change in logic) ===
async function renderLoop() {
    if (!isRunning) return;

    requestAnimationFrame(renderLoop);

    // ... (FPS Counter and Video Drawing logic) ...
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

    // Pose Detection Logic (Logic is unchanged, relies on leftWing/rightWing being set)
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

                    const shoulderDist = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);

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
                        const hipCenterY = (leftHip.y + rightHip.y) / 2;
                        spineCenter.y = (spineCenter.y + hipCenterY) / 2;
                    }

                    const shoulderAngle = Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x);

                    if (leftWing && rightWing) {
                        if (CAMERA_MODE === 'user') {
                            positionWingGluedToBack(leftWing, rightShoulder, leftShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'left');
                            positionWingGluedToBack(rightWing, leftShoulder, rightShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'right');
                        } else {
                            positionWingGluedToBack(leftWing, leftShoulder, rightShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'left');
                            positionWingGluedToBack(rightWing, rightShoulder, leftShoulder, spineCenter, depth, scale, shoulderAngle, shoulderDist, 'right');
                        }

                        leftWing.visible = true;
                        rightWing.visible = true;
                    }
                    debugLogger.updatePoseStatus(`Detected (${leftShoulder.score.toFixed(2)})`);

                    const debugPoints = [leftShoulder, rightShoulder];
                    if (leftHip && rightHip) debugPoints.push(leftHip, rightHip);
                    drawDebugPoints(ctx, debugPoints);
                } else {
                    if (leftWing) leftWing.visible = false;
                    if (rightWing) rightWing.visible = false;
                    debugLogger.updatePoseStatus('Low confidence');
                    baseShoulderDistance = null;
                }
            } else {
                if (leftWing) leftWing.visible = false;
                if (rightWing) rightWing.visible = false;
                debugLogger.updatePoseStatus('No person detected');
                baseShoulderDistance = null;
            }
        } catch (err) {
            debugLogger.log('error', `Pose detection: ${err.message}`);
        }
    }

    if (sparkRenderer) {
        sparkRenderer.render(scene, camera);
    }
}
// === END MAIN RENDER LOOP ===

// === POSITION WING GLUED TO BACK (No change) ===
function positionWingGluedToBack(wing, thisShoulder, otherShoulder, spineCenter, depth, scale, shoulderAngle, currentShoulderDist, side) {
    // ... (Code remains the same as it correctly calculates position/rotation based on the 'side' parameter)
    // Convert to normalized coordinates
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
    const distFromSpine = Math.hypot(shoulderToSpineDx, shoulderToSpineDy);
    
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
    
    wing.scale.set(scale * 1.2, scale * 1.5, scale * 1.2); 

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
// === END POSITION WING GLUED TO BACK ===

// === DRAW DEBUG POINTS (No change) ===
function drawDebugPoints(ctx, keypoints) {
    // ... (Code from previous response)
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
// === END DRAW DEBUG POINTS ===

// === START WHEN PAGE LOADS (No change) ===
window.addEventListener('DOMContentLoaded', () => {
    init();
});
