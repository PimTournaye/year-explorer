import type { ClusteredData, AgentSpawnData, Bridge } from './data/interfaces';
import { ParticleSystem } from './systems/ParticleSystem';
import { GPUSystem } from './systems/GPUSystem';

export class Simulation {
  private particleSystem: ParticleSystem;
  private gpuSystem: GPUSystem;
  private data: ClusteredData;
  private bridgeData: Bridge[];

  // Building bridge data into the simulation at the start
  private pathwayLastHighlighted: Map<string, number> = new Map(); // Maps "source-target" to first appearance year

  // Simulation state
  public currentYear: number = 1981; // Start year

  // Protagonist cluster system
  private protagonistClusters: number[] = [];
  private lastTrioSwapYear: number = 0;
  
  // Protagonist cluster colors
  public readonly PROTAGONIST_COLORS = ['#db4135', '#ecb92e', '#101d43'];

  // Animation parameters (moved from SemanticGarden)
  public readonly START_YEAR = 1981;
  public readonly END_YEAR = 2025;
  public readonly YEAR_DURATION = 12000;

  // Zeitgeist Model - Projects are only active for a limited time window
  public readonly PROJECT_ACTIVE_WINDOW_YEARS = 5.0; // Projects fade after this period

  // Agent hierarchy configuration
  private readonly ECOSYSTEM_BRIGHTNESS = 0.6; // Increased brightness for better visibility
  private readonly FRONTIER_BRIGHTNESS = 1.0; // Full brightness for protagonist Frontier agents

  // Scoring weights for selecting Frontier agents
  private readonly W_RECENCY = 1.2;
  private readonly W_INTENSITY = 1.5; // Increased from 1.0 for better narrative momentum
  private readonly W_BRIDGE_BUILDING = 0.5;

  // Agent configuration
  private readonly AGENT_SPEED = 3.0; // Base speed for agents
  private readonly MAX_TOTAL_AGENTS = 600; // Increased from 500 to 600 for high density
  private readonly MAX_AGENTS_PER_FRAME = 30; // Increased from 350 to 30 for better control
  private readonly MIN_SPAWN_SIMILARITY = 0.68;
  
  // Time-based scaling configuration
  private readonly RAMP_UP_START_YEAR = 10; // Start ramping up after 10 years (1991)
  private readonly RAMP_UP_DURATION_YEARS = 15; // Reach full intensity by year 25 (2006)
  
  // --- New Lifespan Controls ---
  private readonly ECOSYSTEM_LIFESPAN_MIN = 3000; // frames
  private readonly ECOSYSTEM_LIFESPAN_MAX = 9000; // frames
  private readonly FRONTIER_LIFESPAN_MIN = 8000; // frames
  private readonly FRONTIER_LIFESPAN_MAX = 12500; // frames

  // Canvas dimensions for bounds checking
  private width: number;
  private height: number;

  private lastYearProcessed: number = 0;

