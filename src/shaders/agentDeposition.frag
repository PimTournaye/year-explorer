precision highp float;
varying vec2 v_texCoord;

uniform sampler2D u_decayedTrailTexture;
uniform sampler2D u_agentStateTexture;
uniform sampler2D u_agentPropertiesTexture;

uniform float u_agentTextureSize;
uniform int u_activeAgentCount;
uniform float u_trailStrength;
uniform vec2 u_canvasSize;

// HSV to RGB conversion for cluster coloring
vec3 hsv2rgb(vec3 c){
  vec4 K=vec4(1.,2./3.,1./3.,3.);
  vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www);
  return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y);
}

void main(){
  vec4 existingColor=texture2D(u_decayedTrailTexture,v_texCoord);
  float brightnessDeposit=0.;
  vec3 colorDeposit=vec3(0.);
  
  vec2 worldPos=vec2(v_texCoord.x,1.-v_texCoord.y)*u_canvasSize;// Keep the Y-flip
  int textureSize=int(u_agentTextureSize);
  
  // Loop through all possible agent slots.
  // Using a larger loop bound like 128 is safer for bigger textures.
  for(int y=0;y<128;y++){
    if(y>=textureSize)break;
    for(int x=0;x<128;x++){
      if(x>=textureSize)break;
      
      vec2 texCoord=(vec2(float(x),float(y))+.5)/u_agentTextureSize;
      vec4 agentState=texture2D(u_agentStateTexture,texCoord);
      vec2 agentPos=agentState.xy;
      
      // This is the only check that matters now.
      // It finds active agents regardless of their index.
      if(length(agentPos)<1.)continue;
      
      // If the agent is active, proceed.
      vec4 agentProperties=texture2D(u_agentPropertiesTexture,texCoord);
      float isFrontier=agentProperties.z;
      float clusterHue=agentProperties.a;
      
      float dist=length(worldPos-agentPos);
      // Slime mold-like trails: smaller radius, moderate strength
      float influence=smoothstep(12.,1.,dist)*u_trailStrength*0.3; // Smaller and weaker than original
      
      if(isFrontier>.5){
        brightnessDeposit+=influence; // Strongest trail
      }else{
        // This now applies to both Bridge and Wandering Ecosystem agents
        brightnessDeposit+=influence*0.05; // Very weak trail
      }
      
      if(influence>0.){
        float clusterHue=agentProperties.a;
        // Subtle color with some saturation
        vec3 clusterColor=hsv2rgb(vec3(clusterHue/360.,.3,.9)); // Medium saturation
        colorDeposit+=clusterColor*influence*0.1; // Less color influence
      }
    }
  }
  
  // The final color combines the old trail, the new brightness, and the new color.
  gl_FragColor=vec4(existingColor.rgb-colorDeposit+vec3(brightnessDeposit),1.0);
}

