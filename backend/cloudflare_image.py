import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid

try:
    import studio_engine
except ImportError:
    from backend import studio_engine

CF_IMAGE_MODELS = [
    "@cf/black-forest-labs/flux-1-schnell",
    "@cf/leonardo/phoenix-1.0",
    "@cf/black-forest-labs/flux-2-klein-4b",
]

DEFAULT_CTA_BY_LANG = {
    "pt": "SAIBA MAIS",
    "es": "MÁS INFO",
    "en": "LEARN MORE",
    "fr": "EN SAVOIR PLUS",
    "it": "SCOPRI DI PIÙ",
    "de": "MEHR INFOS",
}

DEFAULT_NEGATIVE_PROMPT = (
    "text, typography, letters, words, numbers, watermark, logo, signature, blurry, ugly, deformed, distorted"
)


def _detect_image_mime(raw_bytes):
    if raw_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw_bytes.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if raw_bytes[:4] == b"RIFF" and b"WEBP" in raw_bytes[:16]:
        return "image/webp"
    return "image/png"


def _encode_multipart_form(fields):
    boundary = "----TwoDCfBoundary" + uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        if v is None:
            continue
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{k}"\r\n\r\n'
            f"{v}\r\n"
        )
    parts.append(f"--{boundary}--\r\n")
    body = "".join(parts).encode("utf-8")
    return body, f"multipart/form-data; boundary={boundary}"


def _run_single_cf_model(model_id, prompt_en, account_id, api_token, negative_prompt="", width=1024, height=1024, seed=None):
    url = f"https://api.cloudflare.com/client/v4/accounts/{urllib.parse.quote(account_id)}/ai/run/{model_id}"
    headers = {"Authorization": f"Bearer {api_token}"}

    if "flux-2" in model_id:
        data, ctype = _encode_multipart_form({
            "prompt": prompt_en[:2000],
            "width": str(int(width)),
            "height": str(int(height)),
        })
        headers["Content-Type"] = ctype
    elif "phoenix" in model_id:
        payload = {
            "prompt": prompt_en[:2000],
            "negative_prompt": negative_prompt or DEFAULT_NEGATIVE_PROMPT,
            "width": int(width),
            "height": int(height),
            "num_steps": 20,
        }
        if seed is not None:
            payload["seed"] = int(seed)
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    else:
        # @cf/black-forest-labs/flux-1-schnell (fast, lowest Neuron usage)
        payload = {
            "prompt": prompt_en[:2000],
            "steps": 6,
        }
        if seed is not None:
            payload["seed"] = int(seed)
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=75) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            raw = resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        if api_token and api_token in err_body:
            err_body = err_body.replace(api_token, "[REDACTED]")
        msg = err_body
        try:
            ej = json.loads(err_body)
            errs = ej.get("errors") or []
            if errs and isinstance(errs, list):
                msg = str(errs[0].get("message") or msg)
        except Exception:
            pass
        if e.code in (401, 403):
            raise PermissionError(f"Credenciais Cloudflare inválidas ou sem permissão Workers AI ({msg[:180]})")
        if e.code == 429:
            raise RuntimeError(f"Limite/cota Cloudflare Workers AI atingido ({msg[:160]})")
        raise RuntimeError(f"Cloudflare HTTP {e.code} ({model_id}): {msg[:200]}")

    if "application/json" in ctype or raw.lstrip().startswith(b"{"):
        res_j = json.loads(raw.decode("utf-8"))
        if res_j.get("success") is False:
            errs = res_j.get("errors") or []
            msg = errs[0].get("message") if errs else "Erro desconhecido Cloudflare"
            raise RuntimeError(f"Cloudflare ({model_id}): {msg}")
        img_b64 = ((res_j.get("result") or {}).get("image") or "").strip()
        if not img_b64:
            raise RuntimeError(f"Modelo Cloudflare {model_id} não retornou campo 'image'.")
        raw_img = base64.b64decode(img_b64)
        mime = _detect_image_mime(raw_img)
        return img_b64, mime

    mime = _detect_image_mime(raw)
    if len(raw) < 512:
        raise RuntimeError(f"Modelo Cloudflare {model_id} retornou imagem vazia ou inválida.")
    return base64.b64encode(raw).decode("ascii"), mime