  constructor(
    particleSystem: ParticleSystem,
    gpuSystem: GPUSystem,
    data: ClusteredData,
    bridgeData: Bridge[],
    width: number,
    height: number
  ) {
    this.particleSystem = particleSystem;
    this.gpuSystem = gpuSystem;
    this.data = data;
    this.bridgeData = bridgeData;
    this.width = width;
    this.height = height;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /**
   * Get current protagonist clusters with their information
   */
  public getProtagonistClusters(): Array<{id: number, color: string, name: string}> {
    return this.protagonistClusters.map((clusterId, index) => {
      const cluster = this.data.clusters.find(c => c.id === clusterId);
      return {
        id: clusterId,
        color: this.PROTAGONIST_COLORS[index] || '#666666',
        name: cluster?.topTerms?.[0] || `Cluster ${clusterId}`
      };
    });
  }

  /**
   * Get the color for a specific cluster if it's a protagonist cluster
   */
  public getClusterColor(clusterId: number): string | null {
    const index = this.protagonistClusters.indexOf(clusterId);
    return index >= 0 ? this.PROTAGONIST_COLORS[index] : null;
  }

  public update(): void {

    // --- SECTION 1: PER-FRAME LOGIC ---

    // Update particle system with temporal window
    this.particleSystem.update(this.currentYear, this.PROJECT_ACTIVE_WINDOW_YEARS);

    // Clean up expired frontier agent counts periodically
    this.cleanupFrontierAgents();

    


    // --- SECTION 2: YEARLY TICK LOGIC ---
    // We have already processed this year, so we don't spawn new agents.
    const currentSimYear = Math.floor(this.currentYear);
    if (currentSimYear <= this.lastYearProcessed) return;
  
    // Check if we need to swap protagonist clusters every 5 years
    if (currentSimYear - this.lastTrioSwapYear >= 5 || this.protagonistClusters.length === 0) {
      this.selectNewProtagonistClusters();
      this.lastTrioSwapYear = currentSimYear;
      console.log(`New Protagonist Clusters: ${this.protagonistClusters.join(', ')}`);
    }

    // Detect cross-cluster activity for pathways
    let bridgesInWindow = this.findBridgesInWindow();
    
    // Note: We don't return early if no bridges, because we still want to spawn wandering agents


    // --- 2. Apply the Hard Caps with Time-Based Scaling ---
    const currentAgentCount = this.gpuSystem.getActiveAgentCount();
    const availableSlots = this.MAX_TOTAL_AGENTS - currentAgentCount;
    const timeScaling = this.calculateTimeBasedScaling();
    const scaledMaxAgentsPerFrame = Math.max(1, Math.round(this.MAX_AGENTS_PER_FRAME * timeScaling));

    if (bridgesInWindow.length > availableSlots) {
      // If we have more potential spawns than available slots,
      // prioritize the best ones by sorting by similarity score.
      bridgesInWindow.sort((a, b) => b.similarity_score - a.similarity_score);
      bridgesInWindow = bridgesInWindow.slice(0, availableSlots);
    }

    if (bridgesInWindow.length > scaledMaxAgentsPerFrame) {
      // Further cap the number of spawns in this single frame using time-scaled limit.
      bridgesInWindow = bridgesInWindow.slice(0, scaledMaxAgentsPerFrame);
    }

    // --- 3. Proceed with the (now strictly limited) list of bridges ---
    const frontierBridge = this.selectFrontierBridge(bridgesInWindow);
    // Filter ecosystem bridges to only include those from protagonist clusters
    const ecosystemBridges = bridgesInWindow.filter(b => 
      b !== frontierBridge && this.protagonistClusters.includes(b.source_cluster)
    );

    // Spawn agents directly into GPU textures for detected pathway activities
    const agentSpawns = this.createAgentSpawnData(frontierBridge, ecosystemBridges);

    if (agentSpawns.length > 0) this.gpuSystem.spawnAgents(agentSpawns);

    // Mark this year as processed.
    this.lastYearProcessed = currentSimYear;
  }

  private calculateRecencyScore(sourceCluster: number, targetCluster: number): number {
    const key = this.createPathwayKey(sourceCluster, targetCluster);
    if (!this.pathwayLastHighlighted.has(key)) {
      return 1.0; // Max score for brand new pathways.
    }

    const lastHighlightedYear = this.pathwayLastHighlighted.get(key)!;
    const yearsSinceHighlighted = this.currentYear - lastHighlightedYear;

    if (yearsSinceHighlighted < 1.0) return 0.0;

    // Use a logarithmic scale. A 25-year dormancy is like new again.
    const recencyScore = Math.log(1.0 + yearsSinceHighlighted) / Math.log(25.0);
    return Math.max(0.0, Math.min(recencyScore, 1.0));
  }

  private calculateBridgeBuildingScore(sourceClusterId: number, targetClusterId: number): number {
    const clusters = this.particleSystem.getClusters();
    const sourceCluster = clusters.get(sourceClusterId);
    const targetCluster = clusters.get(targetClusterId);

    if (!sourceCluster || !targetCluster) return 0.0;

    const dx = sourceCluster.centerX - targetCluster.centerX;
    const dy = sourceCluster.centerY - targetCluster.centerY;
    const distance = Math.hypot(dx, dy);

    // Normalize by the max possible distance (diagonal of the canvas).
    const maxDistance = Math.hypot(this.width, this.height);
    return distance / maxDistance;
  }

  private selectFrontierBridge(bridgesInWindow: Bridge[]): Bridge | null {
    if (bridgesInWindow.length === 0) {
      return null;
    }

    // Filter bridges to only include those from protagonist clusters
    const protagonistBridges = bridgesInWindow.filter(bridge => 
      this.protagonistClusters.includes(bridge.source_cluster)
    );
    
    if (protagonistBridges.length === 0) {
      return null; // No bridges from protagonist clusters
    }

    let frontierBridge: Bridge | null = null;
    let highestScore = -Infinity;

    // Evaluate each bridge and find the one with the highest combined score
    for (const bridge of protagonistBridges) {
      // Calculate recency score - how long since this pathway was last highlighted
      const recencyScore = this.calculateRecencyScore(bridge.source_cluster, bridge.target_cluster);

      // Intensity score comes directly from the bridge similarity data
      const intensityScore = bridge.similarity_score;

      // Bridge building score - favors connections between distant clusters
      const bridgeBuildingScore = this.calculateBridgeBuildingScore(bridge.source_cluster, bridge.target_cluster);

      // Combine all scores using weighted formula
      const finalScore = (recencyScore * this.W_RECENCY) +
        (intensityScore * this.W_INTENSITY) +
        (bridgeBuildingScore * this.W_BRIDGE_BUILDING);

      // Track the bridge with the highest score
      if (finalScore > highestScore) {
        highestScore = finalScore;
        frontierBridge = bridge;
      }
    }

    // Record that this pathway just got highlighted
    if (frontierBridge) {
      const key = this.createPathwayKey(frontierBridge.source_cluster, frontierBridge.target_cluster);
      this.pathwayLastHighlighted.set(key, this.currentYear);
    }

    return frontierBridge;
  }

  /**
   * Randomly selects 3 unique clusters to be the protagonists for the next 5-year period
   * Only selects clusters that have active projects in the current time window
   */
  private selectNewProtagonistClusters(): void {
    const windowStart = this.currentYear - this.PROJECT_ACTIVE_WINDOW_YEARS;
    const windowEnd = this.currentYear;
    
    // Find clusters that have projects with years in the active window
    const clustersWithActiveProjects = this.data.clusters.filter(cluster => {
      return this.data.projects.some(project => 
        project.cluster_id === cluster.id && 
        project.year >= windowStart && 
        project.year <= windowEnd
      );
    });
    
    const availableClusterIds = clustersWithActiveProjects.map(cluster => cluster.id);
    const selectedClusters: number[] = [];
    
    // Randomly select up to 3 unique clusters from those with active projects
    while (selectedClusters.length < 3 && availableClusterIds.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableClusterIds.length);
      const selectedCluster = availableClusterIds.splice(randomIndex, 1)[0];
      selectedClusters.push(selectedCluster);
    }
    
    this.protagonistClusters = selectedClusters;
    
    // Log if we couldn't find 3 active clusters
    if (selectedClusters.length < 3) {
      console.warn(`Only found ${selectedClusters.length} clusters with active projects in year ${Math.floor(this.currentYear)}`);
    }
  }

