
// UI Module - Handles DOM and User Interaction

export function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

export function showDashboard() {
    document.getElementById('screen-dashboard').style.display = 'flex';
    document.getElementById('app-section').style.display = 'none';
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-construction').style.display = 'none';
    document.getElementById('screen-register').style.display = 'none';
}

export function openAppSection(tabName, updateUIForTabCallback) {
    document.getElementById('screen-dashboard').style.display = 'none';
    document.getElementById('app-section').style.display = 'block';

    // Activate correct tab
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => {
        t.classList.remove('active');
        if (t.dataset.tab === tabName) {
            t.classList.add('active');
        }
    });

    if (updateUIForTabCallback) updateUIForTabCallback(tabName);
}

export function updateConnectionStatus(status) {
    // Status can be boolean (true/false) OR string ('online', 'poor', 'offline')
    // Normalize input
    let state = 'offline';
    if (status === true || status === 'online') state = 'online';
    else if (status === 'poor') state = 'poor';
    else state = 'offline';

    const switchTrack = document.getElementById('status-switch-track');
    const statusIndicator = document.getElementById('status-indicator');
    const iconOnline = document.getElementById('icon-online');
    const iconPoor = document.getElementById('icon-poor');
    const iconOffline = document.getElementById('icon-offline');

    console.log('Connection update:', state);

    // Reset all
    if (iconOnline) { iconOnline.style.display = 'none'; iconOnline.classList.remove('wifi-online-active'); }
    if (iconPoor) { iconPoor.style.display = 'none'; iconPoor.classList.remove('wifi-poor-active'); }
    if (iconOffline) { iconOffline.style.display = 'none'; iconOffline.classList.remove('wifi-offline-active'); }
    if (switchTrack) switchTrack.classList.remove('online'); // Default off

    if (state === 'online') {
        if (switchTrack) {
            switchTrack.classList.add('online');
            switchTrack.classList.remove('poor');
        }
        if (statusIndicator) statusIndicator.style.background = 'rgba(40, 167, 69, 0.8)';
        if (iconOnline) {
            iconOnline.style.display = 'block';
            iconOnline.classList.add('wifi-online-active');
        }
    } else if (state === 'poor') {
        if (switchTrack) {
            switchTrack.classList.add('online'); // Keep toggle position (on)
            switchTrack.classList.add('poor');   // Add yellow color override
        }
        // Background color handled by .poor class with !important

        if (statusIndicator) statusIndicator.style.background = 'rgba(255, 193, 7, 0.8)';

        if (iconPoor) {
            iconPoor.style.display = 'block';
            iconPoor.classList.add('wifi-poor-active');
        }
    } else {
        // Offline
        if (switchTrack) {
            switchTrack.classList.remove('online');
            switchTrack.classList.remove('poor');
        }
        if (statusIndicator) statusIndicator.style.background = 'rgba(220, 53, 69, 0.8)';
        if (iconOffline) {
            iconOffline.style.display = 'block';
            iconOffline.classList.add('wifi-offline-active');
        }
    }
}

export function populateDropdowns(employees, epis, currentEmp, currentEpi) {
    const empSelect = document.getElementById('colaborador');
    const epiSelect = document.getElementById('epi');

    if (!empSelect || !epiSelect) return;

    empSelect.innerHTML = '<option value="">Selecione...</option>';
    employees.forEach(emp => {
        const name = emp.Nome || emp.NOME || emp.nome;
        const id = emp.ID || emp.id;
        if (name) {
            const option = document.createElement('option');
            option.value = id;
            option.innerText = name;
            empSelect.appendChild(option);
        }
    });

    epiSelect.innerHTML = '<option value="">Selecione...</option>';
    epis.forEach(epi => {
        const name = epi.Descrição || epi.DESCRICAO || epi.descricao || epi.Nome;
        const id = epi.ID || epi.id;
        if (name) {
            const option = document.createElement('option');
            option.value = id;
            option.innerText = name;
            epiSelect.appendChild(option);
        }
    });

    // Restore selection if possible
    if (currentEmp) empSelect.value = currentEmp;
    if (currentEpi) epiSelect.value = currentEpi;
}

export function renderStock(stock) {
    const list = document.getElementById('stock-list');
    list.innerHTML = '';

    if (stock.length === 0) {
        list.innerHTML = '<p>Estoque vazio ou não carregado.</p>';
        return;
    }

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = 0;

    stock.forEach(item => {
        const li = document.createElement('li');
        li.style.padding = '10px';
        li.style.borderBottom = '1px solid #eee';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';

        const id = item.ID_EPI || item.id_epi;
        const qty = item.Quantidade || item.quantidade;

        li.innerHTML = `<span>EPI #${id}</span> <strong>${qty} un</strong>`;
        ul.appendChild(li);
    });

    list.appendChild(ul);
}


// --- TOAST NOTIFICATIONS ---
export function showToast(message, type = 'info') {
    // Create container if not exists
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    // Animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// --- SIGNATURE PAD ---
export function initSignaturePad() {
    const canvas = document.getElementById('signature-pad');
    if (!canvas) return; // Guard clause
    const ctx = canvas.getContext('2d');
    let writing = false;

    // Resize canvas to fit container
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    window.addEventListener('resize', () => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    });

    // Mouse Events
    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mouseup', endPosition);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseleave', endPosition);

    // Touch Events
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Prevent scrolling
        startPosition(e.touches[0]);
    });
    canvas.addEventListener('touchend', endPosition);
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e.touches[0]);
    });

    function startPosition(e) {
        writing = true;
        draw(e);
    }

    function endPosition() {
        writing = false;
        ctx.beginPath();
    }

    function draw(e) {
        if (!writing) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX || e.pageX) - rect.left;
        const y = (e.clientY || e.pageY) - rect.top;

        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    }
}

export function isCanvasBlank(canvas) {
    const context = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(
        context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
    );
    return !pixelBuffer.some(color => color !== 0);
}

export function clearSignature() {
    const canvas = document.getElementById('signature-pad');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
