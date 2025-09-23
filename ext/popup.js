// popup.js

document.addEventListener('DOMContentLoaded', () => {

  const autoParseBtn = document.getElementById('autoParse');
  const manualParseBtn = document.getElementById('manualParse');
  const createScrapeBtn = document.getElementById('createScrape');
  const scraperInfoDiv = document.getElementById('scraperInfo');
  const sessionIdInput = document.getElementById('sessionId');
  const statusDiv = document.getElementById('status');

  const API_ENDPOINT = 'http://127.0.0.1:5001/api/scraped-jds';

  // Function to update button states based on session ID
  function updateButtonStates() {
    const hasSessionId = sessionIdInput.value.trim() !== '';
    autoParseBtn.disabled = !hasSessionId;
    manualParseBtn.disabled = !hasSessionId;
    createScrapeBtn.disabled = !hasSessionId;
  }

  // Function to check for existing scrapers and update UI
  async function checkExistingScrapers() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url);
    const domain = url.hostname.replace('www.', '').toLowerCase();

    console.log('Popup: Checking existing scrapers for domain:', domain);
    console.log('Popup: Original URL:', tab.url);
    console.log('Popup: Hostname:', url.hostname);

    chrome.storage.local.get(['customScrapers'], (result) => {
      const customScrapers = result.customScrapers || {};
      const domainScrapers = customScrapers[domain];

      console.log('Popup: Found scrapers for domain:', domain, domainScrapers ? domainScrapers.scrapers?.length || 0 : 0);

      if (domainScrapers && domainScrapers.scrapers && domainScrapers.scrapers.length > 0) {
        const scraperCount = domainScrapers.scrapers.length;
        createScrapeBtn.textContent = `Add Fallback Scraper (${scraperCount})`;
        scraperInfoDiv.textContent = `${scraperCount} custom scraper${scraperCount > 1 ? 's' : ''} for ${domain}`;
        scraperInfoDiv.style.display = 'block';
      } else {
        createScrapeBtn.textContent = 'Create Scrape';
        scraperInfoDiv.style.display = 'none';
      }
    });
  }

  // Load saved session ID & last status from storage
  chrome.storage.local.get(['sessionId', 'lastStatus', 'lastStatusType'], (result) => {
    if (result.sessionId) {
      sessionIdInput.value = result.sessionId;
    }
    updateButtonStates();
    
    if (result.lastStatus) {
      setStatus(result.lastStatus, result.lastStatusType || 'info', null);
    }
  });

  // Save session ID whenever it changes and update button states
  sessionIdInput.addEventListener('input', () => {
    chrome.storage.local.set({ sessionId: sessionIdInput.value });
    updateButtonStates();
  });

  const setStatus = (message, type = 'info', duration = 4000) => {
    statusDiv.textContent = message;
    statusDiv.className = `status status-${type}`;

    if (duration) {
      setTimeout(() => {
        if (statusDiv.textContent === message) {
          statusDiv.textContent = '';
        }
      }, duration);
    }
  };

  // Enhanced error handling with categorized, actionable messages
  const getEnhancedErrorMessage = (error, context = '') => {
    const errorString = error.toString().toLowerCase();

    // Categorize errors and provide specific, actionable messages
    if (errorString.includes('missing elements')) {
      const missing = errorString.match(/missing elements: ([^)]+)/)?.[1] || '';
      return {
        message: `❌ Site Layout Changed: Missing ${missing} elements`,
        suggestion: '💡 Try manual selection - click elements directly on the page',
        type: 'error'
      };
    }

    if (errorString.includes('network') || errorString.includes('fetch')) {
      return {
        message: '❌ Network Error: Unable to connect to the server',
        suggestion: '💡 Check your internet connection and try again',
        type: 'error'
      };
    }

    if (errorString.includes('timeout')) {
      return {
        message: '⏱️ Request Timeout: Server took too long to respond',
        suggestion: '💡 Try again or use manual selection for faster processing',
        type: 'error'
      };
    }

    if (errorString.includes('session')) {
      return {
        message: '⚠️ Session Required: Please enter a Session ID',
        suggestion: '💡 Enter your session ID in the field above and try again',
        type: 'error'
      };
    }

    if (errorString.includes('permission') || errorString.includes('denied')) {
      return {
        message: '🔒 Permission Error: Unable to access page content',
        suggestion: '💡 Refresh the page and try again, or use manual selection',
        type: 'error'
      };
    }

    if (errorString.includes('invalid') || errorString.includes('malformed')) {
      return {
        message: '📝 Data Error: Invalid or incomplete job information',
        suggestion: '💡 Use manual selection to choose the correct elements',
        type: 'error'
      };
    }

    // Generic error with context-aware suggestions
    const suggestions = [];
    if (context.includes('linkedin')) {
      suggestions.push('Try manual selection for LinkedIn pages');
    } else if (context.includes('indeed')) {
      suggestions.push('Try manual selection for Indeed pages');
    } else {
      suggestions.push('Try manual selection for this site');
    }

    return {
      message: `❌ ${context ? `${context}: ` : ''}${error.message || error.toString()}`,
      suggestion: `💡 ${suggestions[0]}`,
      type: 'error'
    };
  };

  const sendDataToApi = async (data) => {
    const sessionId = sessionIdInput.value.trim();
    if (!sessionId) {
      const errorInfo = getEnhancedErrorMessage(new Error('Session ID is required'), 'Session');
      setStatus(`${errorInfo.message}\n${errorInfo.suggestion}`, errorInfo.type);
      chrome.storage.local.set({
        lastStatus: `${errorInfo.message}\n${errorInfo.suggestion}`,
        lastStatusType: errorInfo.type
      });
      throw new Error('Session ID is required');
    }

    data.user_session_id = sessionId;
    setStatus('📤 Sending data to app...', 'info', null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // Response might not be JSON
        }

        const errorInfo = getEnhancedErrorMessage(new Error(errorMessage), 'API');
        setStatus(`${errorInfo.message}\n${errorInfo.suggestion}`, errorInfo.type);
        chrome.storage.local.set({
          lastStatus: `${errorInfo.message}\n${errorInfo.suggestion}`,
          lastStatusType: errorInfo.type
        });
        throw new Error(errorMessage);
      }

      setStatus('✅ Successfully sent to app!', 'success');
      chrome.storage.local.set({
        lastStatus: '✅ Successfully sent to app!',
        lastStatusType: 'success'
      });

      return response;
    } catch (error) {
      console.error('API Error:', error);

      let errorInfo;
      if (error.name === 'AbortError') {
        errorInfo = getEnhancedErrorMessage(new Error('Request timeout'), 'Timeout');
      } else {
        errorInfo = getEnhancedErrorMessage(error, 'API');
      }

      setStatus(`${errorInfo.message}\n${errorInfo.suggestion}`, errorInfo.type);
      chrome.storage.local.set({
        lastStatus: `${errorInfo.message}\n${errorInfo.suggestion}`,
        lastStatusType: errorInfo.type
      });
      throw error;
    }
  };

  autoParseBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus('Error: Could not determine active tab URL', 'error');
      return;
    }

    const url = new URL(tab.url);
    const hostname = url.hostname.replace('www.', '').toLowerCase();

    console.log('Popup: Auto scrape clicked for domain:', hostname);
    console.log('Popup: Original URL:', tab.url);

    // Check for custom scrapers first
    chrome.storage.local.get(['customScrapers'], (result) => {
      const customScrapers = result.customScrapers || {};
      const domainScrapers = customScrapers[hostname];

      console.log('Popup: Checking for custom scrapers for domain:', hostname);
      console.log('Popup: Found scrapers:', domainScrapers ? domainScrapers.scrapers?.length || 0 : 0);

      // If custom scrapers exist, use them
      if (domainScrapers && domainScrapers.scrapers && domainScrapers.scrapers.length > 0) {
        console.log('Popup: Found custom scrapers, proceeding with auto scrape');
        setStatus(`Auto selection started for ${hostname}...`, 'info');

        // Trigger auto selection via background script
        chrome.runtime.sendMessage({ action: 'triggerAutoSelection' }, (response) => {
          if (chrome.runtime.lastError) {
            setStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
          } else if (response.status === 'unsupported') {
            setStatus(`No auto-scraper available for ${response.site}. Try manual selection.`, 'error');
          } else {
            setStatus(`Auto selection started for ${hostname}...`, 'info');
          }
        });
        return;
      }

      // If no custom scrapers, check for built-in support
      console.log('Popup: No custom scrapers found, checking built-in support');
      const supportedSites = ['linkedin.com', 'indeed.com', 'hiringcafe', 'hiring.cafe', 'hiring-cafe', 'harri.com'];
      const isSupported = supportedSites.some(site => hostname.includes(site));

      if (!isSupported) {
        setStatus('No auto-scraper available for this site. Try manual selection or create a custom scraper.', 'error');
        return;
      }

      // Use built-in scraper
      console.log('Popup: Using built-in scraper for supported site');
      setStatus(`Auto selection started for ${hostname}...`, 'info');

      // Trigger auto selection via background script
      chrome.runtime.sendMessage({ action: 'triggerAutoSelection' }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
        } else if (response.status === 'unsupported') {
          setStatus(`No auto-scraper available for ${response.site}. Try manual selection or create a custom scraper.`, 'error');
        } else {
          setStatus(`Auto selection started for ${hostname}...`, 'info');
        }
      });
    });
  });

  // Manual button handler - uses background script approach
  manualParseBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus('Error: Could not determine active tab URL', 'error');
      return;
    }

    // Send message to background script to trigger manual selection
    chrome.runtime.sendMessage({ action: 'triggerKeyboardShortcut' }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
      } else {
        setStatus('Manual selection started. Click elements on the page.', 'info');
        chrome.storage.local.set({
          lastStatus: 'Manual selection started. Click elements on the page.',
          lastStatusType: 'info'
        });
      }
    });
  });

  // Create Scrape button handler - enhanced manual selection for scraper creation
  createScrapeBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus('Error: Could not determine active tab URL', 'error');
      return;
    }

    const url = new URL(tab.url);
    const domain = url.hostname.replace('www.', '').toLowerCase();

    console.log('Popup: Creating scraper for domain:', domain);
    console.log('Popup: Original URL:', tab.url);
    console.log('Popup: Hostname:', url.hostname);

    // Check if we already have scrapers for this domain
    chrome.storage.local.get(['customScrapers'], (result) => {
      const customScrapers = result.customScrapers || {};
      const domainScrapers = customScrapers[domain];

      console.log('Popup: Existing scrapers for domain:', domain, domainScrapers ? domainScrapers.scrapers?.length || 0 : 0);
      const isAddingFallback = domainScrapers && domainScrapers.scrapers && domainScrapers.scrapers.length > 0;

      // Send message to background script to trigger enhanced manual selection
      chrome.runtime.sendMessage({
        action: 'triggerCreateScrape',
        domain: domain,
        isAddingFallback: isAddingFallback
      }, (response) => {
        if (chrome.runtime.lastError) {
          setStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
        } else {
          const actionText = isAddingFallback ? 'Adding fallback scraper' : 'Creating custom scraper';
          setStatus(`${actionText} started. Click elements on the page.`, 'info');
          chrome.storage.local.set({
            lastStatus: `${actionText} started. Click elements on the page.`,
            lastStatusType: 'info'
          });
        }
      });
    });
  });


  // Listen for data from the content script and background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "manualSelectionComplete") {
      setStatus('Manual selection complete! Sending to API...', 'success', null);
      chrome.storage.local.set({
        lastStatus: 'Manual selection complete! Sending to API...',
        lastStatusType: 'success'
      });

      sendDataToApi(request.data).then(() => {
        setStatus('✅ Successfully sent to app!', 'success', null);
        chrome.storage.local.set({
          lastStatus: '✅ Successfully sent to app!',
          lastStatusType: 'success'
        });
      }).catch((error) => {
        const errorInfo = getEnhancedErrorMessage(error, 'Manual Selection');
        setStatus(`${errorInfo.message}\n${errorInfo.suggestion}`, errorInfo.type, null);
        chrome.storage.local.set({
          lastStatus: `${errorInfo.message}\n${errorInfo.suggestion}`,
          lastStatusType: errorInfo.type
        });
      });
      sendResponse({ status: "success" });
    } else if (request.action === "triggerAutoSelectionFromBackground") {
      // Handle auto selection triggered from background (keyboard shortcut)
      console.log('Popup: Received auto selection trigger from background', request.hostname);

      // Trigger the auto selection process (same as clicking Auto button)
      const [tab] = chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = new URL(tab.url);
        const hostname = url.hostname.replace('www.', '').toLowerCase();

        // Choose the scraper function to inject by name
        let scraperFunc = null;
        if (hostname.includes('linkedin.com')) {
          scraperFunc = scrapeLinkedInPage;
        } else if (hostname.includes('indeed.com')) {
          scraperFunc = scrapeIndeedPage;
        } else if (hostname.includes('hiringcafe') || hostname.includes('hiring.cafe') || hostname.includes('hiring-cafe')) {
          scraperFunc = scrapeHiringCafePage;
        } else if (hostname.includes('harri.com')) {
          scraperFunc = scrapeHarriPage;
        }

        if (scraperFunc) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: scraperFunc,
          }, (injectionResults) => {
            if (chrome.runtime.lastError) {
              const errorInfo = getEnhancedErrorMessage(chrome.runtime.lastError, 'Script Injection');
              setStatus(`${errorInfo.message}\n${errorInfo.suggestion}`, errorInfo.type);
              return;
            }

            const result = injectionResults[0].result;
            if (result && !result.error) {
              sendDataToApi(result);
            } else {
              const errorInfo = getEnhancedErrorMessage(
                new Error(result?.error || 'Could not auto-parse page'),
                hostname
              );
              setStatus(`${errorInfo.message}\n${errorInfo.suggestion}`, errorInfo.type);
            }
          });
        }
      }
      sendResponse({ status: "handled" });
    }
    return true;
  });

});

// This function is injected into the page by executeScript
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

    return {
      job_title: titleEl.innerText.trim(),
      company_name: companyEl.innerText.trim(),
      job_description: descriptionEl.innerText.trim(),
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
