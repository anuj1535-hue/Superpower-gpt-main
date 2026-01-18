// LocalGPT: Cleaned Context Menu
// Removes auth checks to enable immediate functionality

// Generic click handler
function genericOnClick(info, tab) {
  // Pass the context menu click to the content script
  chrome.tabs.sendMessage(tab.id, {
    type: "contextMenuClick",
    menuItemId: info.menuItemId,
    selectionText: info.selectionText
  });
}

// Initialize Context Menus
chrome.runtime.onInstalled.addListener(() => {
  // Remove existing to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    
    // Parent Item
    chrome.contextMenus.create({
      id: "superpower-gpt",
      title: "LocalGPT Actions",
      contexts: ["selection"]
    });

    // Sub-items
    chrome.contextMenus.create({
      parentId: "superpower-gpt",
      id: "save-to-notes",
      title: "Save to Notes",
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      parentId: "superpower-gpt",
      id: "run-custom-prompt",
      title: "Run Custom Prompt",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(genericOnClick);
