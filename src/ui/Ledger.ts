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

    // Remove elements for agents that are no longer active (this part is fine)
    for (const [id, element] of this.agentElements.entries()) {
      if (!activeAgentIds.has(id)) {
        element.remove();
        this.agentElements.delete(id);
      }
    }

    // Add new elements or update existing ones
    for (const agent of mirrors) {
      let element = this.agentElements.get(agent.id);

      if (!element) {
        // Agent is new, create its full DOM structure ONCE
        element = this.createLedgerEntryElement(agent);
        this.container.appendChild(element);
        this.agentElements.set(agent.id, element);
      }

      ///// TODO: MAYBE THIS CAN BE OPTIMIZED FURTHER /////

      // Update the color block's color (in case it's dynamic, though it's likely not)
      const colorBlock = element.querySelector('.ledger-color-block') as HTMLSpanElement;
      const hue = (agent.sourceClusterId * 137.508) % 360; // We still need the hue
      colorBlock.style.color = `hsl(${hue}, 100%, 75%)`;
      colorBlock.textContent = '■'; // Ensure the character is there

      // Update the lifespan progress bar
      const lifespanSpan = element.querySelector('.ledger-lifespan') as HTMLSpanElement;
      const lifePercent = (agent.age / agent.maxAge) * 100;
      lifespanSpan.textContent = this.createProgressBar(lifePercent);
    }
  }

  private createLedgerEntryElement(agent: FrontierAgentMirror): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'ledger-entry';

    // Create and append each part of the UI as a persistent element
    const colorBlock = document.createElement('span');
    colorBlock.className = 'ledger-color-block';

    const idSpan = document.createElement('span');
    idSpan.className = 'ledger-id';

    const directiveSpan = document.createElement('span');
    directiveSpan.className = 'ledger-directive';

    const pathwaySpan = document.createElement('span');
    pathwaySpan.className = 'ledger-pathway';

    const lifespanSpan = document.createElement('span');
    lifespanSpan.className = 'ledger-lifespan';

    element.append(colorBlock, idSpan, directiveSpan, pathwaySpan, lifespanSpan);

    // Set the content that will NEVER change
    idSpan.textContent = `AGENT ${agent.id}`;
    directiveSpan.textContent = this.prependLabel(agent.label);
    pathwaySpan.textContent = `[${agent.sourceClusterId} → ${agent.targetClusterId}]`;

    return element;
  }

  private createProgressBar(percent: number): string {
    const totalBars = 10;
    const filledBars = Math.round((percent / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    return `[${'█'.repeat(filledBars)}${'-'.repeat(emptyBars)}]`;
  }

  // Prepend a random label to the agent's directive
  private prependLabel(label: string): string {
    const choices = [
      'seeking: ',
      'exploring: ',
      'navigating: ',
      'pursuing: ',
      'musing over: ',
      'pondering: ',
      'examining: ',
      'reflecting on: ',
      'considering: ',
      'contemplating: '
    ];
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    return randomChoice + label;
  }
}
