// Chat functionality with WebSocket streaming

let socket = null;
let currentDocumentId = null;
let currentSessionId = null;
let isConnected = false;
let messageQueue = [];
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;
let chatSessions = [];

// Use window.currentUser instead of declaring a new variable
// let currentUser = null;  // Remove this line
let apiBaseUrl = window.location.origin;

document.addEventListener('DOMContentLoaded', function() {
    console.log('Chat interface loading...');
    checkChatAccess();
});

// Authentication and access control
async function checkChatAccess() {
    if (!isAuthenticated()) {
        console.log('Not authenticated, redirecting to login');
        window.location.href = '/app';
        return;
    }
    
    try {
        const user = await apiCall('/users/me');
        if (!user) {
            window.location.href = '/app';
            return;
        }
        window.currentUser = user;
        console.log('Chat access granted for:', window.currentUser.username);
        
        // Initialize chat interface
        setupChatEventListeners();
        loadInitialChatData();
        
    } catch (error) {
        console.error('Chat access check failed:', error);
        showAlert('Failed to verify access: ' + error.message, 'error');
        setTimeout(() => {
            window.location.href = '/app';
        }, 3000);
    }
}

function isAuthenticated() {
    const token = localStorage.getItem('Sage_token');
    return token !== null && token !== 'undefined' && token !== '';
}

function getToken() {
    return localStorage.getItem('Sage_token');
}

async function apiCall(endpoint, options = {}) {
    const token = getToken();
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        }
    };
    
    const config = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    try {
        console.log(`Making API call to: ${apiBaseUrl}${endpoint}`);
        const response = await fetch(`${apiBaseUrl}${endpoint}`, config);
        
        if (response.status === 401) {
            logout();
            return null;
        }
        
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }
        
        if (!response.ok) {
            const errorMessage = typeof data === 'object' ? (data.detail || 'API request failed') : data;
            throw new Error(errorMessage);
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

function logout() {
    localStorage.removeItem('Sage_token');
    showAlert('Session expired. Please login again.', 'warning');
    setTimeout(() => {
        window.location.href = '/app';
    }, 2000);
}

function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alert-container') || createAlertContainer();
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>${message}</span>
            <span style="cursor: pointer; margin-left: 1rem; font-size: 1.2rem;" onclick="this.parentElement.parentElement.remove()">&times;</span>
        </div>
    `;
    
    alertContainer.appendChild(alert);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (alert.parentElement) {
            alert.remove();
        }
    }, 5000);
}

function createAlertContainer() {
    const container = document.createElement('div');
    container.id = 'alert-container';
    container.className = 'alert-container';
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
    `;
    document.body.appendChild(container);
    return container;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

// Event listeners setup
function setupChatEventListeners() {
    console.log('Setting up chat event listeners...');
    
    // Chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', handleKeyPress);
        chatInput.addEventListener('paste', handlePaste);
        chatInput.addEventListener('input', handleInputChange);
    }
    
    // Send button
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    
    // Document selector
    const documentSelect = document.getElementById('document-select');
    if (documentSelect) {
        documentSelect.addEventListener('change', onDocumentChange);
    }
    
    // Window events
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.close();
        }
    });
    
    // Connection status updates
    updateConnectionStatus('disconnected');
    
    // Mobile sidebar controls
    setupMobileControls();
}

function setupMobileControls() {
    // Add mobile menu button for small screens
    if (window.innerWidth <= 768) {
        const chatHeader = document.querySelector('.chat-header');
        if (chatHeader && !chatHeader.querySelector('.mobile-menu-btn')) {
            const menuBtn = document.createElement('button');
            menuBtn.className = 'btn btn-small btn-secondary mobile-menu-btn';
            menuBtn.innerHTML = '<i class="fas fa-bars"></i>';
            menuBtn.onclick = toggleSidebar;
            
            const chatActions = document.querySelector('.chat-actions');
            if (chatActions) {
                chatActions.insertBefore(menuBtn, chatActions.firstChild);
            }
        }
    }
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            const sidebar = document.querySelector('.chat-sidebar');
            if (sidebar) {
                sidebar.classList.remove('active');
            }
        }
    });
}

