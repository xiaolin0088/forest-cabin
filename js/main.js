/* ============================================================
   森林小屋 · Three.js 场景 v2
   质感升级：IBL 环境反射 / SSAO 环境光遮蔽 / Bloom / 色调分级
   渐变天空穹顶 + 星野 / 起伏地形 / 有机植被 / 五种天气平滑过渡
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { FilmShader } from 'three/addons/shaders/FilmShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ---------------- 工具 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const TMP3 = new THREE.Vector3();
const PATCH_CENTER = new THREE.Vector3(0, 0, 14);

function angDist(a, b) {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function canvasTexture(size, draw, repX = 1, repY = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 8;
  return t;
}

/* ---------------- 渲染器 / 场景 / 相机 ---------------- */
const URL_PARAMS = new URLSearchParams(window.location.search);
const LOW_QUALITY = URL_PARAMS.has('low');
const NO_SSAO = URL_PARAMS.has('nosao');

// 移动端检测与画质档位（自动降级：低像素比 / 小阴影贴图 / 少植被粒子 / 关 SSAO）
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
const Q = IS_MOBILE
  ? { pixelRatio: 1, shadow: 1024, grass: [320, 160, 70], wild: 50, flowers: 36, trees: 12, rain: 900, dust: 80, fireflies: 20 }
  : { pixelRatio: Math.min(window.devicePixelRatio, 1.6), shadow: 2048, grass: [700, 350, 150], wild: 90, flowers: 46, trees: 16, rain: 1800, dust: 150, fireflies: 30 };

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(LOW_QUALITY ? 0.6 : Q.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(22, 9.5, 27);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.3, 9.5);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 5;
controls.maxDistance = 95;
controls.maxPolarAngle = 1.52;
controls.update();

/* IBL：室内环境贴图提供细腻微反射，消除塑料感 */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
pmrem.dispose();

/* ---------------- 光照 ---------------- */
const sunLight = new THREE.DirectionalLight(0xfff2dd, 3.3);
sunLight.position.set(60, 50, 25);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(Q.shadow, Q.shadow);
sunLight.shadow.camera.left = -60;
sunLight.shadow.camera.right = 60;
sunLight.shadow.camera.top = 60;
sunLight.shadow.camera.bottom = -60;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 260;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.02;
sunLight.shadow.camera.updateProjectionMatrix();
scene.add(sunLight);
scene.add(sunLight.target);

const hemi = new THREE.HemisphereLight('#bcd8f0', '#8a9a66', 0.55);
scene.add(hemi);

const ambient = new THREE.AmbientLight('#334455', 0.3);
scene.add(ambient);

const porchLight = new THREE.PointLight('#ffb26b', 0, 14, 2);
porchLight.position.set(0, 2.6, 2.9);
scene.add(porchLight);

/* ---------------- 天空穹顶（渐变 + 太阳/月亮辉光 + 程序化星空） ---------------- */
const skyUniforms = {
  topColor: { value: new THREE.Color('#2f6fc2') },
  horizonColor: { value: new THREE.Color('#cfe3f2') },
  bottomColor: { value: new THREE.Color('#b3d9f2') },
  sunDir: { value: new THREE.Vector3(0.6, 0.5, 0.25).normalize() },
  sunColor: { value: new THREE.Color('#fff1c4') },
  sunIntensity: { value: 1.15 },
  sunExponent: { value: 620 },
  moonDir: { value: new THREE.Vector3(-0.72, 0.46, 0.58).normalize() },
  moonColor: { value: new THREE.Color('#e6edf8') },
  moonIntensity: { value: 0 },
  moonExponent: { value: 420 },
  starIntensity: { value: 0 },
  uTime: { value: 0 },
};

const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vDir;
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    uniform vec3 sunDir;
    uniform vec3 sunColor;
    uniform float sunIntensity;
    uniform float sunExponent;
    uniform vec3 moonDir;
    uniform vec3 moonColor;
    uniform float moonIntensity;
    uniform float moonExponent;
    uniform float starIntensity;
    uniform float uTime;

    float hash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 dir = normalize(vDir);
      float h = dir.y;
      vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.42, h));
      col = mix(col, bottomColor, 1.0 - smoothstep(-0.22, 0.02, h));

      float sd = max(dot(dir, sunDir), 0.0);
      col += sunColor * (pow(sd, sunExponent) * sunIntensity * 1.6);
      col += sunColor * (pow(sd, 6.0) * sunIntensity * 0.16);

      float md = max(dot(dir, moonDir), 0.0);
      col += moonColor * (pow(md, moonExponent) * moonIntensity * 1.4);
      col += moonColor * (pow(md, 5.0) * moonIntensity * 0.1);

      if (starIntensity > 0.001) {
        vec3 cell = floor(dir * 240.0);
        float hs = hash13(cell);
        float star = step(0.9976, hs) * smoothstep(0.02, 0.5, h);
        float tw = 0.65 + 0.35 * sin(uTime * 2.2 + hs * 512.0);
        col += vec3(1.0, 0.96, 0.88) * star * tw * starIntensity;
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
});

const skyDome = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 20), skyMat);
skyDome.renderOrder = -1;
skyDome.frustumCulled = false;
scene.add(skyDome);

/* ---------------- 起伏地形 ---------------- */
function groundHeight(x, z) {
  const d = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(d, 26, 85);
  let y =
    (Math.sin(x * 0.045) * Math.cos(z * 0.038) * 1.7 +
      Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.09 + 0.7) * 0.9 +
      Math.sin(x * 0.23 + 4.1) * Math.cos(z * 0.21 + 2.2) * 0.35) * flat;
  const rim = Math.max(0, (d - 150) / 130);
  y += rim * rim * rim * 26 * (0.7 + 0.3 * Math.sin(Math.atan2(z, x) * 3.0));
  return y;
}

const groundTex = canvasTexture(256, (g, s) => {
  g.fillStyle = '#ccd9b2';
  g.fillRect(0, 0, s, s);
  const tones = ['#bccba4', '#c3d2ab', '#b5c49c', '#cbd8b0'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = pick(tones);
    g.globalAlpha = 0.2 + Math.random() * 0.3;
    const w = 1 + Math.random() * 3;
    g.fillRect(Math.random() * s, Math.random() * s, w, w * 0.5 + Math.random());
  }
  g.globalAlpha = 0.3;
  for (let i = 0; i < 70; i++) {
    g.fillStyle = '#a9b98d';
    g.beginPath();
    g.ellipse(rand(0, s), rand(0, s), rand(3, 10), rand(2, 6), rand(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}, 24, 24);

const terrainGeo = new THREE.PlaneGeometry(640, 640, 120, 120);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color('#5f7d3d');
  const cHigh = new THREE.Color('#93a95e');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = groundHeight(x, z);
    pos.setY(i, y);
    const n = Math.sin(x * 0.5) * Math.cos(z * 0.4) + Math.sin(x * 0.13 + 2.0) * 0.5;
    const m = THREE.MathUtils.clamp(0.52 + n * 0.28 + y * 0.02 + rand(-0.06, 0.06), 0, 1);
    c.copy(cLow).lerp(cHigh, m);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}

const terrain = new THREE.Mesh(
  terrainGeo,
  new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 1 })
);
terrain.receiveShadow = true;
scene.add(terrain);

const dirtTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#a5835b';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#967548' : '#b39268';
    g.globalAlpha = 0.35 + Math.random() * 0.5;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  g.globalAlpha = 1;
}, 4, 4);

const patch = new THREE.Mesh(
  new THREE.CircleGeometry(7.6, 44),
  new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 })
);
patch.rotation.x = -Math.PI / 2;
patch.position.set(0, 0.02, 14);
patch.receiveShadow = true;
scene.add(patch);

const path = new THREE.Mesh(
  new THREE.PlaneGeometry(0.85, 4.4),
  new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 })
);
path.rotation.x = -Math.PI / 2;
path.position.set(0, 0.03, 5.1);
path.receiveShadow = true;
scene.add(path);

