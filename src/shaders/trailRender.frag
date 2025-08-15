precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_trailTexture;
uniform float u_threshold;

void main() {
  vec4 trailColor = texture2D(u_trailTexture, v_texCoord);
  
  // Convert to brightness for threshold check
  float brightness = dot(trailColor.rgb, vec3(0.299, 0.587, 0.114));
  
  // Threshold rendering for "goopy" hard-edged form
  if (brightness > u_threshold) {
    // Above threshold: render as solid white
    gl_FragColor = vec4(trailColor.rgb, 1.0);
  } else {
    // Below threshold: transparent
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
}
