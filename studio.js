// ========================================================
// TWOD CRIATIVOS STUDIO V2 (ONEDRIVE + FFMPEG NUVEM)
// ========================================================

const studioState = {
    campaigns: [],
    selectedSet: new Set(),
    pollTimer: null,
    activeCampaign: '',
    uploading: false,
};

function _studioEsc(str) {
    if (typeof window.escHtml === 'function') return window.escHtml(str);
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getTodayIsoDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatStudioDateShort(dateInputVal) {
    if (!dateInputVal) return '';
    const m = String(dateInputVal).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
    return String(dateInputVal).trim();
}

function splitCampaignAndDate(fullName) {
    const raw = String(fullName || '').trim();
    const m = raw.match(/^(.*?)\s+(\d{1,2})[.\-_](\d{1,2})(?:[.\-_](\d{2,4}))?$/);
    if (!m) return { niche: raw, isoDate: '' };
    const dd = m[2].padStart(2, '0');
    const mm = m[3].padStart(2, '0');
    let yy = m[4] ? m[4] : String(new Date().getFullYear()).slice(-2);
    if (yy.length === 2) yy = `20${yy}`;
    return { niche: m[1].trim(), isoDate: `${yy}-${mm}-${dd}` };
}

function getStudioTargetCampaignAndDate() {
    const nicheEl = document.getElementById('studio-niche-input');
    const dateEl = document.getElementById('studio-date-input');
    const niche = (nicheEl?.value || '').trim();
    const dateIso = (dateEl?.value || '').trim();
    const dateShort = formatStudioDateShort(dateIso);
    const hasEmbeddedDate = /\d{1,2}[.\-_]\d{1,2}/.test(niche);
    const fullName = niche ? (hasEmbeddedDate ? niche : (dateShort ? `${niche} ${dateShort}` : niche)) : '';
    return { niche, dateIso, dateShort, fullName };
}

function updateStudioNamingPreview() {
    const prevEl = document.getElementById('studio-naming-preview');
    if (!prevEl) return;
    const { niche, fullName } = getStudioTargetCampaignAndDate();
    const useBlocks = document.getElementById('studio-use-blocks')?.value !== 'single';
    const blockSel = document.getElementById('studio-img-block')?.value || 'Bloco A';
    const langSel = document.getElementById('studio-img-lang')?.value || 'pt';
    const langFolderMap = { pt: '1. Imagens', es: 'Espanhol', en: 'Inglês', fr: 'Francês', it: 'Italiano', de: 'Alemão' };
    const imgSub = langFolderMap[langSel] || langSel.toUpperCase();
    const slug = (niche.replace(/\s+\d{1,2}[.\-_]\d{1,2}.*$/, '').replace(/[^a-zA-Z0-9À-ÿ_-]+/g, '') || 'Nicho');

    if (!fullName) {
        prevEl.innerHTML = '💡 Digite o <strong>Nicho</strong> e a <strong>Data</strong> para ver os caminhos automáticos do OneDrive.';
    } else {
        const blockPart = (useBlocks && blockSel !== 'Único') ? `${blockSel}/` : '';
        prevEl.innerHTML = `
            📁 <strong>Áudios:</strong> <code>Arquivos de Áudio/${_studioEsc(fullName)}/${_studioEsc(slug)}_pt.mp3</code> (<code>_es</code>, <code>_en</code>...) &nbsp;•&nbsp;
            🎬 <strong>Imagens:</strong> <code>Vídeos/${_studioEsc(fullName)}/${_studioEsc(blockPart)}${_studioEsc(imgSub)}/1.png..6.png</code>
        `;
    }
    if (typeof window.refreshCfTargetSummary === 'function') {
        window.refreshCfTargetSummary();
    }
}

function setStudioTargetCampaign(campFullName) {
    const { niche, isoDate } = splitCampaignAndDate(campFullName);
    const nicheEl = document.getElementById('studio-niche-input');
    const dateEl = document.getElementById('studio-date-input');
    if (nicheEl) nicheEl.value = niche || campFullName;
    if (dateEl && isoDate) dateEl.value = isoDate;
    studioState.activeCampaign = campFullName;
    updateStudioNamingPreview();
    auditStudioCampaigns([campFullName]);
}

function setStudioUploadStatus(msg, type = 'info') {
    const el = document.getElementById('studio-upload-status');
    if (!el) return;
    el.classList.remove('twod-hidden');
    const colors = {
        info: { bg: 'rgba(59,130,246,0.12)', bd: 'rgba(59,130,246,0.35)', fg: '#93c5fd' },
        success: { bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.35)', fg: '#34d399' },
        warn: { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)', fg: '#fbbf24' },
        error: { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.35)', fg: '#f87171' }
    }[type] || {};
    el.style.background = colors.bg || '';
    el.style.border = `1px solid ${colors.bd || 'var(--border-color)'}`;
    el.style.color = colors.fg || 'var(--text-primary)';
    el.innerHTML = msg;
}

async function createStudioCampaignStructure() {
    const { niche, dateIso, fullName } = getStudioTargetCampaignAndDate();
    if (!niche) {
        alert('Informe o nome do Nicho/Campanha (ex: ÁudioSecreto).');
        document.getElementById('studio-niche-input')?.focus();
        return;
    }
    const useBlocks = document.getElementById('studio-use-blocks')?.value !== 'single';
    setStudioUploadStatus(`⏳ Criando estrutura padrão no OneDrive para <strong>${_studioEsc(fullName)}</strong>...`, 'info');
    try {
        const resp = await window.apiFetch('/api/studio/create-campaign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ niche, date: dateIso, use_blocks: useBlocks })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Falha ao criar pastas');
        studioState.activeCampaign = data.campaign_name;
        studioState.selectedSet.add(data.campaign_name);
        setStudioUploadStatus(`✅ Pastas criadas no OneDrive: <code>${_studioEsc(data.campaign_name)}</code> (${useBlocks ? 'Bloco A & Bloco B + 1. Imagens' : 'Pasta Única + 1. Imagens'}).`, 'success');
        await loadStudioCampaigns();
    } catch (e) {
        setStudioUploadStatus(`❌ Erro ao criar pastas: ${_studioEsc(e.message)}`, 'error');
    }
}

async function handleStudioAudioUpload(fileList) {
    const files = Array.from(fileList || []).filter(f => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name));
    if (files.length === 0) {
        alert('Selecione arquivos de áudio válidos (.mp3, .wav, .m4a).');
        return;
    }
    const { niche, dateIso, fullName } = getStudioTargetCampaignAndDate();
    if (!niche) {
        alert('Informe o Nicho e a Data antes de enviar os áudios.');
        document.getElementById('studio-niche-input')?.focus();
        return;
    }
    const forcedLang = document.getElementById('studio-audio-lang')?.value || '';
    const results = [];
    setStudioUploadStatus(`⏳ Enviando ${files.length} áudio(s) para <code>Arquivos de Áudio/${_studioEsc(fullName)}</code>...`, 'info');

    try {
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const q = new URLSearchParams({
                campaign: niche,
                date: dateIso,
                lang: forcedLang,
                filename: f.name
            });
            const resp = await window.apiFetch(`/api/studio/upload-audio?${q.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: f
            });
            const data = await resp.json();
            if (!data.success) throw new Error(`${f.name}: ${data.error || 'falha no upload'}`);
            results.push(`<strong>${_studioEsc(data.filename)}</strong> (${_studioEsc(data.lang_name)}, ${data.duration}s ➔ ${data.duration_ceil}s)`);
        }
        studioState.selectedSet.add(fullName);
        setStudioUploadStatus(`✅ Áudios salvos no OneDrive: ${results.join(' • ')}`, 'success');
        await loadStudioCampaigns();
        auditStudioCampaigns([fullName]);
    } catch (e) {
        setStudioUploadStatus(`❌ Erro no upload de áudio: ${_studioEsc(e.message)}`, 'error');
    }
}

async function handleStudioImagesUpload(fileList) {
    const files = Array.from(fileList || []).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f.name));
    if (files.length === 0) {
        alert('Selecione imagens PNG, JPG ou WEBP.');
        return;
    }
    const { niche, dateIso, fullName } = getStudioTargetCampaignAndDate();
    if (!niche) {
        alert('Informe o Nicho e a Data antes de enviar as imagens.');
        document.getElementById('studio-niche-input')?.focus();
        return;
    }
    const useBlocks = document.getElementById('studio-use-blocks')?.value !== 'single';
    const block = useBlocks ? (document.getElementById('studio-img-block')?.value || 'Bloco A') : '';
    const lang = document.getElementById('studio-img-lang')?.value || 'pt';
    const batchId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    setStudioUploadStatus(`⏳ Enviando ${files.length} imagem(ns), validando integridade e padronizando 1–3 Feed / 4–6 Reels...`, 'info');
    try {
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const q = new URLSearchParams({ batch_id: batchId, filename: f.name });
            const stResp = await window.apiFetch(`/api/studio/stage-file?${q.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: f
            });
            const stData = await stResp.json();
            if (!stData.success) throw new Error(`${f.name}: ${stData.error || 'erro ao enviar'}`);
        }

        const commitResp = await window.apiFetch('/api/studio/commit-images', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_id: batchId,
                campaign: niche,
                date: dateIso,
                block,
                lang
            })
        });
        const data = await commitResp.json();
        if (!data.success) throw new Error(data.error || 'Erro ao padronizar imagens');

        const summary = (data.uploaded || []).map(u => `<code>${_studioEsc(u.filename)}</code> (${_studioEsc(u.kind)} ${_studioEsc(u.dims)})`).join(', ');
        const warnInvalid = data.invalid_files && data.invalid_files.length > 0
            ? ` &nbsp;|&nbsp; ⚠️ Ignoradas (corrompidas): ${_studioEsc(data.invalid_files.join(', '))}`
            : '';
        studioState.selectedSet.add(data.campaign_name);
        setStudioUploadStatus(`✅ Imagens salvas em <code>${_studioEsc(data.folder_path)}</code>: ${summary}${warnInvalid}`, 'success');
        await loadStudioCampaigns();
        auditStudioCampaigns([data.campaign_name]);
    } catch (e) {
        setStudioUploadStatus(`❌ Erro ao enviar imagens: ${_studioEsc(e.message)}`, 'error');
    }
}