/* ---------------- 纹理 ---------------- */
const woodTex = canvasTexture(256, (g, s) => {
  const rows = 4, rh = s / rows;
  const base = ['#a97142', '#9c6837', '#b07a4a', '#a26b3c'];
  for (let r = 0; r < rows; r++) {
    g.fillStyle = base[r % 4];
    g.fillRect(0, r * rh, s, rh);
    g.fillStyle = 'rgba(62,36,16,0.6)';
    g.fillRect(0, r * rh, s, 2);
    g.fillRect(0, r * rh + rh - 1, s, 2);
    for (let k = 0; k < 30; k++) {
      g.strokeStyle = 'rgba(52,30,14,' + (0.08 + Math.random() * 0.16) + ')';
      g.lineWidth = 1;
      const x = Math.random() * s, y = r * rh + Math.random() * rh;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rand(-9, 9), y + rand(16, 34));
      g.stroke();
    }
    if (Math.random() < 0.55) {
      g.fillStyle = 'rgba(52,30,14,0.5)';
      g.beginPath();
      g.ellipse(Math.random() * s, r * rh + Math.random() * rh, 3 + Math.random() * 4, 2 + Math.random() * 3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}, 2, 1);

const barkTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#6a4a3e';
  g.fillRect(0, 0, s, s);
  const tones = ['#5a3d33', '#79564a', '#52362c'];
  for (let i = 0; i < 110; i++) {
    g.strokeStyle = tones[i % 3];
    g.lineWidth = rand(1, 3);
    const x = Math.random() * s;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + rand(-4, 4), s);
    g.stroke();
  }
}, 1, 1);

const roofTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#7e4a30';
  g.fillRect(0, 0, s, s);
  const rows = 4, rh = s / rows, cols = 6, cw = s / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.fillStyle = pick(['#8a5036', '#73422b', '#84523a']);
      const off = (r % 2) * cw / 2;
      const cx = ((c * cw + off) % s) + cw / 2;
      g.beginPath();
      g.arc(cx, r * rh + rh * 0.75, cw * 0.58, Math.PI, 0);
      g.fill();
      g.strokeStyle = 'rgba(50,26,14,0.55)';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(50,26,14,0.7)';
  for (let r = 1; r < rows; r++) g.fillRect(0, r * rh - 1, s, 2);
}, 2, 2);

const stoneTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#9a9a94';
  g.fillRect(0, 0, s, s);
  const rows = 3, rh = s / rows, cols = 5, cw = s / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const off = (r % 2) * cw / 2;
      g.fillStyle = pick(['#8f8f89', '#a3a39c', '#868680', '#9c9c95']);
      g.fillRect(c * cw, r * rh, cw - 2, rh - 2);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(c * cw + 2, r * rh + 2, cw - 6, 2);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(c * cw + 2, r * rh + rh - 4, cw - 6, 2);
    }
  }
  g.fillStyle = 'rgba(70,70,66,0.9)';
  for (let r = 0; r < rows; r++) g.fillRect(0, r * rh, s, 2);
  for (let c = 0; c < cols; c++) g.fillRect(c * cw, 0, 2, s);
}, 2, 1);

const brickTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#8d6a55';
  g.fillRect(0, 0, s, s);
  const rows = 6, rh = s / rows, cols = 4, cw = s / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const off = (r % 2) * cw / 2;
      g.fillStyle = pick(['#9a7459', '#83583f', '#90664b', '#7d543d']);
      g.fillRect(c * cw, r * rh, cw - 1, rh - 1);
    }
  }
  g.fillStyle = 'rgba(60,42,32,0.8)';
  for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 1, s, 2);
  for (let c = 0; c <= cols; c++) {
    const off = ((c % 2) * rh) / 2;
    g.fillRect(c * cw - 1, 0, 2, s / 2);
    g.fillRect(c * cw - 1 + off, s / 2, 2, s / 2);
  }
}, 1, 1);

const softTex = canvasTexture(128, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 3, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
}, 1, 1);

const flowerTex = canvasTexture(64, (g, s) => {
  g.clearRect(0, 0, s, s);
  g.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.beginPath();
    g.arc(s / 2 + Math.cos(a) * 9, s / 2 + Math.sin(a) * 9, 6.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffd54f';
  g.beginPath();
  g.arc(s / 2, s / 2, 4.5, 0, Math.PI * 2);
  g.fill();
}, 1, 1);

const beeStripeTex = canvasTexture(64, (g, s) => {
  g.fillStyle = '#ffd54f';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#2b2320';
  const band = s / 12;
  for (let i = 0; i < 3; i++) {
    const y = Math.floor(s / 6) * (1 + i * 2) - 2;
    g.fillRect(0, y, s, band);
  }
}, 2, 1);

function makeWingTexture(hue) {
  return canvasTexture(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.translate(s / 2, s / 2);
    g.fillStyle = hue;
    g.strokeStyle = 'rgba(40,25,15,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(10, -16, 26, 16, -0.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(-4, 16, 20, 14, 0.35, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.arc(rand(-18, 22), rand(-24, 18), rand(1.5, 3.2), 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(30,20,10,0.85)';
    g.beginPath();
    g.arc(6, -2, 3, 0, Math.PI * 2);
    g.fill();
  }, 1, 1);
}

/* ---------------- 小屋 ---------------- */
const cabin = new THREE.Group();
scene.add(cabin);

const wallMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.82 });
const darkWood = new THREE.MeshStandardMaterial({ color: '#5d4037', roughness: 0.75 });
const trimMat = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.8 });

const foundation = new THREE.Mesh(
  new THREE.BoxGeometry(5.5, 0.5, 4.5),
  new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 })
);
foundation.position.y = 0.25;
foundation.castShadow = true;
foundation.receiveShadow = true;
cabin.add(foundation);

const walls = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), wallMat);
walls.position.y = 2.0;
walls.castShadow = true;
walls.receiveShadow = true;
cabin.add(walls);

const interior = new THREE.Mesh(
  new THREE.BoxGeometry(3.9, 2.3, 3.3),
  new THREE.MeshStandardMaterial({ color: '#241a14', roughness: 1 })
);
interior.position.y = 1.7;
cabin.add(interior);

const interiorLight = new THREE.PointLight('#ffb26b', 0, 7, 2);
interiorLight.position.set(0, 2.2, 0.6);
cabin.add(interiorLight);

// 墙角立柱
const cornerTrimGeo = new THREE.BoxGeometry(0.16, 3.1, 0.16);
[
  [2.42, 2.0, 1.92], [-2.42, 2.0, 1.92], [2.42, 2.0, -1.92], [-2.42, 2.0, -1.92],
].forEach(([x, y, z]) => {
  const trim = new THREE.Mesh(cornerTrimGeo, trimMat);
  trim.position.set(x, y, z);
  trim.castShadow = true;
  cabin.add(trim);
});

// 屋顶
const roofShape = new THREE.Shape();
roofShape.moveTo(-3.3, 0);
roofShape.lineTo(3.3, 0);
roofShape.lineTo(0, 2.1);
roofShape.closePath();
const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 5.2, bevelEnabled: false });
roofGeo.translate(0, 3.5, -2.6);
const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85 }));
roof.castShadow = true;
roof.receiveShadow = true;
cabin.add(roof);

// 屋檐封板
const fasciaGeo = new THREE.BoxGeometry(5.7, 0.14, 0.24);
[2.62, -2.62].forEach((z) => {
  const fascia = new THREE.Mesh(fasciaGeo, trimMat);
  fascia.position.set(0, 3.55, z);
  fascia.castShadow = true;
  cabin.add(fascia);
});

// 烟囱（砖砌）
const chimney = new THREE.Mesh(
  new THREE.BoxGeometry(0.75, 1.7, 0.75),
  new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9 })
);
chimney.position.set(1.3, 4.85, -0.9);
chimney.castShadow = true;
cabin.add(chimney);
const chimneyCap = new THREE.Mesh(
  new THREE.BoxGeometry(0.95, 0.16, 0.95),
  new THREE.MeshStandardMaterial({ color: '#6f6f6a', roughness: 0.9 })
);
chimneyCap.position.set(1.3, 5.75, -0.9);
chimneyCap.castShadow = true;
cabin.add(chimneyCap);

