import type { FrontierAgentMirror } from '../data/interfaces';

export interface LedgerCallbacks {
  onPlayPause: (isPlaying: boolean) => void;
  onSpeedChange: (speed: number) => void;
}

export class Ledger {
  // Customizable accent color - change this to modify the entire theme
  private accentColor: string = '#080808f'; // Default: NASA gold
  private accentColorBright: string = '#1a1919f'; // Brighter version for highlights
  
  // Configuration
  private showDebugControls: boolean = false; // Set to false to hide debug controls
  private showLifespanProgress: boolean = false; // Set to false to hide lifespan progress bars
  
  private container!: HTMLDivElement;
  private header!: HTMLDivElement;
  private body!: HTMLDivElement;
  private yearDisplay!: HTMLSpanElement;
  private controlsPanel!: HTMLDivElement;
  private agentElements: Map<number, HTMLDivElement> = new Map();
  private callbacks: LedgerCallbacks;
  
  // Responsive layout properties
  private currentOrientation: 'landscape' | 'portrait' = 'landscape';
  private resizeTimeout: number | null = null;

  constructor(callbacks: LedgerCallbacks) {
    this.callbacks = callbacks;
    this.currentOrientation = this.detectOrientation();
    this.createStructure();
    this.injectStyles();
    this.setupEventListeners();
  }

  private detectOrientation(): 'landscape' | 'portrait' {
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  }

  private handleOrientationChange(): void {
    const newOrientation = this.detectOrientation();
    if (newOrientation !== this.currentOrientation) {
      this.currentOrientation = newOrientation;
      this.updateLayout();
      this.notifyCanvasOfLayoutChange();
    }
  }

  private updateLayout(): void {
    this.container.className = `ledger ${this.currentOrientation}`;
    
    // Update agents container structure based on orientation
    if (this.currentOrientation === 'portrait') {
      this.setupPortraitLayout();
    } else {
      this.setupLandscapeLayout();
    }
  }

  private setupPortraitLayout(): void {
    // Ensure body has proper structure for portrait
    const agentsContainer = this.body.querySelector('.agents-container') || this.createAgentsContainer();
    if (!agentsContainer.parentElement) {
      this.body.appendChild(agentsContainer);
    }
  }

  private setupLandscapeLayout(): void {
    // Ensure body structure is correct for landscape
    const agentsContainer = this.body.querySelector('.agents-container');
    if (agentsContainer && agentsContainer.parentElement === this.body) {
      // Move existing agent cards back to body directly
      const cards = Array.from(agentsContainer.children);
      cards.forEach(card => this.body.appendChild(card));
      agentsContainer.remove();
    }
  }

