import type { ClusteredData, PersistentParticle, ClusterInfo } from '../data/interfaces';

export class ParticleSystem {
  private persistentParticles: PersistentParticle[] = [];
  private clusters: Map<number, ClusterInfo> = new Map();

  // Configuration
  private readonly MARGIN = 150;

  // Visual bounds
  private minX: number = 0;
  private maxX: number = 0;
  private minY: number = 0;
  private maxY: number = 0;
  private scaleFactor: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;

  constructor(private width: number, private height: number) {
    console.log('✅ ParticleSystem initialized');
  }

  public initialize(data: ClusteredData): void {
    console.log('🔥 Initializing organic particle system...');
    
    this.calculateBounds(data);
    this.initializeClusterInfo(data);
    this.createPersistentParticles(data);
    
    console.log(`✨ Created ${this.persistentParticles.length} persistent particles across ${this.clusters.size} clusters`);
  }

  private calculateBounds(data: ClusteredData): void {
    // Use percentile bounds to handle outliers
    const xCoords = data.projects.map(p => p.x).sort((a, b) => a - b);
    const yCoords = data.projects.map(p => p.y).sort((a, b) => a - b);
    
    const percentile = 0.02;
    const xIndex1 = Math.floor(xCoords.length * percentile);
    const xIndex2 = Math.floor(xCoords.length * (1 - percentile));
    const yIndex1 = Math.floor(yCoords.length * percentile);
    const yIndex2 = Math.floor(yCoords.length * (1 - percentile));
    
    this.minX = xCoords[xIndex1];
    this.maxX = xCoords[xIndex2];
    this.minY = yCoords[yIndex1];
    this.maxY = yCoords[yIndex2];
    
    const dataWidth = this.maxX - this.minX;
    const dataHeight = this.maxY - this.minY;
    
    const availableWidth = this.width - 2 * this.MARGIN;
    const availableHeight = this.height - 2 * this.MARGIN;
    
    const scaleX = availableWidth / dataWidth;
    const scaleY = availableHeight / dataHeight;
    this.scaleFactor = Math.min(scaleX, scaleY);
    
    const scaledWidth = dataWidth * this.scaleFactor;
    const scaledHeight = dataHeight * this.scaleFactor;
    
    this.offsetX = this.MARGIN + (availableWidth - scaledWidth) / 2 - this.minX * this.scaleFactor;
    this.offsetY = this.MARGIN + (availableHeight - scaledHeight) / 2 - this.minY * this.scaleFactor;
    
    console.log(`📐 Bounds calculated - Scale: ${this.scaleFactor.toFixed(2)} Viewport usage: ${((scaledWidth * scaledHeight) / (this.width * this.height) * 100).toFixed(1)}%`);
  }

  private worldToScreen(x: number, y: number): [number, number] {
    return [
      x * this.scaleFactor + this.offsetX,
      y * this.scaleFactor + this.offsetY
    ];
  }

  private initializeClusterInfo(data: ClusteredData): void {
    for (const cluster of data.clusters) {
      const [centerX, centerY] = this.worldToScreen(cluster.centroidX, cluster.centroidY);
      
      this.clusters.set(cluster.id, {
        id: cluster.id,
        centerX,
        centerY,
        particles: [],
        breathPhase: Math.random() * Math.PI * 2,
        density: cluster.projectCount,
        isActive: false
      });
    }
  }

  private createPersistentParticles(data: ClusteredData): void {
    for (const project of data.projects) {
      const [baseX, baseY] = this.worldToScreen(project.x, project.y);
      
      const particle: PersistentParticle = {
        id: project.id,
        project,
        baseX,
        baseY,
        currentX: baseX,
        currentY: baseY,
        targetX: baseX,
        targetY: baseY,
        clusterId: project.clusterId || project.cluster_id,
        isActive: false,
        birthYear: project.year,
        phase: Math.random() * Math.PI * 2,
        size: 1.5 + Math.random() * 1,
        alpha: 0
      };
      
      this.persistentParticles.push(particle);
      
      // Add to cluster
      const clusterInfo = this.clusters.get(particle.clusterId);
      if (clusterInfo) {
        clusterInfo.particles.push(particle);
      }
    }
  }

