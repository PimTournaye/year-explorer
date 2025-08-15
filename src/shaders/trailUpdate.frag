precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_trailTexture;
uniform float u_decayFactor;

void main() {
  vec4 color = texture2D(u_trailTexture, v_texCoord);
  
  // For black-to-white trail system: fade bright colors back towards black
  // Simply multiply by decay factor to fade towards black (0.0)
  vec3 decayedColor = color.rgb * u_decayFactor;
  
  gl_FragColor = vec4(decayedColor, 1.0);
}