// 门 + 门框
const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.85, 0.12), darkWood);
door.position.set(0, 1.425, 2.02);
door.castShadow = true;
cabin.add(door);
const frameGeo = new THREE.BoxGeometry(0.14, 2.0, 0.16);
[-0.6, 0.6].forEach((x) => {
  const f = new THREE.Mesh(frameGeo, darkWood);
  f.position.set(x, 1.5, 2.02);
  f.castShadow = true;
  cabin.add(f);
});
const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.14, 0.16), darkWood);
lintel.position.set(0, 2.46, 2.02);
lintel.castShadow = true;
cabin.add(lintel);

const knob = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 12, 12),
  new THREE.MeshStandardMaterial({ color: '#d4a94f', roughness: 0.25, metalness: 0.9 })
);
knob.position.set(-0.32, 1.45, 2.1);
cabin.add(knob);

// 窗户（玻璃 + 窗格 + 窗台 + 百叶窗）
const windowMat = new THREE.MeshStandardMaterial({
  color: '#b9d9e8', roughness: 0.12, metalness: 0.1, envMapIntensity: 0.9,
  emissive: '#ffcf8f', emissiveIntensity: 0.05,
});
const frameMat = new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: 0.7 });
const shutterMat = new THREE.MeshStandardMaterial({ color: '#4a5a42', roughness: 0.85 });

function makeWindow(x, y, z, ry, withShutters) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.06), windowMat);
  g.add(glass);
  const bar = (w, h, px, py) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), frameMat);
    m.position.set(px, py, 0);
    m.castShadow = true;
    g.add(m);
  };
  bar(0.12, 0.97, -0.36, 0);
  bar(0.12, 0.97, 0.36, 0);
  bar(0.97, 0.12, 0, 0.36);
  bar(0.97, 0.12, 0, -0.36);
  bar(0.06, 0.85, 0, 0);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.07, 0.22), trimMat);
  sill.position.set(0, -0.46, 0.04);
  sill.castShadow = true;
  g.add(sill);
  if (withShutters) {
    [-0.6, 0.6].forEach((sx) => {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.95, 0.05), shutterMat);
      shutter.position.set(sx, 0.02, 0.02);
      shutter.castShadow = true;
      g.add(shutter);
    });
  }
  g.position.set(x, y, z);
  g.rotation.y = ry || 0;
  cabin.add(g);
}
makeWindow(1.45, 2.25, 2.02, 0, true);
makeWindow(-1.45, 2.25, 2.02, 0, true);
makeWindow(2.02, 2.25, 0, Math.PI / 2, false);

// 门廊（露台 + 立柱 + 雨棚）
const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 1.5), wallMat);
deck.position.set(0, 0.58, 2.9);
deck.castShadow = true;
deck.receiveShadow = true;
cabin.add(deck);
[-1.05, 1.05].forEach((x) => {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.3, 8), trimMat);
  post.position.set(x, 1.75, 3.4);
  post.castShadow = true;
  cabin.add(post);
});
const awning = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 2.0), new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85 }));
awning.position.set(0, 2.95, 3.15);
awning.rotation.x = 0.22;
awning.castShadow = true;
cabin.add(awning);

// 门边灯笼
const lantern = new THREE.Group();
const lanternFrame = new THREE.Mesh(
  new THREE.CylinderGeometry(0.09, 0.09, 0.22, 8, 1, true),
  new THREE.MeshStandardMaterial({ color: '#3a2c20', roughness: 0.6, metalness: 0.5 })
);
lantern.add(lanternFrame);
const lanternCoreMat = new THREE.MeshStandardMaterial({
  color: '#ffe3ae', emissive: '#ffc36b', emissiveIntensity: 0, roughness: 0.4,
});
const lanternCore = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), lanternCoreMat);
lantern.add(lanternCore);
lantern.position.set(0.62, 2.42, 2.28);
cabin.add(lantern);

// 墙面常春藤
const ivyMat = new THREE.MeshStandardMaterial({ color: '#37582c', roughness: 0.9, side: THREE.DoubleSide });
for (let i = 0; i < 7; i++) {
  const leaf = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.3, 0.55), rand(0.2, 0.38)), ivyMat);
  leaf.position.set(-2.48, rand(0.9, 2.7), rand(-1.2, 1.4));
  leaf.rotation.y = Math.PI / 2 + rand(-0.15, 0.15);
  leaf.rotation.z = rand(-0.4, 0.4);
  cabin.add(leaf);
}

/* ---------------- 树木与灌木 ---------------- */
const treeGroup = new THREE.Group();
scene.add(treeGroup);

const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1 });
const pineMats = [
  new THREE.MeshStandardMaterial({ color: '#3a5f3a', roughness: 0.92 }),
  new THREE.MeshStandardMaterial({ color: '#4a6d42', roughness: 0.92 }),
  new THREE.MeshStandardMaterial({ color: '#416540', roughness: 0.92 }),
];
const oakMats = [
  new THREE.MeshStandardMaterial({ color: '#5a7d4a', roughness: 0.92 }),
  new THREE.MeshStandardMaterial({ color: '#6b8a52', roughness: 0.92 }),
  new THREE.MeshStandardMaterial({ color: '#64864e', roughness: 0.92 }),
];

function jitterCone(cone, amount) {
  const pos = cone.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.001) {
      const f = 1 + rand(-amount, amount);
      pos.setX(i, x * f);
      pos.setZ(i, z * f);
    }
  }
  pos.needsUpdate = true;
  cone.geometry.computeVertexNormals();
}

function makePine(s) {
  const g = new THREE.Group();
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.34 * s, 1.4 * s, 8), barkMat);
  t1.position.y = 0.7 * s;
  t1.rotation.z = rand(-0.04, 0.04);
  t1.rotation.x = rand(-0.04, 0.04);
  t1.castShadow = true;
  g.add(t1);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.21 * s, 1.3 * s, 8), barkMat);
  t2.position.y = 1.72 * s;
  t2.rotation.z = rand(-0.05, 0.05);
  t2.rotation.x = rand(-0.05, 0.05);
  t2.castShadow = true;
  g.add(t2);
  for (let i = 0; i < 4; i++) {
    const r = (2.25 - i * 0.44) * s;
    const h = (2.35 - i * 0.42) * s;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10 + i * 2), pineMats[i % pineMats.length]);
    jitterCone(cone, 0.05);
    cone.position.y = (1.55 + i * 0.6) * s;
    cone.rotation.z = rand(-0.05, 0.05);
    cone.rotation.x = rand(-0.05, 0.05);
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}

function makeOak(s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.52 * s, 2.0 * s, 8), barkMat);
  trunk.position.y = 1.0 * s;
  trunk.rotation.z = rand(-0.04, 0.04);
  trunk.castShadow = true;
  g.add(trunk);
  // 两根斜枝
  for (let k = 0; k < 2; k++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.14 * s, 1.3 * s, 7), barkMat);
    const a = (k === 0 ? 1 : -1) * rand(0.7, 1.1);
    b.position.set(Math.sin(a) * 0.35 * s, 1.95 * s, Math.cos(a) * 0.35 * s);
    b.rotation.set(rand(-0.2, 0.2), a, rand(-0.2, 0.2));
    b.castShadow = true;
    g.add(b);
  }
  const blobs = [
    [0, 1.95, 0, 1.2], [0.5, 2.45, 0.25, 0.95], [-0.5, 2.4, -0.2, 0.9],
    [0.15, 2.95, -0.35, 0.8], [0.55, 2.9, -0.15, 0.7], [-0.4, 2.95, 0.15, 0.72],
  ];
  blobs.forEach(([bx, by, bz, br], i) => {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(br * s, 12, 10), oakMats[i % oakMats.length]);
    blob.position.set(bx * s, by * s, bz * s);
    blob.scale.y = 0.85;
    blob.castShadow = true;
    g.add(blob);
  });
  return g;
}

const treePositions = [];
function sampleTreePos() {
  for (let tries = 0; tries < 90; tries++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(14, 48);
    const p = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    if (p.distanceTo(PATCH_CENTER) < 10) continue;
    if (Math.abs(p.x) < 5 && Math.abs(p.z) < 5) continue;
    if (treePositions.some((q) => q.distanceTo(p) < 7)) continue;
    treePositions.push(p);
    return p;
  }
  const fb = new THREE.Vector3(rand(-40, 40), 0, rand(-40, 40));
  treePositions.push(fb);
  return fb;
}