async function handleStudioZipUpload(fileList) {
    const zipFile = Array.from(fileList || []).find(f => /\.zip$/i.test(f.name));
    if (!zipFile) {
        alert('Selecione um arquivo .ZIP válido.');
        return;
    }
    const { niche, dateIso } = getStudioTargetCampaignAndDate();
    setStudioUploadStatus(`⏳ Descompactando <strong>${_studioEsc(zipFile.name)}</strong>, criando pastas de Vídeo + Áudio e padronizando 1–6 no OneDrive...`, 'info');
    try {
        const q = new URLSearchParams({ campaign: niche || '', date: dateIso || '' });
        const resp = await window.apiFetch(`/api/studio/import-zip?${q.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: zipFile
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Erro ao importar ZIP');

        const camps = Array.isArray(data.campaigns) && data.campaigns.length > 0
            ? data.campaigns
            : [{ campaign_name: data.campaign_name, total_images: data.total_images || 0, existing_audios_count: 0, folders_imported: data.folders_imported || [] }];

        const campNames = camps.map(c => c.campaign_name).filter(Boolean);
        campNames.forEach(nm => studioState.selectedSet.add(nm));

        const lines = camps.map(c => {
            const audTxt = c.existing_audios_count > 0 ? `🎙️ ${c.existing_audios_count} áudio(s) OK` : '🎙️ Pasta de áudio pronta (envie os MP3)';
            return `• <strong>${_studioEsc(c.campaign_name)}</strong> (${c.total_images} img em ${(c.folders_imported || []).length} pastas) — ${audTxt}`;
        }).join('<br>');

        setStudioUploadStatus(`✅ Pacote ZIP descompactado no OneDrive (${data.total_images || 0} imagens em ${camps.length} nicho(s)):<br>${lines}`, 'success');
        await loadStudioCampaigns();
        if (campNames.length > 0) {
            auditStudioCampaigns(campNames);
        }
    } catch (e) {
        setStudioUploadStatus(`❌ Erro ao importar ZIP: ${_studioEsc(e.message)}`, 'error');
    }
}

async function loadStudioCampaigns(limit = 20) {
    const listEl = document.getElementById('studio-campaigns-list');
    if (!listEl) return;
    const search = (document.getElementById('studio-camp-search')?.value || '').trim();
    listEl.innerHTML = '<div class="text-muted" style="font-size:12px; padding:10px;">⏳ Listando nichos e datas do OneDrive...</div>';

    try {
        const q = new URLSearchParams({ limit: String(limit), search });
        const resp = await window.apiFetch(`/api/studio/campaigns?${q.toString()}`);
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Falha ao consultar OneDrive');

        studioState.campaigns = data.campaigns || [];
        renderStudioCampaignsList();
    } catch (e) {
        listEl.innerHTML = `<div class="text-muted" style="font-size:12px; padding:10px;">⚠️ ${_studioEsc(e.message)}</div>`;
    }
}

function renderStudioCampaignsList() {
    const listEl = document.getElementById('studio-campaigns-list');
    if (!listEl) return;
    if (!studioState.campaigns.length) {
        listEl.innerHTML = '<div class="text-muted" style="font-size:12px; padding:10px;">Nenhum nicho encontrado com esse filtro. Crie acima para começar.</div>';
        return;
    }

    listEl.innerHTML = studioState.campaigns.map(c => {
        const checked = studioState.selectedSet.has(c.name) ? 'checked' : '';
        const audBadge = c.has_audios_folder
            ? '<span class="studio-mini-badge ok">🎙️ Áudio OK</span>'
            : '<span class="studio-mini-badge warn">🎙️ Sem pasta áudio</span>';
        const vidBadge = c.has_videos_folder
            ? '<span class="studio-mini-badge ok">🎬 Vídeos/Img OK</span>'
            : '<span class="studio-mini-badge muted">🎬 Sem pasta vídeo</span>';

        return `
            <div class="studio-camp-row ${checked ? 'selected' : ''}">
                <label class="studio-camp-check">
                    <input type="checkbox" data-camp="${_studioEsc(c.name)}" ${checked} onchange="toggleStudioCampaignCheck(this.dataset.camp, this.checked)">
                    <span class="studio-camp-name">${_studioEsc(c.name)}</span>
                </label>
                <div class="studio-camp-meta">
                    <span class="studio-date-pill">📅 ${_studioEsc(c.date_label)}</span>
                    ${audBadge}
                    ${vidBadge}
                    <button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px; font-size:11px;" data-camp="${_studioEsc(c.name)}" onclick="setStudioTargetCampaign(this.dataset.camp)">📥 Selecionar p/ Envio</button>
                    <button type="button" class="btn btn-outline btn-sm" style="padding:3px 9px; font-size:11px;" data-camp="${_studioEsc(c.name)}" onclick="auditStudioCampaigns([this.dataset.camp])">🔍 Auditar</button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleStudioCampaignCheck(name, isChecked) {
    if (isChecked) studioState.selectedSet.add(name);
    else studioState.selectedSet.delete(name);
    renderStudioCampaignsList();
}

function selectStudioCampaignsPreset(mode) {
    studioState.selectedSet.clear();
    if (mode === 'all') {
        studioState.campaigns.forEach(c => studioState.selectedSet.add(c.name));
    } else if (mode === 'top3') {
        studioState.campaigns.slice(0, 3).forEach(c => studioState.selectedSet.add(c.name));
    }
    renderStudioCampaignsList();
}

async function auditStudioCampaigns(explicitNames = null) {
    const names = Array.isArray(explicitNames) && explicitNames.length > 0
        ? explicitNames
        : Array.from(studioState.selectedSet);

    if (names.length === 0) {
        alert('Marque ao menos 1 campanha/nicho na lista para verificar os arquivos.');
        return;
    }

    const box = document.getElementById('studio-audit-box');
    const body = document.getElementById('studio-audit-results');
    if (box) box.classList.remove('twod-hidden');
    if (body) body.innerHTML = `<div class="text-muted" style="font-size:12px;">⏳ Auditando ${names.length} nicho(s) no OneDrive (Blocos, 1. Imagens, Idiomas e Áudios)...</div>`;

    try {
        const reports = await Promise.all(names.map(async nm => {
            const resp = await window.apiFetch(`/api/studio/audit?name=${encodeURIComponent(nm)}`);
            return resp.json();
        }));

        body.innerHTML = reports.map(rep => {
            if (!rep.success) {
                return `<div class="studio-audit-card lvl-error"><strong>${_studioEsc(rep.name || 'Nicho')}</strong>: ${_studioEsc(rep.error || 'Erro')}</div>`;
            }
            const blocksHtml = (rep.blocks || []).map(blk => {
                const langsHtml = (blk.languages || []).map(lg => {
                    const audTxt = lg.audio ? `🎙️ ${_studioEsc(lg.audio.name)}` : '🚨 Áudio faltando';
                    const zeroTxt = (lg.zero_byte_imgs && lg.zero_byte_imgs.length) ? ` • 🚨 ${lg.zero_byte_imgs.length} img 0B` : '';
                    return `
                        <div class="studio-audit-lang">
                            <strong>${_studioEsc(lg.lang_name)}</strong> (${_studioEsc(lg.src_folder_name)}):
                            <span>${lg.imgs_count} img</span> •
                            <span>${lg.videos_count} .mp4</span> •
                            <span class="${lg.audio ? 'ok-txt' : 'err-txt'}">${audTxt}${zeroTxt}</span>
                        </div>
                    `;
                }).join('');
                return `<div class="studio-audit-block"><div class="studio-audit-block-title">📦 ${_studioEsc(blk.block)}</div>${langsHtml || '<span class="text-muted" style="font-size:12px;">Sem subpastas de idioma ainda.</span>'}</div>`;
            }).join('');

            return `
                <div class="studio-audit-card lvl-${_studioEsc(rep.status)}">
                    <div class="studio-audit-head">
                        <strong>${_studioEsc(rep.name)}</strong>
                        <span>${_studioEsc(rep.status_desc)}</span>
                    </div>
                    ${blocksHtml}
                </div>
            `;
        }).join('');
    } catch (e) {
        body.innerHTML = `<div class="studio-audit-card lvl-error">❌ Erro na auditoria: ${_studioEsc(e.message)}</div>`;
    }
}

async function startStudioBatchRender() {
    const selected = Array.from(studioState.selectedSet);
    if (selected.length === 0) {
        alert('Marque ao menos 1 nicho na lista para renderizar os vídeos MP4.');
        return;
    }

    const roundDur = document.getElementById('studio-opt-round')?.checked !== false;
    const cleanupTranslated = document.getElementById('studio-opt-cleanup')?.checked !== false;
    const forceOverwrite = Boolean(document.getElementById('studio-opt-overwrite')?.checked);

    const msg = `Iniciar renderização FFmpeg no OneDrive para ${selected.length} nicho(s)?\n\n` +
        `• Nichos: ${selected.join(', ')}\n` +
        `• Saída: 1.mp4 a 6.mp4 direto na pasta do idioma (Português, Espanhol, Inglês...)\n` +
        `• Duração: ${roundDur ? 'Arredondar para cima (math.ceil + apad)' : 'Duração exata do áudio'}\n` +
        `• Limpeza pós-sucesso: ${cleanupTranslated ? 'Apaga imagens de Espanhol/Inglês se 100% OK (1. Imagens NUNCA é apagada)' : 'Preservar todas as imagens'}`;
    if (!confirm(msg)) return;

    try {
        const resp = await window.apiFetch('/api/studio/render/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campaigns: selected,
                round_duration: roundDur,
                cleanup_translated: cleanupTranslated,
                force_overwrite: forceOverwrite
            })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Falha ao iniciar renderização');
        renderStudioStatusUI(data);
        startStudioStatusPolling();
    } catch (e) {
        alert(`Erro ao iniciar renderização: ${e.message}`);
    }
}

async function pauseStudioRender() {
    try {
        const resp = await window.apiFetch('/api/studio/render/pause', { method: 'POST', body: '{}' });
        const data = await resp.json();
        if (data.status) renderStudioStatusUI(data);
    } catch (e) { }
}

async function cancelStudioRender() {
    if (!confirm('Cancelar a renderização atual? Vídeos já prontos e todas as imagens originais serão preservados.')) return;
    try {
        const resp = await window.apiFetch('/api/studio/render/cancel', { method: 'POST', body: '{}' });
        const data = await resp.json();
        if (data.status) renderStudioStatusUI(data);
    } catch (e) { }
}

function startStudioStatusPolling() {
    if (studioState.pollTimer) return;
    studioState.pollTimer = setInterval(async () => {
        try {
            const resp = await window.apiFetch('/api/studio/render/status');
            const data = await resp.json();
            if (data.success) {
                renderStudioStatusUI(data);
                if (!data.running) {
                    clearInterval(studioState.pollTimer);
                    studioState.pollTimer = null;
                    await loadStudioCampaigns();
                    if (typeof window.loadNichesFromAPI === 'function') {
                        window.loadNichesFromAPI(true);
                    }
                }
            }
        } catch (e) { }
    }, 1500);
}

function renderStudioStatusUI(st) {
    const wrap = document.getElementById('studio-render-progress-wrap');
    const fill = document.getElementById('studio-render-progress-fill');
    const pct = document.getElementById('studio-render-pct');
    const lbl = document.getElementById('studio-render-label');
    const logsEl = document.getElementById('studio-render-logs');
    const errBox = document.getElementById('studio-render-errors');

    const btnRun = document.getElementById('btn-studio-render-start');
    const btnPause = document.getElementById('btn-studio-render-pause');
    const btnCancel = document.getElementById('btn-studio-render-cancel');

    if (btnRun) btnRun.disabled = Boolean(st.running);
    if (btnPause) {
        btnPause.disabled = !st.running;
        btnPause.innerText = st.paused ? '▶️ Retomar' : '⏸️ Pausar';
    }
    if (btnCancel) btnCancel.disabled = !st.running;

    if (wrap && (st.running || (st.logs && st.logs.length > 0))) {
        wrap.classList.remove('twod-hidden');
    }
    const pctVal = Math.round((Number(st.progress || 0)) * 100);
    if (fill) fill.style.width = `${pctVal}%`;
    if (pct) pct.innerText = `${pctVal}% (${st.completed_videos || 0}/${st.total_videos || 0})`;
    if (lbl) lbl.innerText = st.current_label || (st.running ? 'Processando...' : `Status: ${st.status}`);

    if (logsEl && Array.isArray(st.logs)) {
        logsEl.innerText = st.logs.join('\n');
        logsEl.scrollTop = logsEl.scrollHeight;
    }

    if (errBox) {
        const failed = Array.isArray(st.failed_items) ? st.failed_items : [];
        if (failed.length > 0) {
            errBox.classList.remove('twod-hidden');
            errBox.innerHTML = `
                <strong>🚨 ${failed.length} erro(s) durante a renderização (imagens preservadas):</strong>
                <ul style="margin:6px 0 0 18px; font-size:12px;">
                    ${failed.map(it => `<li><strong>${_studioEsc(it.campaign)} &gt; ${_studioEsc(it.block)} &gt; ${_studioEsc(it.lang_name)} (${_studioEsc(it.out_name)}):</strong> ${_studioEsc(it.reason)}</li>`).join('')}
                </ul>
            `;
        } else {
            errBox.classList.add('twod-hidden');
            errBox.innerHTML = '';
        }
    }
}

function bindStudioDropZones() {
    const map = [
        { boxIdx: 0, handler: handleStudioAudioUpload },
        { boxIdx: 1, handler: handleStudioImagesUpload },
        { boxIdx: 2, handler: handleStudioZipUpload }
    ];
    const boxes = document.querySelectorAll('#studio-v2-workspace .studio-drop-box');
    map.forEach(({ boxIdx, handler }) => {
        const box = boxes[boxIdx];
        if (!box || box.dataset.dropBound) return;
        box.dataset.dropBound = '1';
        box.addEventListener('dragover', (e) => {
            e.preventDefault();
            box.style.borderColor = '#8b3dff';
        });
        box.addEventListener('dragleave', () => {
            box.style.borderColor = '';
        });
        box.addEventListener('drop', (e) => {
            e.preventDefault();
            box.style.borderColor = '';
            if (e.dataTransfer?.files?.length) handler(e.dataTransfer.files);
        });
    });
}

async function onStudioTabOpened() {
    const dateEl = document.getElementById('studio-date-input');
    if (dateEl && !dateEl.value) dateEl.value = getTodayIsoDate();
    initWeeklyPdfImporter();
    if (typeof window.initCreativeFactoryUI === 'function') {
        window.initCreativeFactoryUI();
    }
    bindStudioDropZones();
    updateStudioNamingPreview();
    syncStudioGeminiBanner();
    syncWeeklyTtsMirrorBadge();
    if (studioState.campaigns.length === 0) {
        await loadStudioCampaigns();
    }
    try {
        const resp = await window.apiFetch('/api/studio/render/status');
        const st = await resp.json();
        if (st.success && (st.running || (st.logs && st.logs.length > 0))) {
            renderStudioStatusUI(st);
            if (st.running) startStudioStatusPolling();
        }
    } catch (e) { }
}

function syncStudioGeminiBanner() {
    const pill = document.getElementById('studio-gemini-status-pill');
    const inlineWrap = document.getElementById('studio-gemini-key-inline-wrap');
    const hasKey = Boolean(window.metaState && window.metaState.hasGeminiKey);

    if (pill) {
        if (hasKey) {
            pill.textContent = '🟢 Gemini API no Servidor';
            pill.classList.remove('status-off');
            pill.classList.add('status-ok');
        } else {
            pill.textContent = '⚪ Informar Chave Grátis';
            pill.classList.remove('status-ok');
            pill.classList.add('status-off');
        }
    }
    if (inlineWrap) {
        if (hasKey) {
            inlineWrap.classList.add('twod-hidden');
        } else {
            inlineWrap.classList.remove('twod-hidden');
        }
    }
}

async function buildBrowserPretranslations(scriptPt, langs) {
    const out = {};
    if (typeof translateSingleBrowserFallback !== 'function' || !scriptPt) return out;
    const foreign = (langs || []).map(l => String(l || '').trim().toLowerCase()).filter(l => l && l !== 'pt');
    await Promise.all(foreign.map(async (code) => {
        try {
            const tr = await translateSingleBrowserFallback(scriptPt, code, 'pt');
            if (tr && tr.trim() && tr.trim().toLowerCase() !== scriptPt.trim().toLowerCase()) {
                out[code] = tr.trim();
            }
        } catch (e) { }
    }));
    return out;
}

const STUDIO_LANG_LABELS = {
    pt: 'Português',
    es: 'Espanhol',
    en: 'Inglês',
    fr: 'Francês',
    it: 'Italiano',
    de: 'Alemão'
};

function buildAudioSlotFilename(campaign, code) {
    const clean = String(campaign || '')
        .replace(/\s+\d{1,2}[.\-_]\d{1,2}(?:[.\-_]\d{2,4})?$/, '')
        .replace(/[\\/:*?"<>|\s]+/g, '')
        .trim() || 'Nicho';
    return `${clean}_${String(code || '').toLowerCase()}.mp3`;
}

async function requestGenerateAudios({
    campaign,
    date,
    scriptPt,
    languages,
    voice,
    style,
    geminiApiKey,
    preTranslations = null,
    audioFolderId = ''
}) {
    const translations = preTranslations !== null
        ? preTranslations
        : await buildBrowserPretranslations(scriptPt, languages);
    const resp = await window.apiFetch('/api/studio/generate-audios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            campaign,
            date,
            script_pt: scriptPt,
            languages,
            voice,
            style,
            translations,
            audio_folder_id: audioFolderId || undefined,
            gemini_api_key: geminiApiKey
        })
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
        throw new Error(data.error || `Erro HTTP ${resp.status}`);
    }
    return data;
}

async function generateAudiosSequentiallyWithProgress({
    campaign,
    date,
    scriptPt,
    languages,
    voice,
    style,
    geminiApiKey,
    initialAudioFolderId = '',
    shouldStop = null,
    onStep = null
}) {
    const langs = (Array.isArray(languages) && languages.length ? languages : ['pt', 'es', 'en'])
        .map(l => String(l || '').trim().toLowerCase())
        .filter(Boolean);

    const slots = langs.map(code => ({
        lang_code: code,
        lang_name: STUDIO_LANG_LABELS[code] || code.toUpperCase(),
        filename: buildAudioSlotFilename(campaign, code),
        status: 'pending',
        error: ''
    }));
    const generated = [];
    const errors = [];
    let audioFolderId = initialAudioFolderId || '';
    let campaignName = '';

    if (typeof onStep === 'function') {
        onStep({
            index: 0,
            total: langs.length,
            completed: 0,
            langCode: langs[0] || '',
            phase: 'init',
            slots,
            generated,
            errors
        });
    }

    const preTranslations = await buildBrowserPretranslations(scriptPt, langs);

    for (let i = 0; i < langs.length; i++) {
        if (typeof shouldStop === 'function' && shouldStop()) break;
        const code = langs[i];
        const slot = slots[i];
        slot.status = 'running';

        if (typeof onStep === 'function') {
            onStep({
                index: i,
                total: langs.length,
                completed: generated.length + errors.length,
                langCode: code,
                phase: 'running',
                slot,
                slots,
                generated,
                errors
            });
        }

        try {
            const perLangPre = (code !== 'pt' && preTranslations[code]) ? { [code]: preTranslations[code] } : {};
            const data = await requestGenerateAudios({
                campaign,
                date,
                scriptPt,
                languages: [code],
                voice,
                style,
                geminiApiKey,
                preTranslations: perLangPre,
                audioFolderId
            });

            if (data.audio_folder_id) audioFolderId = data.audio_folder_id;
            if (data.campaign_name) campaignName = data.campaign_name;

            const genOne = Array.isArray(data.generated) && data.generated[0];
            const errOne = Array.isArray(data.errors) && data.errors[0];
            if (genOne) {
                Object.assign(slot, genOne, { status: 'done', error: '' });
                generated.push(genOne);
            } else {
                const msg = (errOne && errOne.error) || 'Falha ao gerar áudio.';
                slot.status = 'error';
                slot.error = msg;
                errors.push({ lang_code: code, lang_name: slot.lang_name, error: msg });
            }
        } catch (err) {
            const msg = String(err.message || err);
            slot.status = 'error';
            slot.error = msg;
            errors.push({ lang_code: code, lang_name: slot.lang_name, error: msg });
        }

        if (typeof onStep === 'function') {
            onStep({
                index: i,
                total: langs.length,
                completed: generated.length + errors.length,
                langCode: code,
                phase: slot.status,
                slot,
                slots,
                generated,
                errors
            });
        }

        if (i < langs.length - 1 && !(typeof shouldStop === 'function' && shouldStop())) {
            await new Promise(r => setTimeout(r, 650));
        }
    }

    return { generated, errors, audioFolderId, campaignName, slots };
}

function renderStudioTtsResultSlots(resEl, slots) {
    if (!resEl) return;
    if (!Array.isArray(slots) || slots.length === 0) {
        resEl.innerHTML = '';
        resEl.classList.add('twod-hidden');
        return;
    }

    const baseUrl = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : (window.API_BASE_URL || ''));
    resEl.innerHTML = slots.map(slot => {
        if (slot.status === 'done') {
            const rawUrl = slot.url ? (slot.url.startsWith('http') ? slot.url : `${baseUrl}${slot.url}`) : '';
            const mediaUrl = (rawUrl && typeof window.withMediaAuth === 'function')
                ? window.withMediaAuth(rawUrl)
                : rawUrl;
            const audioTag = mediaUrl
                ? `<audio controls preload="none" src="${_studioEsc(mediaUrl)}"></audio>`
                : '';
            const trPreview = slot.translated_text
                ? `<div class="text-muted" style="font-size:11px; margin-top:2px;">“${_studioEsc(slot.translated_text)}”</div>`
                : '';
            return `
                <div class="studio-tts-item">
                    <div style="flex:1; min-width:220px;">
                        <strong>✅ ${_studioEsc(slot.filename)}</strong>
                        <span class="text-muted"> (${_studioEsc(slot.lang_name)} • ${slot.duration}s ➔ vídeo ${slot.duration_ceil}s)</span>
                        ${trPreview}
                    </div>
                    ${audioTag}
                </div>
            `;
        }
        if (slot.status === 'error') {
            return `
                <div class="studio-tts-item is-error">
                    <div style="flex:1; min-width:220px;">
                        <strong>❌ ${_studioEsc(slot.filename)} (${_studioEsc(slot.lang_name)})</strong>
                        <div style="font-size:11.5px; color:#fca5a5; margin-top:2px;">${_studioEsc(slot.error || 'Erro ao gerar')}</div>
                    </div>
                </div>
            `;
        }
        if (slot.status === 'running') {
            return `
                <div class="studio-tts-item is-running">
                    <div>
                        <strong>⏳ ${_studioEsc(slot.filename)}</strong>
                        <span class="text-muted"> (${_studioEsc(slot.lang_name)}) — Traduzindo e gerando voz no OneDrive...</span>
                    </div>
                </div>
            `;
        }
        return `
            <div class="studio-tts-item is-pending">
                <div>
                    <strong>🕒 ${_studioEsc(slot.filename)}</strong>
                    <span class="text-muted"> (${_studioEsc(slot.lang_name)}) — Na fila...</span>
                </div>
            </div>
        `;
    }).join('');
    resEl.classList.remove('twod-hidden');
}

async function generateStudioAudiosWithAI() {
    const { niche, dateIso, fullName } = getStudioTargetCampaignAndDate();
    const scriptEl = document.getElementById('studio-tts-script');
    const voiceEl = document.getElementById('studio-tts-voice');
    const styleEl = document.getElementById('studio-tts-style');
    const keyInlineEl = document.getElementById('studio-gemini-key-inline');
    const msgEl = document.getElementById('studio-tts-msg');
    const resEl = document.getElementById('studio-tts-results');
    const btnEl = document.getElementById('btn-studio-tts-generate');
    const progWrap = document.getElementById('studio-tts-progress-wrap');
    const progLabel = document.getElementById('studio-tts-progress-label');
    const progPct = document.getElementById('studio-tts-progress-pct');
    const progFill = document.getElementById('studio-tts-progress-fill');

    const scriptPt = (scriptEl?.value || '').trim();
    const voice = (voiceEl?.value || 'Kore').trim();
    const style = (styleEl?.value || '').trim();
    const inlineKey = (keyInlineEl?.value || '').trim();
    const langs = Array.from(document.querySelectorAll('input[name="studio-tts-lang"]:checked'))
        .map(cb => cb.value)
        .filter(Boolean);

    if (!niche) {
        alert('Informe o Nicho/Campanha no topo do Studio antes de gerar os áudios.');
        return;
    }
    if (!scriptPt) {
        alert('Cole ou digite o roteiro em Português no campo de locução.');
        return;
    }
    if (langs.length === 0) {
        alert('Selecione pelo menos 1 idioma para gerar áudio.');
        return;
    }
    const hasServerKey = Boolean(window.metaState && window.metaState.hasGeminiKey);
    if (!hasServerKey && !inlineKey) {
        syncStudioGeminiBanner();
        alert('Informe sua Gemini API Key gratuita (ou peça para o Admin salvar nas Configurações do servidor).');
        if (keyInlineEl) keyInlineEl.focus();
        return;
    }

    if (btnEl) {
        btnEl.disabled = true;
        btnEl.textContent = `⏳ Gerando ${langs.length} áudio(s)...`;
    }
    if (msgEl) {
        msgEl.classList.remove('twod-hidden');
        msgEl.style.color = '#93c5fd';
        msgEl.textContent = `⏳ Gerando áudios direto em Arquivos de Áudio/${fullName || niche}...`;
    }
    if (progWrap) progWrap.classList.remove('twod-hidden');

    try {
        const result = await generateAudiosSequentiallyWithProgress({
            campaign: niche,
            date: dateIso,
            scriptPt,
            languages: langs,
            voice,
            style,
            geminiApiKey: inlineKey,
            onStep: ({ index, total, completed, phase, slot, slots }) => {
                renderStudioTtsResultSlots(resEl, slots);
                const pct = Math.round((completed / Math.max(1, total)) * 100);
                if (progPct) progPct.textContent = `${pct}%`;
                if (progFill) progFill.style.width = `${pct}%`;
                if (progLabel) {
                    if (phase === 'init') {
                        progLabel.textContent = `⏳ Preparando ${total} áudio(s)...`;
                    } else if (phase === 'running' && slot) {
                        progLabel.textContent = `⏳ [${index + 1}/${total}] Gerando ${slot.filename} (${slot.lang_name})...`;
                    } else if (slot) {
                        const icon = phase === 'done' ? '✅' : '⚠️';
                        progLabel.textContent = `${icon} [${completed}/${total}] ${slot.filename} concluído`;
                    }
                }
            }
        });

        if (inlineKey && keyInlineEl) {
            keyInlineEl.value = '';
        }

        const { generated, errors, campaignName } = result;
        const targetCamp = campaignName || fullName || niche;

        if (progPct) progPct.textContent = '100%';
        if (progFill) progFill.style.width = '100%';
        if (progLabel) {
            progLabel.textContent = errors.length > 0
                ? `⚠️ ${generated.length}/${langs.length} salvos, ${errors.length} erro(s)`
                : `✅ ${generated.length}/${langs.length} áudios salvos no OneDrive`;
        }

        if (msgEl) {
            msgEl.style.color = errors.length > 0 ? '#fbbf24' : '#34d399';
            msgEl.textContent = errors.length > 0
                ? `⚠️ ${generated.length} áudio(s) salvos no OneDrive (${targetCamp}), ${errors.length} idioma(s) falharam.`
                : `✅ ${generated.length} áudio(s) MP3 gerados e salvos direto no OneDrive em Arquivos de Áudio/${targetCamp}!`;
        }

        if (targetCamp && generated.length > 0) {
            studioState.selectedSet.add(targetCamp);
            await loadStudioCampaigns();
            await auditStudioCampaigns([targetCamp]);
        }
        if (typeof window.loadNichesFromAPI === 'function') {
            window.loadNichesFromAPI(true);
        }
    } catch (e) {
        if (msgEl) {
            msgEl.classList.remove('twod-hidden');
            msgEl.style.color = '#f87171';
            msgEl.textContent = `❌ Erro ao gerar áudios com IA: ${e.message}`;
        }
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = '🎙️ Gerar Áudios (.mp3) Direto no OneDrive';
        }
    }
}

