// Main application entry point

import { SemanticGarden } from './app';

// Initialize the semantic garden visualization
new SemanticGarden();

// Toggle performance panel with 'd' key
document.addEventListener('keydown', (event) => {
    if (event.key === 'd') {
        const panel = document.getElementById('performance-panel');
        if (panel) {
            panel.classList.toggle('hidden');
        }
    }
});
