import type { FrontierAgentMirror } from '../data/interfaces';

export interface LedgerCallbacks {
  onPlayPause: (isPlaying: boolean) => void;
  onSpeedChange: (speed: number) => void;
}

export class Ledger {
  // Customizable accent color - change this to modify the entire theme
  private accentColor: string = '#d4af37'; // Default: NASA gold
  private accentColorBright: string = '#ffd700'; // Brighter version for highlights
  
  // Configuration
  private showDebugControls: boolean = true; // Set to false to hide debug controls
  private showLifespanProgress: boolean = true; // Set to false to hide lifespan progress bars
  
  private container!: HTMLDivElement;
  private header!: HTMLDivElement;
  private body!: HTMLDivElement;
  private yearDisplay!: HTMLSpanElement;
  private controlsPanel!: HTMLDivElement;
  private agentElements: Map<number, HTMLDivElement> = new Map();
  private callbacks: LedgerCallbacks;

  constructor(callbacks: LedgerCallbacks) {
    this.callbacks = callbacks;
    this.createStructure();
    this.injectStyles();
    this.setupEventListeners();
  }

  private createStructure(): void {
    // 1. Create the main container
    this.container = document.createElement('div');
    this.container.id = 'ledger';
    this.container.className = 'ledger-sidebar';

    // 2. Create the header
    this.header = document.createElement('div');
    this.header.className = 'ledger-header';

    // 3. Create the body for agent list
    this.body = document.createElement('div');
    this.body.className = 'ledger-body';
    
    // 4. Create the Year Display (more dramatic)
    this.yearDisplay = document.createElement('div');
    this.yearDisplay.className = 'year-display';
    this.yearDisplay.textContent = '2087';

    // 5. Create debug controls panel
    this.controlsPanel = document.createElement('div');
    this.controlsPanel.className = 'controls-panel';
    this.controlsPanel.style.display = this.showDebugControls ? 'flex' : 'none';

    // 6. Create Play/Pause Button
    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = 'control-btn';
    playPauseBtn.textContent = '▶';
    let isPlaying = false;
    playPauseBtn.onclick = () => {
      isPlaying = !isPlaying;
      playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
      playPauseBtn.classList.toggle('playing', isPlaying);
      this.callbacks.onPlayPause(isPlaying);
    };

    // 7. Create Speed Slider
    const speedControl = document.createElement('div');
    speedControl.className = 'speed-control';
    
    const speedLabel = document.createElement('div');
    speedLabel.className = 'speed-label';
    speedLabel.textContent = 'Simulation Speed';
    
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.className = 'speed-slider';
    speedSlider.min = '0.5';
    speedSlider.max = '5';
    speedSlider.step = '0.1';
    speedSlider.value = '1';
    speedSlider.oninput = () => {
      this.callbacks.onSpeedChange(parseFloat(speedSlider.value));
    };

    speedControl.append(speedLabel, speedSlider);
    this.controlsPanel.append(playPauseBtn, speedControl);

    // 8. Create agents header
    const agentsHeader = document.createElement('div');
    agentsHeader.className = 'agents-header';
    agentsHeader.innerHTML = 'Active Agents: <span id="agentCount">0</span>';

    // 9. Assemble the UI
    this.header.append(this.yearDisplay, this.controlsPanel);
    this.body.append(agentsHeader);
    this.container.append(this.header, this.body);
    document.body.appendChild(this.container);
  }

  private setupEventListeners(): void {
    // Any additional event listeners can go here
  }

  public update(mirrors: FrontierAgentMirror[], currentYear: number): void {
    // Update the year display
    this.yearDisplay.textContent = Math.floor(currentYear).toString();

    // Update agent count
    const agentCountSpan = document.getElementById('agentCount');
    if (agentCountSpan) {
      agentCountSpan.textContent = mirrors.length.toString();
    }

    const activeAgentIds = new Set(mirrors.map(m => m.id));

    // Remove elements for agents that are no longer active (with fade out)
    for (const [id, element] of this.agentElements.entries()) {
      if (!activeAgentIds.has(id)) {
        this.despawnAgent(element, id);
      }
    }

    // Add new elements or update existing ones
    for (const agent of mirrors) {
      let element = this.agentElements.get(agent.id);

      if (!element) {
        // Agent is new, create and spawn with animation
        element = this.createLedgerEntryElement(agent);
        this.spawnAgent(element, agent.id);
      }

      // Update ONLY the parts that change every frame (progress bar)
      this.updateAgentProgress(element, agent);
    }
  }

  private createLedgerEntryElement(agent: FrontierAgentMirror): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'agent-card';

    const agentHeader = document.createElement('div');
    agentHeader.className = 'agent-header';

