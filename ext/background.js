// Background script for ResumeAI extension
// Handles communication between content scripts and popup, and API communication

const API_ENDPOINT = 'http://127.0.0.1:5001/api/scraped-jds';

// Scraper functions moved to background script for universal access
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

    // Try multiple selectors for LinkedIn apply buttons
    const applyButtons = document.querySelectorAll('span.artdeco-button__text, button[aria-label*="apply" i], button[data-test-id*="apply" i], a[data-test-id*="apply" i]');

    for (const button of applyButtons) {
      const buttonText = button.textContent.trim();
      const ariaLabel = button.getAttribute('aria-label') || '';
      const dataTestId = button.getAttribute('data-test-id') || '';

      console.log('LinkedIn Apply Button Debug:', {
        text: buttonText,
        ariaLabel: ariaLabel,
        dataTestId: dataTestId
      });

      // Check for Easy Apply in various forms
      if (buttonText.toLowerCase().includes('easy apply') ||
          ariaLabel.toLowerCase().includes('easy apply') ||
          dataTestId.toLowerCase().includes('easy apply') ||
          buttonText.toLowerCase().includes('easy') && buttonText.toLowerCase().includes('apply')) {
        application_type = 'Easy Apply';
        console.log('Detected Easy Apply button');
        break;
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('ResumeAI Background: Received message', request.action);

  if (request.action === 'triggerKeyboardShortcut') {
    console.log('ResumeAI Background: Keyboard shortcut triggered');

    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const tabId = tabs[0].id;

        // Send message to content script to start manual selection (no window needed)
        chrome.tabs.sendMessage(tabId, { action: 'startManualSelection' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('ResumeAI Background: Error sending message to content script', chrome.runtime.lastError);
            sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
          } else {
            console.log('ResumeAI Background: Successfully triggered manual selection', response);
            sendResponse({ status: 'success' });
          }
        });
      } else {
        console.error('ResumeAI Background: No active tab found');
        sendResponse({ status: 'error', error: 'No active tab found' });
      }
    });

    // Return true to indicate we'll respond asynchronously
    return true;
  }

  // Handle manual selection progress updates
  if (request.action === 'manualSelectionStep') {
    console.log('ResumeAI Background: Selection step update', request.step);

    // Update popup status
    chrome.runtime.sendMessage({
      action: 'updatePopupStatus',
      status: `${request.step} - Click elements on the page`,
      type: 'info'
    }).catch(() => {
      // Popup might not be open, that's okay
    });

    sendResponse({ status: 'received' });
    return true;
  }

  // Handle completed manual selection - send to API
  if (request.action === 'manualSelectionComplete') {
    console.log('ResumeAI Background: Manual selection completed, sending to API');

    // Get session ID from storage
    chrome.storage.local.get(['sessionId'], (result) => {
      const sessionId = result.sessionId?.trim();

      if (!sessionId) {
        console.error('ResumeAI Background: No session ID found');
        chrome.runtime.sendMessage({
          action: 'updatePopupStatus',
          status: '❌ Error: Session ID required. Set it in the extension popup.',
          type: 'error'
        }).catch(() => {});
        sendResponse({ status: 'error', error: 'No session ID found' });
        return;
      }

      // Add session ID to the data
      const dataToSend = {
        ...request.data,
        user_session_id: sessionId
      };

      // Send to API
      fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend),
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errorData => {
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
          });
        }
        return response;
      })
      .then(() => {
        console.log('ResumeAI Background: Successfully sent to API');

        // Update popup status
        chrome.runtime.sendMessage({
          action: 'updatePopupStatus',
          status: '✅ Successfully sent to app!',
          type: 'success'
        }).catch(() => {});

        // Also update storage for persistence
        chrome.storage.local.set({
          lastStatus: '✅ Successfully sent to app!',
          lastStatusType: 'success'
        });

        // Show completion message on the page itself
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'showCompletionMessage',
              message: '✅ Job data successfully sent to app!',
              type: 'success'
            }).catch(() => {});
          }
        });
      })
      .catch(error => {
        console.error('ResumeAI Background: API Error:', error);

        // Update popup status
        chrome.runtime.sendMessage({
          action: 'updatePopupStatus',
          status: `❌ Error: ${error.message}`,
          type: 'error'
        }).catch(() => {});

        // Also update storage for persistence
        chrome.storage.local.set({
          lastStatus: `❌ Error: ${error.message}`,
          lastStatusType: 'error'
        });

        // Show error message on the page itself
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'showCompletionMessage',
              message: `❌ Error: ${error.message}`,
              type: 'error'
            }).catch(() => {});
          }
        });
      });

      sendResponse({ status: 'success' });
    });

    return true;
  }

  // Handle auto selection (Ctrl+Shift+E)
  if (request.action === 'triggerAutoSelection') {
    console.log('ResumeAI Background: Auto selection triggered');

    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const tabId = tabs[0].id;
        const url = tabs[0].url;

        // Check if the site is supported
        const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();
        const supportedSites = ['linkedin.com', 'indeed.com', 'hiringcafe', 'hiring.cafe', 'hiring-cafe', 'harri.com'];

        const isSupported = supportedSites.some(site => hostname.includes(site));

        if (!isSupported) {
          console.log('ResumeAI Background: Unsupported site for auto selection', hostname);

          // Show error message on the page
          chrome.tabs.sendMessage(tabId, {
            action: 'showCompletionMessage',
            message: `❌ Auto selection not available for this site.\nSupported sites: LinkedIn, Indeed, HiringCafe, Harri\n💡 Use Ctrl+Shift+X for manual selection`,
            type: 'error'
          }).catch(() => {});

          // Update popup status
          chrome.runtime.sendMessage({
            action: 'updatePopupStatus',
            status: `❌ Auto selection not available for ${hostname}`,
            type: 'error'
          }).catch(() => {});

          sendResponse({ status: 'unsupported', site: hostname });
          return;
        }

        console.log('ResumeAI Background: Starting auto selection for supported site', hostname);

        // Run auto selection directly using the scraper functions
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
          // Show progress message
          chrome.tabs.sendMessage(tabId, {
            action: 'showCompletionMessage',
            message: `🤖 Running auto selection for ${hostname}...`,
            type: 'info'
          }).catch(() => {});

          // Send scraper function to content script to execute
          chrome.tabs.sendMessage(tabId, {
            action: 'executeScraper',
            scraperName: scraperFunc.name,
            hostname: hostname
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('ResumeAI Background: Error sending scraper to content script', chrome.runtime.lastError);
              chrome.tabs.sendMessage(tabId, {
                action: 'showCompletionMessage',
                message: `❌ Error: ${chrome.runtime.lastError.message}`,
                type: 'error'
              }).catch(() => {});
              return;
            }

            if (response && response.result) {
              const result = response.result;

              if (result && !result.error) {
                // Send to API
                chrome.storage.local.get(['sessionId'], (storageResult) => {
                  const sessionId = storageResult.sessionId?.trim();

                  if (!sessionId) {
                    chrome.tabs.sendMessage(tabId, {
                      action: 'showCompletionMessage',
                      message: '❌ Error: Session ID required. Set it in the extension popup.',
                      type: 'error'
                    }).catch(() => {});
                    return;
                  }

                  const dataToSend = {
                    ...result,
                    user_session_id: sessionId
                  };

                  fetch(API_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dataToSend),
                  })
                  .then(response => {
                    if (!response.ok) {
                      return response.json().then(errorData => {
                        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
                      });
                    }
                    return response;
                  })
                  .then(() => {
                    console.log('ResumeAI Background: Auto selection successful');
                    chrome.tabs.sendMessage(tabId, {
                      action: 'showCompletionMessage',
                      message: '✅ Job data successfully sent to app!',
                      type: 'success'
                    }).catch(() => {});

                    chrome.storage.local.set({
                      lastStatus: '✅ Successfully sent to app!',
                      lastStatusType: 'success'
                    });
                  })
                  .catch(error => {
                    console.error('ResumeAI Background: Auto selection API error:', error);
                    chrome.tabs.sendMessage(tabId, {
                      action: 'showCompletionMessage',
                      message: `❌ Error: ${error.message}`,
                      type: 'error'
                    }).catch(() => {});

                    chrome.storage.local.set({
                      lastStatus: `❌ Error: ${error.message}`,
                      lastStatusType: 'error'
                    });
                  });
                });
              } else {
                const errorMessage = result?.error || 'Could not auto-parse page';
                chrome.tabs.sendMessage(tabId, {
                  action: 'showCompletionMessage',
                  message: `❌ ${errorMessage}`,
                  type: 'error'
                }).catch(() => {});
              }
            } else {
              chrome.tabs.sendMessage(tabId, {
                action: 'showCompletionMessage',
                message: '❌ Error: Could not execute scraper on this page',
                type: 'error'
              }).catch(() => {});
            }
          });
        }

        sendResponse({ status: 'started', site: hostname });
      } else {
        console.error('ResumeAI Background: No active tab found');
        sendResponse({ status: 'error', error: 'No active tab found' });
      }
    });

    return true;
  }

  // Handle other message types if needed
  sendResponse({ status: 'received' });
  return true;
});

console.log('ResumeAI Background: Background script loaded and listening for messages');
