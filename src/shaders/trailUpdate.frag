precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_trailTexture;
uniform float u_decayFactor;

void main() {
  vec4 color = texture2D(u_trailTexture, v_texCoord);
  gl_FragColor = vec4(color.rgb * u_decayFactor, 1.0);
}
