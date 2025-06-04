window.currentUser = window.currentUser || null;
window.apiBaseUrl = window.location.origin;

function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('active');
    }
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
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
        top: 100px;
        right: 20px;
        z-index: 9998;
    `;
    document.body.appendChild(container);
    return container;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showSection(sectionId) {
    console.log('Showing section:', sectionId);
    
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    const targetSection = document.getElementById(sectionId + '-section');
    if (targetSection) {
        targetSection.classList.add('active');
    } else {
        console.error('Section not found:', sectionId + '-section');
        const altSection = document.getElementById(sectionId);
        if (altSection) {
            altSection.classList.add('active');
        }
    }
}

function showHome() {
    showSection('home');
    updateNavigation();
}

function showLogin() {
    showSection('login');
    updateNavigation();
}

function showSignup() {
    showSection('signup');
    updateNavigation();
}

function showDashboard() {
    showSection('dashboard');
    loadDashboardData();
    updateNavigationForUser();
}

function showFeatures() {
    const featuresSection = document.getElementById('features');
    if (featuresSection) {
        featuresSection.style.display = featuresSection.style.display === 'none' ? 'block' : 'none';
    }
}

function showChat() {
    window.location.href = '/chat';
}

function showAdmin() {
    window.location.href = '/admin';
}

function updateNavigation() {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu) return;
    
    if (isAuthenticated()) {
        navMenu.innerHTML = `
            <a href="#" class="nav-link" onclick="showDashboard()">Dashboard</a>
            <a href="#" class="nav-link" onclick="showChat()">Chat</a>
            ${window.currentUser && window.currentUser.role === 'admin' ? '<a href="#" class="nav-link" onclick="showAdmin()">Admin</a>' : ''}
            <div class="nav-user">
                <span class="user-name">${window.currentUser ? window.currentUser.full_name : 'User'}</span>
                <button class="btn btn-outline btn-small" onclick="logout()">
                    <i class="fas fa-sign-out-alt"></i> Logout
                </button>
            </div>
        `;
    } else {
        navMenu.innerHTML = `
            <a href="#" class="nav-link" onclick="showHome()">Home</a>
            <a href="#" class="nav-link" onclick="showLogin()">Login</a>
            <a href="#" class="nav-link" onclick="showSignup()">Sign Up</a>
        `;
    }
}

function updateNavigationForUser() {
    updateNavigation();
}

function getToken() {
    return localStorage.getItem('Sage_token');
}

function setToken(token) {
    localStorage.setItem('Sage_token', token);
}

function removeToken() {
    localStorage.removeItem('Sage_token');
}

function isAuthenticated() {
    const token = getToken();
    return token !== null && token !== 'undefined' && token !== '';
}

function logout() {
    removeToken();
    window.currentUser = null;
    showAlert('Logged out successfully', 'success');
    setTimeout(() => {
        window.location.href = '/app';
    }, 1000);
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
            console.log('Unauthorized, logging out');
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

async function loadDashboardData() {
    if (!isAuthenticated()) {
        console.log('Not authenticated, showing login');
        showLogin();
        return;
    }
    
    try {
        showLoading();
        console.log('Loading dashboard data...');
        
        try {
            window.currentUser = await apiCall('/users/me');
            console.log('Current user:', window.currentUser);
            
            if (window.currentUser) {
                const userNameEl = document.getElementById('user-name');
                if (userNameEl) {
                    userNameEl.textContent = window.currentUser.full_name;
                }
                
                const userRoleEl = document.getElementById('user-role');
                if (userRoleEl) {
                    userRoleEl.textContent = window.currentUser.role === 'admin' ? 'Administrator' : 'User';
                }
                
                const adminBtn = document.getElementById('admin-btn');
                if (window.currentUser.role === 'admin' && adminBtn) {
                    adminBtn.style.display = 'inline-flex';
                }
            }
        } catch (error) {
            console.error('Failed to load user profile:', error);
            showAlert('Failed to load user profile: ' + error.message, 'error');
            return;
        }
        
        try {
            const sessions = await apiCall('/chat/sessions');
            console.log('User sessions:', sessions);
            
            const totalSessionsEl = document.getElementById('total-sessions');
            if (totalSessionsEl) {
                totalSessionsEl.textContent = sessions ? sessions.length : 0;
            }
            
            const lastActivityEl = document.getElementById('last-activity');
            if (lastActivityEl && sessions && sessions.length > 0) {
                const lastSession = sessions[0];
                const lastDate = new Date(lastSession.updated_at || lastSession.created_at);
                const now = new Date();
                const diffHours = Math.floor((now - lastDate) / (1000 * 60 * 60));
                
                if (diffHours < 1) {
                    lastActivityEl.textContent = 'Just now';
                } else if (diffHours < 24) {
                    lastActivityEl.textContent = `${diffHours}h ago`;
                } else {
                    lastActivityEl.textContent = `${Math.floor(diffHours / 24)}d ago`;
                }
            }
        } catch (error) {
            console.error('Failed to load sessions:', error);
            const totalSessionsEl = document.getElementById('total-sessions');
            if (totalSessionsEl) {
                totalSessionsEl.textContent = '0';
            }
        }
        
        try {
            await loadAvailableDocuments();
        } catch (error) {
            console.error('Failed to load documents:', error);
            showEmptyDocumentsState();
        }
        
        updateNavigationForUser();
        
    } catch (error) {
        console.error('Dashboard loading error:', error);
        showAlert('Failed to load dashboard: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function loadAvailableDocuments() {
    try {
        const documents = await apiCall('/users/documents');
        console.log('Available documents:', documents);
        
        const documentsListEl = document.getElementById('documents-list');
        const totalDocumentsEl = document.getElementById('total-documents');
        
        if (totalDocumentsEl) {
            totalDocumentsEl.textContent = documents ? documents.length : 0;
        }
        
        if (documentsListEl) {
            if (!documents || documents.length === 0) {
                showEmptyDocumentsState();
            } else {
                renderDocumentsList(documents);
            }
        }
        
    } catch (error) {
        console.error('Error loading documents:', error);
        showEmptyDocumentsState();
        throw error;
    }
}

function showEmptyDocumentsState() {
    const documentsListEl = document.getElementById('documents-list');
    if (documentsListEl) {
        documentsListEl.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #666;">
                <i class="fas fa-file-alt" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                <h3>No Documents Available</h3>
                <p>Contact your administrator to upload documents to the knowledge base.</p>
                <button class="btn btn-primary" onclick="window.location.reload()" style="margin-top: 1rem;">
                    <i class="fas fa-refresh"></i> Refresh
                </button>
            </div>
        `;
    }
    
    const totalDocumentsEl = document.getElementById('total-documents');
    if (totalDocumentsEl) {
        totalDocumentsEl.textContent = '0';
    }
}

