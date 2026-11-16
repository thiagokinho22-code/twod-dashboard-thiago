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
        return;
    }
    const blockPart = (useBlocks && blockSel !== 'Único') ? `${blockSel}/` : '';
    prevEl.innerHTML = `
        📁 <strong>Áudios:</strong> <code>Arquivos de Áudio/${_studioEsc(fullName)}/${_studioEsc(slug)}_pt.mp3</code> (<code>_es</code>, <code>_en</code>...) &nbsp;•&nbsp;
        🎬 <strong>Imagens:</strong> <code>Vídeos/${_studioEsc(fullName)}/${_studioEsc(blockPart)}${_studioEsc(imgSub)}/1.png..6.png</code>
    `;
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
    bindStudioDropZones();
    updateStudioNamingPreview();
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
