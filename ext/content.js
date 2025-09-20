let selectionMode = 'inactive';
let selectionStep = '';
let selectedData = {};
let lastHighlightedElement = null;
const HIGHLIGHT_CLASS = 'resume-ai-highlight-element';

function injectStyles() {
  if (document.getElementById('resume-ai-styles')) return;
  const style = document.createElement('style');
  style.id = 'resume-ai-styles';
  style.innerHTML = `
.${HIGHLIGHT_CLASS} {
  outline: 2px solid #50e3c2 !important;
  background-color: rgba(80, 227, 194, 0.3) !important;
  cursor: pointer !important;
}

#resume-ai-prompt {
  position: fixed !important;
  top: 16px !important; /* slightly higher */
  left: 50% !important;
  transform: translateX(-50%) !important;
  background-color: #333 !important;
  color: white !important;
  padding: 7px 14px !important;   /* reduced padding */
  border-radius: 6px !important;
  z-index: 999999 !important;
  font-size: 14px !important;     /* smaller font */
  font-weight: bold !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.22) !important;
}

#resume-ai-counter {
  position: fixed !important;
  top: 46px !important;          /* aligns with new prompt size */
  left: 50% !important;
  transform: translateX(-50%) !important;
  background-color: #2196F3 !important;
  color: white !important;
  padding: 5px 12px !important;  /* reduced padding */
  border-radius: 14px !important;
  z-index: 999999 !important;
  font-size: 12px !important;    /* smaller font */
  font-weight: bold !important;
}
`;
  document.head.appendChild(style);
}

function createPrompt() {
  let promptDiv = document.getElementById('resume-ai-prompt');
  if (!promptDiv) {
    promptDiv = document.createElement('div');
    promptDiv.id = 'resume-ai-prompt';
    document.body.appendChild(promptDiv);
  }
  return promptDiv;
}

function createCounter() {
  let counterDiv = document.getElementById('resume-ai-counter');
  if (!counterDiv) {
    counterDiv = document.createElement('div');
    counterDiv.id = 'resume-ai-counter';
    document.body.appendChild(counterDiv);
  }
  return counterDiv;
}

function updateUI(message, step) {
  const promptDiv = createPrompt();
  const counterDiv = createCounter();
  promptDiv.textContent = message;
  counterDiv.textContent = `Step ${step}/3`;
}

function removeUI() {
  document.getElementById('resume-ai-prompt')?.remove();
  document.getElementById('resume-ai-counter')?.remove();
}

function highlightElement(e) {
  if (selectionMode !== 'active' || !e.target || e.target === lastHighlightedElement) return;
  if (lastHighlightedElement) lastHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
  lastHighlightedElement = e.target;
  lastHighlightedElement.classList.add(HIGHLIGHT_CLASS);
}

function stopSelectionProcess() {
  if (selectionMode === 'inactive') return;
  selectionMode = 'inactive';
  document.removeEventListener('mouseover', highlightElement);
  document.removeEventListener('click', captureElement, true);
  document.removeEventListener('keydown', handleEscapeKey, true);
  if (lastHighlightedElement) {
    lastHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
    lastHighlightedElement = null;
  }
  removeUI();
}

function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    stopSelectionProcess();
    chrome.runtime.sendMessage({ 
      action: 'manualSelectionCancelled' 
    });
  }
}

function captureElement(e) {
  if (selectionMode !== 'active') return;
  e.preventDefault();
  e.stopPropagation();
  const text = e.target.innerText.trim();
  if (!text) return;

  if (lastHighlightedElement) {
    lastHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
    lastHighlightedElement = null;
  }

  if (selectionStep === 'title') {
    selectedData.job_title = text;
    selectionStep = 'company';
    updateUI('Click to select the COMPANY NAME (Press Esc to cancel)', 2);
    chrome.runtime.sendMessage({
      action: 'manualSelectionStep',
      step: 'Select Company Name',
      progress: { current: 2, total: 3, data: selectedData }
    });

  } else if (selectionStep === 'company') {
    selectedData.company_name = text;
    selectionStep = 'description';
    updateUI('Click to select the JOB DESCRIPTION area (Press Esc to cancel)', 3);
    chrome.runtime.sendMessage({
      action: 'manualSelectionStep',
      step: 'Select Job Description',
      progress: { current: 3, total: 3, data: selectedData }
    });

  } else if (selectionStep === 'description') {
    selectedData.job_description = text;

    // Show completion message briefly
    updateUI('✓ Selection Complete! Sending to API...', 3);
    setTimeout(() => removeUI(), 2000);

    chrome.runtime.sendMessage({
      action: 'manualSelectionComplete',
      data: selectedData
    });
    stopSelectionProcess();
  }
}

