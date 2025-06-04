let selectedFiles = [];
let currentSection = 'documents';
let currentUser = null;
let apiBaseUrl = window.location.origin;

document.addEventListener('DOMContentLoaded', function() {
    checkAdminAccess();
    setupAdminEventListeners();
    loadInitialData();
});

// Authentication and access control
async function checkAdminAccess() {
    if (!isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }
    
    try {
        const user = await apiCall('/users/me');
        if (!user || user.role !== 'admin') {
            showAlert('Access denied. Admin privileges required.', 'error');
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
            return;
        }
        currentUser = user;
        console.log('Admin user:', currentUser);
    } catch (error) {
        console.error('Admin access check failed:', error);
        window.location.href = 'index.html';
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
    window.location.href = 'index.html';
}

// Utility functions
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
        top: 100px;
        right: 20px;
        z-index: 9998;
    `;
    document.body.appendChild(container);
    return container;
}

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
        <div class="spinner"></div>
        <p>Loading...</p>
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
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function formatDate(dateString) {
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

// Event listeners setup
function setupAdminEventListeners() {
    // File upload drag and drop
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', handleDragOver);
        uploadArea.addEventListener('dragleave', handleDragLeave);
        uploadArea.addEventListener('drop', handleDrop);
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    // Modal events
    const modal = document.getElementById('upload-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeUploadModal();
            }
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Refresh buttons
    setupRefreshButtons();
}

function setupRefreshButtons() {
    // Add refresh buttons to section headers
    const sectionsWithRefresh = ['documents', 'users'];
    
    sectionsWithRefresh.forEach(sectionName => {
        const sectionHeader = document.querySelector(`#${sectionName}-section .section-header`);
        if (sectionHeader) {
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'btn btn-secondary btn-small';
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
            refreshBtn.onclick = () => {
                if (sectionName === 'documents') loadDocuments();
                if (sectionName === 'users') loadUsers();
            };
            
            // Insert before the last button (usually upload/add button)
            const lastBtn = sectionHeader.querySelector('.btn:last-child');
            if (lastBtn) {
                sectionHeader.insertBefore(refreshBtn, lastBtn);
            } else {
                sectionHeader.appendChild(refreshBtn);
            }
        }
    });
}

function handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + U for upload
    if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
        e.preventDefault();
        if (currentSection === 'documents') {
            showUploadModal();
        }
    }
    
    // Escape to close modal
    if (e.key === 'Escape') {
        closeUploadModal();
    }
    
    // Ctrl/Cmd + R for refresh (prevent default and use our refresh)
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        if (currentSection === 'documents') loadDocuments();
        if (currentSection === 'users') loadUsers();
        if (currentSection === 'settings') loadSettings();
    }
}

// Data loading and initialization
async function loadInitialData() {
    await loadDocuments();
    showSection('documents');
}