def generate_clean_image_cf(prompt_en, account_id, api_token, preferred_model="", negative_prompt="", width=1024, height=1024, seed=None):
    """Gera imagem base limpa na Cloudflare Workers AI com fallback automático entre modelos."""
    acc = str(account_id or "").strip()
    tok = str(api_token or "").strip()
    if not acc or not tok:
        raise ValueError("Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN em Configurações ou no painel.")

    clean_prompt = str(prompt_en or "").strip()
    if not clean_prompt:
        raise ValueError("Prompt visual vazio.")

    if "no text" not in clean_prompt.lower():
        clean_prompt = f"{clean_prompt}, clean visual scene, strictly no text, no words, no letters, no watermark"

    models_order = []
    if preferred_model and preferred_model in CF_IMAGE_MODELS:
        models_order.append(preferred_model)
    for m in CF_IMAGE_MODELS:
        if m not in models_order:
            models_order.append(m)

    last_err = "Falha ao gerar imagem na Cloudflare."
    for model_id in models_order:
        try:
            img_b64, mime = _run_single_cf_model(
                model_id,
                clean_prompt,
                acc,
                tok,
                negative_prompt=negative_prompt,
                width=width,
                height=height,
                seed=seed,
            )
            return {
                "success": True,
                "model": model_id,
                "mime": mime,
                "image_b64": img_b64,
                "data_url": f"data:{mime};base64,{img_b64}",
            }
        except PermissionError as auth_err:
            raise RuntimeError(str(auth_err))
        except Exception as e:
            last_err = str(e)

    raise RuntimeError(last_err)


def _extract_quoted_copy_from_prompt(prompt_txt):
    if not prompt_txt:
        return []
    return [m.strip() for m in re.findall(r"'([^']{3,90})'", str(prompt_txt)) if m.strip()]


def _extract_visual_scene_en(pt_prompt, style_key, subject, translate_fn=None):
    """Extrai somente o objeto/cena visual do prompt em PT para traduzir sem pedir texto ao Flux."""
    if pt_prompt and callable(translate_fn):
        m = re.search(
            r"(?:FOTOGRAFIA\s+REALISTA(?:\s+COM\s+RECORTE\s+SECO)?\s+de|FOTOGRAFIA\s+realista\s+de|foto\s+de|ilustra[çc][ãa]o\s+(?:flat\s+)?de|render\s+3D\s+de)\s+(.+?)(?:[.;]|,\s*(?:bot[ãa]o|na metade|no centro)|$)",
            str(pt_prompt),
            flags=re.IGNORECASE,
        )
        if m:
            scene_pt = m.group(1).strip()
            scene_pt = re.sub(r"'[^']*'", "", scene_pt).strip()
            if len(scene_pt) >= 8:
                scene_en = str(translate_fn(scene_pt, "pt", "en") or scene_pt).strip()
                if style_key == "A3":
                    return (
                        f"Sharp commercial cutout studio photograph of {scene_en}, "
                        "centered cleanly isolated on pure solid white #FFFFFF background, "
                        "high contrast commercial studio lighting, strictly no text, no words, no letters"
                    )
                if style_key == "A1":
                    return (
                        f"Realistic editorial lifestyle photograph of {scene_en}, "
                        "dramatic contrast, vibrant natural daylight, sharp focus, strictly no text, no words, no letters"
                    )
                if style_key == "A2":
                    return (
                        f"Bright clean modern commercial studio photograph of {scene_en}, "
                        "soft airy light pastel backdrop, crisp lighting, strictly no text, no words, no letters"
                    )
                if style_key == "B1":
                    return f"Clean modern flat vector illustration of {scene_en}, vibrant colors, soft light backdrop, strictly no text, no letters"
                if style_key == "B2":
                    return f"Sleek glossy 3D isometric studio render of {scene_en}, smooth soft studio backdrop, strictly no text, no letters"
                return f"Clean modern commercial visual of {scene_en} on bright clear backdrop, strictly no text, no letters"

    defaults = {
        "A1": f"Realistic editorial lifestyle photograph representing '{subject}', dramatic contrast, person looking at modern smartphone in focus, rich vibrant scene, no text, no words, no letters",
        "A2": f"Bright clean modern commercial studio photograph illustrating '{subject}', soft pastel daylight background, smartphone and real subject centered cleanly, no text, no words, no letters",
        "A3": f"Sharp commercial cutout studio photo of the main hero object for '{subject}' with smartphone, centered cleanly isolated on pure solid white #FFFFFF background, high contrast studio lighting, no text, no words",
        "B1": f"Modern clean flat vector illustration representing '{subject}', vibrant balanced colors on soft light backdrop, uncluttered central composition, strictly no text, no letters",
        "B2": f"Sleek glossy 3D isometric studio render icon representing '{subject}' next to sleek 3D smartphone, soft studio lighting on smooth neutral backdrop, strictly no text, no letters",
        "B3": f"Clean modern commercial visual depicting the positive solved result of '{subject}' on a bright clear background, focused hero element in center, strictly no text, no letters",
    }
    return defaults[style_key]