window.onStudioTabOpened = onStudioTabOpened;
window.updateStudioNamingPreview = updateStudioNamingPreview;
window.createStudioCampaignStructure = createStudioCampaignStructure;
window.handleStudioAudioUpload = handleStudioAudioUpload;
window.handleStudioImagesUpload = handleStudioImagesUpload;
window.handleStudioZipUpload = handleStudioZipUpload;
window.loadStudioCampaigns = loadStudioCampaigns;
window.toggleStudioCampaignCheck = toggleStudioCampaignCheck;
window.selectStudioCampaignsPreset = selectStudioCampaignsPreset;
window.setStudioTargetCampaign = setStudioTargetCampaign;
window.auditStudioCampaigns = auditStudioCampaigns;
window.startStudioBatchRender = startStudioBatchRender;
window.pauseStudioRender = pauseStudioRender;
window.cancelStudioRender = cancelStudioRender;
window.generateStudioAudiosWithAI = generateStudioAudiosWithAI;
window.syncStudioGeminiBanner = syncStudioGeminiBanner;

// ========================================================
// IMPORTADOR TEMPORÁRIO — PACOTE DA SEMANA (.PDF)
// (Extraí os 10 nichos + cria pastas + gera todos os áudios no OneDrive)
// ========================================================

const WEEKLY_PACK_STORAGE_KEY = 'twod_weekly_pdf_pack_v1';
const PDFJS_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const weeklyPackState = {
    weekTitle: '',
    fileName: '',
    mondayIso: '',
    items: [],
    running: false,
    stopRequested: false,
    collapsed: false,
    pdfJsPromise: null,
    controlsBound: false,
};