    const agentId = document.createElement('div');
    agentId.className = 'agent-id';
    agentId.textContent = agent.projectTitle;

    const agentStatus = document.createElement('div');
    agentStatus.className = 'agent-status';
    agentStatus.textContent = agent.id.toString();

    agentHeader.append(agentId, agentStatus);

    const agentDirective = document.createElement('div');
    agentDirective.className = 'agent-directive';
    agentDirective.textContent = `${agent.directive_verb}: ${agent.directive_noun}`;

    const agentPathway = document.createElement('div');
    agentPathway.className = 'agent-pathway';
    agentPathway.innerHTML = `CLUSTER_${agent.sourceClusterId.toString().padStart(2, '0')} <span class="pathway-arrow">→</span> CLUSTER_${agent.targetClusterId.toString().padStart(2, '0')}`;

    if (this.showLifespanProgress) {
      const agentProgress = document.createElement('div');
      agentProgress.className = 'agent-progress';

      const progressLabel = document.createElement('div');
      progressLabel.className = 'progress-label';
      progressLabel.textContent = 'Lifespan Progress';

      const progressBarContainer = document.createElement('div');
      progressBarContainer.className = 'progress-bar-container';

      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';

      const progressText = document.createElement('div');
      progressText.className = 'progress-text';

      progressBarContainer.appendChild(progressBar);
      agentProgress.append(progressLabel, progressBarContainer, progressText);

      element.append(agentHeader, agentDirective, agentPathway, agentProgress);
    } else {
      element.append(agentHeader, agentDirective, agentPathway);
    }

