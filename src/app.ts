import { GPUSystem } from './systems/GPUSystem';
import { TrailSystem } from './systems/TrailSystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { DOMUpdater } from './ui/DOMUpdater';
import { Simulation } from './simulation';
import { Renderer } from './renderer'; // New import
import { EffectsSystem } from './systems/EffectsSystem';
import { loadBridgeData, loadData } from './data/loader';
import type { ClusteredData, Bridge } from './data/interfaces';
import { Ledger } from './ui/Ledger';


export class SemanticGarden {
  // Canvas and WebGL context
  private canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;

  // Dimensions
  private width: number = 0;
  private height: number = 0;

  // Systems
  private gpuSystem!: GPUSystem;
  private trailSystem!: TrailSystem;
  private particleSystem!: ParticleSystem;
  private simulation!: Simulation;
  private renderer!: Renderer; // New property
  private effectsSystem!: EffectsSystem;

  // UI
  private domUpdater: DOMUpdater;

  // Animation state
  private isPlaying: boolean = true;
  private speed: number = 1;
  private animationId: number | null = null;
  private showParticles: boolean = true;
  private data: ClusteredData | null = null;
  private ledger: Ledger | undefined;
  private bridgeData: Bridge[] = [];

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;

    this.domUpdater = new DOMUpdater();

    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.setupCanvas();
    await this.initializeWebGL();
    await this.loadApplicationData(); // Load data first

    // Initialize systems that depend on data
    this.particleSystem = new ParticleSystem(this.width, this.height);
    this.particleSystem.initialize(this.data!);

    this.gpuSystem = new GPUSystem(this.gl, this.width, this.height, 1024);
    this.trailSystem = new TrailSystem(this.gl, this.width, this.height);

    // Initialize simulation and renderer after all systems are ready
    this.simulation = new Simulation(
      this.particleSystem,
      this.gpuSystem,
      this.data!,
      this.bridgeData,
      this.width,
      this.height
    );
    this.effectsSystem = new EffectsSystem();

    this.renderer = new Renderer(
      this.canvas,
      this.trailSystem,
      this.gpuSystem,
      this.particleSystem,
      this.effectsSystem,
      this.width,
      this.height
    );

    this.ledger = new Ledger({
      onPlayPause: (isPlaying) => {
        this.isPlaying = isPlaying;
        isPlaying ? this.startAnimation() : this.stopAnimation();
      },
      onSpeedChange: (speed) => this.speed = speed
    });

    // Change theme colors
    this.ledger.setAccentColor('#ff6b35', '#ff8c69'); // Orange theme

    window.addEventListener('resize', () => this.handleResize());

    // Start the render loop
    this.render();
    this.startAnimation();
  }

  private setupCanvas(): void {
    const canvasBounds = this.canvas.getBoundingClientRect();

    this.width = canvasBounds.width;
    this.height = canvasBounds.height;

    // Set both the drawing buffer size and the display size
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

  }

  private async initializeWebGL(): Promise<void> {
    console.log('🔍 Attempting WebGL initialization...');

    const gl = this.canvas.getContext('webgl2');

    if (!gl) throw new Error('WebGL 2.0 context creation failed - WebGL 2.0 required for PBO support');

    this.gl = gl;

    const ext = this.gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('Unsupported hardware: EXT_color_buffer_float is not available.');

    console.log('📊 WebGL Info:', {
      version: this.gl.getParameter(this.gl.VERSION),
      vendor: this.gl.getParameter(this.gl.VENDOR),
      renderer: this.gl.getParameter(this.gl.RENDERER)
    });

    document.getElementById('rendererInfo')!.textContent = 'WebGL';
  }

  private async loadApplicationData(): Promise<void> {
    try {
      this.data = await loadData();
      console.log('✅ Application data loaded');
      this.bridgeData = await loadBridgeData(); // Load bridge data
      console.log('✅ Bridge data loaded');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
    }
  }

  private handleResize(): void {
    this.setupCanvas();

    // Propagate the new dimensions to all systems
    this.gl.viewport(0, 0, this.width, this.height);
    this.trailSystem.resize(this.width, this.height);
    // this.gpuSystem.resize(this.width, this.height); // You may need to add a resize method here
    this.particleSystem.resize(this.width, this.height, this.data!);
    this.simulation.resize(this.width, this.height);
    this.renderer.resize(this.width, this.height);
  }

  private render(): void {
    this.simulation.update();

    this.gpuSystem.update(this.trailSystem.getTrailTexture());
    const clusterCentroids = this.particleSystem.getClusters();
    this.gpuSystem.updateFrontierMirrors(clusterCentroids);

    // --- NEW: Trigger pings ---
    const arrivals = this.gpuSystem.frontierArrivals;
    if (arrivals.length > 0) {
      for (const arrival of arrivals) {
        this.effectsSystem.createPing(arrival.x, arrival.y);
      }
    }
    this.effectsSystem.update();

    this.trailSystem.update(
      this.gpuSystem.getAgentStateTexture(),
      this.gpuSystem.getAgentPropertiesTexture(),
      this.gpuSystem.getAgentTextureSize(),
      this.gpuSystem.getActiveAgentCount()
    );

    const protagonistClusters = this.simulation.getProtagonistClusters();
        this.renderer.render(this.showParticles, protagonistClusters); // Pass showParticles and protagonist clusters to renderer // Pass showParticles and protagonist clusters to renderer
    if (this.ledger) {
      this.ledger.update(this.gpuSystem.getFrontierAgentMirrors(), this.simulation.currentYear);
    }

    this.updateUI();
  }

  private updateUI(): void {
    this.domUpdater.update({
      year: this.simulation.currentYear,
      activeParticles: this.particleSystem.getConstellationParticleCount(this.simulation.currentYear, this.simulation.PROJECT_ACTIVE_WINDOW_YEARS),
      activeClusters: this.simulation.getProtagonistClusters().length,
      activeAgents: this.gpuSystem.getActiveAgentCount()
    });
    this.ledger!.update(this.gpuSystem.getFrontierAgentMirrors(), this.simulation.currentYear);
  }

  private animate(): void {
    if (!this.isPlaying) return;

    const deltaTime = this.simulation.YEAR_DURATION / this.speed;
    this.simulation.currentYear += 1 / (deltaTime / 16.67);

    if (this.simulation.currentYear > this.simulation.END_YEAR) {
      this.simulation.currentYear = this.simulation.START_YEAR;
    }

    this.render();
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  private startAnimation(): void {
    if (this.animationId) return;
    this.animate();
  }

  private stopAnimation(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  public dispose(): void {
    this.stopAnimation();
    this.gpuSystem.dispose();
    this.trailSystem.dispose();
  }
}
