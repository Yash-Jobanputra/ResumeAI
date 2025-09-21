let selectionMode = 'inactive';
let selectionStep = '';
let selectedData = {};
let lastHighlightedElement = null;
const HIGHLIGHT_CLASS = 'resume-ai-highlight-element';

// New variables for Create Scrape functionality
let isCreateScrapeMode = false;
let capturedSelectors = {};
let currentDomain = '';

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

// Scraper functions for content script execution
function scrapeLinkedInPage() {
  // LinkedIn-specific scraper (keeps original selectors)
  try {
    const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title h1 a, .jobs-unified-top-card__job-title h1 a');
    const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a');
    const descriptionEl = document.querySelector('#job-details, .jobs-description-content__text');

    const missing = [];
    if (!titleEl) missing.push('title');
    if (!companyEl) missing.push('company');
    if (!descriptionEl) missing.push('description');
    if (missing.length) return { error: `Missing elements: ${missing.join(', ')}. Try manual selection.` };

    // Check for Easy Apply vs Normal Apply
    let application_type = 'Normal'; // Default

    // Look for the specific LinkedIn Easy Apply button structure
    const easyApplyButton = document.querySelector('button.jobs-apply-button[data-live-test-job-apply-button] span.artdeco-button__text');

    if (easyApplyButton) {
      const buttonText = easyApplyButton.textContent.trim();
      console.log('LinkedIn Apply Button Debug:', {
        text: buttonText,
        element: 'jobs-apply-button span.artdeco-button__text'
      });

      if (buttonText.toLowerCase().includes('easy apply')) {
        application_type = 'Easy Apply';
        console.log('Detected Easy Apply button via specific selector');
      }
    } else {
      // Fallback: Try multiple selectors for LinkedIn apply buttons
      const applyButtons = document.querySelectorAll('span.artdeco-button__text, button[aria-label*="apply" i], button[data-test-id*="apply" i], a[data-test-id*="apply" i]');

      for (const button of applyButtons) {
        const buttonText = button.textContent.trim();
        const ariaLabel = button.getAttribute('aria-label') || '';
        const dataTestId = button.getAttribute('data-test-id') || '';

        console.log('LinkedIn Apply Button Debug (fallback):', {
          text: buttonText,
          ariaLabel: ariaLabel,
          dataTestId: dataTestId,
          className: button.className
        });

        // Check for Easy Apply in various forms
        if (buttonText.toLowerCase().includes('easy apply') ||
            ariaLabel.toLowerCase().includes('easy apply') ||
            dataTestId.toLowerCase().includes('easy apply') ||
            buttonText.toLowerCase().includes('easy') && buttonText.toLowerCase().includes('apply')) {
          application_type = 'Easy Apply';
          console.log('Detected Easy Apply button via fallback');
          break;
        }
      }
    }

    return {
      job_title: titleEl.innerText.trim(),
      company_name: companyEl.innerText.trim(),
      job_description: descriptionEl.innerText.trim(),
      application_type: application_type,
      page_url: window.location.href,
    };
  } catch (e) {
    return { error: e.toString() };
  }
}

function scrapeIndeedPage() {
  // Indeed scraper: cleans up title and restricts JD to main section
  try {
    // Title: try both selectors, fallback to first found
    let titleEl = document.querySelector('h2[data-testid="jobsearch-JobInfoHeader-title"]');
    if (!titleEl) titleEl = document.querySelector('.jobsearch-JobInfoHeader-title');
    // Company: try both selectors
    let companyEl = document.querySelector('[data-company-name]');
    if (!companyEl) companyEl = document.querySelector('[data-testid="inlineHeader-companyName"]');
    if (!companyEl) companyEl = document.querySelector('.icl-u-lg-mr--sm');
    // JD: only use #jobDescriptionText
    const descriptionEl = document.querySelector('#jobDescriptionText');

    const missing = [];
    if (!titleEl) missing.push('title');
    if (!companyEl) missing.push('company');
    if (!descriptionEl) missing.push('description');
    if (missing.length) return { error: `Missing elements: ${missing.join(', ')}. Try manual selection.` };

    // Clean up title: remove trailing ' - job post' if present
    let jobTitle = titleEl.innerText.trim();
    jobTitle = jobTitle.replace(/\s*-\s*job post$/i, '').trim();

    return {
      job_title: jobTitle,
      company_name: companyEl.innerText.trim(),
      job_description: descriptionEl.innerText.trim(),
      page_url: window.location.href,
    };
  } catch (e) {
    return { error: e.toString() };
  }
}

