// Agent data interface for initial spawn data only
export interface AgentSpawnData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetClusterX: number;
  targetClusterY: number;
  age: number;
  maxAge: number;
}

class WebGLTrailProcessor {
  private gl: WebGLRenderingContext;
  private width: number;
  private height: number;

  // Trail system ping-pong buffers
  private trailTextures: WebGLTexture[] = [];
  private trailFramebuffers: WebGLFramebuffer[] = [];
  private currentTrailSourceIndex: 0 | 1 = 0;

  // GPU Agent State System - stores agent data in floating point textures  
  private agentStateTextures: WebGLTexture[] = [];
  private agentStateFramebuffers: WebGLFramebuffer[] = [];
  private currentAgentSourceIndex: 0 | 1 = 0;
  private agentTextureSize: number = 0; // Square texture size (e.g., 32x32 = 1024 agents)
  private maxAgents: number = 0;
  private activeAgentCount: number = 0;

  // Shader programs
  private trailUpdateProgram: WebGLProgram | null = null;
  private agentDepositionProgram: WebGLProgram | null = null;
  private agentUpdateProgram: WebGLProgram | null = null; // GPGPU brain shader
  private agentRenderProgram: WebGLProgram | null = null; // GPU agent rendering
  private trailRenderProgram: WebGLProgram | null = null;

  // A simple quad that covers the screen
  private screenQuadBuffer: WebGLBuffer | null = null;

  // Agent grid buffer for GPU rendering
  private agentGridBuffer: WebGLBuffer | null = null;

  // Uniforms locations for trail system
  private trailUpdateUniforms: {
    uTrailTexture?: WebGLUniformLocation | null;
    uDecayFactor?: WebGLUniformLocation | null;
  } = {};

  private depositionUniforms: {
    uDecayedTrailTexture?: WebGLUniformLocation | null;
    uAgentStateTexture?: WebGLUniformLocation | null;
    uAgentTextureSize?: WebGLUniformLocation | null;
    uActiveAgentCount?: WebGLUniformLocation | null;
    uTrailStrength?: WebGLUniformLocation | null;
    uCanvasSize?: WebGLUniformLocation | null;
  } = {};

  // Uniforms for GPGPU agent update shader
  private agentUpdateUniforms: {
    uAgentStateTexture?: WebGLUniformLocation | null;
    uTrailTexture?: WebGLUniformLocation | null;
    uCanvasSize?: WebGLUniformLocation | null;
    uAgentTextureSize?: WebGLUniformLocation | null;
    uDeltaTime?: WebGLUniformLocation | null;
    uAgentSpeed?: WebGLUniformLocation | null;
    uSensorDistance?: WebGLUniformLocation | null;
    uSensorAngle?: WebGLUniformLocation | null;
    uTurnStrength?: WebGLUniformLocation | null;
  } = {};

  // Uniforms for agent rendering
  private agentRenderUniforms: {
    uAgentStateTexture?: WebGLUniformLocation | null;
    uAgentTextureSize?: WebGLUniformLocation | null;
    uCanvasSize?: WebGLUniformLocation | null;
  } = {};

  private trailRenderUniforms: {
    uTrailTexture?: WebGLUniformLocation | null;
  } = {};

  constructor(gl: WebGLRenderingContext, width: number, height: number, maxAgents: number = 1024) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    
    // Calculate agent texture size (square texture that can hold maxAgents)
    this.agentTextureSize = Math.ceil(Math.sqrt(maxAgents));
    this.maxAgents = this.agentTextureSize * this.agentTextureSize;
    
    console.log(`🧠 Initializing GPGPU system for ${this.maxAgents} agents (${this.agentTextureSize}x${this.agentTextureSize} texture)`);