  /**
   * Detects cross-cluster activities based on project data and bridge data.
   * Filters the bridges dats to return only those bridges whose year falls within the currentYear's active window.
   */
  private findBridgesInWindow(): Bridge[] {
    const windowStart = this.currentYear - this.PROJECT_ACTIVE_WINDOW_YEARS;
    const windowEnd = this.currentYear;

    const bridgesInTime = this.bridgeData.filter(bridge =>
      bridge.year >= windowStart && bridge.year <= windowEnd
    );

    const highQualityBridges = bridgesInTime.filter(b => b.similarity_score > this.MIN_SPAWN_SIMILARITY);

    // TEMPORARY DEBUG LOG
    if (highQualityBridges.length > 0) {
      console.log(`Year ${Math.floor(this.currentYear)}: Found ${highQualityBridges.length} high-quality bridges.`);
    }

    return highQualityBridges;
  }

  // This creates a unique sorted key for each pathway / source-target pair
  private createPathwayKey(sourceCluster: number, targetCluster: number): string {
    return `${Math.min(sourceCluster, targetCluster)}-${Math.max(sourceCluster, targetCluster)}`;
  }

  /**
   * Calculate time-based scaling factor for agent spawning
   * Returns 0.1 at start, gradually increases to 1.0 over RAMP_UP_DURATION_YEARS
   */
  private calculateTimeBasedScaling(): number {
    const yearsElapsed = this.currentYear - this.START_YEAR;
    
    // Before ramp-up period: very low spawning (10%)
    if (yearsElapsed < this.RAMP_UP_START_YEAR) {
      return 0.1;
    }
    
    // During ramp-up period: gradually increase from 10% to 100%
    const rampUpProgress = (yearsElapsed - this.RAMP_UP_START_YEAR) / this.RAMP_UP_DURATION_YEARS;
    if (rampUpProgress < 1.0) {
      return 0.1 + (0.9 * rampUpProgress); // Smooth transition from 0.1 to 1.0
    }
    
    // After ramp-up: full intensity
    return 1.0;
  }

