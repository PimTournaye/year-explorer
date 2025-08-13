import type { AgentSpawnData, FrontierAgentMirror } from '../data/interfaces';
import { Shader } from '../rendering/Shader';
import { createFloatTexture, createFramebuffer, createScreenQuad, createBuffer } from '../rendering/utils';

export class GPUSystem {
  private gl: WebGLRenderingContext;
  private width: number;
  private height: number;

  // GPU Agent State System - stores agent data in floating point textures  
  private agentStateTextures: WebGLTexture[] = []; // (posX, posY, velX, velY)
  private agentStateFramebuffers: WebGLFramebuffer[] = [];
  // Second texture for agent properties (age, maxAge, isFrontier, brightness)
  private agentPropertiesTextures: WebGLTexture[] = []; 
  private agentPropertiesFramebuffers: WebGLFramebuffer[] = [];
  private currentAgentSourceIndex: 0 | 1 = 0;
  private agentTextureSize: number = 0; // Square texture size (e.g., 32x32 = 1024 agents)
  private maxAgents: number = 0;
  private activeAgentCount: number = 0;
  
  // CPU Mirror System for Frontier agents (for label rendering)
  private frontierAgentMirrors: Map<number, FrontierAgentMirror> = new Map();

  // Shader programs
  private agentUpdateShader!: Shader; // GPGPU brain shader for agent state
  private agentPropertiesShader!: Shader; // GPGPU shader for agent properties update  
  private agentRenderShader!: Shader; // GPU agent rendering

  // Buffers
  private screenQuadBuffer!: WebGLBuffer;
  private agentGridBuffer!: WebGLBuffer;

  // Uniforms for GPGPU agent update shader
  private agentUpdateUniforms!: {
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uTrailTexture: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uDeltaTime: WebGLUniformLocation | null;
    uAgentSpeed: WebGLUniformLocation | null;
    uSensorDistance: WebGLUniformLocation | null;
    uSensorAngle: WebGLUniformLocation | null;
    uTurnStrength: WebGLUniformLocation | null;
  };

  // Uniforms for agent properties update shader
  private agentPropertiesUniforms!: {
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uDeltaTime: WebGLUniformLocation | null;
  };

  // Uniforms for agent rendering
  private agentRenderUniforms!: {
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
  };

  constructor(gl: WebGLRenderingContext, width: number, height: number, maxAgents: number = 1024) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    
    // Calculate agent texture size (square texture that can hold maxAgents)
    this.agentTextureSize = Math.ceil(Math.sqrt(maxAgents));
    this.maxAgents = this.agentTextureSize * this.agentTextureSize;
    
    console.log(`🧠 Initializing GPUSystem for ${this.maxAgents} agents (${this.agentTextureSize}x${this.agentTextureSize} texture)`);

    this.initializeBuffers();
    this.initializeShaders();
    this.screenQuadBuffer = createScreenQuad(gl);
    this.createAgentGrid();

