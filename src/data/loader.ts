import type { Project, ClusterData, ClusteredData, Bridge } from './interfaces';

export async function loadData(): Promise<ClusteredData> {
  try {
    const response = await fetch('/thesis_analysis_kmeans.json');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const projects = await response.json() as Project[];
    console.log(`🚀 Loaded ${projects.length} projects`);
    
    // Generate clusters from project data
    const clusterMap = new Map<number, Project[]>();
    projects.forEach(project => {
      if (!clusterMap.has(project.cluster_id)) {
        clusterMap.set(project.cluster_id, []);
      }
      clusterMap.get(project.cluster_id)!.push(project);
    });
    
    const clusters: ClusterData[] = [];
    clusterMap.forEach((clusterProjects, clusterId) => {
      // Calculate centroid from project positions
      const centroidX = clusterProjects.reduce((sum, p) => sum + p.x, 0) / clusterProjects.length;
      const centroidY = clusterProjects.reduce((sum, p) => sum + p.y, 0) / clusterProjects.length;
      
      // Get year range
      const years = clusterProjects.map(p => p.year);
      const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];
      
      // Get top themes (simplified)
      const allThemes = clusterProjects.flatMap(p => p.themes);
      const topThemes = [...new Set(allThemes)].slice(0, 3);
      
      clusters.push({
        id: clusterId,
        centroid768d: [], // Not needed for visualization
        centroidX,
        centroidY,
        projectCount: clusterProjects.length,
        yearRange,
        topTerms: topThemes
      });
    });
    
    // Convert cluster_id to clusterId for compatibility
    const normalizedProjects = projects.map(p => ({
      ...p,
      clusterId: p.cluster_id
    }));
    
    const result = {
      projects: normalizedProjects,
      clusters
    };
    
    console.log(`📊 Generated ${clusters.length} clusters from project data`);
    return result;
    
  } catch (error) {
    console.error('❌ Failed to load clustered data:', error);
    throw error;
  }
}

export async function loadBridgeData(): Promise<Bridge[]> {
  try {
    const response = await fetch('/bridge_analysis.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const bridges = await response.json() as Bridge[];
    console.log(`🚀 Loaded ${bridges.length} bridges`);
    return bridges;
  } catch (error) {
    console.error('❌ Failed to load bridge data:', error);
    throw error;
  }
}