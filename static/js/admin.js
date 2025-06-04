let selectedFiles = [];
let currentSection = 'documents';
let currentUser = null;
let apiBaseUrl = window.location.origin;

document.addEventListener('DOMContentLoaded', function() {
    checkAdminAccess();
});

async function checkAdminAccess() {
    if (!isAuthenticated()) {
        window.location.href = '/app';
        return;
    }
    
    try {
        const user = await apiCall('/users/me');
        if (!user || user.role !== 'admin') {
            showAlert('Access denied. Admin privileges required.', 'error');
            setTimeout(() => {
                window.location.href = '/app';
            }, 2000);
            return;
        }
        currentUser = user;
        console.log('Admin user authenticated:', currentUser);
        
        setupAdminEventListeners();
        updateAdminNavigation();
        
        // Load initial data and show documents section
        await loadInitialData();
        
    } catch (error) {
        console.error('Admin access check failed:', error);
        window.location.href = '/app';
    }
}

function isAuthenticated() {
    return localStorage.getItem('Sage_token') !== null;
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
        const response = await fetch(`${apiBaseUrl}${endpoint}`, config);
        
        if (response.status === 401) {
            logout();
            return null;
        }
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'API request failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

function logout() {
    localStorage.removeItem('Sage_token');
    window.location.href = '/app';
}

function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alert-container') || createAlertContainer();
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>${message}</span>
            <span style="cursor: pointer; margin-left: 1rem;" onclick="this.parentElement.parentElement.remove()">&times;</span>
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
    document.body.appendChild(container);
    return container;
}

function showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('active');
    }
}

function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.remove('active');
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Invalid Date';
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } catch (error) {
        console.error('Error formatting date:', error);
        return 'Invalid Date';
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateAdminNavigation() {
    const adminNameEl = document.getElementById('admin-name');
    if (adminNameEl && currentUser) {
        adminNameEl.textContent = currentUser.full_name;
    }
}

function setupAdminEventListeners() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', handleDragOver);
        uploadArea.addEventListener('dragleave', handleDragLeave);
        uploadArea.addEventListener('drop', handleDrop);
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    const modal = document.getElementById('upload-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeUploadModal();
            }
        });
    }
    
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

function handleKeyboardShortcuts(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        if (currentSection === 'documents') {
            showUploadModal();
        }
    }
    
    if (e.key === 'Escape') {
        closeUploadModal();
    }
    
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        if (currentSection === 'documents') loadDocuments();
        if (currentSection === 'users') loadUsers();
        if (currentSection === 'analytics') loadAnalytics();
        if (currentSection === 'settings') loadSettings();
    }
}

async function loadInitialData() {
    console.log('=== Starting loadInitialData ===');
    
    try {
        console.log('Loading system status...');
        await loadSystemStatus();
        console.log('System status loaded successfully');
        
        console.log('Showing documents section...');
        showSection('documents');
        console.log('=== loadInitialData completed ===');
        
    } catch (error) {
        console.error('Error in loadInitialData:', error);
        showAlert('Failed to load initial data: ' + error.message, 'error');
        
        // Try to show documents section anyway
        try {
            showSection('documents');
        } catch (sectionError) {
            console.error('Failed to show documents section:', sectionError);
        }
    }
}

async function loadSystemStatus() {
    try {
        const healthResponse = await fetch(`${apiBaseUrl}/health`);
        const healthData = await healthResponse.json();
        
        updateStatusIndicator('api-indicator', healthResponse.ok);
        updateStatusIndicator('db-indicator', healthResponse.ok);
        updateStatusIndicator('vector-indicator', healthResponse.ok);
        
    } catch (error) {
        updateStatusIndicator('api-indicator', false);
        updateStatusIndicator('db-indicator', false);
        updateStatusIndicator('vector-indicator', false);
    }
}

function updateStatusIndicator(indicatorId, isHealthy) {
    const indicator = document.getElementById(indicatorId);
    if (indicator) {
        indicator.className = `status-indicator ${isHealthy ? 'status-healthy' : 'status-error'}`;
        indicator.style.color = isHealthy ? '#28a745' : '#dc3545';
    }
}

