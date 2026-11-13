import os
import json
import time
import uuid
import threading
import mimetypes
import urllib.request
import urllib.parse
import urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs

# Diretório base do dashboard (onde ficam index.html, styles.css, app.js)
DASHBOARD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.dirname(__file__)
ENV_PATH = os.path.join(BACKEND_DIR, ".env")
GRAPH_CACHE_PATH = os.path.join(BACKEND_DIR, ".graph_cache.json")

# Auto-detecta a pasta local do OneDrive de Trabalho (quando rodando no PC do Thiago)
DEFAULT_WORK_DIR = os.path.join(os.path.expanduser("~"), "OneDrive", "Documentos", "Trabalho")
if not os.path.exists(DEFAULT_WORK_DIR):
    DEFAULT_WORK_DIR = r"C:\Users\thiag\OneDrive\Documentos\Trabalho"

PORT = int(os.environ.get("PORT", 8000))

# Caches em memória e sincronização em segundo plano
NICHES_CACHE = None
GRAPH_LOCK = threading.Lock()
GRAPH_SYNC_STATE = {
    "running": False,
    "completed": False,
    "pages_done": 0,
    "items_processed": 0,
    "last_sync": None,
    "last_error": None,
    "audio_delta_link": None,
    "video_delta_link": None,
    "niches_map": {},
}
GRAPH_TOKEN_CACHE = {
    "access_token": None,
    "expires_at": 0
}


# ============================================================
# CONFIGURAÇÕES (.env + variáveis de ambiente da nuvem)
# ============================================================

def load_env_vars():
    """Carrega variáveis do .env e sobrescreve com os.environ (Render/Railway)."""
    data = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    data[k.strip()] = v.strip()

    # Variáveis de ambiente do sistema/nuvem têm prioridade
    keys = [
        "META_ACCESS_TOKEN",
        "DEFAULT_AD_ACCOUNT_ID",
        "PORT",
        "ONEDRIVE_CLIENT_ID",
        "ONEDRIVE_CLIENT_SECRET",
        "ONEDRIVE_REDIRECT_URI",
        "ONEDRIVE_REFRESH_TOKEN",
        "ONEDRIVE_TENANT",
    ]
    for k in keys:
        if k in os.environ and os.environ[k] != "":
            data[k] = os.environ[k]

    return data


def save_env_vars(updates):
    """Atualiza variáveis no .env local e em os.environ."""
    current = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    current[k.strip()] = v.strip()

    for k, v in updates.items():
        if v is not None:
            current[k] = str(v).strip()
            os.environ[k] = str(v).strip()

    try:
        with open(ENV_PATH, "w", encoding="utf-8") as f:
            f.write("# TwoD Hub - Variaveis de Ambiente\n")
            for k, v in current.items():
                f.write(f"{k}={v}\n")
    except Exception as e:
        print(f"⚠️ Aviso ao salvar .env (normal em container somente leitura): {e}")


# ============================================================
# MICROSOFT GRAPH API (ONEDRIVE NUVEM 24/7)
# ============================================================

def _http_form_post(url, form_data):
    body = urllib.parse.urlencode(form_data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        try:
            return json.loads(err_body)
        except Exception:
            return {"error": f"HTTP {e.code}", "error_description": err_body}


def _graph_get(url, access_token, retries=4):
    for attempt in range(retries):
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                retry_after = int(e.headers.get("Retry-After", str(2 ** attempt)))
                time.sleep(min(retry_after, 12))
                continue
            err_body = e.read().decode("utf-8", errors="ignore")
            try:
                return json.loads(err_body)
            except Exception:
                return {"error": {"code": str(e.code), "message": err_body}}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            return {"error": {"code": "network", "message": str(e)}}
    return {"error": {"code": "timeout", "message": "Max retries exceeded"}}


def get_redirect_uri(headers=None):
    cfg = load_env_vars()
    if cfg.get("ONEDRIVE_REDIRECT_URI"):
        return cfg["ONEDRIVE_REDIRECT_URI"]
    if headers and headers.get("Host"):
        host = headers.get("Host")
        proto = headers.get("X-Forwarded-Proto", "http")
        return f"{proto}://{host}/api/onedrive/callback"
    return f"http://localhost:{PORT}/api/onedrive/callback"


def get_graph_auth_url(headers=None):
    cfg = load_env_vars()
    client_id = cfg.get("ONEDRIVE_CLIENT_ID", "").strip()
    tenant = cfg.get("ONEDRIVE_TENANT", "consumers").strip() or "consumers"
    redirect_uri = get_redirect_uri(headers)

    params = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": "Files.ReadWrite.All offline_access User.Read",
        "prompt": "select_account",
    })
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{params}"


