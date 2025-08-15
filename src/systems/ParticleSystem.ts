import type { ClusteredData, PersistentParticle, ClusterInfo } from '../data/interfaces';

export class ParticleSystem {
  private persistentParticles: PersistentParticle[] = [];
  private clusters: Map<number, ClusterInfo> = new Map();
  private pings: { x: number, y: number, hue: number, age: number, maxAge: number }[] = [];

  // Configuration
  private readonly MARGIN = 75; // Reduced from 150 to 75 for better screen usage

  // Visual bounds
  private minX: number = 0;
  private maxX: number = 0;
  private minY: number = 0;
  private maxY: number = 0;
  private scaleFactor: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public initialize(data: ClusteredData): void {

    this.calculateBounds(data);
    this.initializeClusterInfo(data);
    this.createPersistentParticles(data);
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

  public createPing(x: number, y: number, hue: number): void {
    this.pings.push({ x, y, hue, age: 0, maxAge: 60 });
  }

  public processPings(agentProperties: Float32Array, agentExtended: Float32Array, agentState: Float32Array): void {
    for (let i = 0; i < agentProperties.length; i += 4) {
      const pingSignal = agentProperties[i + 3]; // Using brightness (w) channel for ping
      if (pingSignal > 0.5) { // Ping signal is 1.0
        const positionX = agentState[i];
        const positionY = agentState[i + 1];
        const hue = agentExtended[i];
        this.createPing(positionX, positionY, hue);
      }
    }
  }

  public getClusters(): Map<number, ClusterInfo> {
    return this.clusters;
  }

  public getActiveParticleCount(): number {
    return this.persistentParticles.filter(p => p.alpha > 0.01).length;
  }

  public getConstellationParticleCount(currentYear: number, activeWindowYears: number = 5.0): number {
    return this.persistentParticles.filter(p => {
      return p.birthYear >= (currentYear - activeWindowYears) && p.birthYear <= currentYear;
    }).length;
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

  public getProjectScreenPositions(): Map<string, { x: number, y: number }> {
    const positions = new Map<string, { x: number, y: number }>();
    for (const particle of this.persistentParticles) {
      positions.set(particle.project.id, { x: particle.baseX, y: particle.baseY });
    }
    return positions;
  }

  public update(currentYear: number, activeWindowYears: number = 5.0): void {
    // Zeitgeist constellation model: particles transition between starfield and cluster colors
    for (const particle of this.persistentParticles) {
      const isInActiveWindow = particle.birthYear >= (currentYear - activeWindowYears) &&
        particle.birthYear <= currentYear;

      particle.isActive = isInActiveWindow;
      particle.phase += 0.015;

      if (particle.isActive) {
        // CONSTELLATION STATE: Bright cluster colors
        const clusterInfo = this.clusters.get(particle.clusterId);
        if (clusterInfo) {
          const individualBreathe = Math.sin(particle.phase) * 1.5;
          const particleAngle = particle.phase + (particle.clusterId * 0.5);
          particle.targetX = particle.baseX + individualBreathe * Math.cos(particleAngle);
          particle.targetY = particle.baseY + individualBreathe * Math.sin(particleAngle);
        }
        const targetAlpha = 0.9;
        particle.alpha += (targetAlpha - particle.alpha) * 0.05;
        particle.size = 2.0; // Larger active particles
      } else {
        // STARFIELD STATE: Faint grey dots
        particle.targetX = particle.baseX;
        particle.targetY = particle.baseY;
        const starfieldAlpha = 0.5; // Brighter starfield
        particle.alpha += (starfieldAlpha - particle.alpha) * 0.02;
        particle.size = 1.2; // Larger, rounder starfield particles
      }

      particle.currentX += (particle.targetX - particle.currentX) * 0.08;
      particle.currentY += (particle.targetY - particle.currentY) * 0.08;
    }

    for (const cluster of this.clusters.values()) {
      cluster.breathPhase += 0.008;
      cluster.isActive = cluster.particles.some(p => p.isActive);
    }

    // Update pings
    this.pings = this.pings.filter(ping => {
      ping.age++;
      return ping.age <= ping.maxAge;
    });
  }

  public render(ctx: CanvasRenderingContext2D, showParticles: boolean): void {
    if (!showParticles) return;

    ctx.save();

    // This loop ensures all 2744 projects are always on screen.
  for (const particle of this.persistentParticles) {
    let finalColor: string;
    let finalSize: number;

    if (particle.isActive) {
      // --- ACTIVE CONSTELLATION PARTICLE ---
      // This project's year is within the current time window.
      const clusterHue = (particle.clusterId * 137.508) % 360;
      finalColor = `hsl(${clusterHue}, 90%, 70%)`; // TODO: change to dedicated cluster color
      finalSize = 5.0; // Larger and more visible
      
      // Use the particle's alpha for the smooth fade-in effect.
      ctx.globalAlpha = particle.alpha; 

    } else {
      // --- INACTIVE STARFIELD PARTICLE ---
      // This project is not from the current era.
      finalColor = "rgba(204, 200, 200, 0.3)"; // Dim grey
      finalSize = 3.0; // Smaller, more subtle
      ctx.globalAlpha = 0.5; // Constant dim alpha
    }

    // --- Draw the particle as a circle ---
    ctx.beginPath();
    ctx.arc(particle.currentX, particle.currentY, finalSize, 0, Math.PI * 2);
    ctx.fillStyle = finalColor;
    ctx.fill();
  }
  
  // Reset global alpha so other rendering isn't affected.
  ctx.globalAlpha = 1.0; 
  ctx.restore();
  }
}



// // Render pings
// for (const ping of this.pings) {
//   const life = ping.age / ping.maxAge;
//   const radius = life * 50; // Max radius of 50px
//   const alpha = 1.0 - life;

//   ctx.beginPath();
//   ctx.arc(ping.x, ping.y, radius, 0, 2 * Math.PI);
//   ctx.strokeStyle = `hsla(${ping.hue}, 70%, 65%, ${alpha})`;
//   ctx.lineWidth = 2;
//   ctx.stroke();
// }