// ================= DATABASE STATE MANAGEMENT =================
let state = {
  clientes: [],
  fornecedores: [],
  modelos: [],
  ordens: []
};

// Global variables for quick-add modals tracking
let activeModelSelectElement = null;

// ─── Global Toast Notification ───
function showToast(message, type = 'success') {
  const existing = document.getElementById('agy-toast');
  if (existing) existing.remove();

  const colors = {
    success: { bg: 'var(--color-success)',  icon: '✓' },
    error:   { bg: 'var(--color-danger)',    icon: '✕' },
    info:    { bg: 'var(--color-info)',      icon: 'ℹ' },
    warning: { bg: 'var(--color-warning)',   icon: '!' }
  };
  const c = colors[type] || colors.success;

  const toast = document.createElement('div');
  toast.id = 'agy-toast';
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    display: flex; align-items: center; gap: 10px;
    background: var(--bg-card); border: 1px solid ${c.bg};
    border-left: 4px solid ${c.bg};
    color: var(--text-primary); padding: 12px 18px;
    border-radius: 10px; box-shadow: var(--shadow-lg);
    font-size: 0.875rem; font-weight: 500;
    animation: toastIn 0.25s ease;
    max-width: 320px;
  `;
  toast.innerHTML = `
    <span style="color:${c.bg}; font-weight:700; font-size:1rem;">${c.icon}</span>
    <span>${message}</span>
  `;

  if (!document.getElementById('toast-style')) {
    const s = document.createElement('style');
    s.id = 'toast-style';
    s.textContent = `
      @keyframes toastIn  { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform:translateY(0); } }
      @keyframes toastOut { from { opacity:1; transform:translateY(0);     } to { opacity:0; transform:translateY(12px); } }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}


document.addEventListener('DOMContentLoaded', () => {
  initDatabase().then(() => {
    setupEventListeners();
    switchTab('dashboard');
    lucide.createIcons();
    // Render alerts on initial load
    if (typeof renderAlertBadge === 'function') renderAlertBadge();
  });
});

// Load Database from LocalStorage or Initial JSON
async function initDatabase() {
  const localData = localStorage.getItem('aeroprint_db');
  if (localData) {
    try {
      state = JSON.parse(localData);
      migrateDatabase();
      return;
    } catch (e) {
      console.error("Erro ao carregar dados do LocalStorage, reiniciando...", e);
    }
  }

  // Load from db_initial.json if no LocalStorage exists
  try {
    const response = await fetch('db_initial.json');
    if (response.ok) {
      state = await response.json();
      migrateDatabase();
    } else {
      throw new Error("Erro de requisição do JSON inicial.");
    }
  } catch (error) {
    console.warn("Não foi possível carregar db_initial.json, iniciando vazio.", error);
    state = { clientes: [], fornecedores: [], modelos: [], ordens: [] };
    migrateDatabase();
  }
}

// Retroactive database migration for payment fields and new cost parameters
function migrateDatabase() {
  let needsSave = false;
  if (!state) state = {};
  if (!state.clientes) {
    state.clientes = [];
    needsSave = true;
  }
  if (!state.fornecedores) {
    state.fornecedores = [];
    needsSave = true;
  }
  if (!state.modelos) {
    state.modelos = [];
    needsSave = true;
  }
  if (!state.ordens) {
    state.ordens = [];
    needsSave = true;
  }
  if (!state.depositos) {
    state.depositos = [];
    needsSave = true;
  }
  if (!state.alertSettings) {
    state.alertSettings = {
      prazo_proximo: { enabled: true, diasAntecedencia: 3 },
      parado: { enabled: true, diasSemMovimento: 7 },
      pagamento_pendente: { enabled: true, diasAposOS: 3 },
      valor_alto_pendente: { enabled: false, valorMinimo: 500 }
    };
    needsSave = true;
  }
  if (!state.alertSnoozes) {
    state.alertSnoozes = {};
    needsSave = true;
  }

  state.modelos.forEach(m => {
    if (m && m.custoProducao === undefined) {
      m.custoProducao = m.id === 'mod_frete' ? 0 : 35.00;
      needsSave = true;
    }
    if (m && m.precoBase === undefined) {
      m.precoBase = m.id === 'mod_frete' ? 0 : 130.00; // default base price for existing models
      needsSave = true;
    }
  });

  state.ordens.forEach(os => {
    if (!os) return;
    // New fields on OS level
    if (os.origem === undefined) {
      os.origem = 'WhatsApp';
      needsSave = true;
    }
    if (os.subcliente === undefined) {
      os.subcliente = '';
      needsSave = true;
    }
    if (!os.itens) {
      os.itens = [];
      needsSave = true;
    }

    // New fields on Item level
    os.itens.forEach(item => {
      if (!item) return;
      if (item.dividirCusto === undefined) {
        item.dividirCusto = false;
        needsSave = true;
      }
      if (item.custoProducao === undefined) {
        // Default to a 30% of standard unit price (to maintain realistic profitability reporting)
        item.custoProducao = parseFloat(((item.valorUnitario || 0) * 0.3).toFixed(2));
        needsSave = true;
      }
      if (item.valorArquivoItem === undefined) {
        const model = state.modelos.find(m => m.id === item.modeloId);
        item.valorArquivoItem = model ? (model.valorArquivo || 0) : 0;
        needsSave = true;
      }
    });

    // calculate subtotal model and files (taking divider into account)
    let subtotalModelos = 0;
    let subtotalArquivos = 0;
    os.itens.forEach(item => {
      if (!item) return;
      subtotalModelos += ((item.quantidade || 0) * (item.valorUnitario || 0));
      if (item.arquivoNovo) {
        let arqCost = item.valorArquivoItem || 0;
        if (item.dividirCusto) {
          arqCost = arqCost / 2;
        }
        subtotalArquivos += arqCost;
      }
    });

    if (os.pagoServico === undefined) {
      os.pagoServico = os.estadoPagamento === 'Pago' ? subtotalModelos : 0;
      needsSave = true;
    }
    if (os.pagoArquivo === undefined) {
      os.pagoArquivo = os.estadoPagamento === 'Pago' ? subtotalArquivos : 0;
      needsSave = true;
    }
    if (os.pagoTerceiros === undefined) {
      os.pagoTerceiros = os.estadoPagamento === 'Pago' ? (os.valorTerceiros || 0) : 0;
      needsSave = true;
    }
  });

  // Retroactive patch for Erasmo Ferreira's credit balance (deposit date 08/06/2026)
  if (state.clientes && state.depositos) {
    const erasmo = state.clientes.find(c => c.nome && c.nome.includes('Erasmo'));
    if (erasmo) {
      const badDep = state.depositos.find(d =>
        d.pagadorId === erasmo.id &&
        d.valor === 8480 &&
        d.isCreditUse &&
        d.data === '2026-06-08'
      );
      if (badDep) {
        let totalAllocated = 0;
        badDep.alocacoes.forEach(al => {
          totalAllocated += al.valorAlocado;
        });
        const excess = badDep.valor - totalAllocated;
        if (excess > 0 && badDep.drawnFrom && badDep.drawnFrom.length > 0) {
          let remainingToRestore = excess;
          for (let i = badDep.drawnFrom.length - 1; i >= 0; i--) {
            if (remainingToRestore <= 0) break;
            const draw = badDep.drawnFrom[i];
            const sourceDep = state.depositos.find(d => d.id === draw.depositId);
            if (sourceDep) {
              const restore = Math.min(remainingToRestore, draw.amount);
              sourceDep.saldoDisponivel = (sourceDep.saldoDisponivel || 0) + restore;
              draw.amount -= restore;
              remainingToRestore -= restore;
            }
          }
          badDep.drawnFrom = badDep.drawnFrom.filter(d => d.amount > 0);
        }
        badDep.valor = totalAllocated;
        needsSave = true;
      }
    }
  }

  // Global financial recalculation migration (v1.1.8)
  if (state.ordens && state.ordens.length > 0) {
    state.ordens.forEach(os => {
      if (!os) return;

      let subtotalModelos = 0;
      let subtotalArquivos = 0;

      os.itens.forEach(item => {
        if (!item) return;
        subtotalModelos += (item.quantidade * item.valorUnitario);
        if (item.arquivoNovo && item.dividirCusto) {
          subtotalArquivos += (item.valorArquivoItem / 2);
        }
      });

      const newTotal = subtotalModelos + subtotalArquivos;

      if (os.valorTotal !== newTotal || os.pagoTerceiros !== 0) {
        os.valorTotal = newTotal;
        os.pagoTerceiros = 0;
        os.pagoServico = Math.min(os.pagoServico || 0, subtotalModelos);
        os.pagoArquivo = Math.min(os.pagoArquivo || 0, subtotalArquivos);

        // Recalculate status
        const paid = (os.pagoServico || 0) + (os.pagoArquivo || 0);
        if (paid <= 0.01) {
          os.estadoPagamento = 'Pendente';
        } else if (paid >= newTotal - 0.01) {
          os.estadoPagamento = 'Pago';
        } else {
          os.estadoPagamento = 'Pago Parcial';
        }

        needsSave = true;
      }
    });
  }

  // --- Variante Grouping Migration ---
  // Migrate flat models to the new variants structure and group them by base name
  const flatModels = state.modelos.filter(m => !m.variantes);
  if (flatModels.length > 0) {
    const newModelos = [];
    const map = new Map(); // baseName -> parentModel object
    const modelIdMapping = {}; // oldId -> { parentId, variantId }

    state.modelos.forEach(m => {
      let baseName = m.nome.trim();
      if (m.escala && baseName.endsWith(m.escala)) {
        baseName = baseName.substring(0, baseName.length - m.escala.length).trim();
      }
      baseName = baseName.replace(/[-\s]+$/, ''); // clean up trailing dashes/spaces

      let parent = map.get(baseName);
      if (!parent) {
        parent = {
          id: m.id, // keep the ID of the first one to preserve old OS links
          nome: baseName,
          valorArquivo: m.valorArquivo || 0,
          variantes: []
        };
        map.set(baseName, parent);
        newModelos.push(parent);
      }

      // Determine if m was already migrated (has variantes) or is flat
      if (m.variantes && m.variantes.length > 0) {
        // already has variants, copy them
        m.variantes.forEach(v => parent.variantes.push(v));
        modelIdMapping[m.id] = { parentId: parent.id, variantId: m.variantes[0].id };
      } else {
        // convert flat to variant
        const newVariant = {
          id: 'var_' + m.id, // derive variant ID from old model ID
          escala: m.escala || '',
          comprimento: m.comprimento || 0,
          envergadura: m.envergadura || 0,
          materialPadrao: m.materialPadrao || '',
          acabamentoPadrao: m.acabamentoPadrao || '',
          precoBase: m.precoBase || 0,
          custoProducao: m.custoProducao || 0
        };
        parent.variantes.push(newVariant);
        modelIdMapping[m.id] = { parentId: parent.id, variantId: newVariant.id };
      }
    });

    // Apply the grouped models
    state.modelos = newModelos;

    // Update ALL OS records to point to the new parentId and variantId
    state.ordens.forEach(os => {
      if (os.itens) {
        os.itens.forEach(item => {
          if (item.modeloId && modelIdMapping[item.modeloId]) {
            const mapping = modelIdMapping[item.modeloId];
            item.modeloId = mapping.parentId;
            if (!item.varianteId) {
              item.varianteId = mapping.variantId;
            }
          }
        });
      }
    });
    needsSave = true;
  }

  if (needsSave) {
    saveToLocalStorage();
  }
}

function saveToLocalStorage() {
  localStorage.setItem('aeroprint_db', JSON.stringify(state));
  triggerLocalAutoBackup();
  if (typeof renderAlertBadge === 'function') renderAlertBadge();
}

// Sends the current state in JSON format to the local backend server for filesystem backup
async function triggerLocalAutoBackup() {
  try {
    const response = await fetch('/api/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(state)
    });
    if (!response.ok) {
      console.warn("Falha ao sincronizar backup automático local:", response.statusText);
    }
  } catch (err) {
    console.warn("Erro ao enviar backup automático local (servidor offline?):", err);
  }
}

