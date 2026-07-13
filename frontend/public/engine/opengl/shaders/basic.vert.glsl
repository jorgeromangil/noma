#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec2 aUv;

out vec3 vColor;
out vec3 vNormal;
out vec3 vWorldPos;
out vec2 vUv;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

void main() {
  mat3 normalMat = mat3(transpose(inverse(uModel)));
  vNormal = normalize(normalMat * aNormal);
  vec4 worldPos = uModel * vec4(aPos, 1.0);
  vWorldPos = worldPos.xyz;
  vColor = aColor;
  vUv = aUv;
  gl_Position = uProj * uView * worldPos;
}