function toggleSidebar() {
    const sidebar = document.querySelector('.chat-sidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}

// Data loading functions
async function loadInitialChatData() {
    try {
        showLoading();
        console.log('Loading initial chat data...');
        
        // Load available documents
        await loadAvailableDocuments();
        
        // Load user's chat sessions
        await loadChatSessions();
        
        // Check if there's a pre-selected document from dashboard
        const selectedDocId = localStorage.getItem('selected_document_id');
        if (selectedDocId) {
            localStorage.removeItem('selected_document_id');
            const documentSelect = document.getElementById('document-select');
            if (documentSelect) {
                documentSelect.value = selectedDocId;
                onDocumentChange();
            }
        }
        
    } catch (error) {
        console.error('Failed to load chat data:', error);
        showAlert('Failed to load chat data: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function loadAvailableDocuments() {
    try {
        let documents = [];
        
        // Try to get documents
        try {
            documents = await apiCall('/admin/documents');
        } catch (error) {
            console.log('Cannot access admin documents:', error);
            documents = [];
        }
        
        console.log('Available documents:', documents);
        
        const documentSelect = document.getElementById('document-select');
        if (!documentSelect) return;
        
        // Clear existing options
        documentSelect.innerHTML = '<option value="">Choose a document...</option>';
        
        // Add completed documents
        const completedDocs = documents.filter(doc => 
            doc.status === 'completed' && doc.chunks_count > 0
        );
        
        completedDocs.forEach(doc => {
            const option = document.createElement('option');
            option.value = doc.document_id;
            option.textContent = `${doc.original_filename} (${doc.chunks_count} chunks)`;
            documentSelect.appendChild(option);
        });
        
        if (completedDocs.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No documents available - Contact admin';
            option.disabled = true;
            documentSelect.appendChild(option);
            
            updateChatStatus('No documents available for chat');
        }
        
    } catch (error) {
        console.error('Failed to load documents:', error);
        showAlert('Failed to load available documents', 'error');
    }
}

async function loadChatSessions() {
    try {
        chatSessions = await apiCall('/chat/sessions');
        console.log('Chat sessions loaded:', chatSessions);
        renderChatSessions();
    } catch (error) {
        console.error('Failed to load chat sessions:', error);
        chatSessions = [];
        renderChatSessions();
    }
}

function renderChatSessions() {
    const sessionsList = document.getElementById('sessions-list');
    if (!sessionsList) return;
    
    if (chatSessions.length === 0) {
        sessionsList.innerHTML = '<p class="no-sessions">No chat sessions yet</p>';
        return;
    }
    
    sessionsList.innerHTML = chatSessions.map(session => `
        <div class="session-item ${session.session_id === currentSessionId ? 'active' : ''}" 
             onclick="loadChatSession('${session.session_id}', '${session.document_id}')">
            <div class="session-name">${session.session_name}</div>
            <div class="session-info">
                ${formatDate(session.updated_at || session.created_at)}
            </div>
        </div>
    `).join('');
}

async function loadChatSession(sessionId, documentId) {
    try {
        showLoading();
        console.log(`Loading chat session: ${sessionId} for document: ${documentId}`);
        
        // Set current session
        currentSessionId = sessionId;
        currentDocumentId = documentId;
        
        // Update document selector
        const documentSelect = document.getElementById('document-select');
        if (documentSelect) {
            documentSelect.value = documentId;
        }
        
        // Update chat title
        const session = chatSessions.find(s => s.session_id === sessionId);
        if (session) {
            document.getElementById('chat-title').textContent = session.session_name;
        }
        
        // Load session messages
        const messages = await apiCall(`/chat/sessions/${sessionId}/messages`);
        console.log('Session messages loaded:', messages);
        
        // Clear chat messages
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = '';
        
        // Render messages
        if (messages && messages.length > 0) {
            messages.forEach(message => {
                addMessageToChat(message.message, 'user');
                addMessageToChat(message.response, 'assistant');
            });
        } else {
            addWelcomeMessage();
        }
        
        // Connect WebSocket if not connected
        if (!isConnected) {
            connectWebSocket();
        } else {
            // Re-initialize with new document
            initializeWebSocketSession();
        }
        
        // Update UI
        enableChatInput();
        renderChatSessions();
        
    } catch (error) {
        console.error('Failed to load chat session:', error);
        showAlert('Failed to load chat session: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Document selection handling
function onDocumentChange() {
    const documentSelect = document.getElementById('document-select');
    const documentId = documentSelect.value;
    
    console.log('Document changed to:', documentId);
    
    if (!documentId) {
        disableChatInput();
        currentDocumentId = null;
        updateChatStatus('Select a document to start chatting');
        disconnectWebSocket();
        return;
    }
    
    currentDocumentId = documentId;
    currentSessionId = null; // Reset session when changing document
    
    // Update chat title
    const selectedOption = documentSelect.options[documentSelect.selectedIndex];
    document.getElementById('chat-title').textContent = `Chat: ${selectedOption.textContent}`;
    updateChatStatus('Connecting...');
    
    // Clear existing messages
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';
    
    // Add welcome message
    addWelcomeMessage();
    
    // Connect WebSocket
    connectWebSocket();
}

function addWelcomeMessage() {
    const chatMessages = document.getElementById('chat-messages');
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'welcome-message';
    welcomeDiv.innerHTML = `
        <div class="assistant-avatar">
            <i class="fas fa-robot"></i>
        </div>
        <div class="message-content">
            <p>Hello! I'm Sage, your Enterprise Support Assistant. I'm ready to help you with questions about the selected document.</p>
        </div>
    `;
    chatMessages.appendChild(welcomeDiv);
    scrollToBottom();
}

// WebSocket connection handling
function connectWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    }
    
    const token = getToken();
    if (!token) {
        showAlert('Authentication required', 'error');
        return;
    }
    
    updateConnectionStatus('connecting');
    
    // Use WSS for HTTPS, WS for HTTP
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/chat/ws/${token}`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    socket = new WebSocket(wsUrl);
    
    socket.onopen = function(event) {
        console.log('WebSocket connected');
        isConnected = true;
        reconnectAttempts = 0;
        updateConnectionStatus('connected');
        initializeWebSocketSession();
    };
    
    socket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    socket.onclose = function(event) {
        console.log('WebSocket closed:', event.code, event.reason);
        isConnected = false;
        updateConnectionStatus('disconnected');
        
        if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
            // Attempt to reconnect
            setTimeout(() => {
                reconnectAttempts++;
                console.log(`Reconnection attempt ${reconnectAttempts}`);
                if (currentDocumentId) {
                    connectWebSocket();
                }
            }, Math.pow(2, reconnectAttempts) * 1000); // Exponential backoff
        }
    };
    
    socket.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
        showAlert('Connection error. Please try again.', 'error');
    };
}

function disconnectWebSocket() {
    if (socket) {
        socket.close();
        socket = null;
    }
    isConnected = false;
    updateConnectionStatus('disconnected');
}

function initializeWebSocketSession() {
    if (!socket || socket.readyState !== WebSocket.OPEN || !currentDocumentId) {
        console.log('Cannot initialize WebSocket session:', {
            socket: !!socket,
            readyState: socket?.readyState,
            documentId: currentDocumentId
        });
        return;
    }
    
    const initMessage = {
        document_id: currentDocumentId,
        session_id: currentSessionId
    };
    
    console.log('Sending WebSocket init message:', initMessage);
    socket.send(JSON.stringify(initMessage));
}

function handleWebSocketMessage(data) {
    console.log('WebSocket message:', data);
    
    switch (data.status) {
        case 'initialized':
            console.log('WebSocket session initialized');
            currentSessionId = data.session_id;
            updateChatStatus('Ready to chat');
            enableChatInput();
            
            // Update sessions list if new session was created
            if (!chatSessions.find(s => s.session_id === currentSessionId)) {
                loadChatSessions();
            }
            break;
            
        case 'searching':
            updateChatStatus(data.message || 'Searching...');
            break;
            
        case 'streaming':
            appendToCurrentMessage(data.token);
            break;
            
        case 'complete':
            completeCurrentMessage(data.answer);
            updateChatStatus('Ready to chat');
            enableChatInput();
            
            // Save session ID if it was created
            if (data.session_id && data.session_id !== currentSessionId) {
                currentSessionId = data.session_id;
                loadChatSessions(); // Refresh sessions list
            }
            break;
            
        case 'error':
            showAlert('Chat error: ' + data.error, 'error');
            updateChatStatus('Error occurred');
            enableChatInput();
            removeCurrentStreamingMessage();
            break;
            
        case 'heartbeat':
            // Handle heartbeat silently
            break;
            
        default:
            console.log('Unknown message type:', data.status);
    }
}

// Message handling
function sendMessage() {
    const chatInput = document.getElementById('chat-input');
    const message = chatInput.value.trim();
    
    if (!message) {
        return;
    }
    
    if (!isConnected || !currentDocumentId) {
        showAlert('Please select a document and ensure connection is established', 'warning');
        return;
    }
    
    console.log('Sending message:', message);
    
    // Add user message to chat
    addMessageToChat(message, 'user');
    
    // Clear input
    chatInput.value = '';
    adjustTextareaHeight(chatInput);
    
    // Disable input while processing
    disableChatInput();
    updateChatStatus('Processing...');
    
    // Start assistant message
    startAssistantMessage();
    
    // Send message via WebSocket
    const messageData = { question: message };
    console.log('Sending message data:', messageData);
    socket.send(JSON.stringify(messageData));
}

function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function handleInputChange(event) {
    adjustTextareaHeight(event.target);
    
    // Update send button state
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.disabled = !event.target.value.trim() || !isConnected;
    }
}

function adjustTextareaHeight(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function handlePaste(event) {
    setTimeout(() => {
        const chatInput = document.getElementById('chat-input');
        if (chatInput.value.length > 2000) {
            showAlert('Message is too long. Please keep it under 2000 characters.', 'warning');
            chatInput.value = chatInput.value.substring(0, 2000);
        }
        adjustTextareaHeight(chatInput);
    }, 10);
}

function addMessageToChat(message, sender) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = `${sender}-avatar`;
    avatar.innerHTML = sender === 'user' ? 
        '<i class="fas fa-user"></i>' : 
        '<i class="fas fa-robot"></i>';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = formatMessage(message);
    
    if (sender === 'user') {
        messageDiv.appendChild(content);
        messageDiv.appendChild(avatar);
    } else {
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
    }
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

function startAssistantMessage() {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant-message';
    messageDiv.id = 'current-streaming-message';
    
    const avatar = document.createElement('div');
    avatar.className = 'assistant-avatar';
    avatar.innerHTML = '<i class="fas fa-robot"></i>';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = `
        <div class="typing-indicator">
            <span>Sage is thinking</span>
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

function appendToCurrentMessage(token) {
    const currentMessage = document.getElementById('current-streaming-message');
    if (!currentMessage) return;
    
    const content = currentMessage.querySelector('.message-content');
    
    // Initialize content if it's the first token
    if (content.innerHTML.includes('typing-indicator')) {
        content.innerHTML = token;
    } else {
        content.innerHTML += token;
    }
    
    scrollToBottom();
}

function completeCurrentMessage(fullResponse) {
    const currentMessage = document.getElementById('current-streaming-message');
    if (!currentMessage) return;
    
    const content = currentMessage.querySelector('.message-content');
    content.innerHTML = formatMessage(fullResponse);
    currentMessage.removeAttribute('id');
    scrollToBottom();
}

function removeCurrentStreamingMessage() {
    const currentMessage = document.getElementById('current-streaming-message');
    if (currentMessage) {
        currentMessage.remove();
    }
}

function formatMessage(message) {
    if (!message) return '';
    
    // Basic message formatting
    return message
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
}

// UI state management
function enableChatInput() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    
    if (chatInput) {
        chatInput.disabled = false;
        chatInput.placeholder = "Ask me anything about the document...";
    }
    if (sendBtn) {
        sendBtn.disabled = !chatInput?.value.trim();
    }
    if (clearBtn) {
        clearBtn.disabled = false;
    }
}

function disableChatInput() {
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    
    if (chatInput) {
        chatInput.disabled = true;
        chatInput.placeholder = "Processing...";
    }
    if (sendBtn) {
        sendBtn.disabled = true;
    }
}

function updateChatStatus(status) {
    const chatStatus = document.getElementById('chat-status');
    if (chatStatus) {
        chatStatus.textContent = status;
    }
}

function updateConnectionStatus(status) {
    const connectionStatus = document.getElementById('connection-status');
    if (!connectionStatus) return;
    
    connectionStatus.className = `connection-status ${status}`;
    
    const statusText = {
        'connected': 'Connected',
        'connecting': 'Connecting...',
        'disconnected': 'Disconnected'
    };
    
    const statusSpan = connectionStatus.querySelector('span');
    if (statusSpan) {
        statusSpan.textContent = statusText[status] || status;
    }
}

function scrollToBottom() {
    const chatMessages = document.getElementById('chat-messages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Chat management functions
function newChat() {
    if (!currentDocumentId) {
        showAlert('Please select a document first', 'warning');
        return;
    }
    
    console.log('Starting new chat for document:', currentDocumentId);
    
    // Clear current session
    currentSessionId = null;
    
    // Clear messages
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';
    
    // Add welcome message
    addWelcomeMessage();
    
    // Re-initialize WebSocket session
    if (isConnected) {
        initializeWebSocketSession();
    }
    
    updateChatStatus('New chat started');
    renderChatSessions(); // Update sessions list
}

function clearChat() {
    if (!confirm('Are you sure you want to clear this chat? This action cannot be undone.')) {
        return;
    }
    
    newChat();
}

// Utility functions
function showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay') || createLoadingOverlay();
    loadingOverlay.classList.add('active');
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }
}

function createLoadingOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div class="loading-content">
            <div class="spinner"></div>
            <h3>Loading...</h3>
            <p>Please wait while we load your chat interface</p>
        </div>
    `;
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        z-index: 9999;
        color: white;
        text-align: center;
    `;
    
    // Add spinner styles
    const style = document.createElement('style');
    style.textContent = `
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top: 4px solid white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(overlay);
    return overlay;
}

// Add custom CSS for better chat styling
const chatStyles = `
    .alert {
        padding: 1rem 1.5rem;
        border-radius: 8px;
        margin-bottom: 1rem;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        animation: slideIn 0.3s ease;
        max-width: 400px;
    }
    
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    .alert-success {
        background: #d4edda;
        color: #155724;
        border-left: 4px solid #28a745;
    }
    
    .alert-error {
        background: #f8d7da;
        color: #721c24;
        border-left: 4px solid #dc3545;
    }
    
    .alert-warning {
        background: #fff3cd;
        color: #856404;
        border-left: 4px solid #ffc107;
    }
    
    .alert-info {
        background: #d1ecf1;
        color: #0c5460;
        border-left: 4px solid #17a2b8;
    }
    
    .mobile-menu-btn {
        display: none;
    }
    
    @media (max-width: 768px) {
        .mobile-menu-btn {
            display: inline-flex;
        }
        
        .chat-sidebar {
            transform: translateX(-100%);
            transition: transform 0.3s ease;
        }
        
        .chat-sidebar.active {
            transform: translateX(0);
        }
    }
`;

// Inject the styles
const chatStyleSheet = document.createElement('style');
chatStyleSheet.textContent = chatStyles;
document.head.appendChild(chatStyleSheet);

// Initialize chat interface when page loads
window.addEventListener('load', function() {
    console.log('Chat page fully loaded');
    
    // Additional initialization if needed
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.focus();
    }
});

// Handle page visibility changes to manage WebSocket connections
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log('Page hidden, maintaining WebSocket connection');
    } else {
        console.log('Page visible again');
        // Reconnect if needed
        if (!isConnected && currentDocumentId) {
            setTimeout(connectWebSocket, 1000);
        }
    }
});