// ================= SPA ROUTING & VIEW CONTROLLER =================
function switchTab(tabId) {
  // Update nav buttons active state
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-target') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update visible content views
  document.querySelectorAll('.content-view').forEach(view => {
    if (view.id === `view-${tabId}`) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  // Update header text based on page
  const titleEl = document.getElementById('current-page-title');
  const subtitleEl = document.getElementById('current-page-subtitle');

  // Hide OS Form if leaving the OS tab
  if (tabId !== 'ordens') {
    document.getElementById('os-form-card').classList.add('hidden');
  }

  switch (tabId) {
    case 'dashboard':
      titleEl.innerText = "Dashboard";
      subtitleEl.innerText = "Visão geral do seu negócio de impressão 3D";
      renderDashboard();
      break;
    case 'producao':
      titleEl.innerText = "Controle de Produção";
      subtitleEl.innerText = "Acompanhe e atualize o status de fabricação e pagamentos em tempo real";
      renderProducao();
      break;
    case 'ordens':
      titleEl.innerText = "Ordens de Serviço";
      subtitleEl.innerText = "Gerencie pedidos, status de fabricação e pagamentos";
      renderOSList();
      break;
    case 'clientes':
      titleEl.innerText = "Cadastro de Clientes";
      subtitleEl.innerText = "Gerencie os contatos dos seus compradores";
      renderClientes();
      break;
    case 'modelos':
      titleEl.innerText = "Modelos 3D (Produtos)";
      subtitleEl.innerText = "Dimensões das maquetes de aeronaves e preços de arquivos";
      renderModelos();
      break;
    case 'fornecedores':
      titleEl.innerText = "Fornecedores";
      subtitleEl.innerText = "Gerencie terceiros parceiros de acabamento/pintura";
      renderFornecedores();
      break;
    case 'configuracoes':
      titleEl.innerText = "Configurações & Backup";
      subtitleEl.innerText = "Importe, exporte ou limpe os dados do seu sistema";
      setupConfigPage();
      break;
    case 'pagamentos':
      titleEl.innerText = "Finanças & Pagamentos";
      subtitleEl.innerText = "Lance depósitos de clientes, gerencie saldos devedores e extratos de crédito";
      renderPagamentos();
      break;
    case 'relatorios':
      titleEl.innerText = "Relatórios & Lucros";
      subtitleEl.innerText = "Acompanhe faturamento, custos de produção e demonstrativos detalhados por cliente";
      renderRelatorios();
      break;
  }
  lucide.createIcons();
}

// ================= EVENT LISTENERS SETUP =================
function setupEventListeners() {
  // ─── Mobile Menu Toggle ───
  const btnMobileMenu = document.getElementById('btn-mobile-menu');
  const sidebar       = document.querySelector('.sidebar');
  const overlay       = document.getElementById('sidebar-overlay');

  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (btnMobileMenu) btnMobileMenu.addEventListener('click', openMobileSidebar);
  if (overlay)       overlay.addEventListener('click', closeMobileSidebar);

  // Nav clicks
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = btn.getAttribute('data-target');
      switchTab(target);
      closeMobileSidebar(); // auto-close drawer on mobile
    });
  });

  // Quick OS Button from Header
  document.getElementById('quick-os-btn').addEventListener('click', () => {
    switchTab('ordens');
    openOSForm();
  });

  // OS Filters
  document.getElementById('os-search').addEventListener('input', renderOSList);
  document.getElementById('os-filter-pagamento').addEventListener('change', renderOSList);
  document.getElementById('os-filter-producao').addEventListener('change', renderOSList);

  // Production Filters
  document.getElementById('producao-search').addEventListener('input', renderProducao);
  document.getElementById('producao-filter-ativas').addEventListener('change', renderProducao);

  // Clientes Search
  document.getElementById('client-search').addEventListener('input', renderClientes);

  // Modelos Search
  document.getElementById('model-search').addEventListener('input', renderModelos);

  // Fornecedores Search
  document.getElementById('supplier-search').addEventListener('input', renderFornecedores);

  // Payments Search
  document.getElementById('pagamento-search').addEventListener('input', renderPagamentos);

  // New Deposit button
  document.getElementById('new-deposit-btn').addEventListener('click', () => openDepositModal());

  // Deposit form changes
  document.getElementById('dep-pagador').addEventListener('change', onDepositPagadorChange);

  document.getElementById('dep-valor').addEventListener('input', () => {
    const useCreditChk = document.getElementById('dep-use-credit-chk');
    if (useCreditChk && useCreditChk.checked) {
      const pagadorId = document.getElementById('dep-pagador').value;
      const credits = getClientCredits();
      const clientCredit = credits[pagadorId] || 0;
      let val = parseFloat(document.getElementById('dep-valor').value) || 0;
      if (val > clientCredit) {
        document.getElementById('dep-valor').value = clientCredit.toFixed(2);
      }
    }
    updateDepositCalculations();
  });

  document.getElementById('dep-use-credit-chk').addEventListener('change', onUseCreditCheckboxChange);
  document.getElementById('form-deposit').addEventListener('submit', saveDeposit);

  // OS Form Actions
  document.getElementById('new-os-btn').addEventListener('click', () => openOSForm());
  document.getElementById('close-os-form-btn').addEventListener('click', closeOSForm);
  document.getElementById('cancel-os-btn').addEventListener('click', closeOSForm);
  document.getElementById('add-item-btn').addEventListener('click', () => addOSItemRow());
  document.getElementById('os-form').addEventListener('submit', saveOS);

  // OS Form Recalculate Hooks (Third Party Values)
  document.getElementById('os-valor-terceiros').addEventListener('input', calculateOSTotals);

  // OS Form Recalculate Hooks (Frete)
  document.getElementById('os-valor-frete').addEventListener('input', calculateOSTotals);
  document.getElementById('os-responsavel-frete').addEventListener('change', calculateOSTotals);

  // Quick Add Buttons within OS Form
  document.getElementById('quick-add-client-btn').addEventListener('click', () => openModal('client'));
  document.getElementById('quick-add-supplier-btn').addEventListener('click', () => openModal('supplier'));

  // Alerts UI Events
  const alertBellBtn = document.getElementById('btn-alert-bell');
  const alertPanel = document.getElementById('alerts-panel');
  if (alertBellBtn) {
    alertBellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = alertPanel.style.display !== 'none';
      if (isVisible) {
        alertPanel.style.display = 'none';
      } else {
        renderAlertsPanel();
        alertPanel.style.display = 'flex';
      }
    });
  }
  document.getElementById('btn-close-alerts')?.addEventListener('click', () => {
    alertPanel.style.display = 'none';
  });
  document.getElementById('btn-go-alert-settings')?.addEventListener('click', () => {
    alertPanel.style.display = 'none';
    switchTab('configuracoes');
    document.getElementById('card-alert-settings').scrollIntoView({ behavior: 'smooth' });
  });

  // Close alerts panel when clicking outside
  document.addEventListener('click', (e) => {
    if (alertPanel && alertPanel.style.display !== 'none' && !e.target.closest('#alert-bell-wrapper')) {
      alertPanel.style.display = 'none';
    }
  });

  // Quick entity creation buttons (from their respective lists)
  document.getElementById('new-client-btn').addEventListener('click', () => openModal('client'));
  document.getElementById('new-model-btn').addEventListener('click', () => openModal('model'));
  document.getElementById('new-supplier-btn').addEventListener('click', () => openModal('supplier'));

  // Close Modals events
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const modal = btn.closest('.modal-overlay');
      if (modal) {
        modal.classList.remove('active');
      }
      activeModelSelectElement = null;
      document.body.classList.remove('print-only-client', 'print-only-profit', 'print-only-os');
    });
  });

  // Close modals when clicking outside (on the overlay) — only for view modals (not data-no-backdrop)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && overlay.dataset.noBackdrop !== 'true') {
        overlay.classList.remove('active');
        activeModelSelectElement = null;
        document.body.classList.remove('print-only-client', 'print-only-profit', 'print-only-os');
      }
    });
  });

  // Modal forms submissions
  document.getElementById('form-quick-client').addEventListener('submit', saveQuickClient);
  document.getElementById('form-quick-supplier').addEventListener('submit', saveQuickSupplier);
  document.getElementById('form-quick-model').addEventListener('submit', saveQuickModel);

  // Config panel buttons
  document.getElementById('export-backup-btn').addEventListener('click', exportBackup);
  document.getElementById('reset-db-btn').addEventListener('click', resetDatabase);

  const fileInput = document.getElementById('import-backup-file');
  const importBtn = document.getElementById('import-backup-btn');
  const fileNameSpan = document.getElementById('import-file-name');

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      fileNameSpan.innerText = fileInput.files[0].name;
      importBtn.disabled = false;
    } else {
      fileNameSpan.innerText = "Nenhum arquivo selecionado";
      importBtn.disabled = true;
    }
  });

  importBtn.addEventListener('click', importBackup);

  // Print button
  document.getElementById('print-os-btn').addEventListener('click', () => {
    document.body.classList.add('print-only-os');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('print-only-client', 'print-only-profit', 'print-only-os');
    }, 1000);
  });

  // Relatórios Listeners
  document.getElementById('btn-generate-client-report').addEventListener('click', generateClientReport);

  document.getElementById('btn-export-client-csv-report').addEventListener('click', () => {
    const table = document.querySelector('#client-report-print-content table.excel-report-table');
    if (!table) {
      alert("Gere o relatório em formato 'Planilha' para exportar.");
      return;
    }
    
    let csvContent = "";
    
    // Add Report Header
    const clientName = document.querySelector('#client-report-print-content strong')?.innerText || 'Cliente';
    csvContent += `"Relatório de Pedidos - Planilha";\n`;
    csvContent += `"Cliente Principal:";"${clientName}"\n\n`;

    // Process Table with Rowspan/Colspan support
    const rows = Array.from(table.querySelectorAll('tr'));
    const grid = [];
    
    rows.forEach((row, rowIndex) => {
      // Ignore spacer rows completely to keep CSV clean
      if (row.classList.contains('excel-spacer-row')) return;
      
      if (!grid[rowIndex]) grid[rowIndex] = [];
      
      const cols = row.querySelectorAll('th, td');
      let colIndex = 0;
      
      cols.forEach(col => {
        // Find the first empty slot in the current row grid
        while (grid[rowIndex][colIndex] !== undefined) {
          colIndex++;
        }
        
        let text = col.innerText.trim();
        
        // Remove "R$ " prefix so Excel recognizes it as a number
        text = text.replace(/R\$\s*/g, '');
        // Remove the "(Div. 50%)" text from the file cost column so it stays a pure number
        text = text.replace(/\s*\(Div\. 50\%\)/g, '');
        
        text = text.replace(/"/g, '""');
        // Handle newlines in text by keeping them inside quotes
        
        const rowspan = parseInt(col.getAttribute('rowspan') || '1', 10);
        const colspan = parseInt(col.getAttribute('colspan') || '1', 10);
        
        // Fill the grid cells covered by this th/td
        for (let r = 0; r < rowspan; r++) {
          for (let c = 0; c < colspan; c++) {
            if (!grid[rowIndex + r]) grid[rowIndex + r] = [];
            // Duplicate the value for all spanned cells (great for Excel filtering)
            grid[rowIndex + r][colIndex + c] = `"${text}"`;
          }
        }
        colIndex += colspan;
      });
    });
    
    // Convert grid to CSV string, filtering out empty rows
    grid.forEach(row => {
      if (row && row.length > 0) {
        csvContent += row.join(";") + "\n";
      }
    });
    
    // Add Totals
    const totalDivs = document.querySelectorAll('#client-report-print-content > div:last-child > div');
    if (totalDivs.length > 0) {
      csvContent += `\n"RESUMO FINAL"\n`;
      totalDivs.forEach(div => {
        const title = div.querySelector('span')?.innerText || '';
        let val = div.querySelector('h3')?.innerText || '';
        val = val.replace(/R\$\s*/g, '');
        csvContent += `"${title}";"${val}"\n`;
      });
    }

    // Export using BOM for UTF-8 Excel compatibility
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `Relatorio_Planilha_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  document.getElementById('btn-print-client-report').addEventListener('click', () => {
    document.body.classList.add('print-only-client');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('print-only-client', 'print-only-profit', 'print-only-os');
    }, 1000);
  });

  document.getElementById('btn-print-profit-report').addEventListener('click', () => {
    document.body.classList.add('print-only-profit');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('print-only-client', 'print-only-profit', 'print-only-os');
    }, 1000);
  });

  document.getElementById('rep-profit-search').addEventListener('input', renderProfitReport);
  document.getElementById('profit-date-start').addEventListener('change', renderProfitReport);
  document.getElementById('profit-date-end').addEventListener('change', renderProfitReport);
  document.getElementById('btn-clear-profit-dates').addEventListener('click', () => {
    document.getElementById('profit-date-start').value = '';
    document.getElementById('profit-date-end').value = '';
    renderProfitReport();
  });

  // OpenAI settings: auto-save on blur
  const openAiKeyInput = document.getElementById('settings-openai-key');
  if (openAiKeyInput) {
    openAiKeyInput.addEventListener('blur', () => {
      const key = openAiKeyInput.value.trim();
      if (key) {
        localStorage.setItem('aeroprint_openai_key', key);
        showToast('Chave de API salva!');
      }
    });
  }

  const deleteKeyBtn = document.getElementById('btn-delete-openai-key');
  if (deleteKeyBtn) {
    deleteKeyBtn.addEventListener('click', () => {
      if (openAiKeyInput) openAiKeyInput.value = '';
      localStorage.removeItem('aeroprint_openai_key');
      showToast('Chave de API removida.', 'info');
    });
  }

  // AI assistant button in model modal
  const runAiQueryBtn = document.getElementById('btn-run-openai-query');
  if (runAiQueryBtn) {
    runAiQueryBtn.addEventListener('click', runOpenAIQuery);
  }
  // Report Tabs
  document.querySelectorAll('.report-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.report-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.report-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-panel-' + tab);
      if (panel) panel.classList.add('active');
      // Render profit report when switching to profit tab
      if (tab === 'profit') renderProfitReport();
    });
  });

  // Alert Settings Update
  document.getElementById('btn-save-alert-settings')?.addEventListener('click', saveAlertSettings);

  // ---- Company Name: auto-save on blur ----
  const companyNameInput = document.getElementById('input-company-name');
  if (companyNameInput) {
    companyNameInput.addEventListener('blur', () => {
      const val = companyNameInput.value.trim();
      if (val) {
        localStorage.setItem('aeroprint_company_name', val);
        applyCompanyName(val);
        showToast('Nome da empresa atualizado!');
      }
    });
    companyNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') companyNameInput.blur();
    });
  }

  // ---- Helper: bind one logo slot ----
  function bindLogoSlot(inputId, removeBtnId, storageKey, applyFn) {
    const input = document.getElementById(inputId);
    if (input) {
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target.result;
          localStorage.setItem(storageKey, dataUrl);
          applyFn(dataUrl);
        };
        reader.readAsDataURL(file);
      });
    }
    const removeBtn = document.getElementById(removeBtnId);
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        localStorage.removeItem(storageKey);
        applyFn(null);
      });
    }
  }

  bindLogoSlot('logo-sidebar-upload', 'btn-remove-logo-sidebar', 'aeroprint_logo_sidebar', applySidebarLogo);
  bindLogoSlot('logo-print-upload', 'btn-remove-logo-print', 'aeroprint_logo_print', applyPrintLogoPreview);
  bindLogoSlot('logo-fav-upload', 'btn-remove-logo-fav', 'aeroprint_logo_fav', applyFavicon);

  // ---- Logo BG options (sidebar only) ----
  document.querySelectorAll('input[name="logo-bg-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const mode = document.querySelector('input[name="logo-bg-mode"]:checked').value;
      localStorage.setItem('aeroprint_logo_bg_mode', mode);
      applyLogoBgMode(mode, localStorage.getItem('aeroprint_logo_bg_color') || '#f1a000');
    });
  });

  const bgColorPicker = document.getElementById('logo-bg-color-picker');
  if (bgColorPicker) {
    bgColorPicker.addEventListener('input', () => {
      localStorage.setItem('aeroprint_logo_bg_color', bgColorPicker.value);
      applyLogoBgMode('color', bgColorPicker.value);
      const colorOpt = document.getElementById('logo-bg-color-opt');
      if (colorOpt) { colorOpt.checked = true; localStorage.setItem('aeroprint_logo_bg_mode', 'color'); }
    });
  }

  // ---- Migrate old single key to new sidebar key ----
  const legacyLogo = localStorage.getItem('aeroprint_logo');
  if (legacyLogo && !localStorage.getItem('aeroprint_logo_sidebar')) {
    localStorage.setItem('aeroprint_logo_sidebar', legacyLogo);
    localStorage.removeItem('aeroprint_logo');
  }

  // ---- Apply all on page load ----
  const savedName = localStorage.getItem('aeroprint_company_name');
  const savedSidebar = localStorage.getItem('aeroprint_logo_sidebar');
  const savedPrint = localStorage.getItem('aeroprint_logo_print');
  const savedFav = localStorage.getItem('aeroprint_logo_fav');
  const savedBgMode = localStorage.getItem('aeroprint_logo_bg_mode') || 'color';
  const savedBgColor = localStorage.getItem('aeroprint_logo_bg_color') || '#f1a000';

  applyCompanyName(savedName);
  applySidebarLogo(savedSidebar);
  applyPrintLogoPreview(savedPrint);
  applyFavicon(savedFav);

  // Restore settings panel state
  const nameInput = document.getElementById('input-company-name');
  if (nameInput && savedName) nameInput.value = savedName;
  const colorPickerEl = document.getElementById('logo-bg-color-picker');
  if (colorPickerEl) colorPickerEl.value = savedBgColor;
  const modeRadio = document.getElementById(savedBgMode === 'none' ? 'logo-bg-none-opt' : 'logo-bg-color-opt');
  if (modeRadio) modeRadio.checked = true;
  if (savedSidebar) applyLogoBgMode(savedBgMode, savedBgColor);
}

function applyCompanyName(name) {
  const el = document.getElementById('sidebar-company-name');
  if (el && name) el.textContent = name;
  if (name) document.title = `${name} - Sistema de Ordens de Serviço`;
}

function applyFavicon(dataUrl) {
  const link = document.getElementById('dynamic-favicon');
  if (!link) return;
  link.href = dataUrl || '';
  // Update preview
  _updateLogoPreview('logo-fav-preview-img', 'logo-fav-preview-placeholder', 'btn-remove-logo-fav', dataUrl);
}

function applyPrintLogoPreview(dataUrl) {
  _updateLogoPreview('logo-print-preview-img', 'logo-print-preview-placeholder', 'btn-remove-logo-print', dataUrl);
}

function applyLogoBgMode(mode, color) {
  const container = document.getElementById('sidebar-logo-container');
  if (!container) return;
  if (mode === 'none') {
    container.style.background = 'transparent';
    container.style.boxShadow = 'none';
    container.style.border = 'none';
  } else {
    container.style.background = color;
    container.style.boxShadow = `0 0 12px ${color}55`;
    container.style.border = '';
  }
}

function _updateLogoPreview(imgId, placeholderId, removeBtnId, dataUrl) {
  const img = document.getElementById(imgId);
  const placeholder = document.getElementById(placeholderId);
  const removeBtn = document.getElementById(removeBtnId);
  if (!img || !placeholder) return;
  if (dataUrl) {
    img.src = dataUrl; img.style.display = 'block';
    placeholder.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
  } else {
    img.src = ''; img.style.display = 'none';
    placeholder.style.display = '';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

function applySidebarLogo(dataUrl) {
  const sidebarImg = document.getElementById('sidebar-logo-img');
  const sidebarIcon = document.getElementById('sidebar-logo-icon');
  const bgOptions = document.getElementById('logo-bg-options');

  if (sidebarImg && sidebarIcon) {
    if (dataUrl) {
      sidebarImg.src = dataUrl; sidebarImg.style.display = 'block';
      sidebarIcon.style.display = 'none';
      if (bgOptions) bgOptions.style.display = 'block';
      const savedBgMode = localStorage.getItem('aeroprint_logo_bg_mode') || 'color';
      const savedBgColor = localStorage.getItem('aeroprint_logo_bg_color') || '#f1a000';
      applyLogoBgMode(savedBgMode, savedBgColor);
    } else {
      sidebarImg.src = ''; sidebarImg.style.display = 'none';
      sidebarIcon.style.display = '';
      if (bgOptions) bgOptions.style.display = 'none';
      const container = document.getElementById('sidebar-logo-container');
      if (container) { container.style.background = ''; container.style.boxShadow = ''; }
    }
  }
  _updateLogoPreview('logo-sidebar-preview-img', 'logo-sidebar-preview-placeholder', 'btn-remove-logo-sidebar', dataUrl);
}

// Legacy applyLogo kept for any remaining callers
function applyLogo(dataUrl) { applySidebarLogo(dataUrl); }


// ================= ALERTS & NOTIFICATIONS SYSTEM =================

function computeAlerts() {
  if (!state.alertSettings) return [];
  const s = state.alertSettings;
  const snoozes = state.alertSnoozes || {};
  const alerts = [];
  const now = new Date();
  // We zero out time to make daily comparisons accurate
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  state.ordens.forEach(os => {
    if (!os) return;

    // Skip if all items are "Finalizado" OR if paid in full (depending on alert type context, but generally finished OSs need less nagging)
    // Actually, we should check items. If all items are Finalizado, it's done production-wise.
    const allFinalizado = os.itens && os.itens.length > 0 && os.itens.every(i => i.estado === 'Finalizado');
    const isPago = os.estadoPagamento === 'Pago';

    const osDate = new Date(os.dataOrdem + 'T00:00:00');
    const daysSinceOS = Math.floor((today - osDate) / (1000 * 60 * 60 * 24));

    // 1. Prazo Próximo & Vencido (relies on os.dataLimite)
    if (os.dataLimite && !allFinalizado) {
      const limiteDate = new Date(os.dataLimite + 'T00:00:00');
      const daysUntilDeadline = Math.floor((limiteDate - today) / (1000 * 60 * 60 * 24));

      if (daysUntilDeadline < 0) {
        // Vencido (Always enabled, Critical)
        addAlertIfActive(alerts, snoozes, {
          alertKey: `vencido_${os.id}`,
          type: 'vencido',
          osId: os.id,
          priority: 4, // Critical
          title: `Prazo Vencido!`,
          desc: `A OS ${os.id} estava programada para ${formatDateBR(os.dataLimite)} (${Math.abs(daysUntilDeadline)} dias atrasada).`,
          icon: 'alert-triangle',
          color: 'var(--color-danger)'
        });
      } else if (s.prazo_proximo.enabled && daysUntilDeadline <= s.prazo_proximo.diasAntecedencia) {
        // Próximo (High)
        addAlertIfActive(alerts, snoozes, {
          alertKey: `proximo_${os.id}`,
          type: 'proximo',
          osId: os.id,
          priority: 3,
          title: `Prazo Próximo (${daysUntilDeadline === 0 ? 'Hoje' : daysUntilDeadline + ' dias'})`,
          desc: `A OS ${os.id} tem entrega prevista para ${formatDateBR(os.dataLimite)}.`,
          icon: 'clock',
          color: 'var(--color-warning)'
        });
      }
    }

    // 2. OS Parada (Em andamento, sem finalizar, há muito tempo)
    if (s.parado.enabled && !allFinalizado && daysSinceOS >= s.parado.diasSemMovimento) {
      addAlertIfActive(alerts, snoozes, {
        alertKey: `parado_${os.id}`,
        type: 'parado',
        osId: os.id,
        priority: 2,
        title: `OS Parada`,
        desc: `A OS ${os.id} foi criada há ${daysSinceOS} dias e ainda não foi finalizada.`,
        icon: 'hourglass',
        color: '#f59e0b'
      });
    }

    // 3. Pagamento Pendente (OS Finalizada mas não paga)
    if (s.pagamento_pendente.enabled && allFinalizado && !isPago && os.valorTotal > 0 && daysSinceOS >= s.pagamento_pendente.diasAposOS) {
      const saldo = os.valorTotal - ((os.pagoServico || 0) + (os.pagoArquivo || 0));
      addAlertIfActive(alerts, snoozes, {
        alertKey: `pagamento_${os.id}`,
        type: 'pagamento',
        osId: os.id,
        priority: 2,
        title: `Pagamento Pendente`,
        desc: `OS ${os.id} concluída mas possui saldo de ${formatCurrency(saldo)} em aberto há ${daysSinceOS} dias.`,
        icon: 'dollar-sign',
        color: '#f59e0b'
      });
    }

    // 4. Valor Alto Pendente
    if (s.valor_alto_pendente.enabled && !isPago) {
      const saldo = os.valorTotal - ((os.pagoServico || 0) + (os.pagoArquivo || 0));
      if (saldo >= s.valor_alto_pendente.valorMinimo) {
        addAlertIfActive(alerts, snoozes, {
          alertKey: `valoralto_${os.id}`,
          type: 'valoralto',
          osId: os.id,
          priority: 1,
          title: `Valor Alto em Aberto`,
          desc: `A OS ${os.id} tem ${formatCurrency(saldo)} pendentes de recebimento.`,
          icon: 'alert-circle',
          color: 'var(--color-info)'
        });
      }
    }
  });

  // Sort alerts by priority (descending)
  alerts.sort((a, b) => b.priority - a.priority);
  return alerts;
}

function addAlertIfActive(alertsArray, snoozesDict, alertObj) {
  // Check if snoozed
  const snoozeUntil = snoozesDict[alertObj.alertKey];
  if (snoozeUntil) {
    const untilDate = new Date(snoozeUntil);
    if (new Date() < untilDate) {
      return; // Still snoozed
    } else {
      // Snooze expired, we could clean it up, but we'll just ignore it
      delete state.alertSnoozes[alertObj.alertKey];
    }
  }
  alertsArray.push(alertObj);
}

function renderAlertBadge() {
  const badge = document.getElementById('alert-badge');
  if (!badge) return;
  const alerts = computeAlerts();
  if (alerts.length > 0) {
    badge.innerText = alerts.length > 99 ? '99+' : alerts.length;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderAlertsPanel() {
  const body = document.getElementById('alerts-panel-body');
  if (!body) return;

  const alerts = computeAlerts();

  if (alerts.length === 0) {
    body.innerHTML = `
      <div class="alert-empty">
        <i data-lucide="check-circle" style="width:32px;height:32px;color:var(--color-success);margin-bottom:10px;opacity:0.8;"></i><br>
        Tudo tranquilo!<br>Nenhum alerta pendente no momento.
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let html = '';
  alerts.forEach(al => {
    html += `
      <div class="alert-item">
        <div class="alert-icon" style="background: ${al.color}20; color: ${al.color};">
          <i data-lucide="${al.icon}"></i>
        </div>
        <div class="alert-content">
          <div class="alert-title">${al.title}</div>
          <div class="alert-desc">${al.desc}</div>
          <div class="alert-actions">
            <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.7rem; border-radius:4px;" onclick="viewOSFromAlert('${al.osId}')">Ver OS</button>
            <div style="position:relative; display:inline-block;">
              <select onchange="snoozeAlert('${al.alertKey}', this.value)" style="padding: 4px 6px; font-size: 0.7rem; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color); color:var(--text-secondary); outline:none; cursor:pointer;">
                <option value="">💤 Ignorar por...</option>
                <option value="1">1 dia</option>
                <option value="3">3 dias</option>
                <option value="7">7 dias</option>
                <option value="15">15 dias</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  body.innerHTML = html;
  lucide.createIcons();
}

window.viewOSFromAlert = function (osId) {
  document.getElementById('alerts-panel').style.display = 'none';
  switchTab('dashboard');
  viewOSDetails(osId);
};

window.snoozeAlert = function (alertKey, daysStr) {
  if (!daysStr) return;
  const days = parseInt(daysStr, 10);
  const snoozeDate = new Date();
  snoozeDate.setDate(snoozeDate.getDate() + days);

  if (!state.alertSnoozes) state.alertSnoozes = {};
  state.alertSnoozes[alertKey] = snoozeDate.toISOString();
  saveToLocalStorage();

  // Refresh panel
  renderAlertsPanel();
};

function renderAlertSettings() {
  const container = document.getElementById('alert-settings-content');
  if (!container || !state.alertSettings) return;

  const s = state.alertSettings;

  container.innerHTML = `
    <p class="text-muted" style="margin-bottom: 15px; font-size: 0.85rem;">
      O sistema inteligente de alertas avisa quando uma OS precisa da sua atenção. Você pode configurar os parâmetros abaixo:
    </p>
    
    <div style="display:flex; flex-direction:column; gap:16px;">
      <!-- Prazo Próximo -->
      <div style="padding:12px; background:var(--bg-body); border:1px solid var(--border-color); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:var(--text-primary);">Prazo Próximo</strong>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.8rem;">
            <input type="checkbox" id="cfg-prazo-enabled" ${s.prazo_proximo.enabled ? 'checked' : ''}> Ativado
          </label>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Avisa quando a data limite de uma OS estiver próxima. (O alerta de prazo vencido é sempre ativo).</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.8rem;">Avisar com</span>
          <input type="number" id="cfg-prazo-dias" value="${s.prazo_proximo.diasAntecedencia}" style="width:60px; padding:4px; font-size:0.8rem; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color); color:#fff;" min="1" max="30">
          <span style="font-size:0.8rem;">dias de antecedência.</span>
        </div>
      </div>

      <!-- OS Parada -->
      <div style="padding:12px; background:var(--bg-body); border:1px solid var(--border-color); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:var(--text-primary);">OS Parada</strong>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.8rem;">
            <input type="checkbox" id="cfg-parado-enabled" ${s.parado.enabled ? 'checked' : ''}> Ativado
          </label>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Avisa se uma OS foi criada há muito tempo e ainda não foi finalizada.</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.8rem;">Avisar após</span>
          <input type="number" id="cfg-parado-dias" value="${s.parado.diasSemMovimento}" style="width:60px; padding:4px; font-size:0.8rem; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color); color:#fff;" min="1" max="90">
          <span style="font-size:0.8rem;">dias da criação.</span>
        </div>
      </div>

      <!-- Pagamento Pendente -->
      <div style="padding:12px; background:var(--bg-body); border:1px solid var(--border-color); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:var(--text-primary);">Pagamento Pendente</strong>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.8rem;">
            <input type="checkbox" id="cfg-pagamento-enabled" ${s.pagamento_pendente.enabled ? 'checked' : ''}> Ativado
          </label>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Avisa se uma OS está 100% finalizada, mas o pagamento ainda não foi recebido.</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.8rem;">Avisar após</span>
          <input type="number" id="cfg-pagamento-dias" value="${s.pagamento_pendente.diasAposOS}" style="width:60px; padding:4px; font-size:0.8rem; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color); color:#fff;" min="0" max="90">
          <span style="font-size:0.8rem;">dias em aberto.</span>
        </div>
      </div>

      <!-- Valor Alto Pendente -->
      <div style="padding:12px; background:var(--bg-body); border:1px solid var(--border-color); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:var(--text-primary);">Valor Alto em Aberto</strong>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.8rem;">
            <input type="checkbox" id="cfg-valoralto-enabled" ${s.valor_alto_pendente.enabled ? 'checked' : ''}> Ativado
          </label>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Destaca ordens de serviço pendentes cujo saldo devedor seja considerável, independente do tempo.</div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:0.8rem;">Avisar saldo acima de R$</span>
          <input type="number" id="cfg-valoralto-valor" value="${s.valor_alto_pendente.valorMinimo}" style="width:80px; padding:4px; font-size:0.8rem; border-radius:4px; background:var(--bg-input); border:1px solid var(--border-color); color:#fff;" min="10" step="10">
        </div>
      </div>
    </div>
    
    <div style="margin-top: 15px;">
      <button class="btn btn-primary" id="btn-save-alert-settings" onclick="saveAlertSettings()">Salvar Configurações</button>
    </div>
  `;
}

window.saveAlertSettings = function () {
  state.alertSettings.prazo_proximo.enabled = document.getElementById('cfg-prazo-enabled').checked;
  state.alertSettings.prazo_proximo.diasAntecedencia = parseInt(document.getElementById('cfg-prazo-dias').value) || 3;

  state.alertSettings.parado.enabled = document.getElementById('cfg-parado-enabled').checked;
  state.alertSettings.parado.diasSemMovimento = parseInt(document.getElementById('cfg-parado-dias').value) || 7;

  state.alertSettings.pagamento_pendente.enabled = document.getElementById('cfg-pagamento-enabled').checked;
  state.alertSettings.pagamento_pendente.diasAposOS = parseInt(document.getElementById('cfg-pagamento-dias').value) || 3;

  state.alertSettings.valor_alto_pendente.enabled = document.getElementById('cfg-valoralto-enabled').checked;
  state.alertSettings.valor_alto_pendente.valorMinimo = parseInt(document.getElementById('cfg-valoralto-valor').value) || 500;

  saveToLocalStorage();
  showToast('Configurações de alertas salvas!');
};

let currentModelVariants = [];

// ================= MODAL CONTROLLER =================
function openModal(modalType) {
  const overlay = document.getElementById(`modal-${modalType}`);
  if (overlay) {
    overlay.classList.add('active');

    // Clear the form fields for creation
    const form = overlay.querySelector('form');
    if (form) {
      form.reset();
      const idInput = form.querySelector('input[type="hidden"]');
      if (idInput) idInput.value = "";
    }

    if (modalType === 'model') {
      currentModelVariants = [];
      renderModelVariants();
    }

    // Set titles
    const titleEl = document.getElementById(`modal-${modalType}-title`);
    if (titleEl) {
      if (modalType === 'client') titleEl.innerText = "Novo Cliente";
      if (modalType === 'supplier') titleEl.innerText = "Novo Fornecedor";
      if (modalType === 'model') titleEl.innerText = "Novo Modelo de Aeronave";
    }
  }
}

function openEditModal(modalType, entityId) {
  openModal(modalType);

  // Set title to Edit
  const titleEl = document.getElementById(`modal-${modalType}-title`);
  if (titleEl) {
    if (modalType === 'client') titleEl.innerText = "Editar Cliente";
    if (modalType === 'supplier') titleEl.innerText = "Editar Fornecedor";
    if (modalType === 'model') titleEl.innerText = "Editar Modelo de Aeronave";
  }

  // Pre-fill fields
  if (modalType === 'client') {
    const cli = state.clientes.find(c => c.id === entityId);
    if (cli) {
      document.getElementById('quick-client-id').value = cli.id;
      document.getElementById('qc-nome').value = cli.nome;
      document.getElementById('qc-telefone').value = cli.telefone || "";
      document.getElementById('qc-email').value = cli.email || "";
    }
  } else if (modalType === 'supplier') {
    const sup = state.fornecedores.find(s => s.id === entityId);
    if (sup) {
      document.getElementById('quick-supplier-id').value = sup.id;
      document.getElementById('qs-nome').value = sup.nome;
      document.getElementById('qs-contato').value = sup.contato || "";
      document.getElementById('qs-telefone').value = sup.telefone || "";
      document.getElementById('qs-servico').value = sup.servico || "";
    }
  } else if (modalType === 'model') {
    const mod = state.modelos.find(m => m.id === entityId);
    if (mod) {
      document.getElementById('quick-model-id').value = mod.id;
      document.getElementById('qm-nome').value = mod.nome || '';
      document.getElementById('qm-valor-arquivo').value = (mod.valorArquivo || 0).toFixed(2);

      if (mod.variantes && mod.variantes.length > 0) {
        currentModelVariants = JSON.parse(JSON.stringify(mod.variantes));
      } else if (mod.escala || mod.comprimento || mod.precoBase) {
        // legacy
        currentModelVariants = [{
          id: 'var_' + Date.now(),
          escala: mod.escala || '',
          comprimento: mod.comprimento || 0,
          envergadura: mod.envergadura || 0,
          materialPadrao: mod.materialPadrao || '',
          acabamentoPadrao: mod.acabamentoPadrao || '',
          precoBase: mod.precoBase || 0,
          custoProducao: mod.custoProducao || 0
        }];
      } else {
        currentModelVariants = [];
      }
      renderModelVariants();
    }
  }
}

function closeActiveModal() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.classList.remove('active');
  });
  activeModelSelectElement = null;
  document.body.classList.remove('print-only-client', 'print-only-profit', 'print-only-os');
}

// ================= QUICK ADD ACTIONS (MODAL SUMBITS) =================
function saveQuickClient(e) {
  e.preventDefault();
  const id = document.getElementById('quick-client-id').value;
  const nome = document.getElementById('qc-nome').value.trim();
  const telefone = document.getElementById('qc-telefone').value.trim();
  const email = document.getElementById('qc-email').value.trim();

  if (!nome) return;

  if (id) {
    // Edit existing
    const cliIndex = state.clientes.findIndex(c => c.id === id);
    if (cliIndex > -1) {
      state.clientes[cliIndex].nome = nome;
      state.clientes[cliIndex].telefone = telefone;
      state.clientes[cliIndex].email = email;
    }
  } else {
    // Create new
    const newCli = {
      id: "cli_" + Date.now(),
      nome,
      telefone,
      email,
      dataCadastro: new Date().toISOString().split('T')[0]
    };
    state.clientes.push(newCli);

    // Auto-select in OS form if it was opened from there
    const osClientSelect = document.getElementById('os-cliente');
    if (osClientSelect) {
      updateClientDropdowns();
      osClientSelect.value = newCli.id;
    }
  }

  saveToLocalStorage();
  closeActiveModal();

  // Refresh views
  renderClientes();
  if (document.getElementById('view-ordens').classList.contains('active')) {
    updateClientDropdowns();
  }
}

function saveQuickSupplier(e) {
  e.preventDefault();
  const id = document.getElementById('quick-supplier-id').value;
  const nome = document.getElementById('qs-nome').value.trim();
  const contato = document.getElementById('qs-contato').value.trim();
  const telefone = document.getElementById('qs-telefone').value.trim();
  const servico = document.getElementById('qs-servico').value.trim();

  if (!nome) return;

  if (id) {
    const index = state.fornecedores.findIndex(s => s.id === id);
    if (index > -1) {
      state.fornecedores[index].nome = nome;
      state.fornecedores[index].contato = contato;
      state.fornecedores[index].telefone = telefone;
      state.fornecedores[index].servico = servico;
    }
  } else {
    const newSup = {
      id: "for_" + Date.now(),
      nome,
      contato,
      telefone,
      servico
    };
    state.fornecedores.push(newSup);

    // Auto-select in OS form
    const osSupplierSelect = document.getElementById('os-fornecedor');
    if (osSupplierSelect) {
      updateSupplierDropdowns();
      osSupplierSelect.value = newSup.id;
    }
  }

  saveToLocalStorage();
  closeActiveModal();

  renderFornecedores();
  if (document.getElementById('view-ordens').classList.contains('active')) {
    updateSupplierDropdowns();
  }
}

function addModelVariant() {
  currentModelVariants.push({
    id: 'var_' + Date.now() + Math.floor(Math.random() * 100),
    escala: '',
    comprimento: 0,
    envergadura: 0,
    materialPadrao: '',
    acabamentoPadrao: '',
    precoBase: 0,
    custoProducao: 0
  });
  renderModelVariants();
}

function removeModelVariant(index) {
  const variant = currentModelVariants[index];

  // Check if this variant is used in any OS
  if (variant && variant.id) {
    let isUsed = false;
    for (const os of state.ordens) {
      if (os.itens && os.itens.some(item => item.varianteId === variant.id)) {
        isUsed = true;
        break;
      }
    }
    if (isUsed) {
      alert('Ação bloqueada: Esta variante/tamanho já está vinculada a uma Ordem de Serviço.');
      return;
    }
  }

  currentModelVariants.splice(index, 1);
  renderModelVariants();
}

function syncVariant(index, field, value) {
  if (field === 'comprimento' || field === 'envergadura' || field === 'precoBase' || field === 'custoProducao') {
    currentModelVariants[index][field] = parseFloat(value) || 0;
  } else {
    currentModelVariants[index][field] = value;
  }
}

function renderModelVariants() {
  const container = document.getElementById('qm-variants-container');
  if (!container) return;

  if (currentModelVariants.length === 0) {
    container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem; text-align: center; padding: 12px; border: 1px dashed var(--border-default); border-radius: 6px;">Nenhuma escala/tamanho cadastrado.</div>';
    return;
  }

  container.innerHTML = currentModelVariants.map((v, index) => `
    <div class="variant-item" style="border: 1px solid var(--border-default); padding: 16px; border-radius: 6px; position: relative; background: rgba(255,255,255,0.02);">
      <button type="button" onclick="removeModelVariant(${index})" title="Remover" style="position: absolute; right: 8px; top: 8px; background:none; border:none; color:var(--color-danger); cursor:pointer;"><i data-lucide="trash-2" style="width:16px;"></i></button>
      
      <div class="form-grid" style="margin-bottom: 8px; margin-top: 8px;">
        <div class="form-group" style="position: relative;">
          <label style="font-size: 0.8rem;">Escala / Tamanho</label>
          <input type="text" id="qm-var-escala-${index}" value="${v.escala}" placeholder="Ex: 1:32" onchange="syncVariant(${index}, 'escala', this.value)" style="padding-right: 32px; font-size: 0.85rem; padding: 6px 32px 6px 8px;">
          <button type="button" onclick="runAiForVariantScale(${index})" title="Calcular Medidas" style="position: absolute; right: 4px; bottom: 4px; background: var(--accent); border: none; color: #111; cursor: pointer; width: 22px; height: 22px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"><i data-lucide="sparkles" style="width:12px; height:12px;"></i></button>
        </div>
        <div class="form-group">
          <label style="font-size: 0.8rem;">Material</label>
          <select id="qm-var-material-${index}" onchange="syncVariant(${index}, 'materialPadrao', this.value)" style="font-size: 0.85rem; padding: 6px;">
            <option value="">-- Selecionar --</option>
            <option value="ABS" ${v.materialPadrao === 'ABS' ? 'selected' : ''}>ABS</option>
            <option value="RESINA" ${v.materialPadrao === 'RESINA' ? 'selected' : ''}>RESINA</option>
            <option value="RESINA + ABS" ${v.materialPadrao === 'RESINA + ABS' ? 'selected' : ''}>RESINA + ABS</option>
          </select>
        </div>
        <div class="form-group">
          <label style="font-size: 0.8rem;">Acabamento</label>
          <select id="qm-var-acabamento-${index}" onchange="syncVariant(${index}, 'acabamentoPadrao', this.value)" style="font-size: 0.85rem; padding: 6px;">
            <option value="">-- Selecionar --</option>
            <option value="Modelo Acabado" ${v.acabamentoPadrao === 'Modelo Acabado' ? 'selected' : ''}>Modelo Acabado</option>
            <option value="Apenas Impressão 3D" ${v.acabamentoPadrao === 'Apenas Impressão 3D' ? 'selected' : ''}>Apenas Impressão 3D</option>
          </select>
        </div>
      </div>
      <div class="form-grid" style="margin-bottom: 8px;">
        <div class="form-group">
          <label style="font-size: 0.8rem;">Comprimento (cm)</label>
          <input type="number" step="0.1" id="qm-var-comprimento-${index}" value="${v.comprimento || ''}" onchange="syncVariant(${index}, 'comprimento', this.value)" style="font-size: 0.85rem; padding: 6px;">
        </div>
        <div class="form-group">
          <label style="font-size: 0.8rem;">Envergadura (cm)</label>
          <input type="number" step="0.1" id="qm-var-envergadura-${index}" value="${v.envergadura || ''}" onchange="syncVariant(${index}, 'envergadura', this.value)" style="font-size: 0.85rem; padding: 6px;">
        </div>
      </div>
      <div class="form-grid" style="margin-bottom: 0;">
        <div class="form-group">
          <label style="font-size: 0.8rem;">Custo Prod. (R$)</label>
          <input type="number" step="0.01" id="qm-var-custo-${index}" value="${v.custoProducao || ''}" onchange="syncVariant(${index}, 'custoProducao', this.value)" style="font-size: 0.85rem; padding: 6px;">
        </div>
        <div class="form-group">
          <label style="font-size: 0.8rem;">Preço Base (R$)</label>
          <input type="number" step="0.01" id="qm-var-preco-${index}" value="${v.precoBase || ''}" onchange="syncVariant(${index}, 'precoBase', this.value)" style="font-size: 0.85rem; padding: 6px;">
        </div>
      </div>
      <span id="ai-variant-status-${index}" style="font-size: 0.7rem; display: block; margin-top: 4px;"></span>
      <div id="ai-variant-options-${index}" style="display: none; margin-top: 8px; gap: 4px; flex-direction: column;">
        <strong style="font-size: 0.7rem; color: var(--text-secondary);">Sugestões de Medidas/Escalas:</strong>
        <div id="ai-variant-options-list-${index}" style="display: flex; flex-direction: column; gap: 4px;"></div>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

function saveQuickModel(e) {
  e.preventDefault();
  const id = document.getElementById('quick-model-id').value;
  const nome = document.getElementById('qm-nome').value.trim();
  const valorArquivo = parseFloat(document.getElementById('qm-valor-arquivo').value) || 0;

  if (!nome) return;
  if (currentModelVariants.length === 0) {
    alert("Adicione pelo menos 1 tamanho/escala ao modelo.");
    return;
  }

  // Force sync from DOM to catch any un-blurred inputs
  currentModelVariants.forEach((v, idx) => {
    v.escala = document.getElementById(`qm-var-escala-${idx}`).value.trim();
    v.comprimento = parseFloat(document.getElementById(`qm-var-comprimento-${idx}`).value) || 0;
    v.envergadura = parseFloat(document.getElementById(`qm-var-envergadura-${idx}`).value) || 0;
    v.materialPadrao = document.getElementById(`qm-var-material-${idx}`).value;
    v.acabamentoPadrao = document.getElementById(`qm-var-acabamento-${idx}`).value;
    v.custoProducao = parseFloat(document.getElementById(`qm-var-custo-${idx}`).value) || 0;
    v.precoBase = parseFloat(document.getElementById(`qm-var-preco-${idx}`).value) || 0;
  });

  let savedModelId = id;
  if (id) {
    const index = state.modelos.findIndex(m => m.id === id);
    if (index > -1) {
      state.modelos[index].nome = nome;
      state.modelos[index].valorArquivo = valorArquivo;
      state.modelos[index].variantes = JSON.parse(JSON.stringify(currentModelVariants));

      // Legacy cleanup to prevent bugs
      delete state.modelos[index].escala;
      delete state.modelos[index].comprimento;
      delete state.modelos[index].envergadura;
      delete state.modelos[index].precoBase;
    }
  } else {
    const newMod = {
      id: "mod_" + Date.now(),
      nome,
      valorArquivo,
      variantes: JSON.parse(JSON.stringify(currentModelVariants))
    };
    state.modelos.push(newMod);
    savedModelId = newMod.id;
  }

  saveToLocalStorage();

  if (activeModelSelectElement) {
    updateModelDropdownsInForm();
    activeModelSelectElement.value = savedModelId;
    activeModelSelectElement.dispatchEvent(new Event('change'));
  }

  closeActiveModal();
  renderModelos();
}

// Helper: update OS client dropdown list
function updateClientDropdowns() {
  const select = document.getElementById('os-cliente');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Selecione um Cliente</option>';

  const datalist = document.getElementById('subclientes-list');
  if (datalist) {
    datalist.innerHTML = '';
  }

  const clientes = state.clientes || [];
  [...clientes].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).forEach(c => {
    if (c) {
      select.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
      if (datalist) {
        datalist.innerHTML += `<option value="${c.nome}"></option>`;
      }
    }
  });
  select.value = currentValue;
}

// Helper: update OS supplier dropdown list
function updateSupplierDropdowns() {
  const select = document.getElementById('os-fornecedor');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Sem Terceirização</option>';
  const fornecedores = state.fornecedores || [];
  [...fornecedores].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).forEach(s => {
    if (s) {
      select.innerHTML += `<option value="${s.id}">${s.nome}</option>`;
    }
  });
  select.value = currentValue;
}

// Helper: update all model dropdowns in currently open OS form items
function updateModelDropdownsInForm() {
  const selectList = document.querySelectorAll('.os-item-model-select');
  const modelos = state.modelos || [];
  const sortedModelos = [...modelos].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  selectList.forEach(select => {
    const currentValue = select.value;
    select.innerHTML = '<option value="">Selecione o Modelo</option>';
    sortedModelos.forEach(m => {
      if (m) {
        const scaleStr = m.escala ? `${m.escala} - ` : '';
        select.innerHTML += `<option value="${m.id}">${m.nome} (${scaleStr}${m.comprimento || 0}x${m.envergadura || 0}cm)</option>`;
      }
    });
    select.value = currentValue;
  });
}

// ================= RENDERING: DASHBOARD =================
function renderDashboard() {
  const totalOSCount = state.ordens.length;

  let pendenteOSCount = 0;
  let andamentoOSCount = 0;
  let finalizadoOSCount = 0;
  let faturamento = 0;
  let aReceber = 0;

  let productionItems = [];

  state.ordens.forEach(os => {
    faturamento += os.valorTotal;

    // Status breakdown based on all items inside OS
    const itemStates = os.itens.map(i => i.estado);
    const hasPendente = itemStates.includes('Pendente');
    const hasAndamento = itemStates.includes('Em Andamento');
    const allFinalizado = itemStates.every(s => s === 'Finalizado');

    if (allFinalizado && itemStates.length > 0) {
      finalizadoOSCount++;
    } else if (hasAndamento) {
      andamentoOSCount++;
    } else {
      pendenteOSCount++;
    }

    // A Receber Calculation: exact remaining unpaid balance on each OS
    const totalPago = (os.pagoServico || 0) + (os.pagoArquivo || 0) + (os.pagoTerceiros || 0);
    aReceber += Math.max(0, os.valorTotal - totalPago);

    // Collect production queue details (all items that are not finalized)
    os.itens.forEach(item => {
      if (item.estado !== 'Finalizado' || true) { // Display all active or recent items
        const client = state.clientes.find(c => c.id === os.clienteId);
        const model = state.modelos.find(m => m.id === item.modeloId);
        productionItems.push({
          osId: os.id,
          date: os.dataOrdem,
          clientName: client ? (os.subcliente ? `${client.nome} (${os.subcliente})` : client.nome) : 'Desconhecido',
          modelName: model ? model.nome : 'Modelo Excluído',
          modelDetails: model ? `${model.comprimento}x${model.envergadura}cm` : '',
          qty: item.quantidade,
          matricula: item.matricula,
          material: item.material,
          estado: item.estado,
          modeloId: item.modeloId,
          itemId: `${os.id}-${item.modeloId}-${item.matricula}` // uniquely identify inside runtime
        });
      }
    });
  });

  // Display counters
  document.getElementById('stat-total-os').innerText = totalOSCount;
  document.getElementById('stat-pendente-os').innerText = pendenteOSCount;
  document.getElementById('stat-andamento-os').innerText = andamentoOSCount;
  document.getElementById('stat-finalizado-os').innerText = finalizadoOSCount;
  document.getElementById('stat-faturamento').innerText = formatCurrency(faturamento);
  document.getElementById('stat-a-receber').innerText = formatCurrency(aReceber);

  // Render recent orders table (max 5)
  const recentTable = document.getElementById('dashboard-recent-orders');
  recentTable.innerHTML = '';

  const sortedOS = [...state.ordens].sort((a, b) => new Date(b.dataOrdem) - new Date(a.dataOrdem));
  const recentOS = sortedOS.slice(0, 5);

  if (recentOS.length === 0) {
    recentTable.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Nenhuma ordem de serviço cadastrada.</td></tr>`;
  } else {
    recentOS.forEach(os => {
      const client = state.clientes.find(c => c.id === os.clienteId);
      let clientDisplayName = client ? client.nome : 'Desconhecido';
      if (os.subcliente) {
        clientDisplayName += ` (${os.subcliente})`;
      }

      // Items list summary
      const itemsSummary = os.itens.map(i => {
        const m = state.modelos.find(mod => mod.id === i.modeloId);
        return `${m ? m.nome : 'Excluído'} (${i.quantidade}x)`;
      }).join(', ');

      const formattedDate = formatDateBR(os.dataOrdem);

      let badgeClass = 'badge-pendente';
      if (os.estadoPagamento === 'Pago') badgeClass = 'badge-pago';
      if (os.estadoPagamento === 'Pago Parcial') badgeClass = 'badge-parcial';

      recentTable.innerHTML += `
        <tr>
          <td><strong style="color: var(--border-focus); cursor: pointer; text-decoration: underline;" onclick="viewOSDetails('${os.id}')" title="Clique para ver detalhes">${os.id}</strong></td>
          <td>${clientDisplayName}</td>
          <td>${formattedDate}</td>
          <td title="${itemsSummary}" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${itemsSummary}</td>
          <td>${formatCurrency(os.valorTotal)}</td>
          <td><span class="badge ${badgeClass}">${os.estadoPagamento}</span></td>
          <td>
            <div class="table-actions">
              <button class="action-btn" onclick="viewOSDetails('${os.id}')" title="Ver Detalhes/Imprimir"><i data-lucide="eye"></i></button>
              <button class="action-btn" onclick="editOS('${os.id}')" title="Editar"><i data-lucide="edit-3"></i></button>
            </div>
          </td>
        </tr>
      `;
    });
  }

  // Render production queue
  const queueEl = document.getElementById('dashboard-production-queue');
  queueEl.innerHTML = '';

  // Sort queue: Pendente first, then Em Andamento, then Finalizado (recent)
  const orderRank = { 'Pendente': 1, 'Em Andamento': 2, 'Finalizado': 3 };
  productionItems.sort((a, b) => {
    if (orderRank[a.estado] !== orderRank[b.estado]) {
      return orderRank[a.estado] - orderRank[b.estado];
    }
    return new Date(b.date) - new Date(a.date); // Newest first
  });

  const activeQueue = productionItems.slice(0, 10); // Show top 10 items in production

  if (activeQueue.length === 0) {
    queueEl.innerHTML = `<div class="text-center text-muted py-3">Fila de fabricação vazia.</div>`;
  } else {
    activeQueue.forEach((item, index) => {
      queueEl.innerHTML += `
        <div class="queue-item state-${item.estado.replace(' ', '')}">
          <div class="queue-header">
            <span class="queue-title">${item.modelName}</span>
            <span class="queue-meta" style="font-weight: 700; color: var(--border-focus);">${item.osId}</span>
          </div>
          <div class="queue-meta">
            <span>Cliente: ${item.clientName}</span>
            <span>Qtd: <strong>${item.qty}</strong></span>
          </div>
          <div class="queue-meta">
            <span>Matrícula: <strong>${item.matricula || 'N/A'}</strong> | ${item.material}</span>
            <select class="btn-sm" style="background-color: hsla(224, 20%, 12%, 0.8); color:#fff; border: 1px solid var(--border-color); border-radius:4px; font-size:0.75rem;" 
              onchange="changeItemStatusDirectly('${item.osId}', '${item.modeloId}', '${item.matricula}', this.value)">
              <option value="Pendente" ${item.estado === 'Pendente' ? 'selected' : ''}>Pendente</option>
              <option value="Em Andamento" ${item.estado === 'Em Andamento' ? 'selected' : ''}>Em Andamento</option>
              <option value="Finalizado" ${item.estado === 'Finalizado' ? 'selected' : ''}>Finalizado</option>
            </select>
          </div>
        </div>
      `;
    });
  }
}

// Directly change the item status from the dashboard queue
function changeItemStatusDirectly(osId, modeloId, matricula, newStatus) {
  const os = state.ordens.find(o => o.id === osId);
  if (os) {
    const item = os.itens.find(i => i.modeloId === modeloId && i.matricula === matricula);
    if (item) {
      item.estado = newStatus;
      saveToLocalStorage();
      renderDashboard();
    }
  }
}

// ================= RENDERING: ORDENS DE SERVICO =================
function renderOSList() {
  const tableBody = document.getElementById('os-table-body');
  tableBody.innerHTML = '';

  const searchText = document.getElementById('os-search').value.toLowerCase();
  const filterPagamento = document.getElementById('os-filter-pagamento').value;
  const filterProducao = document.getElementById('os-filter-producao').value;

  const filtered = state.ordens.filter(os => {
    const client = state.clientes.find(c => c.id === os.clienteId);
    const clientName = client ? client.nome.toLowerCase() : '';
    const osId = os.id.toLowerCase();

    const matchesSearch = clientName.includes(searchText) || osId.includes(searchText);
    const matchesPagamento = !filterPagamento || os.estadoPagamento === filterPagamento;

    const itemStates = os.itens.map(i => i.estado);
    let osProductionStatus = 'Pendente';
    if (itemStates.every(s => s === 'Finalizado') && itemStates.length > 0) {
      osProductionStatus = 'Finalizado';
    } else if (itemStates.includes('Em Andamento') || (itemStates.includes('Finalizado') && !itemStates.every(s => s === 'Finalizado'))) {
      osProductionStatus = 'Em Andamento';
    }
    const matchesProducao = !filterProducao || osProductionStatus === filterProducao;

    return matchesSearch && matchesPagamento && matchesProducao;
  });

  filtered.sort((a, b) => new Date(b.dataOrdem) - new Date(a.dataOrdem));

  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 40px 16px;">Nenhuma ordem de servico encontrada com os filtros selecionados.</td></tr>';
    return;
  }

  filtered.forEach(os => {
    const client = state.clientes.find(c => c.id === os.clienteId);
    const clientName = client ? client.nome : '<i class="text-muted">Excluido</i>';
    const safeId = os.id.replace(/[^a-zA-Z0-9-]/g, '_');

    // Payment badge
    let payBadgeClass = 'badge-pendente';
    if (os.estadoPagamento === 'Pago') payBadgeClass = 'badge-pago';
    if (os.estadoPagamento === 'Pago Parcial') payBadgeClass = 'badge-parcial';

    // Production status
    const itemStates = os.itens.map(i => i.estado);
    const totalItems = itemStates.length;
    const doneItems = itemStates.filter(s => s === 'Finalizado').length;
    const inProgItems = itemStates.filter(s => s === 'Em Andamento').length;

    let prodBadgeClass = 'badge-pendente';
    let prodLabel = 'Pendente';
    if (totalItems > 0 && doneItems === totalItems) {
      prodBadgeClass = 'badge-pago';
      prodLabel = 'Finalizado';
    } else if (inProgItems > 0 || doneItems > 0) {
      prodBadgeClass = 'badge-andamento';
      prodLabel = 'Em Andamento';
    }

    const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
    const barColor = (doneItems === totalItems && totalItems > 0) ? 'var(--color-success)' : 'var(--color-info)';

    // Models summary (compact)
    const modelNames = os.itens.map(item => {
      const model = state.modelos.find(m => m.id === item.modeloId);
      return model ? model.nome : 'Modelo Removido';
    });
    const uniqueModels = [...new Set(modelNames)];
    let modelsText = uniqueModels.slice(0, 2).join(', ');
    if (uniqueModels.length > 2) modelsText += ` <span style="color:var(--text-tertiary)">+${uniqueModels.length - 2}</span>`;
    const totalQty = os.itens.reduce((acc, i) => acc + (parseInt(i.quantidade) || 1), 0);

    // Subcliente chip
    const subclienteTag = os.subcliente
      ? `<span style="display:inline-block;background:hsla(244,88%,66%,0.12);color:var(--accent);font-size:0.68rem;font-weight:700;padding:2px 8px;border-radius:var(--radius-full);margin-top:4px;">${os.subcliente}</span>`
      : '';

    // Terceiros note (only if > 0)
    const terceirosNote = os.valorTerceiros > 0
      ? `<div style="font-size:0.72rem;color:var(--text-secondary);margin-top:3px;">+ ${formatCurrency(os.valorTerceiros)} terceiros</div>`
      : '';

    // Build expanded items detail rows
    const expandedItemsHTML = os.itens.map((item, idx) => {
      const model = state.modelos.find(m => m.id === item.modeloId);
      const modelName = model ? model.nome : 'Modelo Removido';
      const isArquivoNovo = item.isNovoArquivo;

      let itemBadgeClass = 'badge-pendente';
      let itemStateLabel = item.estado || 'Pendente';
      if (item.estado === 'Em Andamento') itemBadgeClass = 'badge-andamento';
      if (item.estado === 'Finalizado') itemBadgeClass = 'badge-pago';

      const statusDot = item.estado === 'Finalizado'
        ? 'var(--color-success)'
        : item.estado === 'Em Andamento'
          ? 'var(--color-info)'
          : 'var(--text-tertiary)';

      const matriculaTag = item.matricula
        ? `<span style="font-size:0.7rem;color:var(--text-secondary);background:hsla(220,22%,14%,1);padding:1px 7px;border-radius:3px;">${item.matricula}</span>`
        : '';

      const arquivoTag = isArquivoNovo
        ? `<span style="font-size:0.67rem;color:var(--color-warning);background:var(--color-warning-bg);padding:1px 6px;border-radius:3px;font-weight:700;">Arq. Novo</span>`
        : '';

      const valorItem = item.preco > 0
        ? `<span style="font-size:0.72rem;color:var(--text-secondary);margin-left:auto;">${formatCurrency(item.preco * (parseInt(item.quantidade) || 1))}</span>`
        : '';

      return `
        <div class="os-expand-item" style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid hsla(220,15%,18%,0.7);">
          <div style="width:8px;height:8px;border-radius:50%;background:${statusDot};flex-shrink:0;"></div>
          <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-weight:700;font-size:0.86rem;">${modelName}</span>
              <span style="color:var(--text-secondary);font-size:0.8rem;">x${item.quantidade || 1}</span>
              ${matriculaTag}
              ${arquivoTag}
            </div>
          </div>
          <span class="badge ${itemBadgeClass}" style="flex-shrink:0;">${itemStateLabel}</span>
          ${valorItem}
        </div>
      `;
    }).join('');

    // Main row
    tableBody.innerHTML += `
      <tr class="os-main-row" id="os-row-${safeId}" onclick="toggleOSExpand('${safeId}')" style="cursor:pointer;">
        <td style="min-width:160px;">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="color:var(--accent);font-size:0.73rem;font-weight:700;letter-spacing:0.4px;cursor:pointer;text-decoration:underline;" onclick="event.stopPropagation(); viewOSDetails('${os.id}')" title="Clique para ver detalhes">${os.id}</span>
            <span style="font-weight:600;font-size:0.9rem;">${clientName}</span>
            ${subclienteTag}
          </div>
        </td>
        <td style="white-space:nowrap;color:var(--text-secondary);font-size:0.86rem;">${formatDateBR(os.dataOrdem)}</td>
        <td style="min-width:180px;">
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:0.86rem;flex:1;">${modelsText || '<span class="text-muted">Sem modelos</span>'}</span>
              <svg id="os-chevron-${safeId}" style="width:14px;height:14px;flex-shrink:0;color:var(--text-tertiary);transition:transform 0.25s;transform:rotate(0deg);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="flex:1;height:3px;background:hsla(220,22%,20%,1);border-radius:2px;overflow:hidden;min-width:50px;">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.4s;"></div>
              </div>
              <span style="font-size:0.7rem;color:var(--text-secondary);white-space:nowrap;">${doneItems}/${totalItems} (${totalQty} un)</span>
            </div>
          </div>
        </td>
        <td>
          <strong style="font-size:0.95rem;">${formatCurrency(os.valorTotal)}</strong>
          ${terceirosNote}
        </td>
        <td><span class="badge ${payBadgeClass}">${os.estadoPagamento}</span></td>
        <td><span class="badge ${prodBadgeClass}">${prodLabel}</span></td>
        <td onclick="event.stopPropagation()">
          <div class="table-actions">
            <button class="action-btn" onclick="viewOSDetails('${os.id}')" title="Imprimir / Detalhes"><i data-lucide="printer"></i></button>
            <button class="action-btn" onclick="editOS('${os.id}')" title="Editar"><i data-lucide="edit-3"></i></button>
            <button class="action-btn btn-delete" onclick="deleteOS('${os.id}')" title="Excluir OS"><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
      <tr class="os-expand-row hidden" id="os-expand-${safeId}">
        <td colspan="7" style="padding:0;">
          <div class="os-expand-content" id="os-expand-content-${safeId}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-tertiary);">Aeronaves desta ordem</span>
              <div style="flex:1;height:1px;background:var(--border-subtle);"></div>
              <span style="font-size:0.7rem;color:var(--text-tertiary);">${totalItems} ${totalItems === 1 ? 'item' : 'itens'} Â· ${totalQty} unidades</span>
            </div>
            ${expandedItemsHTML}
          </div>
        </td>
      </tr>
    `;
  });
  lucide.createIcons();
}

function toggleOSExpand(safeId) {
  const expandRow = document.getElementById('os-expand-' + safeId);
  const chevron = document.getElementById('os-chevron-' + safeId);
  const mainRow = document.getElementById('os-row-' + safeId);
  if (!expandRow) return;

  const isOpen = !expandRow.classList.contains('hidden');

  if (isOpen) {
    expandRow.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (mainRow) mainRow.classList.remove('os-row-expanded');
  } else {
    expandRow.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (mainRow) mainRow.classList.add('os-row-expanded');
  }
}
// ================= OS LAUNCH / EDIT FORM LOGIC =================
function checkOSHasFinancialTransactions(osId) {
  if (!state.depositos || state.depositos.length === 0) return false;
  return state.depositos.some(dep =>
    dep.alocacoes && dep.alocacoes.some(al => al.osId === osId)
  );
}

function openOSForm(osId = null) {
  // Clear any existing active rows
  document.getElementById('os-items-container').innerHTML = '';
  document.getElementById('os-form').reset();
  document.getElementById('os-edit-id').value = '';

  // Fill dropdowns
  updateClientDropdowns();
  updateSupplierDropdowns();

  // Default values
  document.getElementById('os-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('os-data-limite').value = '';
  document.getElementById('os-valor-terceiros').value = "0.00";
  document.getElementById('os-valor-frete').value = "0.00";
  document.getElementById('os-responsavel-frete').value = 'minha-conta';
  document.getElementById('os-pagamento').value = 'Pendente';
  document.getElementById('os-origem').value = 'WhatsApp';
  document.getElementById('os-subcliente').value = '';
  document.getElementById('os-observacoes').value = '';

  const formTitle = document.getElementById('os-form-title');
  const cardForm = document.getElementById('os-form-card');

  if (osId) {
    // EDIT MODE
    const os = state.ordens.find(o => o.id === osId);
    if (!os) return;

    formTitle.innerText = `Editar Ordem de Serviço - ${os.id}`;
    document.getElementById('os-edit-id').value = os.id;
    document.getElementById('os-cliente').value = os.clienteId;
    document.getElementById('os-data').value = os.dataOrdem;
    document.getElementById('os-data-limite').value = os.dataLimite || '';
    document.getElementById('os-pagamento').value = os.estadoPagamento;
    document.getElementById('os-origem').value = os.origem || 'WhatsApp';
    document.getElementById('os-subcliente').value = os.subcliente || '';
    document.getElementById('os-fornecedor').value = os.fornecedorTerceirosId || "";
    document.getElementById('os-valor-terceiros').value = os.valorTerceiros || 0;
    document.getElementById('os-valor-frete').value = os.valorFrete || 0;
    document.getElementById('os-responsavel-frete').value = os.responsavelFrete || 'minha-conta';
    document.getElementById('os-observacoes').value = os.observacoes || '';

    // Add existing items
    if (os.itens) {
      os.itens.forEach(item => {
        addOSItemRow(item);
      });
    }
  } else {
    // CREATE MODE
    formTitle.innerText = "Nova Ordem de Serviço";
    // Add 1 blank item row to start
    addOSItemRow();
  }

  const pagSelect = document.getElementById('os-pagamento');
  let hasTx = false;

  if (osId) {
    hasTx = checkOSHasFinancialTransactions(osId);
  }

  pagSelect.disabled = hasTx;
  if (hasTx) {
    pagSelect.setAttribute('data-has-tx', 'true');
  } else {
    pagSelect.removeAttribute('data-has-tx');
  }

  cardForm.classList.remove('hidden');
  toggleOSFormLock();
  cardForm.scrollIntoView({ behavior: 'smooth' });
  calculateOSTotals();
}

function toggleOSFormLock() {
  const pagSelect = document.getElementById('os-pagamento');
  const status = pagSelect.value;
  const isLocked = (status !== 'Pendente');
  const hasTx = pagSelect.hasAttribute('data-has-tx');

  const btnAddItem = document.getElementById('add-item-btn');
  const inputFrete = document.getElementById('os-valor-frete');
  const inputTerceiros = document.getElementById('os-valor-terceiros');
  const selRespFrete = document.getElementById('os-responsavel-frete');
  const selFornecedor = document.getElementById('os-fornecedor');

  if (btnAddItem) btnAddItem.disabled = isLocked;
  if (inputFrete) inputFrete.disabled = isLocked;
  if (inputTerceiros) inputTerceiros.disabled = isLocked;
  if (selRespFrete) selRespFrete.disabled = isLocked;
  if (selFornecedor) selFornecedor.disabled = isLocked;

  const warningBanner = document.getElementById('os-locked-warning');
  const warningText = document.getElementById('os-locked-warning-text');
  if (warningBanner && warningText) {
    if (isLocked) {
      warningBanner.style.display = 'flex';
      if (hasTx) {
        warningText.innerHTML = `<strong>Ordem de Serviço Bloqueada</strong><br>
          Esta OS possui transações financeiras vinculadas. Para alterar valores ou itens, você deve primeiro remover as alocações da OS no módulo Financeiro.`;
      } else {
        warningText.innerHTML = `<strong>Ordem de Serviço Bloqueada</strong><br>
          Esta OS já possui pagamentos. Para alterar valores, adicionar ou remover itens, mude o Estado de Pagamento para <strong>Pendente</strong>.`;
      }
    } else {
      warningBanner.style.display = 'none';
    }
  }

  // Lock item rows
  const itemsContainer = document.getElementById('os-items-container');
  if (itemsContainer) {
    const rows = itemsContainer.querySelectorAll('.os-item-card');
    rows.forEach(row => {
      const btnDelete = row.querySelector('.btn-delete');
      if (btnDelete) {
        btnDelete.style.display = isLocked ? 'none' : 'inline-flex';
      }

      // disable everything except estado
      row.querySelectorAll('input, select, button').forEach(el => {
        if (!el.classList.contains('os-item-estado') && !el.classList.contains('btn-delete')) {
          el.disabled = isLocked;
        }
      });

      // if unlocking, we still might need to keep variant select disabled if no model is selected
      if (!isLocked) {
        const modelSel = row.querySelector('.os-item-model-select');
        const varSel = row.querySelector('.os-item-variant-select');
        if (modelSel && varSel && (!modelSel.value || modelSel.value === "")) {
          varSel.disabled = true;
        }
      }
    });
  }
}

function closeOSForm() {
  document.getElementById('os-form-card').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function addOSItemRow(itemData = null) {
  const container = document.getElementById('os-items-container');
  const rowCount = container.children.length;
  const rowId = `os-item-row-${rowCount}-${Date.now()}`;

  const rowDiv = document.createElement('div');
  rowDiv.className = 'os-item-card';
  rowDiv.id = rowId;

  // Model Select Options
  let modelOptions = '<option value="">Selecione a Aeronave</option>';
  const modelosList = state.modelos || [];
  [...modelosList].sort((a, b) => (a.nome || '').localeCompare(b.nome || '')).forEach(m => {
    if (m) {
      modelOptions += `<option value="${m.id}">${m.nome}</option>`;
    }
  });

  rowDiv.innerHTML = `
    <div class="os-item-card-header">
      <span class="os-item-number">Item #${rowCount + 1}</span>
      <button type="button" class="action-btn btn-delete btn-sm" onclick="removeOSItemRow('${rowId}')" title="Remover Item">
        <i data-lucide="trash-2"></i> Remover
      </button>
    </div>
    <div class="os-item-grid">
      <div class="form-group" style="grid-column: span 6;">
        <label>Aeronave *</label>
        <div class="input-group">
          <select class="os-item-model-select" required>
            ${modelOptions}
          </select>
          <button type="button" class="btn btn-secondary btn-square-icon btn-sm" onclick="quickAddModalFromItemRow('${rowId}')" title="Cadastrar Nova Aeronave">
            <i data-lucide="plus"></i>
          </button>
        </div>
      </div>
      <div class="form-group" style="grid-column: span 6;">
        <label>Tamanho / Variante *</label>
        <div class="input-group">
          <select class="os-item-variant-select" required disabled>
            <option value="">Selecione primeiro a Aeronave</option>
          </select>
          <button type="button" class="btn btn-secondary btn-square-icon btn-sm os-item-add-variant-btn" onclick="openQuickVariantModal('${rowId}')" title="Adicionar Nova Variação" disabled>
            <i data-lucide="plus"></i>
          </button>
        </div>
      </div>
      <div class="form-group" style="grid-column: span 2;">
        <label>Qtd *</label>
        <input type="number" class="os-item-qtd" min="1" value="1" required>
      </div>
      <div class="form-group" style="grid-column: span 2;">
        <label>Matrícula</label>
        <input type="text" class="os-item-matricula" placeholder="Ex: PT-ABC">
      </div>
      <div class="form-group" style="grid-column: span 2;">
        <label>Vlr. Unitário (R$) *</label>
        <input type="number" class="os-item-valor-unitario" step="0.01" min="0" placeholder="130,00" required>
      </div>
      
      <div class="form-group" style="grid-column: span 4;">
        <label>Material *</label>
        <select class="os-item-material" required>
          <option value="">-- Selecionar --</option>
          <option value="ABS">ABS</option>
          <option value="RESINA">RESINA</option>
          <option value="RESINA + ABS">RESINA + ABS</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 4;">
        <label>Acabamento *</label>
        <select class="os-item-acabamento" required>
          <option value="">-- Selecionar --</option>
          <option value="Modelo Acabado">Modelo Acabado</option>
          <option value="Apenas Impressão 3D">Apenas Impressão 3D</option>
        </select>
      </div>
      <div class="form-group" style="grid-column: span 4;">
        <label>Status Produção</label>
        <select class="os-item-estado">
          <option value="Pendente" selected>Pendente</option>
          <option value="Em Andamento">Em Andamento</option>
          <option value="Finalizado">Finalizado</option>
        </select>
      </div>
      
      <div class="form-group" style="grid-column: span 3; display: flex; align-items: flex-end;">
        <div class="checkbox-group" style="height: 44px; margin-bottom: 0;">
          <input type="checkbox" class="os-item-arquivo-novo" id="chk-file-${rowId}">
          <label for="chk-file-${rowId}">Arquivo novo?</label>
        </div>
      </div>
      <div class="form-group" style="grid-column: span 3; display: flex; align-items: flex-end;">
        <div class="checkbox-group" style="height: 44px; margin-bottom: 0;">
          <input type="checkbox" class="os-item-dividir-custo" id="chk-split-${rowId}">
          <label for="chk-split-${rowId}">Dividir Arquivo (50%)</label>
        </div>
      </div>
      <div class="form-group" style="grid-column: span 3;">
        <label style="font-size:0.75rem;">Valor Arquivo (R$)</label>
        <input type="number" class="os-item-valor-arquivo-item" step="0.01" min="0" value="0.00" style="padding: 10px; background-color: var(--bg-body); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-main); font-size:0.85rem; width:100%;">
      </div>
      <div class="form-group" style="grid-column: span 3;">
        <label style="font-size:0.75rem;">Custo Produção (R$) *</label>
        <input type="number" class="os-item-custo-producao" step="0.01" min="0" placeholder="35.00" required style="padding: 10px; background-color: var(--bg-body); border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-main); font-size:0.85rem; width:100%;">
      </div>
    </div>
  `;

  container.appendChild(rowDiv);
  lucide.createIcons();

  // Attach event hooks for dynamic recalculation
  const selectModel = rowDiv.querySelector('.os-item-model-select');
  const selectVariant = rowDiv.querySelector('.os-item-variant-select');
  const checkArquivo = rowDiv.querySelector('.os-item-arquivo-novo');
  const checkSplit = rowDiv.querySelector('.os-item-dividir-custo');
  const inputQtd = rowDiv.querySelector('.os-item-qtd');
  const inputVlrUnit = rowDiv.querySelector('.os-item-valor-unitario');
  const inputValArq = rowDiv.querySelector('.os-item-valor-arquivo-item');

  selectModel.addEventListener('change', () => {
    onModelChange(rowId);
  });
  selectVariant.addEventListener('change', () => {
    onVariantChange(rowId);
  });
  checkArquivo.addEventListener('change', () => {
    updateArquivoFieldsState(rowDiv);
    calculateOSTotals();
  });
  checkSplit.addEventListener('change', calculateOSTotals);
  inputQtd.addEventListener('input', calculateOSTotals);
  inputVlrUnit.addEventListener('input', calculateOSTotals);
  inputValArq.addEventListener('input', calculateOSTotals);

  // Load existing item details if editing
  if (itemData) {
    selectModel.value = itemData.modeloId;
    onModelChange(rowId);

    if (itemData.varianteId) {
      selectVariant.value = itemData.varianteId;
    }

    rowDiv.querySelector('.os-item-material').value = itemData.material;
    rowDiv.querySelector('.os-item-acabamento').value = itemData.acabamento;
    inputQtd.value = itemData.quantidade;
    rowDiv.querySelector('.os-item-matricula').value = itemData.matricula || '';
    inputVlrUnit.value = itemData.valorUnitario;
    rowDiv.querySelector('.os-item-estado').value = itemData.estado;
    checkArquivo.checked = itemData.arquivoNovo || false;
    checkSplit.checked = itemData.dividirCusto || false;
    rowDiv.querySelector('.os-item-valor-arquivo-item').value = (itemData.valorArquivoItem || 0).toFixed(2);
    rowDiv.querySelector('.os-item-custo-producao').value = (itemData.custoProducao || 0).toFixed(2);
  }

  // Always update fields state based on check state
  updateArquivoFieldsState(rowDiv);
}

// Update file cost field state (enabled/disabled) based on whether it is a new file
function updateArquivoFieldsState(row) {
  const checkArquivo = row.querySelector('.os-item-arquivo-novo');
  const checkSplit = row.querySelector('.os-item-dividir-custo');
  const inputValArq = row.querySelector('.os-item-valor-arquivo-item');

  if (checkArquivo.checked) {
    inputValArq.removeAttribute('disabled');
    inputValArq.style.opacity = '1';
    inputValArq.style.cursor = 'auto';

    checkSplit.removeAttribute('disabled');

    // If the value is 0 and we have a model selected, populate with model's file value
    const modelId = row.querySelector('.os-item-model-select').value;
    const model = state.modelos.find(m => m.id === modelId);
    if (model && (parseFloat(inputValArq.value) === 0 || !inputValArq.value)) {
      inputValArq.value = (model.valorArquivo || 0).toFixed(2);
    }
  } else {
    inputValArq.value = "0.00";
    inputValArq.setAttribute('disabled', 'true');
    inputValArq.style.opacity = '0.5';
    inputValArq.style.cursor = 'not-allowed';

    checkSplit.checked = false;
    checkSplit.setAttribute('disabled', 'true');
  }
}

function removeOSItemRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) {
    row.remove();
    calculateOSTotals();

    // Rename remaining items number labels
    document.querySelectorAll('.os-items-list .os-item-card').forEach((card, index) => {
      card.querySelector('.os-item-number').innerText = `Item #${index + 1}`;
    });
  }
}

// Triggered when a model is selected inside the items row
function onModelChange(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const modelId = row.querySelector('.os-item-model-select').value;
  const variantSelect = row.querySelector('.os-item-variant-select');
  const model = state.modelos.find(m => m.id === modelId);

  const addVariantBtn = row.querySelector('.os-item-add-variant-btn');

  if (model) {
    row.querySelector('.os-item-valor-arquivo-item').value = (model.valorArquivo || 0).toFixed(2);
    if (addVariantBtn) addVariantBtn.disabled = false;

    if (model.variantes && model.variantes.length > 0) {
      variantSelect.innerHTML = '<option value="">Selecione o Tamanho</option>';
      model.variantes.forEach(v => {
        variantSelect.innerHTML += `<option value="${v.id}">${v.escala || v.comprimento + 'cm'}</option>`;
      });
      variantSelect.disabled = false;
    } else {
      // Legacy fallback
      variantSelect.innerHTML = '<option value="legacy">Modelo Único (Sem Variante)</option>';
      variantSelect.value = "legacy";
      variantSelect.disabled = true;
      onVariantChange(rowId);
    }
  } else {
    variantSelect.innerHTML = '<option value="">Selecione primeiro a Aeronave</option>';
    variantSelect.disabled = true;
    if (addVariantBtn) addVariantBtn.disabled = true;
    row.querySelector('.os-item-material').value = '';
    row.querySelector('.os-item-acabamento').value = '';
    row.querySelector('.os-item-valor-arquivo-item').value = "0.00";
    row.querySelector('.os-item-custo-producao').value = "0.00";
  }
  updateArquivoFieldsState(row);
  calculateOSTotals();
}

function onVariantChange(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const modelId = row.querySelector('.os-item-model-select').value;
  const variantId = row.querySelector('.os-item-variant-select').value;
  const model = state.modelos.find(m => m.id === modelId);

  if (model) {
    let variant = null;
    if (model.variantes && model.variantes.length > 0) {
      variant = model.variantes.find(v => v.id === variantId);
    } else {
      // Legacy fallback
      variant = {
        materialPadrao: model.materialPadrao,
        acabamentoPadrao: model.acabamentoPadrao,
        precoBase: model.precoBase,
        custoProducao: model.custoProducao
      };
    }

    if (variant) {
      row.querySelector('.os-item-material').value = variant.materialPadrao || '';
      row.querySelector('.os-item-acabamento').value = variant.acabamentoPadrao || '';
      row.querySelector('.os-item-valor-unitario').value = (variant.precoBase || 130.00).toFixed(2);
      row.querySelector('.os-item-custo-producao').value = (variant.custoProducao || 35.00).toFixed(2);
    }
  }
  calculateOSTotals();
}

// Intermediary hook to allow adding a model inside the row, keeping row reference
function quickAddModalFromItemRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) {
    activeModelSelectElement = row.querySelector('.os-item-model-select');
    openModal('model');
  }
}

