const API_BASE = 'http://localhost:3000/api';

// Global variables
let currentUser = null;
let connectedPages = [];

// Token-based fetch wrapper
async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Not authenticated');

    return fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
}

// Check if user is authenticated
async function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    try {
        const response = await authenticatedFetch(`${API_BASE}/auth/verify`);
        const data = await response.json();

        if (response.ok) {
            currentUser = data.user;
            document.getElementById('userName').textContent = currentUser.name;
        } else {
            logout();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        logout();
    }
}

// Show alerts to user
function showAlert(message, type = 'error') {
    const alertContainer = document.getElementById('alertContainer');
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;

    alertContainer.innerHTML = '';
    alertContainer.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Connect Facebook Page
async function connectFacebook() {
    try {
        window.location.href = `${API_BASE}/facebook/connect`;
    } catch (err) {
        showAlert('Failed to connect to Facebook', 'error');
        console.error(err);
    }
}

// Disconnect Facebook Page
async function disconnectFacebook() {
    try {
        const res = await authenticatedFetch(`${API_BASE}/facebook/disconnect`, {
            method: 'POST'
        });

        if (res.ok) {
            showAlert('Facebook page disconnected successfully', 'success');
            window.location.reload();
        } else {
            const err = await res.text();
            showAlert('Disconnect failed: ' + err);
        }
    } catch (error) {
        console.error('Disconnect error:', error);
        showAlert('Error disconnecting Facebook page');
    }
}

// Optional: Load connected pages (if showing FB page info)
async function loadConnectedPages() {
    try {
        const res = await authenticatedFetch(`${API_BASE}/facebook/pages`);
        if (res.ok) {
            connectedPages = await res.json();
            const pagesContainer = document.getElementById('pagesContainer');
            pagesContainer.innerHTML = connectedPages.map(
                page => `<div>${page.name}</div>`
            ).join('');
        }
    } catch (err) {
        console.error('Error fetching connected pages', err);
    }
}

// Logout
function logout() {
    localStorage.removeItem('token');
    window.location.href = 'login.html';
}

// Call this on page load if needed
// checkAuth();
// loadConnectedPages();