function getDefaultWeekMondayIso() {
    const now = new Date();
    const dow = now.getDay(); // 0=Dom, 1=Seg ... 6=Sáb
    let diff = 1 - dow;
    if (dow === 0) diff = 1;       // Domingo -> próxima segunda
    else if (dow === 6) diff = 2;  // Sábado -> próxima segunda
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysToIsoDate(isoStr, days) {
    const m = String(isoStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return getTodayIsoDate();
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(days || 0));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSelectedStudioTtsOptions() {
    const languages = Array.from(document.querySelectorAll('input[name="studio-tts-lang"]:checked'))
        .map(cb => cb.value)
        .filter(Boolean);
    const voice = (document.getElementById('studio-tts-voice')?.value || 'Kore').trim();
    const style = (document.getElementById('studio-tts-style')?.value || '').trim();
    const inlineKey = (document.getElementById('studio-gemini-key-inline')?.value || '').trim();
    return { languages, voice, style, inlineKey };
}

function syncWeeklyTtsMirrorBadge() {
    const el = document.getElementById('weekly-pdf-tts-mirror');
    if (!el) return;
    const { languages, voice } = getSelectedStudioTtsOptions();
    const langsTxt = languages.length ? languages.map(l => l.toUpperCase()).join(', ') : 'Nenhum idioma';
    el.textContent = `🎙️ ${langsTxt} • Voz: ${voice}`;
}

function saveWeeklyPackToStorage() {
    try {
        localStorage.setItem(WEEKLY_PACK_STORAGE_KEY, JSON.stringify({
            weekTitle: weeklyPackState.weekTitle,
            fileName: weeklyPackState.fileName,
            mondayIso: weeklyPackState.mondayIso,
            items: weeklyPackState.items,
        }));
    } catch (e) { }
}

function loadWeeklyPackFromStorage() {
    try {
        const raw = localStorage.getItem(WEEKLY_PACK_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
            weeklyPackState.weekTitle = parsed.weekTitle || '';
            weeklyPackState.fileName = parsed.fileName || '';
            weeklyPackState.mondayIso = parsed.mondayIso || getDefaultWeekMondayIso();
            weeklyPackState.items = parsed.items.map(it => ({
                ...it,
                status: it.status === 'running' ? 'idle' : (it.status || 'idle')
            }));
        }
    } catch (e) { }
}

function initWeeklyPdfImporter() {
    const monEl = document.getElementById('weekly-pdf-monday');
    if (monEl && !monEl.value) {
        monEl.value = weeklyPackState.mondayIso || getDefaultWeekMondayIso();
    }
    if (!weeklyPackState.mondayIso) {
        weeklyPackState.mondayIso = monEl?.value || getDefaultWeekMondayIso();
    }

    if (weeklyPackState.items.length === 0) {
        loadWeeklyPackFromStorage();
        if (monEl && weeklyPackState.mondayIso) {
            monEl.value = weeklyPackState.mondayIso;
        }
    }

    const dropEl = document.getElementById('weekly-pdf-dropzone');
    if (dropEl && !dropEl.dataset.pdfDropBound) {
        dropEl.dataset.pdfDropBound = '1';
        dropEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropEl.style.borderColor = '#f59e0b';
        });
        dropEl.addEventListener('dragleave', () => {
            dropEl.style.borderColor = '';
        });
        dropEl.addEventListener('drop', (e) => {
            e.preventDefault();
            dropEl.style.borderColor = '';
            const f = e.dataTransfer?.files?.[0];
            if (f) handleWeeklyPdfSelected([f]);
        });
    }

    if (!weeklyPackState.controlsBound) {
        weeklyPackState.controlsBound = true;
        document.querySelectorAll('input[name="studio-tts-lang"]').forEach(cb => {
            cb.addEventListener('change', syncWeeklyTtsMirrorBadge);
        });
        const vSel = document.getElementById('studio-tts-voice');
        if (vSel) vSel.addEventListener('change', syncWeeklyTtsMirrorBadge);
    }

    renderWeeklyPdfPreview();
}