// Opens a quick variant creation modal from inside the OS form
function openQuickVariantModal(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const modelId = row.querySelector('.os-item-model-select').value;
  if (!modelId) {
    alert('Selecione uma Aeronave primeiro.');
    return;
  }

  const model = state.modelos.find(m => m.id === modelId);
  if (!model) return;

  // Remove any existing quick variant modal
  const existing = document.getElementById('modal-quick-variant-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-quick-variant-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000; padding: 16px; backdrop-filter: blur(4px);
  `;

  overlay.innerHTML = `
    <div style="background: var(--bg-card); border: 1px solid var(--border-default); border-radius: 14px;
                width: 100%; max-width: 480px; box-shadow: var(--shadow-lg); overflow: hidden;">
      
      <!-- Header -->
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-subtle);
                  display: flex; justify-content: space-between; align-items: center;
                  background: linear-gradient(135deg, rgba(241,160,0,0.08), transparent);">
        <div>
          <h3 style="font-size: 1rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">
            <i data-lucide="plus-circle" style="width:18px;height:18px;color:var(--border-focus);"></i>
            Nova Variação
          </h3>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
            Aeronave: <strong style="color: var(--text-primary);">${model.nome}</strong>
          </p>
        </div>
        <button onclick="document.getElementById('modal-quick-variant-overlay').remove()"
                style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:4px;">
          <i data-lucide="x" style="width:20px;height:20px;"></i>
        </button>
      </div>

      <!-- Body -->
      <div style="padding: 20px; display: flex; flex-direction: column; gap: 14px;">
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Escala / Tamanho *</label>
            <input type="text" id="qv-escala" placeholder="Ex: 1:32 ou 45cm" autofocus
                   style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
          </div>
          <div class="form-group">
            <label>Material</label>
            <select id="qv-material" style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
              <option value="">-- Selecionar --</option>
              <option value="ABS">ABS</option>
              <option value="RESINA">RESINA</option>
              <option value="RESINA + ABS">RESINA + ABS</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Comprimento (cm)</label>
            <input type="number" id="qv-comprimento" step="0.1" placeholder="0"
                   style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
          </div>
          <div class="form-group">
            <label>Envergadura (cm)</label>
            <input type="number" id="qv-envergadura" step="0.1" placeholder="0"
                   style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Custo Produção (R$)</label>
            <input type="number" id="qv-custo" step="0.01" placeholder="0,00"
                   style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
          </div>
          <div class="form-group">
            <label>Preço Base (R$)</label>
            <input type="number" id="qv-preco" step="0.01" placeholder="0,00"
                   style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Acabamento</label>
            <select id="qv-acabamento" style="padding: 9px 12px; background: var(--bg-input); border: 1px solid var(--border-default); border-radius: 8px; color: #fff; width: 100%;">
              <option value="">-- Selecionar --</option>
              <option value="Modelo Acabado">Modelo Acabado</option>
              <option value="Apenas Impressão 3D">Apenas Impressão 3D</option>
            </select>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 20px; border-top: 1px solid var(--border-subtle);
                  display: flex; gap: 10px; justify-content: flex-end;">
        <button onclick="document.getElementById('modal-quick-variant-overlay').remove()"
                class="btn btn-secondary">Cancelar</button>
        <button onclick="saveQuickVariant('${modelId}', '${rowId}')"
                class="btn btn-primary" style="background: var(--gradient-primary); color: #000; font-weight: 700;">
          <i data-lucide="save" style="width:15px;height:15px;"></i> Salvar Variação
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  lucide.createIcons();

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Focus escala input
  setTimeout(() => document.getElementById('qv-escala')?.focus(), 100);
}

