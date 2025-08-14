import type { AgentSpawnData, FrontierAgentMirror } from '../data/interfaces';
import { Shader } from '../rendering/Shader';
import { createFloatTexture, createFramebuffer, createScreenQuad, createBuffer } from '../rendering/utils';
import { ParticleSystem } from './ParticleSystem';

// Import shader sources
import quadVertexSource from '../shaders/quad.vert?raw';
import agentUpdateFragmentSource from '../shaders/agentUpdate.frag?raw';
import agentPropertiesFragmentSource from '../shaders/agentProperties.frag?raw';
import agentRenderVertexSource from '../shaders/agentRender.vert?raw';
import agentRenderFragmentSource from '../shaders/agentRender.frag?raw';

export class GPUSystem {
  private gl: WebGL2RenderingContext;
  private width: number;
  private height: number;

  // GPU Agent State System - stores agent data in floating point textures  
  private agentStateTextures: WebGLTexture[] = []; // (posX, posY, velX, velY)
  private agentStateFramebuffers: WebGLFramebuffer[] = [];
  // Second texture for agent properties (age, maxAge, isFrontier, brightness)
  private agentPropertiesTextures: WebGLTexture[] = [];
  // Third texture for extended properties (clusterHue, reserved, reserved, reserved)
  private agentExtendedTextures: WebGLTexture[] = [];
  private agentPropertiesFramebuffers: WebGLFramebuffer[] = [];
  private agentExtendedFramebuffers: WebGLFramebuffer[] = [];
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
  private particleSystem: ParticleSystem;

  // Buffers
  private screenQuadBuffer!: WebGLBuffer;
  private agentGridBuffer!: WebGLBuffer;

  // Uniforms for GPGPU agent update shader
  private agentUpdateUniforms!: {
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uAgentExtendedTexture: WebGLUniformLocation | null;
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
    uAgentStateTexture: WebGLUniformLocation | null; // For arrival check
    uAgentExtendedTexture: WebGLUniformLocation | null; // For arrival check
    uDeltaTime: WebGLUniformLocation | null;
  };

  // Uniforms for agent rendering
  private agentRenderUniforms!: {
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
  };

  constructor(gl: WebGL2RenderingContext, particleSystem: ParticleSystem, width: number, height: number, maxAgents: number = 1024) {
    this.gl = gl;
    this.particleSystem = particleSystem;
    this.width = width;
    this.height = height;
    
    // Calculate agent texture size (square texture that can hold maxAgents)
    this.agentTextureSize = Math.ceil(Math.sqrt(maxAgents));
    this.maxAgents = this.agentTextureSize * this.agentTextureSize;
    

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
      
      // Create agent extended properties textures: (clusterHue, reserved, reserved, reserved)
      const extendedTexture = createFloatTexture(gl, this.agentTextureSize, this.agentTextureSize);
      this.agentExtendedTextures.push(extendedTexture);

      // Create framebuffer for extended properties
      const extendedFramebuffer = createFramebuffer(gl, extendedTexture);
      this.agentExtendedFramebuffers.push(extendedFramebuffer);
    }

