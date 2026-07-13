#version 300 es
precision highp float;

in vec3 vColor;
in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vUv;

out vec4 outColor;

uniform vec3 uAmbient;
uniform vec3 uCameraPos;
uniform float uSpecularStrength;
uniform float uShininess;
uniform float uUsePinGamma;
uniform float uPinAmbientBoost;
uniform float uPinShadingMix;
uniform float uPinBrightness;
uniform float uPinWrapDiffuse;
uniform float uPinRimBoost;
uniform float uPinSaturation;
uniform float uPinAOStrength;
uniform float uSceneExposure;
uniform float uUseTexture;
uniform float uOpacity;
uniform sampler2D uBaseColorTex;

uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uHemiStrength;

uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform vec3 uPlanetCenter;

uniform vec3 uDir0Dir;
uniform vec3 uDir0Color;
uniform vec3 uDir1Dir;
uniform vec3 uDir1Color;

uniform vec3 uPointPos;
uniform vec3 uPointColor;
uniform float uPointLinear;
uniform float uPointQuadratic;
uniform vec3 uHoverPinPos;
uniform vec3 uHoverPinAnchor;
uniform vec3 uHoverPinNormal;
uniform float uHoverPinRadius;
uniform float uHoverPinStrength;
uniform vec3 uActivePinPos;
uniform vec3 uActivePinAnchor;
uniform vec3 uActivePinNormal;
uniform float uActivePinRadius;
uniform float uActivePinStrength;
uniform vec3 uHoverPinGlowColor;
uniform vec3 uActivePinGlowColor;
uniform float uPinUnderGlowGain;
uniform float uPinGroundGlowGain;

vec3 applySaturation(vec3 color, float sat) {
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), color, sat);
}