function saveQuickVariant(modelId, rowId) {
  const escala = document.getElementById('qv-escala')?.value.trim();
  if (!escala) {
    alert('Informe a Escala/Tamanho da variação.');
    document.getElementById('qv-escala')?.focus();
    return;
  }

  const newVariant = {
    id: 'var_' + Date.now() + Math.floor(Math.random() * 1000),
    escala,
    comprimento: parseFloat(document.getElementById('qv-comprimento')?.value) || 0,
    envergadura: parseFloat(document.getElementById('qv-envergadura')?.value) || 0,
    materialPadrao: document.getElementById('qv-material')?.value || '',
    acabamentoPadrao: document.getElementById('qv-acabamento')?.value || '',
    custoProducao: parseFloat(document.getElementById('qv-custo')?.value) || 0,
    precoBase: parseFloat(document.getElementById('qv-preco')?.value) || 0
  };

  // Save to the model in state
  const modelIndex = state.modelos.findIndex(m => m.id === modelId);
  if (modelIndex === -1) return;

  if (!state.modelos[modelIndex].variantes) {
    state.modelos[modelIndex].variantes = [];
  }
  state.modelos[modelIndex].variantes.push(newVariant);
  saveToLocalStorage();

  // Close the modal
  document.getElementById('modal-quick-variant-overlay')?.remove();

  // Refresh the variant dropdown in the OS form row and select the new one
  const row = document.getElementById(rowId);
  if (row) {
    const variantSelect = row.querySelector('.os-item-variant-select');
    const model = state.modelos[modelIndex];

    variantSelect.innerHTML = '<option value="">Selecione o Tamanho</option>';
    model.variantes.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.escala || (v.comprimento + 'cm');
      variantSelect.appendChild(opt);
    });
    variantSelect.disabled = false;
    variantSelect.value = newVariant.id;
    variantSelect.dispatchEvent(new Event('change'));
  }
}


function calculateOSTotals() {
  let subtotal = 0;
  let totalArquivosDivididos = 0;
  let custoTotalArquivos = 0;
  let totalCustoProducao = 0;

  const itemsContainer = document.getElementById('os-items-container');
  const rows = itemsContainer.querySelectorAll('.os-item-card');

  rows.forEach(row => {
    const qtd = parseInt(row.querySelector('.os-item-qtd').value) || 0;
    const unitPrice = parseFloat(row.querySelector('.os-item-valor-unitario').value) || 0;
    const custoProd = parseFloat(row.querySelector('.os-item-custo-producao').value) || 0;

    // Subtotal models
    subtotal += (qtd * unitPrice);

    // Production cost
    totalCustoProducao += (qtd * custoProd);

    // File costs
    const isNewFile = row.querySelector('.os-item-arquivo-novo').checked;
    const isSplitCost = row.querySelector('.os-item-dividir-custo').checked;
    const filePrice = parseFloat(row.querySelector('.os-item-valor-arquivo-item').value) || 0;

    if (isNewFile) {
      custoTotalArquivos += filePrice;
      if (isSplitCost) {
        totalArquivosDivididos += (filePrice / 2);
      }
    }
  });

  const costTerceiros = parseFloat(document.getElementById('os-valor-terceiros').value) || 0;
  const valorFrete = parseFloat(document.getElementById('os-valor-frete').value) || 0;
  const responsavelFrete = document.getElementById('os-responsavel-frete').value;

  // How much of frete is charged to client (adds to total)
  let freteParaCliente = 0;
  // How much of frete is my cost (reduces profit)
  let freteMeuCusto = 0;

  if (responsavelFrete === 'cliente') {
    freteParaCliente = valorFrete;
    freteMeuCusto = 0;
  } else if (responsavelFrete === 'dividido') {
    freteParaCliente = parseFloat((valorFrete / 2).toFixed(2));
    freteMeuCusto = parseFloat((valorFrete / 2).toFixed(2));
  } else { // minha-conta
    freteParaCliente = 0;
    freteMeuCusto = valorFrete;
  }

  const grandTotal = subtotal + totalArquivosDivididos + freteParaCliente;

  // Total cost/investment to the user
  const totalCustoArquivosUsuario = custoTotalArquivos - totalArquivosDivididos;
  const custoInvestimentoTotal = totalCustoProducao + costTerceiros + totalCustoArquivosUsuario + freteMeuCusto;

  const lucro = grandTotal - custoInvestimentoTotal;
  const margem = grandTotal > 0 ? (lucro / grandTotal) * 100 : 0;

  // Render text values
  document.getElementById('summary-subtotal').innerText = formatCurrency(subtotal);
  document.getElementById('summary-arquivos').innerText = formatCurrency(custoTotalArquivos);
  document.getElementById('summary-terceiros').innerText = formatCurrency(costTerceiros);

  // Show frete row in sidebar only when there is a frete value
  const freteRow = document.getElementById('summary-frete-row');
  const freteLabel = document.getElementById('summary-frete-label');
  const freteSpan = document.getElementById('summary-frete');
  if (valorFrete > 0) {
    freteRow.style.display = '';
    if (responsavelFrete === 'cliente') {
      freteLabel.innerText = 'Frete (cliente paga):';
      freteSpan.innerText = formatCurrency(freteParaCliente);
      freteSpan.style.color = 'var(--color-success)';
    } else if (responsavelFrete === 'dividido') {
      freteLabel.innerText = 'Frete dividido (cobrado):';
      freteSpan.innerText = `+${formatCurrency(freteParaCliente)}`;
      freteSpan.style.color = 'var(--color-warning, #f59e0b)';
    } else {
      freteLabel.innerText = 'Frete (minha conta):';
      freteSpan.innerText = formatCurrency(valorFrete);
      freteSpan.style.color = 'var(--color-danger)';
    }
  } else {
    freteRow.style.display = 'none';
  }

  document.getElementById('summary-custo-total').innerText = formatCurrency(custoInvestimentoTotal);

  const lucroEl = document.getElementById('summary-lucro');
  lucroEl.innerText = formatCurrency(lucro);
  lucroEl.style.color = lucro >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

  const margemEl = document.getElementById('summary-margem');
  margemEl.innerText = `${margem.toFixed(1)}%`;
  margemEl.style.color = margem >= 30 ? 'var(--color-success)' : (margem >= 0 ? 'var(--border-focus)' : 'var(--color-danger)');

  document.getElementById('summary-total').innerText = formatCurrency(grandTotal);
}

// Save Ordem de Serviço Form
function saveOS(e) {
  e.preventDefault();

  const editId = document.getElementById('os-edit-id').value;
  const clienteId = document.getElementById('os-cliente').value;
  const dataOrdem = document.getElementById('os-data').value;
  const dataLimite = document.getElementById('os-data-limite').value;
  const estadoPagamento = document.getElementById('os-pagamento').value;
  const origem = document.getElementById('os-origem').value;
  const subcliente = document.getElementById('os-subcliente').value.trim();
  const fornecedorTerceirosId = document.getElementById('os-fornecedor').value;
  const valorTerceiros = parseFloat(document.getElementById('os-valor-terceiros').value) || 0;
  const valorFrete = parseFloat(document.getElementById('os-valor-frete').value) || 0;
  const responsavelFrete = document.getElementById('os-responsavel-frete').value;
  const observacoes = document.getElementById('os-observacoes').value.trim();

  // Calculate frete portion charged to client
  let freteParaCliente = 0;
  if (responsavelFrete === 'cliente') {
    freteParaCliente = valorFrete;
  } else if (responsavelFrete === 'dividido') {
    freteParaCliente = parseFloat((valorFrete / 2).toFixed(2));
  }

  if (!clienteId) {
    alert("Por favor, selecione um cliente.");
    return;
  }

  // Get items
  const itemsContainer = document.getElementById('os-items-container');
  const itemCards = itemsContainer.querySelectorAll('.os-item-card');

  if (itemCards.length === 0) {
    alert("Adicione pelo menos 1 modelo na ordem de serviço.");
    return;
  }

  const itens = [];
  let calculatedGrandTotal = 0;

  for (let card of itemCards) {
    const modeloId = card.querySelector('.os-item-model-select').value;
    const varianteId = card.querySelector('.os-item-variant-select').value;
    const material = card.querySelector('.os-item-material').value;
    const acabamento = card.querySelector('.os-item-acabamento').value;
    const quantidade = parseInt(card.querySelector('.os-item-qtd').value) || 1;
    const matricula = card.querySelector('.os-item-matricula').value.trim() || 'N/A';
    const valorUnitario = parseFloat(card.querySelector('.os-item-valor-unitario').value) || 0;
    const custoProducao = parseFloat(card.querySelector('.os-item-custo-producao').value) || 0;
    const estado = card.querySelector('.os-item-estado').value;
    const arquivoNovo = card.querySelector('.os-item-arquivo-novo').checked;
    const dividirCusto = card.querySelector('.os-item-dividir-custo').checked;
    const valorArquivoItem = parseFloat(card.querySelector('.os-item-valor-arquivo-item').value) || 0;

    if (!modeloId || (!varianteId && card.querySelector('.os-item-variant-select').disabled === false)) {
      alert("Por favor, selecione o modelo e o tamanho para todos os itens.");
      return;
    }

    itens.push({
      modeloId,
      varianteId,
      material,
      acabamento,
      quantidade,
      matricula,
      valorUnitario,
      custoProducao,
      estado,
      arquivoNovo,
      dividirCusto,
      valorArquivoItem
    });

    calculatedGrandTotal += (quantidade * valorUnitario);
    if (arquivoNovo && dividirCusto) {
      calculatedGrandTotal += (valorArquivoItem / 2);
    }
  }

  // Add frete charged to client to the total
  calculatedGrandTotal += freteParaCliente;

  if (editId) {
    // Update existing OS
    const index = state.ordens.findIndex(o => o.id === editId);
    if (index > -1) {
      const existingOS = state.ordens[index];
      let pagoServico = existingOS.pagoServico || 0;
      let pagoArquivo = existingOS.pagoArquivo || 0;
      let pagoTerceiros = 0;

      // Calculate totals for each category in the edited items
      let subtotalModelos = 0;
      let subtotalArquivos = 0;
      itens.forEach(item => {
        subtotalModelos += (item.quantidade * item.valorUnitario);
        if (item.arquivoNovo && item.dividirCusto) {
          subtotalArquivos += (item.valorArquivoItem / 2);
        }
      });

      // If they manually set to Pago:
      if (estadoPagamento === 'Pago') {
        pagoServico = subtotalModelos + freteParaCliente;
        pagoArquivo = subtotalArquivos;
        pagoTerceiros = 0;
      } else if (estadoPagamento === 'Pendente') {
        pagoServico = 0;
        pagoArquivo = 0;
        pagoTerceiros = 0;
      } else {
        // If it's Pago Parcial, clamp the paid values to the new totals.
        // If they had paid nothing (current paid is 0), default to 50% paid (sinal).
        const currentPaid = pagoServico + pagoArquivo;
        if (currentPaid <= 0.01) {
          pagoServico = parseFloat((subtotalModelos * 0.5).toFixed(2));
          pagoArquivo = parseFloat((subtotalArquivos * 0.5).toFixed(2));
          pagoTerceiros = 0;
        } else {
          pagoServico = Math.min(pagoServico, subtotalModelos + freteParaCliente);
          pagoArquivo = Math.min(pagoArquivo, subtotalArquivos);
          pagoTerceiros = 0;
        }
      }

      state.ordens[index].clienteId = clienteId;
      state.ordens[index].dataOrdem = dataOrdem;
      state.ordens[index].dataLimite = dataLimite;
      state.ordens[index].estadoPagamento = estadoPagamento;
      state.ordens[index].origem = origem;
      state.ordens[index].subcliente = subcliente;
      state.ordens[index].fornecedorTerceirosId = fornecedorTerceirosId;
      state.ordens[index].valorTerceiros = valorTerceiros;
      state.ordens[index].valorFrete = valorFrete;
      state.ordens[index].responsavelFrete = responsavelFrete;
      state.ordens[index].itens = itens;
      state.ordens[index].valorTotal = calculatedGrandTotal;
      state.ordens[index].observacoes = observacoes;
      state.ordens[index].pagoServico = pagoServico;
      state.ordens[index].pagoArquivo = pagoArquivo;
      state.ordens[index].pagoTerceiros = pagoTerceiros;

      recalculateOSPaymentStatus(state.ordens[index]);
    }
  } else {
    // Generate code OS-YYYY-XXXX (padded sequencially)
    const year = new Date(dataOrdem).getFullYear();
    const countThisYear = state.ordens.filter(o => o.id.startsWith(`OS-${year}-`)).length + 1;
    const code = `OS-${year}-${String(countThisYear).padStart(4, '0')}`;

    let subtotalModelos = 0;
    let subtotalArquivos = 0;
    itens.forEach(item => {
      subtotalModelos += (item.quantidade * item.valorUnitario);
      if (item.arquivoNovo && item.dividirCusto) {
        subtotalArquivos += (item.valorArquivoItem / 2);
      }
    });

    let pagoServico = 0;
    let pagoArquivo = 0;
    let pagoTerceiros = 0;

    if (estadoPagamento === 'Pago') {
      pagoServico = subtotalModelos + freteParaCliente;
      pagoArquivo = subtotalArquivos;
      pagoTerceiros = 0;
    } else if (estadoPagamento === 'Pendente') {
      pagoServico = 0;
      pagoArquivo = 0;
      pagoTerceiros = 0;
    } else if (estadoPagamento === 'Pago Parcial') {
      pagoServico = parseFloat((subtotalModelos * 0.5).toFixed(2));
      pagoArquivo = parseFloat((subtotalArquivos * 0.5).toFixed(2));
      pagoTerceiros = 0;
    } else {
      pagoServico = 0;
      pagoArquivo = 0;
      pagoTerceiros = 0;
    }

    const newOS = {
      id: code,
      clienteId,
      dataOrdem,
      dataLimite,
      estadoPagamento,
      origem,
      subcliente,
      fornecedorTerceirosId,
      valorTerceiros,
      valorFrete,
      responsavelFrete,
      itens,
      valorTotal: calculatedGrandTotal,
      observacoes,
      pagoServico,
      pagoArquivo,
      pagoTerceiros
    };

    recalculateOSPaymentStatus(newOS);
    state.ordens.push(newOS);
  }

  saveToLocalStorage();
  closeOSForm();
  renderOSList();
}

