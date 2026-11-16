import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# ============================================================
# REGRAS & PADRÕES OFICIAIS DO TWOD CRIATIVOS STUDIO V2
# ============================================================

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".aac", ".ogg")
CHUNK_UPLOAD_SIZE = 327680 * 10  # 3.2 MiB (múltiplo obrigatório de 320 KiB no OneDrive)

LANGUAGES_DB = {
    "es": {
        "name": "Espanhol",
        "code": "es",
        "block": "BLOCO-01 (Espanhol)",
        "keys": [
            "es", "espanhol", "spanish", "espanha", "chile", "argentina", "colombia", "colômbia",
            "venezuela", "peru", "porto rico", "portorico", "costa rica", "costarica", "equador",
            "honduras", "panama", "panamá", "nicaragua", "nicarágua", "el salvador", "elsalvador",
            "guatemala", "republica dominicana", "república dominicana", "repdom", "mexico", "méxico",
            "bolivia", "bolívia", "uruguai", "paraguai",
        ],
    },
    "pt": {
        "name": "Português",
        "code": "pt",
        "block": "Master / Português",
        "keys": ["pt", "portugues", "português", "portuguese", "brasil", "brazil", "portugal", "br"],
    },
    "en": {
        "name": "Inglês",
        "code": "en",
        "block": "BLOCO-A/B (Inglês)",
        "keys": ["en", "ingles", "inglês", "english", "eua", "usa", "uk", "estados unidos", "canada", "australia"],
    },
    "fr": {
        "name": "Francês",
        "code": "fr",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["fr", "frances", "francês", "french", "franca", "frança"],
    },
    "it": {
        "name": "Italiano",
        "code": "it",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["it", "italiano", "italian", "italia", "itália"],
    },
    "de": {
        "name": "Alemão",
        "code": "de",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["de", "alemao", "alemão", "german", "alemanha"],
    },
    "ro": {
        "name": "Romeno",
        "code": "ro",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["ro", "romeno", "romenian", "romenia", "romênia"],
    },
    "pl": {
        "name": "Polonês",
        "code": "pl",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["pl", "polones", "polonês", "polish", "polonia", "polônia"],
    },
    "nl": {
        "name": "Holandês",
        "code": "nl",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["nl", "holandes", "holandês", "dutch", "holanda"],
    },
    "sr": {
        "name": "Sérvio",
        "code": "sr",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["sr", "servio", "sérvio", "serbian", "servia", "sérvia"],
    },
    "ru": {
        "name": "Russo",
        "code": "ru",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["ru", "russo", "russian", "russia", "rússia"],
    },
    "ar": {
        "name": "Árabe",
        "code": "ar",
        "block": "Outros Idiomas",
        "keys": ["ar", "arabe", "árabe", "arabic"],
    },
    "hi": {
        "name": "Hindi",
        "code": "hi",
        "block": "Outros Idiomas",
        "keys": ["hi", "hindi", "india", "índia"],
    },
    "bn": {
        "name": "Bengali",
        "code": "bn",
        "block": "Outros Idiomas",
        "keys": ["bn", "bengali", "bangladesh"],
    },
    "tl": {
        "name": "Tagalo",
        "code": "tl",
        "block": "Outros Idiomas",
        "keys": ["tl", "fil", "tagalo", "tagalog", "filipino", "filipinas"],
    },
    "ms": {
        "name": "Malaio",
        "code": "ms",
        "block": "Outros Idiomas",
        "keys": ["ms", "malaio", "malay", "malasia", "malásia"],
    },
    "ko": {
        "name": "Coreano",
        "code": "ko",
        "block": "Outros Idiomas",
        "keys": ["ko", "coreano", "korean", "coreia"],
    },
    "ja": {
        "name": "Japonês",
        "code": "ja",
        "block": "Outros Idiomas",
        "keys": ["ja", "japones", "japonês", "japanese", "japao", "japão"],
    },
    "tr": {
        "name": "Turco",
        "code": "tr",
        "block": "Outros Idiomas",
        "keys": ["tr", "turco", "turkish", "turquia"],
    },
    "vi": {
        "name": "Vietnamita",
        "code": "vi",
        "block": "Outros Idiomas",
        "keys": ["vi", "vietnamita", "vietnamese", "vietnam", "vietnã"],
    },
}


def get_ffmpeg_path():
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    return "ffmpeg"


FFMPEG_PATH = get_ffmpeg_path()


def run_ffmpeg(cmd, timeout=120, process_holder=None):
    startupinfo = None
    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if hasattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS"):
            creationflags |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0

    proc = None
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )
        if process_holder is not None and isinstance(process_holder, list):
            process_holder[0] = proc
        _, stderr = proc.communicate(timeout=timeout)
        return proc.returncode, stderr.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
            _, stderr = proc.communicate()
            return -1, stderr.decode("utf-8", errors="replace") + f"\n[TIMEOUT] FFmpeg excedeu {timeout}s."
        return -1, f"[TIMEOUT] FFmpeg excedeu {timeout}s."
    except Exception as e:
        return -1, str(e)
    finally:
        if process_holder is not None and isinstance(process_holder, list):
            process_holder[0] = None


def is_image_valid_file(filepath):
    """Valida assinatura PNG (IEND) / JPEG (FF D9) / WEBP para não travar FFmpeg."""
    try:
        if not os.path.isfile(filepath):
            return False
        sz = os.path.getsize(filepath)
        if sz < 100:
            return False
        with open(filepath, "rb") as f:
            header = f.read(16)
            if header.startswith(b"\x89PNG\r\n\x1a\n"):
                f.seek(max(0, sz - 128))
                return b"IEND" in f.read()
            if header.startswith(b"\xff\xd8"):
                f.seek(max(0, sz - 32))
                return b"\xff\xd9" in f.read()
            if header.startswith(b"RIFF") and b"WEBP" in header:
                return True
        return True
    except Exception:
        return False


def get_audio_duration(audio_path):
    try:
        _, stderr = run_ffmpeg([FFMPEG_PATH, "-i", audio_path], timeout=30)
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", stderr)
        if m:
            h, mins, s = m.groups()
            return int(h) * 3600 + int(mins) * 60 + float(s)
    except Exception:
        pass
    return 15.0


def get_img_dims(path):
    try:
        _, stderr = run_ffmpeg([FFMPEG_PATH, "-i", path], timeout=25)
        for line in stderr.splitlines():
            if "Stream #0:0" in line and "Video:" in line:
                m = re.search(r"(\d+)x(\d+)", line)
                if m:
                    return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return 1080, 1080


def normalize_text(text):
    if not text:
        return ""
    return unicodedata.normalize("NFKD", str(text)).encode("ASCII", "ignore").decode("utf-8").lower().strip()


def normalize_folder_key(name):
    if not name:
        return ""
    return re.sub(r"[\s_\-\.]+", "", normalize_text(name))


def is_master_images_folder(name):
    return normalize_folder_key(name) in ("1imagens", "1imagem", "imagens", "1imagenspt")