def exchange_code_for_token(code, headers=None):
    cfg = load_env_vars()
    client_id = cfg.get("ONEDRIVE_CLIENT_ID", "").strip()
    client_secret = cfg.get("ONEDRIVE_CLIENT_SECRET", "").strip()
    tenant = cfg.get("ONEDRIVE_TENANT", "consumers").strip() or "consumers"
    redirect_uri = get_redirect_uri(headers)

    token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    res = _http_form_post(token_url, {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
        "scope": "Files.ReadWrite.All offline_access User.Read",
    })

    if "access_token" in res:
        GRAPH_TOKEN_CACHE["access_token"] = res["access_token"]
        GRAPH_TOKEN_CACHE["expires_at"] = time.time() + int(res.get("expires_in", 3600)) - 120
        if res.get("refresh_token"):
            save_env_vars({"ONEDRIVE_REFRESH_TOKEN": res["refresh_token"]})
    return res


def get_graph_access_token():
    now = time.time()
    if GRAPH_TOKEN_CACHE["access_token"] and now < GRAPH_TOKEN_CACHE["expires_at"]:
        return GRAPH_TOKEN_CACHE["access_token"], None

    cfg = load_env_vars()
    refresh_token = cfg.get("ONEDRIVE_REFRESH_TOKEN", "").strip()
    client_id = cfg.get("ONEDRIVE_CLIENT_ID", "").strip()
    client_secret = cfg.get("ONEDRIVE_CLIENT_SECRET", "").strip()
    tenant = cfg.get("ONEDRIVE_TENANT", "consumers").strip() or "consumers"

    if not refresh_token or not client_id or not client_secret:
        return None, "OneDrive ainda não autorizado via OAuth2."

    token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    res = _http_form_post(token_url, {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
        "scope": "Files.ReadWrite.All offline_access User.Read",
    })

    if "access_token" in res:
        GRAPH_TOKEN_CACHE["access_token"] = res["access_token"]
        GRAPH_TOKEN_CACHE["expires_at"] = now + int(res.get("expires_in", 3600)) - 120
        if res.get("refresh_token") and res["refresh_token"] != refresh_token:
            save_env_vars({"ONEDRIVE_REFRESH_TOKEN": res["refresh_token"]})
        return res["access_token"], None

    return None, res.get("error_description") or res.get("error") or "Falha ao renovar token."


def _graph_list_all_children(item_id, access_token):
    items = []
    url = f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}/children?$top=999&$select=id,name,size,folder,file"
    while url:
        data = _graph_get(url, access_token)
        if "error" in data:
            break
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
    return items


def _find_work_folder_ids(access_token):
    """Localiza 'Documentos/Trabalho' ou 'Documents/Trabalho' e seus subdiretórios Áudios e Vídeos."""
    candidate_paths = [
        "Documents/Trabalho",
        "Documentos/Trabalho",
        "Trabalho",
    ]
    work_item = None
    for p in candidate_paths:
        encoded = urllib.parse.quote(p)
        res = _graph_get(f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}?$select=id,name,folder", access_token)
        if "id" in res and "error" not in res:
            work_item = res
            break

    if not work_item:
        return None, None, None

    children = _graph_list_all_children(work_item["id"], access_token)
    audios_id = None
    videos_id = None
    for ch in children:
        if "folder" not in ch:
            continue
        cname = ch["name"].strip().lower()
        if cname in ("arquivos de áudio", "arquivos de audio"):
            audios_id = ch["id"]
        elif cname in ("vídeos", "videos"):
            videos_id = ch["id"]

    if not audios_id or not videos_id:
        for ch in children:
            if "folder" not in ch:
                continue
            cname = ch["name"].strip().lower()
            if not audios_id and ("áudio" in cname or "audio" in cname):
                audios_id = ch["id"]
            elif not videos_id and ("vídeo" in cname or "video" in cname):
                videos_id = ch["id"]
    return work_item["id"], audios_id, videos_id