function deleteOS(osId) {
  const os = state.ordens.find(o => o.id === osId);
  if (!os) return;

  // Verifica se há movimentação de produção (algum item com estado diferente de "Pendente")
  const temMovimentacaoProducao = os.itens.some(item => item.estado && item.estado !== 'Pendente');

  // Verifica se há movimentação financeira (estado de pagamento diferente de "Pendente")
  const temMovimentacaoFinanceira = os.estadoPagamento && os.estadoPagamento !== 'Pendente';

  if (temMovimentacaoProducao || temMovimentacaoFinanceira) {
    showToast('Não é possível excluir esta OS pois ela já possui movimentação (produção iniciada ou pagamento registrado).', 'error');
    return;
  }

  if (confirm(`Tem certeza que deseja excluir permanentemente a OS ${osId}?`)) {
    state.ordens = state.ordens.filter(o => o.id !== osId);
    saveToLocalStorage();
    renderOSList();
    showToast('Ordem de Serviço excluída com sucesso!', 'success');
  }
}

// Edit existing OS from list
function editOS(osId) {
  switchTab('ordens');
  openOSForm(osId);
}

// ================= RENDERING: DETALHE DA OS & IMPRESSÃO =================
function viewOSDetails(osId) {
  const os = state.ordens.find(o => o.id === osId);
  if (!os) return;

  const client = state.clientes.find(c => c.id === os.clienteId);
  let clientName = client ? client.nome : 'Cliente Desconhecido';
  if (os.subcliente) {
    clientName += ` (${os.subcliente})`;
  }
  const clientPhone = client ? client.telefone || 'Não informado' : 'Não informado';
  const clientEmail = client ? client.email || 'Não informado' : 'Não informado';

  const supplier = state.fornecedores.find(s => s.id === os.fornecedorTerceirosId);
  const supplierName = supplier ? supplier.nome : 'Nenhum';

  // Build items rows
  let itemsRows = '';
  let subtotalModelos = 0;
  let subtotalArquivos = 0;

  os.itens.forEach((item, index) => {
    const model = state.modelos.find(m => m.id === item.modeloId);
    let variant = null;
    if (model && model.variantes) {
      variant = model.variantes.find(v => v.id === item.varianteId);
    }
    const modelName = model ? model.nome : 'Excluído';
    const dimensions = variant
      ? `${variant.comprimento || 0}x${variant.envergadura || 0} cm (${variant.escala || '-'})`
      : (model ? `${model.comprimento || 0}x${model.envergadura || 0} cm` : 'N/A');

    const sub = item.quantidade * item.valorUnitario;
    subtotalModelos += sub;

    let fileCostStr = 'Não';
    if (item.arquivoNovo) {
      let arqCost = item.valorArquivoItem || 0;
      if (item.dividirCusto) {
        arqCost = arqCost / 2;
        fileCostStr = `Sim (Div. 50%: ${formatCurrency(arqCost)})`;
        subtotalArquivos += arqCost;
      } else {
        fileCostStr = `Investimento AeroPrint (R$ 0,00 cobrado)`;
      }
    }

    itemsRows += `
      <tr>
        <td>#${index + 1}</td>
        <td>
          <strong>${modelName}</strong><br>
          <small class="text-muted">Dimensões: ${dimensions} | Material: ${item.material} | Acabamento: ${item.acabamento}</small>
        </td>
        <td>${item.matricula || 'N/A'}</td>
        <td>${item.quantidade}</td>
        <td>${formatCurrency(item.valorUnitario)}</td>
        <td>${fileCostStr}</td>
        <td><strong>${formatCurrency(sub)}</strong></td>
      </tr>
    `;
  });

  // Recalculate frete charged to client (on-the-fly, in case os.valorTotal is stale)
  const vf = os.valorFrete || 0;
  const rf = os.responsavelFrete || 'minha-conta';
  let freteParaCliente = 0;
  if (rf === 'cliente') freteParaCliente = vf;
  else if (rf === 'dividido') freteParaCliente = parseFloat((vf / 2).toFixed(2));

  const totalPago = (os.pagoServico || 0) + (os.pagoArquivo || 0) + (os.pagoTerceiros || 0);
  // Use recalculated grand total so modal always reflects the real amount
  const grandTotal = subtotalModelos + subtotalArquivos + (os.valorTerceiros || 0) + freteParaCliente;
  const saldoDevedor = Math.max(0, grandTotal - totalPago);

  const printContent = document.getElementById('os-print-content');
  printContent.innerHTML = `
    <!-- Invoice Header -->
    <div class="print-header">
      <div class="print-logo">
        ${(() => {
      const logoUrl = localStorage.getItem('aeroprint_logo_print');
      const companyName = localStorage.getItem('aeroprint_company_name') || 'AeroPrint3D';
      if (logoUrl) {
        return `<img src="${logoUrl}" alt="Logo" style="max-height:60px; max-width:160px; object-fit:contain; display:block;">
                    <span style="font-size:0.85rem; font-weight:600; margin-top:4px; display:block;">${companyName}</span>`;
      } else {
        return `<h2><span style="color:var(--border-focus);">✈</span> ${companyName}</h2>
                    <span>Miniaturas de Aeronaves &amp; Impressão 3D</span>`;
      }
    })()}
      </div>
      <div class="print-meta-right">
        <h3>Ordem de Serviço</h3>
        <p>Código: <strong>${os.id}</strong></p>
        <p>Data de Emissão: ${formatDateBR(os.dataOrdem)}</p>
      </div>
    </div>

    <!-- Client and Provider details -->
    <div class="print-billing-grid">
      <div class="billing-col">
        <h4>Cliente</h4>
        <p>${clientName}</p>
        <span>Telefone: ${clientPhone}</span>
        <span>E-mail: ${clientEmail}</span>
      </div>
      <div class="billing-col">
        <h4>Status do Pedido</h4>
        <p>Pagamento: <strong style="color: var(--color-success);">${os.estadoPagamento}</strong></p>
        <span>Data Limite: Conforme cronograma</span>
        ${os.valorTerceiros > 0 ? `<span>Fornecedor Pintura: ${supplierName}</span>` : ''}
      </div>
    </div>

    <!-- Items table -->
    <table class="print-table">
      <thead>
        <tr>
          <th>ITEM</th>
          <th>MODELO</th>
          <th>PREFIXO</th>
          <th>QTD</th>
          <th>VLR. UNIT</th>
          <th>ARQ. NOVO?</th>
          <th>TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <!-- Totals & Summary -->
    <div class="print-summary-container">
      <div class="print-summary-box">
        <div class="print-summary-row">
          <span>Subtotal Itens:</span>
          <span>${formatCurrency(subtotalModelos)}</span>
        </div>
        <div class="print-summary-row">
          <span>Custos de Arquivos 3D:</span>
          <span>${formatCurrency(subtotalArquivos)}</span>
        </div>
        <div class="print-summary-row">
          <span>Serviços de Terceiros:</span>
          <span>${formatCurrency(0)}</span>
        </div>
        ${(() => {
      const vf = os.valorFrete || 0;
      const rf = os.responsavelFrete || 'minha-conta';
      if (vf > 0 && rf !== 'minha-conta') {
        const freteLabel = rf === 'dividido' ? 'Frete (50% do cliente):' : 'Frete:';
        const freteVal = rf === 'dividido' ? parseFloat((vf / 2).toFixed(2)) : vf;
        return `<div class="print-summary-row"><span>${freteLabel}</span><span>${formatCurrency(freteVal)}</span></div>`;
      }
      return '';
    })()}
        <div class="print-summary-row total-bold">
          <span>VALOR TOTAL:</span>
          <span>${formatCurrency(grandTotal)}</span>
        </div>
        <div class="print-summary-row" style="border-top: 1px dashed var(--border-color); padding-top: 8px; margin-top: 4px;">
          <span>Valor Pago:</span>
          <span>${formatCurrency(totalPago)}</span>
        </div>
        <div class="print-summary-row" style="font-weight: 700; color: ${saldoDevedor > 0.01 ? 'var(--color-danger)' : 'var(--color-success)'};">
          <span>Saldo Restante:</span>
          <span>${formatCurrency(saldoDevedor)}</span>
        </div>
      </div>
    </div>

    <!-- Signature Areas for printing -->
    <div class="print-signatures">
      <div class="signature-line">
        AeroPrint3D (Assinatura)
      </div>
      <div class="signature-line">
        Cliente (${client ? client.nome : 'Cliente'})
      </div>
    </div>
  `;

  // Display details modal
  document.getElementById('modal-os-detail').classList.add('active');
  lucide.createIcons();
}

// ================= RENDERING: CLIENTES =================
function renderClientes() {
  const tableBody = document.getElementById('client-table-body');
  tableBody.innerHTML = '';

  const searchText = document.getElementById('client-search').value.toLowerCase();

  const filtered = state.clientes.filter(c => {
    return c.nome.toLowerCase().includes(searchText) ||
      (c.email && c.email.toLowerCase().includes(searchText)) ||
      (c.telefone && c.telefone.includes(searchText));
  });

  filtered.sort((a, b) => a.nome.localeCompare(b.nome));

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Nenhum cliente cadastrado.</td></tr>`;
    return;
  }

  filtered.forEach(c => {
    tableBody.innerHTML += `
      <tr>
        <td><strong>${c.nome}</strong></td>
        <td>${c.telefone || '<span class="text-muted">Não informado</span>'}</td>
        <td>${c.email || '<span class="text-muted">Não informado</span>'}</td>
        <td>${formatDateBR(c.dataCadastro)}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn" onclick="editEntity('client', '${c.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="action-btn btn-delete" onclick="deleteEntity('client', '${c.id}')" title="excluirá><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
  lucide.createIcons();
}

let currentModelSortCol = 'nome';
let currentModelSortAsc = true;

window.sortModels = function (col) {
  if (currentModelSortCol === col) {
    currentModelSortAsc = !currentModelSortAsc;
  } else {
    currentModelSortCol = col;
    currentModelSortAsc = true;
  }
  renderModelos();
};

// ================= RENDERING: MODELOS =================
function renderModelos() {
  const tableBody = document.getElementById('model-table-body');
  tableBody.innerHTML = '';

  const searchText = document.getElementById('model-search').value.toLowerCase();

  const filtered = state.modelos.filter(m => {
    return m.nome.toLowerCase().includes(searchText) ||
      m.materialPadrao.toLowerCase().includes(searchText);
  });

  filtered.sort((a, b) => {
    let valA = a[currentModelSortCol];
    let valB = b[currentModelSortCol];

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    // Treat undefined/null as empty/0 for comparison
    if (valA == null) valA = typeof valB === 'number' ? 0 : '';
    if (valB == null) valB = typeof valA === 'number' ? 0 : '';

    if (valA < valB) return currentModelSortAsc ? -1 : 1;
    if (valA > valB) return currentModelSortAsc ? 1 : -1;
    return 0;
  });

  // Update header icons
  document.querySelectorAll('#view-produtos th .sort-icon').forEach(icon => {
    icon.classList.add('hidden');
  });
  const activeTh = document.getElementById(`th-sort-${currentModelSortCol}`);
  if (activeTh) {
    const icon = activeTh.querySelector('.sort-icon');
    if (icon) {
      icon.classList.remove('hidden');
      icon.setAttribute('data-lucide', currentModelSortAsc ? 'chevron-up' : 'chevron-down');
    }
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Nenhum modelo cadastrado.</td></tr>`;
    return;
  }

  filtered.forEach(m => {
    let badgesHTML = '<span class="text-muted">-</span>';
    if (m.variantes && m.variantes.length > 0) {
      badgesHTML = m.variantes.map(v => `<span style="display:inline-block; background:rgba(255,255,255,0.1); border:1px solid var(--border-default); padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:4px; margin-bottom:4px;">${v.escala || v.comprimento + 'cm'}</span>`).join('');
    } else if (m.escala) {
      badgesHTML = `<span style="display:inline-block; background:rgba(255,255,255,0.1); border:1px solid var(--border-default); padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-right:4px; margin-bottom:4px;">${m.escala}</span>`;
    }

    tableBody.innerHTML += `
      <tr>
        <td><strong>${m.nome}</strong></td>
        <td>${badgesHTML}</td>
        <td><strong>${formatCurrency(m.valorArquivo)}</strong></td>
        <td>
          <div class="table-actions" style="justify-content: flex-end;">
            <button class="action-btn" onclick="editEntity('model', '${m.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="action-btn" onclick="duplicateModel('${m.id}')" title="Duplicar"><i data-lucide="copy"></i></button>
            <button class="action-btn btn-delete" onclick="deleteEntity('model', '${m.id}')" title="excluirá><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
  lucide.createIcons();
}

// ================= RENDERING: FORNECEDORES =================
function renderFornecedores() {
  const tableBody = document.getElementById('supplier-table-body');
  tableBody.innerHTML = '';

  const searchText = document.getElementById('supplier-search').value.toLowerCase();

  const filtered = state.fornecedores.filter(s => {
    return s.nome.toLowerCase().includes(searchText) ||
      (s.contato && s.contato.toLowerCase().includes(searchText)) ||
      (s.servico && s.servico.toLowerCase().includes(searchText));
  });

  filtered.sort((a, b) => a.nome.localeCompare(b.nome));

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Nenhum fornecedor cadastrado.</td></tr>`;
    return;
  }

  filtered.forEach(s => {
    tableBody.innerHTML += `
      <tr>
        <td><strong>${s.nome}</strong></td>
        <td>${s.contato || '<span class="text-muted">Não informado</span>'}</td>
        <td>${s.telefone || '<span class="text-muted">Não informado</span>'}</td>
        <td>${s.servico || '<span class="text-muted">Não especificado</span>'}</td>
        <td>
          <div class="table-actions">
            <button class="action-btn" onclick="editEntity('supplier', '${s.id}')" title="Editar"><i data-lucide="edit-2"></i></button>
            <button class="action-btn btn-delete" onclick="deleteEntity('supplier', '${s.id}')" title="excluirá><i data-lucide="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
  lucide.createIcons();
}

// General Edit router for modals
function editEntity(type, id) {
  openEditModal(type, id);
}

// General Delete handler
function deleteEntity(type, id) {
  let listName = '';
  let msg = '';

  if (type === 'client') { listName = 'clientes'; msg = 'excluiráeste cliente não removerá as OSs existentes dele, mas o contato sumirá. Confirma?'; }
  if (type === 'supplier') { listName = 'fornecedores'; msg = 'excluiráeste fornecedor?'; }
  if (type === 'model') {
    // Check if any OS is using this model
    let isUsed = false;
    for (const os of state.ordens) {
      if (os.itens && os.itens.some(item => item.modeloId === id)) {
        isUsed = true;
        break;
      }
    }

    if (isUsed) {
      alert('Ação bloqueada: Esta Aeronave (ou uma de suas variantes) já está vinculada a uma Ordem de Serviço.');
      return;
    }

    listName = 'modelos';
    msg = 'excluiráesta Aeronave (incluindo todos os seus tamanhos/variantes)?';
  }

  if (confirm(msg)) {
    state[listName] = state[listName].filter(item => item.id !== id);
    saveToLocalStorage();

    if (type === 'client') renderClientes();
    if (type === 'supplier') renderFornecedores();
    if (type === 'model') renderModelos();
  }
}

// Duplicate Model handler
function duplicateModel(id) {
  const model = state.modelos.find(m => m.id === id);
  if (!model) return;

  const duplicated = {
    ...model,
    id: "mod_" + Date.now(),
    nome: model.nome + " (Cópia)"
  };

  state.modelos.push(duplicated);
  saveToLocalStorage();
  renderModelos();
}

// ================= BACKUP & DATA CONFIGS =================
function setupConfigPage() {
  document.getElementById('import-backup-file').value = '';
  document.getElementById('import-file-name').innerText = "Nenhum arquivo selecionado";
  document.getElementById('import-backup-btn').disabled = true;

  // Render alert settings
  if (typeof renderAlertSettings === 'function') renderAlertSettings();

  // Load OpenAI API Key
  const apiKey = localStorage.getItem('aeroprint_openai_key') || '';
  const apiKeyInput = document.getElementById('settings-openai-key');
  if (apiKeyInput) {
    apiKeyInput.value = apiKey;
  }
}

// Export database state to a JSON file
function exportBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);

  const dateStr = new Date().toISOString().slice(0, 10);
  downloadAnchor.setAttribute("download", `AeroPrint3D_Backup_${dateStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

// Import database from JSON file upload
function importBackup() {
  const fileInput = document.getElementById('import-backup-file');
  if (fileInput.files.length === 0) return;

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const parsed = JSON.parse(e.target.result);

      // Basic validation
      if (parsed.clientes && parsed.fornecedores && parsed.modelos && parsed.ordens) {
        state = parsed;
        migrateDatabase(); // Migrate imported data to the latest version of the database schema and rules
        saveToLocalStorage();
        alert("Banco de dados restaurado com sucesso!");
        switchTab('dashboard');
      } else {
        alert("Formato de backup inválido. Verifique se o arquivo JSON foi gerado por este sistema.");
      }
    } catch (err) {
      alert("Erro ao ler o arquivo JSON. O arquivo pode estar corrompido.");
      console.error(err);
    }
  };

  reader.readAsText(file);
}

// Reset Database to empty state
async function resetDatabase() {
  if (confirm("ATENÇÃO: Isso excluirá TODOS os seus dados salvos neste navegador de forma irreversível. Deseja continuar?")) {
    localStorage.removeItem('aeroprint_db');
    await initDatabase();
    alert("O banco de dados foi limpo e os dados padrão foram recarregados.");
    switchTab('dashboard');
  }
}

// ================= UTILITY FORMATTING HELPERS =================
function formatCurrency(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function formatDateBR(dateString) {
  if (!dateString) return '';
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// ================= CONTROLE DE PRODUÇÃO VIEW RENDER =================
function renderProducao() {
  const container = document.getElementById('producao-cards-container');
  container.innerHTML = '';

  const searchText = document.getElementById('producao-search').value.toLowerCase();
  const filterOnlyActive = document.getElementById('producao-filter-ativas').checked;

  const filtered = state.ordens.filter(os => {
    const client = state.clientes.find(c => c.id === os.clienteId);
    const clientName = client ? client.nome.toLowerCase() : '';
    const osId = os.id.toLowerCase();

    // Text search filter
    const matchesSearch = clientName.includes(searchText) || osId.includes(searchText);

    // Active status filter (hide completed)
    const itemStates = os.itens.map(i => i.estado);
    const isCompleted = itemStates.every(s => s === 'Finalizado') && itemStates.length > 0;
    const matchesActive = !filterOnlyActive || !isCompleted;

    return matchesSearch && matchesActive;
  });

  // ── Priority sort ──────────────────────────────────────────────────
  // 1st: OS with overdue deadline (vencido) — most critical
  // 2nd: OS with deadline within 3 days (urgente)
  // 3rd: Active orders (Pendente / Em Andamento), oldest creation date first
  // 4th: Finished orders, newest first
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const getOSPriority = (os) => {
    const states = os.itens.map(i => i.estado);
    const isFullyDone = states.length > 0 && states.every(s => s === 'Finalizado');
    if (isFullyDone) return 4; // finished: lowest priority

    if (os.dataLimite) {
      const dl = new Date(os.dataLimite + 'T00:00:00');
      const diffDays = Math.floor((dl - today) / 86400000);
      if (diffDays < 0) return 1; // overdue
      if (diffDays <= 3) return 2; // urgent (within 3 days)
    }
    return 3; // active, no urgent deadline
  };

  filtered.sort((a, b) => {
    const pa = getOSPriority(a);
    const pb = getOSPriority(b);
    if (pa !== pb) return pa - pb;
    // Within same priority bucket:
    if (pa === 4) return new Date(b.dataOrdem) - new Date(a.dataOrdem); // finished: newest first
    return new Date(a.dataOrdem) - new Date(b.dataOrdem); // active: oldest first (higher urgency)
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1;" class="text-center text-muted py-5">Nenhuma ordem de serviço ativa encontrada para exibição.</div>`;
    return;
  }

  filtered.forEach(os => {
    const client = state.clientes.find(c => c.id === os.clienteId);
    let clientDisplayName = client ? client.nome : 'Cliente Excluído';
    if (os.subcliente) {
      clientDisplayName += ` (${os.subcliente})`;
    }

    // Calculate finished percentage
    const itemStates = os.itens.map(i => i.estado);
    const totalItens = itemStates.length;
    const finishedItens = itemStates.filter(s => s === 'Finalizado').length;
    const percentage = totalItens > 0 ? Math.round((finishedItens / totalItens) * 100) : 0;

    // Build items rows HTML (Sorted by status: Pendente first, then Em Andamento, then Finalizado)
    const itemRank = { 'Pendente': 1, 'Em Andamento': 2, 'Finalizado': 3 };
    const itemsWithIndex = os.itens.map((item, idx) => ({ item, originalIndex: idx }));
    itemsWithIndex.sort((a, b) => itemRank[a.item.estado] - itemRank[b.item.estado]);

    let itemsHTML = '';
    itemsWithIndex.forEach(({ item, originalIndex }) => {
      const model = state.modelos.find(m => m.id === item.modeloId);
      let variant = null;
      if (model && model.variantes) {
        variant = model.variantes.find(v => v.id === item.varianteId);
      }
      const modelName = model ? model.nome : 'Modelo Excluído';
      const variantName = variant ? ` - ${variant.escala || variant.comprimento + 'cm'}` : '';

      itemsHTML += `
        <div class="prod-item-row" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); border-radius:8px; padding:12px 16px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.05); transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
          <div class="prod-item-info" style="display:flex; flex-direction:column; gap:4px;">
            <span class="prod-item-name" style="font-weight:600; color:var(--text-main); font-size:0.95rem;">${modelName}${variantName} <span style="color:var(--border-focus); font-weight:700;">(x${item.quantidade})</span></span>
            <span class="prod-item-meta" style="font-size:0.75rem; color:var(--text-muted);">Prefixo: <strong style="color:var(--text-secondary);">${item.matricula || 'N/A'}</strong> | ${item.material} | ${item.acabamento}</span>
          </div>
          <div>
            <select class="btn-sm" style="background-color: hsla(224, 20%, 12%, 1); color:var(--text-main); border: 1px solid rgba(255,255,255,0.1); border-radius:6px; font-weight: 500; cursor: pointer; padding:6px 10px; font-size:0.8rem; outline:none; transition:border 0.2s;" onfocus="this.style.borderColor='var(--border-focus)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
              onchange="updateOSItemStatusDirectly('${os.id}', ${originalIndex}, this.value)">
              <option value="Pendente" ${item.estado === 'Pendente' ? 'selected' : ''}>Pendente</option>
              <option value="Em Andamento" ${item.estado === 'Em Andamento' ? 'selected' : ''}>Em Andamento</option>
              <option value="Finalizado" ${item.estado === 'Finalizado' ? 'selected' : ''}>Finalizado</option>
            </select>
          </div>
        </div>
      `;
    });

    // ── Urgency badge & card accent color ──────────────────────────────
    const priority = getOSPriority(os);
    let urgencyBadge = '';
    let cardAccentColor = 'transparent';
    let cardAccentStyle = '';

    if (priority === 1) {
      // Overdue
      const dl = new Date(os.dataLimite + 'T00:00:00');
      const daysLate = Math.floor((today - dl) / 86400000);
      urgencyBadge = `<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;background:hsla(355,80%,56%,0.18);color:hsl(355,80%,65%);font-size:0.75rem;font-weight:700;padding:0 10px;border-radius:6px;border:1px solid hsla(355,80%,56%,0.4);">
        ⚠ VENCIDO há ${daysLate}d (${formatDateBR(os.dataLimite)})
      </span>`;
      cardAccentStyle = 'border-left: 3px solid hsl(355, 80%, 56%);';
    } else if (priority === 2) {
      // Urgent (deadline within 3 days)
      const dl = new Date(os.dataLimite + 'T00:00:00');
      const diffDays = Math.floor((dl - today) / 86400000);
      const label = diffDays === 0 ? 'HOJE' : `em ${diffDays}d`;
      urgencyBadge = `<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;background:hsla(30,90%,50%,0.16);color:hsl(30,90%,62%);font-size:0.75rem;font-weight:700;padding:0 10px;border-radius:6px;border:1px solid hsla(30,90%,50%,0.4);">
        🔔 Entrega ${label} (${formatDateBR(os.dataLimite)})
      </span>`;
      cardAccentStyle = 'border-left: 3px solid hsl(30, 90%, 50%);';
    } else if (priority === 3) {
      // Active, check if has deadline (far away)
      if (os.dataLimite) {
        const dl = new Date(os.dataLimite + 'T00:00:00');
        const diffDays = Math.floor((dl - today) / 86400000);
        urgencyBadge = `<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;background:hsla(196,86%,50%,0.12);color:hsl(196,86%,60%);font-size:0.75rem;font-weight:700;padding:0 10px;border-radius:6px;border:1px solid hsla(196,86%,50%,0.3);">
          📅 Entrega em ${diffDays}d (${formatDateBR(os.dataLimite)})
        </span>`;
      }
      // Oldest-first indicator: show age in days
      const age = Math.floor((today - new Date(os.dataOrdem)) / 86400000);
      if (age >= 3) {
        urgencyBadge += `<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;background:hsla(0,0%,100%,0.05);color:var(--text-tertiary);font-size:0.75rem;font-weight:600;padding:0 10px;border-radius:6px;border:1px solid var(--border-subtle);margin-left:4px;">
          🕐 ${age}d em aberto
        </span>`;
      }
    }

    container.innerHTML += `
      <div class="prod-card" id="prod-card-${os.id}" style="${cardAccentStyle}">
        <!-- Card Header -->
        <div class="prod-card-header" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
          <div class="prod-card-info" style="display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span style="font-family:'Outfit',sans-serif; font-weight:700; font-size:0.85rem; color:var(--text-main); background:rgba(255,255,255,0.05); height:26px; display:inline-flex; align-items:center; justify-content:center; padding:0 10px; border-radius:6px; cursor:pointer; border:1px solid rgba(255,255,255,0.1); transition:all 0.2s;" onclick="viewOSDetails('${os.id}')" onmouseover="this.style.borderColor='var(--border-focus)'; this.style.color='var(--border-focus)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'; this.style.color='var(--text-main)'" title="Clique para ver detalhes">${os.id}</span>
              ${urgencyBadge}
              <span style="display:inline-flex; align-items:center; justify-content:center; height:26px; padding:0 10px; background-color: hsla(224, 20%, 12%, 0.8); border: 1px solid var(--border-color); color: #fff; font-size: 0.75rem; font-weight: 700; border-radius: 6px; letter-spacing:0.5px;">
                ${os.estadoPagamento.toUpperCase()}
              </span>
            </div>
            <span style="font-weight: 600; font-size: 1.1rem; color:var(--text-main); margin-top:2px;">${clientDisplayName}</span>
            <div style="display:flex; align-items:center; gap:12px; font-size:0.8rem; color:var(--text-muted);">
              <span style="display:flex; align-items:center; gap:4px;"><i data-lucide="calendar" style="width:12px;height:12px;"></i> ${formatDateBR(os.dataOrdem)}</span>
              <span style="display:flex; align-items:center; gap:4px;"><i data-lucide="dollar-sign" style="width:12px;height:12px;"></i> <strong>${formatCurrency(os.valorTotal)}</strong></span>
            </div>
          </div>
          <div class="prod-card-actions">
            <button onclick="printOSChecklist('${os.id}')" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-main); font-size:0.75rem; font-weight:600; height:26px; padding:0 12px; border-radius:6px; transition:all 0.2s; display:inline-flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
              <i data-lucide="printer" style="width:14px;height:14px;"></i> Checklist
            </button>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="prod-progress-container">
          <div class="prod-progress-header">
            <span>Progresso da Produção</span>
            <span>${percentage}%</span>
          </div>
          <div class="prod-progress-bar">
            <div class="prod-progress-fill" style="width: ${percentage}%"></div>
          </div>
        </div>

        <!-- Items list -->
        <div class="prod-items-list">
          ${itemsHTML}
        </div>

        <!-- Inline notes -->
        <div class="prod-notes-container">
          <label for="notes-${os.id}">Anotações e Observações Rápidas</label>
          <textarea id="notes-${os.id}" class="prod-notes-textarea" placeholder="Digite uma anotação sobre esta OS..."
            onchange="updateOSNotesDirectly('${os.id}', this.value)"
            onblur="updateOSNotesDirectly('${os.id}', this.value)">${os.observacoes || ''}</textarea>
        </div>
      </div>
    `;
  });
}

