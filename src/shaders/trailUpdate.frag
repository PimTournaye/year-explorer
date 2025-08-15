precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_trailTexture;
uniform float u_decayFactor;
uniform vec2 u_texelSize; // 1/width, 1/height

// Small diffusion kernel (cross + diagonals) for softening / widening trails
vec3 sampleTrail(vec2 uv){
  return texture2D(u_trailTexture, uv).rgb;
}

void main(){
  vec3 center = sampleTrail(v_texCoord);
  vec3 sum = center * 4.0; // center weight
  sum += sampleTrail(v_texCoord + vec2(u_texelSize.x,0.0));
  sum += sampleTrail(v_texCoord - vec2(u_texelSize.x,0.0));
  sum += sampleTrail(v_texCoord + vec2(0.0,u_texelSize.y));
  sum += sampleTrail(v_texCoord - vec2(0.0,u_texelSize.y));
  // diagonals (lighter weight)
  sum += sampleTrail(v_texCoord + u_texelSize) * 0.5;
  sum += sampleTrail(v_texCoord - u_texelSize) * 0.5;
  sum += sampleTrail(v_texCoord + vec2(u_texelSize.x,-u_texelSize.y)) * 0.5;
  sum += sampleTrail(v_texCoord + vec2(-u_texelSize.x,u_texelSize.y)) * 0.5;

  float totalWeight = 4.0 + 4.0 + 4.0 * 0.5; // 4 (center*4) + 4 (cross) + 2 (diagonals total)
  vec3 blurred = sum / totalWeight;

  // Light diffusion: blend a portion of blurred into center to widen strokes
  vec3 diffused = mix(center, blurred, 0.55);

  // Apply decay so older values fade
  vec3 decayed = diffused * u_decayFactor;
  gl_FragColor = vec4(decayed, 1.0);
}
