export const RIBBON_VERT = `
attribute vec3 aTangent;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vView;
varying vec2 vUv;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vNormal = normalize(normalMatrix * normal);
  vTangent = normalize(normalMatrix * aTangent);
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`

export const RIBBON_FRAG = `
precision highp float;

uniform sampler2D plate;
uniform vec2 resolution;
uniform float time;
uniform float seed;
uniform float alphaScale;

varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vView;
varying vec2 vUv;

vec3 saturate3(vec3 c, float amount) {
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  return clamp(mix(vec3(luma), c, amount), 0.0, 1.0);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(vView);
  if (!gl_FrontFacing) normal = -normal;
  float ndv = clamp(abs(dot(normal, viewDir)), 0.0, 1.0);
  vec2 screen = gl_FragCoord.xy / resolution;

  // The strip carries a slice of the scene smeared along its length, so it
  // reads as glass bending the room rather than a painted colour.
  vec2 along = vTangent.xy;
  along = dot(along, along) > 1e-6 ? normalize(along) : vec2(0.0, 1.0);
  vec2 across = vec2(-along.y, along.x);
  float u = vUv.x - 0.5;
  float drift = sin(vUv.y * 5.0 + seed * 1.7 + time * 0.25);
  vec2 bend = normal.xy * 0.085
    + along * (vUv.y - 0.5) * 0.22
    + across * u * -0.07
    + vec2(sin(seed * 3.1), cos(seed * 2.3)) * 0.09
    + along * drift * 0.035;
  // Cut facets: each stretch of the strip looks at a different patch of the
  // room, which gives the hard magenta-to-green breaks in the reel.
  float facet = floor(vUv.y * 9.0 + sin(vUv.x * 3.0 + seed) * 0.6 + seed * 7.0);
  bend += 0.045 * vec2(sin(facet * 12.9898 + seed), cos(facet * 78.233 - seed));
  vec2 uv = clamp(screen + bend, vec2(0.001), vec2(0.999));
  // A slight split only: the reel's strips show the scene in solid patches,
  // not rainbow fringes.
  vec2 split = normal.xy * 0.005 + across * 0.002;
  vec3 refr = vec3(
    texture2D(plate, uv + split).r,
    texture2D(plate, uv).g,
    texture2D(plate, uv - split).b
  );
  // Boost colour in the leaves and lilies but not in bright skin, which would
  // otherwise tip into orange.
  float bright = dot(refr, vec3(0.299, 0.587, 0.114));
  refr = saturate3(refr, mix(1.4, 0.85, smoothstep(0.45, 0.8, bright)));
  // A little extra contrast so dark leaves read deep and lilies stay vivid,
  // without turning skin behind the strip into orange paper.
  refr = clamp((refr - 0.5) * 1.2 + 0.5, 0.0, 1.0);

  // Faint thin-film shimmer, keyed to the viewing angle.
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (ndv * 1.4 + vUv.y * 0.6 + seed * 0.13 + vec3(0.0, 0.33, 0.67)));
  vec3 col = mix(refr, refr * (0.55 + film), 0.05);

  // Clear glass reads slightly paler than what is behind it.
  col = mix(col, vec3(1.0), 0.05 + 0.1 * bright);
  float side = abs(u) * 2.0;
  float lip = smoothstep(0.78, 0.92, side);
  col = mix(col, vec3(1.0), lip * 0.1);
  // A thin dark line right at the cut edge, as on the reel's strips.
  col *= 1.0 - 0.4 * smoothstep(0.92, 1.0, side);
  float rim = pow(1.0 - ndv, 3.0);
  col += rim * 0.12;
  vec3 light = normalize(vec3(-0.35, 0.7, 0.6));
  float glint = pow(max(dot(reflect(-viewDir, normal), light), 0.0), 48.0);
  col += glint * 0.65;

  float edge = smoothstep(0.0, 0.035, vUv.x) * smoothstep(1.0, 0.965, vUv.x);
  float tip = smoothstep(0.0, 0.015, vUv.y) * smoothstep(1.0, 0.985, vUv.y);
  float alpha = alphaScale * edge * tip;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(col, alpha);
}
`

export const PLATE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const PLATE_FRAG = `
precision highp float;
uniform sampler2D plate;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(plate, vUv).rgb, 1.0);
}
`

export const HAND_FRAG = `
precision highp float;
uniform sampler2D plate;
uniform sampler2D mask;
varying vec2 vUv;
void main() {
  float m = texture2D(mask, vUv).r;
  float a = smoothstep(0.28, 0.62, m);
  if (a < 0.04) discard;
  gl_FragColor = vec4(texture2D(plate, vUv).rgb, a);
}
`
