precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_trailTexture;
uniform float u_gamma;       // perceptual shaping (<1 lifts mids)
uniform float u_contrast;    // edge sharpening (>1 increases separation)
uniform vec3  u_lightColor;  // near background (very light)
uniform vec3  u_darkColor;   // darkest stroke tone (still light-ish per request)

void main(){
  vec3 src = texture2D(u_trailTexture, v_texCoord).rgb; // accumulated brightness (white builds up)
  float luma = dot(src, vec3(0.299,0.587,0.114));

  // Soft onset so single passes are extremely faint
  float envelope = smoothstep(0.015, 0.20, luma);

  // Shape response
  float shaped = pow(max(luma, 0.0), u_gamma);
  shaped = clamp( (shaped - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  // Effective intensity controlling darkening
  float intensity = shaped * envelope;

  // Progressive darkening: interpolate from lightColor (base) to darkColor (max traffic)
  vec3 stroke = mix(u_lightColor, u_darkColor, intensity);

  // Alpha – slightly sub‑linear so early deposits remain subtle
  float alpha = pow(intensity, 1.1);

  gl_FragColor = vec4(stroke, alpha);
}