  private createAgentsContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'agents-container';
    return container;
  }

  private notifyCanvasOfLayoutChange(): void {
    // Dispatch custom event to notify the canvas about layout changes
    const event = new CustomEvent('ledgerOrientationChange', {
      detail: {
        orientation: this.currentOrientation,
        landscapeMargin: '400px',
        portraitMargin: '320px'
      }
    });
    window.dispatchEvent(event);
  }

  private createStructure(): void {
    // 1. Create the main container
    this.container = document.createElement('div');
    this.container.id = 'ledger';
    this.container.className = `ledger ${this.currentOrientation}`;

    // 2. Create the header
    this.header = document.createElement('div');
    this.header.className = 'ledger-header';

    // 3. Create the body for agent list
    this.body = document.createElement('div');
    this.body.className = 'ledger-body';
    
    // 4. Create the Year Display (more dramatic)
    this.yearDisplay = document.createElement('div');
    this.yearDisplay.className = 'year-display';
    this.yearDisplay.textContent = '1981';

    // 5. Create debug controls panel
    this.controlsPanel = document.createElement('div');
    this.controlsPanel.className = 'controls-panel';
    this.controlsPanel.style.display = this.showDebugControls ? 'flex' : 'none';

    // 6. Create Play/Pause Button
    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = 'control-btn playing';
    playPauseBtn.textContent = '⏸';
    let isPlaying = true;
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

    // 9. Assemble the UI
    this.header.append(this.yearDisplay, this.controlsPanel);
    this.container.append(this.header, this.body);
    document.body.appendChild(this.container);
  }

  private setupEventListeners(): void {
    // Debounced resize handler
    window.addEventListener('resize', () => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = window.setTimeout(() => {
        this.handleOrientationChange();
      }, 100);
    });

    // Orientation change handler (for mobile devices)
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.handleOrientationChange(), 100);
    });
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
      } else {
        // Check if we need to recreate the element due to orientation change
        const needsRecreate = this.shouldRecreateElement(element);
        if (needsRecreate) {
          // Remove old element and create new one
          element.remove();
          this.agentElements.delete(agent.id);
          element = this.createLedgerEntryElement(agent);
          this.spawnAgent(element, agent.id);
        }
      }

      // Update ONLY the parts that change every frame (progress bar)
      this.updateAgentProgress(element, agent);
    }
  }

  private shouldRecreateElement(element: HTMLDivElement): boolean {
    // Check if element structure matches current orientation
    if (this.currentOrientation === 'portrait') {
      // In portrait, we should NOT have agent-row
      return element.querySelector('.agent-row') !== null;
    } else {
      // In landscape, we SHOULD have agent-row
      return element.querySelector('.agent-row') === null;
    }
  }

  private createLedgerEntryElement(agent: FrontierAgentMirror): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'agent-card';
    
    // Set the cluster color for the left border and pseudo-element
    element.style.borderLeftColor = agent.sourceClusterColor;
    element.style.setProperty('--cluster-color', agent.sourceClusterColor);

    if (this.currentOrientation === 'portrait') {
      // Simplified structure for portrait mode
      const agentId = document.createElement('div');
      agentId.className = 'agent-id';
      agentId.textContent = agent.projectTitle;

      const agentDirective = document.createElement('div');
      agentDirective.className = 'agent-directive';
      agentDirective.textContent = `${agent.directive_verb}: ${agent.directive_noun}`;

      const agentPathway = document.createElement('div');
      agentPathway.className = 'agent-pathway';
      agentPathway.innerHTML = `CLUSTER_${agent.sourceClusterId.toString().padStart(2, '0')} <span class="pathway-arrow">→</span> CLUSTER_${agent.targetClusterId.toString().padStart(2, '0')}`;

      element.append(agentId, agentDirective, agentPathway);

      if (this.showLifespanProgress) {
        const agentProgress = document.createElement('div');
        agentProgress.className = 'agent-progress';

        const progressBarContainer = document.createElement('div');
        progressBarContainer.className = 'progress-bar-container';

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';

        progressBarContainer.appendChild(progressBar);
        agentProgress.appendChild(progressBarContainer);
        element.appendChild(agentProgress);
      }
    } else {
      // Full structure for landscape mode (existing behavior)
      // Create single row container with 4 columns: ID - Directive - Status - Pathway
      const agentRow = document.createElement('div');
      agentRow.className = 'agent-row';

      // Column 1: ID (Project Title)
      const agentId = document.createElement('div');
      agentId.className = 'agent-id';
      agentId.textContent = agent.projectTitle;

      // Column 2: Directive
      const agentDirective = document.createElement('div');
      agentDirective.className = 'agent-directive';
      agentDirective.textContent = `${agent.directive_verb}: ${agent.directive_noun}`;

      // Column 3: Status (Cluster Name)
      const agentStatus = document.createElement('div');
      agentStatus.className = 'agent-status';
      agentStatus.textContent = agent.sourceClusterName;
      agentStatus.style.backgroundColor = agent.sourceClusterColor;

      // Column 4: Pathway
      const agentPathway = document.createElement('div');
      agentPathway.className = 'agent-pathway';
      agentPathway.innerHTML = `CLUSTER_${agent.sourceClusterId.toString().padStart(2, '0')} <span class="pathway-arrow">→</span> CLUSTER_${agent.targetClusterId.toString().padStart(2, '0')}`;

      agentRow.append(agentId, agentDirective, agentStatus, agentPathway);

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

        element.append(agentRow, agentProgress);
      } else {
        element.append(agentRow);
      }
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
    
    // Insert into appropriate container based on orientation
    if (this.currentOrientation === 'portrait') {
      const agentsContainer = this.body.querySelector('.agents-container') || this.createAgentsContainer();
      if (!agentsContainer.parentElement) {
        this.body.appendChild(agentsContainer);
      }
      agentsContainer.appendChild(element);
    } else {
      this.body.appendChild(element);
    }
    
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
      
      /* Base ledger styles */
      .ledger {
        position: fixed;
        background: linear-gradient(180deg, #ffffff 0%, #f8f8f8 100%);
        display: flex;
        box-shadow: -5px 0 20px rgba(0,0,0,0.1);
        font-family: 'JetBrains Mono', monospace;
        color: #2a2a2a;
        z-index: 1000;
        transition: all 0.3s ease;
      }
      
      /* Landscape mode (sidebar) */
      .ledger.landscape {
        top: 0;
        right: 0;
        width: 400px;
        height: 100vh;
        flex-direction: column;
        border-left: 3px solid ${this.accentColor};
      }
      
      /* Portrait mode (bottom panel) */
      .ledger.portrait {
        bottom: 0;
        left: 0;
        right: 0;
        height: 320px;
        max-height: 40vh;
        flex-direction: row;
        border-top: 3px solid ${this.accentColor};
        border-left: none;
        box-shadow: 0 -5px 20px rgba(0,0,0,0.1);
      }
      
      /* Header styles */
      .ledger-header {
        background: linear-gradient(135deg, #f5f5f5, #eeeeee);
        border-bottom: 2px solid ${this.accentColor};
        position: relative;
      }
      
      .ledger.landscape .ledger-header {
        padding: 24px 16px 16px 16px;
      }
      
      .ledger.portrait .ledger-header {
        min-width: 180px;
        max-width: 200px;
        padding: 16px 12px;
        border-right: 2px solid ${this.accentColor};
        border-bottom: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      
      .ledger-header::before {
        content: '';
        position: absolute;
        height: 2px;
        background: linear-gradient(90deg, ${this.accentColor}, ${this.accentColorBright}, ${this.accentColor});
      }
      
      .ledger.landscape .ledger-header::before {
        top: 0;
        left: 0;
        right: 0;
      }
      
      .ledger.portrait .ledger-header::before {
        top: 0;
        left: 0;
        right: 0;
      }
      
      /* Year display */
      .year-display {
        font-weight: 700;
        color: #1a1a1a;
        text-shadow: 0 0 20px rgba(184, 134, 11, 0.3);
        letter-spacing: 3px;
        text-align: center;
        background: linear-gradient(135deg, #1a1a1a, #333333);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      
      .ledger.landscape .year-display {
        font-size: 100px;
        margin-bottom: 20px;
      }
      
      .ledger.portrait .year-display {
        font-size: 32px;
        margin-bottom: 12px;
      }
      
      /* Controls panel */
      .controls-panel {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-top: 8px;
      }
      
      .ledger.portrait .controls-panel {
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }
      
      .control-btn {
        background: linear-gradient(135deg, #f0f0f0, #e8e8e8);
        border: 1px solid ${this.accentColor};
        color: #2a2a2a;
        font-family: inherit;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .ledger.landscape .control-btn {
        width: 44px;
        height: 44px;
      }
      
      .ledger.portrait .control-btn {
        width: 32px;
        height: 32px;
        font-size: 14px;
      }
      
      .control-btn.playing {
        background: linear-gradient(135deg, ${this.accentColor}, ${this.accentColorBright});
        color: #ffffff;
        box-shadow: 0 0 15px rgba(184, 134, 11, 0.4);
      }
      
      .speed-control {
        flex: 1;
      }
      
      .ledger.landscape .speed-control {
        margin-left: 8px;
      }
      
      .ledger.portrait .speed-control {
        margin-left: 0;
        width: 100%;
      }
      
      .speed-label {
        font-size: 10px;
        color: #666;
        margin-bottom: 4px;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      
      .speed-slider {
        width: 100%;
        height: 6px;
        background: #ddd;
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
        box-shadow: 0 0 8px rgba(184, 134, 11, 0.4);
      }
      
      .speed-slider::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: ${this.accentColor};
        border-radius: 50%;
        cursor: pointer;
        border: none;
        box-shadow: 0 0 8px rgba(184, 134, 11, 0.4);
      }
      
      /* Body styles */
      .ledger-body {
        flex: 1;
        overflow-y: auto;
        background: linear-gradient(180deg, #fafafa, #f5f5f5);
      }
      
      .ledger.landscape .ledger-body {
        padding: 16px;
      }
      
      .ledger.portrait .ledger-body {
        padding: 12px;
        overflow-x: hidden;
      }
      
      /* Agents container for portrait mode */
      .agents-container {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
        padding: 0;
      }
      
      .agents-header {
        font-size: 11px;
        color: #666;
        margin-bottom: 12px;
        letter-spacing: 1px;
        text-transform: uppercase;
        border-bottom: 1px solid #ddd;
        padding-bottom: 8px;
      }
      
      /* Hide agents header in portrait mode */
      .ledger.portrait .agents-header {
        display: none;
      }
      
      /* Agent card styles */
      .agent-card {
        background: linear-gradient(135deg, #ffffff, #f8f8f8);
        border: 1px solid #e0e0e0;
        border-left: 1px solid ${this.accentColor};
        border-radius: 0 4px 4px 0;
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      }
      
      .ledger.landscape .agent-card {
        margin-bottom: 16px;
        padding: 20px;
      }
      
      .ledger.portrait .agent-card {
        padding: 12px;
        height: auto;
      }
      
      .agent-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        background: var(--cluster-color, ${this.accentColor});
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
      
      .agent-row {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
      }
      
      .agent-id {
        font-size: 18px;
        font-weight: 700;
        color: #1a1a1a;
        letter-spacing: 0.5px;
        line-height: 1.3;
        margin-bottom: 4px;
      }
      
      .ledger.portrait .agent-id {
        font-size: 14px;
        margin-bottom: 6px;
      }
      
      .agent-directive {
        font-size: 18px;
        color: #333;
        line-height: 1.4;
        font-weight: 500;
        margin-bottom: 2px;
      }
      
      .ledger.portrait .agent-directive {
        font-size: 16px;
        margin-bottom: 8px;
      }
      
      .agent-status {
        font-size: 13px;
        padding: 8px 12px;
        background: ${this.accentColor};
        color: #ffffff;
        border-radius: 4px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        align-self: flex-start;
        width: fit-content;
        margin-bottom: 2px;
      }
      
      /* Special handling for yellow ITP color */
      .agent-status[style*="#ecb92e"] {
        color: #2a2a2a !important;
      }
      
      .agent-pathway {
        font-size: 14px;
        color: #666;
        font-family: 'JetBrains Mono', monospace;
        line-height: 1.3;
        font-weight: 500;
      }
      
      .ledger.portrait .agent-pathway {
        font-size: 12px;
      }
      
      .pathway-arrow {
        color: ${this.accentColor};
        margin: 0 4px;
      }
      
      .agent-progress {
        margin-top: 10px;
      }
      
      .ledger.portrait .agent-progress {
        margin-top: 8px;
      }
      
      .progress-label {
        font-size: 9px;
        color: #666;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .progress-bar-container {
        background: #e8e8e8;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid #ddd;
        position: relative;
      }
      
      .ledger.portrait .progress-bar-container {
        height: 6px;
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
        background: rgba(255, 255, 255, 0.8);
        animation: pulse 2s infinite;
      }
      
      .progress-text {
        font-size: 9px;
        color: #777;
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
        background: #f0f0f0;
      }
      
      .ledger-body::-webkit-scrollbar-thumb {
        background: ${this.accentColor};
        border-radius: 3px;
      }
      
      .ledger-body::-webkit-scrollbar-thumb:hover {
        background: ${this.accentColorBright};
      }
      
      /* Responsive breakpoints */
      @media (max-width: 480px) {
        .ledger.portrait .agents-container {
          grid-template-columns: 1fr;
        }
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
    this.recreateAllAgentCards();
  }

  private recreateAllAgentCards(): void {
    this.agentElements.clear();
    const agentCards = this.body.querySelectorAll('.agent-card');
    agentCards.forEach(card => card.remove());
    
    // Clear agents container if it exists
    const agentsContainer = this.body.querySelector('.agents-container');
    if (agentsContainer) {
      agentsContainer.remove();
    }
  }

  // Public method to remove the ledger
  public destroy(): void {
    // Clean up event listeners
    window.removeEventListener('resize', this.handleOrientationChange);
    window.removeEventListener('orientationchange', this.handleOrientationChange);
    
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    
    this.container.remove();
    const style = document.getElementById('ledger-styles');
    if (style) {
      style.remove();
    }
  }
}