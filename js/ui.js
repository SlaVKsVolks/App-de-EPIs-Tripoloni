
// UI Module - Handles DOM and User Interaction

// CENTRALIZED SCREEN MANAGEMENT - Ensures only ONE screen is visible at a time
const ALL_SCREEN_IDS = [
    'screen-construction',
    'screen-login',
    'screen-register',
    'screen-dashboard',
    'screen-transaction-type',
    'transaction-wizard',
    'screen-entity-list'
];

export function hideAllScreens() {
    ALL_SCREEN_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('d-none');
            el.classList.remove('d-flex', 'd-block');
            el.style.display = 'none';
        }
    });
}

export function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
}

export function showDashboard() {
    hideAllScreens();

    const dash = document.getElementById('screen-dashboard');
    if (dash) {
        dash.classList.remove('d-none');
        dash.classList.add('d-flex');
        dash.style.display = 'flex';
    }

    updateBottomNav('dashboard');
}

export function showScreen(screenId) {
    hideAllScreens();
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.remove('d-none');
        screen.classList.add('d-block');
        screen.style.display = 'block';
    }
}

export function openAppSection(tabName, updateUIForTabCallback) {
    // Hide ALL screens first, then show only the transaction form
    hideAllScreens();

    const transactionView = document.getElementById('transaction-view');
    if (transactionView) {
        transactionView.classList.remove('d-none');
        transactionView.classList.add('d-block');
        transactionView.style.display = 'block';
    }

    // Call the callback to update UI for the specific tab type
    if (updateUIForTabCallback) updateUIForTabCallback(tabName);
}

export function updateConnectionStatus(state) {
    const switchTrack = document.getElementById('status-switch-track');
    const statusIndicator = document.getElementById('status-indicator');

    const iconGood = document.getElementById('icon-wifi-good');
    const iconModerate = document.getElementById('icon-wifi-moderate');
    const iconPoor = document.getElementById('icon-wifi-poor');
    const iconOffline = document.getElementById('icon-wifi-offline');

    [iconGood, iconModerate, iconPoor, iconOffline].forEach(icon => {
        if (icon) {
            icon.style.display = 'none';
            icon.classList.remove('wifi-active');
        }
    });

    if (switchTrack) {
        switchTrack.classList.remove('status-good', 'status-moderate', 'status-poor', 'status-offline');
        if (state !== 'offline') switchTrack.classList.add('online');
        else switchTrack.classList.remove('online');
    }

    switch (state) {
        case 'good':
            if (switchTrack) switchTrack.classList.add('status-good');
            if (statusIndicator) statusIndicator.style.background = '#28a745';
            if (iconGood) {
                iconGood.style.display = 'block';
                iconGood.classList.add('wifi-active');
            }
            break;

        case 'moderate':
            if (switchTrack) switchTrack.classList.add('status-moderate');
            if (statusIndicator) statusIndicator.style.background = '#ffc107';
            if (iconModerate) {
                iconModerate.style.display = 'block';
                iconModerate.classList.add('wifi-active');
            }
            break;

        case 'poor':
            if (switchTrack) switchTrack.classList.add('status-poor');
            if (statusIndicator) statusIndicator.style.background = '#fd7e14';
            if (iconPoor) {
                iconPoor.style.display = 'block';
                iconPoor.classList.add('wifi-active');
            }
            break;

        case 'offline':
        default:
            if (switchTrack) switchTrack.classList.add('status-offline');
            if (statusIndicator) statusIndicator.style.background = '#dc3545';
            if (iconOffline) {
                iconOffline.style.display = 'block';
                iconOffline.classList.add('wifi-active');
            }
            break;
    }
}

// ===== AUTOCOMPLETE SYSTEM =====
// Stores the data for autocomplete
let autocompleteData = {
    employees: [],
    epis: []
};

/**
 * Initialize the autocomplete system with data from the database
 */
