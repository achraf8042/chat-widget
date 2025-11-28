/* ============================================
   AI CHAT WIDGET PRO - WITH SUPABASE
   Filename: chat-widget.js
   Version: 1.0.0
   Notes:
     - Client-side Supabase anonkey usage accepted by user.
   ============================================ */

(function () {
  'use strict';

  // -------------------------
  // CONFIG
  // -------------------------
  const CONFIG = {
    storageKey: 'chatWidget_history',
    settingsKey: 'chatWidget_settings',
    trainingKey: 'chatWidget_training',
    maxStoredMessages: 50,
    autoSaveHistory: true,
    useOpenAI: false,
    openAI_Key: 'sk-your-api-key-here', // Replace with your OpenAI API key if using server-side
    requestTimeoutMs: 15000,
    rateLimit: {
      maxMessages: 10,
      windowMs: 60000,
      cooldownMs: 30000
    },
    response: {
      maxLength: 500,
      minThinkingTime: 800,
      maxThinkingTime: 2500,
      wordsPerMs: 0.05
    },
    // Supabase config (client-side anonKey usage — document security implications)
    supabase: {
      enabled: true,
      url: 'https://zquveyajxeueghfxqvjq.supabase.co', // e.g., https://abc123.supabase.co
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxdXZleWFqeGV1ZWdoZnhxdmpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MzkzNTksImV4cCI6MjA3OTQxNTM1OX0.U_HY6_6wbDJD-75Uj48WE3IPLoCthiczqPLrqTZXZPI', // Your anon/public key
      tableName: 'training', // Table name for training data
      siteId: 'chat-widget' // Unique identifier for your site (document how to set)
    }
  };

  // -------------------------
  // UTIL: load remote script
  // -------------------------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const scriptElement = document.createElement('script');
      scriptElement.src = src;
      scriptElement.async = true;
      scriptElement.onload = () => resolve();
      scriptElement.onerror = (e) => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(scriptElement);
    });
  }

  // -------------------------
  // SUPABASE CLIENT (optional)
  // -------------------------
  let supabaseClient = null;
  let cachedTrainingData = null;

  async function initSupabase() {
    if (!CONFIG.supabase || !CONFIG.supabase.enabled) {
      console.log('⚠️ Supabase disabled, using localStorage fallback for training data.');
      return false;
    }

    const url = (CONFIG.supabase.url || '').trim();
    const anon = (CONFIG.supabase.anonKey || '').trim();

    const placeholderUrls = [
      '',
      'YOUR_SUPABASE_PROJECT_URL',
      'YOUR_SUPABASE_URL',
      'https://YOUR_SUPABASE_PROJECT_URL'
    ];

    if (!url || placeholderUrls.includes(url) || url.indexOf('supabase') === -1) {
      console.warn('⚠️ Supabase URL is not configured correctly. Falling back to localStorage.');
      return false;
    }

    if (!anon || anon.startsWith('YOUR_')) {
      console.warn('⚠️ Supabase anonKey is not configured. Falling back to localStorage.');
      return false;
    }

    try {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      if (!window.supabase || !window.supabase.createClient) {
        console.warn('⚠️ Supabase library loaded but API not found. Falling back to localStorage.');
        return false;
      }

      supabaseClient = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
      console.log('✅ Supabase client initialized.');
      return true;
    } catch (err) {
      console.error('❌ initSupabase error:', err);
      return false;
    }
  }

  async function fetchTrainingDataFromSupabase() {
    if (!supabaseClient) return null;
    try {
      const { data, error, status } = await supabaseClient
        .from(CONFIG.supabase.tableName)
        .select('data')
        .eq('site_id', CONFIG.supabase.siteId)
        .maybeSingle(); // maybeSingle returns null when not found without throwing

      if (error) {
        console.warn('⚠️ Supabase query error:', error);
        return null;
      }

      if (!data) {
        console.log('ℹ️ No training data row found for site:', CONFIG.supabase.siteId);
        return null;
      }

      // Data may be stored as JSON or stringified JSON
      const payload = data.data || data;
      try {
        return typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (e) {
        // If parsing fails, return raw payload (best-effort)
        return payload;
      }
    } catch (err) {
      console.error('❌ fetchTrainingDataFromSupabase error:', err);
      return null;
    }
  }

  // -------------------------
  // RESPONSE HANDLER
  // -------------------------
  const ResponseHandler = {
    limitResponse(text) {
      if (!text || typeof text !== 'string') return text;
      const maxLen = CONFIG.response.maxLength;
      if (text.length <= maxLen) return text;

      let truncated = text.substring(0, maxLen);
      const lastPeriod = truncated.lastIndexOf('.');
      const lastQuestion = truncated.lastIndexOf('?');
      const lastExclaim = truncated.lastIndexOf('!');
      const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclaim);

      if (lastSentence > maxLen * 0.5) {
        truncated = truncated.substring(0, lastSentence + 1);
      } else {
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > maxLen * 0.5) {
          truncated = truncated.substring(0, lastSpace) + '...';
        } else {
          truncated = truncated.substring(0, maxLen - 3) + '...';
        }
      }
      return truncated;
    },

    calculateThinkingTime(responseText) {
      const baseTime = CONFIG.response.minThinkingTime;
      const maxTime = CONFIG.response.maxThinkingTime;
      const randomOffset = (Math.random() - 0.5) * 600;
      const lengthFactor = responseText ? responseText.length * CONFIG.response.wordsPerMs : 0;
      let thinkingTime = baseTime + lengthFactor + randomOffset;
      return Math.min(Math.max(thinkingTime, baseTime), maxTime);
    },

    async simulateThinking(thinkingTime) {
      const states = ['Thinking', 'Thinking.', 'Thinking..', 'Thinking...'];
      const indicator = document.getElementById('typing-indicator');
      if (!indicator) return;

      const bubble = indicator.querySelector('.message-bubble');
      if (!bubble) return;

      const stateTime = thinkingTime / states.length;
      for (let i = 0; i < states.length; i++) {
        if (!document.getElementById('typing-indicator')) break;
        bubble.innerHTML = `<div class="thinking-text">${states[i]}</div>`;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, stateTime));
      }
    }
  };

  // -------------------------
  // SECURITY helpers
  // -------------------------
  const Security = {
    escapeHtml(str) {
      if (typeof str !== 'string') return '';
      const htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
      };
      return str.replace(/[&<>"'`=/]/g, (char) => htmlEntities[char] || char);
    },

    sanitizeInput(str) {
      if (typeof str !== 'string') return '';
      // lightweight sanitization: strip obvious SQL/JS injection tokens
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|UNION|FROM|WHERE)\b)/gi,
        /(--|;|\/\*|\*\/|@@|@)/g,
        /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/gi,
        /(\'|\"|\\)/g
      ];
      let sanitized = String(str);
      sqlPatterns.forEach((pattern) => {
        sanitized = sanitized.replace(pattern, '');
      });
      return sanitized.trim();
    },

    sanitize(str) {
      return this.escapeHtml(this.sanitizeInput(str));
    },

    isValidMessage(str) {
      if (typeof str !== 'string') return false;
      if (str.trim().length === 0) return false;
      if (str.length > 2000) return false;
      return true;
    }
  };

  // -------------------------
  // RATE LIMITER
  // -------------------------
  const RateLimiter = {
    messages: [],
    cooldownUntil: 0,

    canSend() {
      const now = Date.now();
      if (now < this.cooldownUntil) {
        const remainingSeconds = Math.ceil((this.cooldownUntil - now) / 1000);
        return { allowed: false, reason: `Too many messages. Please wait ${remainingSeconds}s` };
      }
      this.messages = this.messages.filter((ts) => now - ts < CONFIG.rateLimit.windowMs);
      if (this.messages.length >= CONFIG.rateLimit.maxMessages) {
        this.cooldownUntil = now + CONFIG.rateLimit.cooldownMs;
        return { allowed: false, reason: `Rate limit exceeded. Please wait ${CONFIG.rateLimit.cooldownMs / 1000}s` };
      }
      return { allowed: true };
    },

    recordMessage() {
      this.messages.push(Date.now());
    }
  };

  // -------------------------
  // DOM elements (expected in your HTML)
  // -------------------------
  let chatBubbleBtn,
    chatWidget,
    chatMessages,
    chatForm,
    chatInput,
    chatCloseBtn,
    unreadBadge,
    chatSettings,
    darkModeToggle,
    soundToggle,
    positionSelect;

  function initDomElements() {
    chatBubbleBtn = document.getElementById('chat-bubble-btn');
    chatWidget = document.getElementById('chat-widget');
    chatMessages = document.getElementById('chat-messages');
    chatForm = document.getElementById('chat-form');
    chatInput = document.getElementById('chat-input');
    chatCloseBtn = document.querySelector('.chat-close-btn');
    unreadBadge = document.getElementById('unread-badge');
    chatSettings = document.getElementById('chat-settings');
    darkModeToggle = document.getElementById('dark-mode-toggle');
    soundToggle = document.getElementById('sound-toggle');
    positionSelect = document.getElementById('position-select');

    const required = {
      chatBubbleBtn,
      chatWidget,
      chatMessages,
      chatForm,
      chatInput,
      chatCloseBtn,
      chatSettings,
      darkModeToggle,
      soundToggle,
      positionSelect
    };

    Object.entries(required).forEach(([name, el]) => {
      if (!el) console.warn(`⚠️ Missing element: ${name}. Check your demo HTML (IDs/classes must match widget JS).`);
    });
  }

  // -------------------------
  // STATE
  // -------------------------
  let isOpen = false;
  let messageHistory = [];
  let unreadCount = 0;
  let settings = {
    theme: 'purple',
    darkMode: false,
    soundEnabled: true,
    position: 'bottom-right'
  };

  // -------------------------
  // TRAINING DATA
  // -------------------------
  async function loadTrainingData() {
    // Supabase first
    if (supabaseClient && !cachedTrainingData) {
      cachedTrainingData = await fetchTrainingDataFromSupabase();
    }
    if (cachedTrainingData) return cachedTrainingData;

    // Fallback to localStorage
    try {
      const saved = localStorage.getItem(CONFIG.trainingKey);
      return saved ? JSON.parse(saved) : { faqs: [], knowledge: [], instructions: 'You are a helpful customer service assistant.' };
    } catch (err) {
      console.error('Failed to load training data:', err);
      return { faqs: [], knowledge: [], instructions: '' };
    }
  }

  function findFaqMatch(message, faqs) {
    if (!faqs || faqs.length === 0) return null;
    const lower = Security.sanitize(message).toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;

    faqs.forEach((faq) => {
      let score = 0;
      const faqQuestion = (faq.question || '').toLowerCase();
      const faqKeywords = faq.keywords ? faq.keywords.toLowerCase().split(',').map((k) => k.trim()) : [];

      if (lower === faqQuestion) score = 100;
      else if (lower.includes(faqQuestion)) score = 80;
      else if (faqQuestion.includes(lower) && lower.length > 3) score = 60;
      else {
        const matchedKeywords = faqKeywords.filter((kw) => kw.length > 2 && lower.includes(kw));
        if (matchedKeywords.length > 0) score = 40 + (matchedKeywords.length * 10);
      }

      const userWords = lower.split(/\s+/).filter((w) => w.length > 2);
      const faqWords = faqQuestion.split(/\s+/).filter((w) => w.length > 2);
      const commonWords = userWords.filter((w) => faqWords.includes(w));
      if (commonWords.length >= 2) score = Math.max(score, 30 + (commonWords.length * 10));
      if (score > bestScore) {
        bestScore = score;
        bestMatch = faq;
      }
    });

    return bestScore >= 30 ? bestMatch : null;
  }

  function findKnowledgeMatch(message, knowledge) {
    if (!knowledge || knowledge.length === 0) return null;
    const lower = Security.sanitize(message).toLowerCase().trim();
    const userWords = lower.split(/\s+/).filter((w) => w.length > 2);

    let bestMatch = null;
    let bestScore = 0;

    knowledge.forEach((item) => {
      let score = 0;
      const title = (item.title || '').toLowerCase();
      if (lower === title) score = 100;
      else if (lower.includes(title)) score = 80;
      else if (title.includes(lower) && lower.length > 3) score = 60;
      else {
        const titleWords = title.split(/\s+/).filter((w) => w.length > 2);
        const commonTitleWords = userWords.filter((w) => titleWords.includes(w));
        if (commonTitleWords.length >= 1) score = 40 + (commonTitleWords.length * 15);
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    });

    return bestScore >= 30 ? bestMatch : null;
  }

  // -------------------------
  // SETTINGS management
  // -------------------------
  function loadSettings() {
    try {
      const saved = localStorage.getItem(CONFIG.settingsKey);
      if (saved) settings = { ...settings, ...JSON.parse(saved) };
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(CONFIG.settingsKey, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  function applySettings() {
    if (!chatWidget || !chatBubbleBtn || !chatSettings) {
      console.warn('⚠️ applySettings: missing DOM elements, skipping apply.');
      return;
    }

    chatWidget.setAttribute('data-theme', settings.theme);
    chatBubbleBtn.setAttribute('data-theme', settings.theme);
    chatSettings.setAttribute('data-theme', settings.theme);

    if (settings.darkMode) {
      chatWidget.classList.add('dark-mode');
      chatSettings.classList.add('dark-mode');
      chatBubbleBtn.classList.add('dark-mode');
    } else {
      chatWidget.classList.remove('dark-mode');
      chatSettings.classList.remove('dark-mode');
      chatBubbleBtn.classList.remove('dark-mode');
    }

    if (darkModeToggle) darkModeToggle.checked = settings.darkMode;
    chatWidget.classList.remove('bottom-left', 'bottom-right');
    chatBubbleBtn.classList.remove('bottom-left', 'bottom-right');
    chatWidget.classList.add(settings.position);
    chatBubbleBtn.classList.add(settings.position);

    if (positionSelect) positionSelect.value = settings.position;
    if (soundToggle) soundToggle.checked = settings.soundEnabled;

    document.querySelectorAll('.theme-btn').forEach((btn) => {
      try {
        btn.classList.toggle('active', btn.dataset.theme === settings.theme);
      } catch (e) {
        // noop
      }
    });
  }

  // -------------------------
  // TOGGLE UI
  // -------------------------
  function toggleChat() {
    return isOpen ? closeChat() : openChat();
  }

  function openChat() {
    if (!chatWidget || !chatBubbleBtn) return;
    isOpen = true;
    chatWidget.classList.add('active');
    chatBubbleBtn.classList.add('active');
    if (chatInput) chatInput.focus();
    unreadCount = 0;
    if (unreadBadge) unreadBadge.classList.remove('active');
  }

  function closeChat() {
    if (!chatWidget || !chatBubbleBtn) return;
    isOpen = false;
    chatWidget.classList.remove('active');
    chatBubbleBtn.classList.remove('active');
  }

  function openSettings() {
    if (chatSettings) chatSettings.classList.add('active');
  }

  function closeSettings() {
    if (chatSettings) chatSettings.classList.remove('active');
  }

  // -------------------------
  // MESSAGE UI
  // -------------------------
  function createMessageElement({ text, sender, timestamp }) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = sender === 'bot' ? '🤖' : '👤';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';

    if (sender === 'bot' && typeof marked !== 'undefined') {
      try {
        const rawHtml = (typeof marked.parse === 'function') ? marked.parse(text) : marked(text);
        bubbleDiv.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(rawHtml) : Security.escapeHtml(text);
      } catch (e) {
        bubbleDiv.textContent = Security.escapeHtml(text);
      }
    } else {
      bubbleDiv.textContent = text;
    }

    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = timestamp;

    contentDiv.appendChild(bubbleDiv);
    contentDiv.appendChild(timeDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);

    return messageDiv;
  }

  function showTypingIndicator() {
    if (!chatMessages) return;
    // if already exists, do nothing
    if (document.getElementById('typing-indicator')) return;

    const indicator = document.createElement('div');
    indicator.className = 'message bot-message';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="message-bubble">
                    <div class="typing-indicator"><span></span><span></span><span></span></div>
                </div>
            </div>
        `;
    chatMessages.appendChild(indicator);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }

  function showWarning(message) {
    if (!chatMessages) return;
    const warningDiv = document.createElement('div');
    warningDiv.className = 'message system-message';
    warningDiv.innerHTML = `<div class="message-content"><div class="message-bubble warning">⚠️ ${Security.escapeHtml(message)}</div></div>`;
    chatMessages.appendChild(warningDiv);
    scrollToBottom();
    setTimeout(() => warningDiv.remove(), 5000);
  }

  function addMessage(text, sender) {
    if (!chatMessages) return;
    const timestamp = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const sanitizedText = sender === 'user' ? Security.sanitize(text) : text;
    const messageData = { text: sanitizedText, sender, timestamp };
    messageHistory.push(messageData);

    const messageEl = createMessageElement(messageData);
    chatMessages.appendChild(messageEl);
    scrollToBottom();

    if (CONFIG.autoSaveHistory) saveHistory();

    if (sender === 'bot' && !isOpen) {
      unreadCount++;
      if (unreadBadge) {
        unreadBadge.textContent = unreadCount;
        unreadBadge.classList.add('active');
      }
      if (settings.soundEnabled) playNotificationSound();
    }
  }

  // -------------------------
  // PROCESS flow for sending user message
  // -------------------------
  async function processUserMessage(messageText) {
    if (!Security.isValidMessage(messageText)) {
      if (messageText.length > 2000) showWarning('Message too long. Maximum 2000 characters.');
      return;
    }

    const rateLimitCheck = RateLimiter.canSend();
    if (!rateLimitCheck.allowed) {
      showWarning(rateLimitCheck.reason);
      return;
    }

    RateLimiter.recordMessage();
    addMessage(messageText, 'user');
    if (chatInput) chatInput.value = '';
    if (chatInput) chatInput.disabled = true;

    showTypingIndicator();

    try {
      const botResponseRaw = await getBotResponse(messageText);
      const limited = ResponseHandler.limitResponse(typeof botResponseRaw === 'string' ? botResponseRaw : String(botResponseRaw || ''));
      const thinkingTime = ResponseHandler.calculateThinkingTime(limited);
      await ResponseHandler.simulateThinking(thinkingTime);
      removeTypingIndicator();
      addMessage(limited, 'bot');
    } catch (err) {
      console.error('Response error:', err);
      removeTypingIndicator();
      addMessage('Sorry, something went wrong. Please try again.', 'bot');
    } finally {
      if (chatInput) chatInput.disabled = false;
      if (chatInput) chatInput.focus();
    }
  }

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!chatInput) return;
    const messageText = chatInput.value.trim();
    await processUserMessage(messageText);
  }

  // -------------------------
  // BOT RESPONSE (smart logic + OpenAI fallback)
  // -------------------------
  function getSmartResponse(message) {
    const lower = Security.sanitize(message).toLowerCase();
    const responses = [
      "I'm not sure about that. Could you rephrase?",
      'Thanks for sharing! What can I help you with?',
      "Got it! Is there anything specific you'd like help with?"
    ];

    if (/^(hi|hello|hey)/i.test(lower)) return 'Hello! 👋 How can I assist you today?';
    if (/help|assist/i.test(lower)) return "I'm here to help! What do you need?";
    if (/feature|capabilit/i.test(lower)) return '✨ I can answer questions, provide info, and assist with various topics!';
    if (/pricing|price|cost/i.test(lower)) return '💰 Please contact our sales team for pricing info.';
    if (/contact|email|phone/i.test(lower)) return '📧 You can reach us at support@example.com';
    if (/bye|goodbye/i.test(lower)) return 'Goodbye! 👋 Have a great day!';
    if (/thank/i.test(lower)) return "You're welcome! 😊";

    return responses[Math.floor(Math.random() * responses.length)];
  }

  // Helper: fetch with timeout
  async function fetchWithTimeout(url, opts = {}, timeoutMs = CONFIG.requestTimeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      return response;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  async function getBotResponse(userMessage) {
    const training = await loadTrainingData();
    const sanitizedMessage = Security.sanitize(userMessage);

    // FAQs
    try {
      const faq = findFaqMatch(sanitizedMessage, training.faqs || []);
      if (faq && faq.answer) return faq.answer;
    } catch (e) {
      /* continue to next */
    }

    // Knowledge base
    try {
      const knowledge = findKnowledgeMatch(sanitizedMessage, training.knowledge || []);
      if (knowledge && (knowledge.content || knowledge.answer)) return knowledge.content || knowledge.answer;
    } catch (e) {
      /* continue to next */
    }

    // OpenAI (only if explicitly enabled and key configured)
    if (CONFIG.useOpenAI && CONFIG.openAI_Key && !CONFIG.openAI_Key.startsWith('sk-your')) {
      try {
        const messages = [
          { role: 'system', content: training.instructions || 'You are a helpful assistant.' },
          ...messageHistory.slice(-5).map((msg) => ({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.text })),
          { role: 'user', content: sanitizedMessage }
        ];

        const body = {
          model: 'gpt-3.5-turbo',
          messages,
          max_tokens: 300,
          temperature: 0.7
        };

        const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${CONFIG.openAI_Key}`
          },
          body: JSON.stringify(body)
        });

        if (!resp.ok) {
          console.warn('OpenAI API responded with status', resp.status);
          // fallback to smart response
        } else {
          const data = await resp.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text && typeof text === 'string') return text;
        }
      } catch (err) {
        console.warn('OpenAI request failed, falling back to internal responses.', err);
      }
    }

    // Finally: internal smart response
    return getSmartResponse(sanitizedMessage);
  }

  // -------------------------
  // UTILITIES
  // -------------------------
  function playNotificationSound() {
    if (!settings.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // silent fail for browsers without AudioContext
    }
  }

  function scrollToBottom() {
    if (chatMessages) {
      try {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
      } catch (e) {
        // fallback
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(messageHistory.slice(-CONFIG.maxStoredMessages)));
    } catch (e) {
      // ignore storage failures
    }
  }

  function loadHistory() {
    try {
      const saved = localStorage.getItem(CONFIG.storageKey);
      if (saved) {
        messageHistory = JSON.parse(saved);
        if (chatMessages) {
          chatMessages.innerHTML = '';
          messageHistory.forEach((msg) => chatMessages.appendChild(createMessageElement(msg)));
          scrollToBottom();
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function clearHistory() {
    if (confirm('Clear all chat history?')) {
      messageHistory = [];
      localStorage.removeItem(CONFIG.storageKey);
      if (chatMessages) chatMessages.innerHTML = '';
      // avoid reload — keep user on page
    }
  }

  function exportChat() {
    const format = (prompt('Export format: TXT or JSON?', 'TXT') || '').toUpperCase();
    if (format === 'TXT') {
      let content = 'Chat Export - ' + new Date().toLocaleString() + '\n\n';
      messageHistory.forEach((msg) => {
        content += `[${msg.timestamp}] ${msg.sender.toUpperCase()}: ${msg.text}\n`;
      });
      downloadFile('chat-export.txt', content);
    } else if (format === 'JSON') {
      downloadFile('chat-export.json', JSON.stringify(messageHistory, null, 2));
    }
  }

  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -------------------------
  // EVENT LISTENERS
  // -------------------------
  function attachEventListeners() {
    if (chatBubbleBtn) chatBubbleBtn.addEventListener('click', toggleChat);
    if (chatCloseBtn) chatCloseBtn.addEventListener('click', closeChat);
    if (chatForm) chatForm.addEventListener('submit', handleSubmit);

    if (darkModeToggle) {
      darkModeToggle.addEventListener('change', (e) => {
        settings.darkMode = !!e.target.checked;
        applySettings();
        saveSettings();
      });
    }

    if (soundToggle) {
      soundToggle.addEventListener('change', (e) => {
        settings.soundEnabled = !!e.target.checked;
        saveSettings();
      });
    }

    if (positionSelect) {
      positionSelect.addEventListener('change', (e) => {
        settings.position = e.target.value;
        applySettings();
        saveSettings();
      });
    }

    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset && btn.dataset.theme) {
          settings.theme = btn.dataset.theme;
          applySettings();
          saveSettings();
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (chatSettings?.classList.contains('active')) closeSettings();
        else if (isOpen) closeChat();
      }
    });

    if (chatInput) {
      chatInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text');
        document.execCommand('insertText', false, Security.sanitize(text));
      });
    }
  }

  // -------------------------
  // PUBLIC API
  // -------------------------
  window.ChatWidget = {
    open: openChat,
    close: closeChat,
    toggle: toggleChat,
    openSettings,
    closeSettings,
    clearHistory,
    exportChat,
    sendMessage: (text) => {
      if (!text) return;
      if (!Security.isValidMessage(text)) return;
      processUserMessage(text);
    }
  };

  // -------------------------
  // INIT
  // -------------------------
  async function init() {
    initDomElements();

    await initSupabase();
    // Pre-fetch training data from Supabase if available
    if (supabaseClient) {
      cachedTrainingData = await fetchTrainingDataFromSupabase();
    }

    loadSettings();
    applySettings();
    loadHistory();
    attachEventListeners();

    console.log('✅ Chat Widget PRO initialized');
    console.log('📚 Training source:', supabaseClient ? 'Supabase' : 'localStorage');

    // Security note: using anonKey client-side has risks. Ensure RLS policies for your Supabase table.
    if (CONFIG.supabase.enabled && CONFIG.supabase.anonKey && !CONFIG.supabase.anonKey.startsWith('YOUR_')) {
      console.log('⚠️ Note: You are using a client-side Supabase anonKey. Ensure you have proper RLS policies and restrictions.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
