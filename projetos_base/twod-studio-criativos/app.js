// TWOD Criativos Studio - Logic, Multi-Language, Multi-Block, Accordion por Dia e Checkbox OK

// State
let currentCampaign = null;
let campaignsList = [];
let currentTab = 'quadrados'; // 'quadrados' | 'reels'
let currentBloco = 'A'; // 'A' | 'B'
let currentLanguage = 'pt'; // 'pt' | 'es' | 'en'
let openDays = { 'Segunda-feira': true }; // Accordion state

// Persistence for Completed "OK" Campaigns
let completedCampaigns = {};
try {
  completedCampaigns = JSON.parse(localStorage.getItem('twod_completed_campaigns') || '{}');
} catch (e) {
  completedCampaigns = {};
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setupApiKey();
  loadInitialData();
  setupDropzone();
  setupTabs();
});

// Sidebar Tabs Switcher: Campanhas vs Fila de Imagens
function switchSidebarTab(tabName) {
  const btnCampanhas = document.getElementById('tabNavCampanhas');
  const btnImagens = document.getElementById('tabNavImagens');
  const viewCampanhas = document.getElementById('sidebarViewCampanhas');
  const viewImagens = document.getElementById('sidebarViewImagens');

  if (tabName === 'campanhas') {
    if (btnCampanhas) btnCampanhas.classList.add('active');
    if (btnImagens) btnImagens.classList.remove('active');
    if (viewCampanhas) viewCampanhas.style.display = 'flex';
    if (viewImagens) viewImagens.style.display = 'none';
  } else {
    if (btnImagens) btnImagens.classList.add('active');
    if (btnCampanhas) btnCampanhas.classList.remove('active');
    if (viewImagens) viewImagens.style.display = 'flex';
    if (viewCampanhas) viewCampanhas.style.display = 'none';
    renderQueueList();
  }
}

// File naming convention: 1.png to 6.png for PT, with language code for EN and ES (1en.png, 1es.png)
function getImageFileName(index, lang = currentLanguage) {
  const num = index + 1; // 1 to 6
  if (lang === 'en') return `${num}en.png`;
  if (lang === 'es') return `${num}es.png`;
  return `${num}.png`;
}

// Helper to access or initialize campaign images store
function getCampaignImagesStore(campaign = currentCampaign, bloco = currentBloco, lang = currentLanguage) {
  if (!campaign) return {};
  if (!campaign.images) {
    campaign.images = {
      A: { pt: {}, es: {}, en: {} },
      B: { pt: {}, es: {}, en: {} }
    };
  }
  if (!campaign.images[bloco]) {
    campaign.images[bloco] = { pt: {}, es: {}, en: {} };
  }
  if (!campaign.images[bloco][lang]) {
    campaign.images[bloco][lang] = {};
  }
  return campaign.images[bloco][lang];
}