export function populateDropdowns(employees, epis, currentEmp, currentEpi) {
    // Store data for filtering
    autocompleteData.employees = employees.map(emp => ({
        id: emp.ID || emp.id,
        name: emp.Nome || emp.NOME || emp.nome || '',
        extra: emp.Função || emp.funcao || emp.Cargo || ''
    })).filter(e => e.id && e.name);

    autocompleteData.epis = epis.map(epi => ({
        id: epi.ID || epi.id,
        name: epi.Descrição || epi.DESCRICAO || epi.descricao || epi.Nome || '',
        extra: epi.CA ? `CA: ${epi.CA}` : ''
    })).filter(e => e.id && e.name);

    // Initialize autocomplete for both fields
    initAutocomplete('colaborador', autocompleteData.employees, '👤');
    initAutocomplete('epi', autocompleteData.epis, '🦺');

    // Restore previous values if any
    if (currentEmp) {
        const emp = autocompleteData.employees.find(e => String(e.id) === String(currentEmp));
        if (emp) {
            const input = document.getElementById('colaborador-input');
            const hiddenInput = document.getElementById('colaborador-id');
            if (input) input.value = emp.name;
            if (hiddenInput) hiddenInput.value = emp.id;
            if (input) input.classList.add('has-value');
        }
    }
    if (currentEpi) {
        const epi = autocompleteData.epis.find(e => String(e.id) === String(currentEpi));
        if (epi) {
            const input = document.getElementById('epi-input');
            const hiddenInput = document.getElementById('epi-id');
            if (input) input.value = epi.name;
            if (hiddenInput) hiddenInput.value = epi.id;
            if (input) input.classList.add('has-value');
        }
    }
}

/**
 * Initialize autocomplete for a specific field
 */
function initAutocomplete(fieldName, data, icon) {
    const input = document.getElementById(`${fieldName}-input`);
    const hiddenInput = document.getElementById(`${fieldName}-id`);
    const dropdown = document.getElementById(`${fieldName}-dropdown`);

    if (!input || !hiddenInput || !dropdown) {
        console.warn(`Autocomplete elements not found for: ${fieldName}`);
        return;
    }

    let highlightedIndex = -1;

    // Input event - filter and show suggestions
    input.addEventListener('input', () => {
        const query = input.value.toLowerCase().trim();

        // Clear hidden value when user types (forces re-selection)
        hiddenInput.value = '';
        input.classList.remove('has-value');
        input.classList.remove('invalid');

        if (query.length === 0) {
            hideDropdown(dropdown);
            return;
        }

        // Filter data
        const filtered = data.filter(item =>
            item.name.toLowerCase().includes(query) ||
            String(item.id).toLowerCase().includes(query)
        );

        renderDropdown(dropdown, filtered, query, icon, (item) => {
            selectItem(input, hiddenInput, dropdown, item);
        });

        highlightedIndex = -1;
    });

    // Focus - show all options if input is empty or show filtered
    input.addEventListener('focus', () => {
        const query = input.value.toLowerCase().trim();
        if (query.length === 0) {
            // Show first 10 options when focused
            const initial = data.slice(0, 10);
            renderDropdown(dropdown, initial, '', icon, (item) => {
                selectItem(input, hiddenInput, dropdown, item);
            }, data.length > 10 ? `Mostrando 10 de ${data.length}...` : null);
        }
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateHighlight(items, highlightedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateHighlight(items, highlightedIndex);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex >= 0 && items[highlightedIndex]) {
                items[highlightedIndex].click();
            }
        } else if (e.key === 'Escape') {
            hideDropdown(dropdown);
            input.blur();
        }
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            hideDropdown(dropdown);

            // Validate - if there's text but no selection, mark as invalid
            if (input.value.trim() && !hiddenInput.value) {
                input.classList.add('invalid');
            }
        }
    });
}

/**
 * Render dropdown with filtered items
 */
function renderDropdown(dropdown, items, query, icon, onSelect, extraMessage = null) {
    dropdown.innerHTML = '';

    if (items.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-no-results">Nenhum resultado encontrado</div>';
        dropdown.classList.add('show');
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.dataset.id = item.id;

        // Highlight matching text
        let displayName = item.name;
        if (query) {
            const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
            displayName = item.name.replace(regex, '<span class="autocomplete-match">$1</span>');
        }

        div.innerHTML = `
            <span class="autocomplete-item-icon">${icon}</span>
            <span class="autocomplete-item-text">${displayName}${item.extra ? `<br><small style="color:#888">${item.extra}</small>` : ''}</span>
            <span class="autocomplete-item-id">#${item.id}</span>
        `;

        div.addEventListener('click', () => {
            onSelect(item);
        });

        dropdown.appendChild(div);
    });

    if (extraMessage) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'autocomplete-no-results';
        msgDiv.textContent = extraMessage;
        dropdown.appendChild(msgDiv);
    }

    dropdown.classList.add('show');
}