const trees = [];
for (let i = 0; i < Q.trees; i++) {
  const isPine = i % 2 === 0;
  const s = rand(0.9, 1.5);
  const g = isPine ? makePine(s) : makeOak(s);
  const p = sampleTreePos();
  p.y = groundHeight(p.x, p.z);
  g.position.copy(p);
  g.rotation.y = rand(0, Math.PI * 2);
  treeGroup.add(g);
  trees.push({ group: g, pos: p, kind: isPine ? 'pine' : 'oak', scale: s });
}

// 灌木丛
const bushMats = [
  new THREE.MeshStandardMaterial({ color: '#3d5c33', roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: '#46683a', roughness: 0.95 }),
];
for (let i = 0; i < 20; i++) {
  const t = treePositions[i % treePositions.length];
  const dir = TMP.subVectors(PATCH_CENTER, t).setY(0).normalize();
  const bx = t.x + dir.x * rand(1, 4.5) + rand(-1.5, 1.5);
  const bz = t.z + dir.z * rand(1, 4.5) + rand(-1.5, 1.5);
  const bush = new THREE.Mesh(new THREE.SphereGeometry(rand(0.7, 1.3), 10, 8), bushMats[i % 2]);
  bush.position.set(bx, groundHeight(bx, bz), bz);
  bush.scale.set(rand(0.9, 1.5), rand(0.6, 0.85), rand(0.9, 1.5));
  bush.castShadow = true;
  bush.receiveShadow = true;
  treeGroup.add(bush);
}

/* ---------------- 树上的小动物 ---------------- */
function attachBranch(tree, y, len) {
  const dir = TMP2.subVectors(PATCH_CENTER, tree.pos).setY(0).normalize();
  const branch = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, len, 7), barkMat);
  stick.rotation.z = Math.PI / 2;
  stick.castShadow = true;
  branch.add(stick);
  branch.position.set(0, y, 0);
  branch.rotation.y = Math.atan2(-dir.z, dir.x);
  tree.group.add(branch);
  return branch;
}

function makeSquirrel() {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: '#b5651d', roughness: 0.95 });
  const furLight = new THREE.MeshStandardMaterial({ color: '#d9a05b', roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), fur);
  body.scale.set(1, 0.9, 1.25);
  body.position.y = 0.24;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), fur);
  head.position.set(0, 0.44, 0.2);
  head.castShadow = true;
  g.add(head);
  const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), fur);
  ear1.position.set(0.08, 0.56, 0.18);
  g.add(ear1);
  const ear2 = ear1.clone();
  ear2.position.x = -0.08;
  g.add(ear2);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), furLight);
  tail.scale.set(0.7, 1.4, 0.9);
  tail.position.set(0, 0.42, -0.42);
  tail.rotation.x = 0.9;
  tail.castShadow = true;
  g.add(tail);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), furLight);
  belly.position.set(0, 0.2, 0.22);
  belly.scale.set(1, 0.8, 0.6);
  g.add(belly);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.3 });
  const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeMat);
  eye1.position.set(0.06, 0.47, 0.34);
  g.add(eye1);
  const eye2 = eye1.clone();
  eye2.position.x = -0.06;
  g.add(eye2);
  return g;
}

function makeBird(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat);
  body.scale.set(0.9, 1, 1.35);
  body.position.y = 0.17;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat);
  head.position.set(0, 0.3, 0.2);
  g.add(head);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.14, 6),
    new THREE.MeshStandardMaterial({ color: '#ff8f00', roughness: 0.6 })
  );
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.29, 0.34);
  g.add(beak);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.28), mat);
  tail.position.set(0, 0.19, -0.32);
  tail.rotation.x = -0.4;
  tail.castShadow = true;
  g.add(tail);
  const wing = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mat);
  wing.scale.set(0.35, 0.8, 1.2);
  wing.position.set(0.13, 0.17, 0);
  g.add(wing);
  const wing2 = wing.clone();
  wing2.position.x = -0.13;
  g.add(wing2);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), new THREE.MeshStandardMaterial({ color: '#111111' }));
  eye.position.set(0.05, 0.33, 0.3);
  g.add(eye);
  const eye2 = eye.clone();
  eye2.position.x = -0.05;
  g.add(eye2);
  return g;
}

function makeOwl() {
  const g = new THREE.Group();
  const brown = new THREE.MeshStandardMaterial({ color: '#8d6e63', roughness: 0.95 });
  const tan = new THREE.MeshStandardMaterial({ color: '#d7ccc8', roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), brown);
  body.scale.set(1, 1.2, 0.95);
  body.position.y = 0.26;
  body.castShadow = true;
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), tan);
  belly.scale.set(0.9, 1.1, 0.6);
  belly.position.set(0, 0.22, 0.16);
  g.add(belly);
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.2 });
  const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), eyeWhiteMat);
  eye1.position.set(0.09, 0.44, 0.18);
  g.add(eye1);
  const eye2 = eye1.clone();
  eye2.position.x = -0.09;
  g.add(eye2);
  const p1 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), pupilMat);
  p1.position.set(0.09, 0.44, 0.26);
  g.add(p1);
  const p2 = p1.clone();
  p2.position.x = -0.09;
  g.add(p2);
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.04, 0.1, 6),
    new THREE.MeshStandardMaterial({ color: '#ef9a1a' })
  );
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.36, 0.25);
  g.add(beak);
  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), brown);
  tuft.position.set(0.11, 0.62, 0.12);
  tuft.rotation.z = -0.5;
  g.add(tuft);
  const tuft2 = tuft.clone();
  tuft2.position.x = -0.11;
  tuft2.rotation.z = 0.5;
  g.add(tuft2);
  const wing = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), brown);
  wing.scale.set(0.4, 1, 0.9);
  wing.position.set(0.17, 0.25, 0);
  g.add(wing);
  const wing2 = wing.clone();
  wing2.position.x = -0.17;
  g.add(wing2);
  return g;
}

function addAnimal(tree, kind, color) {
  const s = Math.max(1.0, tree.scale);
  const y = tree.kind === 'pine' ? 2.1 * tree.scale : 1.75 * tree.scale;
  const branch = attachBranch(tree, y, 1.6 * s);
  let a;
  if (kind === 'squirrel') a = makeSquirrel();
  else if (kind === 'owl') a = makeOwl();
  else a = makeBird(color);
  a.rotation.y = Math.PI / 2;
  a.position.set(1.3 * s, 0.12, 0);
  a.scale.setScalar(0.95 * s);
  branch.add(a);
}

const pickAnimalTree = (f) => trees[Math.min(trees.length - 1, Math.floor(trees.length * f))];
addAnimal(pickAnimalTree(0.15), 'squirrel');
addAnimal(pickAnimalTree(0.35), 'squirrel');
addAnimal(pickAnimalTree(0.55), 'bird', '#d84343');
addAnimal(pickAnimalTree(0.7), 'owl');
addAnimal(pickAnimalTree(0.9), 'bird', '#3f8fd2');