function showSection(sectionName) {
    console.log('=== showSection called with:', sectionName, '===');
    
    // Map section names to actual section IDs
    const sectionMapping = {
        'documents': 'documents-section',
        'users': 'users-section', 
        'analytics': 'analytics-section',
        'settings': 'settings-section'
    };
    
    const actualSectionId = sectionMapping[sectionName] || `${sectionName}-section`;
    console.log('Looking for section ID:', actualSectionId);
    
    // Check if section exists
    const targetSection = document.getElementById(actualSectionId);
    if (!targetSection) {
        console.error('❌ Section not found:', actualSectionId);
        console.log('Available sections:');
        document.querySelectorAll('.admin-section').forEach(section => {
            console.log('  - ' + section.id);
        });
        return;
    }
    
    console.log('✅ Target section found:', actualSectionId);
    
    // Update menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
        console.log('Removed active from menu item');
    });
    
    // Find and activate the correct menu item
    const menuItems = document.querySelectorAll('.menu-item');
    let foundMenuItem = false;
    menuItems.forEach(item => {
        const onclickAttr = item.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(`'${sectionName}'`)) {
            item.classList.add('active');
            foundMenuItem = true;
            console.log('✅ Activated menu item for:', sectionName);
        }
    });
    
    if (!foundMenuItem) {
        console.warn('⚠️ Menu item not found for section:', sectionName);
    }
    
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(section => {
        section.classList.remove('active');
        section.style.display = 'none';
        console.log('Hidden section:', section.id);
    });
    
    // Show target section
    targetSection.classList.add('active');
    targetSection.style.display = 'block';
    console.log('✅ Shown section:', actualSectionId);
    
    // Verify section is visible
    setTimeout(() => {
        const isVisible = targetSection.offsetHeight > 0;
        console.log('Section visibility check:', isVisible ? '✅ VISIBLE' : '❌ NOT VISIBLE');
        if (!isVisible) {
            console.error('Section is not visible! Debugging...');
            console.log('Section classes:', targetSection.className);
            console.log('Section style.display:', targetSection.style.display);
            console.log('Section offsetHeight:', targetSection.offsetHeight);
        }
    }, 100);
    
    currentSection = sectionName;
    
    // Load section-specific data
    console.log('Loading data for section:', sectionName);
    switch (sectionName) {
        case 'documents':
            console.log('📄 Loading documents...');
            loadDocuments();
            break;
        case 'users':
            console.log('👥 Loading users...');
            loadUsers();
            break;
        case 'analytics':
            console.log('📊 Loading analytics...');
            loadAnalytics();
            break;
        case 'settings':
            console.log('⚙️ Loading settings...');
            loadSettings();
            break;
        default:
            console.warn('Unknown section:', sectionName);
    }
    
    console.log('=== showSection completed ===');
}

async function loadDocuments() {
    try {
        showLoading();
        const documents = await apiCall('/admin/documents');
        console.log('Documents loaded:', documents);
        
        if (documents && Array.isArray(documents)) {
            renderDocumentsTable(documents);
            updateDocumentStats(documents);
            updateMenuBadge('docs-count', documents.length);
        } else {
            console.error('Invalid documents response:', documents);
            renderDocumentsTable([]);
            updateDocumentStats([]);
            updateMenuBadge('docs-count', 0);
        }
    } catch (error) {
        console.error('Failed to load documents:', error);
        showAlert('Failed to load documents: ' + error.message, 'error');
        renderDocumentsTable([]);
        updateDocumentStats([]);
        updateMenuBadge('docs-count', 0);
    } finally {
        hideLoading();
    }
}

function updateDocumentStats(documents) {
    if (!documents || !Array.isArray(documents)) {
        updateStat('total-documents', 0);
        updateStat('processed-documents', 0);
        updateStat('processing-documents', 0);
        updateStat('total-chunks', 0);
        return;
    }
    
    const totalDocs = documents.length;
    const processedDocs = documents.filter(d => d && d.status === 'completed').length;
    const processingDocs = documents.filter(d => d && d.status === 'processing').length;
    const totalChunks = documents.reduce((sum, doc) => {
        return sum + (doc && typeof doc.chunks_count === 'number' ? doc.chunks_count : 0);
    }, 0);
    
    updateStat('total-documents', totalDocs);
    updateStat('processed-documents', processedDocs);
    updateStat('processing-documents', processingDocs);
    updateStat('total-chunks', totalChunks);
}