/**
 * Select an item from the dropdown
 */
function selectItem(input, hiddenInput, dropdown, item) {
    input.value = item.name;
    hiddenInput.value = item.id;
    input.classList.remove('invalid');
    input.classList.add('has-value');
    hideDropdown(dropdown);
}

/**
 * Hide the dropdown
 */
function hideDropdown(dropdown) {
    dropdown.classList.remove('show');
}

/**
 * Update highlight on keyboard navigation
 */
function updateHighlight(items, index) {
    items.forEach((item, i) => {
        if (i === index) {
            item.classList.add('highlighted');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('highlighted');
        }
    });
}

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Clear autocomplete fields (for use after form submission)
 */
export function clearAutocompleteFields() {
    ['colaborador', 'epi'].forEach(fieldName => {
        const input = document.getElementById(`${fieldName}-input`);
        const hiddenInput = document.getElementById(`${fieldName}-id`);
        if (input) {
            input.value = '';
            input.classList.remove('has-value', 'invalid');
        }
        if (hiddenInput) {
            hiddenInput.value = '';
        }
    });
}

/**
 * Get the selected IDs from autocomplete fields
 */
export function getAutocompleteValues() {
    return {
        colaboradorId: document.getElementById('colaborador-id')?.value || '',
        epiId: document.getElementById('epi-id')?.value || ''
    };
}

/**
 * Validate autocomplete fields - returns true if both have valid selections
 */
export function validateAutocompleteFields() {
    const colabInput = document.getElementById('colaborador-input');
    const colabId = document.getElementById('colaborador-id');
    const epiInput = document.getElementById('epi-input');
    const epiId = document.getElementById('epi-id');

    let valid = true;

    if (!colabId?.value) {
        if (colabInput) colabInput.classList.add('invalid');
        valid = false;
    }

    if (!epiId?.value) {
        if (epiInput) epiInput.classList.add('invalid');
        valid = false;
    }

    return valid;
}

export function renderStock(stock) {
    const list = document.getElementById('stock-list');
    if (!list) return;
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

    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

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
export function resizeSignaturePad() {
    const canvas = document.getElementById('signature-pad');
    if (!canvas) return;

    // Check if visible
    if (canvas.offsetWidth > 0) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
}

export function initSignaturePad() {
    const canvas = document.getElementById('signature-pad');
    if (!canvas) return; // Guard clause
    const ctx = canvas.getContext('2d');
    let writing = false;

    // Initial resize
    resizeSignaturePad();

    window.addEventListener('resize', resizeSignaturePad);

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

export function toggleMenu(show) {
    const sideMenu = document.getElementById('side-menu');
    const backdrop = document.getElementById('menu-backdrop');
    const toggleBtn = document.getElementById('menu-toggle');

    if (show === undefined) {
        // Toggle
        if (sideMenu) sideMenu.classList.toggle('active');
        if (backdrop) backdrop.classList.toggle('active');
        if (toggleBtn) toggleBtn.classList.toggle('active');
    } else if (show) {
        if (sideMenu) sideMenu.classList.add('active');
        if (backdrop) backdrop.classList.add('active');
        if (toggleBtn) toggleBtn.classList.add('active');
    } else {
        if (sideMenu) sideMenu.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
        if (toggleBtn) toggleBtn.classList.remove('active');
    }
}

export function showTransactionSelector() {
    hideAllScreens();
    const selector = document.getElementById('screen-transaction-type');
    if (selector) {
        selector.classList.remove('d-none');
        selector.classList.add('d-block');
        selector.style.display = 'block';
    }
}

export function hideTransactionSelector() {
    hideAllScreens();
    showDashboard();
}

export function hideTransactionForm() {
    const transactionView = document.getElementById('transaction-view');
    if (transactionView) {
        transactionView.classList.add('d-none');
        transactionView.classList.remove('d-block');
        transactionView.style.display = 'none';
    }
}

export function updateBottomNav(activeTabName) {
    // Hide footer if authenticated (generic check, can be refined)
    const footer = document.getElementById('app-footer');
    if (footer) footer.style.display = 'none';

    // Show Bottom Nav
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.classList.remove('d-none');

    // Update Active State
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.nav === activeTabName) btn.classList.add('active');
    });
}