    return element;
  }

  private updateAgentProgress(element: HTMLDivElement, agent: FrontierAgentMirror): void {
    if (!this.showLifespanProgress) return;
    
    const progressBar = element.querySelector('.progress-bar') as HTMLDivElement;
    const progressText = element.querySelector('.progress-text') as HTMLDivElement;
    
    if (progressBar && progressText) {
      const lifePercent = (agent.age / agent.maxAge) * 100;
      progressBar.style.width = `${lifePercent}%`;
      progressText.textContent = `${Math.round(lifePercent)}% Complete`;
    }
  }

  private spawnAgent(element: HTMLDivElement, agentId: number): void {
    // Add spawning animation class
    element.classList.add('spawning');
    
    // Insert into DOM
    this.body.appendChild(element);
    this.agentElements.set(agentId, element);
    
    // Trigger animation after DOM insertion
    requestAnimationFrame(() => {
      element.classList.remove('spawning');
      element.classList.add('spawned');
    });
  }

  private despawnAgent(element: HTMLDivElement, agentId: number): void {
    element.classList.add('despawning');
    
    // Wait for animation to complete before removing
    setTimeout(() => {
      element.remove();
      this.agentElements.delete(agentId);
    }, 300);
  }

  private injectStyles(): void {
    if (document.getElementById('ledger-styles')) return; // Prevent duplicate injection

    const style = document.createElement('style');
    style.id = 'ledger-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
      
      .ledger-sidebar {
        width: 500px;
        height: 100vh;
        background: linear-gradient(180deg, #1a1812 0%, #141410 100%);
        border-left: 3px solid ${this.accentColor};
        display: flex;
        flex-direction: column;
        box-shadow: -5px 0 20px rgba(0,0,0,0.7);
        font-family: 'JetBrains Mono', monospace;
        color: #e0e0e0;
        grid-column: 2;
        box-sizing: border-box;
        overflow: hidden;
      }
      
      .ledger-header {
        background: linear-gradient(135deg, #252218, #1f1e16);
        border-bottom: 2px solid ${this.accentColor};
        padding: 24px 16px 16px 16px;
        position: relative;
      }
      
      .ledger-header::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, ${this.accentColor}, ${this.accentColorBright}, ${this.accentColor});
      }
      
      .year-display {
        font-size: 80px;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 20px;
        text-shadow: 0 0 20px rgba(212, 175, 55, 0.5);
        letter-spacing: 3px;
        text-align: center;
        background: linear-gradient(135deg, #ffffff, #f0f0f0);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      
      .controls-panel {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-top: 8px;
      }
      
      .control-btn {
        background: linear-gradient(135deg, #3a3420, #2a281a);
        border: 1px solid ${this.accentColor};
        color: #e0e0e0;
        font-family: inherit;
        font-size: 16px;
        width: 44px;
        height: 44px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .control-btn.playing {
        background: linear-gradient(135deg, ${this.accentColor}, #b8941f);
        box-shadow: 0 0 15px rgba(212, 175, 55, 0.6);
      }
      
      .speed-control {
        flex: 1;
        margin-left: 8px;
      }
      
      .speed-label {
        font-size: 10px;
        color: #888;
        margin-bottom: 4px;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      
      .speed-slider {
        width: 100%;
        height: 6px;
        background: #333;
        outline: none;
        border-radius: 3px;
      }
      
      .speed-slider::-webkit-slider-thumb {
        appearance: none;
        width: 16px;
        height: 16px;
        background: ${this.accentColor};
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 8px rgba(212, 175, 55, 0.6);
      }
      
      .speed-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: ${this.accentColor};
        border-radius: 50%;
        cursor: pointer;
        border: none;
        box-shadow: 0 0 8px rgba(212, 175, 55, 0.6);
      }
      
      .ledger-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: linear-gradient(180deg, #161511, #121210);
      }
      
      .agents-header {
        font-size: 11px;
        color: #888;
        margin-bottom: 12px;
        letter-spacing: 1px;
        text-transform: uppercase;
        border-bottom: 1px solid #333;
        padding-bottom: 8px;
      }
      
      .agent-card {
        background: linear-gradient(135deg, #1f1e16, #1a1912);
        border: 1px solid #3a3620;
        border-left: 4px solid ${this.accentColor};
        margin-bottom: 12px;
        padding: 14px;
        border-radius: 0 4px 4px 0;
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;
      }
      
      .agent-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background: linear-gradient(180deg, ${this.accentColor}, ${this.accentColorBright});
      }
      
      /* Spawn/Despawn Animations */
      .agent-card.spawning {
        opacity: 0;
        transform: translateX(-20px) scale(0.9);
      }
      
      .agent-card.spawned {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      
      .agent-card.despawning {
        opacity: 0;
        transform: translateX(20px) scale(0.9);
        transition: all 0.3s ease;
      }
      
      .agent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }
      
      .agent-id {
        font-size: 16px;
        font-weight: 700;
        color: #ffffff;
        letter-spacing: 1px;
      }
      
      .agent-status {
        font-size: 12px;
        padding: 2px 6px;
        background: ${this.accentColor};
        color: #000;
        border-radius: 2px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .agent-directive {
        font-size: 24px;
        color: #bbb;
        margin-bottom: 8px;
        line-height: 1.3;
      }
      
      .agent-pathway {
        font-size: 16px;
        color: #888;
        margin-bottom: 10px;
        font-family: 'JetBrains Mono', monospace;
      }
      
      .pathway-arrow {
        color: ${this.accentColor};
        margin: 0 4px;
      }
      
      .agent-progress {
        margin-top: 24px;
      }
      
      .progress-label {
        font-size: 16px;
        color: #888;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .progress-bar-container {
        background: #1a1a1a;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid #333;
        position: relative;
      }
      
      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, ${this.accentColor}, ${this.accentColorBright});
        transition: width 0.5s ease;
        position: relative;
      }
      
      .progress-bar::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 2px;
        height: 100%;
        background: rgba(255, 255, 255, 0.5);
        animation: pulse 2s infinite;
      }
      
      .progress-text {
        font-size: 9px;
        color: #aaa;
        margin-top: 4px;
        text-align: right;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0; }
        50% { opacity: 1; }
      }
      
      .ledger-body::-webkit-scrollbar {
        width: 6px;
      }
      
      .ledger-body::-webkit-scrollbar-track {
        background: #1a1a1a;
      }
      
      .ledger-body::-webkit-scrollbar-thumb {
        background: ${this.accentColor};
        border-radius: 3px;
      }
      
      .ledger-body::-webkit-scrollbar-thumb:hover {
        background: ${this.accentColorBright};
      }
    `;
    
    document.head.appendChild(style);
  }

  // Public method to change accent color at runtime
  public setAccentColor(newColor: string, brightVersion?: string): void {
    this.accentColor = newColor;
    this.accentColorBright = brightVersion || newColor;
    
    // Remove old styles and re-inject with new colors
    const oldStyle = document.getElementById('ledger-styles');
    if (oldStyle) {
      oldStyle.remove();
    }
    this.injectStyles();
  }

  // Public method to toggle debug controls
  public setDebugControlsVisible(visible: boolean): void {
    this.showDebugControls = visible;
    this.controlsPanel.style.display = visible ? 'flex' : 'none';
  }

  // Public method to toggle lifespan progress bars
  public setLifespanProgressVisible(visible: boolean): void {
    this.showLifespanProgress = visible;
    // If hiding progress bars, we need to recreate existing agent cards
    // This is a simple approach - remove all and let them be recreated
    if (!visible) {
      this.agentElements.clear();
      const agentCards = this.body.querySelectorAll('.agent-card');
      agentCards.forEach(card => card.remove());
    }
  }

  // Public method to remove the ledger
  public destroy(): void {
    this.container.remove();
    const style = document.getElementById('ledger-styles');
    if (style) {
      style.remove();
    }
  }
}