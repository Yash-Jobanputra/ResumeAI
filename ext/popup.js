// popup.js

document.addEventListener('DOMContentLoaded', () => {

  const autoParseBtn = document.getElementById('autoParse');
  const manualParseBtn = document.getElementById('manualParse');
  const sessionIdInput = document.getElementById('sessionId');
  const statusDiv = document.getElementById('status');

  const API_ENDPOINT = 'http://127.0.0.1:5001/api/scraped-jds';

  // Function to update button states based on session ID
  function updateButtonStates() {
    const hasSessionId = sessionIdInput.value.trim() !== '';
    autoParseBtn.disabled = !hasSessionId;
    manualParseBtn.disabled = !hasSessionId;
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

  const sendDataToApi = async (data) => {
    const sessionId = sessionIdInput.value.trim();
    if (!sessionId) {
      const errorMsg = 'Error: Session ID is required.';
      setStatus(errorMsg, 'error');
      throw new Error(errorMsg);
    }

    data.user_session_id = sessionId;
    setStatus('Sending data to app...', 'info', null);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      setStatus('Successfully sent to app!', 'success');
      chrome.storage.local.set({
        lastStatus: 'Successfully sent to app!',
        lastStatusType: 'success'
      });

      return response;
    } catch (error) {
      console.error('API Error:', error);
      setStatus(`Error: ${error.message}`, 'error');
      chrome.storage.local.set({
        lastStatus: `Error: ${error.message}`,
        lastStatusType: 'error'
      });
      throw error;
    }
  };

  autoParseBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: scrapeLinkedInPage,
    }, (injectionResults) => {
      if (chrome.runtime.lastError) {
        setStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }

      const result = injectionResults[0].result;
      if (result && !result.error) {
        sendDataToApi(result);
      } else {
        setStatus(result.error || 'Could not auto-parse page.', 'error');
      }
    });
  });

  // NEW CORRECT MANUAL BUTTON HANDLER - Creates separate window
 manualParseBtn.addEventListener('click', async () => {
  const windowUrl = chrome.runtime.getURL("selection_window.html");
  
  chrome.windows.create({
    url: windowUrl,
    type: "popup",
    width: 200,  // Much smaller
    height: 120, // Much smaller  
    left: screen.availWidth - 220,  // Bottom-right corner
    top: screen.availHeight - 140,
    focused: true
  }, async (newWindow) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: "startManualSelection" });
    
    setStatus('Manual selection window opened.', 'info');
    chrome.storage.local.set({
      lastStatus: 'Manual selection window opened.',
      lastStatusType: 'info'
    });
  });
});


  // Listen for data from the content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "manualSelectionComplete") {
      setStatus('Manual selection complete! Sending to API...', 'success', null);
      chrome.storage.local.set({ 
        lastStatus: 'Manual selection complete! Sending to API...', 
        lastStatusType: 'success' 
      });
      
      sendDataToApi(request.data).then(() => {
        setStatus('Successfully sent to app!', 'success', null);
        chrome.storage.local.set({ 
          lastStatus: 'Successfully sent to app!', 
          lastStatusType: 'success' 
        });
      }).catch((error) => {
        setStatus(`Error: ${error.message}`, 'error', null);
        chrome.storage.local.set({ 
          lastStatus: `Error: ${error.message}`, 
          lastStatusType: 'error' 
        });
      });
      sendResponse({ status: "success" });
    }
    return true;
  });

});

// This function is injected into the page by executeScript
function scrapeLinkedInPage() {
  try {
    const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title h1 a, .jobs-unified-top-card__job-title h1 a');
    const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a');
    const descriptionEl = document.querySelector('#job-details, .jobs-description-content__text');

    if (!titleEl || !companyEl || !descriptionEl) {
      let missing = [];
      if (!titleEl) missing.push('title');
      if (!companyEl) missing.push('company');
      if (!descriptionEl) missing.push('description');
      return { error: `Missing elements: ${missing.join(', ')}. Try manual selection.` };
    }

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