function scrapeHiringCafePage() {
  // HiringCafe scraper: use only valid selectors and try fallbacks
  try {
    // Title: try h2.font-extrabold first
    let titleEl = document.querySelector('h2.font-extrabold');
    if (!titleEl) titleEl = document.querySelector('.font-extrabold.text-3xl');

    // Company: try span.text-xl.font-semibold first
    let companyEl = document.querySelector('span.text-xl.font-semibold');
    if (!companyEl) companyEl = document.querySelector('span.font-semibold');

    // JD: try article.prose, fallback to .prose
    let descriptionEl = document.querySelector('article.prose');
    if (!descriptionEl) descriptionEl = document.querySelector('.prose');

    const missing = [];
    if (!titleEl) missing.push('title');
    if (!companyEl) missing.push('company');
    if (!descriptionEl) missing.push('description');
    if (missing.length) return { error: `Missing elements: ${missing.join(', ')}. Try manual selection.` };

    return {
      job_title: titleEl.innerText.trim(),
      company_name: companyEl.innerText.trim().replace(/^@\s*/, ''),
      job_description: descriptionEl.innerText.trim(),
      page_url: window.location.href,
    };
  } catch (e) {
    return { error: e.toString() };
  }
}

function scrapeHarriPage() {
  try {
    // Role
    const titleEl = document.querySelector('.position-name');
    // Company
    const companyEl = document.querySelector('.content[automation="jobLocation"] span');
    // JD
    const descriptionEl = document.querySelector('#job_description');

    const missing = [];
    if (!titleEl) missing.push('title');
    if (!companyEl) missing.push('company');
    if (!descriptionEl) missing.push('description');
    if (missing.length) return { error: `Missing elements: ${missing.join(', ')}. Try manual selection.` };

    // Remove "Description" header if present
    let jdText = descriptionEl.innerText.trim();
    jdText = jdText.replace(/^Description\s*\n?/i, '').trim();

    return {
      job_title: titleEl.innerText.trim(),
      company_name: companyEl.innerText.trim(),
      job_description: jdText,
      page_url: window.location.href,
    };
  } catch (e) {
    return { error: e.toString() };
  }
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

  // Capture CSS selector for Create Scrape mode
  if (isCreateScrapeMode) {
    const selector = getRobustSelector(e.target);
    console.log(`Create Scrape: Attempting to capture ${selectionStep} selector`);
    console.log(`Create Scrape: Element:`, e.target);
    console.log(`Create Scrape: Element tag:`, e.target.tagName);
    console.log(`Create Scrape: Element id:`, e.target.id);
    console.log(`Create Scrape: Element classes:`, e.target.className);
    console.log(`Create Scrape: Generated selector:`, selector);

    if (selector) {
      capturedSelectors[selectionStep] = selector;
      console.log(`Create Scrape: Successfully captured ${selectionStep} selector:`, selector);
      console.log(`Create Scrape: Current capturedSelectors:`, capturedSelectors);
    } else {
      console.log(`Create Scrape: Failed to capture ${selectionStep} selector for element:`, e.target);
      console.log(`Create Scrape: Current capturedSelectors:`, capturedSelectors);
    }
  }

  if (selectionStep === 'title') {
    selectedData.job_title = text;
    selectionStep = 'company';
    const nextStepText = isCreateScrapeMode ? 'Click to select the COMPANY NAME (capturing selector)' : 'Click to select the COMPANY NAME (Press Esc to cancel)';
    updateUI(nextStepText, 2);
    chrome.runtime.sendMessage({
      action: 'manualSelectionStep',
      step: 'Select Company Name',
      progress: { current: 2, total: 3, data: selectedData }
    });

  } else if (selectionStep === 'company') {
    selectedData.company_name = text;
    selectionStep = 'description';
    const nextStepText = isCreateScrapeMode ? 'Click to select the JOB DESCRIPTION area (capturing selector)' : 'Click to select the JOB DESCRIPTION area (Press Esc to cancel)';
    updateUI(nextStepText, 3);
    chrome.runtime.sendMessage({
      action: 'manualSelectionStep',
      step: 'Select Job Description',
      progress: { current: 3, total: 3, data: selectedData }
    });

  } else if (selectionStep === 'description') {
    selectedData.job_description = text;

    if (isCreateScrapeMode) {
      // Complete the scraper creation process - only save scraper, don't send to API
      updateUI('✓ Scraper Complete! Saving custom scraper...', 3);

      console.log('Content Script: Sending createScrapeComplete with selectors:', capturedSelectors);
      console.log('Content Script: Selected data:', selectedData);
      console.log('Content Script: Current domain:', currentDomain);

      chrome.runtime.sendMessage({
        action: 'createScrapeComplete',
        data: selectedData,
        selectors: capturedSelectors,
        domain: currentDomain,
        autoSendToApi: false // Don't automatically send to API
      });

      // Show completion message and close
      setTimeout(() => {
        updateUI('✓ Custom scraper saved! You can now use Auto selection.', 3);
        setTimeout(() => removeUI(), 2000);
      }, 1000);
    } else {
      // Regular manual selection completion
      updateUI('✓ Selection Complete! Sending to API...', 3);
      setTimeout(() => removeUI(), 2000);

      chrome.runtime.sendMessage({
        action: 'manualSelectionComplete',
        data: selectedData
      });
    }
    stopSelectionProcess();
  }
}

