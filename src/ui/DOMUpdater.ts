// Updates DOM elements like year display and performance stats

export interface PerformanceStats {
  year: number;
  fps: number;
  activeParticles: number;
  activeClusters: number;
  activeAgents: number;
}

export class DOMUpdater {
  private frameCount: number = 0;
  private lastFpsUpdate: number = 0;
  private fps: number = 60;

  constructor() {
    this.lastFpsUpdate = performance.now();
    console.log('✅ DOMUpdater initialized');
  }

  public update(stats: Partial<PerformanceStats>): void {
    // Update year display
    if (stats.year !== undefined) {
      this.updateYearDisplay(stats.year);
    }

    // Update performance stats
    this.updatePerformanceStats(stats);
  }

  private updateYearDisplay(year: number): void {
    const yearDisplay = document.getElementById('yearDisplay') as HTMLElement;
    if (yearDisplay) {
      yearDisplay.textContent = Math.floor(year).toString();
    }
  }

  private updatePerformanceStats(stats: Partial<PerformanceStats>): void {
    const now = performance.now();
    this.frameCount++;
    
    // Calculate FPS every second
    if (now - this.lastFpsUpdate > 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      
      const fpsCounter = document.getElementById('fpsCounter');
      if (fpsCounter) {
        fpsCounter.textContent = this.fps.toString();
      }
    }
    
    // Update other stats if provided
    if (stats.activeParticles !== undefined) {
      const particleCount = document.getElementById('particleCount');
      if (particleCount) {
        particleCount.textContent = stats.activeParticles.toString();
      }
    }
    
    if (stats.activeClusters !== undefined) {
      const clusterCount = document.getElementById('clusterCount');
      if (clusterCount) {
        clusterCount.textContent = stats.activeClusters.toString();
      }
    }

    if (stats.activeAgents !== undefined) {
      const agentCount = document.getElementById('agentCount');
      if (agentCount) {
        agentCount.textContent = stats.activeAgents.toString();
      }
    }
  }

  public getFPS(): number {
    return this.fps;
  }
}