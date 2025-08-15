import { Shader } from '../rendering/Shader';
import { createTexture, createFramebuffer, createScreenQuad } from '../rendering/utils';

// Import shader sources
import quadVertexSource from '../shaders/quad.vert?raw';
import trailUpdateFragmentSource from '../shaders/trailUpdate.frag?raw';
import agentDepositionFragmentSource from '../shaders/agentDeposition.frag?raw';
import trailRenderFragmentSource from '../shaders/trailRender.frag?raw';

export class TrailSystem {
  private gl: WebGL2RenderingContext;
  private width: number;
  private height: number;

  // Trail system ping-pong buffers
  private trailTextures: WebGLTexture[] = [];
  private trailFramebuffers: WebGLFramebuffer[] = [];
  private currentTrailSourceIndex: 0 | 1 = 0;

  // Shader programs
  private trailUpdateShader!: Shader;
  private trailDepositionShader!: Shader;
  private trailRenderShader!: Shader;

  // Screen quad for full-screen passes
  private screenQuadBuffer!: WebGLBuffer;

  // Tuning parameters - SUBTLE SLIME MOLD STYLE
  private readonly DECAY_FACTOR = 0.985; // Moderate decay for organic feel
  private readonly TRAIL_STRENGTH = 1.0; // Subtle strength

  // Uniform locations
  private trailUpdateUniforms!: {
    uTrailTexture: WebGLUniformLocation | null;
    uDecayFactor: WebGLUniformLocation | null;
  };

  private depositionUniforms!: {
    uDecayedTrailTexture: WebGLUniformLocation | null;
    uAgentStateTexture: WebGLUniformLocation | null;
    uAgentPropertiesTexture: WebGLUniformLocation | null;
    uAgentTextureSize: WebGLUniformLocation | null;
    uActiveAgentCount: WebGLUniformLocation | null;
    uTrailStrength: WebGLUniformLocation | null;
    uCanvasSize: WebGLUniformLocation | null;
  };

  private trailRenderUniforms!: {
    uTrailTexture: WebGLUniformLocation | null;
    uThreshold: WebGLUniformLocation | null;
  };

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
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

    // STEP 4 DEBUG: Back to black initialization - trails build up brightness from zero
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[0]);
    gl.clearColor(0, 0, 0, 1); // Black - trails start from zero brightness
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[1]);
    gl.clearColor(0, 0, 0, 1); // Black - trails start from zero brightness  
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private initializeShaders(): void {
    const gl = this.gl;

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
      uAgentPropertiesTexture: this.trailDepositionShader.getUniformLocation('u_agentPropertiesTexture'),
      uAgentTextureSize: this.trailDepositionShader.getUniformLocation('u_agentTextureSize'),
      uActiveAgentCount: this.trailDepositionShader.getUniformLocation('u_activeAgentCount'),
      uTrailStrength: this.trailDepositionShader.getUniformLocation('u_trailStrength'),
      uCanvasSize: this.trailDepositionShader.getUniformLocation('u_canvasSize')
    };

    // Get uniform locations for trail rendering
    this.trailRenderUniforms = {
      uTrailTexture: this.trailRenderShader.getUniformLocation('u_trailTexture'),
      uThreshold: this.trailRenderShader.getUniformLocation('u_threshold')
    };
  }

  public update(
    agentStateTexture: WebGLTexture,
    agentPropertiesTexture: WebGLTexture,
    agentTextureSize: number,
    activeAgentCount: number
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);

    // Pass 1: Trail decay
    this.updateTrails();

    // Pass 2: Agent trail deposition (from GPU state)
    this.depositAgentTrails(agentStateTexture, agentPropertiesTexture, agentTextureSize, activeAgentCount);
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
    gl.uniform1f(this.trailUpdateUniforms.uDecayFactor!, this.DECAY_FACTOR);

    this.drawQuad(this.trailUpdateShader);

    // Update trail source index
    this.currentTrailSourceIndex = destinationIndex as 0 | 1;
  }

  private depositAgentTrails(agentStateTexture: WebGLTexture, agentPropertiesTexture: WebGLTexture, agentTextureSize: number, activeAgentCount: number): void {
    const gl = this.gl;
    const destinationIndex = 1 - this.currentTrailSourceIndex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trailFramebuffers[destinationIndex]);
    gl.viewport(0, 0, this.width, this.height);

    this.trailDepositionShader.use();

    // Bind decayed trail texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.trailTextures[this.currentTrailSourceIndex]);
    gl.uniform1i(this.depositionUniforms.uDecayedTrailTexture!, 0);

    // Bind agent state texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, agentStateTexture);
    gl.uniform1i(this.depositionUniforms.uAgentStateTexture!, 1);

    // Bind agent properties texture (for frontier status)
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, agentPropertiesTexture);
    gl.uniform1i(this.depositionUniforms.uAgentPropertiesTexture!, 2);

    // Set uniforms
    gl.uniform1f(this.depositionUniforms.uAgentTextureSize!, agentTextureSize);
    gl.uniform1i(this.depositionUniforms.uActiveAgentCount!, activeAgentCount);
    gl.uniform1f(this.depositionUniforms.uTrailStrength!, this.TRAIL_STRENGTH);
    gl.uniform2f(this.depositionUniforms.uCanvasSize!, this.width, this.height);

    this.drawQuad(this.trailDepositionShader);

    // Update trail source index
    this.currentTrailSourceIndex = destinationIndex as 0 | 1;
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

    // Set threshold to 0.0 to show EVERYTHING
    gl.uniform1f(this.trailRenderUniforms.uThreshold!, 0.0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Standard alpha blending

    this.drawQuad(this.trailRenderShader);

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