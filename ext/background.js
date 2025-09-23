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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('ResumeAI Background: Received message', request.action);

  if (request.action === 'triggerCreateScrape') {
    console.log('ResumeAI Background: Create Scrape triggered', request);

    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const tabId = tabs[0].id;

        // Send message to content script to start Create Scrape process
        chrome.tabs.sendMessage(tabId, {
          action: 'triggerCreateScrape',
          domain: request.domain,
          isAddingFallback: request.isAddingFallback
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('ResumeAI Background: Error sending Create Scrape message to content script', chrome.runtime.lastError);
            sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
          } else {
            console.log('ResumeAI Background: Successfully triggered Create Scrape', response);
            sendResponse({ status: 'success' });
          }
        });
      } else {
        console.error('ResumeAI Background: No active tab found');
        sendResponse({ status: 'error', error: 'No active tab found' });
      }
    });

    return true;
  }

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

  // Handle Create Scrape progress updates
  if (request.action === 'createScrapeStep') {
    console.log('ResumeAI Background: Create Scrape step update', request.step);

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

  // Handle completed Create Scrape - save custom scraper
  if (request.action === 'createScrapeComplete') {
    console.log('ResumeAI Background: Create Scrape completed, saving custom scraper');

    // Save custom scraper to storage
    chrome.storage.local.get(['customScrapers'], (storageResult) => {
      const customScrapers = storageResult.customScrapers || {};
      const domain = request.domain;

      // Initialize domain scrapers if needed
      if (!customScrapers[domain]) {
        customScrapers[domain] = { scrapers: [] };
      }

        // Create new scraper object
        const newScraper = {
          id: `scraper-${Date.now()}`,
          name: `${domain} Custom Scraper`,
          selectors: request.selectors,
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          successRate: 1.0 // Start with perfect success rate
        };

        console.log('ResumeAI Background: Creating scraper with selectors:', request.selectors);
        console.log('ResumeAI Background: New scraper object:', newScraper);

      // Add to scrapers array (at the beginning for highest priority)
      customScrapers[domain].scrapers.unshift(newScraper);

      // Save back to storage
      chrome.storage.local.set({ customScrapers }, () => {
        console.log('ResumeAI Background: Custom scraper saved successfully');

        // Update popup status
        chrome.runtime.sendMessage({
          action: 'updatePopupStatus',
          status: '✅ Custom scraper created and saved!',
          type: 'success'
        }).catch(() => {});

        // Show completion message on the page
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'showCompletionMessage',
              message: '✅ Custom scraper created successfully!\nYou can now use Auto selection on this site.',
              type: 'success'
            }).catch(() => {});
          }
        });

        // Only send data to API if explicitly requested
        if (request.autoSendToApi !== false) {
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

            // Send data to API
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
              console.log('ResumeAI Background: Data successfully sent to API');

              // Update popup status
              chrome.runtime.sendMessage({
                action: 'updatePopupStatus',
                status: '✅ Successfully sent to app!',
                type: 'success'
              }).catch(() => {});

              // Update storage for persistence
              chrome.storage.local.set({
                lastStatus: '✅ Successfully sent to app!',
                lastStatusType: 'success'
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

              // Update storage for persistence
              chrome.storage.local.set({
                lastStatus: `❌ Error: ${error.message}`,
                lastStatusType: 'error'
              });
            });
          });
        } else {
          console.log('ResumeAI Background: Create Scrape completed - scraper saved, not sending to API');
        }

        sendResponse({ status: 'success' });
      });
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
        const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();

        console.log('ResumeAI Background: Checking for scrapers for domain', hostname);
        console.log('ResumeAI Background: Original URL:', url);
        console.log('ResumeAI Background: Hostname:', new URL(url).hostname);

        // Check for custom scrapers first
        chrome.storage.local.get(['customScrapers'], (result) => {
          const customScrapers = result.customScrapers || {};
          let domainScrapers = customScrapers[hostname];
          let actualDomain = hostname;

          console.log('ResumeAI Background: === AUTO SCRAPE DEBUG INFO ===');
          console.log('ResumeAI Background: Full storage result:', result);
          console.log('ResumeAI Background: Custom scrapers object:', customScrapers);
          console.log('ResumeAI Background: Checking storage for domain', hostname);
          console.log('ResumeAI Background: Available custom scrapers keys:', Object.keys(customScrapers));
          console.log('ResumeAI Background: Domain scrapers found:', domainScrapers);
          console.log('ResumeAI Background: Number of scrapers for this domain:', domainScrapers ? domainScrapers.scrapers?.length || 0 : 0);

          // Debug: Show all scrapers in detail
          Object.keys(customScrapers).forEach(key => {
            const scrapers = customScrapers[key];
            console.log(`ResumeAI Background: Domain "${key}" has ${scrapers.scrapers?.length || 0} scrapers:`, scrapers.scrapers);
          });

          // If no scrapers found, try the alternative domain format (with/without www)
          if (!domainScrapers || !domainScrapers.scrapers || domainScrapers.scrapers.length === 0) {
            const alternativeDomain = hostname.startsWith('www.') ? hostname.substring(4) : `www.${hostname}`;
            console.log('ResumeAI Background: Trying alternative domain format:', alternativeDomain);
            domainScrapers = customScrapers[alternativeDomain];
            actualDomain = alternativeDomain;

            if (domainScrapers && domainScrapers.scrapers && domainScrapers.scrapers.length > 0) {
              console.log('ResumeAI Background: Found scrapers under alternative domain:', alternativeDomain);
              console.log('ResumeAI Background: Number of scrapers for alternative domain:', domainScrapers.scrapers.length);
            }
          }

          if (domainScrapers && domainScrapers.scrapers && domainScrapers.scrapers.length > 0) {
            console.log('ResumeAI Background: Found custom scrapers for domain', actualDomain, domainScrapers.scrapers.length);
            console.log('ResumeAI Background: Using custom scrapers for', actualDomain);

            // Try custom scrapers first
            tryCustomScrapers(tabId, actualDomain, domainScrapers.scrapers, 0);
          } else {
            console.log('ResumeAI Background: === NO CUSTOM SCRAPERS FOUND ===');
            console.log('ResumeAI Background: No custom scrapers found for', hostname, 'or alternative domain');
            console.log('ResumeAI Background: This means the scraper was not saved properly or storage is corrupted');
            console.log('ResumeAI Background: Checking for built-in scrapers...');

            // Fall back to built-in scrapers
            const supportedSites = ['linkedin.com', 'indeed.com', 'hiringcafe', 'hiring.cafe', 'hiring-cafe', 'harri.com'];
            const isSupported = supportedSites.some(site => hostname.includes(site));

            if (!isSupported) {
              console.log('ResumeAI Background: Unsupported site for auto selection', hostname);

              // Show error message on the page
              chrome.tabs.sendMessage(tabId, {
                action: 'showCompletionMessage',
                message: `❌ Auto selection not available for this site.\nSupported sites: LinkedIn, Indeed, HiringCafe, Harri\n💡 Use Manual selection or Create Scrape to add support for this site`,
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

            // Use built-in scraper
            console.log('ResumeAI Background: Using built-in scraper for', hostname);
            tryBuiltInScraper(tabId, hostname);
          }
        });
      } else {
        console.error('ResumeAI Background: No active tab found');
        sendResponse({ status: 'error', error: 'No active tab found' });
      }
    });

    return true;
  }