/* ---------------- 向日葵（弯曲茎 + 双层花瓣 + 种子盘，单网格顶点色） ---------------- */
function makeSunflowerHeadGeometry() {
  const pos = [], col = [], idx = [];
  function addRing(count, len, w, r0, y, baseColor) {
    const cBase = new THREE.Color(baseColor);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const color = cBase.clone().offsetHSL(0, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.06);
      const corners = [
        [r0, -w / 2],
        [r0 + len, -w * 0.55],
        [r0 + len, w * 0.55],
        [r0, w / 2],
      ];
      const base = pos.length / 3;
      for (const [px, py] of corners) {
        pos.push(px * ca - py * sa, y, px * sa + py * ca);
        col.push(color.r, color.g, color.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  addRing(18, 0.66, 0.2, 0.17, 0.02, '#e9a820');
  addRing(14, 0.42, 0.16, 0.15, 0.045, '#f4bc37');
  // 种子盘
  const cBase = new THREE.Color('#5a3817');
  const centerIdx = pos.length / 3;
  pos.push(0, 0.06, 0);
  col.push(cBase.r, cBase.g, cBase.b);
  const rim = 22;
  for (let i = 0; i < rim; i++) {
    const a = (i / rim) * Math.PI * 2;
    const color = cBase.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
    pos.push(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3);
    col.push(color.r, color.g, color.b);
  }
  for (let i = 0; i < rim; i++) {
    idx.push(centerIdx, centerIdx + 1 + i, centerIdx + 1 + ((i + 1) % rim));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const sunflowerHeadGeo = makeSunflowerHeadGeometry();
const sunflowerHeadMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
const stemMat = new THREE.MeshStandardMaterial({ color: '#4e8c3a', roughness: 0.9 });
const sfLeafMat = new THREE.MeshStandardMaterial({ color: '#4c7c33', roughness: 0.9, side: THREE.DoubleSide });

const flowers = [];

function makeSunflower() {
  const g = new THREE.Group();
  const s = rand(0.8, 1.3);
  const bend = rand(0.12, 0.3);
  const dirA = rand(0, Math.PI * 2);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(Math.cos(dirA) * bend, 0.8, Math.sin(dirA) * bend),
    new THREE.Vector3(Math.cos(dirA) * bend * 0.7, 1.6, Math.sin(dirA) * bend * 0.7),
    new THREE.Vector3(0, 2.3, 0),
  ]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.045, 6), stemMat);
  stem.castShadow = true;
  g.add(stem);
  for (let k = 0; k < 2; k++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.24), sfLeafMat);
    const t = 0.42 + k * 0.3;
    const pt = curve.getPointAt(t);
    leaf.position.copy(pt);
    leaf.position.x += (k === 0 ? 1 : -1) * 0.26;
    leaf.rotation.z = (k === 0 ? -0.9 : 0.85);
    leaf.rotation.y = (k === 0 ? 0.5 : -0.6);
    leaf.castShadow = true;
    g.add(leaf);
  }
  const head = new THREE.Group();
  const petals = new THREE.Mesh(sunflowerHeadGeo, sunflowerHeadMat);
  petals.castShadow = true;
  head.add(petals);
  head.position.y = 2.3;
  g.add(head);
  g.scale.setScalar(s);
  return { group: g, head };
}

const flowerPositions = [];
let placed = 0, guard = 0;
while (placed < Q.flowers && guard < 600) {
  guard++;
  const a = rand(0, Math.PI * 2);
  const r = Math.sqrt(Math.random()) * 6.1;
  const p = new THREE.Vector3(Math.cos(a) * r, 0, 14 + Math.sin(a) * r);
  if (flowerPositions.some((q) => q.distanceTo(p) < 1.0)) continue;
  flowerPositions.push(p);
  placed++;
}
flowerPositions.forEach((p) => {
  const f = makeSunflower();
  f.group.position.copy(p);
  f.group.rotation.y = rand(0, Math.PI * 2);
  scene.add(f.group);
  flowers.push(f);
});

/* ---------------- 草地 / 野花 / 岩石 ---------------- */
function makeBladeGeometry(len, width, bend, seg) {
  const g = new THREE.PlaneGeometry(width, len, 1, seg);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cBottom = new THREE.Color('#4c6b2e');
  const cTop = new THREE.Color('#8f9f4a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const f = y / len;
    pos.setX(i, x * (1 - 0.55 * f) + bend * f * f);
    c.copy(cBottom).lerp(cTop, f);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.translate(0, len / 2, 0);
  g.computeVertexNormals();
  return g;
}

function scatterGrass(geo, mat, count, area) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0, tries = 0;
    do {
      x = rand(-area, area);
      z = rand(-area, area);
      tries++;
    } while (tries < 40 && Math.abs(x) < 4.8 && Math.abs(z) < 4.8);
    dummy.position.set(x, groundHeight(x, z), z);
    dummy.rotation.set(0, rand(0, Math.PI * 2), rand(-0.12, 0.12));
    dummy.scale.set(rand(0.85, 1.3), rand(0.7, 1.45), 1);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    c.setHSL(rand(0.22, 0.3), rand(0.35, 0.55), rand(0.32, 0.45));
    m.setColorAt(i, c);
  }
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

const grassMat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1, side: THREE.DoubleSide });
scene.add(scatterGrass(makeBladeGeometry(0.55, 0.14, 0.18, 3), grassMat, Q.grass[0], 44));
scene.add(scatterGrass(makeBladeGeometry(0.9, 0.2, 0.32, 4), grassMat, Q.grass[1], 44));
scene.add(scatterGrass(makeBladeGeometry(1.3, 0.24, 0.45, 4), grassMat, Q.grass[2], 44));

// 野花
const wildflowerGeo = new THREE.PlaneGeometry(0.3, 0.3);
const wildflowerMat = new THREE.MeshStandardMaterial({
  map: flowerTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9,
});
const wildflowers = new THREE.InstancedMesh(wildflowerGeo, wildflowerMat, Q.wild);
{
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  const tints = ['#ffffff', '#ffd9e8', '#cfe4ff', '#fff3c4'];
  for (let i = 0; i < Q.wild; i++) {
    let x = 0, z = 0, tries = 0;
    do {
      x = rand(-40, 40);
      z = rand(-40, 40);
      tries++;
    } while (tries < 30 && Math.abs(x) < 5 && Math.abs(z) < 5);
    dummy.position.set(x, groundHeight(x, z) + 0.12, z);
    dummy.rotation.set(rand(-0.25, 0.25), rand(0, Math.PI * 2), rand(-0.25, 0.25));
    const s = rand(0.6, 1.2);
    dummy.scale.set(s, s, 1);
    dummy.updateMatrix();
    wildflowers.setMatrixAt(i, dummy.matrix);
    c.set(pick(tints));
    wildflowers.setColorAt(i, c);
  }
  wildflowers.instanceMatrix.needsUpdate = true;
  if (wildflowers.instanceColor) wildflowers.instanceColor.needsUpdate = true;
}
scene.add(wildflowers);

// 岩石
const rockGeo = new THREE.IcosahedronGeometry(1, 1);
const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true });
const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 24);
{
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  for (let i = 0; i < 24; i++) {
    let x = 0, z = 0;
    if (i < 12) {
      const a = rand(0, Math.PI * 2);
      const r = rand(8, 13);
      x = Math.cos(a) * r;
      z = 14 + Math.sin(a) * r;
    } else {
      x = rand(-40, 40);
      z = rand(-40, 40);
    }
    const s = rand(0.35, 2.1);
    dummy.position.set(x, groundHeight(x, z) + s * 0.15, z);
    dummy.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
    dummy.scale.set(s, s * rand(0.5, 0.8), s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    const v = rand(0.48, 0.62);
    c.setRGB(v, v, v + 0.02);
    rocks.setColorAt(i, c);
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
}
rocks.castShadow = true;
rocks.receiveShadow = true;
scene.add(rocks);

/* ---------------- 篱笆 ---------------- */
const fenceMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.9 });
const fenceR = 7.9;
const postAngles = [];
const postTotal = 26;
for (let i = 0; i < postTotal; i++) {
  const a = (i / postTotal) * Math.PI * 2;
  if (angDist(a, Math.PI * 1.5) > 0.55) postAngles.push(a);
}
const posts = new THREE.InstancedMesh(
  new THREE.CylinderGeometry(0.09, 0.11, 0.95, 7),
  fenceMat,
  postAngles.length
);
{
  const dummy = new THREE.Object3D();
  postAngles.forEach((a, i) => {
    dummy.position.set(PATCH_CENTER.x + Math.cos(a) * fenceR, 0.475, PATCH_CENTER.z + Math.sin(a) * fenceR);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  });
}
posts.castShadow = true;
scene.add(posts);

const railGeo = new THREE.TorusGeometry(fenceR, 0.055, 8, 48, Math.PI * 2 - 1.1);
const rail1 = new THREE.Mesh(railGeo, fenceMat);
rail1.rotation.x = Math.PI / 2;
rail1.rotation.y = Math.PI / 2;
rail1.position.set(PATCH_CENTER.x, 0.42, PATCH_CENTER.z);
rail1.castShadow = true;
scene.add(rail1);
const rail2 = rail1.clone();
rail2.position.y = 0.8;
scene.add(rail2);

