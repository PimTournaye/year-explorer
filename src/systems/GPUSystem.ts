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
      this.activeAgents.set(agentIndex, { age: data.age, maxAge: data.maxAge });

      const x = agentIndex % this.agentTextureSize;
      const y = Math.floor(agentIndex / this.agentTextureSize);

      const stateData = new Float32Array([data.x, data.y, data.vx, data.vy]);
      const propData = new Float32Array([data.age, data.maxAge, data.isFrontier ? 1.0 : 0.0, data.clusterHue]);

      // Update both sets of textures to ensure ping-pong works correctly
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
          isActive: true
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
      if (agent.age > agent.maxAge) {
        deadAgentIndices.push(index);
      }
    }
    if (deadAgentIndices.length > 0) {
      this.killAgentsOnGPU(deadAgentIndices);
      for (const index of deadAgentIndices) {
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

  // Update CPU mirrors with current GPU data
  // This is the public method called by app.ts every frame
  public updateFrontierMirrors(clusterCentroids: Map<number, ClusterInfo>): void {
    // We've already handled dead agent cleanup in the main update method,
    // so we only need to move the living ones.
    this.updateMirrorMovement(clusterCentroids);
  }

  // This is the private helper that contains the actual physics
  private updateMirrorMovement(clusterCentroids: Map<number, ClusterInfo>): void {
    const DAMPING = 0.95;
    const TARGET_ATTRACTION = 0.002;

    for (const mirror of this.frontierAgentMirrors.values()) {
      // The main update() method now handles aging and killing,
      // so we only need to focus on movement here.

      const target = clusterCentroids.get(mirror.targetClusterId);
      if (target) {
        const dx = target.centerX - mirror.x;
        const dy = target.centerY - mirror.y;

        mirror.vx += dx * TARGET_ATTRACTION;
        mirror.vy += dy * TARGET_ATTRACTION;
      }

      mirror.vx *= DAMPING;
      mirror.vy *= DAMPING;

      mirror.x += mirror.vx;
      mirror.y += mirror.vy;
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