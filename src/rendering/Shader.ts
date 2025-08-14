// Shader compilation and program linking helper class

export class Shader {
  public program: WebGLProgram;
  private gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
    this.gl = gl;
    this.program = this.createProgram(vertexSource, fragmentSource);
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
      throw new Error(`Shader compilation failed: ${error}\nSource:\n${source}`);
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

  public use(): void {
    this.gl.useProgram(this.program);
  }

  public getUniformLocation(name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(this.program, name);
  }

  public getAttribLocation(name: string): number {
    return this.gl.getAttribLocation(this.program, name);
  }

  public dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}