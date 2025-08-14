precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_agentStateTexture;
uniform sampler2D u_agentPropertiesTexture;
uniform sampler2D u_agentExtendedTexture;
uniform sampler2D u_trailTexture;
uniform vec2 u_canvasSize;
uniform float u_agentTextureSize;
uniform float u_deltaTime;
uniform float u_agentSpeed;
uniform float u_sensorDistance;
uniform float u_sensorAngle;
uniform float u_turnStrength;

// Random function for agent behavior
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float sampleTrail(vec2 pos) {
  vec2 uv = pos / u_canvasSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec4 trail = texture2D(u_trailTexture, uv);
  return (trail.r + trail.g + trail.b) / 3.0;
}

void main() {
  vec4 agentState = texture2D(u_agentStateTexture, v_texCoord);
  
  // agentState: x=posX, y=posY, z=velX, w=velY
  vec2 position = agentState.xy;
  vec2 velocity = agentState.zw;
  
  // Read agent properties to check if it's alive
  vec4 properties = texture2D(u_agentPropertiesTexture, v_texCoord);
  float age = properties.x;
  float maxAge = properties.y;

  // Skip inactive/dead agents
  if (maxAge < 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); // Force position and velocity to zero
    return;
  }
  
  // Read extended properties for target data
  // vec4 extended = texture2D(u_agentExtendedTexture, v_texCoord);
  // vec2 targetPos = extended.yz;

  // NOTE: Arrival detection is now handled in the agentProperties.frag shader
  // to ensure the "ping" effect triggers correctly upon death.
  // This shader now focuses only on movement.

  // Current angle from velocity
  float currentAngle = atan(velocity.y, velocity.x);
  
  // Sensor positions
  float leftAngle = currentAngle - u_sensorAngle;
  float rightAngle = currentAngle + u_sensorAngle;
  
  vec2 leftSensor = position + vec2(cos(leftAngle), sin(leftAngle)) * u_sensorDistance;
  vec2 forwardSensor = position + vec2(cos(currentAngle), sin(currentAngle)) * u_sensorDistance;
  vec2 rightSensor = position + vec2(cos(rightAngle), sin(rightAngle)) * u_sensorDistance;
  
  // Sample trail strength at sensor positions
  float leftStrength = sampleTrail(leftSensor);
  float forwardStrength = sampleTrail(forwardSensor);
  float rightStrength = sampleTrail(rightSensor);
  
  // Decision making (physarum-style steering)
  float newAngle = currentAngle;
  if (forwardStrength > leftStrength && forwardStrength > rightStrength) {
    // Continue forward
  } else if (leftStrength > rightStrength) {
    newAngle -= u_turnStrength;
  } else if (rightStrength > leftStrength) {
    newAngle += u_turnStrength;
  } else {
    // Random turn when confused
    newAngle += (random(v_texCoord + position) - 0.5) * u_turnStrength;
  }
  
  // Update velocity from new angle
  vec2 newVelocity = vec2(cos(newAngle), sin(newAngle)) * u_agentSpeed;
  
  // Update position
  vec2 newPosition = position + newVelocity * u_deltaTime;
  
  // Boundary conditions (wrap around screen)
  if (newPosition.x < 0.0) newPosition.x = u_canvasSize.x;
  if (newPosition.x > u_canvasSize.x) newPosition.x = 0.0;
  if (newPosition.y < 0.0) newPosition.y = u_canvasSize.y;
  if (newPosition.y > u_canvasSize.y) newPosition.y = 0.0;
  
  gl_FragColor = vec4(newPosition, newVelocity);
}
