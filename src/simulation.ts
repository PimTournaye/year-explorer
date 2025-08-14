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
  public currentYear: number = 1985;

  // Animation parameters (moved from SemanticGarden)
  public readonly START_YEAR = 1985;
  public readonly END_YEAR = 2025;
  public readonly YEAR_DURATION = 12000; // 12 seconds per year for contemplative pacing

  // Zeitgeist Model - Projects are only active for a limited time window
  public readonly PROJECT_ACTIVE_WINDOW_YEARS = 5.0; // Projects fade after this period

  // Agent hierarchy configuration
  private readonly ECOSYSTEM_BRIGHTNESS = 0.3; // Dim brightness for background ecosystem agents
  private readonly FRONTIER_BRIGHTNESS = 1.0; // Full brightness for protagonist Frontier agents

  // Scoring weights for selecting Frontier agents
  private readonly W_RECENCY = 1.5;
  private readonly W_INTENSITY = 1.0;
  private readonly W_BRIDGE_BUILDING = 0.5;

  // Agent configuration
  private readonly AGENT_SPEED = 1.5;
  private readonly AGENT_LIFESPAN = 400; // frames

  // Canvas dimensions for bounds checking
  private width: number;
  private height: number;

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

  public update(): void {
    // Update particle system with Zeitgeist temporal window
    this.particleSystem.update(this.currentYear, this.PROJECT_ACTIVE_WINDOW_YEARS);

    // Detect cross-cluster activity for pathways
    const bridgesInWindow = this.findBridgesInWindow();

    if (bridgesInWindow.length === 0) return; // Nothing to do if there are no active bridges

    // If there are connections, start selecting agents as frontier agents
    const frontierBridge = this.selectFrontierBridge(bridgesInWindow);
    const ecosystemBridges = bridgesInWindow.filter(bridge => bridge !== frontierBridge);

    // Spawn agents directly into GPU textures for detected pathway activities
    const agentSpawns = this.createAgentSpawnData(frontierBridge, ecosystemBridges);

    if (agentSpawns.length > 0) {
      this.gpuSystem.spawnAgents(agentSpawns);
    }

    // Clean up expired frontier agent counts periodically
    this.cleanupFrontierAgents();
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

    let frontierBridge: Bridge | null = null;
    let highestScore = -Infinity;

    // Evaluate each bridge and find the one with the highest combined score
    for (const bridge of bridgesInWindow) {
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
   * Detects cross-cluster activities based on project data and bridge data.
   * Filters the bridges dats to return only those bridges whose year falls within the currentYear's active window.
   */
  private findBridgesInWindow() {
    const windowStart = this.currentYear - this.PROJECT_ACTIVE_WINDOW_YEARS;
    const windowEnd = this.currentYear;

    return this.bridgeData.filter(bridge =>
      bridge.year >= windowStart && bridge.year <= windowEnd
    );
  }

  // This creates a unique sorted key for each pathway / source-target pair
  private createPathwayKey(sourceCluster: number, targetCluster: number): string {
    return `${Math.min(sourceCluster, targetCluster)}-${Math.max(sourceCluster, targetCluster)}`;
  }


  private createAgentSpawnData(frontierBridge: Bridge | null, ecosystemBridges: Bridge[]): AgentSpawnData[] {
    // Initialize the array to collect all agent spawn data
    const allSpawnData: AgentSpawnData[] = [];

    // Get scaled xy positions and cluster centroids from the particle system
    const projectScreenPositions = this.particleSystem.getProjectScreenPositions();
    const clusterCentroids = this.particleSystem.getClusters();

    // Get existing frontier agent labels to avoid duplicates
    const currentMirrors = this.gpuSystem.getFrontierAgentMirrors();
    const existingLabels = new Set<string>();
    currentMirrors.forEach(agent => {
      if (agent.label) {
        existingLabels.add(agent.label);
      }
    });

    // Process the Frontier Agent (protagonist agent with highest priority)
    if (frontierBridge !== null) {
      // Look up the source project's position
      const sourcePosition = projectScreenPositions.get(frontierBridge.project_id.toString());

      // Look up the target cluster's centroid position
      const targetPosition = clusterCentroids.get(frontierBridge.target_cluster);

      // If we can't find the coordinates, we can't spawn the agent. Skip and continue.
      if (!sourcePosition || !targetPosition) {
        return allSpawnData;
      } else {
        // Calculate initial velocity
        const dx = targetPosition.centerX - sourcePosition.x;
        const dy = targetPosition.centerY - sourcePosition.y;
        const distance = Math.hypot(dx, dy) || 1; // Avoid division by zero
        const vx = (dx / distance) * this.AGENT_SPEED;
        const vy = (dy / distance) * this.AGENT_SPEED;

        const targetClusterData = this.data.clusters.find(c => c.id === frontierBridge.target_cluster);
        let label = `${targetClusterData?.topTerms[0] || `cluster ${frontierBridge.target_cluster}`}`;

        // 2. Enforce Max Length Rule
        const MAX_LABEL_WORDS = 5;
        if (label.split(' ').length > MAX_LABEL_WORDS) {
          label = label.split(' ').slice(0, MAX_LABEL_WORDS).join(' ') + '...';
        }

        // Check 1: Is the Ledger already full?
        if (currentMirrors.length >= 10 || existingLabels.has(label)) return allSpawnData;

        // Calculate cluster hue for trail coloring
        const clusterHue = (frontierBridge.source_cluster * 137.508) % 360; // not sure about value

        // Check constraints for Frontier Agent
        const maxCountExceeded = this.gpuSystem.getFrontierAgentMirrors().length >= 10;
        const duplicateLabel = existingLabels.has(label);

        // If constraints violated, spawn as Ecosystem agent instead
        if (maxCountExceeded || duplicateLabel) {
          const ecosystemAgent: AgentSpawnData = {
            // Position and Velocity
            x: sourcePosition.x,
            y: sourcePosition.y,
            vx: vx,
            vy: vy,
            // Target (for the CPU mirror)
            targetClusterX: targetPosition.centerX,
            targetClusterY: targetPosition.centerY,
            // Lifespan
            age: 0,
            maxAge: this.AGENT_LIFESPAN,
            // Hierarchy
            isFrontier: false,
            brightness: this.ECOSYSTEM_BRIGHTNESS,
            // Visuals & UI
            clusterHue: clusterHue,
            label: undefined,
            sourceClusterId: frontierBridge.source_cluster,
            targetClusterId: frontierBridge.target_cluster
          };

          allSpawnData.push(ecosystemAgent);
        } else {
          const frontierAgent: AgentSpawnData = {
            // Position and Velocity
            x: sourcePosition.x,
            y: sourcePosition.y,
            vx: vx,
            vy: vy,
            // Target (for the CPU mirror)
            targetClusterX: targetPosition.centerX,
            targetClusterY: targetPosition.centerY,
            // Lifespan
            age: 0,
            maxAge: this.AGENT_LIFESPAN,
            // Hierarchy
            isFrontier: true,
            brightness: this.FRONTIER_BRIGHTNESS,
            // Visuals & UI
            clusterHue: clusterHue,
            label: label,
            sourceClusterId: frontierBridge.source_cluster,
            targetClusterId: frontierBridge.target_cluster
          };

          allSpawnData.push(frontierAgent);
        }
      }
    }

    for (const bridge of ecosystemBridges) {
      // Look up the source project's position
      const sourcePosition = projectScreenPositions.get(bridge.project_id.toString());

      // Look up the target cluster's centroid position
      const targetPosition = clusterCentroids.get(bridge.target_cluster);

      if (sourcePosition && targetPosition) {
        // Calculate velocity vector pointing from source project to target cluster
        const dx = targetPosition.centerX - sourcePosition.x;
        const dy = targetPosition.centerY - sourcePosition.y;
        const distance = Math.hypot(dx, dy) || 1; // Avoid division by zero

        // Normalize and scale by agent speed
        const vx = (dx / distance) * this.AGENT_SPEED;
        const vy = (dy / distance) * this.AGENT_SPEED;

        // Calculate cluster hue for trail coloring
        const clusterHue = (bridge.source_cluster * 137.508) % 360;

        // Create ecosystem agent spawn data (no label needed)
        const ecosystemAgent: AgentSpawnData = {
          // Position and Velocity
          x: sourcePosition.x,
          y: sourcePosition.y,
          vx: vx,
          vy: vy,
          // Target (still needed for potential future debugging or different mirror types)
          targetClusterX: targetPosition.centerX,
          targetClusterY: targetPosition.centerY,
          // Lifespan
          age: 0,
          maxAge: this.AGENT_LIFESPAN,
          // Hierarchy
          isFrontier: false,
          brightness: this.ECOSYSTEM_BRIGHTNESS,
          // Visuals & UI
          clusterHue: clusterHue,
          label: undefined, // Explicitly undefined
          sourceClusterId: bridge.source_cluster,
          targetClusterId: bridge.target_cluster
        };

        allSpawnData.push(ecosystemAgent);
      }
    }
    return allSpawnData;
  }

  // Clean up frontier agent tracking when agents die
  private cleanupFrontierAgents(): void {

  }
}