// void main() {
  //   vec4 existingTrail = texture2D(u_decayedTrailTexture, v_texCoord);
  //   float deposit = 0.0;
  //   vec3 debugColor = vec3(0.0);
  
  //   // Convert fragment coord to world position
  //   vec2 worldPos = vec2(v_texCoord.x, 1.0 - v_texCoord.y) * u_canvasSize;
  
  //   // COORDINATE SYSTEM DEBUG: Show a grid pattern to understand coordinates
  //   if (mod(worldPos.x, 100.0) < 2.0 || mod(worldPos.y, 100.0) < 2.0) {
    //     debugColor.b = 0.3; // Blue grid lines every 100px
  //   }
  
  //   int textureSize = int(u_agentTextureSize);
  
  //   // DEBUG: Show first agent position as green dots + print actual values
  //   if (u_activeAgentCount > 0) {
    //     vec2 texCoord = (vec2(0.0, 0.0) + 0.5) / u_agentTextureSize;
    //     vec4 agentState = texture2D(u_agentStateTexture, texCoord);
    //     vec2 agentPos = agentState.xy;
    
    //     // CRITICAL DEBUG: Show exact agent coordinates as colored squares
    //     if (worldPos.x < 200.0 && worldPos.y < 100.0) {
      //       if (worldPos.x < 50.0) {
        //         debugColor.r = agentPos.x / 1000.0; // Scale down for visibility
      //       } else if (worldPos.x < 100.0) {
        //         debugColor.g = agentPos.y / 1000.0; // Scale down for visibility
      //       } else if (worldPos.x < 150.0) {
        //         debugColor.b = length(agentPos) / 1000.0; // Show magnitude
      //       } else {
        //         // Show if coordinates are reasonable (should be bright if in canvas bounds)
        //         debugColor.rg = vec2(
          //           (agentPos.x > 0.0 && agentPos.x < u_canvasSize.x) ? 1.0 : 0.0,
          //           (agentPos.y > 0.0 && agentPos.y < u_canvasSize.y) ? 1.0 : 0.0
        //         );
      //       }
    //     }
    
    //     // Show agent position as bright green dot
    //     if (length(worldPos - agentPos) < 20.0) {
      //       debugColor.g = 1.0; // Green for first agent
    //     }
    
    //     // DEBUG: Show raw agent position values as colored stripes (RIGHT SIDE of screen)
    //     if (worldPos.x > u_canvasSize.x - 100.0) {
      //       if (worldPos.y < 100.0) {
        //         debugColor.r = agentPos.x / u_canvasSize.x; // Red stripe = normalized X position
      //       } else if (worldPos.y < 200.0) {
        //         debugColor.g = agentPos.y / u_canvasSize.y; // Green stripe = normalized Y position
      //       } else if (worldPos.y < 300.0) {
        //         debugColor.b = length(agentPos) > 1.0 ? 1.0 : 0.0; // Blue stripe = is agent active?
      //       } else if (worldPos.y < 400.0) {
        //         // Show raw coordinates as colors
        //         debugColor.rg = vec2(mod(agentPos.x, 256.0)/256.0, mod(agentPos.y, 256.0)/256.0);
      //       }
    //     }
    
    //     // DEBUG: Show texture size and agent count as colors in corner
    //     if (worldPos.x < 50.0 && worldPos.y < 50.0) {
      //       debugColor.r = float(u_activeAgentCount) / 10.0; // Red intensity = agent count
      //       debugColor.b = float(textureSize) / 64.0; // Blue intensity = texture size
    //     }
  //   }
  
  //   // Loop through all active agents
  //   for (int y = 0; y < 128; y++) {
    //     if (y >= textureSize) break;
    //     for (int x = 0; x < 128; x++) {
      //       if (x >= textureSize) break;
      
      //       int agentIndex = y * textureSize + x;
      //       if (agentIndex >= u_activeAgentCount) break;
      
      //       vec2 texCoord = (vec2(float(x), float(y)) + 0.5) / u_agentTextureSize;
      //       vec4 agentState = texture2D(u_agentStateTexture, texCoord);
      //       vec2 agentPos = agentState.xy;
      
      //       // DEBUG: Show all agent positions as yellow dots
      //       if (length(worldPos - agentPos) < 10.0) {
        //         debugColor.rg = vec2(1.0, 1.0); // Yellow for all agents
      //       }
      
      //       // Check if agent is active
      //       if (length(agentPos) > 1.0) {
        //         float dist = length(worldPos - agentPos);
        //         // MASSIVE trail radius and super strong influence
        //         float influence = smoothstep(100.0, 0.0, dist) * u_trailStrength * 10.0;
        //         deposit += influence;
      //       }
    //     }
  //   }
  
  //   // Combine existing trail with new deposits - SUPER BRIGHT
  //   float finalBrightness = existingTrail.r + deposit * 50.0;
  
  //   // Output: trails as white + debug colors
  //   gl_FragColor = vec4(finalBrightness + debugColor.r, finalBrightness + debugColor.g, finalBrightness + debugColor.b, 1.0);
// }

// void main() {
  //   vec2 finalColor = vec2(0.0);
  //   int textureSize = int(u_agentTextureSize);
  
  //   // We will add up the indices of all active agents
  //   float totalIndex = 0.0;
  //   float activeCount = 0.0;
  
  //   for (int y = 0; y < 128; y++) {
    //       if (y >= textureSize) break;
    //       for (int x = 0; x < 128; x++) {
      //           if (x >= textureSize) break;
      //           int agentIndex = y * textureSize + x;
      //           if (agentIndex >= u_activeAgentCount) break;
      
      //           vec2 texCoord = (vec2(float(x), float(y)) + 0.5) / u_agentTextureSize;
      //           vec4 agentState = texture2D(u_agentStateTexture, texCoord);
      
      //           if (length(agentState.xy) > 1.0) {
        //               totalIndex += float(agentIndex);
        //               activeCount += 1.0;
      //           }
    //       }
  //   }
  
  //   // Visualize the sum of the indices and the count of active agents
  //   // Red channel = sum of indices (will be high if we see many different agents)
  //   // Green channel = number of active agents found
  //   gl_FragColor = vec4(totalIndex / 100.0, activeCount / 10.0, 0.0, 1.0);
// }