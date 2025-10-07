import * as THREE from 'three';

let scene, camera, renderer, leftWing, rightWing, video, poseModel;

// === INIT FUNCTION ===
async function init() {
  try {
    // Setup video feed
    video = document.getElementById('video');
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } 
    });
    video.srcObject = stream;

    // Wait for video to be ready
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    // Setup Three.js with proper camera
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('container').appendChild(renderer.domElement);

    scene = new THREE.Scene();

    // Proper perspective camera for AR
    const fov = 75;
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
    camera.position.set(0, 0, 0);

    // Create wing models (replace with GLTF models later)
    const wingGeometry = new THREE.BoxGeometry(0.15, 0.3, 0.05);
    const wingMaterial = new THREE.MeshNormalMaterial();
    
    leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
    rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
    
    scene.add(leftWing);
    scene.add(rightWing);
    
    leftWing.visible = false;
    rightWing.visible = false;

    // Load MoveNet model for pose detection
    console.log('Loading pose detection model...');
    poseModel = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      }
    );
    console.log('Model loaded successfully!');

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop
    animate();
  } catch (error) {
    console.error('Initialization error:', error);
    alert('Error initializing AR: ' + error.message);
  }
}

// === ANIMATION LOOP ===
async function animate() {
  requestAnimationFrame(animate);

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
        
        // Check confidence threshold
        if (leftShoulder && rightShoulder && 
            leftShoulder.score > 0.3 && rightShoulder.score > 0.3) {
          
          // Calculate shoulder distance for depth estimation
          const shoulderDistance = Math.sqrt(
            Math.pow(rightShoulder.x - leftShoulder.x, 2) +
            Math.pow(rightShoulder.y - leftShoulder.y, 2)
          );
          
          // Estimate depth based on shoulder width (average ~45cm)
          const estimatedDepth = -1.5 - (200 / shoulderDistance);
          const scale = shoulderDistance / 200;
          
          // Position left wing (offset backwards and outwards)
          positionWing(leftWing, leftShoulder, estimatedDepth, scale, 'left');
          
          // Position right wing (offset backwards and outwards)
          positionWing(rightWing, rightShoulder, estimatedDepth, scale, 'right');
          
          leftWing.visible = true;
          rightWing.visible = true;
        } else {
          leftWing.visible = false;
          rightWing.visible = false;
        }
      } else {
        leftWing.visible = false;
        rightWing.visible = false;
      }
    } catch (error) {
      console.error('Pose detection error:', error);
    }
  }

  renderer.render(scene, camera);
}

// === POSITION WING ON SHOULDER ===
function positionWing(wing, shoulder, depth, scale, side) {
  // Normalize coordinates to [-1, 1] clip space
  const x = (shoulder.x / video.videoWidth) * 2 - 1;
  const y = -(shoulder.y / video.videoHeight) * 2 + 1;
  
  // Offset backwards (negative Z in screen space means moving "into" screen)
  // Offset outwards from shoulder
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
}

// === START ===
init();