def extract_trailing_num(path):
    nums = re.findall(r"\d+", os.path.splitext(os.path.basename(path))[0])
    return int(nums[-1]) if nums else 0


def sort_creatives_by_dims(image_paths):
    """Ordena 1..3 Quadrados/Feed (w >= h/1.1) e 4..6 Verticais/Reels (h > w*1.1)."""
    if not image_paths:
        return []
    all_single_digits = all(re.match(r"^[1-9]$", os.path.splitext(os.path.basename(p))[0]) for p in image_paths)
    if all_single_digits:
        return sorted(image_paths, key=lambda x: int(os.path.splitext(os.path.basename(x))[0]))

    squares, verticals = [], []
    for p in image_paths:
        w, h = get_img_dims(p)
        if h > w * 1.1:
            verticals.append(p)
        else:
            squares.append(p)
    squares.sort(key=lambda x: (extract_trailing_num(x), os.path.basename(x).lower()))
    verticals.sort(key=lambda x: (extract_trailing_num(x), os.path.basename(x).lower()))
    return squares + verticals


def extract_campaign_date(name):
    """Extrai (ano, mes, dia) do padrão '<Nicho> DD.MM.YY' ou variações."""
    if not name:
        return None
    matches_full = re.findall(r"(?<!\d)(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})(?!\d)", str(name))
    for d_str, m_str, y_str in reversed(matches_full):
        day, month, year = int(d_str), int(m_str), int(y_str)
        if year < 100:
            year += 2000
        if 1 <= day <= 31 and 1 <= month <= 12 and 2020 <= year <= 2100:
            return (year, month, day)

    matches_short = re.findall(r"(?<!\d)(\d{1,2})[.\-_](\d{1,2})(?!\d)", str(name))
    for d_str, m_str in reversed(matches_short):
        day, month = int(d_str), int(m_str)
        if 1 <= day <= 31 and 1 <= month <= 12:
            return (datetime.now().year, month, day)
    return None


def format_campaign_folder_name(niche_name, date_str=""):
    """Padroniza nome no formato '<Nicho> <DD.MM.YY>' (sem remover data se já estiver inclusa)."""
    clean_niche = re.sub(r'[\\/:*?"<>|]+', " ", str(niche_name or "")).strip()
    if not clean_niche:
        return ""
    if not date_str:
        if extract_campaign_date(clean_niche):
            return clean_niche
        date_str = datetime.now().strftime("%d.%m.%y")

    raw_d = str(date_str).strip()
    # Aceita YYYY-MM-DD (input type="date") -> DD.MM.YY
    m_iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", raw_d)
    if m_iso:
        yy, mm, dd = int(m_iso.group(1)) % 100, m_iso.group(2), m_iso.group(3)
        formatted_date = f"{dd}.{mm}.{yy:02d}"
    else:
        m_br = re.match(r"^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$", raw_d)
        if m_br:
            dd = int(m_br.group(1))
            mm = int(m_br.group(2))
            yy = int(m_br.group(3)) % 100 if m_br.group(3) else (datetime.now().year % 100)
            formatted_date = f"{dd:02d}.{mm:02d}.{yy:02d}"
        else:
            formatted_date = raw_d

    # Remove data antiga do sufixo caso usuário tenha passado nicho + nova data
    if extract_campaign_date(clean_niche):
        return clean_niche
    return f"{clean_niche} {formatted_date}".strip()


def extract_clean_niche_slug(camp_name):
    """Extrai o nome limpo do nicho removendo data do final (ex: 'ÁudioSecreto 05.11.26' -> 'ÁudioSecreto')."""
    base = str(camp_name or "").strip()
    base = re.sub(r"\s+\d{1,2}[.\-_]\d{1,2}(?:[.\-_]\d{2,4})?$", "", base).strip()
    base = re.sub(r'[\\/:*?"<>|\s]+', "", base)
    return base or "Nicho"


def identify_language_from_name(name):
    if not name:
        return None
    norm_name = normalize_text(name)
    base_no_ext = os.path.splitext(norm_name)[0]

    for code in LANGUAGES_DB:
        if base_no_ext == code:
            return code
    for code in LANGUAGES_DB:
        if base_no_ext.endswith(f"_{code}") or base_no_ext.endswith(f"-{code}") or base_no_ext.startswith(f"{code}_"):
            return code
    for code, info in LANGUAGES_DB.items():
        for k in info["keys"]:
            norm_k = normalize_text(k)
            if (
                norm_k == base_no_ext
                or f" {norm_k} " in f" {base_no_ext} "
                or base_no_ext.startswith(f"{norm_k} ")
                or base_no_ext.endswith(f" {norm_k}")
                or f"_{norm_k}" in base_no_ext
                or f"{norm_k}_" in base_no_ext
                or base_no_ext.endswith(f"-{norm_k}")
                or base_no_ext.startswith(f"{norm_k}-")
                or f"-{norm_k}-" in base_no_ext
                or base_no_ext.endswith(f".{norm_k}")
                or f"({norm_k})" in base_no_ext
            ):
                return code
    for code, info in LANGUAGES_DB.items():
        for k in info["keys"]:
            norm_k = normalize_text(k)
            if len(norm_k) >= 4 and norm_k in base_no_ext:
                return code
    return None


def get_clean_zip_filename(info):
    if info.flag_bits & 0x800:
        return info.filename
    raw_bytes = info.filename.encode("cp437", errors="replace")
    try:
        return raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return raw_bytes.decode("cp1252", errors="replace")


# ============================================================
# HELPERS DE LEITURA/ESCRITA NO ONEDRIVE VIA MICROSOFT GRAPH
# ============================================================

def _graph_json_request(url, tok, method="GET", payload_obj=None, timeout=30):
    data = None
    headers = {"Authorization": f"Bearer {tok}", "Accept": "application/json"}
    if payload_obj is not None:
        data = json.dumps(payload_obj, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"

    for attempt in range(3):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(min(int(e.headers.get("Retry-After", str(2 ** attempt))), 10))
                continue
            raw = e.read().decode("utf-8", errors="replace")
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"error": {"message": raw or f"HTTP {e.code}"}}
        except Exception as e:
            if attempt < 2:
                time.sleep(1.0 * (attempt + 1))
                continue
            return 502, {"error": {"message": str(e)}}
    return 502, {"error": {"message": "Timeout Graph API"}}


def graph_list_children(parent_id, tok):
    items = []
    url = f"https://graph.microsoft.com/v1.0/me/drive/items/{parent_id}/children?$top=999&$select=id,name,size,folder,file,lastModifiedDateTime"
    while url:
        st, data = _graph_json_request(url, tok, "GET")
        if st >= 400 or "error" in data:
            break
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
    return items


def graph_find_child_folder_ci(parent_id, target_names, tok):
    if isinstance(target_names, str):
        target_names = [target_names]
    targets_key = {normalize_folder_key(t) for t in target_names}
    children = graph_list_children(parent_id, tok)
    for ch in children:
        if "folder" in ch and normalize_folder_key(ch.get("name", "")) in targets_key:
            return ch
    return None