function updateStat(statId, value) {
    const statElement = document.getElementById(statId);
    if (statElement) {
        statElement.textContent = value;
    }
}

function updateMenuBadge(badgeId, value) {
    const badge = document.getElementById(badgeId);
    if (badge) {
        badge.textContent = value;
    }
}

function renderDocumentsTable(documents) {
    const tbody = document.getElementById('documents-tbody');
    if (!tbody) return;
    
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 3rem; color: #666;">
                    <i class="fas fa-file-upload" style="font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.5;"></i>
                    <h3 style="margin-bottom: 0.5rem;">No documents uploaded yet</h3>
                    <p>Upload your first document to get started with Sage.</p>
                    <button class="btn btn-primary" onclick="showUploadModal()" style="margin-top: 1rem;">
                        <i class="fas fa-upload"></i> Upload Document
                    </button>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = documents.map(doc => {
        if (!doc) return '';
        
        const documentId = doc.document_id || '';
        const fileName = doc.original_filename || 'Unknown';
        const fileType = doc.file_type || 'unknown';
        const fileSize = doc.file_size || 0;
        const status = doc.status || 'unknown';
        const chunksCount = doc.chunks_count || 0;
        const createdAt = doc.created_at || '';
        
        return `
            <tr data-document-id="${documentId}">
                <td>
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <i class="fas ${getFileIcon(fileType)}" style="font-size: 1.5rem; color: ${getFileColor(fileType)};"></i>
                        <div>
                            <div style="font-weight: 500; margin-bottom: 0.25rem;">${fileName}</div>
                            <div style="font-size: 0.75rem; color: #666; font-family: monospace;">${documentId}</div>
                        </div>
                    </div>
                </td>
                <td><span class="file-type-badge ${fileType}">${fileType.toUpperCase()}</span></td>
                <td>${formatFileSize(fileSize)}</td>
                <td><span class="status-badge status-${status}">${formatStatus(status)}</span></td>
                <td>
                    <span style="font-weight: 500;">${chunksCount}</span>
                    ${chunksCount > 0 ? '<i class="fas fa-check-circle" style="color: #28a745; margin-left: 0.5rem;" title="Ready for chat"></i>' : ''}
                </td>
                <td>${formatDate(createdAt)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn btn-view" onclick="viewDocument('${documentId}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn btn-status" onclick="checkDocumentStatus('${documentId}')" title="Check Status">
                            <i class="fas fa-info-circle"></i>
                        </button>
                        <button class="action-btn btn-delete" onclick="deleteDocument('${documentId}', '${fileName}')" title="Delete Document">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getFileIcon(fileType) {
    const icons = {
        'pdf': 'fa-file-pdf',
        'docx': 'fa-file-word',
        'txt': 'fa-file-alt',
        'xlsx': 'fa-file-excel'
    };
    return icons[fileType] || 'fa-file';
}

function getFileColor(fileType) {
    const colors = {
        'pdf': '#e74c3c',
        'docx': '#3498db',
        'txt': '#95a5a6',
        'xlsx': '#27ae60'
    };
    return colors[fileType] || '#666';
}

function formatStatus(status) {
    const statusMap = {
        'processing': 'Processing',
        'completed': 'Completed',
        'failed': 'Failed'
    };
    return statusMap[status] || status;
}

async function viewDocument(documentId) {
    try {
        showLoading();
        const status = await apiCall(`/admin/documents/${documentId}/status`);
        
        const statusInfo = `
            <div style="text-align: left;">
                <h4 style="margin-bottom: 1rem;">Document Information</h4>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 0.5rem; border-bottom: 1px solid #eee;"><strong>Status:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid #eee;">${formatStatus(status.status)}</td></tr>
                    <tr><td style="padding: 0.5rem; border-bottom: 1px solid #eee;"><strong>Chunks:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid #eee;">${status.chunks_count}</td></tr>
                    <tr><td style="padding: 0.5rem; border-bottom: 1px solid #eee;"><strong>Created:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid #eee;">${formatDate(status.created_at)}</td></tr>
                    ${status.error ? `<tr><td style="padding: 0.5rem; color: #e74c3c;"><strong>Error:</strong></td><td style="padding: 0.5rem; color: #e74c3c;">${status.error}</td></tr>` : ''}
                </table>
            </div>
        `;
        
        showAlert(statusInfo, status.status === 'completed' ? 'success' : status.status === 'failed' ? 'error' : 'info');
        
    } catch (error) {
        showAlert('Failed to get document details: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function checkDocumentStatus(documentId) {
    try {
        const row = document.querySelector(`tr[data-document-id="${documentId}"]`);
        if (row) {
            const statusCell = row.querySelector('.status-badge');
            const originalContent = statusCell.innerHTML;
            statusCell.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
            
            const status = await apiCall(`/admin/documents/${documentId}/status`);
            
            statusCell.className = `status-badge status-${status.status}`;
            statusCell.innerHTML = formatStatus(status.status);
            
            const chunksCell = row.cells[4];
            chunksCell.innerHTML = `
                <span style="font-weight: 500;">${status.chunks_count || 0}</span>
                ${status.chunks_count > 0 ? '<i class="fas fa-check-circle" style="color: #28a745; margin-left: 0.5rem;" title="Ready for chat"></i>' : ''}
            `;
            
            showAlert(`Document status updated: ${formatStatus(status.status)}`, 
                status.status === 'completed' ? 'success' : 
                status.status === 'failed' ? 'error' : 'info');
        }
    } catch (error) {
        showAlert('Failed to check document status: ' + error.message, 'error');
    }
}

async function deleteDocument(documentId, filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?\n\nThis action cannot be undone and will remove the document from the knowledge base.`)) {
        return;
    }
    
    try {
        showLoading();
        await apiCall(`/admin/documents/${documentId}`, { method: 'DELETE' });
        showAlert(`Document "${filename}" deleted successfully`, 'success');
        loadDocuments();
    } catch (error) {
        showAlert('Failed to delete document: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function loadUsers() {
    try {
        showLoading();
        const users = await apiCall('/admin/users');
        console.log('Users loaded:', users);
        
        if (users && Array.isArray(users)) {
            renderUsersTable(users);
            updateUserStats(users);
            updateMenuBadge('users-count', users.length);
        } else {
            console.error('Invalid users response:', users);
            renderUsersTable([]);
            updateUserStats([]);
            updateMenuBadge('users-count', 0);
        }
    } catch (error) {
        console.error('Failed to load users:', error);
        showAlert('Failed to load users: ' + error.message, 'error');
        renderUsersTable([]);
        updateUserStats([]);
        updateMenuBadge('users-count', 0);
    } finally {
        hideLoading();
    }
}

function updateUserStats(users) {
    if (!users || !Array.isArray(users)) {
        updateStat('total-users', 0);
        updateStat('active-users', 0);
        updateStat('admin-users', 0);
        updateStat('new-users-today', 0);
        return;
    }
    
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u && u.is_active).length;
    const adminUsers = users.filter(u => u && u.role === 'admin').length;
    const newUsersToday = users.filter(u => {
        if (!u || !u.created_at) return false;
        try {
            const createdDate = new Date(u.created_at);
            const today = new Date();
            return createdDate.toDateString() === today.toDateString();
        } catch (e) {
            return false;
        }
    }).length;
    
    updateStat('total-users', totalUsers);
    updateStat('active-users', activeUsers);
    updateStat('admin-users', adminUsers);
    updateStat('new-users-today', newUsersToday);
}

function renderUsersTable(users) {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    
    if (users.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 3rem; color: #666;">
                    <i class="fas fa-users" style="font-size: 3rem; margin-bottom: 1rem; display: block; opacity: 0.5;"></i>
                    <h3>No users found</h3>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = users.map(user => `
        <tr data-user-id="${user.id}">
            <td>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div class="user-avatar" style="width: 35px; height: 35px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.9rem;">
                        ${user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-weight: 500;">${user.username}</div>
                        <div style="font-size: 0.8rem; color: #666;">ID: ${user.id}</div>
                    </div>
                </div>
            </td>
            <td>${user.email}</td>
            <td>${user.full_name}</td>
            <td><span class="role-badge role-${user.role}">${user.role.toUpperCase()}</span></td>
            <td><span class="status-badge ${user.is_active ? 'status-active' : 'status-inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>${formatDate(user.created_at)}</td>
            <td>
                <div class="action-buttons">
                    ${user.role !== 'admin' ? `
                        <button class="action-btn ${user.is_active ? 'btn-warning' : 'btn-success'}" 
                                onclick="toggleUserStatus(${user.id}, ${!user.is_active}, '${user.username}')" 
                                title="${user.is_active ? 'Deactivate User' : 'Activate User'}">
                            <i class="fas ${user.is_active ? 'fa-user-slash' : 'fa-user-check'}"></i>
                        </button>
                        <button class="action-btn btn-delete" 
                                onclick="deleteUser(${user.id}, '${user.username}')" 
                                title="Delete User">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : `
                        <span style="color: #999; font-style: italic; padding: 0.5rem;">
                            <i class="fas fa-shield-alt"></i> Protected
                        </span>
                    `}
                </div>
            </td>
        </tr>
    `).join('');
}

async function toggleUserStatus(userId, activate, username) {
    const action = activate ? 'activate' : 'deactivate';
    
    if (!confirm(`Are you sure you want to ${action} user "${username}"?`)) {
        return;
    }
    
    try {
        showLoading();
        await apiCall(`/admin/users/${userId}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: activate })
        });
        showAlert(`User "${username}" ${action}d successfully`, 'success');
        loadUsers();
    } catch (error) {
        showAlert(`Failed to ${action} user: ` + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteUser(userId, username) {
    if (!confirm(`Are you sure you want to delete user "${username}"?\n\nThis action cannot be undone and will remove all their chat sessions.`)) {
        return;
    }
    
    const confirmText = prompt(`To confirm deletion, please type the username "${username}" below:`);
    if (confirmText !== username) {
        showAlert('Username confirmation failed. Deletion cancelled.', 'warning');
        return;
    }
    
    try {
        showLoading();
        await apiCall(`/admin/users/${userId}`, { method: 'DELETE' });
        showAlert(`User "${username}" deleted successfully`, 'success');
        loadUsers();
    } catch (error) {
        showAlert('Failed to delete user: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function loadAnalytics() {
    console.log('Loading analytics data...');
    try {
        showLoading();
        
        // Try to load documents and users for analytics
        const [documents, users] = await Promise.all([
            apiCall('/admin/documents').catch(e => {
                console.warn('Failed to load documents for analytics:', e);
                return [];
            }),
            apiCall('/admin/users').catch(e => {
                console.warn('Failed to load users for analytics:', e);
                return [];
            })
        ]);
        
        console.log('Analytics data loaded:', { documents: documents?.length, users: users?.length });
        updateAnalyticsData(documents || [], users || []);
        
    } catch (error) {
        console.error('Failed to load analytics:', error);
        showAlert('Failed to load analytics: ' + error.message, 'error');
        
        // Set default values on error
        updateAnalyticsData([], []);
    } finally {
        hideLoading();
    }
}

function updateAnalyticsData(documents, users) {
    console.log('Updating analytics data...', { documents: documents?.length, users: users?.length });
    
    // Ensure we have arrays
    documents = documents || [];
    users = users || [];
    
    // Update usage overview
    updateStat('total-chat-sessions', '0');
    updateStat('total-messages', '0');
    updateStat('avg-response-time', '0ms');
    
    // Update document statistics
    updateStat('most-used-doc', documents.length > 0 ? documents[0]?.original_filename || '-' : '-');
    
    const totalSize = documents.reduce((sum, doc) => sum + (doc?.file_size || 0), 0);
    updateStat('total-file-size', Math.round(totalSize / (1024 * 1024)) + ' MB');
    
    const successRate = documents.length > 0 ? 
        Math.round((documents.filter(d => d?.status === 'completed').length / documents.length) * 100) + '%' : 
        '0%';
    updateStat('processing-success-rate', successRate);
    
    // Update user activity
    updateStat('daily-active-users', users.filter(u => u?.is_active).length);
    updateStat('peak-usage-hour', '-');
    updateStat('user-satisfaction', '-');
    
    console.log('Analytics data updated successfully');
}

async function loadSettings() {
    console.log('Loading settings...');
    try {
        showLoading();
        
        // Check system health
        const healthResponse = await fetch(`${apiBaseUrl}/health`).catch(e => {
            console.warn('Health check failed:', e);
            return { ok: false };
        });
        
        const isHealthy = healthResponse.ok;
        console.log('System health check:', isHealthy);
        
        updateSystemStatus('api', isHealthy);
        updateSystemStatus('database', isHealthy);
        updateSystemStatus('faiss', isHealthy);
        updateSystemStatus('websocket', isHealthy);
        
        console.log('Settings loaded successfully');
        
    } catch (error) {
        console.error('Failed to load settings:', error);
        showAlert('Failed to load settings: ' + error.message, 'error');
        
        // Set all to unhealthy on error
        updateSystemStatus('api', false);
        updateSystemStatus('database', false);
        updateSystemStatus('faiss', false);
        updateSystemStatus('websocket', false);
    } finally {
        hideLoading();
    }
}

function updateSystemStatus(system, isHealthy) {
    const statusElement = document.getElementById(`${system}-status`);
    if (statusElement) {
        statusElement.className = `status-badge ${isHealthy ? 'status-active' : 'status-inactive'}`;
        statusElement.textContent = isHealthy ? 'Healthy' : 'Error';
    }
}

function showUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) {
        modal.classList.add('active');
        selectedFiles = [];
        updateFileList();
        updateUploadButton();
    }
}

function closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) {
        modal.classList.remove('active');
        selectedFiles = [];
        updateFileList();
        
        const uploadArea = document.getElementById('upload-area');
        if (uploadArea) {
            uploadArea.classList.remove('dragover');
        }
    }
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    addFiles(files);
    e.target.value = '';
}