  private buildAgentData(
    bridge: Bridge,
    isFrontier: boolean,
    projectPositions: Map<string, { x: number; y: number }>,
    clusterCentroids: Map<number, any>
  ): AgentSpawnData | null {
    const sourcePosition = projectPositions.get(bridge.project_id.toString());
    const targetCentroid = clusterCentroids.get(bridge.target_cluster);

    // If we can't find coordinates, we cannot create an agent.
    if (!sourcePosition || !targetCentroid) {
      console.warn(`Could not find screen positions for bridge from project ${bridge.project_id}.`);
      return null;
    }

    // Give agents a more noisy starting position
    sourcePosition.x += (Math.random() - 0.5) * 50; // Random offset in x
    sourcePosition.y += (Math.random() - 0.5) * 50; // Random offset in y

    // --- Agent speed and lifespan configuration ---
    let agentSpeed = this.AGENT_SPEED;
    let maxAge: number;

    if (isFrontier) {
      agentSpeed *= 1.5; // Frontier agents are fastest
      maxAge = this.FRONTIER_LIFESPAN_MIN + Math.random() * (this.FRONTIER_LIFESPAN_MAX - this.FRONTIER_LIFESPAN_MIN);
    } else {
      // Bridge Ecosystem agents - all agents are now target-driven
      maxAge = this.ECOSYSTEM_LIFESPAN_MIN + Math.random() * (this.ECOSYSTEM_LIFESPAN_MAX - this.ECOSYSTEM_LIFESPAN_MIN);
    }

    // Add a small random offset to the speed for variation
    agentSpeed += (Math.random() - 0.5) * 0.5;

    // --- Physics - All agents are target-driven ---
    const dx = targetCentroid.centerX - sourcePosition.x;
    const dy = targetCentroid.centerY - sourcePosition.y;
    const distance = Math.hypot(dx, dy) || 1;
    const vx = (dx / distance) * agentSpeed;
    const vy = (dy / distance) * agentSpeed;

    // --- Visuals ---
    const clusterHue = (bridge.source_cluster * 137.508) % 360;

    // --- UI & Narrative (only for Frontier agents) ---
    let directive_verb: string | undefined;
    let directive_noun: string | undefined;
    let projectTitle: string | undefined;
    let sourceClusterName: string | undefined;
    let sourceClusterColor: string | undefined;

    if (isFrontier) {
      directive_verb = this.getRandomDirectiveVerb();
      directive_noun = this.getDirectiveNoun(bridge.target_cluster);
      
      // Find the project title
      const project = this.data.projects.find(p => parseInt(p.id) === bridge.project_id);
      projectTitle = project ? project.title : `Project ${bridge.project_id}`;
      
      // Find source cluster information
      const sourceCluster = this.data.clusters.find(c => c.id === bridge.source_cluster);
      sourceClusterName = sourceCluster?.topTerms?.[0] || `Cluster ${bridge.source_cluster}`;
      sourceClusterColor = this.getClusterColor(bridge.source_cluster) || '#666666';
    }

    return {
      x: sourcePosition.x,
      y: sourcePosition.y,
      vx: vx,
      vy: vy,
      targetClusterX: targetCentroid.centerX,
      targetClusterY: targetCentroid.centerY,
      age: 0,
      maxAge: maxAge,
      isFrontier: isFrontier,
      brightness: isFrontier ? this.FRONTIER_BRIGHTNESS : this.ECOSYSTEM_BRIGHTNESS,
      clusterHue: clusterHue,
      sourceClusterId: bridge.source_cluster,
      targetClusterId: bridge.target_cluster,
      directive_verb: directive_verb,
      directive_noun: directive_noun,
      projectTitle: projectTitle,
      sourceClusterName: sourceClusterName,
      sourceClusterColor: sourceClusterColor,
    };
  }

  /**
   * Gets the primary theme for a cluster and truncates it.
   */
  private getDirectiveNoun(targetClusterId: number): string {
    const MAX_LABEL_WORDS = 5;
    const targetClusterData = this.data.clusters.find(c => c.id === targetClusterId);
    let noun = targetClusterData?.topTerms[0] || `cluster ${targetClusterId}`;

    if (noun.split(' ').length > MAX_LABEL_WORDS) {
      noun = noun.split(' ').slice(0, MAX_LABEL_WORDS).join(' ') + '...';
    }
    return noun;
  }

