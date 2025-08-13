// Centralized TypeScript interfaces for the Semantic Garden application

export interface Project {
  id: string;
  title: string;
  year: number;
  themes: string[];
  embedding: number[];
  x: number;
  y: number;
  cluster_id: number;
  clusterId?: number; // For compatibility
}

export interface ClusterData {
  id: number;
  centroid768d: number[];
  centroidX: number;
  centroidY: number;
  projectCount: number;
  yearRange: [number, number];
  topTerms: string[];
}

export interface ClusteredData {
  projects: Project[];
  clusters: ClusterData[];
}

export interface PersistentParticle {
  id: string;
  project: Project;
  baseX: number;
  baseY: number;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  clusterId: number;
  isActive: boolean;
  birthYear: number;
  phase: number; // For breathing animation
  size: number;
  alpha: number;
}

export interface ClusterInfo {
  id: number;
  centerX: number;
  centerY: number;
  particles: PersistentParticle[];
  breathPhase: number;
  density: number;
  isActive: boolean;
}

// GPU Agent System interfaces
export interface AgentSpawnData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetClusterX: number;
  targetClusterY: number;
  age: number;
  maxAge: number;
}

export interface CrossClusterActivity {
  sourceCluster: number;
  targetCluster: number;
  count: number;
}