function startSelectionProcess() {
  if (selectionMode === 'active') return;
  injectStyles();
  selectionMode = 'active';
  selectionStep = 'title';
  selectedData = { page_url: window.location.href };
  
  document.addEventListener('mouseover', highlightElement);
  document.addEventListener('click', captureElement, true);
  document.addEventListener('keydown', handleEscapeKey, true);
  
  updateUI('Click to select the JOB TITLE (Press Esc to cancel)', 1);
  
  chrome.runtime.sendMessage({ 
    action: 'manualSelectionStep', 
    step: 'Select Job Title',
    progress: { current: 1, total: 3, data: selectedData }
  });
}

function handleGlobalKeyboardShortcut(e) {
  // Check for Ctrl+Shift+X (manual selection)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
    console.log('ResumeAI: Ctrl+Shift+X detected!', {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      key: e.key,
      selectionMode: selectionMode
    });

    e.preventDefault();
    e.stopPropagation();

    // Only start if not already active
    if (selectionMode === 'inactive') {
      console.log('ResumeAI: Starting manual selection process...');
      // Trigger the manual selection process
      chrome.runtime.sendMessage({
        action: 'triggerKeyboardShortcut'
      }).then(response => {
        console.log('ResumeAI: Keyboard shortcut message sent successfully', response);
      }).catch(error => {
        console.error('ResumeAI: Failed to send keyboard shortcut message', error);
      });
    } else {
      console.log('ResumeAI: Selection already active, ignoring shortcut');
    }
    return false;
  }

  // Check for Ctrl+Shift+E (auto selection)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
    console.log('ResumeAI: Ctrl+Shift+E detected!', {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      key: e.key
    });

    e.preventDefault();
    e.stopPropagation();

    // Trigger auto selection
    console.log('ResumeAI: Starting auto selection process...');
    chrome.runtime.sendMessage({
      action: 'triggerAutoSelection'
    }).then(response => {
      console.log('ResumeAI: Auto selection message sent successfully', response);
    }).catch(error => {
      console.error('ResumeAI: Failed to send auto selection message', error);
    });

    return false;
  }
}

function initGlobalKeyboardListener() {
  // Add global keyboard listener that works even when popup isn't open
  // Use capture: true to catch the event before page handlers
  document.addEventListener('keydown', handleGlobalKeyboardShortcut, true);

  // Also add to window and document body for better coverage
  window.addEventListener('keydown', handleGlobalKeyboardShortcut, true);
  if (document.body) {
    document.body.addEventListener('keydown', handleGlobalKeyboardShortcut, true);
  }

  // Add keyup listener as well to catch any missed events
  document.addEventListener('keyup', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
      console.log('ResumeAI: Ctrl+Shift+X keyup detected');
    }
  }, true);

  console.log('ResumeAI: Global keyboard listener initialized');
}

// Initialize the global keyboard listener when the script loads
initGlobalKeyboardListener();

function showCompletionMessage(message, type) {
  // Remove any existing completion message
  const existingMessage = document.getElementById('resume-ai-completion');
  if (existingMessage) {
    existingMessage.remove();
  }

  // Create completion message element
  const messageDiv = document.createElement('div');
  messageDiv.id = 'resume-ai-completion';
  messageDiv.style.cssText = `
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    background-color: ${type === 'success' ? '#4CAF50' : '#f44336'} !important;
    color: white !important;
    padding: 20px 30px !important;
    border-radius: 8px !important;
    z-index: 999999 !important;
    font-size: 16px !important;
    font-weight: bold !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
    text-align: center !important;
    max-width: 400px !important;
    word-wrap: break-word !important;
  `;

  messageDiv.textContent = message;
  document.body.appendChild(messageDiv);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.remove();
    }
  }, 5000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startManualSelection') {
    startSelectionProcess();
    sendResponse({ status: 'started' });
  } else if (request.action === 'cancelSelection') {
    stopSelectionProcess();
    sendResponse({ status: 'cancelled' });
  } else if (request.action === 'triggerKeyboardShortcut') {
    // Start the manual selection process when keyboard shortcut is triggered
    startSelectionProcess();
    sendResponse({ status: 'started' });
  } else if (request.action === 'showCompletionMessage') {
    showCompletionMessage(request.message, request.type);
    sendResponse({ status: 'shown' });
  }
  return true;
});