// Helper function to generate CSS selector for an element
function getElementSelector(element) {
  if (!element || !element.tagName) return null;

  // Try to get a unique selector
  if (element.id && element.id.trim()) {
    return `#${element.id}`;
  }

  if (element.className && element.className.trim()) {
    const classes = element.className.trim().split(/\s+/).filter(cls => cls.length > 0);
    if (classes.length > 0) {
      // Try to find a unique class combination
      const classSelector = classes.map(cls => `.${cls}`).join('');
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }

      // Try individual classes for uniqueness
      for (const className of classes) {
        const singleClassSelector = `.${className}`;
        if (document.querySelectorAll(singleClassSelector).length === 1) {
          return singleClassSelector;
        }
      }

      // If no unique class, use the first class with tag
      return `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
  }

  // Fallback to nth-child selector with more context
  const parent = element.parentNode;
  if (parent) {
    const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName);
    const index = siblings.indexOf(element) + 1;

    // Try to get a more specific selector by walking up the DOM
    let currentElement = element;
    let path = [];

    while (currentElement && currentElement !== document.body && path.length < 3) {
      if (currentElement.id) {
        path.unshift(`#${currentElement.id}`);
        break;
      } else if (currentElement.className) {
        const classes = currentElement.className.trim().split(/\s+/);
        if (classes.length > 0) {
          path.unshift(`${currentElement.tagName.toLowerCase()}.${classes[0]}`);
          break;
        }
      }
      currentElement = currentElement.parentNode;
    }

    if (path.length > 0) {
      return `${path.join(' ')} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
    }

    return `${element.tagName.toLowerCase()}:nth-child(${index})`;
  }

  return element.tagName.toLowerCase();
}

// Enhanced selector generation for better reliability
function getRobustSelector(element) {
  if (!element || !element.tagName) return null;

  // 1. Try ID first (most reliable)
  if (element.id && element.id.trim()) {
    return `#${element.id}`;
  }

  // 2. Try data attributes (most stable)
  for (const attr of ['data-automation-id', 'data-testid', 'data-cy', 'data-qa', 'data-automation']) {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);
      if (value && value.length < 50) { // Avoid very long dynamic values
        return `[${attr}="${value}"]`;
      }
    }
  }

  // 3. Try stable class names (avoid dynamic ones)
  if (element.className && element.className.trim()) {
    const classes = element.className.trim().split(/\s+/).filter(cls => cls.length > 0);

    // Filter out dynamic classes (containing numbers, hashes, etc.)
    const stableClasses = classes.filter(cls => {
      // Avoid classes with numbers (likely dynamic)
      if (/\d/.test(cls)) return false;
      // Avoid very long class names (likely dynamic)
      if (cls.length > 30) return false;
      // Avoid classes with special characters
      if (/[^a-zA-Z0-9_-]/.test(cls)) return false;
      return true;
    });

    if (stableClasses.length > 0) {
      // Try to find a unique class combination
      const classSelector = stableClasses.map(cls => `.${cls}`).join('');
      if (document.querySelectorAll(classSelector).length === 1) {
        return classSelector;
      }

      // Try individual stable classes for uniqueness
      for (const className of stableClasses) {
        const singleClassSelector = `.${className}`;
        if (document.querySelectorAll(singleClassSelector).length === 1) {
          return singleClassSelector;
        }
      }

      // Use the first stable class with tag
      return `${element.tagName.toLowerCase()}.${stableClasses[0]}`;
    }
  }

  // 4. Try to find by text content for specific elements
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'h1' || tagName === 'h2') {
    if (element.textContent && element.textContent.trim().length < 100) {
      const text = element.textContent.trim();
      // Try to find by exact text match
      const textSelector = `${tagName}:has-text("${text}")`;
      try {
        if (document.querySelectorAll(textSelector).length === 1) {
          return textSelector;
        }
      } catch (e) {
        // has-text is not standard CSS, skip it
      }
    }
  }

  // 5. Try to find by partial text content for job-related elements
  if (element.textContent && element.textContent.trim().length < 50) {
    const text = element.textContent.trim().substring(0, 10);
    // Look for elements containing this text
    const textSelector = `${element.tagName.toLowerCase()}:has-text-contains("${text}")`;
    try {
      const matches = document.querySelectorAll(textSelector);
      if (matches.length === 1) {
        return textSelector;
      }
    } catch (e) {
      // has-text-contains is not standard CSS, skip it
    }
  }

  // 6. Fallback to nth-child with more context (more robust)
  const parent = element.parentNode;
  if (parent) {
    const siblings = Array.from(parent.children).filter(child => child.tagName === element.tagName);
    const index = siblings.indexOf(element) + 1;

    // Try to get a more specific selector by walking up the DOM
    let currentElement = element;
    let path = [];

    while (currentElement && currentElement !== document.body && path.length < 3) {
      if (currentElement.id) {
        path.unshift(`#${currentElement.id}`);
        break;
      } else if (currentElement.className) {
        const classes = currentElement.className.trim().split(/\s+/);
        const stableClasses = classes.filter(cls => {
          if (/\d/.test(cls)) return false;
          if (cls.length > 30) return false;
          if (/[^a-zA-Z0-9_-]/.test(cls)) return false;
          return true;
        });

        if (stableClasses.length > 0) {
          path.unshift(`${currentElement.tagName.toLowerCase()}.${stableClasses[0]}`);
          break;
        }
      }
      currentElement = currentElement.parentNode;
    }

    if (path.length > 0) {
      return `${path.join(' ')} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
    }

    // If no stable parent found, try to find a more unique parent
    let grandParent = parent.parentNode;
    if (grandParent) {
      if (grandParent.id) {
        return `#${grandParent.id} ${element.tagName.toLowerCase()}:nth-child(${index})`;
      } else if (grandParent.className) {
        const classes = grandParent.className.trim().split(/\s+/);
        const stableClasses = classes.filter(cls => {
          if (/\d/.test(cls)) return false;
          if (cls.length > 30) return false;
          if (/[^a-zA-Z0-9_-]/.test(cls)) return false;
          return true;
        });

        if (stableClasses.length > 0) {
          return `${grandParent.tagName.toLowerCase()}.${stableClasses[0]} ${element.tagName.toLowerCase()}:nth-child(${index})`;
        }
      }
    }

    return `${element.tagName.toLowerCase()}:nth-child(${index})`;
  }

  return element.tagName.toLowerCase();
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
    top: 20px !important;
    right: 20px !important;
    background-color: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'} !important;
    color: white !important;
    padding: 12px 16px !important;
    border-radius: 6px !important;
    z-index: 999999 !important;
    font-size: 14px !important;
    font-weight: 500 !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
    text-align: left !important;
    max-width: 300px !important;
    word-wrap: break-word !important;
    line-height: 1.4 !important;
    cursor: pointer !important;
    transition: opacity 0.3s ease !important;
  `;

  messageDiv.textContent = message;
  document.body.appendChild(messageDiv);

  // Add click to dismiss
  messageDiv.addEventListener('click', () => {
    messageDiv.style.opacity = '0';
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.remove();
      }
    }, 300);
  });

  // Auto-remove after 4 seconds (shorter since it's smaller)
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.style.opacity = '0';
      setTimeout(() => {
        if (messageDiv.parentNode) {
          messageDiv.remove();
        }
      }, 300);
    }
  }, 4000);
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
  } else if (request.action === 'triggerCreateScrape') {
    // Start the Create Scrape process
    startCreateScrapeProcess(request.domain, request.isAddingFallback);
    sendResponse({ status: 'started' });
  } else if (request.action === 'showCompletionMessage') {
    showCompletionMessage(request.message, request.type);
    sendResponse({ status: 'shown' });
  } else if (request.action === 'executeScraper') {
    // Execute scraper function sent from background script
    console.log('Content Script: Executing scraper', request.scraperName);

    let result = null;
    try {
      // Execute the appropriate scraper function based on hostname
      if (request.hostname.includes('linkedin.com')) {
        result = scrapeLinkedInPage();
      } else if (request.hostname.includes('indeed.com')) {
        result = scrapeIndeedPage();
      } else if (request.hostname.includes('hiringcafe') || request.hostname.includes('hiring.cafe') || request.hostname.includes('hiring-cafe')) {
        result = scrapeHiringCafePage();
      } else if (request.hostname.includes('harri.com')) {
        result = scrapeHarriPage();
      } else {
        result = { error: 'Unsupported site for auto scraping' };
      }
    } catch (error) {
      result = { error: error.toString() };
    }

    console.log('Content Script: Scraper result', result);
    sendResponse({ result: result });
    return true;
  } else if (request.action === 'executeCustomScraper') {
    // Execute custom scraper sent from background script
    console.log('Content Script: Executing custom scraper', request.scraper.name);
    console.log('Content Script: Using selectors:', request.scraper.selectors);

    let result = null;
    try {
      const scraper = request.scraper;
      const selectors = scraper.selectors;

      // Get elements using custom selectors with error handling
      let titleEl = null;
      let companyEl = null;
      let descriptionEl = null;

      // Handle both naming conventions for selectors
      const titleSelector = selectors.job_title || selectors.title;
      const companySelector = selectors.company_name || selectors.company;
      const descriptionSelector = selectors.job_description || selectors.description;

      try {
        titleEl = document.querySelector(titleSelector);
        console.log('Content Script: Title element found:', titleEl ? 'YES' : 'NO', 'Selector:', titleSelector);
      } catch (e) {
        console.log('Content Script: Error finding title element:', e);
      }

      try {
        companyEl = document.querySelector(companySelector);
        console.log('Content Script: Company element found:', companyEl ? 'YES' : 'NO', 'Selector:', companySelector);
      } catch (e) {
        console.log('Content Script: Error finding company element:', e);
      }

      try {
        descriptionEl = document.querySelector(descriptionSelector);
        console.log('Content Script: Description element found:', descriptionEl ? 'YES' : 'NO', 'Selector:', descriptionSelector);
      } catch (e) {
        console.log('Content Script: Error finding description element:', e);
      }

      const missing = [];
      if (!titleEl) missing.push('title');
      if (!companyEl) missing.push('company');
      if (!descriptionEl) missing.push('description');

      if (missing.length) {
        console.log('Content Script: Missing elements:', missing);
        result = { error: `Missing elements: ${missing.join(', ')}. Custom scraper failed.` };
      } else {
        console.log('Content Script: All elements found successfully');
        result = {
          job_title: titleEl.innerText.trim(),
          company_name: companyEl.innerText.trim(),
          job_description: descriptionEl.innerText.trim(),
          page_url: window.location.href,
          scraper_used: scraper.name
        };
      }
    } catch (error) {
      console.log('Content Script: Error executing custom scraper:', error);
      result = { error: error.toString() };
    }

    console.log('Content Script: Custom scraper result', result);
    sendResponse({ result: result });
    return true;
  }
  return true;
});

// Enhanced function to start Create Scrape process
function startCreateScrapeProcess(domain, isAddingFallback) {
  if (selectionMode === 'active') return;

  injectStyles();
  selectionMode = 'active';
  selectionStep = 'title';
  selectedData = { page_url: window.location.href };

  // Set Create Scrape mode
  isCreateScrapeMode = true;
  currentDomain = domain;
  capturedSelectors = {};

  document.addEventListener('mouseover', highlightElement);
  document.addEventListener('click', captureElement, true);
  document.addEventListener('keydown', handleEscapeKey, true);

  const modeText = isAddingFallback ? 'Adding fallback scraper' : 'Creating custom scraper';
  updateUI(`🎯 ${modeText} - Click to select the JOB TITLE (capturing selector)`, 1);

  chrome.runtime.sendMessage({
    action: 'createScrapeStep',
    step: 'Select Job Title',
    progress: { current: 1, total: 3, data: selectedData, mode: 'createScrape' }
  });
}
