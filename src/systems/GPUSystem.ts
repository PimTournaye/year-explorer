import type { AgentSpawnData, FrontierAgentMirror, ClusterInfo } from '../data/interfaces';
import { Shader } from '../rendering/Shader';
import { createFloatTexture, createFramebuffer, createScreenQuad, createBuffer } from '../rendering/utils';

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

  public frontierArrivals: { x: number, y: number }[] = [];

  // GPU Agent Textures (Simplified to 2 sets)
  private agentStateTextures: WebGLTexture[] = [];      // Ping-pong for (posX, posY, velX, velY)
  private agentStateFramebuffers: WebGLFramebuffer[] = [];
  private agentPropertiesTextures: WebGLTexture[] = []; // Ping-pong for (age, maxAge, isFrontier, clusterHue)
  private agentPropertiesFramebuffers: WebGLFramebuffer[] = [];

  private currentAgentSourceIndex: 0 | 1 = 0;
  private agentTextureSize: number;
  private maxAgents: number;

  // Agent Pool Management
  private availableAgentSlots: number[] = [];
  private activeAgents: Map<number, { age: number; maxAge: number }> = new Map();

  // CPU Mirror for UI
  private frontierAgentMirrors: Map<number, FrontierAgentMirror> = new Map();
  private deadFrontierAgents: FrontierAgentMirror[] = [];

  // Shaders
  private agentUpdateShader: Shader;
  private agentPropertiesShader: Shader;
  private agentRenderShader: Shader;

  // Buffers
  private screenQuadBuffer: WebGLBuffer;
  private agentGridBuffer: WebGLBuffer;

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
    uAgentStateTexture: WebGLUniformLocation | null; // For arrival check
    uDeltaTime: WebGLUniformLocation | null;
  };

  // Uniforms for agent rendering
  private agentRenderUniforms!: {
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
  };

  constructor(gl: WebGL2RenderingContext, width: number, height: number, maxAgents: number = 1024) {
    this.gl = gl;
    this.width = width;
    this.height = height;

    this.agentTextureSize = Math.ceil(Math.sqrt(maxAgents));
    this.maxAgents = this.agentTextureSize * this.agentTextureSize;

    this.initializeBuffers();
    this.agentUpdateShader = new Shader(gl, quadVertexSource, agentUpdateFragmentSource);
    this.agentPropertiesShader = new Shader(gl, quadVertexSource, agentPropertiesFragmentSource);
    this.agentRenderShader = new Shader(gl, agentRenderVertexSource, agentRenderFragmentSource);

    this.initializeShaders();

    this.screenQuadBuffer = createScreenQuad(gl);
    this.agentGridBuffer = this.createAgentGrid();

    // Initialize the agent pool
    for (let i = 0; i < this.maxAgents; i++) {
      this.availableAgentSlots.push(i);
    }
  }

  private initializeBuffers(): void {
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      const stateTex = createFloatTexture(gl, this.agentTextureSize, this.agentTextureSize);
      this.agentStateTextures.push(stateTex);
      this.agentStateFramebuffers.push(createFramebuffer(gl, stateTex));

      const propTex = createFloatTexture(gl, this.agentTextureSize, this.agentTextureSize);
      this.agentPropertiesTextures.push(propTex);
      this.agentPropertiesFramebuffers.push(createFramebuffer(gl, propTex));
    }

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
      uAgentStateTexture: this.agentPropertiesShader.getUniformLocation('u_agentStateTexture'),
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

  private createAgentGrid(): WebGLBuffer {
    const indices = new Float32Array(this.maxAgents);
    for (let i = 0; i < this.maxAgents; i++) indices[i] = i;
    return createBuffer(this.gl, indices);
  }

  // Method to spawn agents directly into GPU textures  
  public spawnAgents(agentData: AgentSpawnData[]): void {
    const gl = this.gl;
    
    for (const data of agentData) {
      if (this.availableAgentSlots.length === 0) {
        console.warn(`No available agent slots.`);
        break; // Stop trying to spawn if pool is empty
      }
      const agentIndex = this.availableAgentSlots.pop()!;
      this.activeAgents.set(agentIndex, { age: data.age, maxAge: Math.round(data.maxAge) });

      const x = agentIndex % this.agentTextureSize;
      const y = Math.floor(agentIndex / this.agentTextureSize);

      const stateData = new Float32Array([data.x, data.y, data.vx, data.vy]);
      const propData = new Float32Array([
        data.age,
        data.maxAge,
        data.isFrontier ? 1.0 : 0.0,
        data.brightness
      ]);

      for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.FLOAT, stateData);

        gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.FLOAT, propData);
      }

      if (data.isFrontier) {
        this.frontierAgentMirrors.set(agentIndex, {
          id: agentIndex, x: data.x, y: data.y, vx: data.vx, vy: data.vy,
          age: data.age, maxAge: data.maxAge,
          sourceClusterId: data.sourceClusterId!, targetClusterId: data.targetClusterId!,
          directive_verb: data.directive_verb!, directive_noun: data.directive_noun!,
          projectTitle: data.projectTitle!,
          sourceClusterName: data.sourceClusterName!,
          sourceClusterColor: data.sourceClusterColor!,
          isActive: true,
          targetX: data.targetClusterX,
          targetY: data.targetClusterY
        });
      }
    }
  }

  private killAgentsOnGPU(indices: number[]): void {
    const gl = this.gl;
    const empty = new Float32Array(4); // All zeros
    for (const index of indices) {
      const x = index % this.agentTextureSize;
      const y = Math.floor(index / this.agentTextureSize);
      for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.FLOAT, empty);
        gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.FLOAT, empty);
      }
    }
  }

  // GPGPU agent update - processes agent logic entirely on GPU
  public update(trailTexture: WebGLTexture): void {
    const deadAgentIndices: number[] = [];
    for (const [index, agent] of this.activeAgents.entries()) {
      agent.age++;
      
      // Check the mirror's status. If it's been flagged as inactive, the agent dies.
      const mirror = this.frontierAgentMirrors.get(index);
      const hasArrived = mirror ? !mirror.isActive : false;
      
      if (this.frontierAgentMirrors.has(index)) {
        this.frontierAgentMirrors.get(index)!.age = agent.age;
      }
      
      if (agent.age > agent.maxAge || hasArrived) {
        deadAgentIndices.push(index);
      }
    }
    if (deadAgentIndices.length > 0) {
      this.killAgentsOnGPU(deadAgentIndices);
      for (const index of deadAgentIndices) {
        if (this.frontierAgentMirrors.has(index)) {
          this.deadFrontierAgents.push(this.frontierAgentMirrors.get(index)!);
        }
        this.activeAgents.delete(index);
        this.availableAgentSlots.push(index);
        this.frontierAgentMirrors.delete(index);
      }
    }


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
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.uniform1i(this.agentUpdateUniforms.uTrailTexture!, 3);

    // Set uniforms for agent behavior (slower for contemplative pacing)
    gl.uniform2f(this.agentUpdateUniforms.uCanvasSize!, this.width, this.height);
    gl.uniform1f(this.agentUpdateUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform1f(this.agentUpdateUniforms.uDeltaTime!, 0.5); // Much slower simulation
    gl.uniform1f(this.agentUpdateUniforms.uAgentSpeed!, 1); // Much slower movement
    gl.uniform1f(this.agentUpdateUniforms.uSensorDistance!, 15.0);
    gl.uniform1f(this.agentUpdateUniforms.uSensorAngle!, Math.PI / 3);
    gl.uniform1f(this.agentUpdateUniforms.uTurnStrength!, 0.1); // Effective organic steering

    // Process agent state update
    this.drawQuad(this.agentUpdateShader);

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

    gl.uniform1f(this.agentPropertiesUniforms.uDeltaTime!, 0.3); // Match slower simulation

    // Process agent properties update
    this.drawQuad(this.agentPropertiesShader);

    // Swap buffers
    this.currentAgentSourceIndex = destinationIndex as 0 | 1;
  }

  private drawQuad(shader: Shader): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuadBuffer);

    // Get the attribute location from the SPECIFIC shader program passed in
    const positionLocation = shader.getAttribLocation('a_position');

    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Good practice: disable the attribute array after drawing
    if (positionLocation >= 0) {
      gl.disableVertexAttribArray(positionLocation);
    }
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
    gl.drawArrays(gl.POINTS, 0, this.maxAgents);

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

  public getAgentTextureSize(): number {
    return this.agentTextureSize;
  }

  public getActiveAgentCount(): number {
    return this.activeAgents.size;
  }

  public getMaxAgents(): number {
    return this.maxAgents;
  }

  public getFrontierAgentMirrors(): FrontierAgentMirror[] {
    return Array.from(this.frontierAgentMirrors.values()).filter(mirror => mirror.isActive);
  }

  public getDeadFrontierAgents(): FrontierAgentMirror[] {
    const deadAgents = [...this.deadFrontierAgents];
    this.deadFrontierAgents = [];
    return deadAgents;
  }

  // Sync CPU mirrors with current GPU agent positions
  private syncMirrorsWithGPU(): void {
    const gl = this.gl;
    const textureSize = this.agentTextureSize;
    
    // Create a pixel array to read GPU data
    const pixels = new Float32Array(textureSize * textureSize * 4);
    
    // Bind the current agent state texture for reading
    const currentStateFramebuffer = this.agentStateFramebuffers[this.currentAgentSourceIndex];
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, currentStateFramebuffer);
    gl.readPixels(0, 0, textureSize, textureSize, gl.RGBA, gl.FLOAT, pixels);
    
    // Also read agent properties for age data
    const propPixels = new Float32Array(textureSize * textureSize * 4);
    const currentPropFramebuffer = this.agentPropertiesFramebuffers[this.currentAgentSourceIndex];
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, currentPropFramebuffer);
    gl.readPixels(0, 0, textureSize, textureSize, gl.RGBA, gl.FLOAT, propPixels);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    
    // Update mirrors with GPU data
    for (const mirror of this.frontierAgentMirrors.values()) {
      if (!mirror.isActive) continue;
      
      // Calculate texture coordinates for this agent
      const y = Math.floor(mirror.id / textureSize);
      const x = mirror.id % textureSize;
      const pixelIndex = (y * textureSize + x) * 4;
      
      // Update position from state texture (x, y, vx, vy)
      mirror.x = pixels[pixelIndex];
      mirror.y = pixels[pixelIndex + 1];
      mirror.vx = pixels[pixelIndex + 2];
      mirror.vy = pixels[pixelIndex + 3];
      
      // Update age from properties texture (age, maxAge, isFrontier, clusterHue)
      mirror.age = propPixels[pixelIndex];
    }
  }

  // Update CPU mirrors with current GPU data
  // This is the public method called by app.ts every frame
  public updateFrontierMirrors(clusterCentroids: Map<number, ClusterInfo>): void {
    this.frontierArrivals = []; // Clear last frame's arrivals

    //@ts-ignore
    let some = clusterCentroids.get(0); // this is to get a warning message out of the way for unused variable

    // First, sync CPU mirrors with GPU agent data
    this.syncMirrorsWithGPU();

    const GRACE_PERIOD_FRAMES = 5;

    for (const mirror of this.frontierAgentMirrors.values()) {
      // If the agent is already marked as inactive, skip it.
      if (!mirror.isActive) continue;

      // Check for arrival 
      const distToTarget = Math.hypot(mirror.x - mirror.targetX, mirror.y - mirror.targetY);
      
      // DEBUGGING: Monitor the first Frontier agent's progress (reduced frequency)
      if (mirror.id === Array.from(this.frontierAgentMirrors.keys())[0] && mirror.age % 60 === 0) {
        console.log(`Agent ${mirror.id}: Dist to Target: ${distToTarget.toFixed(2)}, Age: ${mirror.age}, Max Age: ${mirror.maxAge}`);
        
        // Additional debug: Check if agent is about to die without reaching target
        if (mirror.age > mirror.maxAge - 60 && distToTarget > 10.0) {
          console.warn(`⚠️ Agent ${mirror.id} will die soon (age: ${mirror.age}/${mirror.maxAge}) but is still ${distToTarget.toFixed(2)} units from target!`);
        }
      }
      
      // If the mirror has arrived, add it to the arrivals list for the ping effect.
      // The GPU will kill the agent, and the main GC loop will delete the mirror.
      if (distToTarget < 15.0 && mirror.age > GRACE_PERIOD_FRAMES) {
        console.log(`🎯 Frontier Agent ${mirror.id} arrived! "${mirror.directive_verb} ${mirror.directive_noun}" from ${mirror.sourceClusterName} → Target reached at (${mirror.targetX.toFixed(1)}, ${mirror.targetY.toFixed(1)})`);
        this.frontierArrivals.push({ x: mirror.targetX, y: mirror.targetY });
        mirror.isActive = false; // Flag it for deletion.
      }
    }
  }

  public reset(): void {
    // Clear all active agents
    this.activeAgents.clear();
    this.frontierAgentMirrors.clear();
    this.deadFrontierAgents = [];
    this.frontierArrivals = [];

    // Reset the agent pool - make all slots available
    this.availableAgentSlots = [];
    for (let i = 0; i < this.maxAgents; i++) {
      this.availableAgentSlots.push(i);
    }

    // Reset ping-pong index
    this.currentAgentSourceIndex = 0;

    // Clear all agent state textures by rendering empty data
    const gl = this.gl;
    const emptyData = new Float32Array(this.agentTextureSize * this.agentTextureSize * 4);
    
    for (let i = 0; i < this.agentStateTextures.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[i]);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        this.agentTextureSize, this.agentTextureSize, 0,
        gl.RGBA, gl.FLOAT, emptyData
      );
    }

    for (let i = 0; i < this.agentPropertiesTextures.length; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.agentPropertiesTextures[i]);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        this.agentTextureSize, this.agentTextureSize, 0,
        gl.RGBA, gl.FLOAT, emptyData
      );
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    console.log('🔄 GPUSystem reset completed');
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