// Direct save functions
function updateOSPaymentDirectly(osId, paymentStatus) {
  const os = state.ordens.find(o => o.id === osId);
  if (os) {
    // Calculate subtotal for models and files
    let subtotalModelos = 0;
    let subtotalArquivos = 0;
    os.itens.forEach(item => {
      subtotalModelos += (item.quantidade * item.valorUnitario);
      if (item.arquivoNovo) {
        let arqCost = item.valorArquivoItem || 0;
        if (item.dividirCusto) {
          arqCost = arqCost / 2;
        }
        subtotalArquivos += arqCost;
      }
    });

    if (paymentStatus === 'Pago') {
      os.pagoServico = subtotalModelos;
      os.pagoArquivo = subtotalArquivos;
      os.pagoTerceiros = os.valorTerceiros || 0;
    } else if (paymentStatus === 'Pendente') {
      os.pagoServico = 0;
      os.pagoArquivo = 0;
      os.pagoTerceiros = 0;
    } else if (paymentStatus === 'Pago Parcial') {
      // If setting to Pago Parcial from Pendente (or no paid amount), default to 50% paid
      const currentPaid = (os.pagoServico || 0) + (os.pagoArquivo || 0) + (os.pagoTerceiros || 0);
      if (currentPaid <= 0.01) {
        os.pagoServico = parseFloat((subtotalModelos * 0.5).toFixed(2));
        os.pagoArquivo = parseFloat((subtotalArquivos * 0.5).toFixed(2));
        os.pagoTerceiros = parseFloat(((os.valorTerceiros || 0) * 0.5).toFixed(2));
      } else {
        // Otherwise, keep the current paid values, clamped to totals
        os.pagoServico = Math.min(os.pagoServico || 0, subtotalModelos);
        os.pagoArquivo = Math.min(os.pagoArquivo || 0, subtotalArquivos);
        os.pagoTerceiros = Math.min(os.pagoTerceiros || 0, os.valorTerceiros || 0);
      }
    }

    recalculateOSPaymentStatus(os);
    saveToLocalStorage();
    renderProducao();
  }
}

function updateOSItemStatusDirectly(osId, itemIndex, itemStatus) {
  const os = state.ordens.find(o => o.id === osId);
  if (os && os.itens[itemIndex]) {
    os.itens[itemIndex].estado = itemStatus;
    saveToLocalStorage();

    // Update progress bar of this card in real time
    const card = document.getElementById(`prod-card-${osId}`);
    if (card) {
      const itemStates = os.itens.map(i => i.estado);
      const totalItens = itemStates.length;
      const finishedItens = itemStates.filter(s => s === 'Finalizado').length;
      const percentage = totalItens > 0 ? Math.round((finishedItens / totalItens) * 100) : 0;

      card.querySelector('.prod-progress-header span:last-child').innerText = `${percentage}%`;
      card.querySelector('.prod-progress-fill').style.width = `${percentage}%`;
    }
  }
}

// ---- PRINT CHECKLIST FUNCTION ----
function printOSChecklist(osId) {
  const os = state.ordens.find(o => o.id === osId);
  if (!os) return;

  const container = document.getElementById('print-checklist-container');
  if (!container) return;

  const logoUrl = localStorage.getItem('aeroprint_logo_print');
  const companyName = localStorage.getItem('aeroprint_company_name') || 'AeroPrint3D';
  let logoHtml = '';
  if (logoUrl) {
    logoHtml = `<img src="${logoUrl}" alt="Logo" style="max-height:50px; max-width:140px; object-fit:contain; display:block; margin:0 auto 5px;">
                <div style="font-size:0.8rem; font-weight:bold;">${companyName}</div>`;
  } else {
    logoHtml = `<h2><span style="color:#000;">✈</span> ${companyName}</h2>`;
  }

  // Client info formatting
  const client = state.clientes.find(c => c.id === os.clienteId);
  const clientName = client ? client.nome : 'Cliente Desconhecido';

  let clientDisplayName = clientName;
  if (os.subcliente && os.subcliente.trim() !== '') {
    clientDisplayName = `${clientName} (${os.subcliente})`;
  }

  let itemsHtml = '';
  os.itens.forEach((item, idx) => {
    let modelName = item.modeloId; // Fallback to ID
    let modelDetails = '';
    let dimensionsStr = '';
    let escalaStr = item.escala || '';

    // Find model to get proper name and dimensions if custom wasn't specified
    const dbModel = state.modelos.find(m => m.id === item.modeloId);
    if (dbModel) {
      modelName = dbModel.nome;
      let variant = null;
      if (dbModel.variantes && item.varianteId) {
        variant = dbModel.variantes.find(v => v.id === item.varianteId);
      }
      if (variant) {
        dimensionsStr = `${variant.comprimento || 0}x${variant.envergadura || 0} cm`;
        escalaStr = variant.escala || escalaStr;
      } else {
        dimensionsStr = `${dbModel.comprimento || 0}x${dbModel.envergadura || 0} cm`;
      }
    }

    if (item.idModificado) {
      modelName = item.idModificado;
    }

    let parts = [];
    if (dimensionsStr && dimensionsStr !== '0x0 cm') parts.push(`Dimensões: ${dimensionsStr}`);
    if (escalaStr) parts.push(`Escala: ${escalaStr}`);
    if (item.material) parts.push(`Material: ${item.material}`);
    if (item.acabamento) parts.push(`Acabamento: ${item.acabamento}`);
    modelDetails = parts.join(' | ');

    // Generate checkboxes based on quantity
    let checkboxesHtml = '';
    const qtd = parseInt(item.quantidade) || 1;
    const isFinished = (item.estado === 'Finalizado');
    const checkMark = isFinished ? '✔' : '';

    for (let i = 0; i < qtd; i++) {
      checkboxesHtml += `<div style="display:inline-flex; align-items:center; justify-content:center; font-size:14px; font-weight:bold; width:18px; height:18px; border:1.5px solid #000; margin-right:8px; border-radius:3px; vertical-align:middle;">${checkMark}</div>`;
    }

    itemsHtml += `
      <div style="border-bottom:1px solid #ccc; padding:12px 0;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="flex:1;">
            <strong style="font-size:1.1rem; display:block; margin-bottom:4px;">Item #${idx + 1}: ${modelName}</strong>
            <div style="font-size:0.85rem; color:#444;">${modelDetails}</div>
          </div>
          <div style="margin-left:15px; text-align:right;">
            <div style="font-size:0.8rem; margin-bottom:4px; font-weight:bold;">QTD: ${qtd}</div>
            <div style="display:flex; align-items:center; justify-content:flex-end;">
              ${checkboxesHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  });

  const printHtml = `
    <div style="font-family: sans-serif; max-width:800px; margin:0 auto; padding:20px;">
      
      <!-- Header -->
      <div style="text-align:center; border-bottom:2px solid #000; padding-bottom:15px; margin-bottom:20px;">
        ${logoHtml}
        <h1 style="margin:10px 0 0; font-size:1.4rem; text-transform:uppercase;">Checklist de Produção</h1>
      </div>

      <!-- OS Info -->
      <div style="display:flex; flex-wrap:wrap; gap:15px; background:#f8f8f8; border:1px solid #ddd; padding:15px; border-radius:6px; margin-bottom:25px;">
        <div style="flex:1; min-width:200px;">
          <div style="font-size:0.8rem; color:#555; text-transform:uppercase;">Ordem de Serviço</div>
          <div style="font-size:1.1rem; font-weight:bold; color:#000;">${os.id}</div>
        </div>
        <div style="flex:1; min-width:200px;">
          <div style="font-size:0.8rem; color:#555; text-transform:uppercase;">Cliente / Subcliente</div>
          <div style="font-size:1.1rem; font-weight:bold; color:#000;">${clientDisplayName}</div>
        </div>
        <div style="flex:1; min-width:140px;">
          <div style="font-size:0.8rem; color:#555; text-transform:uppercase;">Data de Emissão</div>
          <div style="font-size:1.0rem; font-weight:bold; color:#000;">${formatDateBR(os.dataOrdem)}</div>
        </div>
        <div style="flex:1; min-width:140px;">
          <div style="font-size:0.8rem; color:#555; text-transform:uppercase;">Data de Entrega</div>
          <div style="font-size:1.0rem; font-weight:bold; color:#000;">${os.dataLimite ? formatDateBR(os.dataLimite) : 'Não definida'}</div>
        </div>
      </div>

      <!-- Items List -->
      <h3 style="font-size:1.1rem; border-bottom:1px solid #000; padding-bottom:5px; margin-bottom:10px;">Itens da Produção</h3>
      <div style="margin-bottom:30px;">
        ${itemsHtml}
      </div>

      <!-- Footer/Signatures -->
      <div style="margin-top:40px; display:flex; justify-content:space-around; gap:20px;">
        <div style="text-align:center; width:200px;">
          <div style="border-top:1px solid #000; padding-top:5px; font-size:0.85rem;">Responsável pela Impressão</div>
        </div>
        <div style="text-align:center; width:200px;">
          <div style="border-top:1px solid #000; padding-top:5px; font-size:0.85rem;">Responsável pelo Acabamento</div>
        </div>
      </div>
      
    </div>
  `;

  container.innerHTML = printHtml;

  // Trigger print
  document.body.classList.add('print-only-checklist');
  window.print();

  // Clean up
  setTimeout(() => {
    document.body.classList.remove('print-only-checklist');
    container.innerHTML = '';
  }, 500);
}

function updateOSNotesDirectly(osId, notesValue) {
  const os = state.ordens.find(o => o.id === osId);
  if (os) {
    os.observacoes = notesValue.trim();
    saveToLocalStorage();
  }
}

// ================= FINANCIAL / PAYMENTS LOGIC =================

// Recalculates payment status based on exact paid fields
function recalculateOSPaymentStatus(os) {
  let subtotalModelos = 0;
  let subtotalArquivos = 0;
  os.itens.forEach(item => {
    subtotalModelos += (item.quantidade * item.valorUnitario);
    if (item.arquivoNovo && item.dividirCusto) {
      subtotalArquivos += (item.valorArquivoItem / 2);
    }
  });

  // Include frete charged to client in the total
  const vf = os.valorFrete || 0;
  const rf = os.responsavelFrete || 'minha-conta';
  let freteParaCliente = 0;
  if (rf === 'cliente') freteParaCliente = vf;
  else if (rf === 'dividido') freteParaCliente = parseFloat((vf / 2).toFixed(2));

  const total = subtotalModelos + subtotalArquivos + freteParaCliente;
  const paid = (os.pagoServico || 0) + (os.pagoArquivo || 0);

  if (paid <= 0.01) {
    os.estadoPagamento = 'Pendente';
  } else if (paid >= total - 0.01) {
    os.estadoPagamento = 'Pago';
  } else {
    os.estadoPagamento = 'Pago Parcial';
  }
}

// Calculates exact balance due categories for an OS
function getOSBalanceDue(os) {
  let subtotalModelos = 0;
  let subtotalArquivos = 0;
  os.itens.forEach(item => {
    subtotalModelos += (item.quantidade * item.valorUnitario);
    if (item.arquivoNovo && item.dividirCusto) {
      subtotalArquivos += (item.valorArquivoItem / 2);
    }
  });

  const dueServico = Math.max(0, subtotalModelos - (os.pagoServico || 0));
  const dueArquivo = Math.max(0, subtotalArquivos - (os.pagoArquivo || 0));
  const dueTerceiros = 0;

  return {
    subtotalModelos,
    subtotalArquivos,
    total: subtotalModelos + subtotalArquivos,
    dueServico,
    dueArquivo,
    dueTerceiros,
    totalDue: dueServico + dueArquivo
  };
}

// Calculates active client credits
function getClientCredits() {
  const credits = {};
  state.clientes.forEach(c => {
    credits[c.id] = 0;
  });
  if (state.depositos) {
    state.depositos.forEach(dep => {
      if (dep.pagadorId && credits[dep.pagadorId] !== undefined) {
        credits[dep.pagadorId] += (dep.saldoDisponivel || 0);
      }
    });
  }
  return credits;
}

// Renders the payments tab view
function renderPagamentos() {
  renderClientCredits();
  renderDepositsHistory();
}

// Renders client credit boxes
function renderClientCredits() {
  const credits = getClientCredits();
  const listEl = document.getElementById('client-credits-list');
  listEl.innerHTML = '';

  let hasCredits = false;
  state.clientes.forEach(c => {
    const cred = credits[c.id] || 0;
    if (cred > 0.009) {
      hasCredits = true;
      listEl.innerHTML += `
        <div class="client-credit-card">
          <div class="client-credit-info">
            <span class="client-credit-name" title="${c.nome}">${c.nome}</span>
            <span class="client-credit-label">Saldo Acumulado</span>
            <span class="client-credit-value">${formatCurrency(cred)}</span>
          </div>
          <div class="client-credit-icon">
            <i data-lucide="wallet"></i>
          </div>
        </div>
      `;
    }
  });

  if (!hasCredits) {
    listEl.innerHTML = `<span class="text-muted" style="font-size: 0.9rem;">Nenhum cliente possui saldo acumulado no momento.</span>`;
  } else {
    lucide.createIcons();
  }
}

// Calculates credit timeline for a client
function getClientCreditTimeline(clientId) {
  const clientDeposits = (state.depositos || [])
    .filter(d => d.pagadorId === clientId)
    .sort((a, b) => new Date(a.data) - new Date(b.data) || a.id.localeCompare(b.id));

  const timeline = {};
  let runningCredit = 0;

  clientDeposits.forEach(d => {
    const prev = runningCredit;
    if (d.isCreditUse) {
      runningCredit = Math.max(0, runningCredit - d.valor);
    } else {
      const allocatedTotal = (d.alocacoes || []).reduce((sum, al) => sum + (al.valorAlocado || 0), 0);
      const creditGenerated = Math.max(0, d.valor - allocatedTotal);
      runningCredit += creditGenerated;
    }
    timeline[d.id] = {
      previousCredit: prev,
      postCredit: runningCredit
    };
  });

  return timeline;
}

// Renders deposits and allocations history
function renderDepositsHistory() {
  const tbody = document.getElementById('pagamentos-table-body');
  tbody.innerHTML = '';

  const searchText = document.getElementById('pagamento-search').value.toLowerCase();

  if (!state.depositos || state.depositos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Nenhum depósito ou pagamento registrado.</td></tr>`;
    return;
  }

  const sorted = [...state.depositos].sort((a, b) => new Date(b.data) - new Date(a.data) || b.id.localeCompare(a.id));

  const filtered = sorted.filter(dep => {
    const pagador = state.clientes.find(c => c.id === dep.pagadorId);
    const pagadorName = pagador ? pagador.nome.toLowerCase() : 'desconhecido';
    const obsText = dep.observacao ? dep.observacao.toLowerCase() : '';
    return pagadorName.includes(searchText) || obsText.includes(searchText);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Nenhum registro encontrado para a busca.</td></tr>`;
    return;
  }

  filtered.forEach(dep => {
    const pagador = state.clientes.find(c => c.id === dep.pagadorId);
    const pagadorName = pagador ? pagador.nome : '<i class="text-muted">Cliente Excluído</i>';
    const safeId = dep.id.replace(/[^a-zA-Z0-9-]/g, '_');

    // Credit timeline data for this transaction
    const timeline = getClientCreditTimeline(dep.pagadorId);
    const timelineData = timeline[dep.id] || { previousCredit: 0, postCredit: 0 };
    const movementVal = dep.isCreditUse
      ? dep.valor
      : Math.max(0, dep.valor - (dep.alocacoes || []).reduce((sum, al) => sum + (al.valorAlocado || 0), 0));

    let allocsHTML = '';
    if (dep.alocacoes && dep.alocacoes.length > 0) {
      allocsHTML = dep.alocacoes.map(al => {
        let typeStr = 'Serviço';
        if (al.tipo === 'arquivo') typeStr = 'Arquivo 3D';
        if (al.tipo === 'terceiros') typeStr = 'Terceirizados';
        return `<div style="font-size:0.8rem; margin-bottom: 2px;">
          <strong>${formatCurrency(al.valorAlocado)}</strong> na <strong style="color: var(--accent); cursor: pointer; text-decoration: underline;" onclick="event.stopPropagation(); viewOSDetails('${al.osId}')" title="Clique para ver aviões e valores da OS">${al.osId}</strong> (${typeStr})
        </div>`;
      }).join('');
    } else {
      allocsHTML = '<span class="text-muted">Nenhuma alocação</span>';
    }

    const isCredit = dep.isCreditUse ? ' <span class="badge badge-andamento" style="padding: 2px 6px; font-size: 0.65rem; text-transform: none;">Uso de Crédito</span>' : '';
    const obsHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 0.82rem; color: ${dep.observacao ? 'var(--text-secondary)' : 'var(--text-tertiary)'};">
          ${dep.observacao || '-'}
        </span>
        <button class="action-btn" onclick="event.stopPropagation(); editDepositObservacao('${dep.id}')" title="Editar observação" style="padding: 2px 4px; height: auto; border-radius: 4px; opacity: 0.5; transition: opacity 0.2s;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.5">
          <i data-lucide="edit-2" style="width: 12px; height: 12px; display: block;"></i>
        </button>
      </div>
    `;

    const allocatedDirectly = (dep.alocacoes || []).reduce((sum, al) => sum + (al.valorAlocado || 0), 0);
    const creditGenerated = dep.isCreditUse ? 0 : Math.max(0, dep.valor - allocatedDirectly);
    const creditUsedLater = dep.isCreditUse ? 0 : Math.max(0, creditGenerated - (dep.saldoDisponivel || 0));
    const creditRemaining = dep.isCreditUse ? 0 : (dep.saldoDisponivel || 0);

    // Build allocation detail list inside expanded sub-row
    let detailAllocsHTML = '';
    if (dep.alocacoes && dep.alocacoes.length > 0) {
      detailAllocsHTML = `
        <div style="margin-top: 15px;">
          <h5 style="color: var(--text-secondary); margin-bottom: 6px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px;">Detalhamento das Alocações nas OSs</h5>
          <table class="data-table" style="font-size: 0.78rem; width: 100%; border: 1px solid var(--border-subtle); border-radius: 6px; overflow:hidden;">
            <thead>
              <tr style="background: hsla(220, 22%, 14%, 0.5);">
                <th>Ordem de Serviço (OS)</th>
                <th>Tipo de Alocação</th>
                <th style="text-align: right;">Valor Alocado</th>
              </tr>
            </thead>
            <tbody>
      `;
      detailAllocsHTML += dep.alocacoes.map(al => {
        let typeStr = 'Serviço (Maquete)';
        if (al.tipo === 'arquivo') typeStr = 'Arquivos 3D (Custo de arquivos novos)';
        if (al.tipo === 'terceiros') typeStr = 'Serviços de Terceiros';
        return `
          <tr>
            <td><strong style="color: var(--accent); cursor: pointer; text-decoration: underline;" onclick="event.stopPropagation(); viewOSDetails('${al.osId}')" title="Clique para ver a OS">${al.osId}</strong></td>
            <td>${typeStr}</td>
            <td style="text-align: right; font-weight:700;">${formatCurrency(al.valorAlocado)}</td>
          </tr>
        `;
      }).join('');
      detailAllocsHTML += `
            </tbody>
          </table>
        </div>
      `;
    }

    // Build credits sources inside expanded sub-row
    let drawnFromHTML = '';
    if (dep.isCreditUse && dep.drawnFrom && dep.drawnFrom.length > 0) {
      drawnFromHTML = `
        <div style="margin-top: 15px;">
          <h5 style="color: var(--text-secondary); margin-bottom: 6px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px;">Créditos sacados de depósitos anteriores</h5>
          <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; background: hsla(220, 22%, 12%, 0.4); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 14px;">
      `;
      drawnFromHTML += dep.drawnFrom.map(draw => {
        const originDep = state.depositos.find(x => x.id === draw.depositId);
        const dateStr = originDep ? formatDateBR(originDep.data) : 'data desconhecida';
        return `<div>• Sacado R$ <strong>${formatCurrency(draw.amount)}</strong> do depósito realizado em <strong>${dateStr}</strong> (ID: <span style="font-family: monospace; font-size: 0.75rem;">${draw.depositId}</span>)</div>`;
      }).join('');
      drawnFromHTML += `
          </div>
        </div>
      `;
    }

    tbody.innerHTML += `
      <tr class="pag-main-row" id="pag-row-${safeId}" onclick="togglePagExpand('${safeId}')" style="cursor:pointer;">
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>${formatDateBR(dep.data)}</span>
            <svg id="pag-chevron-${safeId}" style="width:13px;height:13px;flex-shrink:0;color:var(--text-tertiary);transition:transform 0.25s;transform:rotate(0deg);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </td>
        <td><strong>${pagadorName}</strong>${isCredit}</td>
        <td><strong style="color: var(--text-main);">${formatCurrency(dep.valor)}</strong></td>
        <td><span style="color: var(--color-success); font-weight:600;">${dep.saldoDisponivel > 0 ? formatCurrency(dep.saldoDisponivel) : '-'}</span></td>
        <td>${allocsHTML}</td>
        <td>${obsHTML}</td>
        <td>
          ${!dep.isCreditUse && (creditGenerated > 0.009) && (dep.saldoDisponivel < creditGenerated - 0.009) ? `
            <span class="text-muted" style="font-size: 0.78rem; font-style: italic; white-space: nowrap;" title="Este depósito não pode ser estornado porque o crédito gerado por ele já foi utilizado.">Crédito Utilizado</span>
          ` : `
            <div class="table-actions">
              <button class="action-btn btn-delete btn-sm" onclick="event.stopPropagation(); confirmReverseDeposit('${dep.id}')" title="Estornar/excluiráDepósito"><i data-lucide="rotate-ccw"></i> Estornar</button>
            </div>
          `}
        </td>
      </tr>
      <tr class="pag-expand-row hidden" id="pag-expand-${safeId}">
        <td colspan="7" style="padding:0;">
          <div class="pag-expand-content">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 12px;">
              <!-- Transaction Summary -->
              <div style="background: hsla(220, 22%, 12%, 0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 16px;">
                <h5 style="color: var(--border-focus); margin-bottom: 8px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px;">Dados da Transação</h5>
                <div style="font-size: 0.82rem; display: flex; flex-direction: column; gap: 4px;">
                  <div><strong>ID do Lançamento:</strong> <span style="font-family: monospace; font-size:0.75rem;">${dep.id}</span></div>
                  <div><strong>Data:</strong> ${formatDateBR(dep.data)}</div>
                  <div><strong>Cliente:</strong> ${pagadorName}</div>
                  <div><strong>Tipo:</strong> ${dep.isCreditUse ? 'Uso de Crédito (Saldo Acumulado)' : 'Depósito em Dinheiro/Pix'}</div>
                </div>
              </div>
              
              <!-- Credit Movement -->
              <div style="background: hsla(220, 22%, 12%, 0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 16px;">
                <h5 style="color: var(--color-success); margin-bottom: 8px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px;">Créditos do Cliente</h5>
                <div style="font-size: 0.82rem; display: flex; flex-direction: column; gap: 4px;">
                  <div><strong>Saldo de Crédito Anterior:</strong> ${formatCurrency(timelineData.previousCredit)}</div>
                  <div>
                    <strong>Movimento nesta Transação:</strong> 
                    <span style="color: ${dep.isCreditUse ? 'var(--color-danger)' : 'var(--color-success)'}; font-weight: 700;">
                      ${dep.isCreditUse ? '-' : '+'}${formatCurrency(movementVal)}
                    </span>
                  </div>
                  <div><strong>Novo Saldo de Crédito:</strong> <strong style="color: var(--color-success);">${formatCurrency(timelineData.postCredit)}</strong></div>
                </div>
              </div>
              
              <!-- Allocation Summary -->
              <div style="background: hsla(220, 22%, 12%, 0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 16px;">
                <h5 style="color: var(--color-info); margin-bottom: 8px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px;">Alocações no Lançamento</h5>
                <div style="font-size: 0.82rem; display: flex; flex-direction: column; gap: 4px;">
                  ${dep.isCreditUse ? `
                    <div><strong>Uso de Crédito:</strong> ${formatCurrency(dep.valor)}</div>
                    <div><strong>Aplicado nas OSs:</strong> ${formatCurrency(allocatedDirectly)}</div>
                  ` : `
                    <div><strong>Valor Lançado:</strong> ${formatCurrency(dep.valor)}</div>
                    <div><strong>Aplicado diretamente nas OSs:</strong> ${formatCurrency(allocatedDirectly)}</div>
                    <div><strong>Gerou de Crédito (original):</strong> ${formatCurrency(creditGenerated)}</div>
                    ${creditUsedLater > 0.009 ? `
                      <div style="color: var(--text-secondary); font-size: 0.78rem; padding-left: 8px;">• Utilizado depois: <span style="color: var(--color-danger); font-weight:600;">-${formatCurrency(creditUsedLater)}</span></div>
                      <div style="color: var(--text-secondary); font-size: 0.78rem; padding-left: 8px;">• Crédito restante: <span style="color: var(--color-success); font-weight:600;">${formatCurrency(creditRemaining)}</span></div>
                    ` : ''}
                  `}
                </div>
              </div>
            </div>
            
            ${drawnFromHTML}
            ${detailAllocsHTML}
          </div>
        </td>
      </tr>
    `;
  });

  lucide.createIcons();
}

function togglePagExpand(safeId) {
  const expandRow = document.getElementById('pag-expand-' + safeId);
  const chevron = document.getElementById('pag-chevron-' + safeId);
  const mainRow = document.getElementById('pag-row-' + safeId);
  if (!expandRow) return;

  const isOpen = !expandRow.classList.contains('hidden');

  if (isOpen) {
    expandRow.classList.add('hidden');
    if (chevron) chevron.style.transform = 'rotate(0deg)';
    if (mainRow) mainRow.classList.remove('pag-row-expanded');
  } else {
    expandRow.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    if (mainRow) mainRow.classList.add('pag-row-expanded');
  }
}

// Opens the deposit modal
function openDepositModal() {
  const modal = document.getElementById('modal-deposit');
  if (!modal) return;

  modal.classList.add('active');

  const pagadorSelect = document.getElementById('dep-pagador');
  pagadorSelect.innerHTML = '<option value="">Selecione quem está pagando</option>';
  state.clientes.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(c => {
    pagadorSelect.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
  });

  document.getElementById('dep-data').value = new Date().toISOString().split('T')[0];
  document.getElementById('dep-valor').value = '';
  document.getElementById('dep-obs').value = '';
  document.getElementById('dep-use-credit-chk').checked = false;
  document.getElementById('dep-credit-info').classList.add('hidden');
  document.getElementById('dep-valor-label').innerText = "Valor do Depósito (R$) *";
  document.getElementById('dep-valor').disabled = false;

  renderAllocationTable();
  updateDepositCalculations();
}

// Renders the allocation dynamic table of OSs with balance due
function renderAllocationTable() {
  const tbody = document.getElementById('deposit-allocation-rows');
  tbody.innerHTML = '';

  const pagadorId = document.getElementById('dep-pagador').value;
  if (!pagadorId) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 20px;">Selecione um cliente para visualizar as Ordens de Serviço pendentes.</td></tr>`;
    return;
  }

  const activeOSs = state.ordens.filter(os => {
    if (os.clienteId !== pagadorId) return false;
    const balance = getOSBalanceDue(os);
    return balance.totalDue > 0.01;
  });

  if (activeOSs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 20px;">Nenhuma Ordem de Serviço com saldo devedor pendente para este cliente.</td></tr>`;
    return;
  }

  activeOSs.sort((a, b) => b.id.localeCompare(a.id));

  activeOSs.forEach(os => {
    const client = state.clientes.find(c => c.id === os.clienteId);
    const clientName = client ? client.nome : 'Cliente Removido';
    const balance = getOSBalanceDue(os);
    const safeOSId = os.id.replace(/[^a-zA-Z0-9-]/g, '_');

    const servInput = balance.dueServico > 0
      ? `<input type="number" class="allocation-input alloc-servico" id="alloc-serv-${safeOSId}" data-os="${os.id}" max="${balance.dueServico}" step="0.01" min="0" placeholder="0,00">
         <span class="allocation-due clickable-due" onclick="autoFillAlloc('alloc-serv-${safeOSId}', ${balance.dueServico}, '${os.id}')" title="Clique para preencher" style="cursor:pointer; text-decoration:underline dashed; text-underline-offset:3px;">Devido: ${formatCurrency(balance.dueServico)}</span>`
      : `<span class="text-muted" style="font-size:0.8rem;">Quitado</span>`;

    const arqInput = balance.dueArquivo > 0
      ? `<input type="number" class="allocation-input alloc-arquivo" id="alloc-arq-${safeOSId}" data-os="${os.id}" max="${balance.dueArquivo}" step="0.01" min="0" placeholder="0,00">
         <span class="allocation-due clickable-due" onclick="autoFillAlloc('alloc-arq-${safeOSId}', ${balance.dueArquivo}, '${os.id}')" title="Clique para preencher" style="cursor:pointer; text-decoration:underline dashed; text-underline-offset:3px;">Devido: ${formatCurrency(balance.dueArquivo)}</span>`
      : `<span class="text-muted" style="font-size:0.8rem;">Quitado</span>`;

    tbody.innerHTML += `
      <tr data-os-row="${os.id}">
        <td style="min-width: 200px;">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <strong style="color: var(--accent); cursor: pointer; text-decoration: underline;" onclick="viewOSDetails('${os.id}')" title="Clique para ver detalhes">${os.id}</strong>
              ${os.subcliente ? `<span style="display:inline-block;background:hsla(244,88%,66%,0.12);color:var(--accent);font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:var(--radius-full);">${os.subcliente}</span>` : ''}
            </div>
            <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">${clientName}</span>
          </div>
        </td>
        <td><strong>${formatCurrency(balance.total)}</strong></td>
        <td>${servInput}</td>
        <td>${arqInput}</td>
        <td><strong class="alloc-row-total" style="color: var(--border-focus);">${formatCurrency(0)}</strong></td>
      </tr>
    `;
  });

  tbody.querySelectorAll('.allocation-input').forEach(input => {
    input.addEventListener('input', () => {
      const maxVal = parseFloat(input.getAttribute('max')) || 0;
      let val = parseFloat(input.value) || 0;
      if (val < 0) {
        input.value = 0;
        val = 0;
      }
      if (val > maxVal) {
        input.value = maxVal;
        val = maxVal;
      }

      updateRowTotal(input.getAttribute('data-os'));
      updateDepositCalculations();
    });
  });
}