// Helper function to try custom scrapers in order
function tryCustomScrapers(tabId, hostname, scrapers, index) {
  console.log('ResumeAI Background: tryCustomScrapers called with index', index, 'of', scrapers.length, 'scrapers');

  if (index >= scrapers.length) {
    console.log('ResumeAI Background: All custom scrapers failed, trying built-in scraper');
    tryBuiltInScraper(tabId, hostname);
    return;
  }

  const scraper = scrapers[index];
  console.log('ResumeAI Background: Trying custom scraper', scraper.name, 'for', hostname);
  console.log('ResumeAI Background: Scraper selectors:', scraper.selectors);

  // Show progress message
  chrome.tabs.sendMessage(tabId, {
    action: 'showCompletionMessage',
    message: `🤖 Running custom scraper "${scraper.name}" for ${hostname}...`,
    type: 'info'
  }).catch(() => {});

  // Send custom scraper to content script to execute
  console.log('ResumeAI Background: Sending scraper to content script:', scraper);
  chrome.tabs.sendMessage(tabId, {
    action: 'executeCustomScraper',
    scraper: scraper,
    hostname: hostname
  }, (response) => {
    console.log('ResumeAI Background: Content script response:', response);

    // Check for chrome runtime errors first
    if (chrome.runtime.lastError) {
      console.error('ResumeAI Background: Error sending custom scraper to content script', chrome.runtime.lastError);
      // Try next scraper
      tryCustomScrapers(tabId, hostname, scrapers, index + 1);
      return;
    }

    // Check if we got a valid response
    if (!response) {
      console.log('ResumeAI Background: No response from content script, trying next scraper');
      tryCustomScrapers(tabId, hostname, scrapers, index + 1);
      return;
    }

    if (response.result) {
      const result = response.result;

      if (result && !result.error) {
        console.log('ResumeAI Background: Custom scraper successful');

        // Update success rate and last used time
        scraper.lastUsed = new Date().toISOString();
        scraper.successRate = Math.min(1.0, scraper.successRate + 0.1);

        // Save updated scraper
        chrome.storage.local.get(['customScrapers'], (result) => {
          const customScrapers = result.customScrapers || {};
          if (customScrapers[hostname]) {
            customScrapers[hostname].scrapers[index] = scraper;
            chrome.storage.local.set({ customScrapers });
          }
        });

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
            console.log('ResumeAI Background: Custom scraper data sent to API');
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
            console.error('ResumeAI Background: Custom scraper API error:', error);
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
        console.log('ResumeAI Background: Custom scraper failed with error:', result?.error);
        console.log('ResumeAI Background: Trying next scraper...');

        // Update failure rate
        scraper.successRate = Math.max(0.0, scraper.successRate - 0.2);

        // Save updated scraper
        chrome.storage.local.get(['customScrapers'], (result) => {
          const customScrapers = result.customScrapers || {};
          if (customScrapers[hostname]) {
            customScrapers[hostname].scrapers[index] = scraper;
            chrome.storage.local.set({ customScrapers });
          }
        });

        // Try next scraper
        tryCustomScrapers(tabId, hostname, scrapers, index + 1);
      }
    } else {
      console.log('ResumeAI Background: Custom scraper returned no result, trying next one');
      // Try next scraper
      tryCustomScrapers(tabId, hostname, scrapers, index + 1);
    }
  });
}

