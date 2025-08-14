precision mediump float;
varying float v_brightness;
varying float v_isFrontier;
varying float v_age;
varying float v_maxAge;

void main() {
  // Define the fade-in and fade-out periods as a percentage of total lifespan
  float fadeInDuration = 0.1;  // First 10% of life is for fading in
  float fadeOutDuration = 0.2; // Last 20% of life is for fading out

  // Calculate the agent's current position in its lifespan (0.0 at birth, 1.0 at death)
  float life_fraction = v_age / v_maxAge;

  // --- Calculate the fade-in and fade-out multipliers ---
  // Fade-in: starts at 0.0, smoothly goes to 1.0 during the fadeInDuration
  float fadeIn = smoothstep(0.0, fadeInDuration, life_fraction);

  // Fade-out: starts at 1.0, smoothly goes to 0.0 during the fadeOutDuration at the end of life
  float fadeOut = smoothstep(1.0, 1.0 - fadeOutDuration, life_fraction);

  // The final alpha is the base brightness multiplied by both fades.
  // This works because fadeIn is 1.0 for most of the life, and fadeOut is 1.0 until the end.
  float alpha = v_brightness * fadeIn * fadeOut;
  
  // Determine the agent's color based on its status
  vec3 color;
  if (v_isFrontier > 0.5) {
    // Frontier agents - bright and prominent
    color = vec3(1.0, 0.9, 0.6);
  } else {
    // Ecosystem agents - dim and subtle
    color = vec3(0.7, 0.7, 0.9);
  }

  // Set the final pixel color with the calculated alpha
  gl_FragColor = vec4(color, alpha);
}