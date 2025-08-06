/**
 * Narrative Sequencer - Core timing and action system for mycelial narratives
 */

import type { MycelialNarrative, VisualMoment, Project } from './types/narrative.js';

export interface NarrativeState {
  currentNarrative: number;
  currentTimestamp: number;
  isPlaying: boolean;
  speed: number;
  currentChapter: number;
}

export interface ClusterMapping {
  [clusterId: string]: Project[];
}

export class NarrativeSequencer {
  private narratives: MycelialNarrative[] = [];
  private state: NarrativeState = {
    currentNarrative: 0,
    currentTimestamp: 0,
    isPlaying: true,
    speed: 1.0,
    currentChapter: 0
  };
  
  private animationId: number | null = null;
  private lastFrameTime = 0;
  private clusterMapping: ClusterMapping = {};
  private onVisualAction: ((action: VisualMoment, narrative: MycelialNarrative) => void) | null = null;
  private onStateChange: ((state: NarrativeState, narrative: MycelialNarrative) => void) | null = null;
  private executedActions: Set<string> = new Set(); // Track executed actions to prevent duplicates

  constructor() {}

  /**
   * Initialize sequencer with narrative data and project mapping
   */
  async init(narratives: MycelialNarrative[], projects: Project[]) {
    this.narratives = narratives;
    this.generateClusterMapping(projects);
    console.log(`🔄 Narrative sequencer initialized with ${this.narratives.length} narratives`);
    console.log(`🔄 Generated ${Object.keys(this.clusterMapping).length} cluster mappings`);
  }

  /**
   * Generate mapping from narrative cluster IDs to actual projects
   */
  private generateClusterMapping(projects: Project[]) {
    // This is a simplified mapping strategy - in practice, you might want more sophisticated clustering
    this.clusterMapping = {};

    this.narratives.forEach(narrative => {
      const conceptKeywords = this.getConceptKeywords(narrative.conceptIds);
      
      // Map based on timespan and concept keywords
      const [startYear, endYear] = narrative.timespan;
      
      // Create temporal clusters for this narrative
      const phases = Math.ceil((endYear - startYear) / 5); // 5-year phases
      
      for (let phase = 0; phase < phases; phase++) {
        const phaseStart = startYear + (phase * 5);
        const phaseEnd = Math.min(phaseStart + 5, endYear);
        
        const clusterId = `${narrative.id}-${phaseStart}`;
        
        // Find projects in this time period that match concept keywords
        this.clusterMapping[clusterId] = projects.filter(p => {
          if (p.year < phaseStart || p.year >= phaseEnd) return false;
          
          const text = p.text.toLowerCase();
          return conceptKeywords.some(keyword => text.includes(keyword));
        });
      }

      // Also create frontier mappings for visual sequences
      narrative.visualSequence.forEach(visual => {
        visual.targets.forEach(target => {
          if (!this.clusterMapping[target]) {
            // Create frontier mapping based on target name and narrative context
            this.clusterMapping[target] = this.createFrontierMapping(target, narrative, projects);
            console.log(`🔄 Created mapping for ${target}: ${this.clusterMapping[target].length} projects`);
          }
        });
      });
    });

    // Logging handled by main app
  }

  /**
   * Get relevant keywords for concept matching
   */
  private getConceptKeywords(conceptIds: string[]): string[] {
    const keywordMap: Record<string, string[]> = {
      'artificial-intelligence': ['artificial intelligence', 'ai', 'machine learning', 'neural network', 'expert system', 'deep learning', 'computer vision', 'natural language'],
      'virtual-reality': ['virtual reality', 'vr', 'immersive', 'virtual environment', 'cyberspace', 'head mounted display'],
      'social-networks': ['social network', 'online community', 'social media', 'collaboration', 'social software', 'sharing'],
      'interactive-media': ['interactive', 'multimedia', 'hypermedia', 'user interface', 'interaction design', 'responsive'],
      'surveillance-privacy': ['surveillance', 'privacy', 'security', 'monitoring', 'tracking', 'data collection'],
      'mobile-ubiquitous': ['mobile', 'portable', 'handheld', 'smartphone', 'ubiquitous computing', 'wearable'],
      'digital-art-creativity': ['digital art', 'computer graphics', 'generative art', 'creative coding', 'algorithmic art'],
      'network-connectivity': ['network', 'internet', 'web', 'connectivity', 'distributed', 'peer to peer']
    };

    return conceptIds.flatMap(id => keywordMap[id] || []);
  }

  /**
   * Create frontier mapping for visual sequence targets
   */
  private createFrontierMapping(target: string, narrative: MycelialNarrative, projects: Project[]): Project[] {
    // Extract year from target if possible (e.g., "vr-1990", "ai-frontier-2005")
    const yearMatch = target.match(/(\d{4})/);
    const targetYear = yearMatch ? parseInt(yearMatch[1]) : narrative.timespan[0];
    
    const conceptKeywords = this.getConceptKeywords(narrative.conceptIds);
    
    // Find projects around the target year that match the concept
    return projects.filter(p => {
      const yearDiff = Math.abs(p.year - targetYear);
      if (yearDiff > 3) return false; // Within 3 years
      
      const text = p.text.toLowerCase();
      return conceptKeywords.some(keyword => text.includes(keyword));
    }).slice(0, 20); // Limit to 20 projects for performance
  }

