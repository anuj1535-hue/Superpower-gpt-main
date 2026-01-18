// LocalGPT: Privacy-Focused Backend Replacement
// Implements a local database using chrome.storage.local
// Replaces all API calls to api.wfh.team

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
  const data = await chrome.storage.local.get(DB_KEY);
  if (data[DB_KEY]) {
    localDB = { ...localDB, ...data[DB_KEY] };
  }
  isDBReady = true;
  console.log('LocalGPT Database Initialized', localDB);
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

    newConvos.forEach(newC => {
      const index = localDB.conversations.findIndex(c => c.id === newC.id);
      if (index > -1) {
        // Update existing if content changed (simplified check)
        // In a real scenario, you might want deeper diffing
        localDB.conversations[index] = { ...localDB.conversations[index], ...newC };
      } else {
        // Insert new
        localDB.conversations.push(newC);
      }
      changed = true;
    });

    if (changed) saveDB();
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
    if (!prompt.id) prompt.id = crypto.randomUUID();
    
    const index = localDB.prompts.findIndex(p => p.id === prompt.id);
    if (index > -1) localDB.prompts[index] = prompt;
    else localDB.prompts.push(prompt);
    
    saveDB();
    return { success: true, prompt };
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
    // Retry once if DB isn't ready (race condition handler)
    setTimeout(() => handleMessage(request, sendResponse), 100);
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
      // console.warn('Unknown action:', action);
      sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    console.error('Handler Error:', err);
    sendResponse({ success: false, error: err.message });
  }
}
