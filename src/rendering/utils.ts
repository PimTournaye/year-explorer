// WebGL utility functions for buffer and texture creation

export function createBuffer(gl: WebGL2RenderingContext, data: Float32Array, usage: number = gl.STATIC_DRAW): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Failed to create WebGL buffer');
  
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  
  return buffer;
}

export function createTexture(
  gl: WebGL2RenderingContext, 
  width: number, 
  height: number, 
  internalFormat: number = gl.RGBA,
  format: number = gl.RGBA,
  type: number = gl.UNSIGNED_BYTE,
  data: ArrayBufferView | null = null
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create WebGL texture');
  
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  
  return texture;
}

export function createFloatTexture(
  gl: WebGL2RenderingContext, 
  width: number, 
  height: number,
  data: Float32Array | null = null
): WebGLTexture {
  return createTexture(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT, data);
}

export function createFramebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('Failed to create WebGL framebuffer');
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(`❌ Framebuffer setup failed with status: ${status}`);
    throw new Error('Framebuffer setup failed');
  }
  
  return framebuffer;
}

export function createScreenQuad(gl: WebGL2RenderingContext): WebGLBuffer {
  // Create a quad that covers the entire screen in clip space (-1 to 1)
  const vertices = new Float32Array([
    -1, -1,  // Bottom left
     1, -1,  // Bottom right
    -1,  1,  // Top left
     1,  1   // Top right
  ]);

  return createBuffer(gl, vertices);
}

