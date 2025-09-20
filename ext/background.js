// Background script for ResumeAI extension
// Handles communication between content scripts and popup

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('ResumeAI Background: Received message', request.action);

  if (request.action === 'triggerKeyboardShortcut') {
    console.log('ResumeAI Background: Keyboard shortcut triggered');

    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const tabId = tabs[0].id;

        // First, open the selection window (same as popup manual button does)
        const windowUrl = chrome.runtime.getURL("selection_window.html");
        chrome.windows.create({
          url: windowUrl,
          type: "popup",
          width: 200,
          height: 120,
          focused: true
        }, (newWindow) => {
          console.log('ResumeAI Background: Selection window opened');

          // Then send message to content script to start manual selection
          chrome.tabs.sendMessage(tabId, { action: 'startManualSelection' }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('ResumeAI Background: Error sending message to content script', chrome.runtime.lastError);
              sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
            } else {
              console.log('ResumeAI Background: Successfully triggered manual selection', response);
              sendResponse({ status: 'success' });
            }
          });
        });
      } else {
        console.error('ResumeAI Background: No active tab found');
        sendResponse({ status: 'error', error: 'No active tab found' });
      }
    });

    // Return true to indicate we'll respond asynchronously
    return true;
  }

  // Handle other message types if needed
  sendResponse({ status: 'received' });
  return true;
});

console.log('ResumeAI Background: Background script loaded and listening for messages');