    this.initializeBuffers();
    this.initializeShaders();
    this.createScreenQuad();
    this.createAgentGrid();
  }

  private initializeBuffers(): void {
    const gl = this.gl;

    // Create trail system textures (for trail map ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Failed to create trail texture');
      
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      
      this.trailTextures.push(texture);

      // Create framebuffer for this texture
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Failed to create trail framebuffer');
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Trail framebuffer setup failed');
      }
      
      this.trailFramebuffers.push(framebuffer);
    }

    // Initialize trail textures with black
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[0]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[1]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Create agent state textures (FLOAT textures for precise agent data)
    // Each pixel stores one agent: (posX, posY, velX, velY) in RGBA channels
    const ext = gl.getExtension('OES_texture_float');
    if (!ext) {
      throw new Error('OES_texture_float extension not available - required for GPGPU agents');
    }

    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Failed to create agent state texture');
      
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.agentTextureSize, this.agentTextureSize, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      
      this.agentStateTextures.push(texture);

      // Create framebuffer for agent state
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Failed to create agent state framebuffer');
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Agent state framebuffer setup failed');
      }
      
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
    console.log('✅ GPU buffers initialized - Trail and Agent state textures ready');
  }

  private createShader(source: string, type: number): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }

    return shader;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.createShader(vertexSource, gl.VERTEX_SHADER);
    const fragmentShader = this.createShader(fragmentSource, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create shader program');

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program linking failed: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }

  private initializeShaders(): void {
    // Standard vertex shader for full-screen quad operations
    const quadVertexSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = (a_position + 1.0) * 0.5;
      }
    `;

    // 1. Trail update shader (decay trails over time)
    const trailUpdateFragmentSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_trailTexture;
      uniform float u_decayFactor;

      void main() {
        vec4 color = texture2D(u_trailTexture, v_texCoord);
        gl_FragColor = vec4(color.rgb * u_decayFactor, 1.0);
      }
    `;

    // 2. Agent deposition shader (agents deposit trails - reads from GPU agent state)
    const agentDepositionFragmentSource = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform sampler2D u_decayedTrailTexture;
      uniform sampler2D u_agentStateTexture;
      uniform float u_agentTextureSize;
      uniform int u_activeAgentCount;
      uniform float u_trailStrength;
      uniform vec2 u_canvasSize;

      void main() {
        vec4 color = texture2D(u_decayedTrailTexture, v_texCoord);
        float deposit = 0.0;
        
        // Convert fragment coord to world position
        vec2 worldPos = v_texCoord * u_canvasSize;
        
        // Sample all active agents from the agent state texture
        for (int y = 0; y < 64; y++) {
          for (int x = 0; x < 64; x++) {
            int agentIndex = y * 64 + x;
            if (agentIndex >= u_activeAgentCount) break;
            
            vec2 texCoord = (vec2(float(x), float(y)) + 0.5) / u_agentTextureSize;
            vec4 agentState = texture2D(u_agentStateTexture, texCoord);
            
            // agentState.xy = position, agentState.zw = velocity
            vec2 agentPos = agentState.xy;
            
            // Skip inactive agents (position = 0,0)
            if (length(agentPos) < 1.0) continue;
            
            vec2 diff = worldPos - agentPos;
            float dist = length(diff);
            deposit += smoothstep(10.0, 0.0, dist) * u_trailStrength;
          }
        }

        gl_FragColor = vec4(color.rgb + deposit, 1.0);
      }
    `;

    // 3. GPGPU Agent update shader (the "brain" - replaces applyPhysarumSteering)
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

    // 4. Agent rendering vertex shader (renders agents from GPU state)
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

    // 5. Trail rendering shader (unchanged)
    const trailRenderFragmentSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_trailTexture;

      void main() {
        gl_FragColor = texture2D(u_trailTexture, v_texCoord);
      }
    `;

    // Create all shader programs
    this.trailUpdateProgram = this.createProgram(quadVertexSource, trailUpdateFragmentSource);
    this.agentDepositionProgram = this.createProgram(quadVertexSource, agentDepositionFragmentSource);
    this.agentUpdateProgram = this.createProgram(quadVertexSource, agentUpdateFragmentSource);
    this.agentRenderProgram = this.createProgram(agentRenderVertexSource, agentRenderFragmentSource);
    this.trailRenderProgram = this.createProgram(quadVertexSource, trailRenderFragmentSource);

    // Get uniform locations for trail update
    this.trailUpdateUniforms.uTrailTexture = this.gl.getUniformLocation(this.trailUpdateProgram, 'u_trailTexture');
    this.trailUpdateUniforms.uDecayFactor = this.gl.getUniformLocation(this.trailUpdateProgram, 'u_decayFactor');

    // Get uniform locations for agent deposition
    this.depositionUniforms.uDecayedTrailTexture = this.gl.getUniformLocation(this.agentDepositionProgram, 'u_decayedTrailTexture');
    this.depositionUniforms.uAgentStateTexture = this.gl.getUniformLocation(this.agentDepositionProgram, 'u_agentStateTexture');
    this.depositionUniforms.uAgentTextureSize = this.gl.getUniformLocation(this.agentDepositionProgram, 'u_agentTextureSize');
    this.depositionUniforms.uActiveAgentCount = this.gl.getUniformLocation(this.agentDepositionProgram, 'u_activeAgentCount');
    this.depositionUniforms.uTrailStrength = this.gl.getUniformLocation(this.agentDepositionProgram, 'u_trailStrength');
    this.depositionUniforms.uCanvasSize = this.gl.getUniformLocation(this.agentDepositionProgram, 'u_canvasSize');

    // Get uniform locations for agent update (GPGPU brain)
    this.agentUpdateUniforms.uAgentStateTexture = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_agentStateTexture');
    this.agentUpdateUniforms.uTrailTexture = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_trailTexture');
    this.agentUpdateUniforms.uCanvasSize = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_canvasSize');
    this.agentUpdateUniforms.uAgentTextureSize = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_agentTextureSize');
    this.agentUpdateUniforms.uDeltaTime = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_deltaTime');
    this.agentUpdateUniforms.uAgentSpeed = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_agentSpeed');
    this.agentUpdateUniforms.uSensorDistance = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_sensorDistance');
    this.agentUpdateUniforms.uSensorAngle = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_sensorAngle');
    this.agentUpdateUniforms.uTurnStrength = this.gl.getUniformLocation(this.agentUpdateProgram, 'u_turnStrength');

    // Get uniform locations for agent rendering
    this.agentRenderUniforms.uAgentStateTexture = this.gl.getUniformLocation(this.agentRenderProgram, 'u_agentStateTexture');
    this.agentRenderUniforms.uAgentTextureSize = this.gl.getUniformLocation(this.agentRenderProgram, 'u_agentTextureSize');
    this.agentRenderUniforms.uCanvasSize = this.gl.getUniformLocation(this.agentRenderProgram, 'u_canvasSize');

    // Get uniform locations for trail rendering
    this.trailRenderUniforms.uTrailTexture = this.gl.getUniformLocation(this.trailRenderProgram, 'u_trailTexture');
    
    console.log('✅ GPGPU shaders compiled successfully');
  }

  private createScreenQuad(): void {
    const gl = this.gl;
    
    // Create a quad that covers the entire screen in clip space (-1 to 1)
    const vertices = new Float32Array([
      -1, -1,  // Bottom left
       1, -1,  // Bottom right
      -1,  1,  // Top left
       1,  1   // Top right
    ]);

    this.screenQuadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  private createAgentGrid(): void {
    const gl = this.gl;
    
    // Create a buffer with indices for each potential agent
    // This is used by the agent rendering vertex shader
    const agentIndices = new Float32Array(this.maxAgents);
    for (let i = 0; i < this.maxAgents; i++) {
      agentIndices[i] = i;
    }

    this.agentGridBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.agentGridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, agentIndices, gl.STATIC_DRAW);
    
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

  // GPGPU update - processes everything on GPU
  public updateGPU(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    
    // Pass 1: Update Agent States (GPGPU Brain)
    this.updateAgentStates();
    
    // Pass 2: Trail Decay
    this.updateTrails();
    
    // Pass 3: Agent Trail Deposition (from GPU state)
    this.depositAgentTrails();
  }

  private updateAgentStates(): void {
    const gl = this.gl;
    
    // Ping-pong to next agent state texture
    const destinationIndex = 1 - this.currentAgentSourceIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.agentStateFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.agentTextureSize, this.agentTextureSize);
    
    gl.useProgram(this.agentUpdateProgram);
    
    // Bind current agent state as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentUpdateUniforms.uAgentStateTexture!, 0);
    
    // Bind trail texture for sensing
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
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

  private updateTrails(): void {
    const gl = this.gl;
    
    // Trail decay pass
    const destinationIndex = 1 - this.currentTrailSourceIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.width, this.height);
    
    gl.useProgram(this.trailUpdateProgram);
    
    // Bind source trail texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
    gl.uniform1i(this.trailUpdateUniforms.uTrailTexture!, 0);
    gl.uniform1f(this.trailUpdateUniforms.uDecayFactor!, 0.995);
    
    this.drawQuad();
    
    // Update trail source index
    this.currentTrailSourceIndex = destinationIndex as 0 | 1;
  }

  private depositAgentTrails(): void {
    const gl = this.gl;
    
    // Agent deposition pass (using GPU agent state, not CPU array)
    const destinationIndex = 1 - this.currentTrailSourceIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.width, this.height);
    
    gl.useProgram(this.agentDepositionProgram);
    
    // Bind decayed trail texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
    gl.uniform1i(this.depositionUniforms.uDecayedTrailTexture!, 0);
    
    // Bind agent state texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.depositionUniforms.uAgentStateTexture!, 1);
    
    // Set uniforms
    gl.uniform1f(this.depositionUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform1i(this.depositionUniforms.uActiveAgentCount!, this.activeAgentCount);
    gl.uniform1f(this.depositionUniforms.uTrailStrength!, 0.1);
    gl.uniform2f(this.depositionUniforms.uCanvasSize!, this.width, this.height);
    
    this.drawQuad();
    
    // Update trail source index
    this.currentTrailSourceIndex = destinationIndex as 0 | 1;
  }

  private drawQuad(): void {
    const gl = this.gl;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenQuadBuffer);
    
    // Get the currently bound program and find position attribute
    const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    const positionLocation = gl.getAttribLocation(currentProgram, 'a_position');
    
    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    }
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // GPU Agent Rendering - renders all agents in a single drawArrays call
  public renderAgentsToCanvas(): void {
    const gl = this.gl;
    
    // Render agents on top of trails
    gl.useProgram(this.agentRenderProgram);
    
    // Bind current agent state texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.agentStateTextures[this.currentAgentSourceIndex]);
    gl.uniform1i(this.agentRenderUniforms.uAgentStateTexture!, 0);
    
    // Set uniforms
    gl.uniform1f(this.agentRenderUniforms.uAgentTextureSize!, this.agentTextureSize);
    gl.uniform2f(this.agentRenderUniforms.uCanvasSize!, this.width, this.height);
    
    // Bind agent index buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.agentGridBuffer);
    const agentIndexLocation = gl.getAttribLocation(this.agentRenderProgram!, 'a_agentIndex');
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
    gl.disableVertexAttribArray(agentIndexLocation);
  }

  public renderTrailsToCanvas(): void {
    const gl = this.gl;
    
    // Bind the main canvas framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    
    gl.useProgram(this.trailRenderProgram);
    
    // Bind the final trail texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
    gl.uniform1i(this.trailRenderUniforms.uTrailTexture!, 0);
    
    // Enable additive blending for glow effect
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    
    this.drawQuad();
    
    gl.disable(gl.BLEND);
  }

  // Legacy CPU-GPU synchronization removed - no longer needed with GPGPU
  // batchSampleTrailStrength method removed - agents now sense trails entirely on GPU

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    
    // Recreate trail textures and framebuffers with new size
    // Agent textures stay the same size (they store agent count, not screen size)
    this.cleanupTrailBuffers();
    this.initializeTrailBuffers();
  }

  private cleanupTrailBuffers(): void {
    const gl = this.gl;
    
    for (const texture of this.trailTextures) {
      gl.deleteTexture(texture);
    }
    
    for (const framebuffer of this.trailFramebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    
    this.trailTextures = [];
    this.trailFramebuffers = [];
  }

  private initializeTrailBuffers(): void {
    const gl = this.gl;

    // Create trail system textures (for trail map ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Failed to create trail texture');
      
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      
      this.trailTextures.push(texture);

      // Create framebuffer for this texture
      const framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Failed to create trail framebuffer');
      
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Trail framebuffer setup failed');
      }
      
      this.trailFramebuffers.push(framebuffer);
    }

    // Initialize trail textures with black
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[0]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[1]);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    console.log('✅ Trail buffers resized and reinitialized');
  }

  private cleanup(): void {
    const gl = this.gl;
    
    // Cleanup trail buffers
    this.cleanupTrailBuffers();
    
    // Cleanup agent state buffers
    for (const texture of this.agentStateTextures) {
      gl.deleteTexture(texture);
    }
    
    for (const framebuffer of this.agentStateFramebuffers) {
      gl.deleteFramebuffer(framebuffer);
    }
    
    this.agentStateTextures = [];
    this.agentStateFramebuffers = [];
  }

  public dispose(): void {
    const gl = this.gl;
    
    this.cleanup();
    
    // Delete shader programs
    if (this.trailUpdateProgram) gl.deleteProgram(this.trailUpdateProgram);
    if (this.agentDepositionProgram) gl.deleteProgram(this.agentDepositionProgram);
    if (this.agentUpdateProgram) gl.deleteProgram(this.agentUpdateProgram);
    if (this.agentRenderProgram) gl.deleteProgram(this.agentRenderProgram);
    if (this.trailRenderProgram) gl.deleteProgram(this.trailRenderProgram);
    
    // Delete buffers
    if (this.screenQuadBuffer) gl.deleteBuffer(this.screenQuadBuffer);
    if (this.agentGridBuffer) gl.deleteBuffer(this.agentGridBuffer);
    
    console.log('✅ GPGPU system disposed');
  }

  // Utility methods for monitoring GPU state
  public getActiveAgentCount(): number {
    return this.activeAgentCount;
  }

  public getMaxAgents(): number {
    return this.maxAgents;
  }
}

export default WebGLTrailProcessor;