def _build_fallback_creative_plan(niche_info, target_langs, translate_fn=None):
    title = str(niche_info.get("title") or niche_info.get("slug") or "Aplicativo").strip()
    cat = str(niche_info.get("category") or "APLICATIVO").strip().upper()
    phrases = [str(p).strip() for p in (niche_info.get("creative_phrases") or []) if str(p).strip()]
    seo = [str(s).strip() for s in (niche_info.get("seo_titles") or []) if str(s).strip()]

    style_prompts = niche_info.get("style_prompts") or {}
    a3_quotes = _extract_quoted_copy_from_prompt(style_prompts.get("A3", ""))
    b3_quotes = _extract_quoted_copy_from_prompt(style_prompts.get("B3", ""))

    p1 = phrases[0] if len(phrases) > 0 else title.upper()
    p2 = phrases[1] if len(phrases) > 1 else (seo[0] if seo else f"DESCUBRA {title.upper()}")
    p3 = phrases[2] if len(phrases) > 2 else "BAIXE GRÁTIS AGORA"

    pt_copy = {
        "category_badge": cat or "APLICATIVO",
        "headline_a1": p1.upper(),
        "sub_a1": (seo[0] if seo else p2),
        "headline_a2": (seo[1] if len(seo) > 1 else p2),
        "headline_a3": (a3_quotes[0] if len(a3_quotes) > 0 else p1).upper(),
        "caption_a3": (a3_quotes[1] if len(a3_quotes) > 1 else f"VEJA COMO USAR {title.upper()}").upper(),
        "headline_b1": p1.upper(),
        "headline_b2": p2.upper(),
        "before_b3": (b3_quotes[0] if len(b3_quotes) > 0 else p2).upper(),
        "after_b3": (b3_quotes[1] if len(b3_quotes) > 1 else p1).upper(),
        "caption_b3": (b3_quotes[2] if len(b3_quotes) > 2 else f"VEJA {title.upper()} NO CELULAR").upper(),
        "cta": "SAIBA MAIS",
        "download_cta": p3.upper(),
    }

    copy_by_lang = {}
    for code in target_langs:
        c = str(code).strip().lower()
        if c == "pt":
            copy_by_lang["pt"] = dict(pt_copy)
        else:
            tr_copy = {}
            for k, v in pt_copy.items():
                if k == "cta":
                    tr_copy[k] = DEFAULT_CTA_BY_LANG.get(c, "LEARN MORE")
                elif callable(translate_fn) and v:
                    tr_copy[k] = str(translate_fn(v, "pt", c) or v)
                else:
                    tr_copy[k] = v
            copy_by_lang[c] = tr_copy

    subject = title
    if callable(translate_fn) and title:
        subject = str(translate_fn(title, "pt", "en") or title)

    prompts_en = {
        sk: _extract_visual_scene_en(style_prompts.get(sk, ""), sk, subject, translate_fn=translate_fn)
        for sk in ("A1", "A2", "A3", "B1", "B2", "B3")
    }

    return {"prompts_en": prompts_en, "copy_by_lang": copy_by_lang, "source": "fallback"}