def graph_ensure_folder(parent_id, folder_name, tok):
    existing = graph_find_child_folder_ci(parent_id, folder_name, tok)
    if existing and existing.get("id"):
        return existing
    url = f"https://graph.microsoft.com/v1.0/me/drive/items/{parent_id}/children"
    st, data = _graph_json_request(
        url,
        tok,
        "POST",
        {"name": folder_name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"},
    )
    if 200 <= st < 300 and data.get("id"):
        return data
    # Em corrida ou conflito de nome, busca novamente
    retry_found = graph_find_child_folder_ci(parent_id, folder_name, tok)
    if retry_found:
        return retry_found
    raise RuntimeError(data.get("error", {}).get("message") or f"Erro ao criar pasta '{folder_name}' (HTTP {st})")


def graph_ensure_nested_folder(root_id, rel_parts, tok):
    cur_id = root_id
    cur_obj = {"id": root_id, "name": ""}
    for part in rel_parts:
        clean = str(part or "").strip()
        if not clean:
            continue
        cur_obj = graph_ensure_folder(cur_id, clean, tok)
        cur_id = cur_obj["id"]
    return cur_obj


def graph_upload_file(parent_id, filename, src_path, tok):
    """Envia arquivo para OneDrive: PUT direto (<3.8MB) ou createUploadSession em fatias (arquivos maiores)."""
    sz = os.path.getsize(src_path)
    encoded_name = urllib.parse.quote(filename)
    if sz < 3_800_000:
        with open(src_path, "rb") as f:
            raw = f.read()
        url = f"https://graph.microsoft.com/v1.0/me/drive/items/{parent_id}:/{encoded_name}:/content"
        for attempt in range(3):
            req = urllib.request.Request(
                url,
                data=raw,
                headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/octet-stream"},
                method="PUT",
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"Erro no upload '{filename}': HTTP {e.code} {e.read().decode('utf-8', 'ignore')[:200]}")
        raise RuntimeError(f"Falha ao enviar '{filename}'")

    sess_url = f"https://graph.microsoft.com/v1.0/me/drive/items/{parent_id}:/{encoded_name}:/createUploadSession"
    st, sess = _graph_json_request(
        sess_url,
        tok,
        "POST",
        {"item": {"@microsoft.graph.conflictBehavior": "replace", "name": filename}},
    )
    upload_url = sess.get("uploadUrl")
    if st >= 400 or not upload_url:
        raise RuntimeError(sess.get("error", {}).get("message") or f"Falha ao abrir sessão de upload para '{filename}'")

    with open(src_path, "rb") as f:
        offset = 0
        last_item = None
        while offset < sz:
            chunk = f.read(CHUNK_UPLOAD_SIZE)
            if not chunk:
                break
            end = offset + len(chunk) - 1
            headers = {
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{end}/{sz}",
            }
            req = urllib.request.Request(upload_url, data=chunk, headers=headers, method="PUT")
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                if body:
                    try:
                        last_item = json.loads(body)
                    except Exception:
                        pass
            offset += len(chunk)
        return last_item or {"name": filename, "size": sz}


def graph_download_item(item_id, dest_path, tok):
    st, meta = _graph_json_request(
        f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}?select=id,name,@microsoft.graph.downloadUrl,@content.downloadUrl",
        tok,
        "GET",
    )
    dl_url = meta.get("@microsoft.graph.downloadUrl") or meta.get("@content.downloadUrl")
    if st >= 400 or not dl_url:
        raise RuntimeError(meta.get("error", {}).get("message") or f"Falha ao obter downloadUrl de {item_id}")
    with urllib.request.urlopen(urllib.request.Request(dl_url, method="GET"), timeout=120) as vr, open(dest_path, "wb") as tf:
        shutil.copyfileobj(vr, tf, length=1024 * 512)
    return dest_path


def graph_delete_item(item_id, tok):
    req = urllib.request.Request(
        f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}",
        headers={"Authorization": f"Bearer {tok}"},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return True
        return False
    except Exception:
        return False


def _match_audio_folder_entry(camp_name, audio_folders):
    target_key = normalize_folder_key(camp_name)
    for af in audio_folders:
        if normalize_folder_key(af.get("name", "")) == target_key:
            return af
    norm_camp = normalize_text(camp_name)
    for af in audio_folders:
        if normalize_text(af.get("name", "")) == norm_camp:
            return af
    return None


def _collect_audios_in_folder(audio_folder_id, tok):
    """Mapeia {lang_code: {id, name, size, lang_code, lang_name}} na pasta de áudio."""
    out = {}
    if not audio_folder_id:
        return out
    children = graph_list_children(audio_folder_id, tok)
    for ch in children:
        cname = ch.get("name", "")
        if "file" in ch and cname.lower().endswith(AUDIO_EXTS):
            code = identify_language_from_name(cname) or "pt"
            if code not in out:
                out[code] = {
                    "id": ch["id"],
                    "name": cname,
                    "size": ch.get("size", 0),
                    "lang_code": code,
                    "lang_name": LANGUAGES_DB.get(code, {}).get("name", code.upper()),
                }
        elif "folder" in ch:
            sub_code = identify_language_from_name(cname)
            for sub_ch in graph_list_children(ch["id"], tok):
                scname = sub_ch.get("name", "")
                if "file" in sub_ch and scname.lower().endswith(AUDIO_EXTS):
                    c_code = identify_language_from_name(scname) or sub_code or "pt"
                    if c_code not in out:
                        out[c_code] = {
                            "id": sub_ch["id"],
                            "name": scname,
                            "size": sub_ch.get("size", 0),
                            "lang_code": c_code,
                            "lang_name": LANGUAGES_DB.get(c_code, {}).get("name", c_code.upper()),
                        }
    return out


# ============================================================
# LISTAGEM, CRIAÇÃO E AUDITORIA PRÉ-VOO NO ONEDRIVE
# ============================================================

