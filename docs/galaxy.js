// Galaxy background — vanilla port of React Bits <Galaxy /> (MIT), rendered with ogl.
// Shader is verbatim from reactbits.dev; only the mounting code is ours.
import { Renderer, Program, Mesh, Color, Triangle } from "./vendor/ogl.mjs";

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform bool uTransparent;
uniform float uLightMode;

varying vec2 vUv;

#define NUM_LAYER 4.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float tri(float x) {
  return abs(fract(x) * 2.0 - 1.0);
}

float tris(float x) {
  float t = fract(x);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
}

float trisn(float x) {
  float t = fract(x);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.05 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}

vec3 StarLayer(vec2 uv) {
  vec3 col = vec3(0.0);

  vec2 gv = fract(uv) - 0.5; 
  vec2 id = floor(uv);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + vec2(float(x), float(y));
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;

      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);
      
      float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * 3.14159) + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));

      vec2 pad = vec2(tris(seed * 34.0 + uTime * uSpeed / 10.0), tris(seed * 38.0 + uTime * uSpeed / 30.0)) - 0.5;

      float star = Star(gv - offset - pad, flareSize);
      vec3 color = base;

      float twinkle = trisn(uTime * uSpeed + seed * 6.2831) * 0.5 + 1.0;
      twinkle = mix(1.0, twinkle, uTwinkleIntensity);
      star *= twinkle;
      
      col += star * size * color;
    }
  }

  return col;
}