function showSection(sectionName) {
    // Update menu items
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeMenuItem = document.querySelector(`[onclick="showSection('${sectionName}')"]`);
    if (activeMenuItem) {
        activeMenuItem.classList.add('active');
    }
    
    // Update sections
    document.querySelectorAll('.admin-section').forEach(section => {
        section.classList.remove('active');
    });
    
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    
    currentSection = sectionName;
    
    // Load section-specific data
    switch (sectionName) {
        case 'documents':
            loadDocuments();
            break;
        case 'users':
            loadUsers();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// Document management functions
async function loadDocuments() {
    try {
        showLoading();
        const documents = await apiCall('/admin/documents');
        renderDocumentsTable(documents);
    } catch (error) {
        console.error('Failed to load documents:', error);
        showAlert('Failed to load documents: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderDocumentsTable(documents) {
    const tbody = document.getElementById('documents-tbody');
    if (!tbody) return;
    
    if (documents.length === 0) {
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
    
    tbody.innerHTML = documents.map(doc => `
        <tr data-document-id="${doc.document_id}">
            <td>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i class="fas ${getFileIcon(doc.file_type)}" style="font-size: 1.5rem; color: ${getFileColor(doc.file_type)};"></i>
                    <div>
                        <div style="font-weight: 500; margin-bottom: 0.25rem;">${doc.original_filename}</div>
                        <div style="font-size: 0.75rem; color: #666; font-family: monospace;">${doc.document_id}</div>
                    </div>
                </div>
            </td>
            <td><span class="file-type-badge ${doc.file_type}">${doc.file_type.toUpperCase()}</span></td>
            <td>${formatFileSize(doc.file_size)}</td>
            <td><span class="status-badge status-${doc.status}">${formatStatus(doc.status)}</span></td>
            <td>
                <span style="font-weight: 500;">${doc.chunks_count || 0}</span>
                ${doc.chunks_count > 0 ? '<i class="fas fa-check-circle" style="color: #28a745; margin-left: 0.5rem;" title="Ready for chat"></i>' : ''}
            </td>
            <td>${formatDate(doc.created_at)}</td>
            <td>
                <div class="action-buttons">
                    <button class="action-btn btn-view" onclick="viewDocument('${doc.document_id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="action-btn btn-status" onclick="checkDocumentStatus('${doc.document_id}')" title="Check Status">
                        <i class="fas fa-info-circle"></i>
                    </button>
                    <button class="action-btn btn-delete" onclick="deleteDocument('${doc.document_id}', '${doc.original_filename}')" title="Delete Document">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
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
            
            // Update the row with new status
            statusCell.className = `status-badge status-${status.status}`;
            statusCell.innerHTML = formatStatus(status.status);
            
            // Update chunks count
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
        loadDocuments(); // Refresh list
    } catch (error) {
        showAlert('Failed to delete document: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// User management functions
async function loadUsers() {
    try {
        showLoading();
        const users = await apiCall('/admin/users');
        renderUsersTable(users);
    } catch (error) {
        console.error('Failed to load users:', error);
        showAlert('Failed to load users: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
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
        loadUsers(); // Refresh list
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
    
    // Double confirmation for destructive action
    const confirmText = prompt(`To confirm deletion, please type the username "${username}" below:`);
    if (confirmText !== username) {
        showAlert('Username confirmation failed. Deletion cancelled.', 'warning');
        return;
    }
    
    try {
        showLoading();
        await apiCall(`/admin/users/${userId}`, { method: 'DELETE' });
        showAlert(`User "${username}" deleted successfully`, 'success');
        loadUsers(); // Refresh list
    } catch (error) {
        showAlert('Failed to delete user: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Settings management
async function loadSettings() {
    try {
        // Check system health
        const healthResponse = await fetch(`${apiBaseUrl}/health`);
        const healthData = await healthResponse.json();
        
        // Update status indicators
        updateSystemStatus('api', healthResponse.ok);
        updateSystemStatus('database', healthResponse.ok);
        
        // Check FAISS status
        try {
            const documentsResponse = await apiCall('/admin/documents');
            updateSystemStatus('faiss', true);
        } catch (error) {
            updateSystemStatus('faiss', false);
        }
        
        // Load additional settings
        await loadSystemStats();
        
    } catch (error) {
        console.error('Failed to load settings:', error);
        updateSystemStatus('api', false);
        updateSystemStatus('database', false);
        updateSystemStatus('faiss', false);
    }
}

async function loadSystemStats() {
    try {
        const [documents, users] = await Promise.all([
            apiCall('/admin/documents'),
            apiCall('/admin/users')
        ]);
        
        // Update statistics
        updateStat('total-documents', documents.length);
        updateStat('processed-documents', documents.filter(d => d.status === 'completed').length);
        updateStat('total-users', users.length);
        updateStat('active-users', users.filter(u => u.is_active).length);
        
    } catch (error) {
        console.error('Failed to load system stats:', error);
    }
}

function updateSystemStatus(system, isHealthy) {
    const statusElement = document.getElementById(`${system}-status`);
    if (statusElement) {
        statusElement.className = `status-badge ${isHealthy ? 'status-active' : 'status-inactive'}`;
        statusElement.textContent = isHealthy ? 'Healthy' : 'Error';
    }
}

function updateStat(statId, value) {
    const statElement = document.getElementById(statId);
    if (statElement) {
        statElement.textContent = value;
    }
}

// File upload functionality
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
        
        // Reset upload area
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
    e.target.value = ''; // Reset input
}

function addFiles(files) {
    const allowedTypes = ['pdf', 'docx', 'txt', 'xlsx'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    files.forEach(file => {
        const extension = file.name.split('.').pop().toLowerCase();
        
        // Validate file type
        if (!allowedTypes.includes(extension)) {
            showAlert(`File "${file.name}" has unsupported format. Allowed: ${allowedTypes.join(', ').toUpperCase()}`, 'error');
            return;
        }
        
        // Validate file size
        if (file.size > maxSize) {
            showAlert(`File "${file.name}" is too large. Maximum size: 10MB`, 'error');
            return;
        }
        
        // Check if file already selected
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
        
        // Upload files one by one with progress
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
                
                // Update progress
                showAlert(`Uploaded "${file.name}" successfully`, 'success');
                
            } catch (error) {
                console.error(`Upload failed for ${file.name}:`, error);
                errorCount++;
                showAlert(`Failed to upload "${file.name}": ${error.message}`, 'error');
            }
        }
        
        // Show final summary
        if (successCount > 0) {
            showAlert(`Upload complete: ${successCount} successful, ${errorCount} failed`, 
                errorCount === 0 ? 'success' : 'warning');
            closeUploadModal();
            loadDocuments(); // Refresh documents list
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        showAlert('Upload failed: ' + error.message, 'error');
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = originalText;
    }
}

// Add custom styles for admin interface
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
    }
`;

// Inject additional styles
const styleSheet = document.createElement('style');
styleSheet.textContent = adminStyles;
document.head.appendChild(styleSheet);

// Auto-refresh functionality
let autoRefreshInterval = null;

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Refresh every 30 seconds
    autoRefreshInterval = setInterval(() => {
        if (currentSection === 'documents') {
            loadDocuments();
        } else if (currentSection === 'users') {
            loadUsers();
        } else if (currentSection === 'settings') {
            loadSettings();
        }
    }, 30000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}