// Updates row total allocated inside table
function updateRowTotal(osId) {
  const row = document.querySelector(`tr[data-os-row="${osId}"]`);
  if (!row) return;

  let rowAllocated = 0;
  row.querySelectorAll('.allocation-input').forEach(inp => {
    rowAllocated += (parseFloat(inp.value) || 0);
  });

  row.querySelector('.alloc-row-total').innerText = formatCurrency(rowAllocated);
}

// Auto-fills allocation input with remaining available deposit balance up to the due amount
function autoFillAlloc(inputId, dueAmount, osId) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;

  const depositVal = parseFloat(document.getElementById('dep-valor').value) || 0;

  let totalAllocated = 0;
  document.querySelectorAll('#deposit-allocation-rows .allocation-input').forEach(inp => {
    totalAllocated += (parseFloat(inp.value) || 0);
  });

  const currentVal = parseFloat(inputEl.value) || 0;
  const remaining = depositVal - totalAllocated;
  const available = remaining + currentVal;

  if (available <= 0.009) {
    alert("Sem saldo disponível para preenchimento.");
    return;
  }

  const fillAmount = Math.min(dueAmount, available);
  inputEl.value = fillAmount.toFixed(2);

  updateRowTotal(osId);
  updateDepositCalculations();
}

// Recalculates remaining deposit balance in real time
function updateDepositCalculations() {
  const depositVal = parseFloat(document.getElementById('dep-valor').value) || 0;

  let totalAllocated = 0;
  document.querySelectorAll('#deposit-allocation-rows .allocation-input').forEach(inp => {
    totalAllocated += (parseFloat(inp.value) || 0);
  });

  const remaining = depositVal - totalAllocated;

  document.getElementById('dep-calc-total').innerText = formatCurrency(depositVal);
  document.getElementById('dep-calc-alocado').innerText = formatCurrency(totalAllocated);

  const remainingEl = document.getElementById('dep-calc-restante');
  remainingEl.innerText = formatCurrency(remaining);

  const confirmBtn = document.getElementById('confirm-deposit-btn');

  if (remaining < -0.009) {
    remainingEl.style.color = 'var(--color-danger)';
    confirmBtn.disabled = true;
    confirmBtn.title = "O valor alocado supera o valor disponível!";
  } else {
    remainingEl.style.color = 'var(--color-success)';
    confirmBtn.disabled = false;
    confirmBtn.title = "";
  }
}

// Triggered when client selector is changed in deposit modal
function onDepositPagadorChange() {
  const pagadorId = document.getElementById('dep-pagador').value;
  const creditInfoDiv = document.getElementById('dep-credit-info');
  const creditValueSpan = document.getElementById('dep-client-credit-value');
  const useCreditChk = document.getElementById('dep-use-credit-chk');
  const depValorInput = document.getElementById('dep-valor');

  useCreditChk.checked = false;
  depValorInput.disabled = false;
  document.getElementById('dep-valor-label').innerText = "Valor do Depósito (R$) *";

  if (!pagadorId) {
    creditInfoDiv.classList.add('hidden');
  } else {
    const credits = getClientCredits();
    const clientCredit = credits[pagadorId] || 0;

    if (clientCredit > 0.009) {
      creditValueSpan.innerText = formatCurrency(clientCredit);
      creditInfoDiv.classList.remove('hidden');
    } else {
      creditInfoDiv.classList.add('hidden');
    }
  }

  renderAllocationTable();
  updateDepositCalculations();
}

// Triggered when checking "Usar saldo de crédito" checkbox
function onUseCreditCheckboxChange() {
  const useCreditChk = document.getElementById('dep-use-credit-chk');
  const depValorInput = document.getElementById('dep-valor');
  const pagadorId = document.getElementById('dep-pagador').value;

  if (useCreditChk.checked) {
    const credits = getClientCredits();
    const clientCredit = credits[pagadorId] || 0;

    depValorInput.value = clientCredit.toFixed(2);
    depValorInput.setAttribute('max', clientCredit.toFixed(2));
    document.getElementById('dep-valor-label').innerText = "Saldo de Crédito a Utilizar (R$)";
  } else {
    depValorInput.removeAttribute('max');
    depValorInput.value = '';
    document.getElementById('dep-valor-label').innerText = "Valor do Depósito (R$) *";
  }

  updateDepositCalculations();
}

// Saves a deposit and allocates values
function saveDeposit(e) {
  e.preventDefault();

  const pagadorId = document.getElementById('dep-pagador').value;
  const valor = parseFloat(document.getElementById('dep-valor').value) || 0;
  const data = document.getElementById('dep-data').value;
  const useCredit = document.getElementById('dep-use-credit-chk').checked;

  if (!pagadorId) {
    alert("Por favor, selecione quem está pagando.");
    return;
  }
  if (valor <= 0) {
    alert("O valor deve ser maior que zero.");
    return;
  }

  const alocacoes = [];
  let totalAllocated = 0;

  const rows = document.querySelectorAll('#deposit-allocation-rows tr');
  rows.forEach(row => {
    const osId = row.getAttribute('data-os-row');
    if (!osId) return;

    const servVal = parseFloat(row.querySelector('.alloc-servico')?.value) || 0;
    const arqVal = parseFloat(row.querySelector('.alloc-arquivo')?.value) || 0;

    if (servVal > 0) {
      alocacoes.push({ osId, tipo: 'servico', valorAlocado: servVal });
      totalAllocated += servVal;
    }
    if (arqVal > 0) {
      alocacoes.push({ osId, tipo: 'arquivo', valorAlocado: arqVal });
      totalAllocated += arqVal;
    }
  });

  let finalValor = valor;
  if (useCredit) {
    // When using credit, we only draw and record the amount that was actually allocated
    finalValor = totalAllocated;
    if (finalValor <= 0) {
      alert("Por favor, aloque algum valor nas OSs para usar o crédito.");
      return;
    }
  }

  if (totalAllocated > finalValor + 0.009) {
    alert("A soma das alocações supera o valor disponível!");
    return;
  }

  const depId = "dep_" + Date.now();
  const depositObj = {
    id: depId,
    pagadorId,
    valor: finalValor,
    data,
    observacao: document.getElementById('dep-obs').value.trim(),
    isCreditUse: useCredit,
    alocacoes
  };

  if (useCredit) {
    const credits = getClientCredits();
    const clientCredit = credits[pagadorId] || 0;
    if (finalValor > clientCredit + 0.009) {
      alert("Crédito insuficiente!");
      return;
    }

    let remainingToDraw = finalValor;
    const clientDeposits = state.depositos
      .filter(d => d.pagadorId === pagadorId && d.saldoDisponivel > 0)
      .sort((a, b) => new Date(a.data) - new Date(b.data)); // FIFO: oldest first

    const drawnFrom = [];
    for (let d of clientDeposits) {
      if (remainingToDraw <= 0) break;
      const draw = Math.min(remainingToDraw, d.saldoDisponivel);
      d.saldoDisponivel -= draw;
      remainingToDraw -= draw;
      drawnFrom.push({ depositId: d.id, amount: draw });
    }

    depositObj.drawnFrom = drawnFrom;
    depositObj.saldoDisponivel = 0;
  } else {
    depositObj.saldoDisponivel = finalValor - totalAllocated;
  }

  // Apply allocations to the OS records
  alocacoes.forEach(al => {
    const os = state.ordens.find(o => o.id === al.osId);
    if (os) {
      if (al.tipo === 'servico') {
        os.pagoServico = (os.pagoServico || 0) + al.valorAlocado;
      } else if (al.tipo === 'arquivo') {
        os.pagoArquivo = (os.pagoArquivo || 0) + al.valorAlocado;
      } else if (al.tipo === 'terceiros') {
        os.pagoTerceiros = (os.pagoTerceiros || 0) + al.valorAlocado;
      }

      recalculateOSPaymentStatus(os);
    }
  });

  if (!state.depositos) state.depositos = [];
  state.depositos.push(depositObj);

  saveToLocalStorage();
  closeActiveModal();
  renderPagamentos();
}

// Edits a deposit's observation
function editDepositObservacao(depId) {
  const dep = state.depositos.find(d => d.id === depId);
  if (!dep) return;
  const newObs = prompt("Editar Observação / Notas:", dep.observacao || "");
  if (newObs === null) return;
  dep.observacao = newObs.trim();
  saveToLocalStorage();
  renderPagamentos();
}

// User-facing confirmation dialog for reversing a deposit
function confirmReverseDeposit(depId) {
  if (confirm("Tem certeza que deseja estornar este pagamento/depósito? Os valores pagos serão devolvidos como saldo devedor nas respectivas Ordens de Serviço, e eventuais créditos gerados serão revertidos.")) {
    reverseDeposit(depId);
  }
}

// Reverses a deposit and restores state
function reverseDeposit(depId) {
  const depIndex = state.depositos.findIndex(d => d.id === depId);
  if (depIndex === -1) return;

  const dep = state.depositos[depIndex];

  const allocatedDirectly = (dep.alocacoes || []).reduce((sum, al) => sum + (al.valorAlocado || 0), 0);
  const creditGenerated = dep.isCreditUse ? 0 : Math.max(0, dep.valor - allocatedDirectly);
  const isUsed = !dep.isCreditUse && (creditGenerated > 0.009) && (dep.saldoDisponivel < creditGenerated - 0.009);

  if (isUsed) {
    alert("Este depósito não pode ser estornado porque o crédito gerado já foi utilizado!");
    return;
  }

  // 1. Revert allocations on OSs
  if (dep.alocacoes && dep.alocacoes.length > 0) {
    dep.alocacoes.forEach(al => {
      const os = state.ordens.find(o => o.id === al.osId);
      if (os) {
        if (al.tipo === 'servico') {
          os.pagoServico = Math.max(0, (os.pagoServico || 0) - al.valorAlocado);
        } else if (al.tipo === 'arquivo') {
          os.pagoArquivo = Math.max(0, (os.pagoArquivo || 0) - al.valorAlocado);
        } else if (al.tipo === 'terceiros') {
          os.pagoTerceiros = Math.max(0, (os.pagoTerceiros || 0) - al.valorAlocado);
        }

        recalculateOSPaymentStatus(os);
      }
    });
  }

  // 2. Revert credit draw if this was a credit use transaction
  if (dep.isCreditUse && dep.drawnFrom && dep.drawnFrom.length > 0) {
    dep.drawnFrom.forEach(draw => {
      const sourceDep = state.depositos.find(d => d.id === draw.depositId);
      if (sourceDep) {
        sourceDep.saldoDisponivel = (sourceDep.saldoDisponivel || 0) + draw.amount;
      }
    });
  }

  // 3. Remove the deposit
  state.depositos.splice(depIndex, 1);

  saveToLocalStorage();
  renderPagamentos();
}

// ================= REPORTS & PROFITABILITY VIEW =================

// Initializes and renders the Reports tab
function renderRelatorios() {
  const select = document.getElementById('rep-client-select');
  const currentValue = select.value;
  select.innerHTML = '<option value="">Selecione um Cliente</option>';
  state.clientes.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.nome}</option>`;
  });
  select.value = currentValue;

  document.getElementById('client-report-result').classList.add('hidden');
  document.getElementById('client-report-print-content').innerHTML = '';

  // Only render profit report if the profit tab is currently active
  const activeTab = document.querySelector('.report-tab-btn.active');
  if (activeTab && activeTab.dataset.tab === 'profit') {
    renderProfitReport();
  } else {
    // Ensure profit tab panel content is rendered when in default state
    renderProfitReport();
  }
}

// Renders profitability data (Faturamento, Gastos, Lucro, Margem) for all OSs
function renderProfitReport() {
  const tbody = document.getElementById('profit-table-body');
  tbody.innerHTML = '';

  const searchText = document.getElementById('rep-profit-search').value.toLowerCase();
  const dateStart = document.getElementById('profit-date-start').value;
  const dateEnd = document.getElementById('profit-date-end').value;

  let filtered = [...state.ordens];

  if (searchText) {
    filtered = filtered.filter(os => {
      const client = state.clientes.find(c => c.id === os.clienteId);
      const clientName = client ? client.nome.toLowerCase() : '';
      const osId = os.id.toLowerCase();
      const sub = os.subcliente ? os.subcliente.toLowerCase() : '';
      return clientName.includes(searchText) || osId.includes(searchText) || sub.includes(searchText);
    });
  }

  if (dateStart) {
    filtered = filtered.filter(os => os.dataOrdem >= dateStart);
  }
  if (dateEnd) {
    filtered = filtered.filter(os => os.dataOrdem <= dateEnd);
  }

  filtered.sort((a, b) => b.id.localeCompare(a.id));

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Nenhuma Ordem de Serviço encontrada.</td></tr>`;
    document.getElementById('tot-profit-faturamento').innerText = formatCurrency(0);
    document.getElementById('tot-profit-gastos').innerText = formatCurrency(0);
    document.getElementById('tot-profit-lucro').innerText = formatCurrency(0);
    document.getElementById('tot-profit-margem').innerText = '0%';
    return;
  }

  let sumFaturamento = 0;
  let sumRecebido = 0;
  let sumGastos = 0;
  let sumLucro = 0;

  filtered.forEach(os => {
    const client = state.clientes.find(c => c.id === os.clienteId);
    const clientName = client ? client.nome : 'Cliente Excluído';
    const subStr = os.subcliente ? ` (${os.subcliente})` : '';

    const faturamento = os.valorTotal || 0;

    let totalCustoProducao = 0;
    let totalCustoArquivos = 0;
    os.itens.forEach(item => {
      totalCustoProducao += (item.quantidade * (item.custoProducao || 0));
      if (item.arquivoNovo) {
        let fileCost = item.valorArquivoItem || 0;
        if (item.dividirCusto) {
          fileCost = fileCost / 2;
        }
        totalCustoArquivos += fileCost;
      }
    });
    const gastos = totalCustoProducao + (os.valorTerceiros || 0) + totalCustoArquivos + (() => {
      const vf = os.valorFrete || 0;
      const rf = os.responsavelFrete || 'minha-conta';
      if (rf === 'minha-conta') return vf;
      if (rf === 'dividido') return parseFloat((vf / 2).toFixed(2));
      return 0; // cliente paga tudo: frete já está no valorTotal como receita, sem custo meu
    })();

    const totalPago = (os.pagoServico || 0) + (os.pagoArquivo || 0);

    const lucro = faturamento - gastos;
    const margem = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    sumFaturamento += faturamento;
    sumRecebido += totalPago;
    sumGastos += gastos;
    sumLucro += lucro;

    const profitColor = lucro >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const marginColor = margem >= 30 ? 'var(--color-success)' : (margem >= 0 ? 'var(--border-focus)' : 'var(--color-danger)');

    tbody.innerHTML += `
      <tr>
        <td>
          <strong style="color: var(--border-focus); cursor: pointer; text-decoration: underline;" onclick="viewOSDetails('${os.id}')" title="Clique para ver detalhes">${os.id}</strong><br>
          <small class="text-muted">${formatDateBR(os.dataOrdem)}</small>
        </td>
        <td><strong>${clientName}</strong><span style="color: var(--color-info); font-size: 0.8rem; font-weight:600;">${subStr}</span></td>
        <td><span class="badge" style="background-color: hsla(224, 20%, 12%, 0.8); border: 1px solid var(--border-color); color: #fff; text-transform:none; font-size:0.75rem;">${os.origem || 'WhatsApp'}</span></td>
        <td><strong>${formatCurrency(totalPago)}</strong> <span class="text-muted" style="font-size:0.75rem;">/ ${formatCurrency(faturamento)}</span></td>
        <td style="color: var(--text-muted);">${formatCurrency(gastos)}</td>
        <td><strong style="color: ${profitColor};">${formatCurrency(lucro)}</strong></td>
        <td><strong style="color: ${marginColor};">${margem.toFixed(1)}%</strong></td>
      </tr>
    `;
  });

  const avgMargem = sumFaturamento > 0 ? (sumLucro / sumFaturamento) * 100 : 0;

  document.getElementById('tot-profit-faturamento').innerHTML = `${formatCurrency(sumRecebido)} <span class="text-muted" style="font-size:0.85rem; font-weight:500;">/ ${formatCurrency(sumFaturamento)}</span>`;
  document.getElementById('tot-profit-gastos').innerText = formatCurrency(sumGastos);
  document.getElementById('tot-profit-lucro').innerText = formatCurrency(sumLucro);
  document.getElementById('tot-profit-margem').innerText = `${avgMargem.toFixed(1)}%`;

  document.getElementById('tot-profit-lucro').style.color = sumLucro >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  document.getElementById('tot-profit-margem').style.color = avgMargem >= 30 ? 'var(--color-success)' : (avgMargem >= 0 ? 'var(--border-focus)' : 'var(--color-danger)');
}