function toggleWeeklyPdfCard() {
    const body = document.getElementById('weekly-pdf-body');
    const btn = document.getElementById('btn-weekly-pdf-toggle');
    weeklyPackState.collapsed = !weeklyPackState.collapsed;
    if (body) body.classList.toggle('twod-hidden', weeklyPackState.collapsed);
    if (btn) btn.textContent = weeklyPackState.collapsed ? 'Expandir' : 'Recolher';
}

function ensurePdfJsLoaded() {
    if (window.pdfjsLib && typeof window.pdfjsLib.getDocument === 'function') {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
        return Promise.resolve(window.pdfjsLib);
    }
    if (weeklyPackState.pdfJsPromise) return weeklyPackState.pdfJsPromise;

    weeklyPackState.pdfJsPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PDFJS_CDN_URL;
        script.async = true;
        script.onload = () => {
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
                resolve(window.pdfjsLib);
            } else {
                weeklyPackState.pdfJsPromise = null;
                reject(new Error('Falha ao inicializar biblioteca PDF.js.'));
            }
        };
        script.onerror = () => {
            weeklyPackState.pdfJsPromise = null;
            reject(new Error('Não foi possível baixar o leitor de PDF (verifique sua conexão).'));
        };
        document.head.appendChild(script);
    });
    return weeklyPackState.pdfJsPromise;
}

function clusterPdfItemsToLines(items) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const sorted = items
        .filter(it => it && typeof it.str === 'string' && it.str.trim() !== '')
        .slice()
        .sort((a, b) => (b.y - a.y) || (a.x - b.x));

    const lines = [];
    for (const it of sorted) {
        let group = lines.find(l => Math.abs(l.y - it.y) <= 4.0);
        if (!group) {
            group = { y: it.y, tokens: [] };
            lines.push(group);
        }
        group.tokens.push(it);
    }

    lines.sort((a, b) => b.y - a.y);
    return lines.map(line => {
        line.tokens.sort((a, b) => a.x - b.x);
        let text = '';
        let prevEndX = null;
        for (const t of line.tokens) {
            const chunk = t.str;
            if (prevEndX !== null) {
                const gap = t.x - prevEndX;
                if (gap > 2.0 && !text.endsWith(' ') && !chunk.startsWith(' ')) {
                    text += ' ';
                }
            }
            text += chunk;
            prevEndX = t.x + (Number(t.width) || 0);
        }
        return text.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
}

const WEEKLY_DAY_PATTERNS = [
    { index: 0, name: 'Segunda', regex: /\bsegunda\b/i },
    { index: 1, name: 'Terça', regex: /\bter[çc]a\b/i },
    { index: 2, name: 'Quarta', regex: /\bquarta\b/i },
    { index: 3, name: 'Quinta', regex: /\bquinta\b/i },
    { index: 4, name: 'Sexta', regex: /\bsexta\b/i },
];

function detectDayFromLines(lines) {
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
        const line = lines[i];
        if (!/(?:·|\bnicho|\b2\/dia|\bsegunda|\bter[çc]a|\bquarta|\bquinta|\bsexta)/i.test(line)) continue;
        for (const d of WEEKLY_DAY_PATTERNS) {
            if (d.regex.test(line)) {
                return { dayIndex: d.index, dayName: d.name, headerLine: line };
            }
        }
    }
    return null;
}

function buildFallbackSlug(title) {
    const clean = String(title || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s]+/g, ' ')
        .trim();
    const pascal = clean
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
    return pascal || 'Nicho';
}