vec3 acesApprox(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float gaussianFalloff(float dist, float radius) {
  float safeRadius = max(radius, 1e-4);
  float x = dist / safeRadius;
  return exp(-x * x * 4.2);
}

float pinUnderGlowTerm(vec3 Npin, vec3 worldPos, vec3 pinPos, vec3 pinNormal, float radius, float strength) {
  if (strength <= 1e-4) return 0.0;
  float proximity = gaussianFalloff(length(worldPos - pinPos), radius * 1.15);
  vec3 undersideDir = normalize(pinNormal);
  float undersideFacing = pow(max(dot(-Npin, undersideDir), 0.0), 1.8);
  return proximity * undersideFacing * strength;
}

float pinGroundGlowTerm(vec3 Nsurf, vec3 worldPos, vec3 anchorPos, float radius, float strength, vec3 planetCenter) {
  if (strength <= 1e-4) return 0.0;
  float localRadius = max(radius, 1e-4);
  float proximity = gaussianFalloff(length(worldPos - anchorPos), localRadius * 1.05);
  vec3 fragDir = normalize(worldPos - planetCenter);
  vec3 anchorDir = normalize(anchorPos - planetCenter);
  float arcMask = smoothstep(0.965, 0.9994, dot(fragDir, anchorDir));
  return proximity * arcMask * strength;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec4 texel = (uUseTexture > 0.5) ? texture(uBaseColorTex, vUv) : vec4(1.0);
  float finalAlpha = clamp(uOpacity, 0.0, 1.0);
  if (uUsePinGamma > 0.5 && uUseTexture > 0.5) {
    if (texel.a <= 0.02) discard;
    finalAlpha *= texel.a;
  }

  float hemiFactor = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 hemiAmbient = mix(uHemiGround, uHemiSky, hemiFactor) * uHemiStrength;
  vec3 ambientBase = uAmbient + hemiAmbient;
  vec3 radial = normalize(vWorldPos - uPlanetCenter);
  float radialFacing = clamp(dot(N, radial) * 0.5 + 0.5, 0.0, 1.0);
  float pinAO = mix(1.0 - clamp(uPinAOStrength, 0.0, 1.0), 1.0, radialFacing);

  float rim = pow(max(1.0 - max(dot(N, V), 0.0), 0.0), uRimPower);
  vec3 rimTerm = rim * uRimStrength * uRimColor;

  vec3 L0 = normalize(-uDir0Dir);
  float ndl0 = dot(N, L0);
  float diff0 = max(ndl0, 0.0);
  float spec0 = pow(max(dot(N, normalize(L0 + V)), 0.0), uShininess);

  vec3 L1 = normalize(-uDir1Dir);
  float ndl1 = dot(N, L1);
  float diff1 = max(ndl1, 0.0);
  float spec1 = pow(max(dot(N, normalize(L1 + V)), 0.0), uShininess);

  vec3 Lp = uPointPos - vWorldPos;
  float dist = length(Lp);
  Lp = normalize(Lp);
  float ndlP = dot(N, Lp);
  float diffP = max(ndlP, 0.0);
  float specP = pow(max(dot(N, normalize(Lp + V)), 0.0), uShininess);
  float attenuation = 1.0 / (1.0 + uPointLinear * dist + uPointQuadratic * dist * dist);
  vec3 lightAccum = (diff0 * uDir0Color + diff1 * uDir1Color) + diffP * uPointColor * attenuation;
  vec3 specular = uSpecularStrength * (
    spec0 * uDir0Color +
    spec1 * uDir1Color +
    specP * uPointColor * attenuation
  );

  if (uUsePinGamma > 0.5) {
    vec3 albedoSrgb = texel.rgb * vColor;
    vec3 albedoLinear = pow(max(albedoSrgb, vec3(0.0)), vec3(2.2));
    vec3 Npin = normalize(faceforward(N, -V, N));
    float ndl0Pin = dot(Npin, L0);
    float ndl1Pin = dot(Npin, L1);
    float ndlPPin = dot(Npin, Lp);
    float diff0Pin = max(ndl0Pin, 0.0);
    float diff1Pin = max(ndl1Pin, 0.0);
    float diffPPin = max(ndlPPin, 0.0);
    float spec0Pin = pow(max(dot(Npin, normalize(L0 + V)), 0.0), uShininess);
    float spec1Pin = pow(max(dot(Npin, normalize(L1 + V)), 0.0), uShininess);
    float specPPin = pow(max(dot(Npin, normalize(Lp + V)), 0.0), uShininess);
    float rimPin = pow(max(1.0 - max(dot(Npin, V), 0.0), 0.0), uRimPower);

    float wrap = clamp(uPinWrapDiffuse, 0.0, 1.0);
    float diff0W = max(ndl0Pin * 0.5 + 0.5, 0.0);
    float diff1W = max(ndl1Pin * 0.5 + 0.5, 0.0);
    float diffPW = max(ndlPPin * 0.5 + 0.5, 0.0);
    vec3 lightAccumPin = (
      mix(diff0Pin, diff0W, wrap) * uDir0Color +
      mix(diff1Pin, diff1W, wrap) * uDir1Color
    ) + mix(diffPPin, diffPW, wrap) * uPointColor * attenuation;

    float shadingMix = clamp(uPinShadingMix, 0.0, 1.0);
    vec3 litTerm = ambientBase * (uPinAmbientBoost * pinAO) + lightAccumPin * 0.72;
    vec3 lightTerm = mix(vec3(1.0), litTerm, shadingMix);
    vec3 pinSpec = uSpecularStrength * (
      spec0Pin * uDir0Color +
      spec1Pin * uDir1Color +
      specPPin * uPointColor * attenuation
    ) * 0.35 * shadingMix;
    vec3 pinRim = rimPin * uRimStrength * uRimColor * (uPinRimBoost * shadingMix);
    float hoverUnderGlow = pinUnderGlowTerm(
      Npin,
      vWorldPos,
      uHoverPinPos,
      uHoverPinNormal,
      uHoverPinRadius,
      uHoverPinStrength
    );
    float activeUnderGlow = pinUnderGlowTerm(
      Npin,
      vWorldPos,
      uActivePinPos,
      uActivePinNormal,
      uActivePinRadius,
      uActivePinStrength
    );
    vec3 underGlow = (
      uHoverPinGlowColor * hoverUnderGlow +
      uActivePinGlowColor * activeUnderGlow
    ) * uPinUnderGlowGain;
    vec3 colorLinear = albedoLinear * lightTerm + pinSpec + pinRim + underGlow;
    colorLinear *= clamp(uPinBrightness, 0.0, 2.0);
    colorLinear = applySaturation(colorLinear, clamp(uPinSaturation, 0.0, 2.0));
    vec3 colorSrgb = pow(acesApprox(max(colorLinear, vec3(0.0))), vec3(1.0 / 2.2));
    outColor = vec4(clamp(colorSrgb, 0.0, 1.0), finalAlpha);
  } else {
    vec3 albedo = vColor * texel.rgb;
    vec3 ambient = ambientBase * albedo;
    vec3 diffuseBase = albedo * (
      (diff0 * uDir0Color + diff1 * uDir1Color) * 0.52 +
      diffP * uPointColor * attenuation * 0.12
    );
    vec3 specularBase = specular * 0.06;
    vec3 rimBase = rimTerm * 0.02;
    float hoverGroundGlow = pinGroundGlowTerm(
      N,
      vWorldPos,
      uHoverPinAnchor,
      uHoverPinRadius,
      uHoverPinStrength,
      uPlanetCenter
    );
    float activeGroundGlow = pinGroundGlowTerm(
      N,
      vWorldPos,
      uActivePinAnchor,
      uActivePinRadius,
      uActivePinStrength,
      uPlanetCenter
    );
    vec3 groundGlow = (
      uHoverPinGlowColor * hoverGroundGlow +
      uActivePinGlowColor * activeGroundGlow
    ) * uPinGroundGlowGain * 0.82;
    vec3 colorLinear = (ambient + diffuseBase + specularBase + rimBase + groundGlow) * max(uSceneExposure, 0.0);
    vec3 colorSrgb = pow(max(colorLinear, vec3(0.0)), vec3(1.0 / 2.2));
    outColor = vec4(clamp(colorSrgb, 0.0, 1.0), finalAlpha);
  }
}
