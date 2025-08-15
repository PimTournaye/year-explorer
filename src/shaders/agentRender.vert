attribute float a_agentIndex;
uniform sampler2D u_agentStateTexture;
uniform sampler2D u_agentPropertiesTexture;
uniform float u_agentTextureSize;
uniform vec2 u_canvasSize;
varying float v_brightness;
varying float v_isFrontier;
varying float v_age;
varying float v_maxAge;

void main(){
  // Convert agent index to texture coordinates
  float x=mod(a_agentIndex,u_agentTextureSize);
  float y=floor(a_agentIndex/u_agentTextureSize);
  vec2 texCoord=(vec2(x,y)+.5)/u_agentTextureSize;
  
  // Read agent state from texture
  vec4 agentState=texture2D(u_agentStateTexture,texCoord);
  vec2 position=agentState.xy;
  
  // Read agent properties from texture
  vec4 properties=texture2D(u_agentPropertiesTexture,texCoord);
  v_age=properties.x;// R channel stores age
  v_maxAge=properties.y;// G channel stores maxAge
  float isFrontier=properties.z;
  float brightness=properties.w;
  
  // Skip inactive agents - made less restrictive for debugging
  if(v_maxAge<1.){
    gl_Position=vec4(-10.,-10.,0.,1.);// Off-screen
    gl_PointSize=0.;
    v_brightness=0.;
    v_isFrontier=0.;
    return;
  }
  
  // Calculate life fraction for smooth fade-in/out
  float lifeFraction=v_age/v_maxAge;
  
  // Fade-in during first 20% of life, fade-out during last 20% of life
  float fadeInFactor=smoothstep(0.,.2,lifeFraction);
  float fadeOutFactor=smoothstep(.8,1.,lifeFraction);
  float lifeCycleFade=fadeInFactor*(1.-fadeOutFactor);
  
  // Normalize position to 0.0 - 1.0 range
  vec2 normalizedPos=position/u_canvasSize;
  // Flip the Y-axis to match screen space (top-left origin)
  normalizedPos.y=1.-normalizedPos.y;
  // Convert to WebGL's clip space (-1.0 to 1.0 range)
  vec2 clipPos=normalizedPos*2.-1.;
  gl_Position=vec4(clipPos,0.,1.);
  
  // Frontier agents are larger and more prominent
  gl_PointSize=isFrontier>.5?8.:3.;
  
  // Pass properties to fragment shader with lifecycle fading applied
  v_age=properties.x;
  v_maxAge=properties.y;
  v_brightness=brightness*lifeCycleFade;
  v_isFrontier=isFrontier;
}
