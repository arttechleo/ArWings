// AR Back Wings — Spark Gaussian Splat version


// Draw camera image
ctx.save();
if (CAMERA_MODE === 'user') ctx.scale(-1, 1);
const drawX = CAMERA_MODE === 'user' ? -canvas.width : 0;
ctx.drawImage(video, drawX, 0, canvas.width, canvas.height);
ctx.restore();


// Pose estimation
try {
if (poseModel && video.readyState === video.HAVE_ENOUGH_DATA) {
const poses = await poseModel.estimatePoses(video);
const pose = poses?.[0];
const ls = pose?.keypoints?.find(k => k.name === 'left_shoulder');
const rs = pose?.keypoints?.find(k => k.name === 'right_shoulder');


if (ls && rs && ls.score > MIN_SHOULDER_SCORE && rs.score > MIN_SHOULDER_SCORE) {
debugLogger.updateStatus('pose', '✅ Pose detected');
if (splatLoaded && wingsMesh) {
applyPoseToSplat(ls, rs, wingsMesh);
if (!wingsMesh.visible) {
wingsMesh.visible = true;
debugLogger.log('success', '👁️ Wings visible');
}
}
} else {
if (wingsMesh) wingsMesh.visible = false;
debugLogger.updateStatus('pose', '❌ No pose / low confidence');
}
}
} catch (e) {
debugLogger.log('warning', `Pose estimate warning: ${e.message}`);
}


// Render 3D to WebGL canvas
renderer.render(scene, camera);
// Composite WebGL over the 2D canvas
ctx.drawImage(renderer.domElement, 0, 0);
}


// ---------------- Pose → Splat transform ---------------
function applyPoseToSplat(ls, rs, splat) {
// Shoulder distance & angle in screen space
const dx = rs.x - ls.x;
const dy = rs.y - ls.y;
const dist = Math.hypot(dx, dy);
const angle = Math.atan2(dy, dx);


// Upper-back anchor (slightly below shoulder mid-point)
const spine = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 + dist * 0.15 };


// Approximate depth & scale from shoulder span
const depth = -2.0 - (150 / Math.max(1, dist));
let scale = Math.max(0.5, dist / 150);


// Convert normalized screen coords to world space in front of camera
let nx = (spine.x / video.videoWidth) * 2 - 1;
let ny = -(spine.y / video.videoHeight) * 2 + 1;
if (CAMERA_MODE === 'user') nx = -nx;


const target = new THREE.Vector3(nx, ny, 0.5);
target.unproject(camera);
const dir = target.sub(camera.position).normalize();
const distance = Math.abs(depth / dir.z);
const world = camera.position.clone().add(dir.multiplyScalar(distance));


// Smooth position
smoothedWingsPos.lerp(world, SMOOTHING_FACTOR);
splat.position.copy(smoothedWingsPos);


// Scale using average bbox size to normalize across different assets
let scaleFactor = scale * 0.5;
if (splatBoundingBoxSize) {
const avg = (splatBoundingBoxSize.x + splatBoundingBoxSize.y + splatBoundingBoxSize.z) / 3;
if (avg > 0) scaleFactor = (1.5 / avg) * scale;
}
if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1.0;
splat.scale.setScalar(scaleFactor);


// Orientation: slight downward pitch, yaw/roll from body angle
const bodyRot = (CAMERA_MODE === 'user') ? -angle : angle;
smoothedWingsRot.x += (-0.2 - smoothedWingsRot.x) * SMOOTHING_FACTOR; // gentle forward tilt
smoothedWingsRot.y += (bodyRot * 0.5 - smoothedWingsRot.y) * SMOOTHING_FACTOR; // yaw follow
smoothedWingsRot.z += (bodyRot * 0.2 - smoothedWingsRot.z) * SMOOTHING_FACTOR; // roll follow
splat.rotation.copy(smoothedWingsRot);
}