def build_niche_creative_plan(niche_info, target_langs=None, api_key="", translate_fn=None):
    """Usa Gemini Text (grátis) para converter os prompts Bloco A/B para inglês visual sem texto + copys PT/ES/EN."""
    langs = [str(l).strip().lower() for l in (target_langs or ["pt", "es", "en"]) if str(l).strip()]
    if "pt" not in langs:
        langs.insert(0, "pt")

    if not api_key:
        return _build_fallback_creative_plan(niche_info, langs, translate_fn=translate_fn)

    title = str(niche_info.get("title") or niche_info.get("slug") or "").strip()
    cat = str(niche_info.get("category") or "").strip()
    audio = str(niche_info.get("audio_script") or "").strip()
    phrases = niche_info.get("creative_phrases") or []
    seo = niche_info.get("seo_titles") or []
    style_prompts = niche_info.get("style_prompts") or {}

    langs_desc = ", ".join(
        f"{c} ({studio_engine.LANG_NATIVE_EN.get(c, c)})" for c in langs
    )

    prompt = f"""You are a senior Meta Ads creative strategist and AI art director.
Given a mobile-app niche brief and optional Bloco A / Bloco B style prompts in Portuguese, output a STRICT JSON object with:
1. "prompts_en": an object with keys "A1", "A2", "A3", "B1", "B2", "B3".
   Each value MUST be a vivid English image-generation prompt for FLUX describing ONLY the clean visual scene/object (NO text, NO headlines, NO buttons, NO words, NO letters):
   - A1 (Advertorial photo): Realistic photo-journalism / lifestyle photograph with strong emotional scene, vibrant color lighting, person + smartphone/subject.
   - A2 (Clean modern photo): Bright airy modern commercial photograph on soft clean light background, central focused photo + smartphone.
   - A3 (White background studio cutout): Isolated commercial product/hero cutout photography on PURE SOLID WHITE (#FFFFFF) background. Translate/adapt the visual subject of Prompt A3 if provided.
   - B1 (Flat vector illustration): Clean modern flat vector graphic illustration on smooth light backdrop, strictly zero text.
   - B2 (3D render): Glossy modern 3D studio icon render on smooth soft backdrop, studio lighting, strictly zero text.
   - B3 (Clean visual for Right/After comparison phone): Vibrant clean visual icon/scene showing the app working successfully, centered, strictly zero text.
   Always end every prompt with ", strictly no text, no words, no letters, no watermark".

2. "copy_by_lang": an object mapping each language code [{langs_desc}] to:
   {{
     "category_badge": "short uppercase category tag (e.g. UTILIDADE / UTILIDAD / UTILITY)",
     "headline_a1": "short punchy uppercase headline (max 38 chars)",
     "sub_a1": "short concise subtitle (max 65 chars)",
     "headline_a2": "short engaging headline (max 42 chars)",
     "headline_a3": "very punchy uppercase red headline (max 32 chars, preserve quoted headline from A3 if given)",
     "caption_a3": "uppercase action caption like VEJA COMO... (max 36 chars, preserve quoted caption from A3 if given)",
     "headline_b1": "short punchy uppercase headline (max 38 chars)",
     "headline_b2": "short punchy uppercase headline (max 38 chars)",
     "before_b3": "short uppercase problem state (2-4 words, e.g. SEM SABER SE ATRASOU)",
     "after_b3": "short uppercase solved state (2-4 words, e.g. VOO AO VIVO NO MAPA)",
     "caption_b3": "uppercase action caption like VEJA COMO... (max 36 chars)",
     "cta": "button text: SAIBA MAIS (pt), MÁS INFO (es), LEARN MORE (en), etc."
   }}

NICHE BRIEF:
- Title: {title}
- Category: {cat}
- Audio script PT: {audio}
- 3 Creative Phrases: {json.dumps(phrases, ensure_ascii=False)}
- SEO titles: {json.dumps(seo, ensure_ascii=False)}
- Bloco A / B source prompts (Portuguese): {json.dumps(style_prompts, ensure_ascii=False)}
"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.25,
            "responseMimeType": "application/json",
        },
    }

    for model_id in studio_engine.GEMINI_TEXT_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{urllib.parse.quote(model_id)}:generateContent"
        res_json, _, _ = studio_engine._post_gemini_json(url, payload, api_key)
        if not res_json:
            continue
        for cand in (res_json.get("candidates") or []):
            parts = ((cand or {}).get("content") or {}).get("parts") or []
            raw_txt = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict)).strip()
            raw_txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_txt, flags=re.IGNORECASE).strip()
            if not raw_txt:
                continue
            try:
                parsed = json.loads(raw_txt)
                p_en = parsed.get("prompts_en") or {}
                c_lang = parsed.get("copy_by_lang") or {}
                if all(k in p_en for k in ("A1", "A2", "A3", "B1", "B2", "B3")) and "pt" in c_lang:
                    for lc in langs:
                        if lc not in c_lang:
                            copied = {}
                            for ck, cv in c_lang["pt"].items():
                                if ck == "cta":
                                    copied[ck] = DEFAULT_CTA_BY_LANG.get(lc, "LEARN MORE")
                                elif callable(translate_fn) and cv and lc != "pt":
                                    copied[ck] = str(translate_fn(cv, "pt", lc) or cv)
                                else:
                                    copied[ck] = cv
                            c_lang[lc] = copied
                    return {"prompts_en": p_en, "copy_by_lang": c_lang, "source": f"gemini:{model_id}"}
            except Exception:
                continue

    return _build_fallback_creative_plan(niche_info, langs, translate_fn=translate_fn)