function parseWeeklyNicheColumn(rawLines, dayInfo, mondayIso, seqIdx) {
    const lines = rawLines
        .filter(l => !/^(?:Segunda|Ter[çc]a|Quarta|Quinta|Sexta)\s*·\s*\d+\s*nichos?/i.test(l))
        .filter(Boolean);

    if (lines.length < 3) return null;
    const joinedCheck = lines.join('\n');
    if (!/(?:Android:|iOS:|[ÁA]UDIO\s*\()/i.test(joinedCheck)) return null;

    const androidIdx = lines.findIndex(l => /^Android\s*:/i.test(l));
    const iosIdx = lines.findIndex(l => /^iOS\s*:/i.test(l));
    const tagsIdx = lines.findIndex(l => /^TAGS\s*:/i.test(l));
    const seoIdx = lines.findIndex(l => /^(?:\d+\s+)?T[ÍI]TULOS\b/i.test(l));
    const creativeIdx = lines.findIndex(l => /^CRIATIVO\s*[—\-]/i.test(l));
    const audioIdx = lines.findIndex(l => /^[ÁA]UDIO\b/i.test(l));
    const policyIdx = lines.findIndex(l => /^Pol[íi]tica\s*:/i.test(l));

    if (audioIdx === -1 && androidIdx === -1) return null;

    // Identifica Título, Categoria e Slug (ex: "UTILIDADE RastrearAviao" ou 2 linhas separadas)
    let catIdx = -1;
    let slugLineAdvance = 1;
    let category = '';
    let slug = '';
    const headerLimit = androidIdx > 0 ? Math.min(androidIdx, 6) : Math.min(lines.length, 6);

    for (let i = 0; i < headerLimit; i++) {
        const sameLine = lines[i].match(/^([A-ZÀ-Ú][A-ZÀ-Ú\s&/]{2,}?)\s+([A-Z][A-Za-z0-9]{3,})$/);
        if (sameLine) {
            catIdx = i;
            category = sameLine[1].trim();
            slug = sameLine[2].trim();
            slugLineAdvance = 1;
            break;
        }
        if (
            i + 1 < headerLimit &&
            /^[A-ZÀ-Ú][A-ZÀ-Ú\s&/]{2,}$/.test(lines[i]) &&
            /^[A-Z][A-Za-z0-9]{3,}$/.test(lines[i + 1])
        ) {
            catIdx = i;
            category = lines[i].trim();
            slug = lines[i + 1].trim();
            slugLineAdvance = 2;
            break;
        }
    }

    const title = catIdx > 0
        ? lines.slice(0, catIdx).join(' ').trim()
        : (lines[0] || `Nicho ${seqIdx + 1}`);
    if (!slug) slug = buildFallbackSlug(title);

    const descStart = catIdx >= 0 ? catIdx + slugLineAdvance : 1;
    const descEnd = androidIdx >= 0 ? androidIdx : (tagsIdx >= 0 ? tagsIdx : descStart);
    const description = descEnd > descStart ? lines.slice(descStart, descEnd).join(' ').trim() : '';

    const androidEnd = iosIdx > androidIdx ? iosIdx : (tagsIdx > androidIdx ? tagsIdx : androidIdx + 1);
    const androidUrl = androidIdx >= 0
        ? lines.slice(androidIdx, androidEnd).join('').replace(/^Android\s*:\s*/i, '').trim()
        : '';

    const iosEnd = tagsIdx > iosIdx ? tagsIdx : (seoIdx > iosIdx ? seoIdx : iosIdx + 1);
    const iosUrl = iosIdx >= 0
        ? lines.slice(iosIdx, iosEnd).join('').replace(/^iOS\s*:\s*/i, '').trim()
        : '';

    const tagsEnd = seoIdx > tagsIdx ? seoIdx : (creativeIdx > tagsIdx ? creativeIdx : tagsIdx + 1);
    const tags = tagsIdx >= 0
        ? lines.slice(tagsIdx, tagsEnd).join(' ').replace(/^TAGS\s*:\s*/i, '').trim()
        : '';

    const seoTitles = [];
    if (seoIdx >= 0) {
        for (let i = seoIdx + 1; i < lines.length; i++) {
            const mSeo = lines[i].match(/^\d+\.\s*(.+)$/);
            if (mSeo) {
                seoTitles.push(mSeo[1].trim());
            } else if (seoTitles.length >= 4 || (creativeIdx >= 0 && i >= creativeIdx)) {
                break;
            }
        }
    }

    const creativeEnd = audioIdx > creativeIdx ? audioIdx : lines.length;
    const creativePhrases = creativeIdx >= 0
        ? lines.slice(creativeIdx + 1, creativeEnd).filter(Boolean)
        : [];

    let audioDurationHint = '~18s';
    let audioScript = '';
    if (audioIdx >= 0) {
        const durM = lines[audioIdx].match(/\(([^)]+)\)/);
        if (durM) audioDurationHint = durM[1].toLowerCase();
        const inlineAudioRemainder = lines[audioIdx].replace(/^[ÁA]UDIO(?:\s*\([^)]*\))?\s*:?\s*/i, '').trim();
        const audioEnd = policyIdx > audioIdx ? policyIdx : lines.length;
        const bodyLines = [];
        if (inlineAudioRemainder) bodyLines.push(inlineAudioRemainder);
        for (let i = audioIdx + 1; i < audioEnd; i++) {
            bodyLines.push(lines[i]);
        }
        audioScript = bodyLines.join(' ').replace(/\s+/g, ' ').trim();
    }

    const policy = policyIdx >= 0
        ? lines.slice(policyIdx).join(' ').replace(/^Pol[íi]tica\s*:\s*/i, '').trim()
        : '';

    const dayIndex = dayInfo ? dayInfo.dayIndex : Math.min(4, Math.floor(seqIdx / 2));
    const dayName = dayInfo ? dayInfo.dayName : (WEEKLY_DAY_PATTERNS[dayIndex]?.name || 'Dia');

    return {
        id: `wk_${Date.now()}_${seqIdx}`,
        selected: true,
        dayIndex,
        dayName,
        dateIso: addDaysToIsoDate(mondayIso, dayIndex),
        title,
        category,
        slug,
        description,
        androidUrl,
        iosUrl,
        tags,
        seoTitles,
        creativePhrases,
        audioDurationHint,
        audioScript,
        policy,
        status: 'idle',
        statusDetail: 'Pronto para gerar',
        generatedAudios: [],
    };
}

function parseWeeklyPdfPagesData(pagesData, fileName, mondayIso) {
    let weekTitle = '';
    const extracted = [];

    for (let pIdx = 0; pIdx < pagesData.length; pIdx++) {
        const page = pagesData[pIdx];
        const allLines = clusterPdfItemsToLines(page.items);
        if (allLines.length === 0) continue;

        if (!weekTitle) {
            const wkLine = allLines.find(l => /Pacote da Semana\s+\d+/i.test(l));
            if (wkLine) weekTitle = wkLine;
        }

        const dayInfo = detectDayFromLines(allLines);
        const midX = (Number(page.width) || 842) * 0.48;
        const leftItems = page.items.filter(it => it.x < midX);
        const rightItems = page.items.filter(it => it.x >= midX);

        const leftLines = clusterPdfItemsToLines(leftItems);
        const rightLines = clusterPdfItemsToLines(rightItems);

        const effectiveDay = dayInfo || (extracted.length > 0 || pIdx > 0
            ? { dayIndex: Math.min(4, Math.max(0, pIdx - 1)), dayName: WEEKLY_DAY_PATTERNS[Math.min(4, Math.max(0, pIdx - 1))].name }
            : null);

        const leftNiche = parseWeeklyNicheColumn(leftLines, effectiveDay, mondayIso, extracted.length);
        if (leftNiche) extracted.push(leftNiche);

        const rightNiche = parseWeeklyNicheColumn(rightLines, effectiveDay, mondayIso, extracted.length);
        if (rightNiche) extracted.push(rightNiche);
    }

    return {
        weekTitle: weekTitle || fileName.replace(/\.pdf$/i, ''),
        items: extracted,
    };
}

async function handleWeeklyPdfSelected(files) {
    const file = files && files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        alert('Selecione um arquivo .PDF válido do Pacote da Semana.');
        return;
    }

    const infoEl = document.getElementById('weekly-pdf-file-info');
    if (infoEl) infoEl.textContent = `⏳ Lendo "${file.name}"...`;

    try {
        const pdfjs = await ensurePdfJsLoaded();
        const arrayBuf = await file.arrayBuffer();
        const pdfDoc = await pdfjs.getDocument({ data: arrayBuf }).promise;

        const pagesData = [];
        for (let p = 1; p <= pdfDoc.numPages; p++) {
            const page = await pdfDoc.getPage(p);
            const vp = page.getViewport({ scale: 1.0 });
            const tc = await page.getTextContent();
            const items = (tc.items || []).map(it => ({
                str: it.str || '',
                x: Array.isArray(it.transform) ? it.transform[4] : 0,
                y: Array.isArray(it.transform) ? it.transform[5] : 0,
                width: Number(it.width) || 0,
            }));
            pagesData.push({ pageNum: p, width: vp.width, height: vp.height, items });
        }

        const monEl = document.getElementById('weekly-pdf-monday');
        const mondayIso = (monEl?.value || getDefaultWeekMondayIso()).trim();
        weeklyPackState.mondayIso = mondayIso;
        weeklyPackState.fileName = file.name;

        const parsed = parseWeeklyPdfPagesData(pagesData, file.name, mondayIso);
        if (!parsed.items.length) {
            throw new Error('Não encontrei os nichos/roteiros neste PDF. Verifique se ele possui texto selecionável (não apenas imagem).');
        }

        weeklyPackState.weekTitle = parsed.weekTitle;
        weeklyPackState.items = parsed.items;
        saveWeeklyPackToStorage();

        if (infoEl) infoEl.textContent = `✅ ${file.name} (${pdfDoc.numPages} pág. • ${parsed.items.length} nichos extraídos)`;
        renderWeeklyPdfPreview();
    } catch (err) {
        console.error('Erro ao ler PDF semanal:', err);
        if (infoEl) infoEl.textContent = `❌ Erro ao ler PDF: ${err.message}`;
        alert(`Erro ao processar PDF da semana: ${err.message}`);
    }
}

function recalculateWeeklyDatesFromMonday() {
    const monEl = document.getElementById('weekly-pdf-monday');
    const newMon = (monEl?.value || '').trim();
    if (!newMon) return;
    weeklyPackState.mondayIso = newMon;
    weeklyPackState.items.forEach(item => {
        item.dateIso = addDaysToIsoDate(newMon, item.dayIndex || 0);
    });
    saveWeeklyPackToStorage();
    renderWeeklyPdfPreview();
}

function toggleWeeklyItemCheck(idx, checked) {
    if (!weeklyPackState.items[idx]) return;
    weeklyPackState.items[idx].selected = Boolean(checked);
    saveWeeklyPackToStorage();
}

function selectAllWeeklyNiches(selected) {
    weeklyPackState.items.forEach(it => { it.selected = Boolean(selected); });
    saveWeeklyPackToStorage();
    renderWeeklyPdfPreview();
}

function updateWeeklyItemField(idx, field, value) {
    const item = weeklyPackState.items[idx];
    if (!item) return;
    item[field] = value;
    saveWeeklyPackToStorage();
    if (field === 'slug' || field === 'dateIso') {
        const badge = document.getElementById(`weekly-folder-badge-${idx}`);
        if (badge) badge.textContent = `📁 ${item.slug || 'Nicho'} ${formatStudioDateShort(item.dateIso)}`;
    }
}

function clearSavedWeeklyPack() {
    if (weeklyPackState.running) return;
    if (!confirm('Descartar o pacote semanal carregado na tela?')) return;
    weeklyPackState.weekTitle = '';
    weeklyPackState.fileName = '';
    weeklyPackState.items = [];
    try { localStorage.removeItem(WEEKLY_PACK_STORAGE_KEY); } catch (e) { }
    const infoEl = document.getElementById('weekly-pdf-file-info');
    if (infoEl) infoEl.textContent = 'Ex.: Pacote da Semana 23 — 10 Nichos (2/dia)';
    renderWeeklyPdfPreview();
}

function loadWeeklyNicheIntoStudio(idx) {
    const item = weeklyPackState.items[idx];
    if (!item) return;

    const nicheEl = document.getElementById('studio-niche-input');
    const dateEl = document.getElementById('studio-date-input');
    const scriptEl = document.getElementById('studio-tts-script');
    if (nicheEl) nicheEl.value = item.slug || item.title;
    if (dateEl && item.dateIso) dateEl.value = item.dateIso;
    if (scriptEl && item.audioScript) scriptEl.value = item.audioScript;
    updateStudioNamingPreview();

    const targetFolder = `${item.slug} ${formatStudioDateShort(item.dateIso)}`;
    if (typeof setStudioTargetCampaign === 'function') {
        const exists = studioState.campaigns.some(c => c.name === targetFolder);
        if (exists) {
            setStudioTargetCampaign(targetFolder);
        }
    }

    if (nicheEl) {
        nicheEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        nicheEl.focus();
    }
}