// Sample Generated Images for Campaign 1 (Bingo ao Vivo)
function getSampleBingoImages() {
  return {
    A: {
      pt: {
        0: { status: 'ready', url: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1080&h=1080&fit=crop', prompt: 'Família reunida no sofá jogando bingo no celular' },
        1: { status: 'ready', url: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?w=1080&h=1080&fit=crop', prompt: 'Mãos segurando smartphone com cartela de bingo iluminada' },
        2: { status: 'ready', url: 'https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=1080&h=1080&fit=crop', prompt: 'Avó e neta vibrando vitória do bingo na sala' },
        3: { status: 'ready', url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1080&h=1920&fit=crop', prompt: 'Reel vertical advertorial com gancho' },
        4: { status: 'ready', url: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1080&h=1920&fit=crop', prompt: 'Reel vertical clean hands holding phone' },
        5: { status: 'ready', url: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=1080&h=1920&fit=crop', prompt: 'Reel vertical lifestyle vitória bingo' }
      },
      es: {
        0: { status: 'ready', url: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1080&h=1080&fit=crop' },
        1: { status: 'ready', url: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?w=1080&h=1080&fit=crop' },
        2: { status: 'ready', url: 'https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=1080&h=1080&fit=crop' },
        3: { status: 'ready', url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1080&h=1920&fit=crop' },
        4: { status: 'ready', url: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1080&h=1920&fit=crop' },
        5: { status: 'ready', url: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=1080&h=1920&fit=crop' }
      },
      en: {
        0: { status: 'ready', url: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1080&h=1080&fit=crop' },
        1: { status: 'ready', url: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?w=1080&h=1080&fit=crop' },
        2: { status: 'ready', url: 'https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=1080&h=1080&fit=crop' },
        3: { status: 'ready', url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1080&h=1920&fit=crop' },
        4: { status: 'ready', url: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1080&h=1920&fit=crop' },
        5: { status: 'ready', url: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=1080&h=1920&fit=crop' }
      }
    },
    B: {
      pt: {
        0: { status: 'ready', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080&h=1080&fit=crop', prompt: 'Ilustração 2D flat colorida de bingo moderno' },
        1: { status: 'ready', url: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=1080&h=1080&fit=crop', prompt: 'Render 3D globo de bingo com bolinhas douradas' },
        2: { status: 'ready', url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1080&h=1080&fit=crop', prompt: 'Design tipográfico amarelo e roxo vibrante' },
        3: { status: 'ready', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&h=1920&fit=crop', prompt: 'Reel vertical flat moderno' },
        4: { status: 'ready', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080&h=1920&fit=crop', prompt: 'Reel vertical 3D render' },
        5: { status: 'ready', url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1080&h=1920&fit=crop', prompt: 'Reel vertical tipográfico' }
      },
      es: {
        0: { status: 'ready', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080&h=1080&fit=crop' },
        1: { status: 'ready', url: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=1080&h=1080&fit=crop' },
        2: { status: 'ready', url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1080&h=1080&fit=crop' },
        3: { status: 'ready', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&h=1920&fit=crop' },
        4: { status: 'ready', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&h=1920&fit=crop' },
        5: { status: 'ready', url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1080&h=1920&fit=crop' }
      },
      en: {
        0: { status: 'ready', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1080&h=1080&fit=crop' },
        1: { status: 'ready', url: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?w=1080&h=1080&fit=crop' },
        2: { status: 'ready', url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1080&h=1080&fit=crop' },
        3: { status: 'ready', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&h=1920&fit=crop' },
        4: { status: 'ready', url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1080&h=1920&fit=crop' },
        5: { status: 'ready', url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=1080&h=1920&fit=crop' }
      }
    }
  };
}

// Load Initial Data
function loadInitialData() {
  if (typeof SEMANA_18_DATA !== 'undefined' && Array.isArray(SEMANA_18_DATA) && SEMANA_18_DATA.length > 0) {
    campaignsList = SEMANA_18_DATA.map((c, i) => {
      let generatedA = null;
      let generatedB = null;
      let sampleImages = null;
      if (i === 0) {
        generatedA = getSampleBingoGeneratedA();
        generatedB = getSampleBingoGeneratedB();
        sampleImages = getSampleBingoImages();
      }
      return {
        id: c.id || `campanha-${i + 1}`,
        page: c.index || (i + 1),
        title: cleanCampaignTitle(c.title || `Campanha ${i + 1}`),
        audio: c.audio || '',
        blocoA: c.blocoA || {},
        blocoB: c.blocoB || {},
        rawText: `Campanha: ${c.title}\nÁudio: ${c.audio}\nBloco A: ${JSON.stringify(c.blocoA)}\nBloco B: ${JSON.stringify(c.blocoB)}`,
        generatedA: generatedA,
        generatedB: generatedB,
        generated: generatedA,
        images: sampleImages
      };
    });

    document.getElementById('campaignsCount').textContent = `${campaignsList.length} campanhas`;
    renderCampaignsList();
    selectCampaign(campaignsList[0]);
    renderQueueList();
    showToast(`Semana 18 carregada: ${campaignsList.length} campanhas prontas!`);
  } else {
    const fallback = {
      id: 'campanha-1',
      page: 1,
      title: '1. Bingo ao Vivo - Segunda',
      audio: 'Bateu a saudade de marcar a cartela e gritar bingo? Baixe esse aplicativo grátis e entre nas rodadas de bingo ao vivo com gente de todo o Brasil, a qualquer hora. Baixe agora grátis.',
      blocoA: {
        estilo1: 'Advertorial com Foto Real',
        estilo2: 'Clean com Foto',
        estilo3: 'Foto Full-BG',
        reels: 'Margens: 250px livres topo e 350px base'
      },
      blocoB: {
        estilo1: 'Ilustração Flat / Vetorial',
        estilo2: 'Render 3D',
        estilo3: 'Tipográfico Ousado',
        reels: 'Margens: 250px livres topo e 350px base'
      },
      generatedA: getSampleBingoGeneratedA(),
      generatedB: getSampleBingoGeneratedB(),
      generated: getSampleBingoGeneratedA(),
      images: getSampleBingoImages()
    };
    campaignsList = [fallback];
    renderCampaignsList();
    selectCampaign(fallback);
    renderQueueList();
  }
}

// Clean title
function cleanCampaignTitle(raw) {
  if (!raw) return 'Campanha sem título';
  let t = raw.replace(/[\ue000-\uf8ff]/g, ' ')
             .replace(/·/g, ' - ')
             .replace(/\s+/g, ' ')
             .trim();
  const m = t.match(/^(\d+\.\s+[^-\n\r]+(?:\s*-\s*[^-\n\r]+)?)/);
  if (m) {
    return m[1].trim().substring(0, 42);
  }
  return t.substring(0, 42);
}

// Helper: Day mapping (3 niches per day)
function getDayNameForCampaign(c, index) {
  const t = (c.title || '').toLowerCase();
  if (t.includes('segunda')) return 'Segunda-feira';
  if (t.includes('terça') || t.includes('terca')) return 'Terça-feira';
  if (t.includes('quarta')) return 'Quarta-feira';
  if (t.includes('quinta')) return 'Quinta-feira';
  if (t.includes('sexta')) return 'Sexta-feira';

  if (index < 3) return 'Segunda-feira';
  if (index < 6) return 'Terça-feira';
  if (index < 9) return 'Quarta-feira';
  if (index < 12) return 'Quinta-feira';
  return 'Sexta-feira';
}

// Render Sidebar List Grouped by Day (Accordion)
function renderCampaignsList() {
  const container = document.getElementById('campaignsList');
  container.innerHTML = '';

  const daysOrder = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira'];
  const grouped = {
    'Segunda-feira': [],
    'Terça-feira': [],
    'Quarta-feira': [],
    'Quinta-feira': [],
    'Sexta-feira': []
  };

  campaignsList.forEach((c, idx) => {
    const day = getDayNameForCampaign(c, idx);
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(c);
  });

  daysOrder.forEach((day) => {
    const items = grouped[day];
    if (!items || items.length === 0) return;

    const isOpen = !!openDays[day];
    const total = items.length;
    const completedCount = items.filter(it => !!completedCampaigns[it.id]).length;
    const allDone = completedCount === total && total > 0;

    const accordion = document.createElement('div');
    accordion.className = `day-accordion ${isOpen ? 'open' : ''}`;

    accordion.innerHTML = `
      <div class="day-header" onclick="toggleDayAccordion('${day}')">
        <div class="day-title-box">
          <span class="day-chevron">▶</span>
          <span class="day-title-text">📅 ${day}</span>
        </div>
        <span class="day-progress-badge ${allDone ? 'all-done' : ''}">
          ${completedCount}/${total} ${allDone ? '✓' : 'OK'}
        </span>
      </div>
      <div class="day-items-list" id="day-items-${day}">
      </div>
    `;

    const itemsContainer = accordion.querySelector('.day-items-list');

    items.forEach((c) => {
      const isDone = !!completedCampaigns[c.id];
      const isActive = currentCampaign && currentCampaign.id === c.id;

      const itemEl = document.createElement('div');
      itemEl.className = `campaign-item ${isActive ? 'active' : ''} ${isDone ? 'completed' : ''}`;

      itemEl.innerHTML = `
        <div class="c-main-info" onclick="selectCampaignById('${c.id}')">
          <div class="c-title">${c.title}</div>
          <div class="c-meta">
            <span>Item ${c.page || 1}</span>
            <span>•</span>
            <span style="color:${(c.generatedA || c.generatedB || c.generated) ? 'var(--color-ok)' : 'var(--text-dim)'};">
              ${(c.generatedA || c.generatedB || c.generated) ? '✓ IA Pronta' : 'Pendente'}
            </span>
          </div>
        </div>
        <div class="ok-checkbox-wrapper" onclick="toggleCampaignOk('${c.id}', event)" title="Marcar como Concluído / OK">
          <div class="custom-checkbox ${isDone ? 'checked' : ''}">${isDone ? '✓' : ''}</div>
        </div>
      `;

      itemsContainer.appendChild(itemEl);
    });

    container.appendChild(accordion);
  });
}

// Toggle Day Accordion
function toggleDayAccordion(day) {
  openDays[day] = !openDays[day];
  renderCampaignsList();
}

// Toggle OK on specific campaign
function toggleCampaignOk(campaignId, event) {
  if (event) event.stopPropagation();

  completedCampaigns[campaignId] = !completedCampaigns[campaignId];
  localStorage.setItem('twod_completed_campaigns', JSON.stringify(completedCampaigns));

  renderCampaignsList();
  updateCampaignBarStatus();

  if (completedCampaigns[campaignId]) {
    showToast('Campanha marcada como concluída (OK)!');
  }
}

// Toggle OK for active campaign from the top bar
function toggleActiveCampaignOk() {
  if (!currentCampaign) return;
  toggleCampaignOk(currentCampaign.id);
}

// Select Campaign by ID
function selectCampaignById(id) {
  const found = campaignsList.find(c => c.id === id);
  if (found) {
    selectCampaign(found);
  }
}

// Select Campaign
function selectCampaign(c) {
  currentCampaign = c;

  // Make sure the day of the active campaign is open
  const day = getDayNameForCampaign(c, campaignsList.indexOf(c));
  openDays[day] = true;

  renderCampaignsList();

  const titleEl = document.getElementById('campaignName');
  const audioEl = document.getElementById('campaignAudioText');

  titleEl.textContent = `${c.title} • (Bloco ${currentBloco})`;
  audioEl.textContent = c.audio || 'Áudio padrão da campanha';

  updateCampaignBarStatus();

  const activeGen = currentBloco === 'A' ? (c.generatedA || c.generated) : (c.generatedB || c.generated);
  if (activeGen) {
    renderCreatives(activeGen);
  } else {
    renderPendingWorkspace();
  }
  renderQueueList();
}

// Update Top Bar "OK" Button
function updateCampaignBarStatus() {
  const btn = document.getElementById('btnToggleOk');
  const icon = document.getElementById('okIcon');
  const text = document.getElementById('okText');

  if (!btn || !currentCampaign) return;

  const isDone = !!completedCampaigns[currentCampaign.id];
  if (isDone) {
    btn.className = 'btn-status-ok active';
    icon.textContent = '✓';
    text.textContent = 'Concluído (OK)';
  } else {
    btn.className = 'btn-status-ok';
    icon.textContent = '⬜';
    text.textContent = 'Marcar como OK';
  }
}

// Copy Campaign Audio Text for Company Dashboard
function copyAudioText() {
  if (!currentCampaign || !currentCampaign.audio) {
    showToast('Nenhum áudio encontrado nesta campanha.');
    return;
  }
  
  const text = currentCampaign.audio;
  navigator.clipboard.writeText(text).then(() => {
    showToast('🎙️ Áudio copiado! Pronto para colar no painel da empresa.');
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('🎙️ Áudio copiado!');
  });
}

// Update field when user edits in the card
function updateField(idx, type, field, value) {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) return;
  const langData = activeGen[currentLanguage] || activeGen.pt;
  if (!langData) return;

  if (type === 'quadrado') {
    if (langData.criativos_quadrados && langData.criativos_quadrados[idx]) {
      langData.criativos_quadrados[idx][field] = value.trim();
    }
  } else {
    if (langData.reels && langData.reels[idx]) {
      langData.reels[idx][field] = value.trim();
    }
  }
}

function updateActiveAudio(value) {
  if (currentCampaign) {
    currentCampaign.audio = value.trim();
  }
}

// Image Helper Functions: Drag & Drop, Upload, Copy Prompt & Help Modal
let pendingUploadCardIndex = null;

function openImagenHelpModal() {
  const modal = document.getElementById('imagenHelpModal');
  if (modal) modal.classList.add('open');
}

function closeImagenHelpModal(event) {
  if (event && event.target && event.target.id !== 'imagenHelpModal' && !event.target.classList.contains('btn-lightbox-close') && !event.target.classList.contains('btn-card-secondary')) {
    return;
  }
  const modal = document.getElementById('imagenHelpModal');
  if (modal) modal.classList.remove('open');
}

function triggerCardImageUpload(index) {
  pendingUploadCardIndex = index;
  const input = document.getElementById('cardImageFileInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

function handleCardImageFileSelected(input) {
  if (pendingUploadCardIndex === null) return;
  const file = input.files?.[0];
  if (file && file.type.startsWith('image/')) {
    loadCardImageFile(file, pendingUploadCardIndex);
  }
}

function handleCardDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function handleCardDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

function handleCardImageDrop(event, index) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const files = event.dataTransfer?.files;
  if (files && files[0] && files[0].type.startsWith('image/')) {
    loadCardImageFile(files[0], index);
  }
}

function loadCardImageFile(file, index) {
  const reader = new FileReader();
  reader.onload = function(evt) {
    const dataUrl = evt.target.result;
    const store = getCampaignImagesStore();
    const fileLabel = getImageFileName(index, currentLanguage);
    store[index] = {
      status: 'ready',
      url: dataUrl,
      prompt: 'Carregado manualmente',
      timestamp: Date.now()
    };
    renderQueueList();
    updateCardImageBox(index);
    showToast(`✓ Imagem carregada para ${fileLabel}! Pronta para download.`);
  };
  reader.readAsDataURL(file);
}

function copyCardPrompt(index) {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  const langData = activeGen ? (activeGen[currentLanguage] || activeGen.pt) : null;
  if (!langData) return;
  const isSquare = index < 3;
  const itemData = isSquare ? langData.criativos_quadrados[index] : langData.reels[index - 3];
  if (!itemData) return;
  const prompt = itemData.image_prompt || (isSquare ? `${itemData.titulo}. ${itemData.descricao_visual}` : `${itemData.gancho_0_3s}. ${itemData.elementos_visuais_centro}`);
  navigator.clipboard.writeText(prompt);
  showToast(`📋 Prompt da imagem ${index + 1} copiado! Cole no Gemini Pro ou Canva.`);
}

// Render Card Image Box Content
function renderCardImageBoxContent(index, type, fileLabel, imgState) {
  if (imgState && imgState.status === 'ready' && imgState.url) {
    return `
      <img src="${imgState.url}" class="card-preview-img" onclick="openImageLightbox('${imgState.url}', '${fileLabel}')" alt="${fileLabel}" />
      <div class="card-image-overlay">
        <button class="btn-img-action" onclick="openImageLightbox('${imgState.url}', '${fileLabel}')" title="Ver tamanho grande">🔍 Ver</button>
        <button class="btn-img-action" onclick="downloadImageFile('${imgState.url}', '${fileLabel}')" title="Baixar ${fileLabel}">📥 Baixar</button>
        <button class="btn-img-action" onclick="triggerCardImageUpload(${index})" title="Trocar imagem por outra">📁 Trocar</button>
        <button class="btn-img-action" onclick="generateImageForCard(${index}, '${type}')" title="Gerar nova imagem com IA">🔄 Regerar</button>
      </div>
    `;
  }
  if (imgState && imgState.status === 'generating') {
    return `
      <div class="card-image-empty">
        <div class="queue-thumb-loading"></div>
        <span style="color:#a78bfa; font-weight:700;">Gerando ${fileLabel} no Google Imagen...</span>
      </div>
    `;
  }
  if (imgState && imgState.status === 'error') {
    return `
      <div class="card-image-empty" style="padding:12px; text-align:center;">
        <span style="font-size:20px;">⚠️</span>
        <span style="font-size:11px; color:#fca5a5; line-height:1.3; max-width:260px;">
          ${imgState.error || 'O Imagen 3 requer faturamento ativo na API do Google AI Studio.'}
        </span>
        <div class="card-img-btn-row">
          <button class="btn-card-secondary" onclick="openImagenHelpModal()" style="border-color:#38bdf8; color:#7dd3fc;" title="Entenda o erro do Gemini Pro">💡 Entender Erro</button>
          <button class="btn-card-secondary" onclick="copyCardPrompt(${index})" title="Copiar prompt para colar no Gemini Pro Web ou Canva">📋 Copiar Prompt</button>
          <button class="btn-card-secondary" onclick="triggerCardImageUpload(${index})" title="Carregar imagem gerada do seu computador">📁 Carregar Imagem</button>
          <button class="btn-card-secondary" onclick="generateImageForCard(${index}, '${type}')" title="Tentar gerar na API novamente">🔄 Tentar</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="card-image-empty">
      <span style="font-size:22px;">🖼️</span>
      <span style="font-size:11px; color:var(--text-dim);">${fileLabel} • Pronto para Gerar ou Carregar</span>
      <div class="card-img-btn-row">
        <button class="btn-generate-card-img" onclick="generateImageForCard(${index}, '${type}')" title="Gerar com Google Imagen 3">⚡ Gerar no Google</button>
        <button class="btn-card-secondary" onclick="copyCardPrompt(${index})" title="Copiar prompt para colar no Gemini Pro Web ou Canva">📋 Copiar Prompt</button>
        <button class="btn-card-secondary" onclick="triggerCardImageUpload(${index})" title="Carregar imagem do seu computador ou arraste e solte aqui">📁 Carregar Imagem</button>
      </div>
    </div>
  `;
}

function updateCardImageBox(index) {
  const box = document.getElementById(`cardImgBox_${index}`);
  if (!box) return;
  const store = getCampaignImagesStore();
  const isSquare = index < 3;
  const type = isSquare ? 'quadrado' : 'reel';
  const fileLabel = getImageFileName(index, currentLanguage);
  box.innerHTML = renderCardImageBoxContent(index, type, fileLabel, store[index]);
}

// Render Creatives Cards based on Language and Active Block
function renderCreatives(data) {
  const langData = data[currentLanguage] || data.pt || data;
  const quadradosContainer = document.getElementById('quadradosCards');
  const reelsContainer = document.getElementById('reelsCards');
  const store = getCampaignImagesStore();

  // 1:1 Squares
  quadradosContainer.innerHTML = '';
  langData.criativos_quadrados.forEach((item, idx) => {
    const badgeClass = `badge-style-${idx + 1}`;
    const fileLabel = getImageFileName(idx, currentLanguage);
    const card = document.createElement('div');
    card.className = 'creative-card';
    card.innerHTML = `
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="file-pill">📁 ${fileLabel}</span>
          <span class="style-badge ${badgeClass}">${item.badge || item.estilo}</span>
        </div>
        <span class="card-dimension">1080 x 1080 px</span>
      </div>

      <div class="card-image-box" id="cardImgBox_${idx}" ondragover="handleCardDragOver(event)" ondragleave="handleCardDragLeave(event)" ondrop="handleCardImageDrop(event, ${idx})">
        ${renderCardImageBoxContent(idx, 'quadrado', fileLabel, store[idx])}
      </div>

      <div class="field-group">
        <span class="field-label">Etiqueta Superior • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value editable" contenteditable="true" oninput="updateField(${idx}, 'quadrado', 'categoria', this.innerText)" title="Clique para editar">${item.categoria || 'DESTAQUE'}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Título Principal (Headline) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value headline editable" contenteditable="true" oninput="updateField(${idx}, 'quadrado', 'titulo', this.innerText)" title="Clique para editar">${item.titulo}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Subtítulo / Apoio • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value editable" contenteditable="true" oninput="updateField(${idx}, 'quadrado', 'subtitulo', this.innerText)" title="Clique para editar">${item.subtitulo}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Diretriz da Imagem / Fotografia • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value visual-desc editable" contenteditable="true" oninput="updateField(${idx}, 'quadrado', 'descricao_visual', this.innerText)" title="Clique para editar">${item.descricao_visual}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Botão de Ação (CTA) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div><span class="field-value cta-pill editable" contenteditable="true" oninput="updateField(${idx}, 'quadrado', 'cta', this.innerText)" title="Clique para editar texto do botão">${item.cta}</span></div>
      </div>

      <div class="field-group">
        <span class="field-label">Prompt para Imagem (${currentLanguage.toUpperCase()}) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value editable" contenteditable="true" style="font-size:11px; font-family:monospace; color:#a5b4fc;" oninput="updateField(${idx}, 'quadrado', 'image_prompt', this.innerText)" title="Clique para editar o prompt">${item.image_prompt || item.titulo}</div>
      </div>

      <div class="card-actions">
        <button class="btn-small" onclick="copyCardContent(${idx}, 'quadrado')">📋 Copiar Card</button>
        <button class="btn-small" onclick="copyImagePrompt(${idx}, 'quadrado')" style="color:var(--accent-primary);">🎨 Copiar Prompt Imagem</button>
      </div>
    `;
    quadradosContainer.appendChild(card);
  });

  // 9:16 Reels
  reelsContainer.innerHTML = '';
  langData.reels.forEach((item, idx) => {
    const overallIdx = idx + 3;
    const badgeClass = `badge-style-${idx + 1}`;
    const fileLabel = getImageFileName(overallIdx, currentLanguage);
    const card = document.createElement('div');
    card.className = 'reels-card';
    card.innerHTML = `
      <div class="card-top">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="file-pill">📁 ${fileLabel}</span>
          <span class="style-badge ${badgeClass}">Reel ${idx + 1}</span>
        </div>
        <span class="card-dimension">1080 x 1920 px (9:16)</span>
      </div>

      <div class="card-image-box reels-preview-box" id="cardImgBox_${overallIdx}" ondragover="handleCardDragOver(event)" ondragleave="handleCardDragLeave(event)" ondrop="handleCardImageDrop(event, ${overallIdx})">
        ${renderCardImageBoxContent(overallIdx, 'reel', fileLabel, store[overallIdx])}
      </div>

      <!-- Phone Visualizer with Safe Zones -->
      <div class="phone-preview-container">
        <div class="phone-mockup">
          <div class="safe-zone-top">⚠️ Área Superior (-250px)</div>
          <div class="safe-zone-content">
            <div class="mock-hook">${item.gancho_0_3s.substring(0, 45)}...</div>
            <div class="mock-center">🎯 Elementos no Centro</div>
          </div>
          <div class="safe-zone-bottom">
            <div class="mock-cta-btn">${item.cta_posicionado ? item.cta_posicionado.substring(0, 18) : 'BAIXAR GRÁTIS'}</div>
            ⚠️ Rodapé (-350px)
          </div>
        </div>
      </div>

      <div class="field-group">
        <span class="field-label">Gancho Visual (0 a 3 segundos) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value headline editable" contenteditable="true" oninput="updateField(${idx}, 'reel', 'gancho_0_3s', this.innerText)" title="Clique para editar">${item.gancho_0_3s}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Roteiro / Locução (Áudio) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value editable" contenteditable="true" oninput="updateField(${idx}, 'reel', 'roteiro_audio', this.innerText)" title="Clique para editar">${item.roteiro_audio}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Elementos no Centro (Safe Area) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value visual-desc editable" contenteditable="true" oninput="updateField(${idx}, 'reel', 'elementos_visuais_centro', this.innerText)" title="Clique para editar">${item.elementos_visuais_centro}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Posicionamento do CTA • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value editable" contenteditable="true" style="font-size:12px; color:var(--accent-emerald);" oninput="updateField(${idx}, 'reel', 'cta_posicionado', this.innerText)" title="Clique para editar">${item.cta_posicionado || 'Acima da barra inferior'}</div>
      </div>

      <div class="field-group">
        <span class="field-label">Prompt para Versão Reels (com safe area) • <span style="font-size:9px; opacity:0.7; font-weight:normal;">clique para editar</span></span>
        <div class="field-value editable" contenteditable="true" style="font-size:11px; font-family:monospace; color:#a5b4fc;" oninput="updateField(${idx}, 'reel', 'image_prompt', this.innerText)" title="Clique para editar o prompt">${item.image_prompt || item.gancho_0_3s}</div>
      </div>

      <div class="card-actions">
        <button class="btn-small" onclick="copyCardContent(${idx}, 'reel')">📋 Copiar Roteiro</button>
        <button class="btn-small" onclick="copyImagePrompt(${idx}, 'reel')" style="color:var(--accent-primary);">🎨 Copiar Prompt Reels</button>
      </div>
    `;
    reelsContainer.appendChild(card);
  });
}

function renderPendingWorkspace() {
  const blocoInfo = currentBloco === 'A' ? currentCampaign.blocoA : currentCampaign.blocoB;
  const estilo1Title = currentBloco === 'A' ? 'Estilo 1 - Advertorial com Foto Real' : 'Estilo 1 - Ilustração Flat / Vetorial';
  const estilo2Title = currentBloco === 'A' ? 'Estilo 2 - Clean com Foto' : 'Estilo 2 - Render 3D';
  const estilo3Title = currentBloco === 'A' ? 'Estilo 3 - Foto Full-BG' : 'Estilo 3 - Tipográfico Ousado';

  const html = `
    <div style="grid-column: 1 / -1; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 32px; text-align: center;">
      <div style="font-size: 36px; margin-bottom: 12px;">⚡</div>
      <h3 style="font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 8px;">
        Briefing do ${currentCampaign.title} (Bloco ${currentBloco}) Carregado!
      </h3>
      <p style="font-size: 14px; color: var(--text-muted); max-width: 600px; margin: 0 auto 20px;">
        Os estilos configurados para este bloco são: <strong>${estilo1Title}</strong>, <strong>${estilo2Title}</strong> e <strong>${estilo3Title}</strong>.
      </p>
      <div style="display: flex; justify-content: center; gap: 12px;">
        <button class="btn-primary" onclick="generateWithGemini()">
          ⚡ Gerar com IA (Gemini)
        </button>
        <button class="btn-secondary" onclick="copyMasterPrompt('active-lang')">
          📋 Copiar Prompt Mestre (ChatGPT)
        </button>
      </div>
    </div>
  `;
  document.getElementById('quadradosCards').innerHTML = html;
  document.getElementById('reelsCards').innerHTML = html;
}

// Bloco Switcher
function setBloco(bloco) {
  currentBloco = bloco;
  document.querySelectorAll('#blocoControl .segment-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(`Bloco ${bloco}`));
  });
  showToast(`Alternado para Bloco ${bloco}`);
  if (currentCampaign) {
    selectCampaign(currentCampaign);
  }
}

// Language Switcher
function setLanguage(lang) {
  currentLanguage = lang;
  document.querySelectorAll('#langControl .segment-btn').forEach(btn => {
    const isLang = (lang === 'pt' && btn.textContent.includes('Português')) ||
                   (lang === 'es' && btn.textContent.includes('Espanhol')) ||
                   (lang === 'en' && btn.textContent.includes('Inglês'));
    btn.classList.toggle('active', isLang);
  });
  showToast(`Exibindo idioma: ${lang.toUpperCase()}`);
  if (currentCampaign) {
    const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
    if (activeGen) {
      renderCreatives(activeGen);
    }
    renderQueueList();
  }
}

// Robust Drag & Drop PDF Parser (Suporta arrastar Bloco A e Bloco B juntos ou separados)
function setupDropzone() {
  const dropzone = document.getElementById('pdfDropzone');
  const fileInput = document.getElementById('fileInput');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleMultiplePdfFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleMultiplePdfFiles(Array.from(e.target.files));
    }
  });
}

async function handleMultiplePdfFiles(fileList) {
  const pdfFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfFiles.length === 0) {
    alert('Por favor, selecione arquivos em formato PDF.');
    return;
  }

  showLoading(`Processando ${pdfFiles.length} arquivo(s) PDF...`);

  try {
    for (const file of pdfFiles) {
      const isBlocoB = file.name.toLowerCase().includes('blocob');
      const blocoTarget = isBlocoB ? 'blocoB' : 'blocoA';

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let campaignIdx = 0;

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        let lastY;
        let lines = [];
        let currentLine = '';

        for (const item of textContent.items) {
          if (lastY !== undefined && Math.abs(item.transform[5] - lastY) > 5) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = '';
          }
          currentLine += (item.str || '') + ' ';
          lastY = item.transform[5];
        }
        if (currentLine.trim()) lines.push(currentLine.trim());
        
        const cleanRaw = lines.join('\n')
                              .replace(/[\ue000-\uf8ff]/g, ' ')
                              .replace(/·/g, ' - ')
                              .replace(/[ \t]+/g, ' ');

        // Ignora capa
        if (pageNum === 1 && (cleanRaw.includes('Prompts de Criativo') || cleanRaw.includes('Pacote da Semana'))) {
          continue;
        }

        if (cleanRaw.length > 40) {
          let titleMatch = cleanRaw.match(/^(\d+\.\s+[^-\n\r]+(?:\s*-\s*[^-\n\r]+)?)/m);
          let title = titleMatch ? titleMatch[1].trim() : `Campanha ${campaignIdx + 1}`;
          title = cleanCampaignTitle(title);

          let audioMatch = cleanRaw.match(/ÁUDIO DA CAMPANHA[^\n\r]*\n([\s\S]*?)(?=ESTILO 1|Nicho|$)/i);
          let audio = audioMatch ? audioMatch[1].replace(/\n/g, ' ').trim() : '';

          let e1Match = cleanRaw.match(/ESTILO 1[^\n\r]*\n([\s\S]*?)(?=ESTILO 2)/i);
          let e2Match = cleanRaw.match(/ESTILO 2[^\n\r]*\n([\s\S]*?)(?=ESTILO 3)/i);
          let e3Match = cleanRaw.match(/ESTILO 3[^\n\r]*\n([\s\S]*?)(?=REELS|$)/i);
          let reelsMatch = cleanRaw.match(/REELS[^\n\r]*\n?([\s\S]*)$/i);

          const stylesObj = {
            estilo1: e1Match ? e1Match[1].trim() : '',
            estilo2: e2Match ? e2Match[1].trim() : '',
            estilo3: e3Match ? e3Match[1].trim() : '',
            reels: reelsMatch ? reelsMatch[1].trim() : 'Margens: 250px livres topo e 350px base'
          };

          // Se a lista de campanhas já existe, mescla no índice correspondente
          if (campaignsList.length > campaignIdx) {
            campaignsList[campaignIdx][blocoTarget] = stylesObj;
            if (audio) campaignsList[campaignIdx].audio = audio;
            if (title && !campaignsList[campaignIdx].title.includes('.')) {
              campaignsList[campaignIdx].title = title;
            }
          } else {
            // Cria nova campanha
            const newCamp = {
              id: `camp-${campaignIdx + 1}`,
              page: campaignIdx + 1,
              title: title,
              audio: audio || 'Áudio padrão da campanha',
              rawText: cleanRaw,
              blocoA: blocoTarget === 'blocoA' ? stylesObj : {},
              blocoB: blocoTarget === 'blocoB' ? stylesObj : {},
              generated: null
            };
            campaignsList.push(newCamp);
          }
          campaignIdx++;
        }
      }
    }

    document.getElementById('campaignsCount').textContent = `${campaignsList.length} campanhas`;
    renderCampaignsList();
    if (campaignsList.length > 0) {
      selectCampaign(campaignsList[0]);
    }

    if (pdfFiles.length > 1) {
      showToast(`Sucesso! ${pdfFiles.length} arquivos importados e combinados.`);
    } else {
      showToast(`Arquivo "${pdfFiles[0].name}" processado com sucesso!`);
    }
  } catch (err) {
    console.error(err);
    alert('Erro ao processar PDF: ' + err.message);
  } finally {
    hideLoading();
  }
}


// Generate with Gemini API & Automatic Visual Image Generation
async function generateWithGemini() {
  const apiKey = document.getElementById('apiKeyInput').value.trim() || localStorage.getItem('twod_gemini_api_key');
  
  if (!currentCampaign) {
    alert('Selecione uma campanha primeiro.');
    return;
  }

  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);

  // If no Gemini API key is provided, but copy is already generated, trigger image generation directly
  if (!apiKey) {
    if (activeGen) {
      showToast('⚡ Iniciando geração das 6 imagens com IA...');
      switchSidebarTab('imagens');
      generateAllImagesForActiveBlock();
      return;
    }
    alert('Por favor, insira sua chave da API Gemini no topo da tela para gerar automaticamente.');
    document.getElementById('apiKeyInput').focus();
    toggleApiPopover(true);
    return;
  }

  showLoading(`Gerando 6 Criativos para ${currentCampaign.title} (Bloco ${currentBloco}) em PT, ES e EN...`);

  const blocoData = currentBloco === 'A' ? currentCampaign.blocoA : currentCampaign.blocoB;

  const systemInstruction = `
Você é o mais conceituado diretor de arte e copywriter de performance do Meta Ads (Facebook e Instagram).
Sua missão é gerar os 6 criativos completos desta campanha nos 3 IDIOMAS: Português (pt), Espanhol (es) e Inglês (en).
Formato dos 6 arquivos:
- 1.png: Quadrado 1:1 (Estilo 1 do Bloco ${currentBloco})
- 2.png: Quadrado 1:1 (Estilo 2 do Bloco ${currentBloco})
- 3.png: Quadrado 1:1 (Estilo 3 do Bloco ${currentBloco})
- 4.png: Reel 9:16 (Adaptação Estilo 1) - Com margens de segurança: 250px livres no topo e 350px livres na base. Elementos principais no centro.
- 5.png: Reel 9:16 (Adaptação Estilo 2) - Com margens de segurança.
- 6.png: Reel 9:16 (Adaptação Estilo 3) - Com margens de segurança.

Para cada criativo gere:
1. titulo
2. subtitulo
3. descricao_visual
4. cta
5. copy_legenda
6. image_prompt: prompt pronto e detalhado para colar no gerador de imagens (como ChatGPT/DALL-E) com os textos já traduzidos para aquele idioma.

Responda rigorosamente em JSON no formato:
{
  "pt": {
    "criativos_quadrados": [
      { "file": "1.png", "estilo": "Estilo 1", "badge": "Estilo 1", "categoria": "...", "titulo": "...", "subtitulo": "...", "descricao_visual": "...", "cta": "...", "copy_legenda": "...", "image_prompt": "..." },
      { "file": "2.png", "estilo": "Estilo 2", "badge": "Estilo 2", "categoria": "...", "titulo": "...", "subtitulo": "...", "descricao_visual": "...", "cta": "...", "copy_legenda": "...", "image_prompt": "..." },
      { "file": "3.png", "estilo": "Estilo 3", "badge": "Estilo 3", "categoria": "...", "titulo": "...", "subtitulo": "...", "descricao_visual": "...", "cta": "...", "copy_legenda": "...", "image_prompt": "..." }
    ],
    "reels": [
      { "file": "4.png", "estilo_base": "Adaptação 1", "gancho_0_3s": "...", "roteiro_audio": "...", "elementos_visuais_centro": "...", "cta_posicionado": "...", "image_prompt": "..." },
      { "file": "5.png", "estilo_base": "Adaptação 2", "gancho_0_3s": "...", "roteiro_audio": "...", "elementos_visuais_centro": "...", "cta_posicionado": "...", "image_prompt": "..." },
      { "file": "6.png", "estilo_base": "Adaptação 3", "gancho_0_3s": "...", "roteiro_audio": "...", "elementos_visuais_centro": "...", "cta_posicionado": "...", "image_prompt": "..." }
    ]
  },
  "es": { "criativos_quadrados": [ ... ], "reels": [ ... ] },
  "en": { "criativos_quadrados": [ ... ], "reels": [ ... ] }
}
`;

  const userPrompt = `
CAMPANHA: ${currentCampaign.title}
BLOCO ATIVO: Bloco ${currentBloco}
ÁUDIO DA CAMPANHA: ${currentCampaign.audio}
DIRETRIZES DO BLOCO:
Estilo 1: ${blocoData.estilo1 || 'Padrão do bloco'}
Estilo 2: ${blocoData.estilo2 || 'Padrão do bloco'}
Estilo 3: ${blocoData.estilo3 || 'Padrão do bloco'}
Reels: ${blocoData.reels || 'Margens de segurança: 250px topo e 350px base'}
`;

  try {
    const textModels = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-3-pro'];
    let parsed = null;
    let lastErr = null;

    for (const model of textModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: systemInstruction + "\n\n" + userPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawContent) {
            const cleanJson = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
            parsed = JSON.parse(cleanJson);
            break;
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          lastErr = errData.error?.message || `Erro HTTP ${response.status}`;
          console.warn(`Model ${model} returned:`, lastErr);
        }
      } catch (e) {
        lastErr = e.message;
        console.warn(`Error attempting model ${model}:`, e);
      }
    }

    if (!parsed) {
      throw new Error(lastErr || 'A API Gemini não retornou conteúdo válido.');
    }

    if (currentBloco === 'A') {
      currentCampaign.generatedA = parsed;
    } else {
      currentCampaign.generatedB = parsed;
    }
    currentCampaign.generated = parsed;
    renderCreatives(parsed);
    renderCampaignsList();
    hideLoading();
    showToast(`✓ Criativos gerados com sucesso! Iniciando geração visual das 6 imagens...`);

    // Automatically switch to images tab & generate all 6 images!
    switchSidebarTab('imagens');
    generateAllImagesForActiveBlock();
  } catch (err) {
    console.error(err);
    alert('Erro ao chamar a API Gemini: ' + err.message);
    hideLoading();
  }
}

// Generate Individual Image for a Card
async function generateImageForCard(index, type, lang = currentLanguage) {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) return;
  const langData = activeGen[lang] || activeGen.pt;
  if (!langData) return;

  const isSquare = index < 3;
  const itemData = isSquare ? langData.criativos_quadrados[index] : langData.reels[index - 3];
  const aspectRatio = isSquare ? '1:1' : '9:16';
  const prompt = itemData.image_prompt || (isSquare ? `${itemData.titulo}. ${itemData.descricao_visual}` : `${itemData.gancho_0_3s}. ${itemData.elementos_visuais_centro}`);
  const file = getImageFileName(index, lang);

  const store = getCampaignImagesStore();
  store[index] = { status: 'generating', url: store[index]?.url || null, prompt: prompt };
  renderQueueList();
  updateCardImageBox(index);

  showToast(`⚡ Gerando imagem ${file}...`);

  try {
    const imgUrl = await callImageGenerationApi(prompt, aspectRatio);
    store[index] = { status: 'ready', url: imgUrl, prompt: prompt, timestamp: Date.now() };
    showToast(`✓ Imagem ${file} gerada com sucesso!`);
  } catch (err) {
    console.error(err);
    store[index] = { status: 'error', url: null, error: err.message, isBilling: err.isBillingError };
    if (err.isBillingError) {
      showToast('💡 O Imagen 3 requer faturamento ativo no Google AI Studio');
      openImagenHelpModal();
    } else {
      alert(`Aviso da API Google: ` + err.message);
    }
  }

  renderQueueList();
  updateCardImageBox(index);
}

// Generate all 6 images for the active campaign block and language
async function generateAllImagesForActiveBlock(lang = currentLanguage) {
  if (!currentCampaign) {
    alert('Selecione uma campanha primeiro.');
    return;
  }

  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) {
    alert(`Gere os textos dos criativos com IA primeiro.`);
    return;
  }

  const langData = activeGen[lang] || activeGen.pt;
  if (!langData) return;

  switchSidebarTab('imagens');

  const store = getCampaignImagesStore();

  // Mark all 6 as generating
  for (let i = 0; i < 6; i++) {
    if (!store[i] || store[i].status !== 'ready') {
      store[i] = { status: 'generating', url: store[i]?.url || null };
    }
  }
  renderQueueList();
  renderCreatives(activeGen);

  showToast(`⚡ Gerando 6 imagens do Bloco ${currentBloco} (${lang.toUpperCase()})...`);

  for (let i = 0; i < 6; i++) {
    const isSquare = i < 3;
    const itemData = isSquare ? langData.criativos_quadrados[i] : langData.reels[i - 3];
    const aspectRatio = isSquare ? '1:1' : '9:16';
    const prompt = itemData.image_prompt || (isSquare ? `${itemData.titulo}. ${itemData.descricao_visual}` : `${itemData.gancho_0_3s}. ${itemData.elementos_visuais_centro}`);
    const file = getImageFileName(i, lang);

    store[i] = { status: 'generating', url: store[i]?.url || null, prompt: prompt };
    renderQueueList();
    updateCardImageBox(i);

    try {
      const imgUrl = await callImageGenerationApi(prompt, aspectRatio);
      store[i] = { status: 'ready', url: imgUrl, prompt: prompt, timestamp: Date.now() };
    } catch (err) {
      console.error(`Erro ao gerar imagem ${file}:`, err);
      store[i] = { status: 'error', url: null, error: err.message, isBilling: err.isBillingError };
    }

    renderQueueList();
    updateCardImageBox(i);
  }

  const errors = [0, 1, 2, 3, 4, 5].filter(idx => store[idx]?.status === 'error');
  if (errors.length > 0) {
    const hasBillingErr = errors.some(idx => store[idx]?.isBilling);
    if (hasBillingErr) {
      showToast(`💡 O Imagen 3 requer faturamento ativo no Google AI Studio`);
      openImagenHelpModal();
    } else {
      showToast(`⚠️ ${store[errors[0]]?.error || 'Aviso da API Google'}`);
    }
  } else {
    showToast(`🎉 Todas as 6 imagens do Bloco ${currentBloco} (${lang.toUpperCase()}) estão prontas!`);
  }
}

// Cache for available models to avoid repetitive ListModels queries
let cachedGoogleImageModels = null;

async function getSupportedGoogleImageModels(apiKey) {
  if (cachedGoogleImageModels !== null) return cachedGoogleImageModels;
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (resp.ok) {
      const data = await resp.json();
      const all = data.models || [];
      const found = all
        .filter(m => (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('predict')) || m.name.includes('imagen'))
        .map(m => m.name.replace('models/', ''));
      cachedGoogleImageModels = found;
      return found;
    }
  } catch (e) {
    console.warn('Could not query ListModels:', e);
  }
  return [];
}

// Call Official Google Gemini Image Generation API (Strictly Google / No 3rd parties)
async function callImageGenerationApi(promptText, aspectRatio = '1:1') {
  const apiKey = document.getElementById('apiKeyInput')?.value.trim() || localStorage.getItem('twod_gemini_api_key');

  if (!apiKey) {
    throw new Error('Chave da API Gemini não configurada. Clique em "Chave Gemini" no topo da tela e insira sua chave do Google AI Studio.');
  }

  const cleanPrompt = (promptText || 'Criativo publicitário profissional de alta qualidade')
    .replace(/[^\w\s\-,.!?]/g, ' ')
    .trim();

  let lastError = null;

  // Primary: Google Imagen 3 generate endpoint
  try {
    const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
    const resp = await fetch(imagenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: cleanPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: aspectRatio === '9:16' ? '9:16' : '1:1'
        }
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const b64 = data.predictions?.[0]?.bytesBase64Encoded;
      if (b64) return `data:image/png;base64,${b64}`;
    } else {
      const errJson = await resp.json().catch(() => ({}));
      if (errJson.error?.message) lastError = errJson.error.message;
    }
  } catch (e) {
    lastError = e.message;
  }

  // Detect unbilled Google AI Studio project
  const isBillingIssue = !lastError || 
    lastError.includes('not found') || 
    lastError.includes('not supported') || 
    lastError.includes('predict') || 
    lastError.includes('404') || 
    lastError.includes('quota') || 
    lastError.includes('permission');

  const err = new Error(
    isBillingIssue
      ? 'O modelo Imagen 3 requer faturamento ativo (Pay-as-you-go) no Google AI Studio. A assinatura Gemini Pro do Google One é válida apenas no site gemini.google.com.'
      : `Google API: ${lastError}`
  );
  err.isBillingError = isBillingIssue;
  throw err;
}

// Render Queue List in Sidebar
function renderQueueList() {
  const container = document.getElementById('queueList');
  if (!container) return;

  const queueTitle = document.getElementById('queueTitle');
  const progressPill = document.getElementById('queueProgressPill');
  const countBadge = document.getElementById('queueCountBadge');
  const btnDownloadAll = document.getElementById('btnDownloadAllImages');

  if (!currentCampaign) {
    container.innerHTML = `<div style="padding:24px 12px; text-align:center; color:var(--text-dim); font-size:12px;">Selecione uma campanha para ver a fila de imagens.</div>`;
    return;
  }

  const store = getCampaignImagesStore();
  const langLabel = currentLanguage.toUpperCase();
  if (queueTitle) {
    queueTitle.textContent = `Fila • Bloco ${currentBloco} (${langLabel})`;
  }

  let readyCount = 0;
  for (let i = 0; i < 6; i++) {
    if (store[i] && store[i].status === 'ready' && store[i].url) readyCount++;
  }

  if (progressPill) {
    progressPill.textContent = `${readyCount}/6 Prontas`;
    progressPill.className = `queue-progress-pill ${readyCount === 6 ? 'completed' : ''}`;
  }
  if (countBadge) {
    countBadge.textContent = `${readyCount}/6`;
    countBadge.className = `queue-count-badge ${readyCount === 6 ? 'completed' : ''}`;
  }
  if (btnDownloadAll) {
    btnDownloadAll.disabled = readyCount === 0;
    btnDownloadAll.style.opacity = readyCount === 0 ? '0.5' : '1';
  }

  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  const langData = activeGen ? (activeGen[currentLanguage] || activeGen.pt) : null;

  container.innerHTML = '';

  for (let i = 0; i < 6; i++) {
    const isSquare = i < 3;
    const file = getImageFileName(i, currentLanguage);
    const itemData = langData ? (isSquare ? langData.criativos_quadrados[i] : langData.reels[i - 3]) : null;
    const styleName = itemData ? (isSquare ? (itemData.badge || itemData.estilo) : `Reel ${i - 2}`) : `Criativo ${i + 1}`;
    const dimText = isSquare ? '1080x1080 (1:1)' : '1080x1920 (9:16)';
    const itemState = store[i] || { status: 'idle' };

    const itemEl = document.createElement('div');
    itemEl.className = `queue-item ${itemState.status}`;

    let thumbHtml = '';
    if (itemState.status === 'ready' && itemState.url) {
      thumbHtml = `<img src="${itemState.url}" alt="${file}" onclick="openImageLightbox('${itemState.url}', '${file} - ${styleName}')" />`;
    } else if (itemState.status === 'generating') {
      thumbHtml = `<div class="queue-thumb-loading"></div>`;
    } else {
      thumbHtml = `<span class="queue-thumb-empty">🖼️</span>`;
    }

    let statusText = '';
    if (itemState.status === 'ready') statusText = '<span class="queue-status-text ready">✓ Pronta</span>';
    else if (itemState.status === 'generating') statusText = '<span class="queue-status-text loading">⏳ Gerando...</span>';
    else if (itemState.status === 'error') statusText = '<span class="queue-status-text error" style="color:#ef4444;">⚠️ Falha</span>';
    else statusText = '<span class="queue-status-text pending">Pendente</span>';

    itemEl.innerHTML = `
      <div class="queue-thumb-box" onclick="${itemState.status === 'ready' ? `openImageLightbox('${itemState.url}', '${file} - ${styleName}')` : `generateImageForCard(${i}, '${isSquare ? 'quadrado' : 'reel'}')`}" title="${itemState.status === 'ready' ? 'Clique para ampliar' : 'Clique para gerar'}">
        ${thumbHtml}
      </div>
      <div class="queue-info">
        <div class="queue-file-title">
          <span>${file}</span>
          <span style="font-size:11px; font-weight:600; color:var(--text-main); font-family:var(--font-sans);">${styleName}</span>
        </div>
        <div style="font-size:10px; color:var(--text-dim); display:flex; align-items:center; gap:6px;">
          <span>${dimText}</span>
          <span>•</span>
          ${statusText}
        </div>
      </div>
      <div class="queue-item-actions">
        ${itemState.status === 'ready' ? `
          <button class="btn-queue-action" onclick="openImageLightbox('${itemState.url}', '${file} - ${styleName}')" title="Ampliar">👁️</button>
          <button class="btn-queue-action" onclick="downloadImageFile('${itemState.url}', '${file}')" title="Baixar ${file}">📥</button>
        ` : ''}
        <button class="btn-queue-action" onclick="triggerCardImageUpload(${i})" title="Carregar imagem para ${file}">📁</button>
        <button class="btn-queue-action" onclick="copyCardPrompt(${i})" title="Copiar prompt da imagem">📋</button>
        <button class="btn-queue-action" onclick="generateImageForCard(${i}, '${isSquare ? 'quadrado' : 'reel'}')" title="${itemState.status === 'ready' ? 'Regerar imagem' : 'Gerar imagem com IA'}">
          ${itemState.status === 'ready' ? '🔄' : '⚡'}
        </button>
      </div>
    `;

    container.appendChild(itemEl);
  }
}

// Batch ZIP Download with Proper 1 to 6 Naming (1.png, 1es.png, 1en.png...)
async function downloadAllImagesZip() {
  if (!currentCampaign) return;
  const store = getCampaignImagesStore();
  const readyIndices = [0, 1, 2, 3, 4, 5].filter(i => store[i] && store[i].url);

  if (readyIndices.length === 0) {
    alert('Nenhuma imagem pronta para download ainda. Clique em "Gerar Imagens (1 a 6)" primeiro!');
    return;
  }

  showLoading(`Compactando ${readyIndices.length} imagens no arquivo ZIP...`);

  try {
    if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();

      for (const i of readyIndices) {
        const item = store[i];
        const filename = getImageFileName(i, currentLanguage);

        let blob;
        if (item.url.startsWith('data:')) {
          const parts = item.url.split(';base64,');
          const contentType = parts[0].split(':')[1];
          const raw = window.atob(parts[1]);
          const rawLength = raw.length;
          const uInt8Array = new Uint8Array(rawLength);
          for (let b = 0; b < rawLength; ++b) {
            uInt8Array[b] = raw.charCodeAt(b);
          }
          blob = new Blob([uInt8Array], { type: contentType });
        } else {
          const resp = await fetch(item.url);
          blob = await resp.blob();
        }

        zip.file(filename, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const safeTitle = currentCampaign.title.replace(/[^a-zA-Z0-9]/g, '_');
      const zipName = `${safeTitle}_Bloco${currentBloco}_${currentLanguage.toUpperCase()}_imagens.zip`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(`🎉 ZIP com ${readyIndices.length} imagens baixado! (${zipName})`);
    } else {
      for (const i of readyIndices) {
        const item = store[i];
        const filename = getImageFileName(i, currentLanguage);
        downloadImageFile(item.url, filename);
        await new Promise(r => setTimeout(r, 400));
      }
      showToast(`Imagens baixadas com sucesso!`);
    }
  } catch (err) {
    console.error('Erro ao gerar ZIP:', err);
    alert('Erro ao criar arquivo ZIP: ' + err.message);
  } finally {
    hideLoading();
  }
}

// Download single image file
function downloadImageFile(url, filename) {
  if (url.startsWith('data:')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(`Download de ${filename} concluído!`);
  } else {
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        showToast(`Download de ${filename} concluído!`);
      })
      .catch(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }
}

// Lightbox modal handlers
function openImageLightbox(src, title) {
  const modal = document.getElementById('imageLightbox');
  const img = document.getElementById('lightboxImg');
  const titleEl = document.getElementById('lightboxTitle');
  const downloadBtn = document.getElementById('lightboxDownloadBtn');
  if (!modal || !img) return;

  img.src = src;
  if (titleEl) titleEl.textContent = title || 'Visualização do Criativo';
  if (downloadBtn) {
    downloadBtn.onclick = () => downloadImageFile(src, title ? `${title.split(' ')[0]}.png` : 'criativo.png');
  }
  modal.classList.add('open');
}

function closeImageLightbox(event) {
  if (event && event.target && event.target.id !== 'imageLightbox' && !event.target.classList.contains('btn-lightbox-close')) {
    return;
  }
  const modal = document.getElementById('imageLightbox');
  if (modal) modal.classList.remove('open');
}


// Copy Image Prompt
function copyImagePrompt(index, type) {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) return;
  const langData = activeGen[currentLanguage] || activeGen.pt || activeGen;
  const item = type === 'quadrado' ? langData.criativos_quadrados[index] : langData.reels[index];
  
  if (item && item.image_prompt) {
    navigator.clipboard.writeText(item.image_prompt).then(() => {
      showToast(`Prompt da imagem [${item.file}] (${currentLanguage.toUpperCase()}) copiado!`);
    });
  }
}

// Master Prompt Optimized for ChatGPT / GPT-4o
function copyMasterPrompt(mode = 'active-lang') {
  if (!currentCampaign) return;
  const blocoData = currentBloco === 'A' ? currentCampaign.blocoA : currentCampaign.blocoB;
  const langLabel = currentLanguage === 'pt' ? 'Português' : currentLanguage === 'es' ? 'Espanhol' : 'Inglês';

  let prompt = `Aja como o principal diretor de arte e copywriter de performance do Meta Ads (Facebook e Instagram).
Com base no briefing abaixo, gere o pacote completo para os 6 criativos (arquivos 1.png a 6.png) da nossa campanha.

--- DADOS DA CAMPANHA ---
Nicho/Campanha: ${currentCampaign.title}
Bloco Ativo: Bloco ${currentBloco}
Áudio da Campanha: "${currentCampaign.audio}"
Idioma Desejado: ${mode === 'active-lang' ? langLabel : 'Gere em 3 seções: 1) Português, 2) Espanhol, 3) Inglês'}

--- ESPECIFICAÇÕES DOS 6 CRIATIVOS (BLOCO ${currentBloco}) ---
1. [1.png] Quadrado 1080x1080:
   ${blocoData.estilo1 || 'Estilo 1 do bloco'}
2. [2.png] Quadrado 1080x1080:
   ${blocoData.estilo2 || 'Estilo 2 do bloco'}
3. [3.png] Quadrado 1080x1080:
   ${blocoData.estilo3 || 'Estilo 3 do bloco'}
4. [4.png] Reel Vertical 1080x1920 (Adaptação Estilo 1):
   IMPORTANTE: Respeitar estritamente as margens de segurança do Instagram (250px livres no topo e 350px livres na base). Elementos no centro e botão da arte logo acima da margem inferior.
5. [5.png] Reel Vertical 1080x1920 (Adaptação Estilo 2):
   Mesmas regras de margem de segurança.
6. [6.png] Reel Vertical 1080x1920 (Adaptação Estilo 3):
   Mesmas regras de margem de segurança.

--- ESTRUTURA EXIGIDA PARA CADA CRIATIVO ---
Para cada um dos 6 criativos, retorne:
- Arquivo: (ex: 1.png)
- Título/Gancho em negrito
- Subtítulo
- Diretriz Visual para o Designer/Canva
- Texto do Botão (CTA)
- Copy de Legenda do Post
- Prompt exato para gerar a imagem no DALL-E / ChatGPT com o texto no idioma correto.`;

  navigator.clipboard.writeText(prompt).then(() => {
    showToast(`Mega-Prompt Mestre para ChatGPT copiado (${langLabel})!`);
  });
}

// Copy prompt for all images
function generatePromptForAllLanguages() {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) {
    alert(`Gere os criativos do Bloco ${currentBloco} com IA primeiro.`);
    return;
  }
  const langData = activeGen[currentLanguage] || activeGen.pt;
  let bundle = `--- PROMPTS DE IMAGEM (${currentLanguage.toUpperCase()}) - BLOCO ${currentBloco} ---\n\n`;
  langData.criativos_quadrados.forEach(item => {
    bundle += `[${item.file} - ${item.estilo}]:\n${item.image_prompt}\n\n`;
  });
  langData.reels.forEach(item => {
    bundle += `[${item.file} - ${item.estilo_base}]:\n${item.image_prompt}\n\n`;
  });

  navigator.clipboard.writeText(bundle).then(() => {
    showToast(`Prompts de 1.png a 6.png em ${currentLanguage.toUpperCase()} copiados!`);
  });
}

// Copy Individual Card
function copyCardContent(index, type) {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) return;
  const langData = activeGen[currentLanguage] || activeGen.pt || activeGen;

  let text = '';
  if (type === 'quadrado') {
    const item = langData.criativos_quadrados[index];
    text = `[ARQUIVO: ${item.file}] [CRIATIVO QUADRADO 1:1 - ${item.badge || item.estilo}]
Idioma: ${currentLanguage.toUpperCase()} | Bloco ${currentBloco}
Campanha: ${currentCampaign.title}
Etiqueta: ${item.categoria || ''}
Título: ${item.titulo}
Subtítulo: ${item.subtitulo}
Diretriz Visual: ${item.descricao_visual}
CTA: ${item.cta}
Copy de Legenda:
${item.copy_legenda}`;
  } else {
    const item = langData.reels[index];
    text = `[ARQUIVO: ${item.file}] [ROTEIRO REELS 9:16 - ${item.estilo_base || 'Adaptação'}]
Idioma: ${currentLanguage.toUpperCase()} | Bloco ${currentBloco}
Campanha: ${currentCampaign.title}
Gancho (0-3s): ${item.gancho_0_3s}
Roteiro Áudio: ${item.roteiro_audio}
Elementos no Centro (Safe Area): ${item.elementos_visuais_centro}
CTA (Acima de 350px base): ${item.cta_posicionado}`;
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast(`Card ${index + 1} (${currentLanguage.toUpperCase()}) copiado!`);
  });
}

// Export All
function exportAll() {
  if (!currentCampaign) return;
  const activeGen = currentBloco === 'A' ? (currentCampaign.generatedA || currentCampaign.generated) : (currentCampaign.generatedB || currentCampaign.generated);
  if (!activeGen) {
    alert(`Gere os criativos do Bloco ${currentBloco} antes de exportar.`);
    return;
  }

  const data = activeGen;
  let output = `================================================================================
PACOTE COMPLETO DE CRIATIVOS - ${currentCampaign.title.toUpperCase()}
ESTRUTURA DE PASTAS: Bloco ${currentBloco} > 1. Imagens / Português / Espanhol / Inglês
ARQUIVOS: 1.png a 6.png
STATUS: ${completedCampaigns[currentCampaign.id] ? 'CONCLUÍDO (OK)' : 'EM ANDAMENTO'}
================================================================================\n\n`;

  output += `ÁUDIO ORIGINAL DA CAMPANHA:\n${currentCampaign.audio}\n\n`;

  ['pt', 'es', 'en'].forEach(lang => {
    const langData = data[lang];
    if (!langData) return;
    const langName = lang === 'pt' ? 'PORTUGUÊS (BASE / 1. IMAGENS)' : lang === 'es' ? 'ESPANHOL' : 'INGLÊS';
    output += `\n################################################################################\n`;
    output += `PASTA: Bloco ${currentBloco} / ${langName}\n`;
    output += `################################################################################\n\n`;

    output += `--- CRIATIVOS QUADRADOS (1080x1080) ---\n`;
    langData.criativos_quadrados.forEach(item => {
      output += `\n[ARQUIVO: ${item.file}] ${item.badge || item.estilo}\n`;
      output += `Etiqueta: ${item.categoria || ''}\n`;
      output += `Título: ${item.titulo}\n`;
      output += `Subtítulo: ${item.subtitulo}\n`;
      output += `CTA: ${item.cta}\n`;
      output += `Diretriz Visual: ${item.descricao_visual}\n`;
      output += `Copy Legenda: ${item.copy_legenda}\n`;
      output += `Prompt de Imagem:\n${item.image_prompt}\n`;
    });

    output += `\n--- REELS VERTICAIS (1080x1920) ---\n`;
    langData.reels.forEach(item => {
      output += `\n[ARQUIVO: ${item.file}] ${item.estilo_base}\n`;
      output += `Gancho 0-3s: ${item.gancho_0_3s}\n`;
      output += `Locução: ${item.roteiro_audio}\n`;
      output += `Centro (Safe Zone): ${item.elementos_visuais_centro}\n`;
      output += `CTA Seguro: ${item.cta_posicionado}\n`;
      output += `Prompt de Imagem:\n${item.image_prompt}\n`;
    });
  });

  const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentCampaign.title.replace(/[^a-zA-Z0-9]/g, '_')}_Bloco${currentBloco}_completo.txt`;
  a.click();
  showToast('Download do pacote multilíngue iniciado!');
}

// API Key Management & Popover
function setupApiKey() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const savedKey = localStorage.getItem('twod_gemini_api_key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
    updateKeyBadge(true);
  } else {
    updateKeyBadge(false);
  }

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    const popover = document.getElementById('apiPopover');
    const trigger = document.getElementById('btnApiToggle');
    if (popover && popover.classList.contains('open')) {
      if (!popover.contains(e.target) && !trigger.contains(e.target)) {
        popover.classList.remove('open');
      }
    }
  });
}

function toggleApiPopover(forceState) {
  const popover = document.getElementById('apiPopover');
  if (!popover) return;
  if (typeof forceState === 'boolean') {
    if (forceState) popover.classList.add('open');
    else popover.classList.remove('open');
  } else {
    popover.classList.toggle('open');
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKeyInput');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function saveApiKey() {
  const input = document.getElementById('apiKeyInput');
  const val = input.value.trim();
  if (val) {
    localStorage.setItem('twod_gemini_api_key', val);
    updateKeyBadge(true);
    showToast('Chave da API Gemini salva com sucesso!');
    toggleApiPopover(false);
  } else {
    clearApiKey();
  }
}

function clearApiKey() {
  const input = document.getElementById('apiKeyInput');
  input.value = '';
  localStorage.removeItem('twod_gemini_api_key');
  updateKeyBadge(false);
  showToast('Chave removida.');
}

function updateKeyBadge(connected) {
  const badge = document.getElementById('keyBadge');
  const dot = document.getElementById('headerKeyBadge');
  const trigger = document.getElementById('btnApiToggle');

  if (connected) {
    if (badge) {
      badge.textContent = '✓ Chave Ativa e Pronta';
      badge.className = 'key-status-text connected';
    }
    if (dot) {
      dot.className = 'api-status-dot active';
      dot.title = 'API Gemini Conectada';
    }
    if (trigger) {
      trigger.classList.add('has-key');
    }
  } else {
    if (badge) {
      badge.textContent = 'Nenhuma chave configurada';
      badge.className = 'key-status-text';
    }
    if (dot) {
      dot.className = 'api-status-dot';
      dot.title = 'Sem chave configurada';
    }
    if (trigger) {
      trigger.classList.remove('has-key');
    }
  }
}

// Tabs
function setupTabs() {
  const tabQuadrados = document.getElementById('tabQuadrados');
  const tabReels = document.getElementById('tabReels');
  const viewQuadrados = document.getElementById('quadradosCards');
  const viewReels = document.getElementById('reelsCards');

  tabQuadrados.addEventListener('click', () => {
    currentTab = 'quadrados';
    tabQuadrados.classList.add('active');
    tabReels.classList.remove('active');
    viewQuadrados.style.display = 'grid';
    viewReels.style.display = 'none';
  });

  tabReels.addEventListener('click', () => {
    currentTab = 'reels';
    tabReels.classList.add('active');
    tabQuadrados.classList.remove('active');
    viewQuadrados.style.display = 'none';
    viewReels.style.display = 'grid';
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function showLoading(msg) {
  const overlay = document.getElementById('loadingOverlay');
  document.getElementById('loadingText').textContent = msg;
  overlay.classList.add('active');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
}

// Sample Generated Content for Campaign 1 (Bingo - Bloco A: Fotos Realistas / Advertorial / Clean)
function getSampleBingoGeneratedA() {
  return {
    pt: {
      criativos_quadrados: [
        {
          file: "1.png",
          estilo: "Estilo 1 - Advertorial (Foto)",
          badge: "Advertorial",
          categoria: "NOVIDADE • APP DO DIA",
          titulo: "JOGAR BINGO EM CASA COM AMIGOS DE VERDADE FICOU FÁCIL",
          subtitulo: "Salas ao vivo 24h, cartelas grátis e a emoção de gritar BINGO sem apostar um centavo real.",
          descricao_visual: "Fundo com cor sólida azul-cobalto de alto contraste. Metade inferior com moldura arredondada contendo foto ultra-realista de uma família reunida no sofá rindo com celulares na mão marcando cartelas virtuais.",
          cta: "BAIXAR GRÁTIS",
          copy_legenda: "Bateu aquela saudade de marcar a cartela? Jogue bingo ao vivo online com milhares de pessoas de todo o Brasil, 100% gratuito. Baixe agora e comece a rodada!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 com APARÊNCIA DE ANÚNCIO ADVERTORIAL e FOTO REAL. Etiqueta de categoria no topo: 'NOVIDADE • APP DO DIA'. Título grande em negrito: 'JOGAR BINGO EM CASA COM AMIGOS DE VERDADE FICOU FÁCIL'. Subtítulo curto embaixo. Na metade inferior, moldura arredondada com fotografia realista de família sorrindo jogando bingo no celular na sala. Botão largo arredondado: 'BAIXAR GRÁTIS'. Fundo azul cobalto forte, contraste alto, leitura rápida. Sem logos de terceiros, sem marcas d'água."
        },
        {
          file: "2.png",
          estilo: "Estilo 2 - Clean com Foto",
          badge: "Clean & Moderno",
          categoria: "FEED 2S • INSTAGRAM",
          titulo: "Saudades daquele domingo jogando bingo?",
          subtitulo: "Agora você tem rodadas ao vivo no celular a qualquer hora.",
          descricao_visual: "Fundo cinza-claro minimalista levemente desfocado. No centro, close nítido em alta resolução de mãos segurando um smartphone com a cartela iluminada e feijõezinhos de bingo coloridos ao lado.",
          cta: "JOGAR AGORA",
          copy_legenda: "Você não precisa esperar o fim de semana para marcar sua cartela. Salas ao vivo com gente do Brasil todo. Baixe grátis agora!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 em estilo CLEAN E MODERNO com FOTO. Fundo cinza claro levemente desfocado. Título grande preto centralizado no topo: 'Saudades daquele domingo jogando bingo?'. No centro, foto realista em close-up de smartphone mostrando cartela virtual colorida e feijões tradicionais ao redor. Botão largo arredondado embaixo: 'JOGAR AGORA'. Estilo feed 2s, sem promessas não comprováveis."
        },
        {
          file: "3.png",
          estilo: "Estilo 3 - Foto Full-BG",
          badge: "Foto Full Background",
          categoria: "FOTO REALISTA",
          titulo: "A EMOÇÃO DO BINGO TRADICIONAL NA PALMA DA SUA MÃO",
          subtitulo: "Participe de salas animadas ao vivo com jogadores reais de todo o país.",
          descricao_visual: "Fotografia lifestyle quente e realista ocupando 100% do enquadramento: avó e neta sorrindo vibrando com a vitória do bingo na sala de estar iluminada pelo sol. Degradê escuro suave no topo para destacar as fontes brancas.",
          cta: "COMEÇAR AGORA",
          copy_legenda: "Diversão garantida para você e toda a família. Fichas virtuais sem aposta de dinheiro real. Baixe grátis e entre na próxima rodada!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 com FOTOGRAFIA REALISTA OCUPANDO TODO O FUNDO, mostrando avó e neta vibrando ao ganhar no bingo na sala de casa, iluminação acolhedora e natural. Textos no topo em área segura transparente com degradê sutil: 'A EMOÇÃO DO BINGO TRADICIONAL NA PALMA DA SUA MÃO'. Botão arredondado embaixo: 'COMEÇAR AGORA'."
        }
      ],
      reels: [
        {
          file: "4.png",
          estilo_base: "Adaptação Estilo 1 (Advertorial)",
          gancho_0_3s: "Texto pulsante no topo central: 'QUEM AQUI TEM SAUDADE DE GRITAR BINGO?' com som da primeira bola caindo.",
          roteiro_audio: "Bateu a saudade de marcar a cartela e gritar bingo? Baixe esse aplicativo grátis e entre nas rodadas de bingo ao vivo com gente de todo o Brasil, a qualquer hora. Baixe agora grátis.",
          elementos_visuais_centro: "Tela dividida com uma pessoa vibrando na sala e a animação fluida da cartela completando uma quina.",
          cta_posicionado: "Botão pulsante 'BAIXE AGORA GRÁTIS' fixado exatamente aos 370px da base (área livre do feed).",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo (áreas de segurança do Instagram). Adapte a arte Advertorial: elementos principais centralizados, etiqueta 'NOVIDADE', gancho 'QUEM TEM SAUDADE DE GRITAR BINGO?', foto da família no centro, botão 'BAIXE AGORA GRÁTIS' posicionado acima da área inferior."
        },
        {
          file: "5.png",
          estilo_base: "Adaptação Estilo 2 (Clean com Foto)",
          gancho_0_3s: "POV realista: Mão segurando um café e no celular a notificação 'A rodada das 19h vai começar!'.",
          roteiro_audio: "Rodadas ao vivo de bingo com salas cheias o dia todo. Sem apostas, só a boa e velha diversão.",
          elementos_visuais_centro: "Cartela virtual interativa girando em perspectiva 3D limpa sobre fundo claro.",
          cta_posicionado: "Sticker interativo 'INSTALAR APP' centralizado acima da barra de legenda do Instagram.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo (áreas de segurança do Instagram). Adapte o Estilo Clean com Foto: fundo claro, pergunta 'Saudades de jogar bingo?', smartphone com cartela no centro da tela, botão largo 'INSTALAR APP' logo acima da margem inferior."
        },
        {
          file: "6.png",
          estilo_base: "Adaptação Estilo 3 (Foto Full-BG)",
          gancho_0_3s: "Vídeo lifestyle dinâmico: sorriso espontâneo e o grito de 'BINGOOOO!' nos primeiros 2 segundos.",
          roteiro_audio: "Jogue com pessoas reais do Brasil todo direto do seu sofá. É só baixar e entrar na sala gratuita.",
          elementos_visuais_centro: "Ambiente aconchegante, smartphone em primeiro plano nítido com o jogo rodando.",
          cta_posicionado: "Botão 'JOGUE GRÁTIS' visível no terço médio-inferior (área de segurança garantida).",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo (áreas de segurança do Instagram). Adapte o Estilo Foto Full-BG: cena realista vertical, texto 'BINGO AO VIVO GRÁTIS' no terço central superior, botão 'JOGUE GRÁTIS' posicionado com segurança acima da barra de 350px."
        }
      ]
    },
    es: {
      criativos_quadrados: [
        {
          file: "1.png",
          estilo: "Estilo 1 - Advertorial (Foto)",
          badge: "Advertorial",
          categoria: "NOVEDAD • APP DEL DÍA",
          titulo: "JUGAR AL BINGO EN CASA CON AMIGOS REALES AHORA ES FÁCIL",
          subtitulo: "Salas en vivo 24h, cartones gratis y la emoción de cantar BINGO sin apostar dinero real.",
          descricao_visual: "Fondo azul cobalto de alto contraste. Mitad inferior con marco redondeado que muestra una familia sonriendo mientras juegan al bingo en el móvil.",
          cta: "DESCARGAR GRATIS",
          copy_legenda: "¿Extrañas marcar el cartón? Juega al bingo en vivo online con miles de personas de todo el mundo, 100% gratis. ¡Descarga ahora y entra a la sala!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 com APARÊNCIA DE ANÚNCIO ADVERTORIAL e FOTO REAL. Texto em espanhol: 'NOVEDAD • APP DEL DÍA'. Título: 'JUGAR AL BINGO EN CASA CON AMIGOS REALES AHORA ES FÁCIL'. Botão: 'DESCARGAR GRATIS'."
        },
        {
          file: "2.png",
          estilo: "Estilo 2 - Clean com Foto",
          badge: "Clean & Moderno",
          categoria: "FEED 2S • INSTAGRAM",
          titulo: "¿Extrañas aquel domingo jugando al bingo?",
          subtitulo: "Ahora tienes partidas en vivo en tu móvil a cualquier hora.",
          descricao_visual: "Fondo gris claro minimalista. Smartphone con cartón virtual iluminado en el centro.",
          cta: "JUGAR AHORA",
          copy_legenda: "No necesitas esperar al fin de semana. Salas en vivo con gente de todas partes. ¡Descárgalo gratis ahora!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 em estilo CLEAN E MODERNO com FOTO. Textos em espanhol: Título '¿Extrañas aquel domingo jugando al bingo?'. Botão 'JUGAR AHORA'."
        },
        {
          file: "3.png",
          estilo: "Estilo 3 - Foto Full-BG",
          badge: "Foto Full Background",
          categoria: "FOTO REALISTA",
          titulo: "LA EMOCIÓN DEL BINGO TRADICIONAL EN LA PALMA DE TU MANO",
          subtitulo: "Únete a salas animadas en vivo con jugadores reales.",
          descricao_visual: "Fotografía lifestyle realista ocupando todo el fondo: abuela y nieta celebrando una victoria en el salón.",
          cta: "EMPEZAR AHORA",
          copy_legenda: "Diversión garantizada para toda la familia. Fichas virtuales sin apuestas de dinero real. ¡Descarga gratis!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 com FOTOGRAFIA REALISTA OCUPANDO TODO O FUNDO. Textos em espanhol: 'LA EMOCIÓN DEL BINGO TRADICIONAL EN LA PALMA DE TU MANO'. Botão 'EMPEZAR AHORA'."
        }
      ],
      reels: [
        {
          file: "4.png",
          estilo_base: "Adaptação Estilo 1 (Advertorial)",
          gancho_0_3s: "Texto en el centro superior: '¿QUIÉN EXTRAÑA CANTAR BINGO?'.",
          roteiro_audio: "¿Extrañas marcar el cartón y cantar bingo? Descarga esta app gratis y entra a salas en vivo a cualquier hora.",
          elementos_visuais_centro: "Pantalla dividida con celebración familiar y animación del cartón ganador.",
          cta_posicionado: "Botón 'DESCARGAR GRATIS' arriba del margen inferior de 350px.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo. Textos em espanhol: Gancho '¿QUIÉN EXTRAÑA CANTAR BINGO?'. Botão 'DESCARGAR GRATIS' acima da área inferior."
        },
        {
          file: "5.png",
          estilo_base: "Adaptação Estilo 2 (Clean com Foto)",
          gancho_0_3s: "POV: Mano sosteniendo el móvil con la notificación '¡La ronda en vivo va a comenzar!'.",
          roteiro_audio: "Partidas de bingo en directo todo el día. Diversión pura sin apuestas.",
          elementos_visuais_centro: "Cartón virtual interactivo sobre fondo limpio.",
          cta_posicionado: "Sticker 'INSTALAR APP' arriba de la barra de Instagram.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo. Textos em espanhol: '¿Extrañas jugar al bingo?'. Botão 'INSTALAR APP'."
        },
        {
          file: "6.png",
          estilo_base: "Adaptação Estilo 3 (Foto Full-BG)",
          gancho_0_3s: "Vídeo dinámico con el grito de '¡BINGOOOO!' en los primeiros segundos.",
          roteiro_audio: "Juega con personas reales desde tu sofá. Solo descarga y únete a la diversión.",
          elementos_visuais_centro: "Escena acogedora con smartphone en primer plano nítido.",
          cta_posicionado: "Botón 'JUGAR GRATIS' en área segura central inferior.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo. Textos em espanhol: 'BINGO EN VIVO GRATIS'. Botão 'JUGAR GRATIS'."
        }
      ]
    },
    en: {
      criativos_quadrados: [
        {
          file: "1.png",
          estilo: "Estilo 1 - Advertorial (Foto)",
          badge: "Advertorial",
          categoria: "NEW • APP OF THE DAY",
          titulo: "PLAYING BINGO AT HOME WITH REAL FRIENDS JUST GOT EASY",
          subtitulo: "24/7 live rooms, free cards, and the thrill of calling BINGO without real-money betting.",
          descricao_visual: "Cobalt blue high-contrast background. Rounded frame showing a real family smiling while marking cards on phones.",
          cta: "DOWNLOAD FREE",
          copy_legenda: "Miss that classic bingo excitement? Play live online with thousands of players worldwide, 100% free. Download and join the room now!",
          image_prompt: "Create a 1080x1080 square advertising creative in ADVERTORIAL style with REAL PHOTO. Tag: 'NEW • APP OF THE DAY'. Headline: 'PLAYING BINGO AT HOME WITH REAL FRIENDS JUST GOT EASY'. Button: 'DOWNLOAD FREE'."
        },
        {
          file: "2.png",
          estilo: "Estilo 2 - Clean com Foto",
          badge: "Clean & Modern",
          categoria: "FEED 2S • INSTAGRAM",
          titulo: "Miss those family bingo game nights?",
          subtitulo: "Now you have live multiplayer rounds on your phone anytime.",
          descricao_visual: "Minimalist light-gray background with slight blur. Close-up of hands holding a smartphone with an illuminated bingo card.",
          cta: "PLAY NOW",
          copy_legenda: "No need to wait for game night. Join active live rooms all day long. Download free now!",
          image_prompt: "Create a 1080x1080 square creative in CLEAN & MODERN style with PHOTO. English text: Headline 'Miss those family bingo game nights?'. Rounded button: 'PLAY NOW'."
        },
        {
          file: "3.png",
          estilo: "Estilo 3 - Foto Full-BG",
          badge: "Foto Full Background",
          categoria: "REALISTIC PHOTO",
          titulo: "THE THRILL OF TRADITIONAL BINGO IN THE PALM OF YOUR HAND",
          subtitulo: "Join lively multiplayer rooms with real players anytime.",
          descricao_visual: "Warm realistic lifestyle photography filling the frame: grandmother and granddaughter celebrating a win on the couch.",
          cta: "START NOW",
          copy_legenda: "Wholesome fun for the whole family. Free virtual chips, no cash gambling. Download free and join the next game!",
          image_prompt: "Create a 1080x1080 square creative with REALISTIC FULL-BG PHOTO. English text: 'THE THRILL OF TRADITIONAL BINGO IN THE PALM OF YOUR HAND'. Button: 'START NOW'."
        }
      ],
      reels: [
        {
          file: "4.png",
          estilo_base: "Adaptação Estilo 1 (Advertorial)",
          gancho_0_3s: "Pulsing text at center-top: 'WHO MISSES SHOUTING BINGO?' with ball drop sound.",
          roteiro_audio: "Miss marking cards and shouting bingo? Download this free app and join live rounds with players from everywhere. Get it free now.",
          elementos_visuais_centro: "Split screen showing happy family celebration and smooth card animation.",
          cta_posicionado: "Button 'DOWNLOAD FREE' positioned above the 350px bottom zone.",
          image_prompt: "For REELS version (vertical 1080x1920): 250px free on top and 350px at bottom. English text: Hook 'WHO MISSES SHOUTING BINGO?'. Button 'DOWNLOAD FREE' above bottom margin."
        },
        {
          file: "5.png",
          estilo_base: "Adaptação Estilo 2 (Clean com Foto)",
          gancho_0_3s: "POV: Hand holding phone showing 'The live 7 PM round is starting now!'.",
          roteiro_audio: "Live bingo rooms packed all day long. No gambling, just classic fun.",
          elementos_visuais_centro: "Clean 3D perspective virtual bingo card over light background.",
          cta_posicionado: "Sticker 'INSTALL APP' centered above the Instagram bottom bar.",
          image_prompt: "For REELS version (vertical 1080x1920): 250px free on top and 350px at bottom. English text: 'Miss playing bingo?'. Button 'INSTALL APP'."
        },
        {
          file: "6.png",
          estilo_base: "Adaptação Estilo 3 (Foto Full-BG)",
          gancho_0_3s: "Dynamic video: Genuine laughter and 'BINGOOOO!' in the first 2 seconds.",
          roteiro_audio: "Play with real people right from your couch. Just download and join the free room.",
          elementos_visuais_centro: "Cozy room, smartphone in sharp foreground running the game.",
          cta_posicionado: "Button 'PLAY FOR FREE' in the central-lower safe area.",
          image_prompt: "For REELS version (vertical 1080x1920): 250px free on top and 350px at bottom. English text: 'FREE LIVE BINGO'. Button 'PLAY FOR FREE'."
        }
      ]
    }
  };
}

// Alias for safety
function getSampleBingoGenerated() {
  return getSampleBingoGeneratedA();
}

// Sample Generated Content for Campaign 1 (Bingo - Bloco B: Ilustração Flat / Render 3D / Tipográfico)
function getSampleBingoGeneratedB() {
  return {
    pt: {
      criativos_quadrados: [
        {
          file: "1.png",
          estilo: "Estilo 1 - Ilustração Flat / Vetorial",
          badge: "Ilustração Flat",
          categoria: "DIVERSÃO • VETORIAL MODERNO",
          titulo: "O BINGO ONLINE MAIS DIVERTIDO DO BRASIL",
          subtitulo: "Visual ilustrado leve, cartelas coloridas e rodadas grátis o dia todo no seu celular.",
          descricao_visual: "Ilustração flat 2D moderna com formas geométricas amigáveis e cores vibrantes. Mascote simpático de bolinha de bingo amarela comemorando ao lado de uma cartela estilizada.",
          cta: "JOGAR AGORA",
          copy_legenda: "Quem disse que bingo precisa ser sério? Venha se divertir com visual ilustrado moderno e milhares de pessoas jogando ao vivo, 100% gratuito!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 em estilo ILUSTRAÇÃO FLAT / VETORIAL MODERNO (sem foto realista). Cores chapadas e vibrantes, formas simples e amigáveis, um mascote ilustrado de bolinha de bingo no centro ao lado de uma cartela colorida. Título grande em negrito: 'O BINGO ONLINE MAIS DIVERTIDO DO BRASIL'. Botão arredondado embaixo: 'JOGAR AGORA'. Visual limpo e divertido."
        },
        {
          file: "2.png",
          estilo: "Estilo 2 - Render 3D Moderno",
          badge: "Render 3D",
          categoria: "3D PREMIUM • AO VIVO",
          titulo: "RODADAS AO VIVO 24 HORAS NO SEU CELULAR",
          subtitulo: "Globo de bingo e bolinhas douradas em 3D brilhante. Entre na sala grátis.",
          descricao_visual: "Render 3D estilizado de alta qualidade: globo de bingo em acrílico translúcido girando com bolinhas numeradas douradas e azuis flutuando com iluminação macia de estúdio sobre fundo escuro.",
          cta: "BAIXAR APP",
          copy_legenda: "Experiência premium de bingo no seu smartphone. Efeitos 3D incríveis, salas lotadas e zero aposta de dinheiro real. Baixe grátis agora!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 em estilo RENDER 3D MODERNO. Globo de bingo estilizado e bolinhas douradas e azuis numeradas em 3D flutuando sobre fundo sólido escuro com iluminação suave e cores vivas. Título grande em negrito: 'RODADAS AO VIVO 24 HORAS NO SEU CELULAR'. Botão arredondado chamativo: 'BAIXAR APP'. Aparência premium e chamativa."
        },
        {
          file: "3.png",
          estilo: "Estilo 3 - Tipográfico Ousado",
          badge: "Tipográfico Ousado",
          categoria: "TEXTO PURO • ALTO IMPACTO",
          titulo: "BATEU A SAUDADE DE GRITAR BINGO?",
          subtitulo: "Salas ao vivo sem apostar nada. 100% grátis para toda a família.",
          descricao_visual: "Design tipográfico brutalista e arrojado: o TEXTO é o protagonista em letras monumentais em negrito com contraste amarelo âmbar sobre fundo roxo escuro. Ícone minimalista de cartela no canto.",
          cta: "COMEÇAR AGORA",
          copy_legenda: "Basta baixar para entrar na rodada. O bingo tradicional com a emoção das salas ao vivo na tela do seu celular!",
          image_prompt: "Crie um criativo publicitário quadrado 1080x1080 em estilo TIPOGRÁFICO OUSADO. O TEXTO é o protagonista absoluto, com tipografia enorme e marcante ocupando toda a arte: 'BATEU A SAUDADE DE GRITAR BINGO?'. Fundo de cor sólida forte com alto contraste. Botão arredondado chamativo: 'COMEÇAR AGORA'. Nada de fotos realistas."
        }
      ],
      reels: [
        {
          file: "4.png",
          estilo_base: "Adaptação Estilo 1 (Ilustração Flat)",
          gancho_0_3s: "Animação flat dinâmica: bolinha ilustrada saltando e gritando 'BINGO!' no topo.",
          roteiro_audio: "Bateu a saudade de marcar a cartela e gritar bingo? Baixe esse aplicativo grátis e entre nas rodadas ao vivo.",
          elementos_visuais_centro: "Cartelas virtuais ilustradas flat coloridas com animações alegres.",
          cta_posicionado: "Botão 'BAIXAR GRÁTIS' fixado acima da margem inferior de 350px.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo. Adapte o Estilo Ilustração Flat: mascote de bolinha no centro, elementos gráficos coloridos, botão 'BAIXAR GRÁTIS' posicionado acima da área inferior."
        },
        {
          file: "5.png",
          estilo_base: "Adaptação Estilo 2 (Render 3D)",
          gancho_0_3s: "Globo dourado 3D girando em slow-motion com faíscas suaves.",
          roteiro_audio: "Salas cheias o dia todo com efeitos 3D incríveis. É só baixar e começar a jogar.",
          elementos_visuais_centro: "Smartphone 3D flutuante mostrando a cartela iluminada.",
          cta_posicionado: "Sticker 3D 'INSTALAR AGORA' posicionado no centro-inferior seguro.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo. Adapte o Estilo Render 3D: globo de bingo flutuando no centro, iluminação volumétrica, botão 'INSTALAR AGORA' acima da margem inferior."
        },
        {
          file: "6.png",
          estilo_base: "Adaptação Estilo 3 (Tipográfico Ousado)",
          gancho_0_3s: "Palavras gigantes em corte rápido de 0.5s: QUEM • QUER • BINGO?",
          roteiro_audio: "Sem aposta em dinheiro, só a diversão clássica com amigos. Baixe agora.",
          elementos_visuais_centro: "Tipografia monumental em alto contraste preenchendo a tela segura.",
          cta_posicionado: "Botão grande 'JOGAR GRÁTIS' na safe zone.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres no topo e 350px embaixo. Adapte o Estilo Tipográfico: letras gigantes 'BINGO AO VIVO', fundo vibrante, botão 'JOGAR GRÁTIS' acima dos 350px inferiores."
        }
      ]
    },
    es: {
      criativos_quadrados: [
        {
          file: "1.png",
          estilo: "Estilo 1 - Ilustración Flat / Vectorial",
          badge: "Ilustración Flat",
          categoria: "DIVERSIÓN • VECTORIAL MODERNO",
          titulo: "EL BINGO ONLINE MÁS DIVERTIDO Y 100% GRATIS",
          subtitulo: "Diseño ilustrado colorido y partidas en vivo en tu móvil a toda hora.",
          descricao_visual: "Ilustración flat 2D moderna con colores brillantes. Mascota simpática de bola de bingo celebrando.",
          cta: "JUGAR AHORA",
          copy_legenda: "¡La diversión clásica del bingo ahora con estilo ilustrado y miles de personas en directo!",
          image_prompt: "Crie um criativo quadrado 1080x1080 em estilo ILUSTRAÇÃO FLAT MODERNO. Textos em espanhol: 'EL BINGO ONLINE MÁS DIVERTIDO Y 100% GRATIS'. Botão: 'JUGAR AHORA'."
        },
        {
          file: "2.png",
          estilo: "Estilo 2 - Render 3D Moderno",
          badge: "Render 3D",
          categoria: "3D PREMIUM • EN DIRECTO",
          titulo: "PARTIDAS EN DIRECTO LAS 24 HORAS EN TU MÓVIL",
          subtitulo: "Bombo de bingo y bolas doradas en 3D brillante. Únete gratis.",
          descricao_visual: "Render 3D estilizado: bombo translúcido con bolas doradas flotantes sobre fondo oscuro elegante.",
          cta: "DESCARGAR APP",
          copy_legenda: "Experiencia premium de bingo en tu smartphone. Efectos 3D increíbles y sin apuestas reales.",
          image_prompt: "Crie um criativo quadrado 1080x1080 em estilo RENDER 3D. Textos em espanhol: 'PARTIDAS EN DIRECTO LAS 24 HORAS EN TU MÓVIL'. Botão: 'DESCARGAR APP'."
        },
        {
          file: "3.png",
          estilo: "Estilo 3 - Tipográfico Ousado",
          badge: "Tipográfico Ousado",
          categoria: "TEXTO PURO • ALTO IMPACTO",
          titulo: "¿EXTRAÑAS CANTAR BINGO BIEN FUERTE?",
          subtitulo: "Salas en vivo sin apostar dinero. 100% gratis para toda la familia.",
          descricao_visual: "Diseño tipográfico con letras monumentales en alto contraste sobre fondo morado oscuro.",
          cta: "EMPEZAR AHORA",
          copy_legenda: "Solo descarga y juega al bingo clásico con miles de jugadores en salas en vivo.",
          image_prompt: "Crie um criativo quadrado 1080x1080 em estilo TIPOGRÁFICO OUSADO. Textos em espanhol: '¿EXTRAÑAS CANTAR BINGO BIEN FUERTE?'. Botão: 'EMPEZAR AHORA'."
        }
      ],
      reels: [
        {
          file: "4.png",
          estilo_base: "Adaptação Estilo 1 (Ilustración Flat)",
          gancho_0_3s: "Animación flat: Bola sonriente gritando '¡BINGO!'.",
          roteiro_audio: "¿Extrañas marcar el cartón? Descarga gratis esta app y juega en directo.",
          elementos_visuais_centro: "Cartones ilustrados coloridos.",
          cta_posicionado: "Botón 'DESCARGAR GRATIS' en área segura.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres topo e 350px embaixo. Textos em espanhol: '¡BINGO EN VIVO!'. Botão 'DESCARGAR GRATIS'."
        },
        {
          file: "5.png",
          estilo_base: "Adaptação Estilo 2 (Render 3D)",
          gancho_0_3s: "Bombo 3D girando en cámara lenta con bolas doradas.",
          roteiro_audio: "Salas llenas todo el día con efectos 3D geniales. Descarga gratis.",
          elementos_visuais_centro: "Smartphone 3D mostrando el cartón.",
          cta_posicionado: "Sticker 'INSTALAR AHORA' en área segura.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres topo e 350px embaixo. Textos em espanhol: 'BINGO 3D'. Botão 'INSTALAR AHORA'."
        },
        {
          file: "6.png",
          estilo_base: "Adaptação Estilo 3 (Tipográfico Ousado)",
          gancho_0_3s: "Palabras gigantes: ¿QUIÉN • QUIERE • BINGO?",
          roteiro_audio: "Sin apuestas reales, solo diversión pura. Descarga ya.",
          elementos_visuais_centro: "Tipografía de impacto.",
          cta_posicionado: "Botón 'JUGAR GRATIS' en área segura.",
          image_prompt: "Para versão REELS (vertical 1080x1920): 250px livres topo e 350px embaixo. Textos em espanhol: 'BINGO GRATIS'. Botão 'JUGAR GRATIS'."
        }
      ]
    },
    en: {
      criativos_quadrados: [
        {
          file: "1.png",
          estilo: "Estilo 1 - Ilustração Flat / Vetorial",
          badge: "Flat Illustration",
          categoria: "FUN • MODERN VECTOR",
          titulo: "THE MOST FUN LIVE BINGO EXPERIENCE ONLINE",
          subtitulo: "Colorful illustrated cards, cheerful vibes, and free rounds 24/7 on your phone.",
          descricao_visual: "Modern 2D flat illustration with cheerful bingo ball mascot celebrating next to virtual cards.",
          cta: "PLAY NOW",
          copy_legenda: "Who said bingo has to be boring? Join live rooms with thousands of friendly players worldwide, 100% free!",
          image_prompt: "Create a 1080x1080 square creative in MODERN FLAT VECTOR ILLUSTRATION style (no realistic photo). Bold colorful shapes, friendly bingo ball mascot in center. Headline: 'THE MOST FUN LIVE BINGO EXPERIENCE ONLINE'. Button: 'PLAY NOW'."
        },
        {
          file: "2.png",
          estilo: "Estilo 2 - Render 3D Moderno",
          badge: "3D Render",
          categoria: "3D PREMIUM • LIVE",
          titulo: "24/7 LIVE BINGO ROOMS RIGHT ON YOUR PHONE",
          subtitulo: "Shiny 3D bingo cage and golden numbered balls. Join free.",
          descricao_visual: "High-end stylized 3D render: translucent acrylic cage spinning with floating glossy golden balls.",
          cta: "DOWNLOAD APP",
          copy_legenda: "Premium bingo graphics on your smartphone. Stunning 3D effects and zero real-money gambling. Get it free now!",
          image_prompt: "Create a 1080x1080 square creative in MODERN 3D RENDER style. Stylized 3D bingo cage and glossy golden balls floating over dark studio background. Headline: '24/7 LIVE BINGO ROOMS RIGHT ON YOUR PHONE'. Button: 'DOWNLOAD APP'."
        },
        {
          file: "3.png",
          estilo: "Estilo 3 - Tipográfico Ousado",
          badge: "Bold Typography",
          categoria: "PURE TEXT • HIGH IMPACT",
          titulo: "WHO MISSES SHOUTING BINGO OUT LOUD?",
          subtitulo: "Free multiplayer rooms with no gambling. Fun for the whole family.",
          descricao_visual: "High-contrast bold typographical design: oversized punchy text filling the canvas over dark purple and amber gradient.",
          cta: "START NOW",
          copy_legenda: "Just download and start playing. Classic bingo excitement right at your fingertips!",
          image_prompt: "Create a 1080x1080 square creative in BOLD TYPOGRAPHY style. Oversized massive letters taking over the canvas: 'WHO MISSES SHOUTING BINGO OUT LOUD?'. High contrast solid background, rounded button: 'START NOW'. No photos."
        }
      ],
      reels: [
        {
          file: "4.png",
          estilo_base: "Adaptação Estilo 1 (Ilustração Flat)",
          gancho_0_3s: "Animated flat mascot bouncing and shouting 'BINGO!'.",
          roteiro_audio: "Miss marking cards and shouting bingo? Download this free app and join live rooms.",
          elementos_visuais_centro: "Colorful flat illustrated bingo cards.",
          cta_posicionado: "Button 'DOWNLOAD FREE' above bottom margin.",
          image_prompt: "For REELS version (vertical 1080x1920): 250px free on top and 350px at bottom. Flat illustration style: mascot in center, button 'DOWNLOAD FREE' positioned above bottom area."
        },
        {
          file: "5.png",
          estilo_base: "Adaptação Estilo 2 (Render 3D)",
          gancho_0_3s: "3D golden cage spinning in smooth slow motion.",
          roteiro_audio: "Full rooms all day long with sleek 3D visuals. Free to play.",
          elementos_visuais_centro: "Floating 3D phone displaying the game.",
          cta_posicionado: "Sticker 'INSTALL APP' above 350px bottom zone.",
          image_prompt: "For REELS version (vertical 1080x1920): 250px free on top and 350px at bottom. 3D Render style: golden cage, button 'INSTALL APP' above bottom zone."
        },
        {
          file: "6.png",
          estilo_base: "Adaptação Estilo 3 (Tipográfico Ousado)",
          gancho_0_3s: "Massive pulsing words: WHO • WANTS • BINGO?",
          roteiro_audio: "No cash gambling, just pure classic fun with friends. Download now.",
          elementos_visuais_centro: "High impact bold typography.",
          cta_posicionado: "Button 'PLAY FOR FREE' in safe area.",
          image_prompt: "For REELS version (vertical 1080x1920): 250px free on top and 350px at bottom. Bold typography: 'LIVE BINGO', button 'PLAY FOR FREE' above bottom zone."
        }
      ]
    }
  };
}