/* ---------------- 蝴蝶 ---------------- */
function makeButterfly(hue) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#3d2c1e', roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bodyMat);
  body.scale.set(1, 1, 1.9);
  body.position.y = 0.12;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), bodyMat);
  head.position.set(0, 0.14, 0.13);
  g.add(head);
  const wingMat = new THREE.MeshStandardMaterial({
    map: makeWingTexture(hue), transparent: true, alphaTest: 0.15,
    side: THREE.DoubleSide, roughness: 0.75, emissive: '#ffffff', emissiveIntensity: 0.08,
  });
  const wingL = new THREE.Group();
  const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), wingMat);
  wl.position.x = -0.16;
  wingL.add(wl);
  wingL.position.y = 0.12;
  g.add(wingL);
  const wingR = new THREE.Group();
  const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), wingMat);
  wr.position.x = 0.16;
  wingR.add(wr);
  wingR.position.y = 0.12;
  g.add(wingR);
  return { g, wingL, wingR };
}

const butterflies = [];
for (let i = 0; i < 3; i++) {
  const b = makeButterfly(['#ff9800', '#3f8fd2', '#e0b0ff'][i % 3]);
  b.cx = rand(-5.5, 5.5);
  b.cy = rand(1.6, 2.6);
  b.cz = 14 + rand(-5.5, 5.5);
  b.w1 = rand(0.5, 0.9);
  b.w2 = rand(0.8, 1.3);
  b.w3 = rand(0.4, 0.7);
  b.w4 = rand(1.4, 2.2);
  b.p1 = rand(0, Math.PI * 2);
  b.p2 = rand(0, Math.PI * 2);
  b.p3 = rand(0, Math.PI * 2);
  b.p4 = rand(0, Math.PI * 2);
  b.phase = rand(0, 10);
  scene.add(b.g);
  butterflies.push(b);
}

function butterflyPos(b, tt) {
  return TMP.set(
    b.cx + Math.sin(tt * b.w1 + b.p1) * 3.2 + Math.sin(tt * b.w4 + b.p4) * 1.2,
    b.cy + Math.sin(tt * b.w2 + b.p2) * 0.9,
    b.cz + Math.cos(tt * b.w3 + b.p3) * 3.2
  );
}

/* ---------------- 蜜蜂 ---------------- */
function makeBee() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12),
    new THREE.MeshStandardMaterial({ map: beeStripeTex, roughness: 0.8 })
  );
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2320', roughness: 0.7 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), dark);
  head.position.x = 0.2;
  g.add(head);
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), dark);
  tail.position.x = -0.16;
  g.add(tail);
  const wingMat = new THREE.MeshStandardMaterial({
    color: '#eef6ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.4,
  });
  const wingL = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.13), wingMat);
  wingL.position.set(-0.02, 0.09, 0);
  g.add(wingL);
  const wingR = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.13), wingMat);
  wingR.position.set(-0.02, 0.09, 0);
  g.add(wingR);
  g.scale.setScalar(0.8);
  return { g, wingL, wingR };
}

const bees = [];
for (let i = 0; i < 4; i++) {
  const b = makeBee();
  b.target = flowers[Math.floor(Math.random() * flowers.length)];
  b.state = 'fly';
  b.hoverT = 0;
  b.angle = rand(0, Math.PI * 2);
  b.phase = rand(0, 10);
  b.speed = rand(1.0, 1.5);
  b.g.position.set(rand(-5, 5), rand(1.5, 3), 12 + rand(-4, 4));
  scene.add(b.g);
  bees.push(b);
}

/* ---------------- 云 / 炊烟 / 尘埃 / 雨 / 萤火虫 ---------------- */
const cloudMat = new THREE.SpriteMaterial({
  map: softTex, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, fog: true,
});
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);
const clouds = [];
for (let cIdx = 0; cIdx < 6; cIdx++) {
  const cx = rand(-110, 110);
  const cy = rand(15, 24);
  const cz = rand(-110, 110);
  const cluster = new THREE.Group();
  cluster.position.set(cx, cy, cz);
  const n = 8 + Math.floor(Math.random() * 4);
  for (let j = 0; j < n; j++) {
    const sp = new THREE.Sprite(cloudMat);
    const sx = rand(5, 10);
    sp.scale.set(sx, sx * rand(0.4, 0.55), 1);
    sp.position.set(rand(-14, 14), rand(-1.2, 1.2), rand(-3, 3));
    cluster.add(sp);
  }
  cloudGroup.add(cluster);
  clouds.push({ g: cluster, x: cx, speed: rand(0.3, 0.9) });
}

const smokeMat = new THREE.SpriteMaterial({
  map: softTex, color: '#c9cdd1', transparent: true, opacity: 0, depthWrite: false, fog: true,
});
const smokeSprites = [];
for (let i = 0; i < 3; i++) {
  const sp = new THREE.Sprite(smokeMat);
  sp.scale.set(1.6, 1.6, 1);
  sp.position.set(1.3, 5.9, -0.9);
  scene.add(sp);
  smokeSprites.push({ sp, phase: i / 3 });
}

// 阳光中的浮尘
const dustCount = Q.dust;
const dustGeo = new THREE.BufferGeometry();
const dustBase = [];
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const b = { x: rand(-14, 14), y: rand(0.6, 5.5), z: rand(4, 24), ph: rand(0, 10) };
  dustBase.push(b);
  dustPos[i * 3] = b.x;
  dustPos[i * 3 + 1] = b.y;
  dustPos[i * 3 + 2] = b.z;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  color: '#ffe9b8', size: 0.08, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const dust = new THREE.Points(dustGeo, dustMat);
dust.frustumCulled = false;
scene.add(dust);