function renderWeeklyPdfPreview() {
    const wrap = document.getElementById('weekly-pdf-preview-wrap');
    const listEl = document.getElementById('weekly-pdf-list');
    const titleEl = document.getElementById('weekly-pdf-week-title');
    const countEl = document.getElementById('weekly-pdf-count-badge');
    const infoEl = document.getElementById('weekly-pdf-file-info');
    if (!wrap || !listEl) return;

    syncWeeklyTtsMirrorBadge();

    if (!weeklyPackState.items || weeklyPackState.items.length === 0) {
        wrap.classList.add('twod-hidden');
        listEl.innerHTML = '';
        if (typeof window.refreshCfTargetSummary === 'function') window.refreshCfTargetSummary();
        return;
    }

    wrap.classList.remove('twod-hidden');
    if (titleEl) titleEl.textContent = weeklyPackState.weekTitle || 'Pacote da Semana';
    if (countEl) countEl.textContent = `${weeklyPackState.items.length} nichos`;
    if (infoEl && weeklyPackState.fileName) {
        infoEl.textContent = `✅ ${weeklyPackState.fileName} (${weeklyPackState.items.length} nichos carregados)`;
    }

    const prevScroll = listEl.scrollTop;
    const baseUrl = (typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : (window.API_BASE_URL || ''));

    listEl.innerHTML = weeklyPackState.items.map((item, idx) => {
        const folderPreview = `${item.slug || 'Nicho'} ${formatStudioDateShort(item.dateIso)}`;
        const statusCls = item.status === 'done' ? 'is-done' : (item.status === 'error' ? 'is-error' : '');
        const badgeCls = item.status === 'done' ? 'ok' : (item.status === 'error' ? 'warn' : 'muted');
        const statusIcon = item.status === 'done' ? '✅' : (item.status === 'running' ? '⏳' : (item.status === 'error' ? '⚠️' : '•'));

        const slots = Array.isArray(item.audioSlots) && item.audioSlots.length > 0
            ? item.audioSlots
            : (Array.isArray(item.generatedAudios)
                ? item.generatedAudios.map(g => ({ ...g, status: 'done' }))
                : []);

        const progTotal = Number(item.progressTotal) || (item.status === 'running' ? slots.length : 0);
        const progDone = Number(item.progressDone) || slots.filter(s => s.status === 'done' || s.status === 'error').length;
        const progPct = progTotal > 0 ? Math.min(100, Math.round((progDone / progTotal) * 100)) : 0;
        const cardProgressHtml = (progTotal > 0 && (item.status === 'running' || item.status === 'done' || item.status === 'error'))
            ? `
                <div class="weekly-niche-progress">
                    <div class="weekly-niche-progress-head">
                        <span>${_studioEsc(item.progressLabel || `${progDone}/${progTotal} áudios`)}</span>
                        <strong>${progPct}%</strong>
                    </div>
                    <div class="weekly-niche-progress-track">
                        <div class="weekly-niche-progress-fill" style="width:${progPct}%;"></div>
                    </div>
                </div>
            `
            : '';

        const audiosHtml = slots.length > 0
            ? `<div class="weekly-niche-audios">${slots.map(g => {
                const codeUp = (g.lang_code || '').toUpperCase();
                if (g.status === 'done' || !g.status) {
                    const rawUrl = g.url ? (g.url.startsWith('http') ? g.url : `${baseUrl}${g.url}`) : '';
                    const mediaUrl = (rawUrl && typeof window.withMediaAuth === 'function') ? window.withMediaAuth(rawUrl) : rawUrl;
                    const trShort = g.translated_text
                        ? `<div class="text-muted" style="font-size:10.5px; margin-top:2px;">“${_studioEsc(g.translated_text.slice(0, 120))}${g.translated_text.length > 120 ? '...' : ''}”</div>`
                        : '';
                    return `
                        <div class="weekly-niche-audio-pill">
                            <div style="flex:1; min-width:140px;">
                                <span>✅ <strong>${_studioEsc(codeUp)}</strong> • ${_studioEsc(g.filename || '')} (${g.duration || '?'}s)</span>
                                ${trShort}
                            </div>
                            ${mediaUrl ? `<audio controls preload="none" src="${_studioEsc(mediaUrl)}"></audio>` : ''}
                        </div>
                    `;
                }
                if (g.status === 'running') {
                    return `
                        <div class="weekly-niche-audio-pill is-running">
                            <span>⏳ <strong>${_studioEsc(codeUp)}</strong> • ${_studioEsc(g.filename || '')} — Gerando no OneDrive...</span>
                        </div>
                    `;
                }
                if (g.status === 'error') {
                    return `
                        <div class="weekly-niche-audio-pill is-error">
                            <span>❌ <strong>${_studioEsc(codeUp)}</strong> • ${_studioEsc(g.error || 'Erro ao gerar')}</span>
                        </div>
                    `;
                }
                return `
                    <div class="weekly-niche-audio-pill is-pending">
                        <span>🕒 <strong>${_studioEsc(codeUp)}</strong> • ${_studioEsc(g.filename || '')} — Na fila</span>
                    </div>
                `;
            }).join('')}</div>`
            : '';

        const seoHtml = item.seoTitles && item.seoTitles.length
            ? `<div><strong>Títulos SEO:</strong><ol style="margin:2px 0 0 18px;">${item.seoTitles.map(t => `<li>${_studioEsc(t)}</li>`).join('')}</ol></div>`
            : '';
        const phrasesHtml = item.creativePhrases && item.creativePhrases.length
            ? `<div><strong>Frases criativo:</strong> ${_studioEsc(item.creativePhrases.join(' | '))}</div>`
            : '';

        return `
            <div class="weekly-niche-card ${statusCls}" id="weekly-niche-card-${idx}">
                <div class="weekly-niche-head">
                    <label class="weekly-niche-check">
                        <input type="checkbox" ${item.selected ? 'checked' : ''} ${weeklyPackState.running ? 'disabled' : ''} onchange="toggleWeeklyItemCheck(${idx}, this.checked)">
                        <div>
                            <div>${_studioEsc(item.title)}</div>
                            <div style="font-size:11px; font-weight:600; color:var(--text-muted); margin-top:2px;">
                                ${_studioEsc(item.dayName)} • ${_studioEsc(item.category || 'NICHO')} • <span id="weekly-folder-badge-${idx}">📁 ${_studioEsc(folderPreview)}</span>
                            </div>
                        </div>
                    </label>
                    <span class="studio-mini-badge ${badgeCls}">${statusIcon} ${_studioEsc(item.statusDetail || 'Pronto')}</span>
                </div>

                <div class="weekly-niche-inputs">
                    <input type="text" class="twod-input" value="${_studioEsc(item.slug)}" title="Slug da pasta no OneDrive" placeholder="Slug da pasta" onchange="updateWeeklyItemField(${idx}, 'slug', this.value.trim())">
                    <input type="date" class="twod-input" value="${_studioEsc(item.dateIso)}" title="Data da campanha no OneDrive" onchange="updateWeeklyItemField(${idx}, 'dateIso', this.value)">
                </div>

                <textarea class="weekly-niche-script" rows="3" title="Roteiro extraído do áudio (${_studioEsc(item.audioDurationHint)})" onchange="updateWeeklyItemField(${idx}, 'audioScript', this.value)">${_studioEsc(item.audioScript)}</textarea>

                ${cardProgressHtml}
                ${audiosHtml}

                <div class="weekly-niche-actions">
                    <button type="button" class="btn btn-outline btn-sm" ${weeklyPackState.running ? 'disabled' : ''} onclick="runSingleWeeklyNiche(${idx})">🎙️ Gerar Só Este</button>
                    <button type="button" class="btn btn-outline btn-sm" onclick="runCreativeFactoryForWeeklyIndex(${idx})">🎨 Imagens IA</button>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="loadWeeklyNicheIntoStudio(${idx})">📤 Subir Imagens</button>
                </div>

                <details class="weekly-niche-details">
                    <summary>Ver links, SEO, tags e política</summary>
                    <div class="weekly-niche-details-body">
                        ${item.androidUrl ? `<div><strong>Android:</strong> <a href="${_studioEsc(item.androidUrl)}" target="_blank" rel="noopener">Abrir Play Store ↗</a></div>` : ''}
                        ${item.iosUrl ? `<div><strong>iOS:</strong> <a href="${_studioEsc(item.iosUrl)}" target="_blank" rel="noopener">Abrir App Store ↗</a></div>` : ''}
                        ${item.tags ? `<div><strong>Tags:</strong> ${_studioEsc(item.tags)}</div>` : ''}
                        ${seoHtml}
                        ${phrasesHtml}
                        ${item.policy ? `<div style="color:#fbbf24;"><strong>Política:</strong> ${_studioEsc(item.policy)}</div>` : ''}
                    </div>
                </details>
            </div>
        `;
    }).join('');
    listEl.scrollTop = prevScroll;
    if (typeof window.refreshCfTargetSummary === 'function') window.refreshCfTargetSummary();
}

