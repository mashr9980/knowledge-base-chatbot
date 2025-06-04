// Authentication functions and event handlers

document.addEventListener('DOMContentLoaded', function() {
    setupAuthEventListeners();
});

function setupAuthEventListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    // Signup form
    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', handleSignup);
    }
    
    // Form validation
    setupFormValidation();
}

function setupFormValidation() {
    const inputs = document.querySelectorAll('.form-group input');
    inputs.forEach(input => {
        input.addEventListener('blur', () => validateField(input));
        input.addEventListener('input', () => clearFieldError(input));
    });
}

function validateField(input) {
    const formGroup = input.closest('.form-group');
    const value = input.value.trim();
    
    // Remove existing error
    clearFieldError(input);
    
    // Email validation
    if (input.type === 'email' && value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            showFieldError(formGroup, 'Please enter a valid email address');
            return false;
        }
    }
    
    // Password validation
    if (input.type === 'password' && value) {
        if (value.length < 2) {
            showFieldError(formGroup, 'Password must be at least 2 characters');
            return false;
        }
    }
    
    // Username validation
    if (input.id === 'signup-username' && value) {
        const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
        if (!usernameRegex.test(value)) {
            showFieldError(formGroup, 'Username must be 3-20 characters (letters, numbers, underscore only)');
            return false;
        }
    }
    
    // Required field validation
    if (input.hasAttribute('required') && !value) {
        showFieldError(formGroup, 'This field is required');
        return false;
    }
    
    // Mark as success if valid
    formGroup.classList.add('success');
    return true;
}

function showFieldError(formGroup, message) {
    formGroup.classList.add('error');
    formGroup.classList.remove('success');
    
    // Remove existing error message
    const existingError = formGroup.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Add new error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    errorDiv.style.cssText = `
        color: #e74c3c;
        font-size: 0.85rem;
        margin-top: 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.25rem;
    `;
    formGroup.appendChild(errorDiv);
}

function clearFieldError(input) {
    const formGroup = input.closest('.form-group');
    formGroup.classList.remove('error', 'success');
    
    const errorMessage = formGroup.querySelector('.error-message');
    if (errorMessage) {
        errorMessage.remove();
    }
}

function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return false;
    
    const inputs = form.querySelectorAll('input[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        if (!validateField(input)) {
            isValid = false;
        }
    });
    
    return isValid;
}

async function handleLogin(e) {
    e.preventDefault();
    
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    
    if (!usernameInput || !passwordInput) {
        showAlert('Login form elements not found', 'error');
        return;
    }
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    // Validate form
    if (!validateForm('login-form')) {
        showAlert('Please correct the errors below', 'error');
        return;
    }
    
    if (!username || !password) {
        showAlert('Please fill in all fields', 'error');
        return;
    }
    
    const loginBtn = e.target.querySelector('.btn-primary');
    const originalText = loginBtn ? loginBtn.innerHTML : '';
    
    try {
        // Show loading state
        if (loginBtn) {
            setButtonLoading(loginBtn, true);
        }
        showLoading();
        
        console.log('Attempting login for user:', username);
        
        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);
        
        const response = await fetch(`${apiBaseUrl}/auth/login`, {
            method: 'POST',
            body: formData
        });
        
        console.log('Login response status:', response.status);
        
        const data = await response.json();
        console.log('Login response data:', data);
        
        if (!response.ok) {
            throw new Error(data.detail || 'Login failed');
        }
        
        // Store token and user data
        setToken(data.access_token);
        window.currentUser = data.user;
        
        console.log('Login successful, user:', window.currentUser);
        showAlert('Login successful! Redirecting...', 'success');
        
        // Clear form
        usernameInput.value = '';
        passwordInput.value = '';
        
        // Redirect based on user role
        setTimeout(() => {
            if (data.user.role === 'admin') {
                window.location.href = '/admin';
            } else {
                showDashboard();
            }
        }, 1500);
        
    } catch (error) {
        console.error('Login error:', error);
        showAlert('Login failed: ' + error.message, 'error');
    } finally {
        if (loginBtn) {
            setButtonLoading(loginBtn, false, originalText);
        }
        hideLoading();
    }
}

async function handleSignup(e) {
    e.preventDefault();
    
    const emailInput = document.getElementById('signup-email');
    const usernameInput = document.getElementById('signup-username');
    const fullNameInput = document.getElementById('signup-fullname');
    const passwordInput = document.getElementById('signup-password');
    
    if (!emailInput || !usernameInput || !fullNameInput || !passwordInput) {
        showAlert('Signup form elements not found', 'error');
        return;
    }
    
    const email = emailInput.value.trim();
    const username = usernameInput.value.trim();
    const fullName = fullNameInput.value.trim();
    const password = passwordInput.value;
    
    // Validate form
    if (!validateForm('signup-form')) {
        showAlert('Please correct the errors below', 'error');
        return;
    }
    
    if (!email || !username || !fullName || !password) {
        showAlert('Please fill in all fields', 'error');
        return;
    }
    
    const signupBtn = e.target.querySelector('.btn-primary');
    const originalText = signupBtn ? signupBtn.innerHTML : '';
    
    try {
        // Show loading state
        if (signupBtn) {
            setButtonLoading(signupBtn, true);
        }
        showLoading();
        
        console.log('Attempting signup for user:', username);
        
        const userData = {
            email: email,
            username: username,
            full_name: fullName,
            password: password
        };
        
        const response = await fetch(`${apiBaseUrl}/auth/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        
        console.log('Signup response status:', response.status);
        
        const data = await response.json();
        console.log('Signup response data:', data);
        
        if (!response.ok) {
            throw new Error(data.detail || 'Signup failed');
        }
        
        // Store token and user data
        setToken(data.access_token);
        window.currentUser = data.user;
        
        console.log('Signup successful, user:', window.currentUser);
        showAlert('Account created successfully! Redirecting...', 'success');
        
        // Clear form
        emailInput.value = '';
        usernameInput.value = '';
        fullNameInput.value = '';
        passwordInput.value = '';
        
        // Redirect to dashboard
        setTimeout(() => {
            showDashboard();
        }, 1500);
        
    } catch (error) {
        console.error('Signup error:', error);
        showAlert('Signup failed: ' + error.message, 'error');
    } finally {
        if (signupBtn) {
            setButtonLoading(signupBtn, false, originalText);
        }
        hideLoading();
    }
}

function setButtonLoading(button, loading, originalText = null) {
    if (!button) return;
    
    if (loading) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        button.style.opacity = '0.7';
    } else {
        button.disabled = false;
        button.style.opacity = '1';
        
        if (originalText) {
            button.innerHTML = originalText;
        } else {
            // Try to restore based on context
            if (button.closest('#login-form')) {
                button.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
            } else if (button.closest('#signup-form')) {
                button.innerHTML = '<i class="fas fa-user-plus"></i> Sign Up';
            } else {
                button.innerHTML = 'Submit';
            }
        }
    }
}