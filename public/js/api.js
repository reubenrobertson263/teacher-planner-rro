// public/js/api.js
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if(!config) config = {};
    if(!config.headers) config.headers = {};
    if(!(config.headers instanceof Headers)) {
        const token = localStorage.getItem('flowdesk_token');
        if(token) config.headers['Authorization'] = token;
    }
    const res = await originalFetch(resource, config);
    if(res.status === 401 && !resource.includes('/auth/')) {
        window.api.logout(); 
    }
    return res;
};

window.api = {
    async processLogin() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        if(!email || !password) return alert("Enter email and password.");
        
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error);
            
            localStorage.setItem('flowdesk_token', data.token);
            document.getElementById('login-overlay').style.display = 'none';
            window.app.bootApp();
        } catch(e) { alert(e.message); }
    },

    async processRegister() {
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        if(!name || !email || !password) return alert("All fields are required.");
        
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error);
            
            localStorage.setItem('flowdesk_token', data.token);
            document.getElementById('login-overlay').style.display = 'none';
            
            if(!localStorage.getItem('onboarding_complete')) {
                document.getElementById('onboarding-modal').style.display = 'flex';
            }
            window.app.bootApp();
        } catch(e) { alert(e.message); }
    },

    logout() {
        localStorage.removeItem('flowdesk_token');
        window.location.reload();
    }
};