  /**
   * Returns a random verb for a Frontier agent's directive.
   */
  private getRandomDirectiveVerb(): string {
    const choices = [
      'seeking', 'exploring', 'navigating', 'pursuing', 'musing over',
      'pondering', 'examining', 'reflecting on', 'considering', 'contemplating'
    ];
    return choices[Math.floor(Math.random() * choices.length)];
  }


  private createAgentSpawnData(frontierBridge: Bridge | null, ecosystemBridges: Bridge[]): AgentSpawnData[] {
    // Initialize the array to collect all agent spawn data
    const allSpawnData: AgentSpawnData[] = [];

    // Get scaled xy positions and cluster centroids from the particle system
    const projectScreenPositions = this.particleSystem.getProjectScreenPositions();
    const clusterCentroids = this.particleSystem.getClusters();
    // Get existing frontier agent mirrors to avoid duplicates and enforce limits
    const currentMirrors = this.gpuSystem.getFrontierAgentMirrors();
    const existingNouns = new Set(currentMirrors.map(m => m.directive_noun));

    // Process the Frontier Agent (protagonist agent with highest priority)
    if (frontierBridge) {
      const noun = this.getDirectiveNoun(frontierBridge.target_cluster);

      // Gatekeeper checks: determine if this bridge *qualifies* to create a Frontier Agent
      // FRONTIER AGENTS ONLY: Limited to 10 total, must have unique directives for narrative clarity
      const canBeFrontier = currentMirrors.length < 10 && !existingNouns.has(noun);
      
      // The agent's role (and its data) is determined by the gatekeeper checks
      const agentData = this.buildAgentData(
        frontierBridge,
        canBeFrontier,
        projectScreenPositions,
        clusterCentroids
      );

      if (agentData) allSpawnData.push(agentData);
    }

    // Process all Ecosystem Agents with HIGH-DENSITY SPAWNING
    // ECOSYSTEM AGENTS: No limit on count - can spawn many agents for rich visual density
    const timeScaling = this.calculateTimeBasedScaling();
    console.log(`📈 Year ${Math.floor(this.currentYear)}: Time-based scaling factor: ${timeScaling.toFixed(2)}`);
    
    for (const bridge of ecosystemBridges) {
      // --- HIGH-DENSITY SPAWN: Multiple agents per bridge for visual richness ---
      
      // We'll set a base number and add more based on the connection's strength.
      const BASE_ECO_AGENTS_PER_BRIDGE = 2;
      const MAX_BONUS_AGENTS = 5; // Max bonus for a perfect similarity score

      const scoreRange = 1.0 - this.MIN_SPAWN_SIMILARITY;
      const normalizedScore = (bridge.similarity_score - this.MIN_SPAWN_SIMILARITY) / scoreRange;
      
      const bonusAgents = Math.round(normalizedScore * MAX_BONUS_AGENTS);
      const baseNumToSpawn = BASE_ECO_AGENTS_PER_BRIDGE + bonusAgents;
      
      // Apply time-based scaling
      const numToSpawn = Math.max(1, Math.round(baseNumToSpawn * timeScaling));
      
      // Debug: log if we find any same-cluster bridges (shouldn't happen now)
      if (bridge.source_cluster === bridge.target_cluster) {
        console.warn(`Found same-cluster bridge: ${bridge.source_cluster} -> ${bridge.target_cluster}`);
      }
      
      // ---

      for (let i = 0; i < numToSpawn; i++) {
        const agentData = this.buildAgentData(
          bridge,
          false, // Always an Ecosystem agent
          projectScreenPositions,
          clusterCentroids
        );

        if (agentData) {
          // --- Short, varied lifespan for high turnover ---
          agentData.maxAge = this.ECOSYSTEM_LIFESPAN_MIN + Math.random() * (this.ECOSYSTEM_LIFESPAN_MAX - this.ECOSYSTEM_LIFESPAN_MIN) * 0.5;
          allSpawnData.push(agentData);
        }
      }
    }
    // Return all collected spawn data
    return allSpawnData;
  }

  // Clean up frontier agent tracking when agents die
  private cleanupFrontierAgents(): void {
    const deadAgents = this.gpuSystem.getDeadFrontierAgents();
    for (const mirror of deadAgents) {
      const key = this.createPathwayKey(mirror.sourceClusterId, mirror.targetClusterId);
      this.pathwayLastHighlighted.delete(key);
    }
  }
}
