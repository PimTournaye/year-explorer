precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_agentStateTexture;
uniform sampler2D u_agentPropertiesTexture;
uniform sampler2D u_trailTexture;
uniform vec2 u_canvasSize;
uniform float u_agentTextureSize;
uniform float u_deltaTime;
uniform float u_agentSpeed;
uniform float u_sensorDistance;
uniform float u_sensorAngle;
uniform float u_turnStrength;

// Random function for agent behavior
float random(vec2 st){
  return fract(sin(dot(st.xy,vec2(12.9898,78.233)))*43758.5453123);
}

float sampleTrail(vec2 pos){
  vec2 uv=pos/u_canvasSize;
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)return 0.;
  vec4 trail=texture2D(u_trailTexture,uv);
  return(trail.r+trail.g+trail.b)/3.;
}

void main() {
  // --- 1. Read All Necessary State ---
  vec4 agentState = texture2D(u_agentStateTexture, v_texCoord);
  vec2 position = agentState.xy;
  vec2 velocity = agentState.zw;
  
  vec4 properties = texture2D(u_agentPropertiesTexture, v_texCoord);
  float maxAge = properties.y;

  // Immediately exit for dead agents
  if (maxAge < 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // --- 2. Calculate the Two Steering Forces ---

  // Force A: Trail-Following (Physarum Logic)
  float currentAngle = atan(velocity.y, velocity.x);
  float leftAngle = currentAngle - u_sensorAngle;
  float rightAngle = currentAngle + u_sensorAngle;
  vec2 leftSensor = position + vec2(cos(leftAngle), sin(leftAngle)) * u_sensorDistance;
  vec2 forwardSensor = position + vec2(cos(currentAngle), sin(currentAngle)) * u_sensorDistance;
  vec2 rightSensor = position + vec2(cos(rightAngle), sin(rightAngle)) * u_sensorDistance;
  float leftStrength = sampleTrail(leftSensor);
  float forwardStrength = sampleTrail(forwardSensor);
  float rightStrength = sampleTrail(rightSensor);
  
  float trailAngle = currentAngle;
  if (forwardStrength > leftStrength && forwardStrength > rightStrength) {
    // No change, continue forward
  } else if (leftStrength > rightStrength) {
    trailAngle -= u_turnStrength;
  } else if (rightStrength > leftStrength) {
    trailAngle += u_turnStrength;
  } else {
    // If sensors are equal, add some randomness to prevent getting stuck
    trailAngle += (random(v_texCoord + position) - 0.5) * u_turnStrength * 2.0;
  }
  vec2 trailVector = vec2(cos(trailAngle), sin(trailAngle));

  // For now, use simpler trail-following behavior
  // Target-driven movement will be handled by CPU logic
  vec2 finalDirection = trailVector;
  
  // --- 4. Update and Write New State ---
  vec2 newVelocity = finalDirection * u_agentSpeed;
  vec2 newPosition = position + newVelocity * u_deltaTime;
  
  // Boundary conditions (wrap around screen)
  if (newPosition.x < 0.0) newPosition.x = u_canvasSize.x;
  if (newPosition.x > u_canvasSize.x) newPosition.x = 0.0;
  if (newPosition.y < 0.0) newPosition.y = u_canvasSize.y;
  if (newPosition.y > u_canvasSize.y) newPosition.y = 0.0;
  
  gl_FragColor = vec4(newPosition, newVelocity);
}