  public update(currentYear: number): void {
    // Activate particles based on current year
    for (const particle of this.persistentParticles) {
      if (particle.birthYear <= currentYear && !particle.isActive) {
        particle.isActive = true;
        particle.alpha = 0.0; // Start completely invisible
      }
      
      if (particle.isActive) {
        // Update individual particle phase for breathing
        particle.phase += 0.015 + Math.random() * 0.01; // Slight randomness
        
        // Get cluster info for breathing
        const clusterInfo = this.clusters.get(particle.clusterId);
        if (clusterInfo) {
          // Combine cluster breathing with individual particle movement
          const clusterBreathe = Math.sin(clusterInfo.breathPhase) * 3; // Larger amplitude
          const individualBreathe = Math.sin(particle.phase) * 1.5; // Individual breathing
          
          // Calculate breathing offset
          const breatheRadius = clusterBreathe + individualBreathe;
          const particleAngle = particle.phase + (particle.clusterId * 0.5); // Offset by cluster
          
          particle.targetX = particle.baseX + breatheRadius * Math.cos(particleAngle);
          particle.targetY = particle.baseY + breatheRadius * Math.sin(particleAngle);
        }
        
        // Smooth movement toward target
        particle.currentX += (particle.targetX - particle.currentX) * 0.08;
        particle.currentY += (particle.targetY - particle.currentY) * 0.08;
        
        // Much slower, smoother fade-in
        const targetAlpha = 0.6 + Math.sin(particle.phase * 0.5) * 0.2; // Breathing alpha
        if (particle.alpha < targetAlpha) {
          particle.alpha += 0.003; // Much slower fade-in
        }
        
        // Breathing size variation
        particle.size = 1.5 + Math.sin(particle.phase * 0.8) * 0.5;
      }
    }
    
    // Update cluster breathing (slower, more organic)
    for (const cluster of this.clusters.values()) {
      cluster.breathPhase += 0.008 + Math.sin(cluster.id * 0.1) * 0.002; // Variable breathing rates
      
      // Activate cluster when it has active particles
      cluster.isActive = cluster.particles.some(p => p.isActive);
    }
  }

  public render(ctx: CanvasRenderingContext2D, showParticles: boolean): void {
    ctx.save();
    
    // Render cluster boundaries (minimal)
    for (const cluster of this.clusters.values()) {
      if (!cluster.isActive) continue;
      
      ctx.beginPath();
      ctx.arc(cluster.centerX, cluster.centerY, 3, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();
      
      // Very subtle cluster outline
      const radius = Math.sqrt(cluster.density) * 8;
      ctx.beginPath();
      ctx.arc(cluster.centerX, cluster.centerY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    // Render dense particle clouds with breathing effects (if enabled)
    if (showParticles) {
      for (const particle of this.persistentParticles) {
        if (!particle.isActive || particle.alpha < 0.01) continue;
        
        const clusterHue = (particle.clusterId * 137.508) % 360;
        const dynamicAlpha = particle.alpha * (0.8 + Math.sin(particle.phase * 0.3) * 0.2);
        
        // Main particle
        ctx.beginPath();
        ctx.arc(particle.currentX, particle.currentY, particle.size, 0, 2 * Math.PI);
        ctx.fillStyle = `hsla(${clusterHue}, 70%, 65%, ${dynamicAlpha})`;
        ctx.fill();
        
        // Add breathing glow effect
        if (particle.alpha > 0.3) {
          const glowSize = particle.size + Math.sin(particle.phase) * 1;
          const glowAlpha = dynamicAlpha * 0.3;
          
          ctx.beginPath();
          ctx.arc(particle.currentX, particle.currentY, glowSize, 0, 2 * Math.PI);
          ctx.fillStyle = `hsla(${clusterHue}, 80%, 80%, ${glowAlpha})`;
          ctx.fill();
          
          // Soft outer glow for density effect
          ctx.shadowColor = `hsla(${clusterHue}, 70%, 70%, ${glowAlpha * 0.5})`;
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
    
    ctx.restore();
  }

  public getClusters(): Map<number, ClusterInfo> {
    return this.clusters;
  }

  public getActiveParticleCount(): number {
    return this.persistentParticles.filter(p => p.isActive).length;
  }

  public getActiveClusters(): ClusterInfo[] {
    return Array.from(this.clusters.values()).filter(c => c.isActive);
  }

  public resize(width: number, height: number, data: ClusteredData): void {
    this.width = width;
    this.height = height;
    
    // Recalculate bounds and reinitialize
    this.calculateBounds(data);
    this.initializeClusterInfo(data);
    this.createPersistentParticles(data);
  }
}