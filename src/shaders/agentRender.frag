precision mediump float;
varying float v_brightness;
varying float v_isFrontier;

void main() {
  vec3 color;
  // Frontier agents are bright white/yellow, Ecosystem agents are dim
  if (v_isFrontier > 0.5) {
    // Frontier agents - bright yellow and prominent
    color = vec3(1.0, 1.0, 0.0);
  } else {
    // Ecosystem agents - dim and subtle
    color = vec3(0.7, 0.7, 0.9);
  }

  // The v_brightness already includes the fade-in/out from the vertex shader.
  // Use it as the alpha value.
  gl_FragColor = vec4(color, v_brightness);
}