def list_studio_campaigns_cloud(tok, find_work_ids_fn, search="", limit=15):
    _, audios_root_id, videos_root_id = find_work_ids_fn(tok)
    if not videos_root_id and not audios_root_id:
        return {"success": False, "error": "Pastas 'Vídeos' e 'Arquivos de Áudio' não encontradas no OneDrive."}

    vid_folders = [c for c in (graph_list_children(videos_root_id, tok) if videos_root_id else []) if "folder" in c]
    aud_folders = [c for c in (graph_list_children(audios_root_id, tok) if audios_root_id else []) if "folder" in c]

    seen_keys = set()
    rows = []

    def _add_row(name, vid_obj, aud_obj):
        dt = extract_campaign_date(name)
        dt_sort = dt if dt else (1970, 1, 1)
        dt_label = f"{dt[2]:02d}.{dt[1]:02d}.{str(dt[0])[-2:]}" if dt else "Sem data"
        rows.append({
            "name": name,
            "date_tuple": dt_sort,
            "date_label": dt_label,
            "video_folder_id": vid_obj.get("id") if vid_obj else None,
            "audio_folder_id": aud_obj.get("id") if aud_obj else None,
            "audio_folder_name": aud_obj.get("name") if aud_obj else None,
            "has_videos_folder": bool(vid_obj),
            "has_audios_folder": bool(aud_obj),
            "modified_at": (vid_obj or aud_obj or {}).get("lastModifiedDateTime", ""),
        })

    for vf in vid_folders:
        k = normalize_folder_key(vf["name"])
        seen_keys.add(k)
        matched_aud = _match_audio_folder_entry(vf["name"], aud_folders)
        _add_row(vf["name"], vf, matched_aud)

    for af in aud_folders:
        k = normalize_folder_key(af["name"])
        if k not in seen_keys:
            seen_keys.add(k)
            _add_row(af["name"], None, af)

    rows.sort(key=lambda r: (r["date_tuple"], r["name"].lower()), reverse=True)

    q_norm = normalize_text(search)
    if q_norm:
        rows = [r for r in rows if q_norm in normalize_text(r["name"]) or q_norm in r["date_label"].lower()]

    total = len(rows)
    if limit and limit > 0:
        rows = rows[:limit]

    # Limpa tuple não serializável se precisar
    for r in rows:
        r.pop("date_tuple", None)

    return {
        "success": True,
        "total": total,
        "campaigns": rows,
        "audios_root_id": audios_root_id,
        "videos_root_id": videos_root_id,
    }


def _scan_campaign_blocks_and_langs(camp_name, tok, find_work_ids_fn):
    _, audios_root_id, videos_root_id = find_work_ids_fn(tok)
    if not videos_root_id and not audios_root_id:
        raise RuntimeError("Pastas 'Vídeos' e 'Arquivos de Áudio' não localizadas no OneDrive.")

    vid_folders = [c for c in (graph_list_children(videos_root_id, tok) if videos_root_id else []) if "folder" in c]
    aud_folders = [c for c in (graph_list_children(audios_root_id, tok) if audios_root_id else []) if "folder" in c]

    target_k = normalize_folder_key(camp_name)
    vid_obj = next((v for v in vid_folders if normalize_folder_key(v["name"]) == target_k), None)
    aud_obj = _match_audio_folder_entry(camp_name, aud_folders)

    audios_by_code = _collect_audios_in_folder(aud_obj["id"], tok) if aud_obj else {}

    blocks_data = []
    if vid_obj:
        top_children = graph_list_children(vid_obj["id"], tok)
        block_folders = []
        for canonical in ("Bloco A", "Bloco B"):
            bf = next((c for c in top_children if "folder" in c and normalize_folder_key(c["name"]) == normalize_folder_key(canonical)), None)
            if bf:
                block_folders.append((bf["name"], bf["id"]))
        if not block_folders:
            block_folders = [("Único", vid_obj["id"])]

        for block_label, block_id in block_folders:
            sub_items = graph_list_children(block_id, tok) if block_id != vid_obj["id"] else top_children
            sub_folders = [c for c in sub_items if "folder" in c]

            master_dir = next((c for c in sub_folders if is_master_images_folder(c["name"])), None)
            pt_dir = next((c for c in sub_folders if normalize_folder_key(c["name"]) in ("portugues", "pt")), None)

            lang_slots = []
            if master_dir or pt_dir:
                src_dir = master_dir or pt_dir
                lang_slots.append({
                    "lang_name": "Português",
                    "lang_code": "pt",
                    "is_master": True,
                    "src_folder_id": src_dir["id"],
                    "src_folder_name": src_dir["name"],
                    "dest_folder_id": pt_dir["id"] if pt_dir else None,
                    "dest_folder_name": "Português",
                })

            for sf in sub_folders:
                if is_master_images_folder(sf["name"]):
                    continue
                code = identify_language_from_name(sf["name"])
                if code and code != "pt":
                    lang_slots.append({
                        "lang_name": LANGUAGES_DB[code]["name"],
                        "lang_code": code,
                        "is_master": False,
                        "src_folder_id": sf["id"],
                        "src_folder_name": sf["name"],
                        "dest_folder_id": sf["id"],
                        "dest_folder_name": sf["name"],
                    })

            lang_reports = []
            for slot in lang_slots:
                src_children = graph_list_children(slot["src_folder_id"], tok)
                raw_imgs = [c for c in src_children if "file" in c and c["name"].lower().endswith(IMAGE_EXTS)]
                if slot["dest_folder_id"] == slot["src_folder_id"]:
                    dest_children = src_children
                elif slot["dest_folder_id"]:
                    dest_children = graph_list_children(slot["dest_folder_id"], tok)
                else:
                    dest_children = []
                rendered_mp4s = [c for c in dest_children if "file" in c and c["name"].lower().endswith(".mp4")]
                # Também detecta áudios avulsos colocados dentro da própria pasta do idioma (fallback do twod_studio.py)
                audio_info = audios_by_code.get(slot["lang_code"])
                if not audio_info:
                    local_aud = next((c for c in src_children if "file" in c and c["name"].lower().endswith(AUDIO_EXTS)), None)
                    if local_aud:
                        audio_info = {
                            "id": local_aud["id"],
                            "name": local_aud["name"],
                            "size": local_aud.get("size", 0),
                            "lang_code": slot["lang_code"],
                            "lang_name": slot["lang_name"],
                        }

                zero_byte_imgs = [im["name"] for im in raw_imgs if int(im.get("size") or 0) < 100]
                lang_reports.append({
                    **slot,
                    "images": [{"id": im["id"], "name": im["name"], "size": im.get("size", 0)} for im in raw_imgs],
                    "videos": [{"id": v["id"], "name": v["name"], "size": v.get("size", 0)} for v in rendered_mp4s],
                    "imgs_count": len(raw_imgs),
                    "videos_count": len(rendered_mp4s),
                    "zero_byte_imgs": zero_byte_imgs,
                    "audio": audio_info,
                })

            blocks_data.append({
                "block": block_label,
                "block_id": block_id,
                "languages": lang_reports,
            })

    return {
        "name": vid_obj["name"] if vid_obj else (aud_obj["name"] if aud_obj else camp_name),
        "video_folder_id": vid_obj["id"] if vid_obj else None,
        "audio_folder_id": aud_obj["id"] if aud_obj else None,
        "audio_folder_name": aud_obj["name"] if aud_obj else None,
        "audios_by_code": audios_by_code,
        "blocks": blocks_data,
    }