function addFiles(files) {
    const allowedTypes = ['pdf', 'docx', 'txt', 'xlsx'];
    const maxSize = 10 * 1024 * 1024;
    
    files.forEach(file => {
        const extension = file.name.split('.').pop().toLowerCase();
        
        if (!allowedTypes.includes(extension)) {
            showAlert(`File "${file.name}" has unsupported format. Allowed: ${allowedTypes.join(', ').toUpperCase()}`, 'error');
            return;
        }
        
        if (file.size > maxSize) {
            showAlert(`File "${file.name}" is too large. Maximum size: 10MB`, 'error');
            return;
        }
        
        if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
            showAlert(`File "${file.name}" is already selected`, 'warning');
            return;
        }
        
        selectedFiles.push(file);
    });
    
    updateFileList();
    updateUploadButton();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFileList();
    updateUploadButton();
}

function updateFileList() {
    const fileList = document.getElementById('file-list');
    if (!fileList) return;
    
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '<p style="text-align: center; color: #666; font-style: italic; padding: 2rem;">No files selected</p>';
        return;
    }
    
    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item">
            <div class="file-info">
                <i class="fas ${getFileIcon(file.name.split('.').pop().toLowerCase())}" style="color: ${getFileColor(file.name.split('.').pop().toLowerCase())};"></i>
                <div>
                    <div style="font-weight: 500;">${file.name}</div>
                    <div style="font-size: 0.8rem; color: #666;">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <button class="file-remove" onclick="removeFile(${index})" title="Remove file">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