  /**
   * Start narrative playback
   */
  start() {
    if (this.animationId) return;
    
    this.state.isPlaying = true;
    this.lastFrameTime = performance.now();
    console.log(`🚀 Starting narrative sequencer - first narrative: ${this.getCurrentNarrative().title}`);
    
    // Trigger initial state change to update UI
    this.triggerStateChange();
    
    this.animate();
  }

  /**
   * Pause narrative playback
   */
  pause() {
    this.state.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Resume narrative playback
   */
  resume() {
    if (!this.state.isPlaying) {
      this.state.isPlaying = true;
      this.lastFrameTime = performance.now();
      this.animate();
    }
  }

  /**
   * Skip to next narrative
   */
  nextNarrative() {
    this.state.currentNarrative = (this.state.currentNarrative + 1) % this.narratives.length;
    this.state.currentTimestamp = 0;
    this.state.currentChapter = 0;
    this.executedActions.clear(); // Clear executed actions for new narrative
    this.triggerStateChange();
    
    console.log(`🔄 Switched to narrative: ${this.getCurrentNarrative().title}`);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number) {
    this.state.speed = Math.max(0.1, Math.min(4.0, speed));
    // Logging handled by main app
  }

  /**
   * Main animation loop
   */
  private animate() {
    if (!this.state.isPlaying) return;

    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
    this.lastFrameTime = currentTime;

    // Update timestamp based on speed
    const oldTimestamp = this.state.currentTimestamp;
    this.state.currentTimestamp += deltaTime * this.state.speed;

    const currentNarrative = this.getCurrentNarrative();
    
    // Check if narrative is complete
    if (this.state.currentTimestamp >= currentNarrative.ambientMode.cycleDuration) {
      this.nextNarrative();
    } else {
      // Process visual actions for current timestamp
      this.processVisualActions(currentNarrative);
      
      // Update current chapter
      this.updateCurrentChapter(currentNarrative);
      
      // Apply continuous ambient effects
      if (this.onVisualAction) {
        // Create a continuous breathing effect action
        const ambientAction: VisualMoment = {
          timestamp: this.state.currentTimestamp,
          action: 'ambient_effects' as any,
          targets: [],
          duration: 0.1,
          parameters: {
            breathingRate: currentNarrative.ambientMode.breathingRate,
            colorProgression: currentNarrative.ambientMode.colorProgression,
            progress: this.getProgress()
          }
        };
        
        // Call ambient effects periodically (every 100ms)
        if (Math.floor(this.state.currentTimestamp * 10) !== Math.floor(oldTimestamp * 10)) {
          this.onVisualAction(ambientAction, currentNarrative);
        }
      }
    }

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Process visual actions that should trigger at current timestamp
   */
  private processVisualActions(narrative: MycelialNarrative) {
    const currentTime = this.state.currentTimestamp;
    
    narrative.visualSequence.forEach((visual, index) => {
      const actionStartTime = visual.timestamp;
      const actionEndTime = visual.timestamp + visual.duration;
      const actionId = `${narrative.id}-${index}-${visual.timestamp}`;
      
      // Check if this action should be triggered now (only trigger once)
      if (currentTime >= actionStartTime && currentTime <= actionEndTime) {
        if (!this.executedActions.has(actionId)) {
          // Mark as executed immediately to prevent duplicate triggers
          this.executedActions.add(actionId);
          
          // Map abstract targets to actual projects
          const mappedVisual: VisualMoment = {
            ...visual,
            targets: visual.targets.flatMap(target => {
              const projects = this.clusterMapping[target];
              const projectIds = projects ? projects.map(p => p.id) : [target];
              console.log(`🔄 Mapping ${target} -> ${projectIds.length} project IDs`);
              return projectIds;
            })
          };
          
          if (this.onVisualAction) {
            this.onVisualAction(mappedVisual, narrative);
          }
        }
      }
    });
  }

  /**
   * Update current chapter based on timestamp
   */
  private updateCurrentChapter(narrative: MycelialNarrative) {
    const progress = this.state.currentTimestamp / narrative.ambientMode.cycleDuration;
    const newChapter = Math.floor(progress * narrative.story.chapters.length);
    
    if (newChapter !== this.state.currentChapter) {
      this.state.currentChapter = Math.min(newChapter, narrative.story.chapters.length - 1);
      this.triggerStateChange();
    }
  }

  /**
   * Trigger state change callback
   */
  private triggerStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.state, this.getCurrentNarrative());
    }
  }

  /**
   * Get current narrative
   */
  getCurrentNarrative(): MycelialNarrative {
    return this.narratives[this.state.currentNarrative] || this.narratives[0];
  }

  /**
   * Get current state
   */
  getState(): NarrativeState {
    return { ...this.state };
  }

  /**
   * Get cluster mapping for debugging
   */
  getClusterMapping(): ClusterMapping {
    return this.clusterMapping;
  }

  /**
   * Set visual action callback
   */
  onVisualActionTrigger(callback: (action: VisualMoment, narrative: MycelialNarrative) => void) {
    this.onVisualAction = callback;
  }

  /**
   * Set state change callback
   */
  onStateChangeTrigger(callback: (state: NarrativeState, narrative: MycelialNarrative) => void) {
    this.onStateChange = callback;
  }

  /**
   * Get narrative progress (0-1)
   */
  getProgress(): number {
    const narrative = this.getCurrentNarrative();
    return this.state.currentTimestamp / narrative.ambientMode.cycleDuration;
  }

  /**
   * Get current chapter info
   */
  getCurrentChapter() {
    const narrative = this.getCurrentNarrative();
    return narrative.story.chapters[this.state.currentChapter] || narrative.story.chapters[0];
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}