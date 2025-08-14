import type { FrontierAgentMirror } from '../data/interfaces';

export class Ledger {
  private container: HTMLDivElement;
  private agentElements: Map<number, HTMLDivElement> = new Map();

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'ledger';
    document.body.appendChild(this.container);
  }

  public update(mirrors: FrontierAgentMirror[]): void {
    const activeAgentIds = new Set(mirrors.map(m => m.id));

    // Remove agents that are no longer active
    for (const [id, element] of this.agentElements.entries()) {
      if (!activeAgentIds.has(id)) {
        element.remove();
        this.agentElements.delete(id);
      }
    }

    // Add or update agents
    for (const agent of mirrors) {
      let element = this.agentElements.get(agent.id);

      if (!element) {
        element = document.createElement('div');
        element.className = 'ledger-entry';
        this.container.appendChild(element);
        this.agentElements.set(agent.id, element);
      }

      const hue = (agent.sourceClusterId * 137.508) % 360;
      const color = `hsl(${hue}, 100%, 75%)`;

      const lifePercent = (agent.age / agent.maxAge) * 100;
      const progressBar = this.createProgressBar(lifePercent);

      element.innerHTML = `
        <span class="ledger-color-block" style="color: ${color};">■</span>
        <span class="ledger-id">AGENT ${agent.id}</span>
        <span class="ledger-directive">${agent.label}</span>
        <span class="ledger-pathway">[${agent.sourceClusterId} → ${agent.targetClusterId}]</span>
        <span class="ledger-lifespan">${progressBar}</span>
      `;
    }
  }

  private createProgressBar(percent: number): string {
    const totalBars = 10;
    const filledBars = Math.round((percent / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    return `[${'█'.repeat(filledBars)}${'-'.repeat(emptyBars)}]`;
  }
}
