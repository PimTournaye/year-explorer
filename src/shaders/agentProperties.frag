precision highp float;
varying vec2 v_texCoord;

// Input textures
uniform sampler2D u_agentPropertiesTexture;
uniform sampler2D u_agentStateTexture; // Contains current position

// Uniforms
uniform float u_deltaTime;

void main() {
  vec4 properties = texture2D(u_agentPropertiesTexture, v_texCoord);
  
  // properties: x=age, y=maxAge, z=isFrontier, w=brightness
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
  
  // Agent dies when it exceeds maxAge (arrival handled by CPU)
  if (newAge > maxAge) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); // Kill the agent
    return;
  }
  
  gl_FragColor = vec4(newAge, maxAge, isFrontier, brightness);
}
