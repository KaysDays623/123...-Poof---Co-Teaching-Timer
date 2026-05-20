async function injectTimerFiles(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content.css"]
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "firebase-config.js",
      "firebase-app-compat.js",
      "firebase-auth-compat.js",
      "firebase-database-compat.js",
      "content.js"
    ]
  });
}

function canUseTimerOnUrl(url) {
  if (!url) return false;

  const blockedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:"
  ];

  return !blockedPrefixes.some((prefix) => url.startsWith(prefix));
}

function showPopupMessage(message) {
  const status = document.getElementById("popup-status");

  if (status) {
    status.textContent = message;
  }
}

async function showTimerPanel() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id || !canUseTimerOnUrl(tab.url)) {
      showPopupMessage("Open a regular webpage first, then click the timer.");
      return;
    }

    await injectTimerFiles(tab.id);

    await chrome.tabs.sendMessage(tab.id, {
      action: "SHOW_TIMER_PANEL"
    });

    showPopupMessage("Timer opened.");
  } catch (error) {
    console.error("Could not open timer:", error);
    showPopupMessage("Timer cannot open on this page. Try a regular webpage.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  showTimerPanel();
});