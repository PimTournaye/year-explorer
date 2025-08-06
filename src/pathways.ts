interface Project {
  id: string;
  title: string;
  year: number;
  text: string;
  embedding: number[];
  x: number;
  y: number;
  clusterId: number;
}

interface ClusterData {
  id: number;
  centroid768d: number[];
  centroidX: number;
  centroidY: number;
  projectCount: number;
  yearRange: [number, number];
  topTerms: string[];
}

interface ClusteredData {
  projects: Project[];
  clusters: ClusterData[];
}

interface Particle {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  sourceCluster: number;
  targetCluster: number;
  speed: number;
  life: number;
  maxLife: number;
  color: string;
}

interface Trail {
  points: { x: number; y: number; alpha: number }[];
  sourceCluster: number;
  targetCluster: number;
  strength: number;
  lastActivity: number;
}

interface CrossClusterActivity {
  sourceCluster: number;
  targetCluster: number;
  count: number;
  projects: Project[];
}

interface PathwayCooldown {
  sourceCluster: number;
  targetCluster: number;
  lastTriggerTime: number;
  cooldownDuration: number;
}

class ConversationPathways {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  
  private data: ClusteredData | null = null;
  private currentYear: number = 1985;
  private isPlaying: boolean = false;
  private speed: number = 1;
  private activityThreshold: number = 3;
  private animationId: number | null = null;
  
  // Animation parameters
  private readonly START_YEAR = 1985;
  private readonly END_YEAR = 2025;
  private readonly YEAR_DURATION = 100; // milliseconds per year at 1x speed
  private readonly WINDOW_SIZE = 2; // years for sliding window (easily adjustable)
  
  // Pathway cooldown system
  private readonly PATHWAY_COOLDOWN_DURATION = 5; // years before same pathway can trigger again
  private pathwayCooldowns: Map<string, PathwayCooldown> = new Map();
  
  // Visual bounds
  private minX: number = 0;
  private maxX: number = 0;
  private minY: number = 0;
  private maxY: number = 0;
  private scaleFactor: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private readonly MARGIN = 150;
  
  // Particle system
  private particles: Particle[] = [];
  private trails: Map<string, Trail> = new Map();
  private activeProjects: Map<string, Project> = new Map();
  
  // Visual parameters
  private readonly PARTICLE_SPEED = 1; // Slower, more deliberate
  private readonly PARTICLE_LIFE = 300; // Longer life for visibility
  private readonly TRAIL_FADE_RATE = 0.99;
  private readonly TRAIL_MIN_STRENGTH = 0.1;
  private readonly PARTICLES_PER_PATHWAY = 5; // More visible particles per batch
  
  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    
    this.setupCanvas();
    this.setupControls();
    this.loadData();
    