// Generates printable client report (e.g. Erasmo) grouped by subclients
function generateClientReport() {
  const clientSelect = document.getElementById('rep-client-select');
  const clientId = clientSelect.value;
  const statusFilter = document.getElementById('rep-status-select').value;
  const prodStatusFilter = document.getElementById('rep-prod-status-select').value;
  const dateStart = document.getElementById('rep-date-start').value;
  const dateEnd = document.getElementById('rep-date-end').value;

  if (!clientId) {
    alert("Por favor, selecione um cliente para gerar o relatório.");
    return;
  }

  const layoutSelect = document.getElementById('rep-layout-select');
  const layout = layoutSelect ? layoutSelect.value : 'detalhado';
  
  const exportCsvBtn = document.getElementById('btn-export-client-csv-report');
  if (exportCsvBtn) {
    exportCsvBtn.style.display = layout === 'planilha' ? 'inline-flex' : 'none';
  }

  if (layout === 'planilha') {
    generateClientExcelReport(clientId, statusFilter, dateStart, dateEnd, prodStatusFilter);
    return;
  }
  if (layout === 'extrato') {
    generateClientStatementReport(clientId, dateStart, dateEnd);
    return;
  }

  const clientObj = state.clientes.find(c => c.id === clientId);
  const clientName = clientObj ? clientObj.nome : 'Cliente Desconhecido';

  let clientOSs = [];

  // Filter OSs based on production status (only include if ALL items match)
  state.ordens.forEach(os => {
    if (os.clienteId === clientId) {
      if (prodStatusFilter) {
        const allItemsMatch = os.itens.length > 0 && os.itens.every(item => item.estado === prodStatusFilter);
        if (allItemsMatch) {
          clientOSs.push(os);
        }
      } else {
        clientOSs.push(os);
      }
    }
  });

  if (statusFilter) {
    clientOSs = clientOSs.filter(os => os.estadoPagamento === statusFilter);
  }
  if (dateStart) {
    clientOSs = clientOSs.filter(os => os.dataOrdem >= dateStart);
  }
  if (dateEnd) {
    clientOSs = clientOSs.filter(os => os.dataOrdem <= dateEnd);
  }

  const reportResultDiv = document.getElementById('client-report-result');
  const printContent = document.getElementById('client-report-print-content');

  if (clientOSs.length === 0) {
    printContent.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhuma Ordem de Serviço encontrada com os filtros selecionados.</div>`;
    reportResultDiv.classList.remove('hidden');
    return;
  }

  const groups = {};
  clientOSs.forEach(os => {
    const sub = os.subcliente ? os.subcliente.trim() : 'Sem Subcliente / Geral';
    if (!groups[sub]) {
      groups[sub] = [];
    }
    groups[sub].push(os);
  });

  let periodText = '';
  if (dateStart && dateEnd) {
    periodText = ` | Período: ${formatDateBR(dateStart)} até ${formatDateBR(dateEnd)}`;
  } else if (dateStart) {
    periodText = ` | A partir de: ${formatDateBR(dateStart)}`;
  } else if (dateEnd) {
    periodText = ` | Até: ${formatDateBR(dateEnd)}`;
  }

  let html = `
    <div style="border-bottom: 2px solid var(--border-color); padding-bottom: 15px; margin-bottom: 25px;">
      <h2 style="font-family: var(--font-secondary); font-size: 1.6rem; color: #fff; display: flex; align-items: center; gap: 10px;">
        <i data-lucide="printer" style="color: var(--border-focus); width: 26px; height: 26px;"></i> Relatório de Pedidos do Cliente
      </h2>
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 4px;">
        Cliente Principal: <strong style="color: #fff; font-size: 1.05rem;">${clientName}</strong>${periodText} | Data do Relatório: ${formatDateBR(new Date().toISOString().split('T')[0])}
      </p>
    </div>
  `;

  let overallTotalSemArquivos = 0;
  let overallTotalArquivos = 0;
  let overallTotalGeral = 0;

  for (let subName in groups) {
    const list = groups[subName].sort((a, b) => b.id.localeCompare(a.id));

    let subTotalSemArquivos = 0;
    let subTotalArquivos = 0;
    let subTotalGeral = 0;

    let rowsHTML = '';

    list.forEach(os => {
      let osSemArquivos = 0;
      let osArquivos = 0;

      let itemDetailsHTML = os.itens.map(item => {
        const model = state.modelos.find(m => m.id === item.modeloId);
        const modelName = model ? model.nome : 'Modelo Removido';
        const itemVal = item.quantidade * item.valorUnitario;
        osSemArquivos += itemVal;

        let fileCost = 0;
        let fileText = 'Não';
        if (item.arquivoNovo) {
          fileCost = item.valorArquivoItem || 0;
          if (item.dividirCusto) {
            fileCost = fileCost / 2;
            fileText = `${formatCurrency(fileCost)} <span style="font-size: 0.65rem; opacity:0.75;">(Div.)</span>`;
          } else {
            fileText = `${formatCurrency(fileCost)}`;
          }
        }
        osArquivos += fileCost;

        let stateBadgeClass = 'badge-pendente';
        if (item.estado === 'Em Andamento') stateBadgeClass = 'badge-andamento';
        if (item.estado === 'Finalizado') stateBadgeClass = 'badge-pago';

        return `<div style="margin-bottom: 6px; font-size: 0.8rem; line-height: 1.4;">
          • <strong>${modelName}</strong> x${item.quantidade} <span class="text-muted">(${item.matricula || 'N/A'})</span> 
          - Unit: ${formatCurrency(item.valorUnitario)} | Arq: ${fileText} 
          <span class="badge ${stateBadgeClass}" style="padding: 1px 5px; font-size: 0.6rem; margin-left: 5px;">${item.estado}</span>
        </div>`;
      }).join('');

      osSemArquivos += (os.valorTerceiros || 0);
      if (os.valorTerceiros > 0) {
        itemDetailsHTML += `<div style="font-size: 0.8rem; color: var(--border-focus); margin-top: 4px;">
          + Serviço Terceirizado: <strong>${formatCurrency(os.valorTerceiros)}</strong>
        </div>`;
      }

      // Frete
      const vfRel = os.valorFrete || 0;
      const rfRel = os.responsavelFrete || 'minha-conta';
      let freteClienteValRel = 0;
      if (vfRel > 0) {
        if (rfRel === 'cliente') { freteClienteValRel = vfRel; }
        else if (rfRel === 'dividido') { freteClienteValRel = parseFloat((vfRel / 2).toFixed(2)); }
        if (freteClienteValRel > 0 || rfRel === 'minha-conta') {
          const freteDesc = rfRel === 'minha-conta' ? '(por conta AeroPrint)' :
            rfRel === 'dividido' ? '(50% do cliente)' : '(pago pelo cliente)';
          itemDetailsHTML += `<div style="font-size: 0.8rem; color: var(--color-warning, #f59e0b); margin-top: 4px;">
            🚚 Frete ${freteDesc}: <strong>${rfRel === 'minha-conta' ? formatCurrency(vfRel) : formatCurrency(freteClienteValRel)}</strong>
          </div>`;
        }
        osSemArquivos += freteClienteValRel;
      }

      const osTotal = osSemArquivos + osArquivos;

      subTotalSemArquivos += osSemArquivos;
      subTotalArquivos += osArquivos;
      subTotalGeral += osTotal;

      let payBadgeClass = 'badge-pendente';
      if (os.estadoPagamento === 'Pago') payBadgeClass = 'badge-pago';
      if (os.estadoPagamento === 'Pago Parcial') payBadgeClass = 'badge-parcial';

      rowsHTML += `
        <tr>
          <td><strong style="color: var(--border-focus); cursor: pointer; text-decoration: underline;" onclick="viewOSDetails('${os.id}')" title="Clique para ver detalhes">${os.id}</strong><br><small class="text-muted">${formatDateBR(os.dataOrdem)}</small></td>
          <td>${itemDetailsHTML}</td>
          <td><span class="badge ${payBadgeClass}">${os.estadoPagamento}</span></td>
          <td style="text-align: right; font-weight: 500;">${formatCurrency(osSemArquivos)}</td>
          <td style="text-align: right; font-weight: 500; color: var(--color-info);">${formatCurrency(osArquivos)}</td>
          <td style="text-align: right; font-weight: 700; color: var(--text-main);">${formatCurrency(osTotal)}</td>
        </tr>
      `;
    });

    overallTotalSemArquivos += subTotalSemArquivos;
    overallTotalArquivos += subTotalArquivos;
    overallTotalGeral += subTotalGeral;

    html += `
      <div style="margin-bottom: 30px; border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background-color: hsla(224, 20%, 8%, 0.25);">
        <div style="background-color: hsla(224, 20%, 12%, 0.8); padding: 12px 18px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
          <h3 style="font-size: 1.05rem; font-weight:700; color: var(--border-focus); margin:0;">
            Subcliente / Projeto: <span style="color: #fff;">${subName}</span>
          </h3>
          <span style="font-size: 0.85rem; color: var(--text-muted); font-weight:600;">Qtd Ordens: ${list.length}</span>
        </div>
        <div class="table-responsive">
          <table class="data-table" style="font-size: 0.85rem; width: 100%;">
            <thead>
              <tr>
                <th>Código (Data)</th>
                <th>Detalhes dos Itens / Aviões</th>
                <th>Pagamento</th>
                <th style="text-align: right;">Total s/ Arquivos</th>
                <th style="text-align: right;">Total Arquivos</th>
                <th style="text-align: right;">Total OS</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHTML}
            </tbody>
            <tfoot>
              <tr style="font-weight: 700; background-color: rgba(255,255,255,0.02); border-top: 1px solid var(--border-color);">
                <td colspan="3" style="padding: 12px 16px;">Subtotais (${subName}):</td>
                <td style="text-align: right; padding: 12px 16px;">${formatCurrency(subTotalSemArquivos)}</td>
                <td style="text-align: right; padding: 12px 16px; color: var(--color-info);">${formatCurrency(subTotalArquivos)}</td>
                <td style="text-align: right; padding: 12px 16px; color: var(--color-success); font-size:1.05rem;">${formatCurrency(subTotalGeral)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  html += `
    <div style="background-color: hsla(224, 20%, 6%, 0.6); border: 2px solid var(--border-focus); border-radius: 12px; padding: 22px; margin-top: 25px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Total sem Arquivos</span>
        <h3 style="font-size: 1.45rem; margin-top: 6px; color: var(--text-main); font-weight:800;">${formatCurrency(overallTotalSemArquivos)}</h3>
      </div>
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Total de Arquivos 3D</span>
        <h3 style="font-size: 1.45rem; margin-top: 6px; color: var(--color-info); font-weight:800;">${formatCurrency(overallTotalArquivos)}</h3>
      </div>
      <div style="text-align: center;">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Valor Total Geral</span>
        <h3 style="font-size: 1.55rem; margin-top: 6px; color: var(--color-success); font-weight:800;">${formatCurrency(overallTotalGeral)}</h3>
      </div>
    </div>
  `;

  printContent.innerHTML = html;
  reportResultDiv.classList.remove('hidden');
  lucide.createIcons();

  reportResultDiv.scrollIntoView({ behavior: 'smooth' });
}

// Generates Excel-style table client report (as requested by user)
function generateClientExcelReport(clientId, statusFilter, dateStart, dateEnd, prodStatusFilter = '') {
  const clientObj = state.clientes.find(c => c.id === clientId);
  const clientName = clientObj ? clientObj.nome : 'Cliente Desconhecido';

  let clientOSs = [];

  // Filter OSs based on production status (only include if ALL items match)
  state.ordens.forEach(os => {
    if (os.clienteId === clientId) {
      if (prodStatusFilter) {
        const allItemsMatch = os.itens.length > 0 && os.itens.every(item => item.estado === prodStatusFilter);
        if (allItemsMatch) {
          clientOSs.push(os);
        }
      } else {
        clientOSs.push(os);
      }
    }
  });

  if (statusFilter) {
    clientOSs = clientOSs.filter(os => os.estadoPagamento === statusFilter);
  }
  if (dateStart) {
    clientOSs = clientOSs.filter(os => os.dataOrdem >= dateStart);
  }
  if (dateEnd) {
    clientOSs = clientOSs.filter(os => os.dataOrdem <= dateEnd);
  }

  const reportResultDiv = document.getElementById('client-report-result');
  const printContent = document.getElementById('client-report-print-content');

  if (clientOSs.length === 0) {
    printContent.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhuma Ordem de Serviço encontrada com os filtros selecionados.</div>`;
    reportResultDiv.classList.remove('hidden');
    return;
  }

  const groups = {};
  clientOSs.forEach(os => {
    const sub = os.subcliente ? os.subcliente.trim() : 'Sem Subcliente / Geral';
    if (!groups[sub]) {
      groups[sub] = [];
    }
    groups[sub].push(os);
  });

  let periodText = '';
  if (dateStart && dateEnd) {
    periodText = ` | Período: ${formatDateBR(dateStart)} até ${formatDateBR(dateEnd)}`;
  } else if (dateStart) {
    periodText = ` | A partir de: ${formatDateBR(dateStart)}`;
  } else if (dateEnd) {
    periodText = ` | Até: ${formatDateBR(dateEnd)}`;
  }

  let html = `
    <div style="border-bottom: 2px solid var(--border-color); padding-bottom: 15px; margin-bottom: 25px;">
      <h2 style="font-family: var(--font-secondary); font-size: 1.6rem; color: #fff; display: flex; align-items: center; gap: 10px;">
        <i data-lucide="printer" style="color: var(--border-focus); width: 26px; height: 26px;"></i> Relatório de Pedidos (Estilo Planilha)
      </h2>
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 4px;">
        Cliente Principal: <strong style="color: #fff; font-size: 1.05rem;">${clientName}</strong>${periodText} | Data do Relatório: ${formatDateBR(new Date().toISOString().split('T')[0])}
      </p>
    </div>
    <div class="table-responsive" style="overflow-x: auto;">
      <table class="excel-report-table">
  `;

  let overallTotalSemArquivos = 0;
  let overallTotalArquivos = 0;
  let overallTotalGeral = 0;
  let overallTotalQtd = 0;

  let isFirstGroup = true;

  for (let subName in groups) {
    const list = groups[subName].sort((a, b) => b.id.localeCompare(a.id));

    if (!isFirstGroup) {
      html += `
        <tr class="excel-spacer-row">
          <td colspan="12" style="border:none !important; background:transparent !important;"></td>
        </tr>
      `;
    }
    isFirstGroup = false;

    html += `
      <tr class="excel-header-row">
        <th>nº os</th>
        <th>cliente</th>
        <th>pagamento</th>
        <th>modelo</th>
        <th>matricula</th>
        <th>estado</th>
        <th>qtd</th>
        <th>vlr</th>
        <th>total</th>
        <th>arquivo</th>
        <th>total pedido</th>
        <th>arquivo</th>
        <th>Data</th>
      </tr>
    `;

    list.forEach(os => {
      const hasTerceiros = (os.valorTerceiros || 0) > 0;
      const numItems = os.itens.length;
      const N = numItems + (hasTerceiros ? 1 : 0);

      let totalPedidoModelos = 0;
      let totalArquivosOS = 0;

      os.itens.forEach(item => {
        totalPedidoModelos += item.quantidade * item.valorUnitario;
        overallTotalQtd += item.quantidade;
        if (item.arquivoNovo && item.dividirCusto) {
          totalArquivosOS += (item.valorArquivoItem / 2);
        }
      });

      if (hasTerceiros) {
        totalPedidoModelos += os.valorTerceiros;
        overallTotalQtd += 1;
      }

      const osTotal = totalPedidoModelos + totalArquivosOS;

      overallTotalSemArquivos += totalPedidoModelos;
      overallTotalArquivos += totalArquivosOS;
      overallTotalGeral += osTotal;

      let payClass = '';
      if (os.estadoPagamento === 'Pago') payClass = 'excel-pay-pago';
      else if (os.estadoPagamento === 'Pago Parcial') payClass = 'excel-pay-parcial';
      else payClass = 'excel-pay-pendente';

      for (let i = 0; i < N; i++) {
        let isVirtualTerceiro = (i === numItems);
        let modelName = '';
        let matricula = '';
        let estado = '';
        let quantity = 0;
        let valorUnitario = 0;
        let itemTotal = 0;
        let fileText = '-';
        let itemStateClass = '';

        if (!isVirtualTerceiro) {
          const item = os.itens[i];
          const model = state.modelos.find(m => m.id === item.modeloId);
          modelName = model ? model.nome : 'Modelo Removido';
          matricula = item.matricula || '';
          estado = item.estado;
          quantity = item.quantidade;
          valorUnitario = item.valorUnitario;
          itemTotal = quantity * valorUnitario;

          if (item.arquivoNovo) {
            let fileCost = item.valorArquivoItem || 0;
            if (item.dividirCusto) {
              fileCost = fileCost / 2;
              fileText = `${formatCurrency(fileCost)} <span style="font-size: 0.65rem; opacity:0.8;">(Div. 50%)</span>`;
            } else {
              fileText = `-`;
            }
          }

          if (estado === 'Finalizado') {
            itemStateClass = 'excel-cell-completed';
          }
        } else {
          const supplier = state.fornecedores.find(f => f.id === os.fornecedorId);
          modelName = supplier ? `Serviço Terceirizado (${supplier.nome})` : 'Serviço Terceirizado / Outros';
          matricula = '-';
          estado = 'Finalizado';
          quantity = 1;
          valorUnitario = os.valorTerceiros;
          itemTotal = os.valorTerceiros;
          itemStateClass = 'excel-cell-completed';
        }

        html += `<tr>`;

        if (i === 0) {
          const displayClientText = os.subcliente ? `${clientName} / ${os.subcliente}` : clientName;
          html += `
            <td rowspan="${N}" style="text-align: center; font-weight: 600; color: var(--text-muted);">#${os.id}</td>
            <td rowspan="${N}" style="font-weight: 600; white-space: nowrap;">${displayClientText}</td>
            <td rowspan="${N}" class="${payClass}" style="text-align: center;">${os.estadoPagamento}</td>
          `;
        }

        html += `
          <td class="${itemStateClass}">${modelName}</td>
          <td class="${itemStateClass}" style="text-align: center;">${matricula}</td>
          <td class="${itemStateClass}" style="text-align: center;">${estado}</td>
          <td style="text-align: center; font-weight: 600;">${quantity}</td>
          <td style="text-align: right;">${formatCurrency(valorUnitario)}</td>
          <td style="text-align: right; font-weight: 600;">${formatCurrency(itemTotal)}</td>
          <td style="text-align: right;">${fileText}</td>
        `;

        if (i === 0) {
          html += `
            <td rowspan="${N}" class="${payClass}" style="text-align: right; font-weight: 700;">${formatCurrency(totalPedidoModelos)}</td>
            <td rowspan="${N}" style="text-align: right; font-weight: 600;">${totalArquivosOS > 0 ? formatCurrency(totalArquivosOS) : '-'}</td>
            <td rowspan="${N}" style="text-align: center; white-space: nowrap;">${formatDateBR(os.dataOrdem)}</td>
          `;
        }

        html += `</tr>`;
      }
    });
  }

  html += `
      </table>
    </div>
  `;

  html += `
    <div style="background-color: hsla(224, 20%, 6%, 0.6); border: 2px solid var(--border-focus); border-radius: 12px; padding: 22px; margin-top: 25px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Total de Aviões</span>
        <h3 style="font-size: 1.45rem; margin-top: 6px; color: var(--text-main); font-weight:800;">${overallTotalQtd}</h3>
      </div>
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Total s/ Arquivos</span>
        <h3 style="font-size: 1.45rem; margin-top: 6px; color: var(--text-main); font-weight:800;">${formatCurrency(overallTotalSemArquivos)}</h3>
      </div>
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Total Arquivos 3D</span>
        <h3 style="font-size: 1.45rem; margin-top: 6px; color: var(--color-info); font-weight:800;">${formatCurrency(overallTotalArquivos)}</h3>
      </div>
      <div style="text-align: center;">
        <span class="help-text" style="font-size: 0.8rem; font-weight:600; text-transform: uppercase;">Faturamento Total</span>
        <h3 style="font-size: 1.55rem; margin-top: 6px; color: var(--color-success); font-weight:800;">${formatCurrency(overallTotalGeral)}</h3>
      </div>
    </div>
  `;

  printContent.innerHTML = html;
  reportResultDiv.classList.remove('hidden');
  lucide.createIcons();

  reportResultDiv.scrollIntoView({ behavior: 'smooth' });
}

// ================= AI ASSISTANT: OPENAI API =================
async function fetchOpenAI(apiKey, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: "json_object" },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })
  });

  if (!response.ok) {
    throw new Error(`Erro na API OpenAI: HTTP ${response.status}`);
  }

  const data = await response.json();
  let jsonText = data.choices[0].message.content.trim();

  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  }
  return jsonText;
}

async function runAiForName() {
  const apiKey = localStorage.getItem('aeroprint_openai_key');
  if (!apiKey) return alert("Por favor, configure sua OpenAI API Key na aba de Configurações primeiro.");

  const nameInput = document.getElementById('qm-nome');
  const statusSpan = document.getElementById('ai-name-status');
  const plane = nameInput.value.trim();
  if (!plane) return alert("Preencha o 'Nome do Modelo' para que a IA possa corrigi-lo.");

  statusSpan.innerText = "Consultando...";
  statusSpan.style.color = "var(--text-muted)";
  document.getElementById('ai-name-options').style.display = 'none';

  const prompt = `You are an aviation expert. The user entered the aircraft model name: "${plane}".
  Your task is to fix typos and return the full, correct official name. 
  If the user included a scale or size (e.g., "43cm", "1:48") at the end, keep it in the final string.
  If the input is ambiguous or refers to an aircraft family with multiple variants (e.g. "AS350", "Boeing 737", "Cessna 172"), provide up to 4 specific popular variants as options.
  If it's clear and specific, just return 1 option.
  
  Return a JSON object exactly like this schema:
  {
    "opcoes": [
      {
        "nomeCorrigido": "Full correct aircraft name (plus scale if provided)"
      }
    ],
    "erro": ""
  }`;

  try {
    const dataText = await fetchOpenAI(apiKey, prompt);
    const result = JSON.parse(dataText);
    if (result.erro) throw new Error(result.erro);

    if (result.opcoes && result.opcoes.length > 1) {
      statusSpan.innerText = "Múltiplas opções. Escolha abaixo:";
      statusSpan.style.color = "var(--color-warning)";

      const optionsContainer = document.getElementById('ai-name-options');
      const listContainer = document.getElementById('ai-name-options-list');
      listContainer.innerHTML = '';

      result.opcoes.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-sm';
        btn.style.textAlign = 'left';
        btn.style.justifyContent = 'flex-start';
        btn.innerHTML = `<strong>${opt.nomeCorrigido}</strong>`;
        btn.onclick = () => {
          nameInput.value = opt.nomeCorrigido;
          optionsContainer.style.display = 'none';
          statusSpan.innerText = "Nome aplicado com sucesso!";
          statusSpan.style.color = "var(--color-success)";
        };
        listContainer.appendChild(btn);
      });
      optionsContainer.style.display = 'flex';
    } else if (result.opcoes && result.opcoes.length === 1) {
      nameInput.value = result.opcoes[0].nomeCorrigido;
      statusSpan.innerText = "Nome corrigido com sucesso!";
      statusSpan.style.color = "var(--color-success)";
    } else {
      throw new Error("Nenhuma opção retornada.");
    }
  } catch (err) {
    console.error(err);
    statusSpan.innerText = "Falha ao consultar IA";
    statusSpan.style.color = "var(--color-danger)";
    alert(err.message);
  }
}

async function runAiForVariantScale(index) {
  const apiKey = localStorage.getItem('aeroprint_openai_key');
  if (!apiKey) return alert("Por favor, configure sua OpenAI API Key na aba de Configurações primeiro.");

  const nameInput = document.getElementById('qm-nome');
  const scaleInput = document.getElementById(`qm-var-escala-${index}`);
  const statusSpan = document.getElementById(`ai-variant-status-${index}`);
  const plane = nameInput.value.trim();
  const scale = scaleInput.value.trim();

  if (!plane) return alert("Preencha o 'Nome do Modelo' primeiro para calcular as medidas.");

  statusSpan.innerText = "Calculando...";
  statusSpan.style.color = "var(--text-muted)";
  document.getElementById(`ai-variant-options-${index}`).style.display = 'none';

  let prompt;
  if (scale) {
    prompt = `You are an aviation expert. The aircraft model is: "${plane}".
    The target scale or size is: "${scale}".
    
    STEP 1: Find the real-world length and wingspan of this exact aircraft model in meters. (Be very precise, e.g. Aero Boero AB-115 has 10.72m wingspan).
    STEP 2: Convert those real-world dimensions to centimeters (multiply by 100).
    STEP 3: 
    - If a scale ratio is provided (e.g. "1:32"): Divide the real-world centimeters by the scale denominator.
    - If a target length is provided (e.g. "43cm"): The model length (comprimentoCm) is exactly that number. Then, calculate the wingspan (envergaduraCm) proportionally using the real-world ratio.
    
    Return a JSON object exactly like this schema:
    {
      "passo_a_passo": "Explain your math here. 1) Real length in m. 2) Real wingspan in m. 3) Calculation.",
      "opcoes": [
        {
          "escala": "${scale}",
          "comprimentoCm": [calculated length in cm as a number],
          "envergaduraCm": [calculated wingspan in cm as a number]
        }
      ],
      "erro": ""
    }`;
  } else {
    prompt = `You are an aviation expert. The aircraft model is: "${plane}".
    The user did NOT specify a scale or size.
    
    STEP 1: Find the real-world length and wingspan of this exact aircraft model in meters. (Be very precise, e.g. Aero Boero AB-115 has 10.72m wingspan). Convert them to centimeters.
    STEP 2: Suggest 3 or 4 of the most popular scales or sizes (e.g. "1:48", "1:32", "43cm", "22cm") for this specific aircraft.
    STEP 3: For each suggested option, calculate the exact dimensions in centimeters using the rules: divide real cm by scale denominator, or use proportional math for fixed cm lengths.
    
    Return a JSON object exactly like this schema:
    {
      "passo_a_passo": "Explain your math here. 1) Real length in m. 2) Real wingspan in m. 3) Calculation.",
      "opcoes": [
        {
          "escala": "The scale or size (e.g. 1:48)",
          "comprimentoCm": [calculated length in cm as a number],
          "envergaduraCm": [calculated wingspan in cm as a number]
        }
      ],
      "erro": ""
    }`;
  }

  try {
    const dataText = await fetchOpenAI(apiKey, prompt);
    const result = JSON.parse(dataText);
    if (result.erro) throw new Error(result.erro);

    if (result.opcoes && result.opcoes.length > 1) {
      statusSpan.innerText = "Escolha uma escala sugerida:";
      statusSpan.style.color = "var(--color-warning)";

      const optionsContainer = document.getElementById(`ai-variant-options-${index}`);
      const listContainer = document.getElementById(`ai-variant-options-list-${index}`);
      listContainer.innerHTML = '';

      result.opcoes.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-sm';
        btn.style.textAlign = 'left';
        btn.style.justifyContent = 'flex-start';
        btn.innerHTML = `<strong>${opt.escala}</strong> <span style="opacity:0.7; font-size:0.7rem; margin-left:auto;">${parseFloat(opt.comprimentoCm).toFixed(1)}x${parseFloat(opt.envergaduraCm).toFixed(1)}cm</span>`;
        btn.onclick = () => {
          scaleInput.value = opt.escala;
          document.getElementById(`qm-var-comprimento-${index}`).value = parseFloat(opt.comprimentoCm).toFixed(1);
          document.getElementById(`qm-var-envergadura-${index}`).value = parseFloat(opt.envergaduraCm).toFixed(1);
          syncVariant(index, 'escala', opt.escala);
          syncVariant(index, 'comprimento', opt.comprimentoCm);
          syncVariant(index, 'envergadura', opt.envergaduraCm);
          optionsContainer.style.display = 'none';
          statusSpan.innerText = "Escala e medidas aplicadas!";
          statusSpan.style.color = "var(--color-success)";
        };
        listContainer.appendChild(btn);
      });
      optionsContainer.style.display = 'flex';
    } else if (result.opcoes && result.opcoes.length === 1) {
      const opt = result.opcoes[0];
      scaleInput.value = opt.escala || scale;
      document.getElementById(`qm-var-comprimento-${index}`).value = parseFloat(opt.comprimentoCm).toFixed(1);
      document.getElementById(`qm-var-envergadura-${index}`).value = parseFloat(opt.envergaduraCm).toFixed(1);
      syncVariant(index, 'escala', opt.escala || scale);
      syncVariant(index, 'comprimento', opt.comprimentoCm);
      syncVariant(index, 'envergadura', opt.envergaduraCm);
      statusSpan.innerText = "Medidas calculadas!";
      statusSpan.style.color = "var(--color-success)";
    } else {
      throw new Error("Nenhuma opção retornada.");
    }
  } catch (err) {
    console.error(err);
    statusSpan.innerText = "Falha ao consultar IA";
    statusSpan.style.color = "var(--color-danger)";
    alert(err.message);
  }
}

// Generates printable financial statement report of client credits and deposits
function generateClientStatementReport(clientId, dateStart, dateEnd) {
  const clientObj = state.clientes.find(c => c.id === clientId);
  const clientName = clientObj ? clientObj.nome : 'Cliente Desconhecido';

  const reportResultDiv = document.getElementById('client-report-result');
  const printContent = document.getElementById('client-report-print-content');

  let clientDeposits = (state.depositos || [])
    .filter(d => d.pagadorId === clientId);

  if (dateStart) {
    clientDeposits = clientDeposits.filter(d => d.data >= dateStart);
  }
  if (dateEnd) {
    clientDeposits = clientDeposits.filter(d => d.data <= dateEnd);
  }

  clientDeposits.sort((a, b) => new Date(a.data) - new Date(b.data) || a.id.localeCompare(b.id));

  if (clientDeposits.length === 0) {
    const periodMsg = (dateStart || dateEnd) ? ' no período selecionado' : '';
    printContent.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Nenhum depósito ou movimentação de crédito encontrada para este cliente${periodMsg}.</div>`;
    reportResultDiv.classList.remove('hidden');
    return;
  }

  let totalDeposited = 0;
  let totalAllocatedDirectly = 0;
  let totalCreditGenerated = 0;
  let totalCreditConsumed = 0;

  let rowsHTML = '';

  clientDeposits.forEach(d => {
    const allocatedDirectly = (d.alocacoes || []).reduce((sum, al) => sum + (al.valorAlocado || 0), 0);

    let description = '';
    let valorStr = '';
    let creditGenerated = 0;
    let creditRemaining = 0;
    let creditConsumed = 0;

    if (d.isCreditUse) {
      description = `Uso de Crédito Acumulado`;
      valorStr = `<span style="color: var(--color-danger); font-weight:700;">-${formatCurrency(d.valor)}</span>`;
      creditConsumed = d.valor;
      totalCreditConsumed += d.valor;
    } else {
      description = `Depósito Pix/Dinheiro`;
      valorStr = `<span style="color: var(--text-main); font-weight:700;">${formatCurrency(d.valor)}</span>`;
      creditGenerated = Math.max(0, d.valor - allocatedDirectly);
      creditRemaining = d.saldoDisponivel || 0;
      creditConsumed = Math.max(0, creditGenerated - creditRemaining);

      totalDeposited += d.valor;
      totalAllocatedDirectly += allocatedDirectly;
      totalCreditGenerated += creditGenerated;
      totalCreditConsumed += creditConsumed;
    }

    if (d.observacao) {
      description += `<br><small class="text-muted" style="font-style: italic;">Obs: ${d.observacao}</small>`;
    }

    let allocsHTML = '';
    if (d.alocacoes && d.alocacoes.length > 0) {
      allocsHTML = d.alocacoes.map(al => {
        let typeStr = 'Serviço';
        if (al.tipo === 'arquivo') typeStr = 'Arquivo 3D';
        if (al.tipo === 'terceiros') typeStr = 'Terceirizados';
        return `<div style="font-size:0.78rem; margin-top:2px;">
          <strong>${formatCurrency(al.valorAlocado)}</strong> na <strong style="color: var(--accent); cursor: pointer; text-decoration: underline;" onclick="viewOSDetails('${al.osId}')" title="Clique para ver a OS">${al.osId}</strong> (${typeStr})
        </div>`;
      }).join('');
    } else {
      allocsHTML = '<span class="text-muted">-</span>';
    }

    rowsHTML += `
      <tr>
        <td><strong>${formatDateBR(d.data)}</strong></td>
        <td>${description}</td>
        <td>${valorStr}</td>
        <td><span style="color: ${creditGenerated > 0 ? 'var(--color-success)' : 'var(--text-muted)'}; font-weight: 500;">${creditGenerated > 0 ? formatCurrency(creditGenerated) : '-'}</span></td>
        <td><span style="color: ${creditConsumed > 0 ? 'var(--color-danger)' : 'var(--text-muted)'};">${creditConsumed > 0 ? formatCurrency(creditConsumed) : '-'}</span></td>
        <td><span style="color: ${creditRemaining > 0 ? 'var(--color-success)' : 'var(--text-muted)'}; font-weight: 600;">${creditRemaining > 0 ? formatCurrency(creditRemaining) : '-'}</span></td>
        <td>${allocsHTML}</td>
      </tr>
    `;
  });

  const credits = getClientCredits();
  const currentCreditBalance = credits[clientId] || 0;

  let periodText = '';
  if (dateStart && dateEnd) {
    periodText = ` Período: ${formatDateBR(dateStart)} até ${formatDateBR(dateEnd)}`;
  } else if (dateStart) {
    periodText = ` A partir de: ${formatDateBR(dateStart)}`;
  } else if (dateEnd) {
    periodText = ` Até: ${formatDateBR(dateEnd)}`;
  }

  const periodHeaderStr = periodText ? ` | <span style="font-size: 0.9rem; color: var(--color-info); font-weight: 500;">${periodText}</span>` : '';

  let html = `
    <div style="border-bottom: 2px solid var(--border-color); padding-bottom: 15px; margin-bottom: 25px;">
      <h2 style="font-family: var(--font-secondary); font-size: 1.6rem; color: #fff; display: flex; align-items: center; gap: 10px;">
        <i data-lucide="printer" style="color: var(--border-focus); width: 26px; height: 26px;"></i> Extrato Financeiro de Créditos & Depósitos
      </h2>
      <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 4px;">
        Cliente: <strong style="color: #fff; font-size: 1.05rem;">${clientName}</strong>${periodHeaderStr} | Data do Extrato: ${formatDateBR(new Date().toISOString().split('T')[0])}
      </p>
    </div>
    
    <div style="margin-bottom: 30px; border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background-color: hsla(224, 20%, 8%, 0.25);">
      <div class="table-responsive">
        <table class="data-table" style="font-size: 0.85rem; width: 100%;">
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição / Tipo</th>
              <th>Valor do Lançamento</th>
              <th>Crédito Gerado</th>
              <th>Crédito Consumido</th>
              <th>Saldo do Depósito</th>
              <th>Destino / Alocações OS</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHTML}
          </tbody>
        </table>
      </div>
    </div>
    
    <div style="background-color: hsla(224, 20%, 6%, 0.6); border: 2px solid var(--border-focus); border-radius: 12px; padding: 22px; margin-top: 25px; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 20px;">
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.78rem; font-weight:600; text-transform: uppercase;">Total Depositado</span>
        <h3 style="font-size: 1.35rem; margin-top: 6px; color: var(--text-main); font-weight:800;">${formatCurrency(totalDeposited)}</h3>
      </div>
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.78rem; font-weight:600; text-transform: uppercase;">Alocado Diretam.</span>
        <h3 style="font-size: 1.35rem; margin-top: 6px; color: var(--text-secondary); font-weight:800;">${formatCurrency(totalAllocatedDirectly)}</h3>
      </div>
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.78rem; font-weight:600; text-transform: uppercase;">Crédito Gerado</span>
        <h3 style="font-size: 1.35rem; margin-top: 6px; color: var(--color-info); font-weight:800;">${formatCurrency(totalCreditGenerated)}</h3>
      </div>
      <div style="text-align: center; border-right: 1px solid var(--border-color);">
        <span class="help-text" style="font-size: 0.78rem; font-weight:600; text-transform: uppercase;">Crédito Consumido</span>
        <h3 style="font-size: 1.35rem; margin-top: 6px; color: var(--color-danger); font-weight:800;">${formatCurrency(totalCreditConsumed)}</h3>
      </div>
      <div style="text-align: center;">
        <span class="help-text" style="font-size: 0.78rem; font-weight:600; text-transform: uppercase;">Saldo Crédito Atual</span>
        <h3 style="font-size: 1.45rem; margin-top: 6px; color: var(--color-success); font-weight:800;">${formatCurrency(currentCreditBalance)}</h3>
      </div>
    </div>
  `;

  printContent.innerHTML = html;
  reportResultDiv.classList.remove('hidden');
  lucide.createIcons();

  reportResultDiv.scrollIntoView({ behavior: 'smooth' });
}