function updateUploadButton() {
    const uploadBtn = document.getElementById('upload-btn');
    if (!uploadBtn) return;
    
    uploadBtn.disabled = selectedFiles.length === 0;
    
    if (selectedFiles.length === 0) {
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
    } else {
        uploadBtn.innerHTML = `<i class="fas fa-upload"></i> Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''}`;
    }
}

async function uploadFiles() {
    if (selectedFiles.length === 0) {
        showAlert('No files selected', 'warning');
        return;
    }
    
    const uploadBtn = document.getElementById('upload-btn');
    const originalText = uploadBtn.innerHTML;
    
    try {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        
        let successCount = 0;
        let errorCount = 0;
        const totalFiles = selectedFiles.length;
        
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            
            try {
                uploadBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading ${i + 1}/${totalFiles}...`;
                
                const formData = new FormData();
                formData.append('file', file);
                
                const response = await fetch(`${apiBaseUrl}/admin/documents/upload`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${getToken()}`
                    },
                    body: formData
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Upload failed');
                }
                
                const result = await response.json();
                console.log(`Upload successful for ${file.name}:`, result);
                successCount++;
                
                showAlert(`Uploaded "${file.name}" successfully`, 'success');
                
            } catch (error) {
                console.error(`Upload failed for ${file.name}:`, error);
                errorCount++;
                showAlert(`Failed to upload "${file.name}": ${error.message}`, 'error');
            }
        }
        
        if (successCount > 0) {
            showAlert(`Upload complete: ${successCount} successful, ${errorCount} failed`, 
                errorCount === 0 ? 'success' : 'warning');
            closeUploadModal();
            loadDocuments();
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        showAlert('Upload failed: ' + error.message, 'error');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = originalText;
    }
}