async function processSingleWeeklyItem(item, options) {
    const { createFolders, languages, voice, style, geminiApiKey, onAudioProgress, shouldStop } = options;

    item.status = 'running';
    item.statusDetail = createFolders ? 'Criando pastas...' : 'Preparando...';
    item.progressTotal = languages.length;
    item.progressDone = 0;
    item.progressLabel = createFolders ? 'Criando pastas no OneDrive...' : 'Iniciando...';
    renderWeeklyPdfPreview();

    try {
        let audioFolderId = '';
        if (createFolders) {
            const folderResp = await window.apiFetch('/api/studio/create-campaign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    niche: item.slug || item.title,
                    date: item.dateIso,
                    use_blocks: true
                })
            });
            const folderData = await folderResp.json();
            if (!folderResp.ok || !folderData.success) {
                throw new Error(folderData.error || 'Erro ao criar pastas no OneDrive');
            }
            if (folderData.audio_folder_id) audioFolderId = folderData.audio_folder_id;
        }

        const seqResult = await generateAudiosSequentiallyWithProgress({
            campaign: item.slug || item.title,
            date: item.dateIso,
            scriptPt: item.audioScript,
            languages,
            voice,
            style,
            geminiApiKey,
            initialAudioFolderId: audioFolderId,
            shouldStop,
            onStep: ({ index, total, completed, phase, slot, slots }) => {
                item.audioSlots = slots.map(s => ({ ...s }));
                item.progressTotal = total;
                item.progressDone = completed;
                if (phase === 'running' && slot) {
                    item.statusDetail = `Áudio ${index + 1}/${total} (${(slot.lang_code || '').toUpperCase()})`;
                    item.progressLabel = `⏳ Gerando ${slot.filename}...`;
                } else if (phase === 'init') {
                    item.statusDetail = `0/${total} áudios`;
                    item.progressLabel = `Preparando ${total} áudio(s)...`;
                } else if (slot) {
                    item.statusDetail = `${completed}/${total} áudios`;
                    item.progressLabel = `${phase === 'done' ? '✅' : '⚠️'} ${completed}/${total} concluídos`;
                }
                if (typeof onAudioProgress === 'function') {
                    onAudioProgress({ item, index, total, completed, phase, slot });
                }
                renderWeeklyPdfPreview();
            }
        });

        const generated = Array.isArray(seqResult.generated) ? seqResult.generated : [];
        const errors = Array.isArray(seqResult.errors) ? seqResult.errors : [];
        item.generatedAudios = generated;
        item.audioSlots = seqResult.slots || [];
        item.progressTotal = languages.length;
        item.progressDone = generated.length + errors.length;
        if (errors.length > 0 && generated.length === 0) {
            throw new Error(errors.map(e => `${e.lang_code}: ${e.error}`).join('; '));
        }
        item.status = errors.length > 0 ? 'error' : 'done';
        item.statusDetail = errors.length > 0
            ? `${generated.length} OK, ${errors.length} erro(s)`
            : `${generated.length} áudio(s) no OneDrive`;
        item.progressLabel = errors.length > 0
            ? `⚠️ ${generated.length}/${languages.length} OK`
            : `✅ ${generated.length}/${languages.length} áudios salvos`;
    } catch (err) {
        item.status = 'error';
        item.statusDetail = String(err.message || err).slice(0, 70);
        item.progressLabel = `❌ ${item.statusDetail}`;
    }

    saveWeeklyPackToStorage();
    renderWeeklyPdfPreview();
}

async function runSingleWeeklyNiche(idx) {
    if (weeklyPackState.running) return;
    const item = weeklyPackState.items[idx];
    if (!item) return;
    if (!String(item.audioScript || '').trim()) {
        alert('O roteiro deste nicho está vazio.');
        return;
    }

    const { languages, voice, style, inlineKey } = getSelectedStudioTtsOptions();
    if (languages.length === 0) {
        alert('Selecione pelo menos 1 idioma na seção de Áudios IA abaixo.');
        return;
    }
    const hasServerKey = Boolean(window.metaState && window.metaState.hasGeminiKey);
    if (!hasServerKey && !inlineKey) {
        syncStudioGeminiBanner();
        alert('Informe sua Gemini API Key gratuita (ou peça para o Admin salvar nas Configurações do servidor).');
        document.getElementById('studio-gemini-key-inline')?.focus();
        return;
    }

    const createFolders = Boolean(document.getElementById('weekly-pdf-create-folders')?.checked);
    weeklyPackState.running = true;
    try {
        await processSingleWeeklyItem(item, {
            createFolders,
            languages,
            voice,
            style,
            geminiApiKey: inlineKey
        });
        await loadStudioCampaigns();
        if (typeof window.loadNichesFromAPI === 'function') window.loadNichesFromAPI(true);
    } finally {
        weeklyPackState.running = false;
        renderWeeklyPdfPreview();
    }
}

async function runWeeklyPdfBatch() {
    if (weeklyPackState.running) return;
    const targets = weeklyPackState.items
        .map((item, idx) => ({ item, idx }))
        .filter(x => x.item.selected && String(x.item.audioScript || '').trim().length > 0);

    if (targets.length === 0) {
        alert('Marque ao menos 1 nicho com roteiro de áudio para processar.');
        return;
    }

    const { languages, voice, style, inlineKey } = getSelectedStudioTtsOptions();
    if (languages.length === 0) {
        alert('Selecione pelo menos 1 idioma na seção de Gerar Áudios (.mp3) por IA abaixo.');
        return;
    }
    const hasServerKey = Boolean(window.metaState && window.metaState.hasGeminiKey);
    if (!hasServerKey && !inlineKey) {
        syncStudioGeminiBanner();
        alert('Informe sua Gemini API Key gratuita (ou salve nas Configurações do servidor).');
        document.getElementById('studio-gemini-key-inline')?.focus();
        return;
    }

    const createFolders = Boolean(document.getElementById('weekly-pdf-create-folders')?.checked);
    const startBtn = document.getElementById('btn-weekly-batch-start');
    const stopBtn = document.getElementById('btn-weekly-batch-stop');
    const statusEl = document.getElementById('weekly-batch-status');
    const progWrap = document.getElementById('weekly-batch-progress-wrap');
    const progLabel = document.getElementById('weekly-batch-progress-label');
    const progPct = document.getElementById('weekly-batch-progress-pct');
    const progFill = document.getElementById('weekly-batch-progress-fill');

    weeklyPackState.running = true;
    weeklyPackState.stopRequested = false;
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.classList.remove('twod-hidden');
    if (progWrap) progWrap.classList.remove('twod-hidden');

    let okCount = 0;
    let errCount = 0;
    const totalWeekAudios = targets.length * languages.length;
    let completedPriorAudios = 0;

    try {
        for (let i = 0; i < targets.length; i++) {
            if (weeklyPackState.stopRequested) break;
            const { item } = targets[i];
            const initPct = Math.round((completedPriorAudios / Math.max(1, totalWeekAudios)) * 100);
            if (progLabel) progLabel.textContent = `⏳ Nicho ${i + 1}/${targets.length}: ${item.slug} (${item.dayName})...`;
            if (progPct) progPct.textContent = `${initPct}%`;
            if (progFill) progFill.style.width = `${initPct}%`;
            if (statusEl) statusEl.textContent = `Áudio ${completedPriorAudios + 1}/${totalWeekAudios} • ${item.slug}...`;

            await processSingleWeeklyItem(item, {
                createFolders,
                languages,
                voice,
                style,
                geminiApiKey: inlineKey,
                shouldStop: () => weeklyPackState.stopRequested,
                onAudioProgress: ({ completed, phase, slot }) => {
                    const globalDone = completedPriorAudios + completed;
                    const gPct = Math.min(100, Math.round((globalDone / Math.max(1, totalWeekAudios)) * 100));
                    if (progPct) progPct.textContent = `${gPct}%`;
                    if (progFill) progFill.style.width = `${gPct}%`;
                    if (phase === 'running' && slot) {
                        const curNum = Math.min(totalWeekAudios, globalDone + 1);
                        if (progLabel) progLabel.textContent = `⏳ Áudio ${curNum}/${totalWeekAudios} • ${item.dayName}: ${slot.filename}...`;
                        if (statusEl) statusEl.textContent = `Áudio ${curNum}/${totalWeekAudios}...`;
                    } else if (slot && (phase === 'done' || phase === 'error')) {
                        const icon = phase === 'done' ? '✅' : '⚠️';
                        if (progLabel) progLabel.textContent = `${icon} Áudio ${globalDone}/${totalWeekAudios} • ${slot.filename}`;
                    }
                }
            });

            completedPriorAudios += Number(item.progressDone || languages.length);
            if (item.status === 'done') okCount++;
            else errCount++;

            if (i < targets.length - 1 && !weeklyPackState.stopRequested) {
                await new Promise(r => setTimeout(r, 900));
            }
        }

        if (progPct) progPct.textContent = '100%';
        if (progFill) progFill.style.width = '100%';
        const stoppedMsg = weeklyPackState.stopRequested ? ' (interrompido)' : '';
        if (progLabel) progLabel.textContent = `Concluído${stoppedMsg}: ${okCount} OK, ${errCount} com alerta.`;
        if (statusEl) statusEl.textContent = `✅ ${okCount} nicho(s) prontos no OneDrive${errCount ? ` • ⚠️ ${errCount} com alerta` : ''}.`;

        if (inlineKey) {
            const keyInlineEl = document.getElementById('studio-gemini-key-inline');
            if (keyInlineEl) keyInlineEl.value = '';
        }

        await loadStudioCampaigns();
        if (typeof window.loadNichesFromAPI === 'function') window.loadNichesFromAPI(true);
    } finally {
        weeklyPackState.running = false;
        weeklyPackState.stopRequested = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.classList.add('twod-hidden');
        renderWeeklyPdfPreview();
    }
}

function stopWeeklyPdfBatch() {
    if (!weeklyPackState.running) return;
    weeklyPackState.stopRequested = true;
    const statusEl = document.getElementById('weekly-batch-status');
    if (statusEl) statusEl.textContent = '⏹️ Parando após terminar o nicho atual...';
}

window.toggleWeeklyPdfCard = toggleWeeklyPdfCard;
window.handleWeeklyPdfSelected = handleWeeklyPdfSelected;
window.recalculateWeeklyDatesFromMonday = recalculateWeeklyDatesFromMonday;
window.toggleWeeklyItemCheck = toggleWeeklyItemCheck;
window.selectAllWeeklyNiches = selectAllWeeklyNiches;
window.updateWeeklyItemField = updateWeeklyItemField;
window.clearSavedWeeklyPack = clearSavedWeeklyPack;
window.loadWeeklyNicheIntoStudio = loadWeeklyNicheIntoStudio;
window.runSingleWeeklyNiche = runSingleWeeklyNiche;
window.runWeeklyPdfBatch = runWeeklyPdfBatch;
window.stopWeeklyPdfBatch = stopWeeklyPdfBatch;
window.syncWeeklyTtsMirrorBadge = syncWeeklyTtsMirrorBadge;
window.twodWeeklyPdfParser = {
    clusterPdfItemsToLines,
    detectDayFromLines,
    parseWeeklyNicheColumn,
    parseWeeklyPdfPagesData,
    addDaysToIsoDate,
};