// Helper function to try built-in scraper
function tryBuiltInScraper(tabId, hostname) {
  console.log('ResumeAI Background: Trying built-in scraper for', hostname);

  // Show progress message
  chrome.tabs.sendMessage(tabId, {
    action: 'showCompletionMessage',
    message: `🤖 Running built-in scraper for ${hostname}...`,
    type: 'info'
  }).catch(() => {});

  // Send built-in scraper to content script to execute
  chrome.tabs.sendMessage(tabId, {
    action: 'executeScraper',
    scraperName: getBuiltInScraperName(hostname),
    hostname: hostname
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('ResumeAI Background: Error sending built-in scraper to content script', chrome.runtime.lastError);
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
            console.log('ResumeAI Background: Built-in scraper successful');
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
            console.error('ResumeAI Background: Built-in scraper API error:', error);
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
        message: '❌ Error: Could not execute built-in scraper on this page',
        type: 'error'
      }).catch(() => {});
    }
  });
}

// Helper function to get built-in scraper name
function getBuiltInScraperName(hostname) {
  if (hostname.includes('linkedin.com')) {
    return 'scrapeLinkedInPage';
  } else if (hostname.includes('indeed.com')) {
    return 'scrapeIndeedPage';
  } else if (hostname.includes('hiringcafe') || hostname.includes('hiring.cafe') || hostname.includes('hiring-cafe')) {
    return 'scrapeHiringCafePage';
  } else if (hostname.includes('harri.com')) {
    return 'scrapeHarriPage';
  }
  return null;
}

  // Handle other message types if needed
  sendResponse({ status: 'received' });
  return true;
});

console.log('ResumeAI Background: Background script loaded and listening for messages');