function renderDocumentsList(documents) {
    const documentsListEl = document.getElementById('documents-list');
    if (!documentsListEl) return;
    
    const completedDocs = documents.filter(doc => 
        doc.status === 'completed' && doc.chunks_count > 0
    );
    
    if (completedDocs.length === 0) {
        documentsListEl.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #666;">
                <i class="fas fa-clock" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                <h3>Documents Processing</h3>
                <p>Documents are being processed. Please check back later.</p>
                <button class="btn btn-primary" onclick="window.location.reload()" style="margin-top: 1rem;">
                    <i class="fas fa-refresh"></i> Refresh
                </button>
            </div>
        `;
        return;
    }
    
    documentsListEl.innerHTML = completedDocs.map(doc => `
        <div class="document-item">
            <div class="document-info">
                <h4>${doc.original_filename}</h4>
                <p>Type: ${doc.file_type.toUpperCase()} • Size: ${formatFileSize(doc.file_size)} • Chunks: ${doc.chunks_count}</p>
                <small>Uploaded: ${formatDate(doc.created_at)}</small>
            </div>
            <div>
                <span class="status-badge status-completed">Ready</span>
                <button class="btn btn-primary btn-small" onclick="startChatWithDocument('${doc.document_id}')" style="margin-left: 0.5rem;">
                    <i class="fas fa-comments"></i> Chat
                </button>
            </div>
        </div>
    `).join('');
}

function startChatWithDocument(documentId) {
    localStorage.setItem('selected_document_id', documentId);
    showChat();
}

async function verifyAuthentication() {
    if (isAuthenticated()) {
        try {
            window.currentUser = await apiCall('/users/me');
            if (window.currentUser) {
                console.log('User verified:', window.currentUser);
                return true;
            }
        } catch (error) {
            console.log('Token verification failed:', error);
            removeToken();
            window.currentUser = null;
        }
    }
    return false;
}

document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded, initializing...');
    
    const isAuthed = await verifyAuthentication();
    
    if (isAuthed) {
        console.log('User is authenticated, showing dashboard');
        showDashboard();
    } else {
        console.log('User not authenticated, showing home');
        showHome();
    }
    
    setupEventListeners();
});

function setupEventListeners() {
    console.log('Event listeners set up');
    
    window.addEventListener('popstate', function(event) {
        if (isAuthenticated()) {
            showDashboard();
        } else {
            showHome();
        }
    });
}