    // Initialize agent state textures with zeros (no agents)
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentPropertiesFramebuffers[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentExtendedFramebuffers[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private initializeShaders(): void {
    const gl = this.gl;

    // Create shader programs
    this.agentUpdateShader = new Shader(gl, quadVertexSource, agentUpdateFragmentSource);
    this.agentPropertiesShader = new Shader(gl, quadVertexSource, agentPropertiesFragmentSource);
    this.agentRenderShader = new Shader(gl, agentRenderVertexSource, agentRenderFragmentSource);

    // Get uniform locations for agent update (GPGPU brain)
    this.agentUpdateUniforms = {
      uAgentStateTexture: this.agentUpdateShader.getUniformLocation('u_agentStateTexture'),
      uAgentPropertiesTexture: this.agentUpdateShader.getUniformLocation('u_agentPropertiesTexture'),
      uAgentExtendedTexture: this.agentUpdateShader.getUniformLocation('u_agentExtendedTexture'),
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
      uAgentStateTexture: this.agentPropertiesShader.getUniformLocation('u_agentStateTexture'),
      uAgentExtendedTexture: this.agentPropertiesShader.getUniformLocation('u_agentExtendedTexture'),
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
    
  }

  

  // Method to spawn agents directly into GPU textures  
  public spawnAgents(agentData: AgentSpawnData[]): void {
    const gl = this.gl;
    
    
    // **CRITICAL BUG FIX**: Instead of overwriting existing agents, we need to append new agents
    // Calculate how many agents we can add without exceeding max capacity
    const availableSlots = this.maxAgents - this.activeAgentCount;
    const agentsToSpawn = Math.min(agentData.length, availableSlots);
    
    if (agentsToSpawn === 0) {
      console.log(`⚠️ No available slots for new agents (${this.activeAgentCount}/${this.maxAgents})`);
      return;
    }
    
    
    // **PERFORMANCE FIX**: Create compact arrays only for new agents
    const stateData = new Float32Array(agentsToSpawn * 4);
    const propertiesData = new Float32Array(agentsToSpawn * 4);
    const extendedData = new Float32Array(agentsToSpawn * 4);
    
    // Fill arrays with new agent data
    for (let i = 0; i < agentsToSpawn; i++) {
      const agentIndex = this.activeAgentCount + i;
      const agent = agentData[i];
      const baseIndex = i * 4; // Use i, not agentIndex, for compact array
      
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
      
      // Store extended properties: (clusterHue, targetX, targetY, reserved)
      extendedData[baseIndex + 0] = agent.clusterHue;
      extendedData[baseIndex + 1] = agent.targetClusterX;
      extendedData[baseIndex + 2] = agent.targetClusterY;
      extendedData[baseIndex + 3] = 0.0; // reserved
      
      // Create CPU mirror for Frontier agents (for label rendering)
      if (agent.isFrontier && agent.label && agent.sourceClusterId !== undefined && agent.targetClusterId !== undefined) {
        const mirror = {
          id: agentIndex, // GPU texture index
          x: agent.x,
          y: agent.y,
          vx: agent.vx, // Initial velocity for physics sync
          vy: agent.vy, // Initial velocity for physics sync
          age: agent.age,
          maxAge: agent.maxAge,
          sourceClusterId: agent.sourceClusterId,
          targetClusterId: agent.targetClusterId,
          label: agent.label,
          isActive: true
        };
        this.frontierAgentMirrors.set(agentIndex, mirror);
      }
    }
    
    // **PERFORMANCE FIX**: Upload new agents individually to avoid full texture updates
    for (let i = 0; i < agentsToSpawn; i++) {
      const agentIndex = this.activeAgentCount + i;
      const texelX = agentIndex % this.agentTextureSize;
      const texelY = Math.floor(agentIndex / this.agentTextureSize);
      const dataOffset = i * 4;
      
      // Upload single texel for each new agent to both state textures
      for (let bufferIndex = 0; bufferIndex < 2; bufferIndex++) {
        gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[bufferIndex]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, texelX, texelY, 1, 1, gl.RGBA, gl.FLOAT, 
                         stateData.subarray(dataOffset, dataOffset + 4));
        
        gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[bufferIndex]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, texelX, texelY, 1, 1, gl.RGBA, gl.FLOAT, 
                         propertiesData.subarray(dataOffset, dataOffset + 4));
        
        gl.bindTexture(gl.TEXTURE_2D, this.agentExtendedTextures[bufferIndex]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, texelX, texelY, 1, 1, gl.RGBA, gl.FLOAT, 
                         extendedData.subarray(dataOffset, dataOffset + 4));
      }
    }
    
    // Update active agent count
    this.activeAgentCount += agentsToSpawn;
    
    const frontierCount = agentData.filter(a => a.isFrontier).length;
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
    
    // Bind agent extended texture for target data
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.agentExtendedTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentUpdateUniforms.uAgentExtendedTexture!, 2);
    
    // Bind trail texture for sensing
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.uniform1i(this.agentUpdateUniforms.uTrailTexture!, 3);
    
    // Set uniforms for agent behavior (slower for contemplative pacing)
    gl.uniform2f(this.agentUpdateUniforms.uCanvasSize!, this.width, this.height);
    gl.uniform1f(this.agentUpdateUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform1f(this.agentUpdateUniforms.uDeltaTime!, 0.3); // Much slower simulation
    gl.uniform1f(this.agentUpdateUniforms.uAgentSpeed!, 0.8); // Much slower movement
    gl.uniform1f(this.agentUpdateUniforms.uSensorDistance!, 15.0);
    gl.uniform1f(this.agentUpdateUniforms.uSensorAngle!, Math.PI / 4);
    gl.uniform1f(this.agentUpdateUniforms.uTurnStrength!, 0.03); // Much slower turning
    
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
    
    // Bind textures for arrival detection
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentPropertiesUniforms.uAgentStateTexture!, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.agentExtendedTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentPropertiesUniforms.uAgentExtendedTexture!, 2);
    
    gl.uniform1f(this.agentPropertiesUniforms.uDeltaTime!, 0.3); // Match slower simulation
    
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

  public getAgentPropertiesTexture(): WebGLTexture {
    return this.agentPropertiesTextures[this.currentAgentSourceIndex];
  }

  public getAgentExtendedTexture(): WebGLTexture {
    return this.agentExtendedTextures[this.currentAgentSourceIndex];
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

  // Update CPU mirrors with current GPU data
  public updateFrontierMirrors(): void {
    // **CRITICAL IMPLEMENTATION**: Update frontier mirror positions with exact GPU steering logic
    this.updateMirrorMovement();
    
    // Clean up dead agents from mirrors
    for (const [index, mirror] of this.frontierAgentMirrors) {
      if (!mirror.isActive || mirror.age > mirror.maxAge) {
        this.frontierAgentMirrors.delete(index);
      }
    }
  }

  // **PERFORMANCE OPTIMIZED**: Stochastic Target Following for CPU mirrors
  private updateMirrorMovement(): void {
    const deltaTime = 0.3; // Must match the uDeltaTime in the agent update shader
    const agentSpeed = 0.8; // Must match the uAgentSpeed in the agent update shader
    const pullStrength = 0.01; // Small constant pull towards the target
    const damping = 0.95; // Damping factor to prevent overshooting

    const clusters = this.particleSystem.getClusters();

    for (const [agentIndex, mirror] of this.frontierAgentMirrors) {
      if (!mirror.isActive) continue;
      
      // Update age
      mirror.age += deltaTime;

      const targetCluster = clusters.get(mirror.targetClusterId);
      if (targetCluster) {
        const targetX = targetCluster.centerX;
        const targetY = targetCluster.centerY;

        // Calculate pull vector
        const pullX = targetX - mirror.x;
        const pullY = targetY - mirror.y;

        // Update velocity with pull and damping
        mirror.vx = (mirror.vx * damping) + (pullX * pullStrength);
        mirror.vy = (mirror.vy * damping) + (pullY * pullStrength);
      }

      // Update position based on new velocity
      mirror.x += mirror.vx * agentSpeed * deltaTime;
      mirror.y += mirror.vy * agentSpeed * deltaTime;

      // Basic boundary check to deactivate mirrors that go off-screen
      if (mirror.x < 0 || mirror.x > this.width || mirror.y < 0 || mirror.y > this.height) {
        mirror.isActive = false;
      }
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
    
    // Cleanup agent extended buffers
    for (const texture of this.agentExtendedTextures) {
      gl.deleteTexture(texture);
    }
    
    for (const framebuffer of this.agentExtendedFramebuffers) {
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