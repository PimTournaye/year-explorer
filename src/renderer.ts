import { GPUSystem } from './systems/GPUSystem';
import { TrailSystem } from './systems/TrailSystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { EffectsSystem } from './systems/EffectsSystem';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private trailSystem: TrailSystem;
  private gpuSystem: GPUSystem;
  private particleSystem: ParticleSystem;
  private effectsSystem: EffectsSystem;

  private width: number;
  private height: number;

  constructor(
    canvas: HTMLCanvasElement,
    trailSystem: TrailSystem,
    gpuSystem: GPUSystem,
    particleSystem: ParticleSystem,
    effectsSystem: EffectsSystem,
    width: number,
    height: number
  ) {
    this.canvas = canvas;
    this.trailSystem = trailSystem;
    this.gpuSystem = gpuSystem;
    this.particleSystem = particleSystem;
    this.effectsSystem = effectsSystem;
    this.width = width;
    this.height = height;

    // Create overlay canvas for 2D elements (particles, UI) on top of WebGL
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '10';
    this.canvas.parentElement?.appendChild(this.overlayCanvas);

    this.overlayCtx = this.overlayCanvas.getContext('2d')!;
    this.setupOverlayCanvas();
  }

  private setupOverlayCanvas(): void {
    this.overlayCanvas.width = this.width;
    this.overlayCanvas.height = this.height;
    this.overlayCanvas.style.width = this.width + 'px';
    this.overlayCanvas.style.height = this.height + 'px';
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.setupOverlayCanvas();
  }

  public render(
    showParticles: boolean, 
    protagonistClusters?: Array<{id: number, color: string, name: string}>,
    currentPhase?: string,
    phaseTimer?: number,
    fadeDuration?: number
  ): void {
    // Clear overlay canvas for 2D elements on top of WebGL
    this.overlayCtx.clearRect(0, 0, this.width, this.height);

    // Render WebGL trails first (background)
    this.trailSystem.renderToCanvas();

    // Render GPU agents directly on WebGL canvas
    this.gpuSystem.renderToCanvas();

    // Render particles and clusters using overlay canvas (on top of WebGL)
    this.overlayCtx.save();
    this.particleSystem.render(this.overlayCtx, showParticles, protagonistClusters);
    this.effectsSystem.render(this.overlayCtx);
    this.overlayCtx.restore();

    // NEW: Draw the fade overlay on top of everything
    if (currentPhase && phaseTimer !== undefined && fadeDuration !== undefined) {
      this.renderFadeOverlay(currentPhase, phaseTimer, fadeDuration);
    }
  }

  private renderFadeOverlay(currentPhase: string, phaseTimer: number, fadeDuration: number): void {
    let alpha = 0.0;
    
    if (currentPhase === 'FADING_OUT') {
      alpha = Math.min(phaseTimer / fadeDuration, 1.0);
    } else if (currentPhase === 'RESETTING') {
      alpha = 1.0;
    } else if (currentPhase === 'FADING_IN') {
      alpha = 1.0 - Math.min(phaseTimer / fadeDuration, 1.0);
    }

    if (alpha > 0.0) {
      this.overlayCtx.fillStyle = '#fafafa'; // The off-white background color
      this.overlayCtx.globalAlpha = alpha;
      this.overlayCtx.fillRect(0, 0, this.width, this.height);
      this.overlayCtx.globalAlpha = 1.0; // Reset alpha
    }
  }
}
