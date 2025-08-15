precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_trailTexture;
uniform float u_threshold;

void main() {
  vec4 trailColor = texture2D(u_trailTexture, v_texCoord);
  float brightness = dot(trailColor.rgb, vec3(0.299, 0.587, 0.114));
  
  // For off-white theme: invert bright trails to dark marks
  if (brightness > u_threshold) {
    // Invert the trail: bright trails become dark marks on off-white background
    vec3 darkTrail = vec3(1.0) - trailColor.rgb;
    gl_FragColor = vec4(darkTrail, 1.0);
  } else {
    // Below threshold: transparent
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
}
