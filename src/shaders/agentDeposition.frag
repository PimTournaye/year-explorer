precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_decayedTrailTexture;
uniform sampler2D u_agentStateTexture;
uniform sampler2D u_agentPropertiesTexture;
uniform sampler2D u_agentExtendedTexture;
uniform float u_agentTextureSize;
uniform int u_activeAgentCount;
uniform float u_trailStrength;
uniform vec2 u_canvasSize;

// HSV to RGB conversion for cluster coloring
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 color = texture2D(u_decayedTrailTexture, v_texCoord);
  float deposit = 0.0;
  vec3 colorDeposit = vec3(0.0);
  
  // Convert fragment coord to world position
  vec2 worldPos = v_texCoord * u_canvasSize;
  
  // Sample all active agents from the agent state texture
  // Use dynamic texture size instead of hardcoded 64x64
  int textureSize = int(u_agentTextureSize);
  for (int y = 0; y < 64; y++) { // Keep max loop bounds for WebGL compatibility
    if (y >= textureSize) break;
    for (int x = 0; x < 64; x++) {
      if (x >= textureSize) break;
      int agentIndex = y * textureSize + x;
      if (agentIndex >= u_activeAgentCount) break;
      
      vec2 texCoord = (vec2(float(x), float(y)) + 0.5) / u_agentTextureSize;
      vec4 agentState = texture2D(u_agentStateTexture, texCoord);
      vec4 agentProperties = texture2D(u_agentPropertiesTexture, texCoord);
      vec4 agentExtended = texture2D(u_agentExtendedTexture, texCoord);
      
      // agentState.xy = position, agentState.zw = velocity
      vec2 agentPos = agentState.xy;
      // agentProperties: (age, maxAge, isFrontier, brightness)
      float isFrontier = agentProperties.z;
      // agentExtended.x = clusterHue
      float clusterHue = agentExtended.x;
      
      // Skip inactive agents (position = 0,0)
      if (length(agentPos) < 1.0) continue;
      
      // Debug: Log first few agents (this will be noisy but informative)
      if (agentIndex < 5 && worldPos.x < 10.0 && worldPos.y < 10.0) {
        // Note: Can't actually log from fragment shader, but we can use this for analysis
      }
      
      vec2 diff = worldPos - agentPos;
      float dist = length(diff);
      float agentInfluence = smoothstep(10.0, 0.0, dist) * u_trailStrength;
      
      // **NEW LOGIC**: Trail Hierarchy based on agent status
      if (isFrontier > 0.5) {
        // Frontier agents leave strong, primary trails
        deposit += agentInfluence; 
      } else {
        // Ecosystem agents leave much weaker, subtler trails
        deposit += agentInfluence * 0.1; // 10% of the strength
      }
      
      // Add subtle cluster color "dye" to the trail
      if (agentInfluence > 0.0) {
        vec3 clusterColor = hsv2rgb(vec3(clusterHue / 360.0, 0.3, 1.0)); // Low saturation for subtlety
        colorDeposit += clusterColor * agentInfluence * 0.1; // Very subtle color contribution
      }
    }
  }

  // Combine base trail with brightness deposit and subtle color dye
  gl_FragColor = vec4(color.rgb + deposit + colorDeposit, 1.0);
}
