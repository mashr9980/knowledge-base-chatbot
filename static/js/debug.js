// Add this script to your HTML head section for debugging
// <script src="/static/js/debug.js"></script>

console.log('🔧 Sage Debug Script Loaded');

// Debug function to check current state
window.debugSage = function() {
    console.log('=== Sage Debug Information ===');
    console.log('Current URL:', window.location.href);
    console.log('API Base URL:', window.location.origin);
    console.log('Current User:', window.currentUser);
    console.log('Is Authenticated:', localStorage.getItem('Sage_token') ? 'Yes' : 'No');
    
    // Check for JavaScript errors
    console.log('Available sections:');
    document.querySelectorAll('.section').forEach(section => {
        console.log(`- ${section.id}: ${section.classList.contains('active') ? 'ACTIVE' : 'hidden'}`);
    });
    
    // Check for missing elements
    const requiredElements = [
        'user-name', 'total-documents', 'total-sessions', 
        'documents-list', 'nav-menu', 'alert-container'
    ];
    
    console.log('Required elements check:');
    requiredElements.forEach(id => {
        const element = document.getElementById(id);
        console.log(`- ${id}: ${element ? '✓ Found' : '✗ Missing'}`);
    });
    
    console.log('=== End Debug Information ===');
};

// Auto-run debug on page load
window.addEventListener('load', function() {
    setTimeout(() => {
        console.log('🚀 Page fully loaded, running debug...');
        window.debugSage();
    }, 1000);
});

// Check for JavaScript errors
window.addEventListener('error', function(e) {
    console.error('🚨 JavaScript Error Detected:');
    console.error('Message:', e.message);
    console.error('File:', e.filename);
    console.error('Line:', e.lineno);
    console.error('Column:', e.colno);
    console.error('Error object:', e.error);
});

// Monitor API calls
const originalFetch = window.fetch;
window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    console.log('🌐 API Call:', url);
    
    return originalFetch.apply(this, args)
        .then(response => {
            console.log(`✅ API Response ${response.status}:`, url);
            return response;
        })
        .catch(error => {
            console.error(`❌ API Error:`, url, error);
            throw error;
        });
};

// Add debug command to console
console.log('💡 Run debugSage() in console for detailed information');