void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;

  vec2 mouseNorm = uMouse - vec2(0.5);
  
  if (uAutoCenterRepulsion > 0.0) {
    vec2 centerUV = vec2(0.0, 0.0);
    float centerDist = length(uv - centerUV);
    vec2 repulsion = normalize(uv - centerUV) * (uAutoCenterRepulsion / (centerDist + 0.1));
    uv += repulsion * 0.05;
  } else if (uMouseRepulsion) {
    vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
    float mouseDist = length(uv - mousePosUV);
    vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
    uv += repulsion * 0.05 * uMouseActiveFactor;
  } else {
    vec2 mouseOffset = mouseNorm * 0.1 * uMouseActiveFactor;
    uv += mouseOffset;
  }

  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
  uv = autoRot * uv;

  uv = mat2(uRotation.x, -uRotation.y, uRotation.y, uRotation.x) * uv;

  vec3 col = vec3(0.0);

  for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
    float depth = fract(i + uStarSpeed * uSpeed);
    float scale = mix(20.0 * uDensity, 0.5 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);
    col += StarLayer(uv * scale + i * 453.32) * fade;
  }

  if (uLightMode > 0.5) {
    float energy = max(max(col.r, col.g), col.b);
    float coverage = clamp(smoothstep(0.0, 0.42, energy) * 0.92, 0.0, 0.92);
    vec3 ink = clamp(col * 0.48, 0.0, 0.82);
    gl_FragColor = vec4(mix(vec3(1.0), ink, coverage), 1.0);
  } else if (uTransparent) {
    float alpha = length(col);
    alpha = smoothstep(0.0, 0.3, alpha);
    alpha = min(alpha, 1.0);
    gl_FragColor = vec4(col, alpha);
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
}
`;

const DEFAULTS = {
  focal: [0.5, 0.5],
  rotation: [1.0, 0.0],
  starSpeed: 0.5,
  density: 1,
  hueShift: 140,
  disableAnimation: false,
  speed: 1.0,
  mouseInteraction: true,
  glowIntensity: 0.3,
  saturation: 0.0,
  mouseRepulsion: true,
  repulsionStrength: 2,
  twinkleIntensity: 0.3,
  rotationSpeed: 0.1,
  autoCenterRepulsion: 0,
  transparent: true,
  lightMode: false,
  maxDpr: 1.5,
};

/**
 * Mount the galaxy on a container element. Returns a dispose() function,
 * or null if WebGL is unavailable (caller keeps its CSS fallback).
 */
export function mountGalaxy(ctn, options = {}) {
  const o = { ...DEFAULTS, ...options };

  // Preflight so ogl doesn't log its own console.error when GL is unavailable.
  const probe = document.createElement("canvas");
  if (!probe.getContext("webgl2") && !probe.getContext("webgl")) return null;

  let renderer;
  try {
    renderer = new Renderer({
      alpha: o.transparent,
      premultipliedAlpha: false,
      dpr: Math.min(window.devicePixelRatio || 1, o.maxDpr),
    });
  } catch {
    return null;
  }
  const gl = renderer.gl;
  if (!gl) return null;

  if (o.lightMode) {
    gl.clearColor(1, 1, 1, 1);
  } else if (o.transparent) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  } else {
    gl.clearColor(0, 0, 0, 1);
  }

  const target = { x: 0.5, y: 0.5, active: 0 };
  const smooth = { x: 0.5, y: 0.5, active: 0 };

  const program = new Program(gl, {
    vertex: vertexShader,
    fragment: fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: new Color(1, 1, 1) },
      uFocal: { value: new Float32Array(o.focal) },
      uRotation: { value: new Float32Array(o.rotation) },
      uStarSpeed: { value: o.starSpeed },
      uDensity: { value: o.density },
      uHueShift: { value: o.hueShift },
      uSpeed: { value: o.speed },
      uMouse: { value: new Float32Array([smooth.x, smooth.y]) },
      uGlowIntensity: { value: o.glowIntensity },
      uSaturation: { value: o.saturation },
      uMouseRepulsion: { value: o.mouseRepulsion },
      uTwinkleIntensity: { value: o.twinkleIntensity },
      uRotationSpeed: { value: o.rotationSpeed },
      uRepulsionStrength: { value: o.repulsionStrength },
      uMouseActiveFactor: { value: 0.0 },
      uAutoCenterRepulsion: { value: o.autoCenterRepulsion },
      uTransparent: { value: o.transparent },
      uLightMode: { value: o.lightMode ? 1 : 0 },
    },
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  function resize() {
    renderer.setSize(ctn.offsetWidth, ctn.offsetHeight);
    program.uniforms.uResolution.value = new Color(
      gl.canvas.width,
      gl.canvas.height,
      gl.canvas.width / gl.canvas.height
    );
  }
  window.addEventListener("resize", resize, false);
  resize();

  let raf = 0;
  let running = true;
  function update(t) {
    raf = requestAnimationFrame(update);
    if (!o.disableAnimation) {
      program.uniforms.uTime.value = t * 0.001;
      program.uniforms.uStarSpeed.value = (t * 0.001 * o.starSpeed) / 10.0;
    }
    const k = 0.05;
    smooth.x += (target.x - smooth.x) * k;
    smooth.y += (target.y - smooth.y) * k;
    smooth.active += (target.active - smooth.active) * k;
    program.uniforms.uMouse.value[0] = smooth.x;
    program.uniforms.uMouse.value[1] = smooth.y;
    program.uniforms.uMouseActiveFactor.value = smooth.active;
    renderer.render({ scene: mesh });
  }

  function start() {
    if (!running) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }
  function stop() {
    cancelAnimationFrame(raf);
  }
  function onVisibility() {
    document.hidden ? stop() : start();
  }
  document.addEventListener("visibilitychange", onVisibility);

  function onMove(e) {
    const r = ctn.getBoundingClientRect();
    target.x = (e.clientX - r.left) / r.width;
    target.y = 1.0 - (e.clientY - r.top) / r.height;
    target.active = 1.0;
  }
  function onLeave() {
    target.active = 0.0;
  }
  // Container is a fixed full-viewport layer behind the page, so listen on window.
  if (o.mouseInteraction) {
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
  }

  gl.canvas.className = "galaxy-canvas";
  ctn.appendChild(gl.canvas);
  if (o.disableAnimation) {
    // Render a single static frame.
    renderer.render({ scene: mesh });
  } else {
    start();
  }

  return function dispose() {
    running = false;
    stop();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
    if (o.mouseInteraction) {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    }
    if (gl.canvas.parentNode === ctn) ctn.removeChild(gl.canvas);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