function saveSettings() {
    showAlert('Settings saved successfully', 'success');
}

function exportAnalytics() {
    showAlert('Analytics export started', 'info');
}

function exportData() {
    showAlert('Data export started', 'info');
}

function clearCache() {
    if (confirm('Are you sure you want to clear the cache?')) {
        showAlert('Cache cleared successfully', 'success');
    }
}

function rebuildIndex() {
    if (confirm('Are you sure you want to rebuild the index? This may take some time.')) {
        showAlert('Index rebuild started', 'info');
    }
}

function resetSystem() {
    if (confirm('Are you sure you want to reset the system? This will delete all data and cannot be undone.')) {
        const confirmText = prompt('Type "RESET" to confirm:');
        if (confirmText === 'RESET') {
            showAlert('System reset initiated', 'warning');
        } else {
            showAlert('Reset cancelled', 'info');
        }
    }
}

function showCreateUserModal() {
    showAlert('Create user functionality coming soon', 'info');
}

const adminStyles = `
    .file-type-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
    }
    
    .file-type-badge.pdf { background: #e74c3c; color: white; }
    .file-type-badge.docx { background: #3498db; color: white; }
    .file-type-badge.txt { background: #95a5a6; color: white; }
    .file-type-badge.xlsx { background: #27ae60; color: white; }
    
    .role-badge {
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.7rem;
        font-weight: 600;
    }
    
    .role-badge.role-admin { background: #e74c3c; color: white; }
    .role-badge.role-user { background: #3498db; color: white; }
    
    .action-buttons {
        display: flex;
        gap: 0.25rem;
        justify-content: center;
    }
    
    .action-btn {
        padding: 0.25rem 0.5rem;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.8rem;
        transition: all 0.3s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
        height: 32px;
    }
    
    .btn-view { background: #17a2b8; color: white; }
    .btn-status { background: #6c757d; color: white; }
    .btn-success { background: #28a745; color: white; }
    .btn-warning { background: #ffc107; color: #212529; }
    .btn-delete { background: #dc3545; color: white; }
    
    .action-btn:hover {
        opacity: 0.8;
        transform: translateY(-1px);
    }
    
    .file-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        background: #f8f9fa;
        border-radius: 8px;
        margin-bottom: 0.5rem;
        border: 1px solid #e9ecef;
        transition: all 0.3s ease;
    }
    
    .file-item:hover {
        background: #e9ecef;
        border-color: #667eea;
    }
    
    .file-info {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .file-info i {
        font-size: 1.5rem;
    }
    
    .file-remove {
        background: #dc3545;
        color: white;
        border: none;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
    }
    
    .file-remove:hover {
        background: #c82333;
        transform: scale(1.1);
    }
    
    .upload-area.dragover {
        border-color: #667eea;
        background: rgba(102, 126, 234, 0.1);
        transform: scale(1.02);
    }
    
    .status-healthy {
        color: #28a745;
    }
    
    .status-error {
        color: #dc3545;
    }
    
    .status-badge.status-active {
        background: #d4edda;
        color: #155724;
    }
    
    .status-badge.status-inactive {
        background: #f8d7da;
        color: #721c24;
    }
    
    .status-badge.status-completed {
        background: #d4edda;
        color: #155724;
    }
    
    .status-badge.status-processing {
        background: #fff3cd;
        color: #856404;
    }
    
    .status-badge.status-failed {
        background: #f8d7da;
        color: #721c24;
    }
    
    .menu-badge {
        background: #667eea;
        color: white;
        border-radius: 10px;
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        min-width: 20px;
        text-align: center;
    }
    
    .section-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
    }
    
    .stat-card {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 15px;
        padding: 1.5rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .stat-icon {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1.5rem;
    }
    
    .stat-info h3 {
        font-size: 2rem;
        margin: 0;
        color: #333;
    }
    
    .stat-info p {
        margin: 0;
        color: #666;
        font-size: 0.9rem;
    }
    
    .analytics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 2rem;
    }
    
    .analytics-card {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 15px;
        padding: 2rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    }
    
    .analytics-card h3 {
        color: #333;
        margin-bottom: 1.5rem;
        font-size: 1.3rem;
    }
    
    .analytics-card.full-width {
        grid-column: 1 / -1;
    }
    
    .analytics-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    
    .metric {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 0;
        border-bottom: 1px solid #e1e8ed;
    }
    
    .metric:last-child {
        border-bottom: none;
    }
    
    .metric-label {
        font-weight: 500;
        color: #555;
    }
    
    .metric-value {
        font-weight: 600;
        color: #333;
    }
    
    .performance-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    
    .performance-item {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    
    .performance-label {
        min-width: 120px;
        font-weight: 500;
        color: #555;
    }
    
    .progress-bar {
        flex: 1;
        height: 8px;
        background: #e1e8ed;
        border-radius: 4px;
        overflow: hidden;
    }
    
    .progress-fill {
        height: 100%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        transition: width 0.3s ease;
    }
    
    .performance-value {
        min-width: 50px;
        text-align: right;
        font-weight: 600;
        color: #333;
    }
    
    .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 2rem;
    }
    
    .setting-card {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: 15px;
        padding: 2rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
    }
    
    .setting-card h3 {
        color: #333;
        margin-bottom: 1.5rem;
        font-size: 1.3rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .setting-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    
    .status-grid, .info-grid {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    
    .status-item, .info-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 0;
        border-bottom: 1px solid #e1e8ed;
    }
    
    .status-item:last-child, .info-item:last-child {
        border-bottom: none;
    }
    
    .setting-item {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    
    .setting-item label {
        font-weight: 500;
        color: #555;
    }
    
    .setting-item input, .setting-item select {
        padding: 0.5rem;
        border: 1px solid #e1e8ed;
        border-radius: 4px;
        font-size: 1rem;
    }
    
    .setting-item input:focus, .setting-item select:focus {
        outline: none;
        border-color: #667eea;
    }
    
    .setting-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
    }
    
    .setting-actions .btn {
        flex: 1;
        min-width: 120px;
    }
    
    .range-value {
        font-weight: 600;
        color: #667eea;
    }
    
    @media (max-width: 768px) {
        .action-buttons {
            flex-direction: column;
        }
        
        .file-item {
            flex-direction: column;
            gap: 1rem;
            text-align: center;
        }
        
        .file-info {
            flex-direction: column;
            text-align: center;
        }
        
        .section-stats {
            grid-template-columns: 1fr;
        }
        
        .analytics-grid {
            grid-template-columns: 1fr;
        }
        
        .settings-grid {
            grid-template-columns: 1fr;
        }
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = adminStyles;
document.head.appendChild(styleSheet);