precision highp float;
varying vec2 v_texCoord;

// Input textures
uniform sampler2D u_agentPropertiesTexture;
uniform sampler2D u_agentStateTexture; // Contains current position
uniform sampler2D u_agentExtendedTexture; // Contains target position

// Uniforms
uniform float u_deltaTime;

void main() {
  vec4 properties = texture2D(u_agentPropertiesTexture, v_texCoord);
  
  // properties: x=age, y=maxAge, z=isFrontier (0.0/1.0), w=brightness
  float age = properties.x;
  float maxAge = properties.y;
  float isFrontier = properties.z;
  float brightness = properties.w;
  
  // Skip inactive agents
  if (maxAge < 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  
  // Age the agent
  float newAge = age + u_deltaTime;

  // Read current state and extended properties for arrival check
  vec4 agentState = texture2D(u_agentStateTexture, v_texCoord);
  vec4 extended = texture2D(u_agentExtendedTexture, v_texCoord);
  
  vec2 currentPos = agentState.xy;
  vec2 targetPos = extended.yz;

  // Check for arrival
  float distToTarget = distance(currentPos, targetPos);
  if (distToTarget < 15.0) { // 15 pixel arrival radius
    // Force death on arrival to trigger the ping
    newAge = maxAge + 1.0; 
  }
  
  // Agent dies when it exceeds maxAge
  if (newAge > maxAge) {
    // Signal a "ping" on death by setting alpha to 1.0
    // Set maxAge to 0.0 to prevent re-triggering.
    gl_FragColor = vec4(0.0, 0.0, isFrontier, 1.0); // Pass isFrontier for filtering pings
    return;
  }
  
  gl_FragColor = vec4(newAge, maxAge, isFrontier, brightness);
}