def load_graph_cache_from_disk():
    """Carrega cache persistido do Graph API para resposta instantânea na inicialização."""
    if not os.path.exists(GRAPH_CACHE_PATH):
        return False
    try:
        with open(GRAPH_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and "niches_map" in data:
            with GRAPH_LOCK:
                GRAPH_SYNC_STATE["niches_map"] = data.get("niches_map", {})
                GRAPH_SYNC_STATE["audio_delta_link"] = data.get("audio_delta_link")
                GRAPH_SYNC_STATE["video_delta_link"] = data.get("video_delta_link")
                GRAPH_SYNC_STATE["last_sync"] = data.get("last_sync")
                GRAPH_SYNC_STATE["completed"] = bool(GRAPH_SYNC_STATE["niches_map"])
            return True
    except Exception:
        pass
    return False


def _save_graph_cache_to_disk():
    try:
        with GRAPH_LOCK:
            payload = {
                "niches_map": GRAPH_SYNC_STATE["niches_map"],
                "audio_delta_link": GRAPH_SYNC_STATE["audio_delta_link"],
                "video_delta_link": GRAPH_SYNC_STATE["video_delta_link"],
                "last_sync": GRAPH_SYNC_STATE["last_sync"],
            }
        with open(GRAPH_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except Exception:
        pass


def _recompute_niche_status(niche_obj):
    total = len(niche_obj["videos"]["feed"]) + len(niche_obj["videos"]["reels"])
    if total >= 6:
        niche_obj["status"] = "completed"
    elif total > 0:
        niche_obj["status"] = "partial"
    else:
        niche_obj["status"] = "pending"


def _apply_delta_item(item, root_kind):
    """Interpreta cada item retornado pelo endpoint /delta da Microsoft Graph API."""
    if "deleted" in item:
        return

    parent_path = urllib.parse.unquote(item.get("parentReference", {}).get("path", "") or "")
    name = item.get("name", "")
    item_id = item.get("id", "")
    is_folder = "folder" in item
    is_file = "file" in item

    marker = "/Arquivos de Áudio" if root_kind == "audio" else "/Vídeos"
    idx = parent_path.find(marker)
    if idx == -1:
        return

    after = parent_path[idx + len(marker):].strip("/")
    rel_parts = [p for p in after.split("/") if p]

    # Pasta raiz (Arquivos de Áudio ou Vídeos) -> ignora
    if len(rel_parts) == 0 and name in ("Arquivos de Áudio", "Vídeos"):
        return

    # Pasta de nicho diretamente na raiz (ex: rel_parts == [], is_folder == True)
    if len(rel_parts) == 0 and is_folder:
        niche_name = name
    elif len(rel_parts) >= 1:
        niche_name = rel_parts[0]
    else:
        return

    niches_map = GRAPH_SYNC_STATE["niches_map"]
    if niche_name not in niches_map:
        niches_map[niche_name] = {
            "name": niche_name,
            "audios": [],
            "videos": {"feed": [], "reels": []},
            "status": "pending",
            "source": "graph",
        }

    niche = niches_map[niche_name]

    if root_kind == "audio" and is_file and name.lower().endswith((".mp3", ".wav", ".m4a", ".aac")):
        lang = "PT"
        parts = name.split("_")
        if len(parts) > 1:
            lang = parts[-1].split(".")[0].upper()

        entry = {
            "id": item_id,
            "name": name,
            "lang": lang,
            "size": item.get("size", 0),
            "url": f"/api/graph/file/{item_id}/{urllib.parse.quote(name)}",
        }
        # Atualiza ou adiciona evitando duplicados
        niche["audios"] = [a for a in niche["audios"] if a.get("id") != item_id]
        niche["audios"].append(entry)

    elif root_kind == "video" and is_file and name.lower().endswith(".mp4"):
        num = int(name[0]) if name and name[0].isdigit() else 0
        lang_folder = rel_parts[-1] if len(rel_parts) >= 2 else ""
        item_data = {
            "id": item_id,
            "name": name,
            "num": num,
            "lang": lang_folder,
            "size": item.get("size", 0),
            "url": f"/api/graph/file/{item_id}/{urllib.parse.quote(name)}",
        }
        if 1 <= num <= 3:
            niche["videos"]["feed"] = [v for v in niche["videos"]["feed"] if v.get("id") != item_id]
            niche["videos"]["feed"].append(item_data)
        elif 4 <= num <= 6:
            niche["videos"]["reels"] = [v for v in niche["videos"]["reels"] if v.get("id") != item_id]
            niche["videos"]["reels"].append(item_data)

    _recompute_niche_status(niche)


def _sync_graph_delta_worker(force_full=False):
    """Sincroniza áudios e vídeos usando /delta em lote em segundo plano (sem timeout)."""
    try:
        tok, err = get_graph_access_token()
        if not tok:
            with GRAPH_LOCK:
                GRAPH_SYNC_STATE["last_error"] = err
                GRAPH_SYNC_STATE["running"] = False
            return

        work_id, audios_id, videos_id = _find_work_folder_ids(tok)
        if not work_id:
            with GRAPH_LOCK:
                GRAPH_SYNC_STATE["last_error"] = "Pasta Trabalho não encontrada no OneDrive"
                GRAPH_SYNC_STATE["running"] = False
            return

        if force_full:
            with GRAPH_LOCK:
                GRAPH_SYNC_STATE["niches_map"] = {}
                GRAPH_SYNC_STATE["audio_delta_link"] = None
                GRAPH_SYNC_STATE["video_delta_link"] = None
                GRAPH_SYNC_STATE["pages_done"] = 0
                GRAPH_SYNC_STATE["items_processed"] = 0

        for kind, folder_id, delta_key in [
            ("audio", audios_id, "audio_delta_link"),
            ("video", videos_id, "video_delta_link"),
        ]:
            if not folder_id:
                continue

            with GRAPH_LOCK:
                url = GRAPH_SYNC_STATE.get(delta_key) or f"https://graph.microsoft.com/v1.0/me/drive/items/{folder_id}/delta"

            while url:
                tok, _ = get_graph_access_token()
                data = _graph_get(url, tok)
                if "error" in data:
                    with GRAPH_LOCK:
                        GRAPH_SYNC_STATE["last_error"] = data["error"].get("message", str(data["error"]))
                    break

                vals = data.get("value", [])
                with GRAPH_LOCK:
                    for item in vals:
                        _apply_delta_item(item, kind)
                    GRAPH_SYNC_STATE["pages_done"] += 1
                    GRAPH_SYNC_STATE["items_processed"] += len(vals)
                    pages = GRAPH_SYNC_STATE["pages_done"]

                if pages % 10 == 0:
                    _save_graph_cache_to_disk()

                next_link = data.get("@odata.nextLink")
                delta_link = data.get("@odata.deltaLink")
                if next_link:
                    url = next_link
                else:
                    if delta_link:
                        with GRAPH_LOCK:
                            GRAPH_SYNC_STATE[delta_key] = delta_link
                    url = None

        with GRAPH_LOCK:
            GRAPH_SYNC_STATE["completed"] = True
            GRAPH_SYNC_STATE["last_sync"] = int(time.time())
            GRAPH_SYNC_STATE["last_error"] = None
        _save_graph_cache_to_disk()
    except Exception as ex:
        with GRAPH_LOCK:
            GRAPH_SYNC_STATE["last_error"] = str(ex)
    finally:
        with GRAPH_LOCK:
            GRAPH_SYNC_STATE["running"] = False


def start_graph_sync_background(force_full=False):
    with GRAPH_LOCK:
        if GRAPH_SYNC_STATE["running"]:
            return False
        GRAPH_SYNC_STATE["running"] = True
        GRAPH_SYNC_STATE["last_error"] = None
    t = threading.Thread(target=_sync_graph_delta_worker, args=(force_full,), daemon=True)
    t.start()
    return True


def get_graph_niches_snapshot(trigger_sync=False, force_full=False):
    """Retorna imediatamente os nichos sincronizados até agora sem bloquear HTTP."""
    with GRAPH_LOCK:
        is_empty = len(GRAPH_SYNC_STATE["niches_map"]) == 0
        running = GRAPH_SYNC_STATE["running"]

    if (trigger_sync or is_empty) and not running:
        start_graph_sync_background(force_full=force_full)

    with GRAPH_LOCK:
        sorted_niches = sorted(list(GRAPH_SYNC_STATE["niches_map"].values()), key=lambda x: x["name"])
        return sorted_niches, {
            "hydrating": GRAPH_SYNC_STATE["running"],
            "completed": GRAPH_SYNC_STATE["completed"],
            "pages_done": GRAPH_SYNC_STATE["pages_done"],
            "items_processed": GRAPH_SYNC_STATE["items_processed"],
            "last_error": GRAPH_SYNC_STATE["last_error"],
        }


# ============================================================
# SCANNER LOCAL DO ONEDRIVE (QUANDO NO PC DO THIAGO)
# ============================================================

def scan_onedrive_folders(base_path=DEFAULT_WORK_DIR, force_reload=False):
    """Varre as pastas de Áudios e Vídeos no disco local com cache em memória."""
    global NICHES_CACHE
    if NICHES_CACHE is not None and not force_reload:
        return NICHES_CACHE

    audios_dir = os.path.join(base_path, "Arquivos de Áudio")
    videos_dir = os.path.join(base_path, "Vídeos")

    niches = {}

    def get_or_create(niche_name):
        if niche_name not in niches:
            niches[niche_name] = {
                "name": niche_name,
                "audios": [],
                "videos": {"feed": [], "reels": []},
                "status": "pending",
                "source": "local",
            }
        return niches[niche_name]

    if os.path.exists(audios_dir):
        for entry in os.scandir(audios_dir):
            if entry.is_dir():
                niche = get_or_create(entry.name)
                for f in os.scandir(entry.path):
                    if f.is_file() and f.name.lower().endswith((".mp3", ".wav", ".m4a", ".aac")):
                        lang = "PT"
                        parts = f.name.split("_")
                        if len(parts) > 1:
                            lang = parts[-1].split(".")[0].upper()

                        niche["audios"].append({
                            "name": f.name,
                            "lang": lang,
                            "size": f.stat().st_size,
                            "url": f"/api/audio/{entry.name}/{f.name}",
                        })

    if os.path.exists(videos_dir):
        for entry in os.scandir(videos_dir):
            if entry.is_dir():
                niche = get_or_create(entry.name)
                for lang_dir in os.scandir(entry.path):
                    if lang_dir.is_dir():
                        for vf in os.scandir(lang_dir.path):
                            if vf.is_file() and vf.name.lower().endswith(".mp4"):
                                num = int(vf.name[0]) if vf.name[0].isdigit() else 0
                                item_data = {
                                    "name": vf.name,
                                    "num": num,
                                    "lang": lang_dir.name,
                                    "size": vf.stat().st_size,
                                    "url": f"/api/video/{entry.name}/{lang_dir.name}/{vf.name}",
                                }
                                if 1 <= num <= 3:
                                    niche["videos"]["feed"].append(item_data)
                                elif 4 <= num <= 6:
                                    niche["videos"]["reels"].append(item_data)

    for n in niches.values():
        total = len(n["videos"]["feed"]) + len(n["videos"]["reels"])
        if total >= 6:
            n["status"] = "completed"
        elif total > 0:
            n["status"] = "partial"
        else:
            n["status"] = "pending"

    sorted_niches = sorted(list(niches.values()), key=lambda x: x["name"])
    NICHES_CACHE = sorted_niches
    return NICHES_CACHE


# ============================================================
# HTTP HANDLER DA API & DASHBOARD
# ============================================================

class APIHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))

    def _send_html(self, html, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def _serve_file(self, filepath):
        if not os.path.isfile(filepath):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Arquivo nao encontrado.")
            return

        mime_type, _ = mimetypes.guess_type(filepath)
        if not mime_type:
            mime_type = "application/octet-stream"

        file_size = os.path.getsize(filepath)
        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(filepath, "rb") as f:
            while chunk := f.read(64 * 1024):
                self.wfile.write(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        # --------------------------------------------------------
        # 1. STATUS GERAL DO BACKEND
        # --------------------------------------------------------
        if path == "/api/status":
            cfg = load_env_vars()
            local_exists = os.path.exists(DEFAULT_WORK_DIR)
            graph_configured = bool(cfg.get("ONEDRIVE_CLIENT_ID") and cfg.get("ONEDRIVE_CLIENT_SECRET"))
            graph_connected = bool(cfg.get("ONEDRIVE_REFRESH_TOKEN"))

            with GRAPH_LOCK:
                graph_count = len(GRAPH_SYNC_STATE["niches_map"])
                hydrating = GRAPH_SYNC_STATE["running"]
                graph_completed = GRAPH_SYNC_STATE["completed"]

            self._send_json({
                "status": "online",
                "backend": "Python 3.11 (Cloud & Local Ready)",
                "onedrive_path": DEFAULT_WORK_DIR,
                "local_onedrive_accessible": local_exists,
                "graph_configured": graph_configured,
                "graph_connected": graph_connected,
                "onedrive_accessible": local_exists or graph_connected,
                "mode": "graph_cloud" if graph_connected else ("local_folder" if local_exists else "disconnected"),
                "cached_local": NICHES_CACHE is not None,
                "cached_graph": graph_count > 0,
                "graph_count": graph_count,
                "hydrating": hydrating,
                "graph_completed": graph_completed,
            })

        # --------------------------------------------------------
        # 2. FLUXO OAUTH2 DO ONEDRIVE (MICROSOFT GRAPH API)
        # --------------------------------------------------------
        elif path == "/api/onedrive/auth":
            cfg = load_env_vars()
            if not cfg.get("ONEDRIVE_CLIENT_ID") or not cfg.get("ONEDRIVE_CLIENT_SECRET"):
                self._send_json({"success": False, "error": "ONEDRIVE_CLIENT_ID ou SECRET não configurados."}, 400)
                return

            auth_url = get_graph_auth_url(self.headers)
            if qs.get("mode", [""])[0] == "json":
                self._send_json({"success": True, "auth_url": auth_url})
            else:
                self.send_response(302)
                self.send_header("Location", auth_url)
                self.end_headers()

        elif path == "/api/onedrive/callback":
            if "error" in qs:
                err = qs.get("error", ["Erro"])[0]
                desc = qs.get("error_description", [""])[0]
                self._send_html(f"""
                <html><body style="font-family:sans-serif;background:#0b0f19;color:#fff;padding:40px;">
                    <h2>❌ Falha na Autorização Microsoft</h2>
                    <p><strong>{err}</strong>: {desc}</p>
                    <a href="/" style="color:#60a5fa;">Voltar ao TwoD Hub</a>
                </body></html>
                """, 400)
                return

            code = qs.get("code", [""])[0]
            if not code:
                self._send_json({"success": False, "error": "Parâmetro 'code' ausente."}, 400)
                return

            token_res = exchange_code_for_token(code, self.headers)
            if "access_token" not in token_res:
                self._send_html(f"""
                <html><body style="font-family:sans-serif;background:#0b0f19;color:#fff;padding:40px;">
                    <h2>❌ Erro ao trocar código por token</h2>
                    <pre>{json.dumps(token_res, indent=2, ensure_ascii=False)}</pre>
                    <a href="/" style="color:#60a5fa;">Voltar ao TwoD Hub</a>
                </body></html>
                """, 400)
                return

            me = _graph_get("https://graph.microsoft.com/v1.0/me", token_res["access_token"])
            user_name = me.get("displayName", "Conta Microsoft")
            user_email = me.get("userPrincipalName") or me.get("mail") or ""
            refresh_tok = token_res.get("refresh_token", "")
            start_graph_sync_background(force_full=False)

            self._send_html(f"""
            <html>
            <head><meta charset="utf-8"><title>OneDrive Conectado — TwoD Hub</title></head>
            <body style="font-family:system-ui,sans-serif;background:#0b0f19;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;">
                <div style="background:#131b2e;border:1px solid #1e293b;border-radius:16px;padding:32px;max-width:560px;width:100%;">
                    <h2 style="color:#10b981;margin-top:0;">✅ OneDrive Conectado com Sucesso!</h2>
                    <p>Conta autorizada: <strong>{user_name}</strong> ({user_email})</p>
                    <p style="color:#94a3b8;font-size:14px;">O <code>Refresh Token</code> já foi salvo com segurança no seu <code>.env</code> local para acesso 24/7 via Microsoft Graph API.</p>
                    <details style="margin:16px 0;background:#0b0f19;padding:12px;border-radius:8px;border:1px solid #334155;">
                        <summary style="cursor:pointer;color:#60a5fa;font-size:13px;">🔑 Ver Refresh Token (para configurar no Render/Railway depois)</summary>
                        <textarea readonly style="width:100%;height:90px;margin-top:10px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px;font-size:11px;font-family:monospace;">{refresh_tok}</textarea>
                    </details>
                    <a href="/" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;margin-top:8px;">🚀 Voltar para o TwoD Hub</a>
                </div>
            </body>
            </html>
            """)

        elif path == "/api/onedrive/graph-status":
            tok, err = get_graph_access_token()
            if not tok:
                self._send_json({"connected": False, "error": err}, 200)
                return

            me = _graph_get("https://graph.microsoft.com/v1.0/me", tok)
            drive = _graph_get("https://graph.microsoft.com/v1.0/me/drive", tok)
            work_id, audios_id, videos_id = _find_work_folder_ids(tok)
            self._send_json({
                "connected": "error" not in me,
                "user": {
                    "name": me.get("displayName"),
                    "email": me.get("userPrincipalName") or me.get("mail"),
                    "id": me.get("id"),
                },
                "drive_type": drive.get("driveType"),
                "quota": drive.get("quota"),
                "folders_found": {
                    "trabalho_id": work_id,
                    "audios_id": audios_id,
                    "videos_id": videos_id,
                },
            })

        # --------------------------------------------------------
        # 3. LISTAGEM DE NICHOS (NUVEM GRAPH API OU DISCO LOCAL)
        # --------------------------------------------------------
        elif path == "/api/onedrive/niches":
            try:
                reload_force = qs.get("reload", ["false"])[0] == "true"
                source_pref = qs.get("source", ["auto"])[0]
                cfg = load_env_vars()
                has_graph = bool(cfg.get("ONEDRIVE_REFRESH_TOKEN"))
                has_local = os.path.exists(DEFAULT_WORK_DIR)

                use_graph = (source_pref == "graph") or (has_graph and not has_local)

                if use_graph:
                    niches, sync_meta = get_graph_niches_snapshot(trigger_sync=reload_force, force_full=reload_force)
                    self._send_json({
                        "success": True,
                        "source": "graph",
                        "count": len(niches),
                        "hydrating": sync_meta["hydrating"],
                        "completed": sync_meta["completed"],
                        "pages_done": sync_meta["pages_done"],
                        "last_error": sync_meta["last_error"],
                        "niches": niches,
                    })
                else:
                    niches = scan_onedrive_folders(DEFAULT_WORK_DIR, force_reload=reload_force)
                    self._send_json({
                        "success": True,
                        "source": "local",
                        "count": len(niches),
                        "hydrating": False,
                        "completed": True,
                        "niches": niches,
                    })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        # --------------------------------------------------------
        # 4. STREAM / DOWNLOAD DIRETO VIA MICROSOFT GRAPH CDN
        # --------------------------------------------------------
        elif path.startswith("/api/graph/file/"):
            parts = path.replace("/api/graph/file/", "").split("/")
            item_id = parts[0] if parts else ""
            if not item_id:
                self._send_json({"error": "ID do item inválido"}, 400)
                return

            tok, err = get_graph_access_token()
            if not tok:
                self._send_json({"error": err or "Não autenticado"}, 401)
                return

            meta = _graph_get(f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}", tok)
            dl_url = meta.get("@microsoft.graph.downloadUrl") or meta.get("@content.downloadUrl")
            if not dl_url:
                self._send_json({"error": "URL de download indisponível", "detail": meta}, 404)
                return

            if qs.get("format", [""])[0] == "json":
                self._send_json({
                    "success": True,
                    "id": item_id,
                    "name": meta.get("name", ""),
                    "download_url": dl_url,
                })
                return

            self.send_response(302)
            self.send_header("Location", dl_url)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

        # --------------------------------------------------------
        # 5. CONFIG META & ARQUIVOS LOCAIS
        # --------------------------------------------------------
        elif path == "/api/meta/config":
            env_vars = load_env_vars()
            self._send_json({
                "success": True,
                "meta_access_token": env_vars.get("META_ACCESS_TOKEN", ""),
                "default_account_id": env_vars.get("DEFAULT_AD_ACCOUNT_ID", "act_522793227047438"),
            })

        elif path.startswith("/api/audio/"):
            parts = path.replace("/api/audio/", "").split("/")
            if len(parts) >= 2:
                niche_name = parts[0]
                file_name = "/".join(parts[1:])
                filepath = os.path.join(DEFAULT_WORK_DIR, "Arquivos de Áudio", niche_name, file_name)
                self._serve_file(filepath)
            else:
                self._send_json({"error": "Caminho de áudio inválido"}, 400)

        elif path.startswith("/api/video/"):
            parts = path.replace("/api/video/", "").split("/")
            if len(parts) >= 3:
                niche_name = parts[0]
                lang_name = parts[1]
                file_name = "/".join(parts[2:])
                filepath = os.path.join(DEFAULT_WORK_DIR, "Vídeos", niche_name, lang_name, file_name)
                self._serve_file(filepath)
            else:
                self._send_json({"error": "Caminho de vídeo inválido"}, 400)

        # --------------------------------------------------------
        # 6. FRONTEND DA DASHBOARD
        # --------------------------------------------------------
        elif path == "/" or path == "/index.html":
            self._serve_file(os.path.join(DASHBOARD_DIR, "index.html"))

        elif path in ["/styles.css", "/app.js", "/campaign_builder.js", "/README.md"]:
            self._serve_file(os.path.join(DASHBOARD_DIR, path.lstrip("/")))

        else:
            self._send_json({"error": "Rota não encontrada"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/api/meta/config":
            try:
                content_len = int(self.headers.get("Content-Length", 0))
                post_body = self.rfile.read(content_len).decode("utf-8")
                payload = json.loads(post_body) if post_body else {}
                updates = {}
                if "meta_access_token" in payload:
                    updates["META_ACCESS_TOKEN"] = payload["meta_access_token"]
                if "default_account_id" in payload:
                    updates["DEFAULT_AD_ACCOUNT_ID"] = payload["default_account_id"]

                save_env_vars(updates)
                self._send_json({"success": True, "message": "Configurações salvas no .env"})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/meta/upload-video":
            try:
                content_len = int(self.headers.get("Content-Length", 0))
                post_body = self.rfile.read(content_len).decode("utf-8")
                payload = json.loads(post_body) if post_body else {}

                account_id = payload.get("account_id", "").strip()
                access_token = payload.get("access_token", "").strip()
                title = payload.get("title", "criativo.mp4").strip()
                local_path_rel = payload.get("local_url", "").strip()
                graph_item_id = payload.get("graph_item_id", "").strip()
                graph_version = payload.get("graph_version", "v21.0").strip()

                if not account_id or not access_token:
                    self._send_json({"success": False, "error": "account_id e access_token obrigatórios"}, 400)
                    return

                video_bytes = None
                filename = os.path.basename(local_path_rel) if local_path_rel else (title if title.endswith(".mp4") else f"{title}.mp4")

                if local_path_rel.startswith("/api/video/"):
                    parts = unquote(local_path_rel.replace("/api/video/", "")).split("/")
                    if len(parts) >= 3:
                        filepath = os.path.join(DEFAULT_WORK_DIR, "Vídeos", parts[0], parts[1], "/".join(parts[2:]))
                        if os.path.isfile(filepath):
                            with open(filepath, "rb") as vf:
                                video_bytes = vf.read()
                elif graph_item_id:
                    tok, err = get_graph_access_token()
                    if not tok:
                        self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                        return
                    meta = _graph_get(f"https://graph.microsoft.com/v1.0/me/drive/items/{graph_item_id}", tok)
                    dl_url = meta.get("@microsoft.graph.downloadUrl") or meta.get("@content.downloadUrl")
                    if dl_url:
                        with urllib.request.urlopen(dl_url, timeout=120) as vr:
                            video_bytes = vr.read()

                if not video_bytes:
                    self._send_json({"success": False, "error": "Arquivo de vídeo não encontrado para upload"}, 404)
                    return

                boundary = "----TwoDHubBoundary" + uuid.uuid4().hex
                parts_bin = []
                for field_name, field_val in [("access_token", access_token), ("title", title)]:
                    parts_bin.append(
                        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field_name}\"\r\n\r\n{field_val}\r\n".encode("utf-8")
                    )
                parts_bin.append(
                    f"--{boundary}\r\nContent-Disposition: form-data; name=\"source\"; filename=\"{filename}\"\r\nContent-Type: video/mp4\r\n\r\n".encode("utf-8")
                )
                parts_bin.append(video_bytes)
                parts_bin.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
                body = b"".join(parts_bin)

                upload_url = f"https://graph-video.facebook.com/{graph_version}/{account_id}/advideos"
                req = urllib.request.Request(
                    upload_url,
                    data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=180) as resp:
                        res_json = json.loads(resp.read().decode("utf-8"))
                        self._send_json({"success": True, "result": res_json})
                except urllib.error.HTTPError as he:
                    err_txt = he.read().decode("utf-8", errors="ignore")
                    self._send_json({"success": False, "error": err_txt}, he.code)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/translate":
            try:
                content_len = int(self.headers.get("Content-Length", 0))
                post_body = self.rfile.read(content_len).decode("utf-8")
                payload = json.loads(post_body) if post_body else {}

                texts = payload.get("texts", [])
                target_lang = (payload.get("target_lang") or "es").strip()
                source_lang = (payload.get("source_lang") or "pt").strip()

                tl_map = {"iw": "he", "tl": "fil"}
                tl_code = tl_map.get(target_lang, target_lang)

                translated = []
                for txt in texts:
                    if not txt or not isinstance(txt, str):
                        translated.append(txt)
                        continue
                    stripped = txt.strip()
                    if tl_code.lower() == source_lang.lower() or not any(c.isalpha() for c in stripped):
                        translated.append(txt)
                        continue
                    try:
                        q_url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode({
                            "client": "gtx",
                            "sl": source_lang,
                            "tl": tl_code,
                            "dt": "t",
                            "q": txt,
                        })
                        req = urllib.request.Request(q_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=10) as resp:
                            raw = json.loads(resp.read().decode("utf-8"))
                            joined = "".join(seg[0] for seg in raw[0] if seg and seg[0])
                            if stripped == stripped.upper() and any(c.isalpha() for c in stripped):
                                joined = joined.upper()
                            translated.append(joined)
                    except Exception:
                        translated.append(txt)

                self._send_json({"success": True, "target_lang": target_lang, "translations": translated})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)
        else:
            self._send_json({"error": "Rota não encontrada"}, 404)


def run():
    load_graph_cache_from_disk()
    cfg = load_env_vars()
    if cfg.get("ONEDRIVE_REFRESH_TOKEN"):
        start_graph_sync_background(force_full=False)

    host = "0.0.0.0" if (os.environ.get("RENDER") or os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PORT")) else "127.0.0.1"
    server_address = (host, PORT)
    httpd = ThreadingHTTPServer(server_address, APIHandler)
    print(f"🚀 TwoD Hub Dashboard & Cloud API rodando em http://{host}:{PORT}")
    print(f"📁 Diretório local de referência: {DEFAULT_WORK_DIR}")
    httpd.serve_forever()


if __name__ == "__main__":
    run()