def audit_campaign_cloud(camp_name, tok, find_work_ids_fn):
    info = _scan_campaign_blocks_and_langs(camp_name, tok, find_work_ids_fn)
    total_images = 0
    total_videos = 0
    missing_audios = []
    zero_imgs = []
    ready_jobs = 0

    for blk in info["blocks"]:
        for lg in blk["languages"]:
            total_images += lg["imgs_count"]
            total_videos += lg["videos_count"]
            for z in lg["zero_byte_imgs"]:
                zero_imgs.append({"block": blk["block"], "lang": lg["lang_name"], "file": z})
            if lg["imgs_count"] > 0:
                if lg["audio"]:
                    ready_jobs += 1
                else:
                    missing_audios.append({"block": blk["block"], "lang": lg["lang_name"], "lang_code": lg["lang_code"]})

    if zero_imgs:
        status = "error"
        status_desc = f"🚨 {len(zero_imgs)} arquivo(s) de imagem vazio/corrompido!"
    elif missing_audios:
        status = "error"
        status_desc = f"⚠️ Falta áudio para {len(missing_audios)} idioma(s)!"
    elif total_images == 0 and total_videos > 0:
        status = "completed"
        status_desc = f"✅ Já renderizado ({total_videos} vídeos MP4 presentes)."
    elif total_images == 0:
        status = "warning"
        status_desc = "⚠️ Nenhuma imagem encontrada ainda nas pastas."
    else:
        status = "ok"
        status_desc = f"✅ 100% Pronto para renderizar ({total_images} imagens em {ready_jobs} conjunto(s))"

    return {
        "success": True,
        "status": status,
        "status_desc": status_desc,
        "total_images": total_images,
        "total_videos": total_videos,
        "ready_jobs": ready_jobs,
        "missing_audios": missing_audios,
        "corrupt_images": zero_imgs,
        **info,
    }


# ============================================================
# CRIAÇÃO DE CAMPANHA + UPLOADS PADRONIZADOS PARA O ONEDRIVE
# ============================================================

def create_campaign_folders_cloud(niche_name, date_str, use_blocks, tok, find_work_ids_fn):
    folder_name = format_campaign_folder_name(niche_name, date_str)
    if not folder_name:
        raise ValueError("Nome do nicho obrigatório.")

    _, audios_root_id, videos_root_id = find_work_ids_fn(tok)
    if not audios_root_id or not videos_root_id:
        raise RuntimeError("Pastas raiz 'Arquivos de Áudio' ou 'Vídeos' não localizadas no OneDrive.")

    aud_folder = graph_ensure_folder(audios_root_id, folder_name, tok)
    vid_folder = graph_ensure_folder(videos_root_id, folder_name, tok)

    if use_blocks:
        for b_name in ("Bloco A", "Bloco B"):
            b_obj = graph_ensure_folder(vid_folder["id"], b_name, tok)
            graph_ensure_folder(b_obj["id"], "1. Imagens", tok)
    else:
        graph_ensure_folder(vid_folder["id"], "1. Imagens", tok)

    return {
        "success": True,
        "campaign_name": vid_folder["name"],
        "audio_folder_id": aud_folder["id"],
        "video_folder_id": vid_folder["id"],
        "use_blocks": bool(use_blocks),
    }


def upload_audio_to_onedrive_cloud(campaign_name, date_str, lang_code, orig_filename, tmp_path, tok, find_work_ids_fn):
    folder_name = format_campaign_folder_name(campaign_name, date_str)
    if not folder_name:
        raise ValueError("Informe o nome da campanha/nicho.")
    _, audios_root_id, _ = find_work_ids_fn(tok)
    if not audios_root_id:
        raise RuntimeError("Pasta 'Arquivos de Áudio' não encontrada no OneDrive.")

    aud_folder = graph_ensure_folder(audios_root_id, folder_name, tok)
    detected = (lang_code or "").strip().lower() or identify_language_from_name(orig_filename) or "pt"
    if detected not in LANGUAGES_DB:
        detected = "pt"

    ext = os.path.splitext(orig_filename)[1].lower()
    if ext not in AUDIO_EXTS:
        ext = ".mp3"
    niche_slug = extract_clean_niche_slug(folder_name)
    final_name = f"{niche_slug}_{detected}{ext}"

    uploaded = graph_upload_file(aud_folder["id"], final_name, tmp_path, tok)
    dur = get_audio_duration(tmp_path)
    return {
        "success": True,
        "campaign_name": folder_name,
        "audio_folder": aud_folder["name"],
        "filename": final_name,
        "lang_code": detected,
        "lang_name": LANGUAGES_DB[detected]["name"],
        "duration": round(dur, 2),
        "duration_ceil": int(math.ceil(dur)),
        "item_id": uploaded.get("id", ""),
    }


def _resolve_target_image_folder(vid_folder_id, block_name, lang_code, tok):
    rel = []
    if block_name and block_name.strip().lower() not in ("", "unico", "único"):
        rel.append(block_name.strip())
    lc = (lang_code or "pt").strip().lower()
    if lc in ("pt", "master", "1. imagens"):
        rel.append("1. Imagens")
    else:
        rel.append(LANGUAGES_DB.get(lc, {}).get("name", lc.upper()))
    return graph_ensure_nested_folder(vid_folder_id, rel, tok), rel