    console.log('✅ GPUSystem initialized');
  }

  private initializeBuffers(): void {
    const gl = this.gl;

    // Create agent state textures (FLOAT textures for precise agent data)
    // Each pixel stores one agent: (posX, posY, velX, velY) in RGBA channels
    for (let i = 0; i < 2; i++) {
      const stateTexture = createFloatTexture(gl, this.agentTextureSize, this.agentTextureSize);
      this.agentStateTextures.push(stateTexture);

      // Create framebuffer for agent state
      const stateFramebuffer = createFramebuffer(gl, stateTexture);
      this.agentStateFramebuffers.push(stateFramebuffer);
      
      // Create agent properties textures: (age, maxAge, isFrontier, brightness) in RGBA channels
      const propertiesTexture = createFloatTexture(gl, this.agentTextureSize, this.agentTextureSize);
      this.agentPropertiesTextures.push(propertiesTexture);

      // Create framebuffer for agent properties
      const propertiesFramebuffer = createFramebuffer(gl, propertiesTexture);
      this.agentPropertiesFramebuffers.push(propertiesFramebuffer);
    }

    // Initialize agent state textures with zeros (no agents)
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentPropertiesFramebuffers[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private initializeShaders(): void {
    const gl = this.gl;

    // Standard vertex shader for full-screen quad operations
    const quadVertexSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = (a_position + 1.0) * 0.5;
      }
    `;

    // GPGPU Agent update shader (the "brain" - replaces applyPhysarumSteering)
    const agentUpdateFragmentSource = `
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
        
        // Skip inactive agents
        if (length(position) < 1.0) {
          gl_FragColor = agentState;
          return;
        }
        
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
    `;

    // Agent properties update shader (ages agents and manages hierarchy)
    const agentPropertiesFragmentSource = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform sampler2D u_agentPropertiesTexture;
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
          gl_FragColor = properties;
          return;
        }
        
        // Age the agent
        float newAge = age + u_deltaTime;
        
        // Agent dies when it exceeds maxAge
        if (newAge > maxAge) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }
        
        gl_FragColor = vec4(newAge, maxAge, isFrontier, brightness);
      }
    `;

    // Agent rendering vertex shader (renders agents from GPU state with hierarchy)
    const agentRenderVertexSource = `
      attribute float a_agentIndex;
      uniform sampler2D u_agentStateTexture;
      uniform sampler2D u_agentPropertiesTexture;
      uniform float u_agentTextureSize;
      uniform vec2 u_canvasSize;
      varying float v_brightness;
      varying float v_isFrontier;
      
      void main() {
        // Convert agent index to texture coordinates
        float x = mod(a_agentIndex, u_agentTextureSize);
        float y = floor(a_agentIndex / u_agentTextureSize);
        vec2 texCoord = (vec2(x, y) + 0.5) / u_agentTextureSize;
        
        // Read agent state from texture
        vec4 agentState = texture2D(u_agentStateTexture, texCoord);
        vec2 position = agentState.xy;
        
        // Read agent properties from texture
        vec4 properties = texture2D(u_agentPropertiesTexture, texCoord);
        float brightness = properties.w;
        float isFrontier = properties.z;
        
        // Skip inactive agents
        if (length(position) < 1.0 || properties.y < 1.0) {
          gl_Position = vec4(-10.0, -10.0, 0.0, 1.0); // Off-screen
          gl_PointSize = 0.0;
          v_brightness = 0.0;
          v_isFrontier = 0.0;
          return;
        }
        
        // Convert to clip space
        vec2 clipPos = (position / u_canvasSize) * 2.0 - 1.0;
        gl_Position = vec4(clipPos, 0.0, 1.0);
        
        // Frontier agents are larger and brighter
        gl_PointSize = isFrontier > 0.5 ? 6.0 : 3.0;
        
        // Pass properties to fragment shader
        v_brightness = brightness;
        v_isFrontier = isFrontier;
      }
    `;

    const agentRenderFragmentSource = `
      precision mediump float;
      varying float v_brightness;
      varying float v_isFrontier;
      
      void main() {
        // Frontier agents are bright white/yellow, Ecosystem agents are dim
        if (v_isFrontier > 0.5) {
          // Frontier agents - bright and prominent
          gl_FragColor = vec4(1.0, 0.9, 0.6, v_brightness);
        } else {
          // Ecosystem agents - dim and subtle
          gl_FragColor = vec4(0.7, 0.7, 0.9, v_brightness * 0.6);
        }
      }
    `;

    // Create shader programs
    this.agentUpdateShader = new Shader(gl, quadVertexSource, agentUpdateFragmentSource);
    this.agentPropertiesShader = new Shader(gl, quadVertexSource, agentPropertiesFragmentSource);
    this.agentRenderShader = new Shader(gl, agentRenderVertexSource, agentRenderFragmentSource);

    // Get uniform locations for agent update (GPGPU brain)
    this.agentUpdateUniforms = {
      uAgentStateTexture: this.agentUpdateShader.getUniformLocation('u_agentStateTexture'),
      uAgentPropertiesTexture: this.agentUpdateShader.getUniformLocation('u_agentPropertiesTexture'),
      uTrailTexture: this.agentUpdateShader.getUniformLocation('u_trailTexture'),
      uCanvasSize: this.agentUpdateShader.getUniformLocation('u_canvasSize'),
      uAgentTextureSize: this.agentUpdateShader.getUniformLocation('u_agentTextureSize'),
      uDeltaTime: this.agentUpdateShader.getUniformLocation('u_deltaTime'),
      uAgentSpeed: this.agentUpdateShader.getUniformLocation('u_agentSpeed'),
      uSensorDistance: this.agentUpdateShader.getUniformLocation('u_sensorDistance'),
      uSensorAngle: this.agentUpdateShader.getUniformLocation('u_sensorAngle'),
      uTurnStrength: this.agentUpdateShader.getUniformLocation('u_turnStrength')
    };

    // Get uniform locations for agent properties update
    this.agentPropertiesUniforms = {
      uAgentPropertiesTexture: this.agentPropertiesShader.getUniformLocation('u_agentPropertiesTexture'),
      uDeltaTime: this.agentPropertiesShader.getUniformLocation('u_deltaTime')
    };

    // Get uniform locations for agent rendering
    this.agentRenderUniforms = {
      uAgentStateTexture: this.agentRenderShader.getUniformLocation('u_agentStateTexture'),
      uAgentPropertiesTexture: this.agentRenderShader.getUniformLocation('u_agentPropertiesTexture'),
      uAgentTextureSize: this.agentRenderShader.getUniformLocation('u_agentTextureSize'),
      uCanvasSize: this.agentRenderShader.getUniformLocation('u_canvasSize')
    };
  }

  private createAgentGrid(): void {
    const gl = this.gl;
    
    // Create a buffer with indices for each potential agent
    // This is used by the agent rendering vertex shader
    const agentIndices = new Float32Array(this.maxAgents);
    for (let i = 0; i < this.maxAgents; i++) {
      agentIndices[i] = i;
    }

    this.agentGridBuffer = createBuffer(gl, agentIndices);
    
    console.log(`✅ Agent grid buffer created for ${this.maxAgents} agents`);
  }

  // Method to spawn agents directly into GPU textures
  public spawnAgents(agentData: AgentSpawnData[]): void {
    const gl = this.gl;
    
    console.log(`🧠 Spawning ${agentData.length} agents into GPU state`);
    
    // Create Float32Array for agent state data and properties data
    const stateData = new Float32Array(this.agentTextureSize * this.agentTextureSize * 4);
    const propertiesData = new Float32Array(this.agentTextureSize * this.agentTextureSize * 4);
    
    // Fill in the agent data (up to maxAgents)
    const agentsToSpawn = Math.min(agentData.length, this.maxAgents);
    for (let i = 0; i < agentsToSpawn; i++) {
      const agent = agentData[i];
      const baseIndex = i * 4;
      
      // Store agent state: (posX, posY, velX, velY)
      stateData[baseIndex + 0] = agent.x;
      stateData[baseIndex + 1] = agent.y;
      stateData[baseIndex + 2] = agent.vx;
      stateData[baseIndex + 3] = agent.vy;
      
      // Store agent properties: (age, maxAge, isFrontier, brightness)
      propertiesData[baseIndex + 0] = agent.age;
      propertiesData[baseIndex + 1] = agent.maxAge;
      propertiesData[baseIndex + 2] = agent.isFrontier ? 1.0 : 0.0;
      propertiesData[baseIndex + 3] = agent.brightness;
      
      // Create CPU mirror for Frontier agents (for label rendering)
      if (agent.isFrontier && agent.label && agent.sourceClusterId !== undefined && agent.targetClusterId !== undefined) {
        this.frontierAgentMirrors.set(i, {
          id: i, // GPU texture index
          x: agent.x,
          y: agent.y,
          age: agent.age,
          maxAge: agent.maxAge,
          sourceClusterId: agent.sourceClusterId,
          targetClusterId: agent.targetClusterId,
          label: agent.label,
          isActive: true
        });
      }
    }
    
    // Upload initial state to both state textures
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[i]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.agentTextureSize, this.agentTextureSize, gl.RGBA, gl.FLOAT, stateData);
    }
    
    // Upload initial properties to both properties textures
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[i]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.agentTextureSize, this.agentTextureSize, gl.RGBA, gl.FLOAT, propertiesData);
    }
    
    this.activeAgentCount = agentsToSpawn;
    console.log(`✅ ${agentsToSpawn} agents loaded into GPU state textures`);
  }

  // GPGPU agent update - processes agent logic entirely on GPU
  public update(trailTexture: WebGLTexture): void {
    const gl = this.gl;
    const destinationIndex = 1 - this.currentAgentSourceIndex;
    
    // Update agent state (positions and velocities)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.agentTextureSize, this.agentTextureSize);
    
    this.agentUpdateShader.use();
    
    // Bind current agent state as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentUpdateUniforms.uAgentStateTexture!, 0);
    
    // Bind current agent properties for reference
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentUpdateUniforms.uAgentPropertiesTexture!, 1);
    
    // Bind trail texture for sensing
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.uniform1i(this.agentUpdateUniforms.uTrailTexture!, 2);
    
    // Set uniforms for agent behavior
    gl.uniform2f(this.agentUpdateUniforms.uCanvasSize!, this.width, this.height);
    gl.uniform1f(this.agentUpdateUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform1f(this.agentUpdateUniforms.uDeltaTime!, 1.0);
    gl.uniform1f(this.agentUpdateUniforms.uAgentSpeed!, 2.0);
    gl.uniform1f(this.agentUpdateUniforms.uSensorDistance!, 15.0);
    gl.uniform1f(this.agentUpdateUniforms.uSensorAngle!, Math.PI / 4);
    gl.uniform1f(this.agentUpdateUniforms.uTurnStrength!, 0.1);
    
    // Process agent state update
    this.drawQuad();
    
    // Update agent properties (age, death, hierarchy)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentPropertiesFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.agentTextureSize, this.agentTextureSize);
    
    this.agentPropertiesShader.use();
    
    // Bind current agent properties as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentPropertiesUniforms.uAgentPropertiesTexture!, 0);
    
    gl.uniform1f(this.agentPropertiesUniforms.uDeltaTime!, 1.0);
    
    // Process agent properties update
    this.drawQuad();
    
    // Swap buffers
    this.currentAgentSourceIndex = destinationIndex as 0 | 1;
  }

  private drawQuad(): void {
    const gl = this.gl;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuadBuffer);
    
    // Get position attribute for currently bound program
    const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    const positionLocation = gl.getAttribLocation(currentProgram, 'a_position');
    
    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // GPU Agent Rendering - renders all agents in a single drawArrays call
  public renderToCanvas(): void {
    const gl = this.gl;
    
    // Render agents on main canvas
    this.agentRenderShader.use();
    
    // Bind current agent state texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentRenderUniforms.uAgentStateTexture!, 0);
    
    // Bind current agent properties texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentRenderUniforms.uAgentPropertiesTexture!, 1);
    
    // Set uniforms
    gl.uniform1f(this.agentRenderUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform2f(this.agentRenderUniforms.uCanvasSize!, this.width, this.height);
    
    // Bind agent index buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.agentGridBuffer);
    const agentIndexLocation = this.agentRenderShader.getAttribLocation('a_agentIndex');
    if (agentIndexLocation >= 0) {
      gl.enableVertexAttribArray(agentIndexLocation);
      gl.vertexAttribPointer(agentIndexLocation, 1, gl.FLOAT, false, 0, 0);
    }
    
    // Enable blending for agent rendering
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    
    // Render all active agents as points in a single draw call
    gl.drawArrays(gl.POINTS, 0, this.activeAgentCount);
    
    gl.disable(gl.BLEND);
    if (agentIndexLocation >= 0) {
      gl.disableVertexAttribArray(agentIndexLocation);
    }
  }

  public getAgentStateTexture(): WebGLTexture {
    return this.agentStateTextures[this.currentAgentSourceIndex];
  }

  public getAgentTextureSize(): number {
    return this.agentTextureSize;
  }

  public getActiveAgentCount(): number {
    return this.activeAgentCount;
  }

  public getMaxAgents(): number {
    return this.maxAgents;
  }

  public getFrontierAgentMirrors(): FrontierAgentMirror[] {
    return Array.from(this.frontierAgentMirrors.values()).filter(mirror => mirror.isActive);
  }

  // Update CPU mirrors with current GPU data (simplified - in a real implementation, 
  // we'd need to read back from GPU textures, but that's expensive)
  // For now, we'll update positions based on velocity and time
  public updateFrontierMirrors(): void {
    for (const [index, mirror] of this.frontierAgentMirrors) {
      if (!mirror.isActive) continue;
      
      // Simple aging simulation (matching the GPU shader logic)
      mirror.age += 1.0;
      
      // Remove dead agents
      if (mirror.age > mirror.maxAge) {
        mirror.isActive = false;
        this.frontierAgentMirrors.delete(index);
      }
      
      // TODO: In a more sophisticated implementation, we would:
      // 1. Use transform feedback or compute shaders to read GPU state
      // 2. Or use gl.readPixels periodically (expensive) to sync positions
      // For now, agents maintain their spawn positions for label rendering
    }
  }

  public dispose(): void {
    const gl = this.gl;
    
    // Cleanup agent state buffers
    for (const texture of this.agentStateTextures) {
      gl.deleteTexture(texture);
    }
    
    for (const framebuffer of this.agentStateFramebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    
    // Cleanup agent properties buffers
    for (const texture of this.agentPropertiesTextures) {
      gl.deleteTexture(texture);
    }
    
    for (const framebuffer of this.agentPropertiesFramebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    
    // Delete shader programs
    this.agentUpdateShader.dispose();
    this.agentPropertiesShader.dispose();
    this.agentRenderShader.dispose();
    
    // Delete buffers
    if (this.screenQuadBuffer) gl.deleteBuffer(this.screenQuadBuffer);
    if (this.agentGridBuffer) gl.deleteBuffer(this.agentGridBuffer);
    
    console.log('✅ GPUSystem disposed');
  }
}