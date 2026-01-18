// LocalGPT: Privacy-Focused Backend Replacement
// Implements a local database using chrome.storage.local
// Replaces all API calls to api.wfh.team

// Load context menu handler
importScripts(chrome.runtime.getURL("scripts/background/contextMenu.js"));

const DB_KEY = 'localGPT_DB';
const DEBOUNCE_DELAY = 500;

// Default State
let localDB = {
  conversations: [],
  folders: [],
  prompts: [],
  settings: {},
  user: {
    id: 'local-user',
    email: 'local@localgpt.app',
    plan: 'pro', // Force PRO features
    subscription_status: 'active'
  },
  notes: []
};

let isDBReady = false;
let saveTimeout = null;

// ==========================================
// Database Engine
// ==========================================

async function initDB() {
  try {
    const data = await chrome.storage.local.get(DB_KEY);
    if (data[DB_KEY]) {
      localDB = { ...localDB, ...data[DB_KEY] };
    }
    isDBReady = true;
    console.log('LocalGPT Database Initialized', localDB);
  } catch (err) {
    console.error('Failed to initialize LocalGPT database:', err);
    // Set ready anyway to allow operation with default empty state
    isDBReady = true;
  }
}

// Debounced Save to avoid hitting write limits
function saveDB() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    chrome.storage.local.set({ [DB_KEY]: localDB }, () => {
      console.log('LocalGPT Database Saved');
    });
  }, DEBOUNCE_DELAY);
}

// Initialize on startup
initDB();

// ==========================================
// Logic & Controllers
// ==========================================

const Controller = {
  // Mock Auth: Always return Pro subscription
  checkHasSubscription: () => {
    return {
      success: true,
      hasSubscription: true,
      plan: "pro",
      type: "stripe"
    };
  },

  registerUser: () => {
    return {
      success: true,
      user: localDB.user
    };
  },

  // Sync logic: Upsert conversations from the scraper
  addConversations: (request) => {
    const newConvos = request.conversations || [];
    let changed = false;

    // Create a Map for O(1) lookups instead of O(n) with findIndex
    const conversationMap = new Map(
      localDB.conversations.map(c => [c.id, c])
    );

    newConvos.forEach(newC => {
      const existing = conversationMap.get(newC.id);
      if (existing) {
        // Update existing - replace in the map
        conversationMap.set(newC.id, { ...existing, ...newC });
        changed = true;
      } else {
        // Insert new
        conversationMap.set(newC.id, newC);
        changed = true;
      }
    });

    // Update the conversations array from the map
    if (changed) {
      localDB.conversations = Array.from(conversationMap.values());
      saveDB();
    }
    return { success: true, count: localDB.conversations.length };
  },

  // Search Engine: Local implementation of server-side search
  getConversations: (request) => {
    const { page = 1, limit = 20, searchTerm, folderId } = request;
    let results = localDB.conversations;

    // 1. Filter by Search Term
    if (searchTerm) {
      const lowerTerm = searchTerm.toLowerCase();
      results = results.filter(c => 
        (c.title && c.title.toLowerCase().includes(lowerTerm))
      );
    }

    // 2. Filter by Folder
    if (folderId && folderId !== 'all') {
      const folder = localDB.folders.find(f => f.id === folderId);
      if (folder) {
        // Assuming folder.conversationIds is how relationships are stored
        const allowedIds = new Set(folder.conversationIds || []);
        results = results.filter(c => allowedIds.has(c.id));
      } else if (folderId === 'trash') {
        // Example trash logic if applicable
        results = results.filter(c => c.isTrashed); 
      }
    }

    // 3. Sort by update_time (descending)
    results.sort((a, b) => {
      const timeA = new Date(a.update_time || a.create_time || 0).getTime();
      const timeB = new Date(b.update_time || b.create_time || 0).getTime();
      return timeB - timeA;
    });

    // 4. Pagination
    const total = results.length;
    const start = (page - 1) * limit;
    const paginated = results.slice(start, start + limit);

    return {
      success: true,
      conversations: paginated,
      total: total,
      page: page,
      limit: limit
    };
  },

  // Prompts Management
  getPrompts: () => {
    return { success: true, prompts: localDB.prompts };
  },
  
  savePrompt: (request) => {
    const { prompt } = request;
    // Create a copy to avoid mutating the input
    const promptCopy = { ...prompt };
    if (!promptCopy.id) promptCopy.id = crypto.randomUUID();
    
    const index = localDB.prompts.findIndex(p => p.id === promptCopy.id);
    if (index > -1) localDB.prompts[index] = promptCopy;
    else localDB.prompts.push(promptCopy);
    
    saveDB();
    return { success: true, prompt: promptCopy };
  },

  deletePrompt: (request) => {
    localDB.prompts = localDB.prompts.filter(p => p.id !== request.id);
    saveDB();
    return { success: true };
  }
};

// ==========================================
// Message Router
// ==========================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isDBReady) {
    // Wait for DB to initialize with a cleaner async approach
    const maxRetries = 10;
    const retryDelay = 100;
    
    (async () => {
      for (let retries = 0; retries < maxRetries; retries++) {
        if (isDBReady) {
          handleMessage(request, sendResponse);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      // Timeout - DB still not ready
      sendResponse({ success: false, error: 'Database initialization timeout' });
    })();
    
    return true; // Keep channel open
  }
  handleMessage(request, sendResponse);
  return true; // Keep channel open for async responses
});

function handleMessage(request, sendResponse) {
  try {
    const action = request.type || request.action; // Handle variations in message format
    
    if (Controller[action]) {
      const response = Controller[action](request);
      sendResponse(response);
    } else if (action === 'ping') {
      sendResponse({ status: 'ok' });
    } else {
      sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Handler Error:', err);
    sendResponse({ success: false, error: err.message });
  }
}
