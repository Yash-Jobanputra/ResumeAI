const statusDiv = document.getElementById('status');
const cancelBtn = document.getElementById('cancelBtn');
const closeBtn = document.getElementById('closeBtn');
const stepCounter = document.getElementById('stepCounter');
const progressFill = document.getElementById('progressFill');
const collectedData = document.getElementById('collectedData');

let currentStep = 1;
let selectionData = {};

const API_ENDPOINT = 'http://127.0.0.1:5001/api/scraped-jds';

function setStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status status-${type}`;
}

function updateProgress(step, total = 3) {
  currentStep = step;
  const percentage = (step / total) * 100;
  progressFill.style.width = percentage + '%';
  stepCounter.textContent = `Step ${step} of ${total}`;
  
  if (step >= total) {
    progressFill.style.backgroundColor = '#4CAF50';
  }
}

function showCollectedData() {
  if (Object.keys(selectionData).length > 0) {
    let dataText = '';
    if (selectionData.job_title) dataText += `✓ Job Title: ${selectionData.job_title.substring(0, 50)}...\n`;
    if (selectionData.company_name) dataText += `✓ Company: ${selectionData.company_name}\n`;
    if (selectionData.job_description) dataText += `✓ Description: ${selectionData.job_description.substring(0, 100)}...\n`;
    
    collectedData.textContent = dataText;
    collectedData.style.display = 'block';
  }
}

// NEW: Handle API call directly in selection window
async function sendDataToApi(data) {
  // Get session ID from storage
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['sessionId'], resolve);
  });
  
  const sessionId = result.sessionId?.trim();
  if (!sessionId) {
    setStatus('Error: Session ID is required. Set it in main extension.', 'error');
    return false;
  }

  data.user_session_id = sessionId;
  setStatus('Sending data to API...', 'info');

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

    setStatus('✅ Successfully sent to app!', 'success');
    
    // Update popup status
    chrome.storage.local.set({
      lastStatus: 'Successfully sent to app!',
      lastStatusType: 'success'
    });
    
    return true;
  } catch (error) {
    console.error('API Error:', error);
    setStatus(`❌ Error: ${error.message}`, 'error');
    
    // Update popup status  
    chrome.storage.local.set({
      lastStatus: `Error: ${error.message}`,
      lastStatusType: 'error'
    });
    
    return false;
  }
}

// Listen for updates from content script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.action === "manualSelectionStep") {
    if (request.step === "Select Company Name") {
      updateProgress(2);
      setStatus('Great! Now click the company name', 'info');
      selectionData.job_title = request.progress?.data?.job_title || 'Selected';
    } else if (request.step === "Select Job Description") {
      updateProgress(3);
      setStatus('Almost done! Click the job description area', 'info');
      selectionData.company_name = request.progress?.data?.company_name || 'Selected';
    }
    showCollectedData();
    
  } else if (request.action === "manualSelectionComplete") {
    updateProgress(3);
    selectionData = request.data;
    showCollectedData();
    
    // NEW: Send to API directly from selection window
    const success = await sendDataToApi(request.data);
    
    if (success) {
      cancelBtn.style.display = 'none';
      closeBtn.style.display = 'inline-block';
      
      // Auto-close after 5 seconds
      setTimeout(() => {
        window.close();
      }, 5000);
    }
    
  } else if (request.action === "manualSelectionCancelled") {
    setStatus('Selection cancelled', 'error');
    setTimeout(() => window.close(), 2000);
  }
  
  sendResponse({ status: "received" });
});

cancelBtn.addEventListener('click', () => {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "cancelSelection" });
    }
  });
  setStatus('Cancelling selection...', 'error');
  setTimeout(() => window.close(), 1000);
});

closeBtn.addEventListener('click', () => {
  window.close();
});

// Initialize
setStatus('Click the job title on the main page to start', 'info');
updateProgress(1);