    window.addEventListener('resize', () => this.setupCanvas());
  }

  private setupCanvas(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  }

  private setupControls(): void {
    const playPause = document.getElementById('playPause') as HTMLButtonElement;
    const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    const speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    const thresholdSlider = document.getElementById('thresholdSlider') as HTMLInputElement;
    const thresholdValue = document.getElementById('thresholdValue') as HTMLSpanElement;
    
    playPause.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      playPause.textContent = this.isPlaying ? '⏸' : '▶';
      
      if (this.isPlaying) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    });
    
    speedSlider.addEventListener('input', () => {
      this.speed = parseFloat(speedSlider.value);
      speedValue.textContent = `${this.speed}x`;
    });
    
    thresholdSlider.addEventListener('input', () => {
      this.activityThreshold = parseInt(thresholdSlider.value);
      thresholdValue.textContent = thresholdSlider.value;
    });
  }

  private async loadData(): Promise<void> {
    try {
      const response = await fetch('./projects-with-embeddings-clustered.json');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      this.data = await response.json() as ClusteredData;
      console.log(`Loaded ${this.data.projects.length} projects and ${this.data.clusters.length} clusters`);
      
      this.calculateBounds();
      this.render();
      
    } catch (error) {
      console.error('Failed to load clustered data:', error);
    }
  }

  private calculateBounds(): void {
    if (!this.data) return;
    
    // Get all coordinates and sort them to find percentile bounds (ignore outliers)
    const xCoords = this.data.projects.map(p => p.x).sort((a, b) => a - b);
    const yCoords = this.data.projects.map(p => p.y).sort((a, b) => a - b);
    
    // Use 2nd and 98th percentiles to ignore extreme outliers
    const percentile = 0.02; // 2% margin
    const xIndex1 = Math.floor(xCoords.length * percentile);
    const xIndex2 = Math.floor(xCoords.length * (1 - percentile));
    const yIndex1 = Math.floor(yCoords.length * percentile);
    const yIndex2 = Math.floor(yCoords.length * (1 - percentile));
    
    this.minX = xCoords[xIndex1];
    this.maxX = xCoords[xIndex2];
    this.minY = yCoords[yIndex1];
    this.maxY = yCoords[yIndex2];
    
    // Show the difference between min/max and percentile bounds
    const absoluteMinX = xCoords[0];
    const absoluteMaxX = xCoords[xCoords.length - 1];
    const absoluteMinY = yCoords[0];
    const absoluteMaxY = yCoords[yCoords.length - 1];
    
    console.log(`Absolute bounds: X(${absoluteMinX.toFixed(2)} to ${absoluteMaxX.toFixed(2)}), Y(${absoluteMinY.toFixed(2)} to ${absoluteMaxY.toFixed(2)})`);
    console.log(`98% bounds: X(${this.minX.toFixed(2)} to ${this.maxX.toFixed(2)}), Y(${this.minY.toFixed(2)} to ${this.maxY.toFixed(2)})`);
    
    const dataWidth = this.maxX - this.minX;
    const dataHeight = this.maxY - this.minY;
    
    // Calculate available canvas space (full viewport minus margins)
    const availableWidth = this.width - 2 * this.MARGIN;
    const availableHeight = this.height - 2 * this.MARGIN;
    
    console.log(`Canvas: ${this.width}x${this.height}, Available: ${availableWidth}x${availableHeight}`);
    
    // Scale to fit the available space, maintaining aspect ratio
    const scaleX = availableWidth / dataWidth;
    const scaleY = availableHeight / dataHeight;
    this.scaleFactor = Math.min(scaleX, scaleY);
    
    // Center the visualization in the available space
    const scaledWidth = dataWidth * this.scaleFactor;
    const scaledHeight = dataHeight * this.scaleFactor;
    
    this.offsetX = this.MARGIN + (availableWidth - scaledWidth) / 2 - this.minX * this.scaleFactor;
    this.offsetY = this.MARGIN + (availableHeight - scaledHeight) / 2 - this.minY * this.scaleFactor;
    
    console.log(`Scale factor: ${this.scaleFactor.toFixed(4)}`);
    console.log(`Scaled dimensions: ${scaledWidth.toFixed(2)}x${scaledHeight.toFixed(2)}`);
    console.log(`Offset: (${this.offsetX.toFixed(2)}, ${this.offsetY.toFixed(2)})`);
    
    // Calculate how much of the viewport we're actually using
    const viewportUsage = (scaledWidth * scaledHeight) / (this.width * this.height) * 100;
    console.log(`Viewport usage: ${viewportUsage.toFixed(1)}%`);
  }

  private worldToScreen(x: number, y: number): [number, number] {
    return [
      x * this.scaleFactor + this.offsetX,
      y * this.scaleFactor + this.offsetY
    ];
  }

  private detectCrossClusterActivity(): CrossClusterActivity[] {
    if (!this.data) return [];
    
    // Get projects in current sliding window
    const windowStart = this.currentYear - this.WINDOW_SIZE / 2;
    const windowEnd = this.currentYear + this.WINDOW_SIZE / 2;
    
    const projectsInWindow = this.data.projects.filter(p => 
      p.year >= windowStart && p.year <= windowEnd
    );
    
    // Group by cluster
    const clusterGroups = new Map<number, Project[]>();
    projectsInWindow.forEach(project => {
      if (!clusterGroups.has(project.clusterId)) {
        clusterGroups.set(project.clusterId, []);
      }
      clusterGroups.get(project.clusterId)!.push(project);
    });
    
    // Find cross-cluster activity by detecting clusters with activity in the same time window
    const activities: CrossClusterActivity[] = [];
    const clusterIds = Array.from(clusterGroups.keys());
    
    for (let i = 0; i < clusterIds.length; i++) {
      for (let j = i + 1; j < clusterIds.length; j++) {
        const sourceId = clusterIds[i];
        const targetId = clusterIds[j];
        const sourceProjects = clusterGroups.get(sourceId)!;
        const targetProjects = clusterGroups.get(targetId)!;
        
        // Calculate activity strength based on project count and temporal overlap
        const activityStrength = Math.min(sourceProjects.length, targetProjects.length);
        
        if (activityStrength >= this.activityThreshold) {
          activities.push({
            sourceCluster: sourceId,
            targetCluster: targetId,
            count: activityStrength,
            projects: [...sourceProjects, ...targetProjects]
          });
        }
      }
    }
    
    // Update stats
    this.updateActivityStats(projectsInWindow.length, activities.length);
    
    return activities;
  }

  private updateActivityStats(projectsInWindow: number, activePathways: number): void {
    const projectsEl = document.getElementById('projectsInWindow');
    const pathwaysEl = document.getElementById('activePathways');
    const particlesEl = document.getElementById('particleCount');
    const cooldownEl = document.getElementById('cooldownCount');
    
    // Count active cooldowns
    let activeCooldowns = 0;
    for (const cooldown of this.pathwayCooldowns.values()) {
      const timeSinceLastTrigger = this.currentYear - cooldown.lastTriggerTime;
      if (timeSinceLastTrigger < cooldown.cooldownDuration) {
        activeCooldowns++;
      }
    }
    
    if (projectsEl) projectsEl.textContent = projectsInWindow.toString();
    if (pathwaysEl) pathwaysEl.textContent = activePathways.toString();
    if (particlesEl) particlesEl.textContent = this.particles.length.toString();
    if (cooldownEl) cooldownEl.textContent = activeCooldowns.toString();
  }

  private getPathwayKey(sourceCluster: number, targetCluster: number): string {
    // Ensure consistent key regardless of source/target order
    const [a, b] = sourceCluster < targetCluster ? [sourceCluster, targetCluster] : [targetCluster, sourceCluster];
    return `${a}-${b}`;
  }

  private isPathwayOnCooldown(sourceCluster: number, targetCluster: number): boolean {
    const key = this.getPathwayKey(sourceCluster, targetCluster);
    const cooldown = this.pathwayCooldowns.get(key);
    
    if (!cooldown) return false;
    
    const timeSinceLastTrigger = this.currentYear - cooldown.lastTriggerTime;
    return timeSinceLastTrigger < cooldown.cooldownDuration;
  }

  private triggerPathway(sourceCluster: number, targetCluster: number): void {
    const key = this.getPathwayKey(sourceCluster, targetCluster);
    
    // Set cooldown
    this.pathwayCooldowns.set(key, {
      sourceCluster,
      targetCluster,
      lastTriggerTime: this.currentYear,
      cooldownDuration: this.PATHWAY_COOLDOWN_DURATION
    });
    
    // Spawn particle batch
    this.spawnParticleBatch(sourceCluster, targetCluster);
  }

  private spawnParticleBatch(sourceCluster: number, targetCluster: number): void {
    if (!this.data) return;
    
    const sourceClusterData = this.data.clusters.find(c => c.id === sourceCluster);
    const targetClusterData = this.data.clusters.find(c => c.id === targetCluster);
    
    if (!sourceClusterData || !targetClusterData) return;
    
    const [sourceX, sourceY] = this.worldToScreen(sourceClusterData.centroidX, sourceClusterData.centroidY);
    const [targetX, targetY] = this.worldToScreen(targetClusterData.centroidX, targetClusterData.centroidY);
    
    // Spawn a deliberate batch of particles
    for (let i = 0; i < this.PARTICLES_PER_PATHWAY; i++) {
      // Stagger spawn times slightly for wave effect
      setTimeout(() => {
        const angle = (Math.PI * 2 * i) / this.PARTICLES_PER_PATHWAY;
        const radius = 25;
        const spawnX = sourceX + Math.cos(angle) * radius;
        const spawnY = sourceY + Math.sin(angle) * radius;
        
        const particle: Particle = {
          id: `${sourceCluster}-${targetCluster}-${Date.now()}-${i}`,
          x: spawnX,
          y: spawnY,
          targetX: targetX,
          targetY: targetY,
          sourceCluster: sourceCluster,
          targetCluster: targetCluster,
          speed: this.PARTICLE_SPEED + Math.random() * 0.5,
          life: this.PARTICLE_LIFE,
          maxLife: this.PARTICLE_LIFE,
          color: this.getClusterColor(sourceCluster)
        };
        
        this.particles.push(particle);
      }, i * 200); // 200ms stagger between particles
    }
  }

  private spawnParticles(activities: CrossClusterActivity[]): void {
    if (!this.data) return;
    
    for (const activity of activities) {
      // Check if this pathway is on cooldown
      if (this.isPathwayOnCooldown(activity.sourceCluster, activity.targetCluster)) {
        continue; // Skip this pathway - still cooling down
      }
      
      // Trigger one-time pathway activation
      this.triggerPathway(activity.sourceCluster, activity.targetCluster);
      
      console.log(`🚀 Pathway triggered: ${activity.sourceCluster} → ${activity.targetCluster} (strength: ${activity.count})`);
    }
  }

  private getClusterColor(clusterId: number): string {
    // Generate colors based on cluster ID for consistency
    const hue = (clusterId * 137.508) % 360; // Golden angle approximation
    return `hsl(${hue}, 70%, 60%)`;
  }

  private updateParticles(): void {
    this.particles = this.particles.filter(particle => {
      // Move particle toward target
      const dx = particle.targetX - particle.x;
      const dy = particle.targetY - particle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > particle.speed) {
        particle.x += (dx / distance) * particle.speed;
        particle.y += (dy / distance) * particle.speed;
        
        // Add to trail
        this.addToTrail(particle);
        
        particle.life--;
        return particle.life > 0;
      } else {
        // Particle reached target
        return false;
      }
    });
  }

  private addToTrail(particle: Particle): void {
    const trailKey = `${particle.sourceCluster}-${particle.targetCluster}`;
    
    if (!this.trails.has(trailKey)) {
      this.trails.set(trailKey, {
        points: [],
        sourceCluster: particle.sourceCluster,
        targetCluster: particle.targetCluster,
        strength: 0,
        lastActivity: this.currentYear
      });
    }
    
    const trail = this.trails.get(trailKey)!;
    trail.points.push({
      x: particle.x,
      y: particle.y,
      alpha: 0.3
    });
    
    trail.strength = Math.min(trail.strength + 0.01, 1.0);
    trail.lastActivity = this.currentYear;
    
    // Limit trail length
    if (trail.points.length > 200) {
      trail.points.shift();
    }
  }

  private updateTrails(): void {
    for (const [key, trail] of this.trails.entries()) {
      // Fade trail points
      trail.points.forEach(point => {
        point.alpha *= this.TRAIL_FADE_RATE;
      });
      
      // Remove very faded points
      trail.points = trail.points.filter(point => point.alpha > 0.01);
      
      // Fade trail strength if no recent activity
      const timeSinceActivity = this.currentYear - trail.lastActivity;
      if (timeSinceActivity > this.WINDOW_SIZE) {
        trail.strength *= 0.995;
      }
      
      // Remove trails that are too weak
      if (trail.strength < this.TRAIL_MIN_STRENGTH && trail.points.length === 0) {
        this.trails.delete(key);
      }
    }
  }

  private updateActiveProjects(): void {
    if (!this.data) return;
    
    // Add projects for current year
    const newProjects = this.data.projects.filter(p => p.year === Math.floor(this.currentYear));
    
    for (const project of newProjects) {
      this.activeProjects.set(project.id, project);
    }
    
    // Keep projects for a few years for visualization
    const cutoffYear = this.currentYear - 5;
    for (const [id, project] of this.activeProjects.entries()) {
      if (project.year < cutoffYear) {
        this.activeProjects.delete(id);
      }
    }
  }

  private renderProjects(): void {
    if (!this.data) return;
    
    this.ctx.save();
    
    // Render very faint dots for active projects
    for (const project of this.activeProjects.values()) {
      const [screenX, screenY] = this.worldToScreen(project.x, project.y);
      
      const age = this.currentYear - project.year;
      const alpha = Math.max(0.1, 1 - (age / 5)); // Fade over 5 years
      
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, 1.5, 0, 2 * Math.PI);
      this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
      this.ctx.fill();
    }
    
    this.ctx.restore();
  }

  private renderClusterBoundaries(): void {
    if (!this.data) return;
    
    this.ctx.save();
    
    // Draw very subtle cluster boundaries
    for (const cluster of this.data.clusters) {
      const [centerX, centerY] = this.worldToScreen(cluster.centroidX, cluster.centroidY);
      
      // Draw cluster region (approximate with circle)
      const radius = Math.sqrt(cluster.projectCount) * 3;
      
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      this.ctx.strokeStyle = `rgba(255, 255, 255, 0.1)`;
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      
      // Draw cluster centroid
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, 2, 0, 2 * Math.PI);
      this.ctx.fillStyle = `rgba(255, 255, 255, 0.4)`;
      this.ctx.fill();
    }
    
    this.ctx.restore();
  }

  private renderTrails(): void {
    this.ctx.save();
    
    for (const trail of this.trails.values()) {
      if (trail.points.length < 2) continue;
      
      this.ctx.beginPath();
      this.ctx.moveTo(trail.points[0].x, trail.points[0].y);
      
      for (let i = 1; i < trail.points.length; i++) {
        this.ctx.lineTo(trail.points[i].x, trail.points[i].y);
      }
      
      const color = this.getClusterColor(trail.sourceCluster);
      const alpha = trail.strength * 0.6;
      
      this.ctx.strokeStyle = color.replace('60%)', `60%, ${alpha})`);
      this.ctx.lineWidth = 2 * trail.strength;
      this.ctx.stroke();
    }
    
    this.ctx.restore();
  }

  private renderParticles(): void {
    this.ctx.save();
    
    for (const particle of this.particles) {
      const alpha = particle.life / particle.maxLife;
      
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, 3, 0, 2 * Math.PI);
      
      const color = particle.color.replace('60%)', `60%, ${alpha})`);
      this.ctx.fillStyle = color;
      this.ctx.fill();
      
      // Add glow effect
      this.ctx.shadowColor = particle.color;
      this.ctx.shadowBlur = 8 * alpha;
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }
    
    this.ctx.restore();
  }

  private updateYearDisplay(): void {
    const yearDisplay = document.getElementById('yearDisplay') as HTMLElement;
    yearDisplay.textContent = Math.floor(this.currentYear).toString();
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    this.updateActiveProjects();
    
    // Detect cross-cluster activity and spawn particles
    const activities = this.detectCrossClusterActivity();
    this.spawnParticles(activities);
    
    // Update systems
    this.updateParticles();
    this.updateTrails();
    
    // Render layers
    this.renderClusterBoundaries();
    this.renderProjects();
    this.renderTrails();
    this.renderParticles();
    
    this.updateYearDisplay();
  }

  private animate(): void {
    if (!this.isPlaying) return;
    
    const deltaTime = this.YEAR_DURATION / this.speed;
    this.currentYear += 1 / (deltaTime / 16.67); // Assuming 60fps
    
    if (this.currentYear > this.END_YEAR) {
      this.currentYear = this.START_YEAR;
      this.activeProjects.clear();
      this.particles = [];
      this.trails.clear();
      this.pathwayCooldowns.clear(); // Reset cooldowns on restart
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
}

// Initialize the pathways visualization
new ConversationPathways();