const rainCount = Q.rain;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i++) {
  rainPos[i * 3] = rand(-40, 40);
  rainPos[i * 3 + 1] = rand(0, 24);
  rainPos[i * 3 + 2] = rand(-40, 40);
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.PointsMaterial({ color: '#b8cfe8', size: 0.1, transparent: true, opacity: 0, depthWrite: false });
const rain = new THREE.Points(rainGeo, rainMat);
rain.frustumCulled = false;
scene.add(rain);

const fireflyCount = Q.fireflies;
const ffBase = [];
const ffPos = new Float32Array(fireflyCount * 3);
for (let i = 0; i < fireflyCount; i++) {
  const b = { x: rand(-10, 10), y: rand(0.4, 1.8), z: rand(8, 24), ph: rand(0, 10) };
  ffBase.push(b);
  ffPos[i * 3] = b.x;
  ffPos[i * 3 + 1] = b.y;
  ffPos[i * 3 + 2] = b.z;
}
const ffGeo = new THREE.BufferGeometry();
ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
const ffMat = new THREE.PointsMaterial({
  color: '#eaffa0', size: 0.18, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const fireflies = new THREE.Points(ffGeo, ffMat);
fireflies.frustumCulled = false;
scene.add(fireflies);

/* ---------------- 天气系统 ---------------- */
const WEATHERS = {
  sunny: {
    skyTop: '#2f6fc2', skyHorizon: '#cfe3f2', skyBottom: '#b3d9f2',
    sunColor: '#fff1c4', sunIntensity: 1.15, sunExponent: 620, moonIntensity: 0, stars: 0,
    fog: '#b3d9f2', fogNear: 90, fogFar: 460,
    light: '#fff2dd', lightIntensity: 3.3, lightPos: [60, 50, 25],
    hemiSky: '#bcd8f0', hemiGround: '#8a9a66', hemiIntensity: 0.55, ambient: 0.3,
    cloud: '#ffffff', bloom: 0.22, dust: 0.45, rain: 0, fire: 0, glow: 0, exposure: 1.05, wet: 0,
    lift: [0.004, 0.006, 0.008], gamma: [1.0, 1.0, 1.0], gain: [1.0, 1.0, 1.0],
  },
  foggy: {
    skyTop: '#a9b6bd', skyHorizon: '#cfd7da', skyBottom: '#d3dadd',
    sunColor: '#e8ecf0', sunIntensity: 0.12, sunExponent: 800, moonIntensity: 0, stars: 0,
    fog: '#d3dadd', fogNear: 10, fogFar: 70,
    light: '#e6ecee', lightIntensity: 0.75, lightPos: [60, 50, 25],
    hemiSky: '#d8dee0', hemiGround: '#8f9878', hemiIntensity: 0.45, ambient: 0.62,
    cloud: '#cfd6d9', bloom: 0.08, dust: 0.08, rain: 0, fire: 0, glow: 0.05, exposure: 1.0, wet: 0.15,
    lift: [0.02, 0.02, 0.018], gamma: [1.0, 1.0, 1.0], gain: [0.96, 0.96, 0.96],
  },
  sunset: {
    skyTop: '#33457e', skyHorizon: '#f8a966', skyBottom: '#e8b98a',
    sunColor: '#ffb45e', sunIntensity: 1.7, sunExponent: 260, moonIntensity: 0, stars: 0,
    fog: '#e8b98a', fogNear: 45, fogFar: 240,
    light: '#ff9a4d', lightIntensity: 1.7, lightPos: [50, 14, -30],
    hemiSky: '#f7c98f', hemiGround: '#6f6350', hemiIntensity: 0.5, ambient: 0.42,
    cloud: '#f4c9a2', bloom: 0.45, dust: 0.3, rain: 0, fire: 0, glow: 0.55, exposure: 1.06, wet: 0,
    lift: [0.012, 0.0, -0.008], gamma: [0.985, 0.99, 1.0], gain: [1.04, 0.96, 0.86],
  },
  night: {
    skyTop: '#040916', skyHorizon: '#131f35', skyBottom: '#0b1a2e',
    sunColor: '#fff1c4', sunIntensity: 0, sunExponent: 620, moonIntensity: 0.85, stars: 0.9,
    fog: '#0b1a2e', fogNear: 60, fogFar: 260,
    light: '#8fa8e8', lightIntensity: 0.4, lightPos: [-55, 35, 45],
    hemiSky: '#27344d', hemiGround: '#1c2319', hemiIntensity: 0.28, ambient: 0.42,
    cloud: '#202c3f', bloom: 0.4, dust: 0, rain: 0, fire: 0.9, glow: 1, exposure: 1.0, wet: 0,
    lift: [-0.01, -0.006, 0.012], gamma: [1.04, 1.04, 1.04], gain: [0.9, 0.94, 1.18],
  },
  rain: {
    skyTop: '#5f6b71', skyHorizon: '#7e898e', skyBottom: '#8d989d',
    sunColor: '#dfe6e8', sunIntensity: 0, sunExponent: 620, moonIntensity: 0, stars: 0,
    fog: '#8d989d', fogNear: 14, fogFar: 80,
    light: '#d5dde0', lightIntensity: 0.6, lightPos: [30, 25, -20],
    hemiSky: '#b9c2c6', hemiGround: '#66704f', hemiIntensity: 0.4, ambient: 0.62,
    cloud: '#98a2a7', bloom: 0.06, dust: 0, rain: 0.85, fire: 0, glow: 0.2, exposure: 0.98, wet: 1,
    lift: [0.008, 0.01, 0.016], gamma: [1.0, 1.0, 1.0], gain: [0.92, 0.94, 1.02],
  },
};

function makeTarget(w) {
  return {
    skyTop: new THREE.Color(w.skyTop),
    skyHorizon: new THREE.Color(w.skyHorizon),
    skyBottom: new THREE.Color(w.skyBottom),
    sunColor: new THREE.Color(w.sunColor),
    sunIntensity: w.sunIntensity,
    sunExponent: w.sunExponent,
    moonIntensity: w.moonIntensity,
    stars: w.stars,
    fog: new THREE.Color(w.fog),
    fogNear: w.fogNear,
    fogFar: w.fogFar,
    light: new THREE.Color(w.light),
    lightIntensity: w.lightIntensity,
    lightPos: new THREE.Vector3(...w.lightPos),
    hemiSky: new THREE.Color(w.hemiSky),
    hemiGround: new THREE.Color(w.hemiGround),
    hemiIntensity: w.hemiIntensity,
    ambient: w.ambient,
    cloud: new THREE.Color(w.cloud),
    bloom: w.bloom,
    dust: w.dust,
    rain: w.rain,
    fire: w.fire,
    glow: w.glow,
    exposure: w.exposure,
    wet: w.wet,
    lift: new THREE.Vector3(...w.lift),
    gamma: new THREE.Vector3(...w.gamma),
    gain: new THREE.Vector3(...w.gain),
  };
}

const cur = makeTarget(WEATHERS.sunny);
let target = makeTarget(WEATHERS.sunny);
scene.fog = new THREE.Fog(cur.fog, cur.fogNear, cur.fogFar);

function setWeather(name) {
  target = makeTarget(WEATHERS[name]);
  document.querySelectorAll('#ui .wbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.w === name);
  });
}

const lerpN = (a, b, f) => a + (b - a) * f;

function applyWeather(dt, passes) {
  const f = 1 - Math.exp(-dt * 2.5);
  cur.skyTop.lerp(target.skyTop, f);
  cur.skyHorizon.lerp(target.skyHorizon, f);
  cur.skyBottom.lerp(target.skyBottom, f);
  cur.sunColor.lerp(target.sunColor, f);
  cur.sunIntensity = lerpN(cur.sunIntensity, target.sunIntensity, f);
  cur.sunExponent = lerpN(cur.sunExponent, target.sunExponent, f);
  cur.moonIntensity = lerpN(cur.moonIntensity, target.moonIntensity, f);
  cur.stars = lerpN(cur.stars, target.stars, f);
  cur.fog.lerp(target.fog, f);
  cur.fogNear = lerpN(cur.fogNear, target.fogNear, f);
  cur.fogFar = lerpN(cur.fogFar, target.fogFar, f);
  cur.light.lerp(target.light, f);
  cur.lightIntensity = lerpN(cur.lightIntensity, target.lightIntensity, f);
  cur.lightPos.lerp(target.lightPos, f);
  cur.hemiSky.lerp(target.hemiSky, f);
  cur.hemiGround.lerp(target.hemiGround, f);
  cur.hemiIntensity = lerpN(cur.hemiIntensity, target.hemiIntensity, f);
  cur.ambient = lerpN(cur.ambient, target.ambient, f);
  cur.cloud.lerp(target.cloud, f);
  cur.bloom = lerpN(cur.bloom, target.bloom, f);
  cur.dust = lerpN(cur.dust, target.dust, f);
  cur.rain = lerpN(cur.rain, target.rain, f);
  cur.fire = lerpN(cur.fire, target.fire, f);
  cur.glow = lerpN(cur.glow, target.glow, f);
  cur.exposure = lerpN(cur.exposure, target.exposure, f);
  cur.wet = lerpN(cur.wet, target.wet, f);
  cur.lift.lerp(target.lift, f);
  cur.gamma.lerp(target.gamma, f);
  cur.gain.lerp(target.gain, f);

  skyUniforms.topColor.value.copy(cur.skyTop);
  skyUniforms.horizonColor.value.copy(cur.skyHorizon);
  skyUniforms.bottomColor.value.copy(cur.skyBottom);
  skyUniforms.sunColor.value.copy(cur.sunColor);
  skyUniforms.sunIntensity.value = cur.sunIntensity;
  skyUniforms.sunExponent.value = cur.sunExponent;
  skyUniforms.moonIntensity.value = cur.moonIntensity;
  skyUniforms.starIntensity.value = cur.stars;
  skyUniforms.sunDir.value.copy(cur.lightPos).normalize();

  scene.fog.color.copy(cur.fog);
  scene.fog.near = cur.fogNear;
  scene.fog.far = cur.fogFar;

  sunLight.color.copy(cur.light);
  sunLight.intensity = cur.lightIntensity;
  sunLight.position.copy(cur.lightPos);
  hemi.color.copy(cur.hemiSky);
  hemi.groundColor.copy(cur.hemiGround);
  hemi.intensity = cur.hemiIntensity;
  ambient.intensity = cur.ambient;

  cloudMat.color.copy(cur.cloud);
  windowMat.emissiveIntensity = 0.05 + cur.glow * 0.95;
  lanternCoreMat.emissiveIntensity = cur.glow * 1.6;
  porchLight.intensity = cur.glow * 10;
  interiorLight.intensity = cur.glow * 6;
  smokeMat.opacity = cur.glow > 0.05 ? cur.glow * 0.35 : 0;

  dustMat.opacity = cur.dust;
  rainMat.opacity = cur.rain;
  rain.visible = cur.rain > 0.02;
  ffMat.opacity = cur.fire;

  // 潮湿地面（雨天变暗偏冷）
  const w = cur.wet;
  groundMat.color.setRGB(1 - 0.3 * w, 1 - 0.24 * w, 1 - 0.18 * w);

  if (passes) {
    passes.bloom.strength = cur.bloom;
    passes.grade.uniforms.lift.value.copy(cur.lift);
    passes.grade.uniforms.gamma.value.copy(cur.gamma);
    passes.grade.uniforms.gain.value.copy(cur.gain);
  }
  renderer.toneMappingExposure = cur.exposure;
}

/* ---------------- 后期处理链 ---------------- */
const groundMat = terrain.material;
const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 4;
ssaoPass.minDistance = 0.003;
ssaoPass.maxDistance = 0.15;
ssaoPass.output = SSAOPass.OUTPUT.Default;
if (!NO_SSAO && !LOW_QUALITY && !IS_MOBILE) composer.addPass(ssaoPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.6, 1.0);
composer.addPass(bloomPass);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    lift: { value: new THREE.Vector3(0.004, 0.006, 0.008) },
    gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 lift;
    uniform vec3 gamma;
    uniform vec3 gain;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 v = c.rgb * gain + lift;
      v = pow(max(v, vec3(0.0)), vec3(1.0) / gamma);
      gl_FragColor = vec4(v, c.a);
    }
  `,
};
const gradePass = new ShaderPass(GradeShader);
composer.addPass(gradePass);

const vignettePass = new ShaderPass(VignetteShader);
vignettePass.uniforms.offset.value = 0.92;
vignettePass.uniforms.darkness.value = 1.28;
composer.addPass(vignettePass);

const filmPass = new ShaderPass(FilmShader);
filmPass.uniforms.intensity.value = 0.06;
composer.addPass(filmPass);

composer.addPass(new OutputPass());

const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);

const passes = { bloom: bloomPass, grade: gradePass };

/* ---------------- UI 事件 ---------------- */
document.querySelectorAll('#ui .wbtn').forEach((btn) => {
  btn.addEventListener('click', () => setWeather(btn.dataset.w));
});
window.addEventListener('keydown', (e) => {
  const order = ['sunny', 'foggy', 'sunset', 'night', 'rain'];
  const n = Number(e.key);
  if (n >= 1 && n <= 5) setWeather(order[n - 1]);
});

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  ssaoPass.setSize(w, h);
  bloomPass.resolution.set(w, h);
  const bs = renderer.getDrawingBufferSize(new THREE.Vector2());
  fxaaPass.uniforms.resolution.value.set(1 / bs.x, 1 / bs.y);
}
window.addEventListener('resize', onResize);
onResize();

/* ---------------- 动画循环 ---------------- */
function orientFlowers() {
  for (const f of flowers) {
    TMP3.set(0, 2.3 * f.group.scale.y, 0).applyMatrix4(f.group.matrixWorld);
    TMP.copy(sunLight.position).sub(TMP3).normalize();
    if (TMP.y < 0.05) TMP.y = 0.05;
    TMP.normalize();
    f.head.quaternion.setFromUnitVectors(UP, TMP);
  }
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  skyUniforms.uTime.value = t;

  for (const b of butterflies) {
    const p0 = butterflyPos(b, t).clone();
    const p1 = butterflyPos(b, t + 0.07).clone();
    b.g.position.copy(p0);
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    b.g.rotation.y = Math.atan2(dx, dz);
    b.g.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.5;
    const flap = 0.35 + Math.abs(Math.sin(t * 8 + b.phase)) * 1.1;
    b.wingL.rotation.z = flap;
    b.wingR.rotation.z = -flap;
  }

  for (const bee of bees) {
    TMP2.copy(bee.target.group.position);
    TMP2.y += 2.45;
    const p = bee.g.position;
    if (bee.state === 'fly') {
      TMP.copy(TMP2).sub(p);
      const d = TMP.length();
      if (d < 0.45) {
        bee.state = 'hover';
        bee.hoverT = rand(1.5, 3.5);
      } else {
        TMP.normalize();
        p.addScaledVector(TMP, bee.speed * dt);
        bee.g.rotation.y = Math.atan2(-TMP.z, TMP.x);
        p.y += Math.sin(t * 8 + bee.phase) * 0.02;
      }
    } else {
      bee.hoverT -= dt;
      bee.angle += dt * 2.4;
      const hx = TMP2.x + Math.cos(bee.angle) * 0.32;
      const hz = TMP2.z + Math.sin(bee.angle) * 0.32;
      p.x += (hx - p.x) * Math.min(1, dt * 6);
      p.z += (hz - p.z) * Math.min(1, dt * 6);
      p.y += (TMP2.y + Math.sin(t * 6 + bee.phase) * 0.05 - p.y) * Math.min(1, dt * 6);
      if (bee.hoverT <= 0) {
        bee.state = 'fly';
        bee.target = flowers[Math.floor(Math.random() * flowers.length)];
      }
    }
    const flap = Math.sin(t * 45 + bee.phase * 3);
    bee.wingL.rotation.x = 0.45 + flap * 0.3;
    bee.wingR.rotation.x = 0.45 + flap * 0.3;
  }

  for (const c of clouds) {
    c.x += c.speed * dt;
    if (c.x > 120) c.x = -120;
    c.g.position.x = c.x;
  }

  if (smokeMat.opacity > 0.01) {
    smokeSprites.forEach(({ sp, phase }) => {
      const k = ((t * 0.45 + phase) % 1);
      sp.position.set(1.3 + k * 2.2 + Math.sin(t * 0.7 + phase * 9) * 0.15, 5.9 + k * 3.2, -0.9 + Math.cos(t * 0.6 + phase * 7) * 0.12);
      sp.scale.setScalar(0.9 + k * 2.6);
    });
  }

  if (dustMat.opacity > 0.02) {
    const arr = dustGeo.attributes.position.array;
    for (let i = 0; i < dustCount; i++) {
      const b = dustBase[i];
      arr[i * 3] = b.x + Math.sin(t * 0.4 + b.ph) * 0.7 + t * 0.12;
      arr[i * 3 + 1] = b.y + Math.sin(t * 0.6 + b.ph * 1.7) * 0.35;
      arr[i * 3 + 2] = b.z + Math.cos(t * 0.35 + b.ph * 0.8) * 0.7;
      if (arr[i * 3] > 15) arr[i * 3] = -15;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  if (rain.visible) {
    const arr = rainGeo.attributes.position.array;
    const gust = Math.sin(t * 0.4) * 0.8;
    for (let i = 0; i < rainCount; i++) {
      arr[i * 3 + 1] -= 16 * dt;
      arr[i * 3] += (1.6 + gust) * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3] = rand(-40, 40);
        arr[i * 3 + 1] = rand(18, 24);
        arr[i * 3 + 2] = rand(-40, 40);
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  if (ffMat.opacity > 0.02) {
    const arr = ffGeo.attributes.position.array;
    for (let i = 0; i < fireflyCount; i++) {
      const b = ffBase[i];
      arr[i * 3] = b.x + Math.sin(t * 0.7 + b.ph * 1.3) * 0.5;
      arr[i * 3 + 1] = b.y + Math.sin(t * 1.6 + b.ph) * 0.35;
      arr[i * 3 + 2] = b.z + Math.cos(t * 0.6 + b.ph * 0.9) * 0.5;
    }
    ffGeo.attributes.position.needsUpdate = true;
  }

  orientFlowers();
  applyWeather(dt, passes);
  controls.update();
  composer.render();
}

animate();
requestAnimationFrame(() => document.body.classList.add('ready'));
