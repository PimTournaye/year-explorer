import { Shader } from '../rendering/Shader';
import { createTexture, createFramebuffer, createScreenQuad } from '../rendering/utils';

export class TrailSystem {
  private gl: WebGLRenderingContext;
  private width: number;
  private height: number;

  // Trail system ping-pong buffers
  private trailTextures: WebGLTexture[] = [];
  private trailFramebuffers: WebGLFramebuffer[] = [];
  private currentTrailSourceIndex: 0 | 1 = 0;

  // Shader programs
  private trailUpdateShader: Shader;
  private trailDepositionShader: Shader;
  private trailRenderShader: Shader;

  // Screen quad for full-screen passes
  private screenQuadBuffer: WebGLBuffer;

  // Uniform locations
  private trailUpdateUniforms: {
    uTrailTexture: WebGLUniformLocation | null;
    uDecayFactor: WebGLUniformLocation | null;
  };

  private depositionUniforms: {
    uDecayedTrailTexture: WebGLUniformLocation | null;
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uActiveAgentCount: WebGLUniformLocation | null;
    uTrailStrength: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
  };

  private trailRenderUniforms: {
    uTrailTexture: WebGLUniformLocation | null;
  };

  constructor(gl: WebGLRenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;

    this.initializeBuffers();
    this.initializeShaders();
    this.screenQuadBuffer = createScreenQuad(gl);

    console.log('✅ TrailSystem initialized');
  }

  private initializeBuffers(): void {
    const gl = this.gl;

    // Create trail system textures (for trail map ping-pong)
    for (let i = 0; i < 2; i++) {
      const texture = createTexture(gl, this.width, this.height);
      this.trailTextures.push(texture);

      // Create framebuffer for this texture
      const framebuffer = createFramebuffer(gl, texture);
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

    // Trail update shader (decay trails over time)
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

    // Agent deposition shader (agents deposit trails - reads from GPU agent state)
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

    // Trail rendering shader
    const trailRenderFragmentSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_trailTexture;

      void main() {
        gl_FragColor = texture2D(u_trailTexture, v_texCoord);
      }
    `;

    // Create shader programs
    this.trailUpdateShader = new Shader(gl, quadVertexSource, trailUpdateFragmentSource);
    this.trailDepositionShader = new Shader(gl, quadVertexSource, agentDepositionFragmentSource);
    this.trailRenderShader = new Shader(gl, quadVertexSource, trailRenderFragmentSource);

    // Get uniform locations for trail update
    this.trailUpdateUniforms = {
      uTrailTexture: this.trailUpdateShader.getUniformLocation('u_trailTexture'),
      uDecayFactor: this.trailUpdateShader.getUniformLocation('u_decayFactor')
    };

    // Get uniform locations for agent deposition
    this.depositionUniforms = {
      uDecayedTrailTexture: this.trailDepositionShader.getUniformLocation('u_decayedTrailTexture'),
      uAgentStateTexture: this.trailDepositionShader.getUniformLocation('u_agentStateTexture'),
      uAgentTextureSize: this.trailDepositionShader.getUniformLocation('u_agentTextureSize'),
      uActiveAgentCount: this.trailDepositionShader.getUniformLocation('u_activeAgentCount'),
      uTrailStrength: this.trailDepositionShader.getUniformLocation('u_trailStrength'),
      uCanvasSize: this.trailDepositionShader.getUniformLocation('u_canvasSize')
    };

    // Get uniform locations for trail rendering
    this.trailRenderUniforms = {
      uTrailTexture: this.trailRenderShader.getUniformLocation('u_trailTexture')
    };
  }

  public update(agentStateTexture: WebGLTexture, agentTextureSize: number, activeAgentCount: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);

    // Pass 1: Trail decay
    this.updateTrails();

    // Pass 2: Agent trail deposition (from GPU state)
    this.depositAgentTrails(agentStateTexture, agentTextureSize, activeAgentCount);
  }

  private updateTrails(): void {
    const gl = this.gl;
    
    // Trail decay pass
    const destinationIndex = 1 - this.currentTrailSourceIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[destinationIndex]);
    
    this.trailUpdateShader.use();
    
    // Bind source trail texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
    gl.uniform1i(this.trailUpdateUniforms.uTrailTexture!, 0);
    gl.uniform1f(this.trailUpdateUniforms.uDecayFactor!, 0.995);
    
    this.drawQuad();
    
    // Update trail source index
    this.currentTrailSourceIndex = destinationIndex as 0 | 1;
  }

  private depositAgentTrails(agentStateTexture: WebGLTexture, agentTextureSize: number, activeAgentCount: number): void {
    const gl = this.gl;
    
    // Agent deposition pass (using GPU agent state, not CPU array)
    const destinationIndex = 1 - this.currentTrailSourceIndex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[destinationIndex]);
    
    this.trailDepositionShader.use();
    
    // Bind decayed trail texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
    gl.uniform1i(this.depositionUniforms.uDecayedTrailTexture!, 0);
    
    // Bind agent state texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, agentStateTexture);
    gl.uniform1i(this.depositionUniforms.uAgentStateTexture!, 1);
    
    // Set uniforms
    gl.uniform1f(this.depositionUniforms.uAgentTextureSize!, agentTextureSize);
    gl.uniform1i(this.depositionUniforms.uActiveAgentCount!, activeAgentCount);
    gl.uniform1f(this.depositionUniforms.uTrailStrength!, 0.1);
    gl.uniform2f(this.depositionUniforms.uCanvasSize!, this.width, this.height);
    
    this.drawQuad();
    
    // Update trail source index
    this.currentTrailSourceIndex = destinationIndex as 0 | 1;
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

  public renderToCanvas(): void {
    const gl = this.gl;
    
    // Bind the main canvas framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    
    this.trailRenderShader.use();
    
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

  public getTrailTexture(): WebGLTexture {
    return this.trailTextures[this.currentTrailSourceIndex];
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    
    // Recreate trail textures and framebuffers with new size
    this.cleanupBuffers();
    this.initializeBuffers();
  }

  private cleanupBuffers(): void {
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

  public dispose(): void {
    const gl = this.gl;
    
    this.cleanupBuffers();
    
    this.trailUpdateShader.dispose();
    this.trailDepositionShader.dispose();
    this.trailRenderShader.dispose();
    
    if (this.screenQuadBuffer) gl.deleteBuffer(this.screenQuadBuffer);
    
    console.log('✅ TrailSystem disposed');
  }
}