def upload_standardized_images_cloud(campaign_name, date_str, block_name, lang_code, staged_files, tok, find_work_ids_fn):
    """Recebe caminhos temporários [(orig_name, tmp_path), ...], valida, ordena 1-3 Feed / 4-6 Reels e envia para OneDrive."""
    folder_name = format_campaign_folder_name(campaign_name, date_str)
    if not folder_name:
        raise ValueError("Informe o nome da campanha/nicho.")
    _, _, videos_root_id = find_work_ids_fn(tok)
    if not videos_root_id:
        raise RuntimeError("Pasta 'Vídeos' não encontrada no OneDrive.")

    vid_folder = graph_ensure_folder(videos_root_id, folder_name, tok)
    target_folder, rel_parts = _resolve_target_image_folder(vid_folder["id"], block_name, lang_code, tok)

    valid_paths = []
    invalid_files = []
    work_dir = tempfile.mkdtemp(prefix="twod_imgsort_")
    try:
        for orig_name, src_path in staged_files:
            if not is_image_valid_file(src_path):
                invalid_files.append(orig_name)
                continue
            ext = os.path.splitext(orig_name)[1].lower()
            if ext not in IMAGE_EXTS:
                ext = ".png"
            # Preserva nome original no diretório temporário para desempate de número
            safe_base = os.path.basename(orig_name)
            dst = os.path.join(work_dir, safe_base)
            if os.path.exists(dst):
                dst = os.path.join(work_dir, f"{len(valid_paths)+1}_{safe_base}")
            shutil.copy2(src_path, dst)
            valid_paths.append(dst)

        if invalid_files and not valid_paths:
            raise ValueError(f"Todas as imagens estão corrompidas/inválidas: {', '.join(invalid_files)}")

        sorted_paths = sort_creatives_by_dims(valid_paths)
        uploaded_list = []
        for idx, img_p in enumerate(sorted_paths, start=1):
            ext = os.path.splitext(img_p)[1].lower() or ".png"
            out_name = f"{idx}{ext}"
            w, h = get_img_dims(img_p)
            kind = "Reels 9:16" if h > w * 1.1 else "Feed 1:1"
            up = graph_upload_file(target_folder["id"], out_name, img_p, tok)
            uploaded_list.append({
                "slot": idx,
                "filename": out_name,
                "original": os.path.basename(img_p),
                "dims": f"{w}x{h}",
                "kind": kind,
                "id": up.get("id", ""),
            })

        return {
            "success": True,
            "campaign_name": folder_name,
            "folder_path": "/".join([folder_name] + rel_parts),
            "uploaded": uploaded_list,
            "invalid_files": invalid_files,
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def import_zip_to_onedrive_cloud(campaign_name, date_str, zip_path, tok, find_work_ids_fn):
    """Descompacta pacote ZIP do GPT/Canva, padroniza 1..6 por Bloco/Idioma e envia ao OneDrive."""
    folder_name = format_campaign_folder_name(campaign_name, date_str)
    if not folder_name:
        raise ValueError("Informe o nome da campanha/nicho.")
    _, audios_root_id, videos_root_id = find_work_ids_fn(tok)
    if not videos_root_id:
        raise RuntimeError("Pasta 'Vídeos' não encontrada no OneDrive.")

    tmp_dir = tempfile.mkdtemp(prefix="twod_zip_")
    try:
        grouped_images = {}  # (block_name, folder_label) -> [paths]
        audio_files = []     # (orig_name, lang_code, tmp_path)

        with zipfile.ZipFile(zip_path, "r") as zf:
            infos = [i for i in zf.infolist() if not i.is_dir()]
            clean_items = []
            for i in infos:
                cname = get_clean_zip_filename(i).replace("\\", "/").strip("/")
                if not cname or "__MACOSX" in cname or os.path.basename(cname).startswith("._"):
                    continue
                parts = [p for p in cname.split("/") if p and p not in (".", "..")]
                if not parts:
                    continue
                clean_items.append((i, parts))

            # Se tudo estiver dentro de 1 pasta raiz genérica, descasca a raiz se não for Bloco/Idioma/1. Imagens
            if clean_items and len({p[0] for _, p in clean_items}) == 1:
                first = clean_items[0][1][0]
                if not first.lower().startswith("bloco") and not is_master_images_folder(first) and not identify_language_from_name(first):
                    clean_items = [(i, p[1:] if len(p) > 1 else p) for i, p in clean_items]

            for idx, (info, parts) in enumerate(clean_items):
                filename = parts[-1]
                low = filename.lower()
                safe_tmp = os.path.join(tmp_dir, f"{idx}_{os.path.basename(filename)}")
                with zf.open(info, "r") as src, open(safe_tmp, "wb") as dst:
                    shutil.copyfileobj(src, dst)

                if low.endswith(AUDIO_EXTS):
                    code = identify_language_from_name(filename) or (identify_language_from_name(parts[-2]) if len(parts) >= 2 else None) or "pt"
                    audio_files.append((filename, code, safe_tmp))
                    continue

                if not low.endswith(IMAGE_EXTS) or not is_image_valid_file(safe_tmp):
                    continue

                block_name = ""
                lang_folder = "1. Imagens"
                for seg in parts[:-1]:
                    if normalize_folder_key(seg) in ("blocoa", "blocob"):
                        block_name = "Bloco A" if normalize_folder_key(seg) == "blocoa" else "Bloco B"
                    elif is_master_images_folder(seg):
                        lang_folder = "1. Imagens"
                    else:
                        c = identify_language_from_name(seg)
                        if c:
                            lang_folder = "1. Imagens" if c == "pt" else LANGUAGES_DB[c]["name"]

                # Caso arquivo venha solto na raiz sem subpasta de idioma, tenta detectar pelo próprio nome
                if lang_folder == "1. Imagens" and len(parts) == 1:
                    c_file = identify_language_from_name(filename)
                    if c_file and c_file != "pt":
                        lang_folder = LANGUAGES_DB[c_file]["name"]

                grouped_images.setdefault((block_name, lang_folder), []).append((filename, safe_tmp))

        vid_folder = graph_ensure_folder(videos_root_id, folder_name, tok)
        uploaded_summary = []

        for (block_name, lang_folder), file_tuples in grouped_images.items():
            rel = ([block_name] if block_name else []) + [lang_folder]
            dest_folder = graph_ensure_nested_folder(vid_folder["id"], rel, tok)
            paths = [p for _, p in file_tuples]
            sorted_paths = sort_creatives_by_dims(paths)
            for slot_idx, p in enumerate(sorted_paths, start=1):
                ext = os.path.splitext(p)[1].lower() or ".png"
                out_name = f"{slot_idx}{ext}"
                graph_upload_file(dest_folder["id"], out_name, p, tok)
            uploaded_summary.append({"folder": "/".join(rel), "count": len(sorted_paths)})

        uploaded_audios = []
        if audio_files and audios_root_id:
            aud_folder = graph_ensure_folder(audios_root_id, folder_name, tok)
            niche_slug = extract_clean_niche_slug(folder_name)
            for orig_name, code, p in audio_files:
                ext = os.path.splitext(orig_name)[1].lower() or ".mp3"
                out_name = f"{niche_slug}_{code}{ext}"
                graph_upload_file(aud_folder["id"], out_name, p, tok)
                uploaded_audios.append(out_name)

        return {
            "success": True,
            "campaign_name": folder_name,
            "folders_imported": uploaded_summary,
            "audios_imported": uploaded_audios,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ============================================================
# MOTOR DE RENDERIZAÇÃO EM LOTE FFMPEG -> ONEDRIVE
# ============================================================

STUDIO_RENDER_LOCK = threading.Lock()
STUDIO_PAUSE_EVENT = threading.Event()
STUDIO_PAUSE_EVENT.set()
STUDIO_FFMPEG_HOLDER = [None]
STUDIO_RENDER_STATE = {
    "running": False,
    "paused": False,
    "cancelled": False,
    "status": "idle",  # idle | running | paused | completed | completed_with_errors | cancelled | error
    "progress": 0.0,
    "total_videos": 0,
    "completed_videos": 0,
    "skipped_videos": 0,
    "error_videos": 0,
    "current_label": "",
    "logs": [],
    "failed_items": [],
    "cleaned_folders": [],
    "started_at": None,
    "finished_at": None,
}


def _studio_log(msg):
    ts = time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    with STUDIO_RENDER_LOCK:
        STUDIO_RENDER_STATE["logs"].append(line)
        if len(STUDIO_RENDER_STATE["logs"]) > 250:
            del STUDIO_RENDER_STATE["logs"][:len(STUDIO_RENDER_STATE["logs"]) - 250]


def get_render_status_snapshot():
    with STUDIO_RENDER_LOCK:
        return {
            "success": True,
            "running": STUDIO_RENDER_STATE["running"],
            "paused": STUDIO_RENDER_STATE["paused"],
            "cancelled": STUDIO_RENDER_STATE["cancelled"],
            "status": STUDIO_RENDER_STATE["status"],
            "progress": STUDIO_RENDER_STATE["progress"],
            "total_videos": STUDIO_RENDER_STATE["total_videos"],
            "completed_videos": STUDIO_RENDER_STATE["completed_videos"],
            "skipped_videos": STUDIO_RENDER_STATE["skipped_videos"],
            "error_videos": STUDIO_RENDER_STATE["error_videos"],
            "current_label": STUDIO_RENDER_STATE["current_label"],
            "logs": list(STUDIO_RENDER_STATE["logs"]),
            "failed_items": list(STUDIO_RENDER_STATE["failed_items"]),
            "cleaned_folders": list(STUDIO_RENDER_STATE["cleaned_folders"]),
            "started_at": STUDIO_RENDER_STATE["started_at"],
            "finished_at": STUDIO_RENDER_STATE["finished_at"],
            "ffmpeg_path": FFMPEG_PATH,
        }


def pause_or_resume_render_job():
    with STUDIO_RENDER_LOCK:
        if not STUDIO_RENDER_STATE["running"]:
            return {"success": False, "error": "Nenhuma renderização em andamento."}
        if STUDIO_RENDER_STATE["paused"]:
            STUDIO_RENDER_STATE["paused"] = False
            STUDIO_RENDER_STATE["status"] = "running"
            STUDIO_PAUSE_EVENT.set()
            paused_now = False
        else:
            STUDIO_RENDER_STATE["paused"] = True
            STUDIO_RENDER_STATE["status"] = "paused"
            STUDIO_PAUSE_EVENT.clear()
            paused_now = True
    _studio_log("⏸️ Renderização pausada." if paused_now else "▶️ Renderização retomada.")
    return get_render_status_snapshot()


def cancel_render_job():
    with STUDIO_RENDER_LOCK:
        if not STUDIO_RENDER_STATE["running"]:
            return {"success": False, "error": "Nenhuma renderização em andamento."}
        STUDIO_RENDER_STATE["cancelled"] = True
        STUDIO_RENDER_STATE["paused"] = False
        STUDIO_PAUSE_EVENT.set()
        proc = STUDIO_FFMPEG_HOLDER[0]
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
    _studio_log("⏹️ Cancelamento solicitado pelo usuário — preservando todas as imagens.")
    return get_render_status_snapshot()


def _render_job_worker(campaigns, options, get_tok_fn, find_work_ids_fn, on_finish_fn=None):
    round_dur = bool(options.get("round_duration", True))
    cleanup_translated = bool(options.get("cleanup_translated", True))
    force_overwrite = bool(options.get("force_overwrite", False))
    selected_langs = {str(x).lower() for x in (options.get("languages") or []) if x}

    tmp_root = tempfile.mkdtemp(prefix="twod_render_")
    try:
        tok, err = get_tok_fn()
        if not tok:
            raise RuntimeError(err or "OneDrive não autenticado.")

        jobs = []
        for cname in campaigns:
            audit = _scan_campaign_blocks_and_langs(cname, tok, find_work_ids_fn)
            for blk in audit["blocks"]:
                for lg in blk["languages"]:
                    if selected_langs and lg["lang_code"] not in selected_langs:
                        continue
                    if lg["imgs_count"] == 0:
                        continue
                    if not lg["audio"]:
                        _studio_log(f"⚠️ [{audit['name']} > {blk['block']} > {lg['lang_name']}] Sem áudio correspondente — pulando.")
                        continue
                    jobs.append({
                        "campaign": audit["name"],
                        "block": blk["block"],
                        "block_id": blk["block_id"],
                        **lg,
                    })

        total_videos = sum(len(j["images"]) for j in jobs)
        with STUDIO_RENDER_LOCK:
            STUDIO_RENDER_STATE["total_videos"] = total_videos

        if total_videos == 0:
            _studio_log("⚠️ Nenhum vídeo pendente para renderizar (verifique imagens e áudios nos nichos selecionados).")
            with STUDIO_RENDER_LOCK:
                STUDIO_RENDER_STATE["running"] = False
                STUDIO_RENDER_STATE["status"] = "completed"
                STUDIO_RENDER_STATE["finished_at"] = time.strftime("%H:%M:%S")
            return

        _studio_log(f"🚀 Iniciando renderização: {len(jobs)} conjunto(s) | {total_videos} vídeo(s) no total.")
        processed = 0
        cleanup_candidates = []

        for job in jobs:
            with STUDIO_RENDER_LOCK:
                if STUDIO_RENDER_STATE["cancelled"]:
                    break

            tok, _ = get_tok_fn()
            job_dir = tempfile.mkdtemp(dir=tmp_root, prefix="job_")
            audio_info = job["audio"]
            audio_ext = os.path.splitext(audio_info["name"])[1] or ".mp3"
            local_audio = os.path.join(job_dir, f"audio{audio_ext}")
            graph_download_item(audio_info["id"], local_audio, tok)
            raw_dur = get_audio_duration(local_audio)
            target_dur = int(math.ceil(raw_dur)) if round_dur else round(raw_dur, 2)

            # Garante pasta de destino (para '1. Imagens' PT -> cria/usa 'Português' diretamente na raiz do bloco!)
            dest_folder_id = job["dest_folder_id"]
            if not dest_folder_id:
                dest_obj = graph_ensure_folder(job["block_id"], "Português", tok)
                dest_folder_id = dest_obj["id"]

            existing_mp4_map = {}
            for ch in graph_list_children(dest_folder_id, tok):
                if "file" in ch and ch["name"].lower().endswith(".mp4"):
                    existing_mp4_map[ch["name"].lower()] = int(ch.get("size") or 0)

            _studio_log(f"📂 [{job['campaign']} > {job['block']} > {job['lang_name']}] Áudio: {audio_info['name']} ({raw_dur:.2f}s ➔ {target_dur}s)")

            # Baixa imagens válidas e ordena 1..3 Feed + 4..6 Reels caso nome não seja 1..6
            local_imgs = []
            for im in job["images"]:
                local_im = os.path.join(job_dir, im["name"])
                graph_download_item(im["id"], local_im, tok)
                local_imgs.append({"id": im["id"], "name": im["name"], "local": local_im})

            sorted_local_paths = sort_creatives_by_dims([x["local"] for x in local_imgs])
            by_path = {x["local"]: x for x in local_imgs}
            ordered_imgs = [by_path[p] for p in sorted_local_paths]

            job_had_error = False
            for idx, im_obj in enumerate(ordered_imgs, start=1):
                with STUDIO_RENDER_LOCK:
                    if STUDIO_RENDER_STATE["cancelled"]:
                        break
                    STUDIO_RENDER_STATE["current_label"] = f"{job['campaign']} • {job['block']} • {job['lang_name']} ({idx}.mp4)"

                STUDIO_PAUSE_EVENT.wait()
                with STUDIO_RENDER_LOCK:
                    if STUDIO_RENDER_STATE["cancelled"]:
                        break

                out_name = f"{idx}.mp4"
                processed += 1

                if not force_overwrite and existing_mp4_map.get(out_name.lower(), 0) > 10240:
                    _studio_log(f"   ⏩ [{processed}/{total_videos}] {out_name} já pronto no OneDrive — pulando.")
                    with STUDIO_RENDER_LOCK:
                        STUDIO_RENDER_STATE["skipped_videos"] += 1
                        STUDIO_RENDER_STATE["completed_videos"] += 1
                        STUDIO_RENDER_STATE["progress"] = round(processed / total_videos, 4)
                    continue

                if not is_image_valid_file(im_obj["local"]):
                    job_had_error = True
                    reason = f"Imagem '{im_obj['name']}' corrompida ou truncada (sem fim PNG/JPG)."
                    _studio_log(f"   ❌ [{processed}/{total_videos}] {reason}")
                    with STUDIO_RENDER_LOCK:
                        STUDIO_RENDER_STATE["error_videos"] += 1
                        STUDIO_RENDER_STATE["failed_items"].append({
                            "campaign": job["campaign"],
                            "block": job["block"],
                            "lang_name": job["lang_name"],
                            "lang_code": job["lang_code"],
                            "out_name": out_name,
                            "img_name": im_obj["name"],
                            "reason": reason,
                        })
                        STUDIO_RENDER_STATE["progress"] = round(processed / total_videos, 4)
                    continue

                out_mp4 = os.path.join(job_dir, out_name)
                cmd = [
                    FFMPEG_PATH,
                    "-loop", "1",
                    "-i", im_obj["local"],
                    "-i", local_audio,
                    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-c:v", "libx264",
                    "-tune", "stillimage",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-af", "apad",
                    "-t", str(target_dur),
                    "-pix_fmt", "yuv420p",
                    "-y",
                    out_mp4,
                ]
                rc, stderr = run_ffmpeg(cmd, timeout=150, process_holder=STUDIO_FFMPEG_HOLDER)
                if rc != 0 or not os.path.exists(out_mp4) or os.path.getsize(out_mp4) < 5120:
                    job_had_error = True
                    reason = f"FFmpeg erro em {out_name}: {(stderr or '')[-160:].strip()}"
                    _studio_log(f"   ❌ [{processed}/{total_videos}] {reason}")
                    with STUDIO_RENDER_LOCK:
                        STUDIO_RENDER_STATE["error_videos"] += 1
                        STUDIO_RENDER_STATE["failed_items"].append({
                            "campaign": job["campaign"],
                            "block": job["block"],
                            "lang_name": job["lang_name"],
                            "lang_code": job["lang_code"],
                            "out_name": out_name,
                            "img_name": im_obj["name"],
                            "reason": reason,
                        })
                else:
                    tok, _ = get_tok_fn()
                    graph_upload_file(dest_folder_id, out_name, out_mp4, tok)
                    _studio_log(f"   ✅ [{processed}/{total_videos}] {out_name} renderizado e salvo no OneDrive ({target_dur}s).")
                    with STUDIO_RENDER_LOCK:
                        STUDIO_RENDER_STATE["completed_videos"] += 1

                with STUDIO_RENDER_LOCK:
                    STUDIO_RENDER_STATE["progress"] = round(processed / total_videos, 4)

            # Candidato à limpeza SOMENTE se não for master (1. Imagens / Português) e 0 erros
            is_master_lang = job["is_master"] or job["lang_code"] == "pt" or is_master_images_folder(job["src_folder_name"])
            if is_master_lang:
                _studio_log(f"   🛡️ [{job['lang_name']}] Templates originais em '{job['src_folder_name']}' PRESERVADOS.")
            elif cleanup_translated and not job_had_error:
                cleanup_candidates.append({
                    "label": f"{job['campaign']} > {job['block']} > {job['lang_name']}",
                    "images": job["images"],
                })

        # Limpeza segura somente quando 100% do lote terminou sem cancelamento nem erros
        with STUDIO_RENDER_LOCK:
            was_cancelled = STUDIO_RENDER_STATE["cancelled"]
            err_count = STUDIO_RENDER_STATE["error_videos"]

        if cleanup_translated and not was_cancelled and err_count == 0 and cleanup_candidates:
            tok, _ = get_tok_fn()
            _studio_log("🧹 Limpando imagens brutas de idiomas traduzidos (1. Imagens preservada)...")
            for cand in cleanup_candidates:
                deleted_cnt = 0
                for im in cand["images"]:
                    if graph_delete_item(im["id"], tok):
                        deleted_cnt += 1
                with STUDIO_RENDER_LOCK:
                    STUDIO_RENDER_STATE["cleaned_folders"].append(f"{cand['label']} ({deleted_cnt} img)")
                _studio_log(f"   🗑️ {cand['label']}: {deleted_cnt} imagem(ns) removida(s) após validação dos MP4.")

        final_status = "cancelled" if was_cancelled else ("completed_with_errors" if err_count > 0 else "completed")
        _studio_log(
            "⏹️ Lote cancelado com imagens preservadas."
            if was_cancelled
            else ("⚠️ Lote concluído com pendências — veja os erros acima e reverifique." if err_count > 0 else "🎉 Lote 100% concluído e sincronizado no OneDrive!")
        )
        with STUDIO_RENDER_LOCK:
            STUDIO_RENDER_STATE["running"] = False
            STUDIO_RENDER_STATE["paused"] = False
            STUDIO_RENDER_STATE["status"] = final_status
            STUDIO_RENDER_STATE["current_label"] = ""
            STUDIO_RENDER_STATE["finished_at"] = time.strftime("%H:%M:%S")

        if callable(on_finish_fn):
            try:
                on_finish_fn(campaigns)
            except Exception:
                pass
    except Exception as e:
        _studio_log(f"❌ Erro fatal no lote: {e}")
        with STUDIO_RENDER_LOCK:
            STUDIO_RENDER_STATE["running"] = False
            STUDIO_RENDER_STATE["paused"] = False
            STUDIO_RENDER_STATE["status"] = "error"
            STUDIO_RENDER_STATE["finished_at"] = time.strftime("%H:%M:%S")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def start_render_job_async(campaigns, options, get_tok_fn, find_work_ids_fn, on_finish_fn=None):
    clean_camps = [str(c).strip() for c in (campaigns or []) if str(c).strip()]
    if not clean_camps:
        return {"success": False, "error": "Selecione ao menos 1 nicho/campanha para renderizar."}

    with STUDIO_RENDER_LOCK:
        if STUDIO_RENDER_STATE["running"]:
            return {"success": False, "error": "Já existe uma renderização em andamento."}
        STUDIO_PAUSE_EVENT.set()
        STUDIO_RENDER_STATE.update({
            "running": True,
            "paused": False,
            "cancelled": False,
            "status": "running",
            "progress": 0.0,
            "total_videos": 0,
            "completed_videos": 0,
            "skipped_videos": 0,
            "error_videos": 0,
            "current_label": "Mapeando arquivos no OneDrive...",
            "logs": [f"[{time.strftime('%H:%M:%S')}] 🔍 Preparando auditoria e download de {len(clean_camps)} nicho(s)..."],
            "failed_items": [],
            "cleaned_folders": [],
            "started_at": time.strftime("%H:%M:%S"),
            "finished_at": None,
        })

    threading.Thread(
        target=_render_job_worker,
        args=(clean_camps, dict(options or {}), get_tok_fn, find_work_ids_fn, on_finish_fn),
        daemon=True,
    ).start()
    return get_render_status_snapshot()
