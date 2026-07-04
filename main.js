import * as THREE from "three";

// ---------------------------------------------------------------------------
// Scroll-driven video scrubbing
// The page is one long scroll track. Scroll position maps to a progress value
// t in [0, 1]; the render loop eases toward it and sets video.currentTime to
// t * duration, so scrolling down plays the clip forward and scrolling up
// plays it in reverse, frame for frame.
// ---------------------------------------------------------------------------

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 10);

// --- The film ----------------------------------------------------------------
const video = document.createElement("video");
video.src = "assets/0703.mp4";
video.muted = true;
video.playsInline = true;
video.preload = "auto";
video.load();
// The element never enters the DOM (it only feeds the texture); expose a
// handle so the scrub state can be inspected from the console
window.scrubVideo = video;

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;

// The clip is shown as-is, full frame — no keying, its own background stays
const screenMaterial = new THREE.MeshBasicMaterial({ map: videoTexture });

const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMaterial);
scene.add(screen);

let videoDuration = 0;
let videoAspect = 16 / 9;

video.addEventListener("loadedmetadata", () => {
  videoDuration = video.duration;
  videoAspect = video.videoWidth / video.videoHeight;
  fitScreen();
  // Decode the first frame so the poster shows before any scrolling
  video.currentTime = 0.001;
});

// Size the plane so the video "covers" the whole viewport, like a
// full-screen background (slight overscan leaves room for the zoom drift)
function fitScreen() {
  const dist = camera.position.z;
  const viewH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const viewW = viewH * camera.aspect;
  const overscan = 1.08;
  let w = viewW * overscan;
  let h = w / videoAspect;
  if (h < viewH * overscan) {
    h = viewH * overscan;
    w = h * videoAspect;
  }
  screen.scale.set(w, h, 1);
}

// ---------------------------------------------------------------------------
// Timeline helpers
// ---------------------------------------------------------------------------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Progress of t through the window [start, end], eased with smoothstep
function phase(t, start, end) {
  const x = clamp01((t - start) / (end - start));
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------------
// Scroll state
// ---------------------------------------------------------------------------
let targetT = 0; // where the scrollbar says we should be
let currentT = 0; // eased playhead actually rendered

function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  targetT = max > 0 ? clamp01(window.scrollY / max) : 0;
}
window.addEventListener("scroll", readScroll, { passive: true });
readScroll();

// ---------------------------------------------------------------------------
// DOM overlays driven by the same playhead
// ---------------------------------------------------------------------------
const hero = document.getElementById("hero");
const heroPanel = hero.querySelector(".hero-panel");
const progressFill = document.getElementById("progress-fill");
const captions = [...document.querySelectorAll(".caption"), document.querySelector(".outro")];
const captionAt = captions.map((el) => parseFloat(el.dataset.at));

function updateOverlays(t) {
  progressFill.style.width = `${(t * 100).toFixed(2)}%`;

  // Hero fades over the first 12% of the timeline while its panel drifts up
  const heroGone = phase(t, 0, 0.12);
  hero.style.opacity = String(1 - heroGone);
  hero.style.visibility = heroGone >= 1 ? "hidden" : "visible";
  heroPanel.style.transform = `translateY(${heroGone * -90}px)`;

  // Each caption is visible inside a small window around its anchor point
  captions.forEach((el, i) => {
    const center = captionAt[i];
    const isOutro = el.classList.contains("outro");
    const halfWindow = isOutro ? 0.08 : 0.09;
    const dist = Math.abs(t - center);
    let opacity = clamp01(1 - dist / halfWindow);
    // Outro stays visible at the very end of the track
    if (isOutro && t > center) opacity = 1;
    el.style.opacity = String(opacity);
    const drift = (t - center) * -400;
    el.style.transform = isOutro ? "none" : `translateY(calc(-50% + ${drift}px))`;
  });
}

// ---------------------------------------------------------------------------
// Everything below is a pure function of the playhead t, which is what makes
// the sequence perfectly reversible when the user scrolls back up.
// ---------------------------------------------------------------------------
function applyTimeline(t) {
  // Scrub the film. Only seek when the previous seek has finished and the
  // difference is visible, so we don't flood the decoder with requests.
  if (videoDuration > 0 && video.readyState >= 2 && !video.seeking) {
    const target = Math.min(t * videoDuration, videoDuration - 0.05);
    if (Math.abs(video.currentTime - target) > 1 / 60) {
      video.currentTime = target;
    }
  }

  // Gentle zoom drift on top of the film: the full-screen frame eases toward
  // the camera as the sequence plays (overscan keeps the edges covered)
  const settle = phase(t, 0, 0.15);
  screen.position.z = lerp(-0.4, 0, settle) + phase(t, 0.85, 1) * 0.3;
}

// ---------------------------------------------------------------------------
// Render loop with inertial easing toward the scroll position
// ---------------------------------------------------------------------------
function tick() {
  currentT = lerp(currentT, targetT, 0.075);
  // Snap when close enough so the playhead settles exactly
  if (Math.abs(currentT - targetT) < 0.0004) currentT = targetT;

  applyTimeline(currentT);
  updateOverlays(currentT);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ---------------------------------------------------------------------------
// Header / footer nav: links scroll to anchors on the timeline
// ---------------------------------------------------------------------------
document.querySelectorAll(".nav-to").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: max * parseFloat(a.dataset.to), behavior: "smooth" });
  });
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitScreen();
  readScroll();
});