export function renderEntityList(data, type) {
    const listContainer = document.getElementById('list-container');
    const screenLists = document.getElementById('screen-lists');
    const titleEl = document.getElementById('list-title');

    // Hide others
    ['screen-dashboard', 'screen-transaction-type', 'app-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    if (screenLists) screenLists.style.display = 'block';

    if (!listContainer) return;
    listContainer.innerHTML = '';

    let title = 'Lista';
    if (type === 'employees') title = 'Funcionários';
    else if (type === 'epis') title = 'EPIs';
    else if (type === 'users') title = 'Usuários';
    else if (type === 'stock') title = 'Estoque';

    if (titleEl) titleEl.innerText = title;

    if (!data || data.length === 0) {
        listContainer.innerHTML = '<p class="text-center mt-20">Nenhum dado encontrado.</p>';
        return;
    }

    data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'entity-card';

        let html = '';
        if (type === 'stock') {
            // Adapt keys to whatever DB returns. Often capitalized in Sheets.
            // Try flexible matching
            const name = item['ID_EPI'] || item['id_epi'] || item['Id_Epi'] || 'EPI';
            const qty = item['Quantidade'] || item['quantidade'] || item['Estoque Atual'] || 0;
            const obra = item['Obra'] || item['Local'] || 'N/A';

            html = `
                <div class="entity-info">
                    <h4>EPI #${name}</h4>
                    <p>Obra: ${obra}</p>
                </div>
                <div class="badge-stock">${qty} un</div>
             `;
        } else if (type === 'employees') {
            const name = item['Nome'] || item['nome'] || item['Colaborador'] || 'Nome';
            const func = item['Função'] || item['funcao'] || item['Cargo'] || 'Função';
            html = `
                <div class="entity-info">
                    <h4>${name}</h4>
                    <p>${func}</p>
                </div>
             `;
        } else if (type === 'epis') {
            const desc = item['Descrição'] || item['descricao'] || item['Nome'] || 'EPI';
            const ca = item['CA'] || 'N/A';
            html = `
                <div class="entity-info">
                    <h4>${desc}</h4>
                    <p>CA: ${ca}</p>
                </div>
             `;
        } else if (type === 'users') {
            const email = item['Email'] || item['email'] || item['Usuario'] || 'Email';
            const role = item['Cargo'] || item['cargo'] || 'Cargo';
            html = `
                <div class="entity-info">
                    <h4>${email}</h4>
                    <p>${role}</p>
                </div>
             `;
        }

        div.innerHTML = html;
        listContainer.appendChild(div);
    });
}

export function renderRecentMovements(movements) {
    const container = document.getElementById('dashboard-history-list');
    if (!container) return;

    container.innerHTML = '';

    if (!movements || movements.length === 0) {
        container.innerHTML = '<p class="text-secondary text-center">Nenhuma movimentação recente.</p>';
        return;
    }

    movements.forEach(tx => {
        // tx: { Tipo, Colaborador, EPI, Qtd, Data ... }
        // Keys depend on Sheet Headers.
        const type = tx['Tipo'] || tx['tipo'] || 'Movimentação';
        const emp = tx['Colaborador'] || tx['colaborador'] || 'N/A';
        const epi = tx['EPI'] || tx['epi'] || 'N/A';
        const qty = tx['Qtd'] || tx['qtd'] || tx['Quantidade'] || '0';
        const date = tx['Data'] || tx['data'] || '';

        // Format Date (simple)
        let dateStr = date;
        if (date && new Date(date) !== 'Invalid Date') {
            const d = new Date(date);
            dateStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }

        const div = document.createElement('div');
        div.className = 'entity-card';
        div.style.padding = '10px';
        div.style.alignItems = 'flex-start';

        div.innerHTML = `
            <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <strong style="color:var(--primary-color)">${type}</strong>
                    <small class="text-secondary">${dateStr}</small>
                </div>
                <div style="font-size: 0.95rem; color:#333;">${emp}</div>
                <div style="font-size: 0.85rem; color:#666;">${qty}x ${epi}</div>
            </div>
        `;
        container.appendChild(div);
    });
}
