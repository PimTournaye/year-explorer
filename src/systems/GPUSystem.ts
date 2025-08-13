import type { AgentSpawnData, CrossClusterActivity } from '../data/interfaces';
import { Shader } from '../rendering/Shader';
import { createFloatTexture, createFramebuffer, createScreenQuad, createBuffer } from '../rendering/utils';

export class GPUSystem {
  private gl: WebGLRenderingContext;
  private width: number;
  private height: number;

  // GPU Agent State System - stores agent data in floating point textures  
  private agentStateTextures: WebGLTexture[] = [];
  private agentStateFramebuffers: WebGLFramebuffer[] = [];
  private currentAgentSourceIndex: 0 | 1 = 0;
  private agentTextureSize: number = 0; // Square texture size (e.g., 32x32 = 1024 agents)
  private maxAgents: number = 0;
  private activeAgentCount: number = 0;

  // Shader programs
  private agentUpdateShader: Shader; // GPGPU brain shader
  private agentRenderShader: Shader; // GPU agent rendering

  // Buffers
  private screenQuadBuffer: WebGLBuffer;
  private agentGridBuffer: WebGLBuffer;

  // Uniforms for GPGPU agent update shader
  private agentUpdateUniforms: {
    uAgentStateTexture: WebGLUniformLocation | null;
    uTrailTexture: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uDeltaTime: WebGLUniformLocation | null;
    uAgentSpeed: WebGLUniformLocation | null;
    uSensorDistance: WebGLUniformLocation | null;
    uSensorAngle: WebGLUniformLocation | null;
    uTurnStrength: WebGLUniformLocation | null;
  };

  // Uniforms for agent rendering
  private agentRenderUniforms: {
    uAgentStateTexture: WebGLUniformLocation | null;
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
      const texture = createFloatTexture(gl, this.agentTextureSize, this.agentTextureSize);
      this.agentStateTextures.push(texture);

      // Create framebuffer for agent state
      const framebuffer = createFramebuffer(gl, texture);
      this.agentStateFramebuffers.push(framebuffer);
    }

    // Initialize agent state textures with zeros (no agents)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[0]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

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

    // Agent rendering vertex shader (renders agents from GPU state)
    const agentRenderVertexSource = `
      attribute float a_agentIndex;
      uniform sampler2D u_agentStateTexture;
      uniform float u_agentTextureSize;
      uniform vec2 u_canvasSize;
      
      void main() {
        // Convert agent index to texture coordinates
        float x = mod(a_agentIndex, u_agentTextureSize);
        float y = floor(a_agentIndex / u_agentTextureSize);
        vec2 texCoord = (vec2(x, y) + 0.5) / u_agentTextureSize;
        
        // Read agent state from texture
        vec4 agentState = texture2D(u_agentStateTexture, texCoord);
        vec2 position = agentState.xy;
        
        // Convert to clip space
        vec2 clipPos = (position / u_canvasSize) * 2.0 - 1.0;
        gl_Position = vec4(clipPos, 0.0, 1.0);
        gl_PointSize = 4.0;
      }
    `;

    const agentRenderFragmentSource = `
      precision mediump float;
      
      void main() {
        // Simple white agents for now
        gl_FragColor = vec4(1.0, 1.0, 1.0, 0.8);
      }
    `;

    // Create shader programs
    this.agentUpdateShader = new Shader(gl, quadVertexSource, agentUpdateFragmentSource);
    this.agentRenderShader = new Shader(gl, agentRenderVertexSource, agentRenderFragmentSource);

    // Get uniform locations for agent update (GPGPU brain)
    this.agentUpdateUniforms = {
      uAgentStateTexture: this.agentUpdateShader.getUniformLocation('u_agentStateTexture'),
      uTrailTexture: this.agentUpdateShader.getUniformLocation('u_trailTexture'),
      uCanvasSize: this.agentUpdateShader.getUniformLocation('u_canvasSize'),
      uAgentTextureSize: this.agentUpdateShader.getUniformLocation('u_agentTextureSize'),
      uDeltaTime: this.agentUpdateShader.getUniformLocation('u_deltaTime'),
      uAgentSpeed: this.agentUpdateShader.getUniformLocation('u_agentSpeed'),
      uSensorDistance: this.agentUpdateShader.getUniformLocation('u_sensorDistance'),
      uSensorAngle: this.agentUpdateShader.getUniformLocation('u_sensorAngle'),
      uTurnStrength: this.agentUpdateShader.getUniformLocation('u_turnStrength')
    };

    // Get uniform locations for agent rendering
    this.agentRenderUniforms = {
      uAgentStateTexture: this.agentRenderShader.getUniformLocation('u_agentStateTexture'),
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
    
    // Create Float32Array for agent state data
    const stateData = new Float32Array(this.agentTextureSize * this.agentTextureSize * 4);
    
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
    }
    
    // Upload initial state to both textures
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[i]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.agentTextureSize, this.agentTextureSize, gl.RGBA, gl.FLOAT, stateData);
    }
    
    this.activeAgentCount = agentsToSpawn;
    console.log(`✅ ${agentsToSpawn} agents loaded into GPU state textures`);
  }

  // GPGPU agent update - processes agent logic entirely on GPU
  public update(trailTexture: WebGLTexture): void {
    const gl = this.gl;
    
    // Ping-pong to next agent state texture
    const destinationIndex = 1 - this.currentAgentSourceIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.agentTextureSize, this.agentTextureSize);
    
    this.agentUpdateShader.use();
    
    // Bind current agent state as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentUpdateUniforms.uAgentStateTexture!, 0);
    
    // Bind trail texture for sensing
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.uniform1i(this.agentUpdateUniforms.uTrailTexture!, 1);
    
    // Set uniforms for agent behavior
    gl.uniform2f(this.agentUpdateUniforms.uCanvasSize!, this.width, this.height);
    gl.uniform1f(this.agentUpdateUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform1f(this.agentUpdateUniforms.uDeltaTime!, 1.0);
    gl.uniform1f(this.agentUpdateUniforms.uAgentSpeed!, 2.0);
    gl.uniform1f(this.agentUpdateUniforms.uSensorDistance!, 15.0);
    gl.uniform1f(this.agentUpdateUniforms.uSensorAngle!, Math.PI / 4);
    gl.uniform1f(this.agentUpdateUniforms.uTurnStrength!, 0.1);
    
    // Process all agents in parallel
    this.drawQuad();
    
    // Swap agent state buffers
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

  public dispose(): void {
    const gl = this.gl;
    
    // Cleanup agent state buffers
    for (const texture of this.agentStateTextures) {
      gl.deleteTexture(texture);
    }
    
    for (const framebuffer of this.agentStateFramebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    
    // Delete shader programs
    this.agentUpdateShader.dispose();
    this.agentRenderShader.dispose();
    
    // Delete buffers
    if (this.screenQuadBuffer) gl.deleteBuffer(this.screenQuadBuffer);
    if (this.agentGridBuffer) gl.deleteBuffer(this.agentGridBuffer);
    
    console.log('✅ GPUSystem disposed');
  }
}