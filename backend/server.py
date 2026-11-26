import os
import re
import hmac
import json
import time
import uuid
import base64
import hashlib
import secrets
import shutil
import tempfile
import threading
import mimetypes
import urllib.request
import urllib.parse
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote, parse_qs

try:
    import studio_engine
    import cloudflare_image
except ImportError:
    from backend import studio_engine
    from backend import cloudflare_image

# Diretório base do dashboard (onde ficam index.html, styles.css, app.js)
DASHBOARD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.dirname(__file__)
ENV_PATH = os.path.join(BACKEND_DIR, ".env")
GRAPH_CACHE_PATH = os.path.join(BACKEND_DIR, ".graph_cache.json")
CAMPAIGN_CREATIVES_PATH = os.path.join(BACKEND_DIR, ".campaign_creatives.json")
USERS_PATH = os.path.join(BACKEND_DIR, ".users.json")
META_HEALTH_AUDIT_PATH = os.path.join(BACKEND_DIR, ".meta_health_audit.json")

# Auto-detecta a pasta local do OneDrive de Trabalho (quando rodando no PC do Thiago)
DEFAULT_WORK_DIR = os.path.join(os.path.expanduser("~"), "OneDrive", "Documentos", "Trabalho")
if not os.path.exists(DEFAULT_WORK_DIR):
    DEFAULT_WORK_DIR = r"C:\Users\thiag\OneDrive\Documentos\Trabalho"

PORT = int(os.environ.get("PORT", 8000))

# Controle de autenticação, usuários e sessões
USERS_LOCK = threading.Lock()
USERS_MEM = None
_USERS_ONEDRIVE_SYNCED = False
_USERS_SYNC_LOCK = threading.Lock()
_USERS_BOOT_EVENT = threading.Event()
_USERS_REMOTE_COOLDOWN_UNTIL = 0.0
_USERS_LAST_REFRESH_AT = 0.0
_USERS_LOCAL_MUTATED_AT = 0.0
_USERS_BG_REFRESHING = False
_SESSION_SECRET_CACHE = None
_LOGIN_FAILURES = {}
SESSION_TTL_SECONDS = 7 * 24 * 3600
ONEDRIVE_USERS_REMOTE_PATH = ".twod_hub/users.json"
ONEDRIVE_HEALTH_AUDIT_REMOTE_PATH = ".twod_hub/meta_health_audit.json"

# Proteção anti-rajada (Circuit Breaker + Throttle) & telemetria da Meta Graph API
META_GUARD_LOCK = threading.Lock()
META_HEALTH_AUDIT_LOCK = threading.Lock()
META_HEALTH_AUDIT_MEM = None
META_RATE_LIMIT_CODES = {4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009}
META_GUARD_STATE = {
    "circuit_open_until": 0.0,
    "circuit_reason": "",
    "circuit_code": None,
    "throttle_delay_ms": 0,
    "last_usage": {
        "call_count": 0,
        "total_cputime": 0,
        "total_time": 0,
        "acc_util_pct": 0,
        "estimated_time_to_regain_access": 0,
        "max_pct": 0,
        "updated_at": 0.0,
        "source": "",
    },
    "recent_errors": [],
    "dev_mode_blocked": False,
    "token_blocked": False,
    "token_blocked_reason": "",
    "last_ok_at": 0.0,
}

# Caches em memória e sincronização em segundo plano
NICHES_CACHE = None
GRAPH_LOCK = threading.Lock()
GRAPH_TOKEN_LOCK = threading.Lock()
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
        "GEMINI_API_KEY",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
        "DEFAULT_AD_ACCOUNT_ID",
        "PORT",
        "ONEDRIVE_CLIENT_ID",
        "ONEDRIVE_CLIENT_SECRET",
        "ONEDRIVE_REDIRECT_URI",
        "ONEDRIVE_REFRESH_TOKEN",
        "ONEDRIVE_TENANT",
        "HUB_SESSION_SECRET",
        "HUB_INITIAL_PASSWORD",
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
# AUTENTICAÇÃO, SESSÕES HMAC & PERSISTÊNCIA DE USUÁRIOS
# ============================================================

def get_session_secret():
    """Obtém segredo HMAC persistente para tokens de sessão."""
    global _SESSION_SECRET_CACHE
    if _SESSION_SECRET_CACHE:
        return _SESSION_SECRET_CACHE

    cfg = load_env_vars()
    explicit = cfg.get("HUB_SESSION_SECRET", "").strip()
    if explicit:
        _SESSION_SECRET_CACHE = explicit
        return _SESSION_SECRET_CACHE

    # Em nuvem sem HUB_SESSION_SECRET explícito, deriva de ONEDRIVE_CLIENT_SECRET para sobreviver a reinícios
    od_secret = cfg.get("ONEDRIVE_CLIENT_SECRET", "").strip()
    if od_secret:
        _SESSION_SECRET_CACHE = hmac.new(
            od_secret.encode("utf-8"),
            b"twod-hub-session-key-v1",
            hashlib.sha256,
        ).hexdigest()
        return _SESSION_SECRET_CACHE

    generated = secrets.token_hex(32)
    save_env_vars({"HUB_SESSION_SECRET": generated})
    _SESSION_SECRET_CACHE = generated
    return _SESSION_SECRET_CACHE


def _b64url_encode(raw_bytes):
    return base64.urlsafe_b64encode(raw_bytes).rstrip(b"=").decode("ascii")


def _b64url_decode(raw_str):
    pad = "=" * ((4 - len(raw_str) % 4) % 4)
    return base64.urlsafe_b64decode((raw_str + pad).encode("ascii"))


def create_signed_token(payload_dict, ttl_seconds=SESSION_TTL_SECONDS):
    now = int(time.time())
    body = dict(payload_dict)
    body["iat"] = now
    body["exp"] = now + int(ttl_seconds)
    encoded = _b64url_encode(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    sig = hmac.new(get_session_secret().encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64url_encode(sig)}"


def verify_signed_token(token_str):
    if not token_str or "." not in token_str:
        return None
    try:
        encoded, sig_b64 = token_str.split(".", 1)
        expected_sig = hmac.new(get_session_secret().encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
        provided_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, provided_sig):
            return None
        payload = json.loads(_b64url_decode(encoded).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def hash_password(password, salt=None):
    if not salt:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000).hex()
    return salt, dk


def verify_password(password, salt, expected_hash):
    if not password or not salt or not expected_hash:
        return False
    _, dk = hash_password(password, salt)
    return hmac.compare_digest(dk, expected_hash)


def safe_user_dict(user):
    return {
        "id": user.get("id", ""),
        "username": user.get("username", ""),
        "name": user.get("name", ""),
        "role": user.get("role", "Operador"),
        "themeMode": user.get("themeMode", "dark"),
        "scheduleStart": user.get("scheduleStart", "06:00"),
        "scheduleEnd": user.get("scheduleEnd", "18:00"),
        "lastLogin": user.get("lastLogin", "Nunca"),
        "must_change_password": bool(user.get("must_change_password", False)),
    }


def _build_default_users():
    cfg = load_env_vars()
    initial_pwd = cfg.get("HUB_INITIAL_PASSWORD", "").strip() or "123456"
    seeds = [
        ("usr_thiago", "thiago", "Thiago", "Administrador", "dark", "06:00", "18:00"),
        ("usr_alexandre", "alexandre", "Alexandre", "Operador", "dark", "06:00", "18:00"),
        ("usr_wesley", "wesley", "Wesley", "Operador", "auto", "07:00", "19:00"),
    ]
    out = []
    for uid, uname, name, role, theme, s_start, s_end in seeds:
        salt, h = hash_password(initial_pwd)
        out.append({
            "id": uid,
            "username": uname,
            "name": name,
            "role": role,
            "salt": salt,
            "password_hash": h,
            "must_change_password": True,
            "pwd_version": 1,
            "themeMode": theme,
            "scheduleStart": s_start,
            "scheduleEnd": s_end,
            "lastLogin": "Nunca",
        })
    return {"users": out}


def _load_users_from_onedrive(max_attempts=1, timeout=6):
    """Retorna ('found', data), ('not_found', None) ou ('error', msg) sem jamais confundir erro transitório com 404."""
    encoded = urllib.parse.quote(ONEDRIVE_USERS_REMOTE_PATH)
    # Busca @microsoft.graph.downloadUrl para evitar 302 do :/content repassando Authorization ao CDN 1drv.com (HTTP 401)
    meta_url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}?select=id,name,@microsoft.graph.downloadUrl,@content.downloadUrl"
    last_err = None
    refreshed_on_401 = False
    attempts_left = max(1, int(max_attempts))

    attempt_idx = 0
    while attempts_left > 0:
        attempts_left -= 1
        attempt_idx += 1
        tok, err = get_graph_access_token()
        if not tok:
            return "error", err or "OneDrive não autenticado"
        req = urllib.request.Request(meta_url, headers={"Authorization": f"Bearer {tok}"}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                meta = json.loads(resp.read().decode("utf-8"))
            dl_url = meta.get("@microsoft.graph.downloadUrl") or meta.get("@content.downloadUrl")
            if not dl_url:
                return "error", "Link de download não retornado pelo OneDrive"
            with urllib.request.urlopen(urllib.request.Request(dl_url, method="GET"), timeout=timeout) as dl_resp:
                data = json.loads(dl_resp.read().decode("utf-8"))
            if isinstance(data, dict) and isinstance(data.get("users"), list):
                return "found", data
            return "error", "Formato inválido no users.json do OneDrive"
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "not_found", None
            last_err = f"HTTP {e.code}"
            if e.code == 401 and not refreshed_on_401:
                refreshed_on_401 = True
                GRAPH_TOKEN_CACHE["access_token"] = None
                GRAPH_TOKEN_CACHE["expires_at"] = 0
                attempts_left += 1
                continue
            print(f"⚠️ Erro ao ler usuários no OneDrive (tentativa {attempt_idx}): HTTP {e.code}")
        except Exception as e:
            last_err = str(e)
            print(f"⚠️ Erro ao sincronizar usuários do OneDrive (tentativa {attempt_idx}): {e}")
        if attempts_left > 0:
            time.sleep(0.35 * attempt_idx)

    return "error", last_err or "Falha ao ler OneDrive"


def _save_users_to_onedrive(users_data):
    encoded = urllib.parse.quote(ONEDRIVE_USERS_REMOTE_PATH)
    url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}:/content"
    body = json.dumps(users_data, indent=2, ensure_ascii=False).encode("utf-8")

    for attempt in range(2):
        tok, _ = get_graph_access_token()
        if not tok:
            return False
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {tok}",
                "Content-Type": "application/json; charset=utf-8",
            },
            method="PUT",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if 200 <= resp.status < 300:
                    return True
        except urllib.error.HTTPError as e:
            if e.code == 401:
                GRAPH_TOKEN_CACHE["access_token"] = None
                GRAPH_TOKEN_CACHE["expires_at"] = 0
            print(f"⚠️ Aviso ao salvar usuários no OneDrive (tentativa {attempt + 1}/2): HTTP {e.code}")
        except Exception as e:
            print(f"⚠️ Aviso ao salvar usuários no OneDrive (tentativa {attempt + 1}/2): {e}")
        if attempt == 0:
            time.sleep(0.6)
    return False


def _sync_users_from_onedrive_once(max_attempts=1, timeout=6):
    """Sincroniza base de usuários fora do USERS_LOCK para não bloquear logins concorrentes."""
    global USERS_MEM, _USERS_ONEDRIVE_SYNCED, _USERS_REMOTE_COOLDOWN_UNTIL, _USERS_LAST_REFRESH_AT
    with _USERS_SYNC_LOCK:
        sync_started_at = time.time()
        status, remote_data = _load_users_from_onedrive(max_attempts=max_attempts, timeout=timeout)
        now = time.time()
        with USERS_LOCK:
            _USERS_LAST_REFRESH_AT = now
            if _USERS_LOCAL_MUTATED_AT > sync_started_at and USERS_MEM is not None:
                return "skipped_stale"
            if status == "found" and remote_data and remote_data.get("users"):
                USERS_MEM = remote_data
                _USERS_ONEDRIVE_SYNCED = True
                _USERS_REMOTE_COOLDOWN_UNTIL = 0.0
                try:
                    with open(USERS_PATH, "w", encoding="utf-8") as f:
                        json.dump(USERS_MEM, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass
            elif status == "not_found":
                # Só confirma ausente quando o OneDrive responder HTTP 404 explícito
                _USERS_ONEDRIVE_SYNCED = True
                _USERS_REMOTE_COOLDOWN_UNTIL = 0.0
                if USERS_MEM is None:
                    USERS_MEM = _build_default_users()
                    try:
                        with open(USERS_PATH, "w", encoding="utf-8") as f:
                            json.dump(USERS_MEM, f, indent=2, ensure_ascii=False)
                    except Exception:
                        pass
            else:
                # Erro transitório: aplica cooldown de 45s para não travar logins seguintes
                _USERS_REMOTE_COOLDOWN_UNTIL = now + 45.0
                print(f"⚠️ Mantendo fallback temporário sem marcar sync remoto ({remote_data})")
        return status


def _schedule_users_background_refresh(max_attempts=1, timeout=6):
    global _USERS_BG_REFRESHING
    with USERS_LOCK:
        if _USERS_BG_REFRESHING:
            return
        _USERS_BG_REFRESHING = True

    def _worker():
        global _USERS_BG_REFRESHING
        try:
            _sync_users_from_onedrive_once(max_attempts=max_attempts, timeout=timeout)
        finally:
            with USERS_LOCK:
                _USERS_BG_REFRESHING = False

    threading.Thread(target=_worker, daemon=True).start()


def load_users_store(sync_remote=True, allow_seed_fallback=True):
    """Carrega base de usuários com cache em RAM e sincronização não-bloqueante."""
    global USERS_MEM, _USERS_ONEDRIVE_SYNCED
    with USERS_LOCK:
        disk_loaded = False
        if USERS_MEM is None and os.path.exists(USERS_PATH):
            try:
                with open(USERS_PATH, "r", encoding="utf-8") as f:
                    disk_data = json.load(f)
                if isinstance(disk_data, dict) and isinstance(disk_data.get("users"), list) and disk_data["users"]:
                    USERS_MEM = disk_data
                    disk_loaded = True
            except Exception as e:
                print(f"⚠️ Erro ao ler {USERS_PATH}: {e}")

        now = time.time()
        if USERS_MEM is not None and (_USERS_ONEDRIVE_SYNCED or not sync_remote):
            if sync_remote and _USERS_ONEDRIVE_SYNCED and (now - _USERS_LAST_REFRESH_AT > 300) and load_env_vars().get("ONEDRIVE_REFRESH_TOKEN"):
                pass  # Agendado fora do USERS_LOCK abaixo
            else:
                return USERS_MEM

        mem_snapshot = USERS_MEM
        synced_now = _USERS_ONEDRIVE_SYNCED
        cooldown_until = _USERS_REMOTE_COOLDOWN_UNTIL
        last_refresh = _USERS_LAST_REFRESH_AT

    if mem_snapshot is not None and synced_now and sync_remote and (now - last_refresh > 300):
        if load_env_vars().get("ONEDRIVE_REFRESH_TOKEN"):
            _schedule_users_background_refresh(max_attempts=1, timeout=6)
        return mem_snapshot

    if sync_remote and not synced_now:
        cfg = load_env_vars()
        if cfg.get("ONEDRIVE_REFRESH_TOKEN"):
            if mem_snapshot is None and not _USERS_BOOT_EVENT.is_set():
                _USERS_BOOT_EVENT.wait(timeout=6.0)
                with USERS_LOCK:
                    mem_snapshot = USERS_MEM
                    synced_now = _USERS_ONEDRIVE_SYNCED
                    cooldown_until = _USERS_REMOTE_COOLDOWN_UNTIL

            if not synced_now and time.time() >= cooldown_until:
                if mem_snapshot is None:
                    _sync_users_from_onedrive_once(max_attempts=1, timeout=6)
                else:
                    _schedule_users_background_refresh(max_attempts=1, timeout=6)
        else:
            with USERS_LOCK:
                _USERS_ONEDRIVE_SYNCED = True

    with USERS_LOCK:
        if USERS_MEM is None and allow_seed_fallback:
            USERS_MEM = _build_default_users()
            if not disk_loaded and _USERS_ONEDRIVE_SYNCED:
                try:
                    with open(USERS_PATH, "w", encoding="utf-8") as f:
                        json.dump(USERS_MEM, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass
        return USERS_MEM


def save_users_store(users_data, sync_remote=True, wait_remote=True):
    """Persiste base de usuários no disco local e na nuvem OneDrive."""
    global USERS_MEM, _USERS_ONEDRIVE_SYNCED, _USERS_LOCAL_MUTATED_AT, _USERS_LAST_REFRESH_AT
    with USERS_LOCK:
        USERS_MEM = users_data
        _USERS_LOCAL_MUTATED_AT = time.time()
        try:
            with open(USERS_PATH, "w", encoding="utf-8") as f:
                json.dump(users_data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"⚠️ Aviso ao salvar .users.json local: {e}")
        snapshot = json.loads(json.dumps(users_data))
        synced_flag = _USERS_ONEDRIVE_SYNCED

    if sync_remote and load_env_vars().get("ONEDRIVE_REFRESH_TOKEN"):
        if wait_remote:
            ok = _save_users_to_onedrive(snapshot)
            if ok:
                with USERS_LOCK:
                    _USERS_ONEDRIVE_SYNCED = True
                    _USERS_LAST_REFRESH_AT = time.time()
            return ok
        else:
            if synced_flag:
                threading.Thread(target=_save_users_to_onedrive, args=(snapshot,), daemon=True).start()
            return True
    return True


def _issue_session_tokens(user):
    mcp = bool(user.get("must_change_password", False))
    pv = int(user.get("pwd_version", 1))
    session_tok = create_signed_token({
        "scope": "session",
        "uid": user.get("id", ""),
        "username": user.get("username", ""),
        "role": user.get("role", "Operador"),
        "pv": pv,
        "mcp": mcp,
    }, ttl_seconds=SESSION_TTL_SECONDS)
    media_tok = create_signed_token({
        "scope": "media",
        "uid": user.get("id", ""),
        "username": user.get("username", ""),
        "pv": pv,
    }, ttl_seconds=SESSION_TTL_SECONDS)
    return session_tok, media_tok


def _check_login_rate_limit(client_ip):
    now = time.time()
    rec = _LOGIN_FAILURES.get(client_ip)
    if not rec:
        return True
    attempts = [ts for ts in rec if now - ts < 300]
    _LOGIN_FAILURES[client_ip] = attempts
    return len(attempts) < 15


def _record_login_failure(client_ip):
    now = time.time()
    attempts = [ts for ts in _LOGIN_FAILURES.get(client_ip, []) if now - ts < 300]
    attempts.append(now)
    _LOGIN_FAILURES[client_ip] = attempts


def _clear_login_failures(client_ip):
    _LOGIN_FAILURES.pop(client_ip, None)


# ============================================================
# PROXY SEGURO META GRAPH API (OCULTA TOKEN NO SERVIDOR)
# ============================================================

def resolve_meta_token(manual_token=""):
    mt = (manual_token or "").strip()
    if mt:
        return mt
    return load_env_vars().get("META_ACCESS_TOKEN", "").strip()


def get_public_meta_config():
    env_vars = load_env_vars()
    return {
        "has_server_token": bool(env_vars.get("META_ACCESS_TOKEN", "").strip()),
        "has_gemini_key": bool(env_vars.get("GEMINI_API_KEY", "").strip()),
        "has_cloudflare": bool(env_vars.get("CLOUDFLARE_ACCOUNT_ID", "").strip() and env_vars.get("CLOUDFLARE_API_TOKEN", "").strip()),
        "default_account_id": env_vars.get("DEFAULT_AD_ACCOUNT_ID", "act_522793227047438"),
        "is_cloud": bool(os.environ.get("RENDER") or os.environ.get("RAILWAY_ENVIRONMENT")),
    }


def _scrub_meta_secret(obj, secret_token=""):
    """Remove access_token de URLs de paginação (paging.next) e strings antes de responder ao cliente."""
    if isinstance(obj, str):
        cleaned = re.sub(
            r'([?&])access_token=[^&"\'\s]+(&?)',
            lambda m: "?" if (m.group(1) == "?" and m.group(2)) else (m.group(2) if (m.group(1) == "&" and m.group(2)) else ""),
            obj,
        )
        cleaned = cleaned.rstrip("?&")
        if secret_token and secret_token in cleaned:
            cleaned = cleaned.replace(secret_token, "[REDACTED]")
        return cleaned
    if isinstance(obj, list):
        return [_scrub_meta_secret(x, secret_token) for x in obj]
    if isinstance(obj, dict):
        return {k: _scrub_meta_secret(v, secret_token) for k, v in obj.items()}
    return obj


def _parse_usage_header_metrics(headers):
    """Extrai métricas reais de cota (X-App-Usage, X-Business-Use-Case-Usage, X-Ad-Account-Usage)."""
    if not headers:
        return None
    call_count = 0
    cpu_time = 0
    total_time = 0
    acc_util = 0
    est_regain = 0
    sources = []

    raw_app = headers.get("X-App-Usage")
    if raw_app:
        try:
            d = json.loads(raw_app)
            if isinstance(d, dict):
                call_count = max(call_count, int(d.get("call_count") or 0))
                cpu_time = max(cpu_time, int(d.get("total_cputime") or 0))
                total_time = max(total_time, int(d.get("total_time") or 0))
                sources.append("app")
        except Exception:
            pass

    raw_buca = headers.get("X-Business-Use-Case-Usage")
    if raw_buca:
        try:
            d = json.loads(raw_buca)
            if isinstance(d, dict):
                for items in d.values():
                    if isinstance(items, list):
                        for item in items:
                            if isinstance(item, dict):
                                call_count = max(call_count, int(item.get("call_count") or 0))
                                cpu_time = max(cpu_time, int(item.get("total_cputime") or 0))
                                total_time = max(total_time, int(item.get("total_time") or 0))
                                est_regain = max(est_regain, int(item.get("estimated_time_to_regain_access") or 0))
                sources.append("buca")
        except Exception:
            pass

    raw_acc = headers.get("X-Ad-Account-Usage")
    if raw_acc:
        try:
            d = json.loads(raw_acc)
            if isinstance(d, dict):
                acc_util = max(acc_util, int(d.get("acc_id_util_pct") or 0))
                sources.append("ad_account")
        except Exception:
            pass

    if not sources:
        return None
    max_pct = max(call_count, cpu_time, total_time, acc_util)
    return {
        "call_count": call_count,
        "total_cputime": cpu_time,
        "total_time": total_time,
        "acc_util_pct": acc_util,
        "estimated_time_to_regain_access": est_regain,
        "max_pct": max_pct,
        "source": "+".join(sources),
        "updated_at": time.time(),
    }


def _record_meta_telemetry(status_code, clean_path, headers, parsed_json):
    metrics = _parse_usage_header_metrics(headers)
    err = parsed_json.get("error") if isinstance(parsed_json, dict) else None
    now = time.time()

    with META_GUARD_LOCK:
        if metrics:
            META_GUARD_STATE["last_usage"] = metrics
            max_pct = metrics["max_pct"]
            est = metrics["estimated_time_to_regain_access"]
            if max_pct >= 95 or est > 0:
                cooldown = max(60, min((est * 60) if est > 0 else 120, 600))
                META_GUARD_STATE["circuit_open_until"] = max(META_GUARD_STATE["circuit_open_until"], now + cooldown)
                META_GUARD_STATE["circuit_reason"] = f"Cota da Meta atingiu {max_pct}% — pausa automática para evitar bloqueio."
                META_GUARD_STATE["circuit_code"] = 613
                META_GUARD_STATE["throttle_delay_ms"] = 1200
            elif max_pct >= 85:
                META_GUARD_STATE["throttle_delay_ms"] = 1000
            elif max_pct >= 70:
                META_GUARD_STATE["throttle_delay_ms"] = 350
            else:
                META_GUARD_STATE["throttle_delay_ms"] = 0

        if not err and 200 <= status_code < 300:
            META_GUARD_STATE["last_ok_at"] = now
            META_GUARD_STATE["token_blocked"] = False
            META_GUARD_STATE["token_blocked_reason"] = ""
            if "/adcreatives" in clean_path or clean_path.endswith("/ads"):
                META_GUARD_STATE["dev_mode_blocked"] = False
            return

        if isinstance(err, dict):
            code = err.get("code")
            subcode = err.get("error_subcode")
            msg = str(err.get("message") or "")
            msg_l = msg.lower()

            entry = {
                "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                "status": status_code,
                "code": code,
                "subcode": subcode,
                "path": clean_path,
                "message": msg[:260],
            }
            recent = META_GUARD_STATE["recent_errors"]
            recent.insert(0, entry)
            del recent[8:]

            if subcode == 1885183 or "development mode" in msg_l:
                META_GUARD_STATE["dev_mode_blocked"] = True

            if code in META_RATE_LIMIT_CODES or "rate limit" in msg_l or "too many calls" in msg_l:
                est_min = (metrics or {}).get("estimated_time_to_regain_access", 0)
                cooldown = max(60, min(est_min * 60 if est_min > 0 else 90, 600))
                META_GUARD_STATE["circuit_open_until"] = max(META_GUARD_STATE["circuit_open_until"], now + cooldown)
                META_GUARD_STATE["circuit_reason"] = f"Rate limit da Meta (código {code}) — pausa automática protetora."
                META_GUARD_STATE["circuit_code"] = code
            elif code == 190 or any(k in msg_l for k in ("api access blocked", "app is restricted", "application has been disabled", "session has expired", "validating access token")):
                META_GUARD_STATE["token_blocked"] = True
                META_GUARD_STATE["token_blocked_reason"] = msg[:220]
                if "restricted" in msg_l or "disabled" in msg_l or "blocked" in msg_l:
                    META_GUARD_STATE["circuit_open_until"] = max(META_GUARD_STATE["circuit_open_until"], now + 45)
                    META_GUARD_STATE["circuit_reason"] = f"App ou token bloqueado/restrito na Meta (código {code})."
                    META_GUARD_STATE["circuit_code"] = code


def _execute_meta_graph_request(method, raw_path, params=None, manual_token="", bypass_circuit=False):
    token = resolve_meta_token(manual_token)
    if not token:
        return 400, {"error": {"message": "Nenhum Token da Meta configurado no servidor nem manualmente.", "code": 190}}

    req_method = (method or "GET").upper()
    if req_method not in ("GET", "POST", "DELETE"):
        return 400, {"error": {"message": f"Método não suportado: {req_method}"}}

    path_str = (raw_path or "").strip()
    existing_query = {}
    if path_str.startswith("http://") or path_str.startswith("https://"):
        parsed_u = urlparse(path_str)
        if parsed_u.scheme != "https" or parsed_u.netloc.lower() != "graph.facebook.com":
            return 400, {"error": {"message": "Host inválido no proxy Graph API."}}
        clean_path = parsed_u.path or "/v21.0/me"
        for qk, qvals in parse_qs(parsed_u.query, keep_blank_values=True).items():
            if qk.lower() != "access_token" and qvals:
                existing_query[qk] = qvals[-1]
    else:
        if "?" in path_str:
            base_p, q_raw = path_str.split("?", 1)
            for qk, qvals in parse_qs(q_raw, keep_blank_values=True).items():
                if qk.lower() != "access_token" and qvals:
                    existing_query[qk] = qvals[-1]
        else:
            base_p = path_str
        if not base_p.startswith("/"):
            base_p = "/" + base_p
        if not re.match(r"^/v\d+\.\d+/", base_p):
            base_p = "/v21.0" + base_p
        clean_path = base_p

    throttle_ms = 0
    if not bypass_circuit and req_method != "DELETE":
        with META_GUARD_LOCK:
            now = time.time()
            open_until = META_GUARD_STATE["circuit_open_until"]
            if open_until > now:
                wait_secs = max(1, int(round(open_until - now)))
                reason = META_GUARD_STATE["circuit_reason"] or "Proteção anti-rajada ativa."
                code = META_GUARD_STATE["circuit_code"] or 613
                return 429, {
                    "error": {
                        "message": f"Proteção anti-rajada ativa ({wait_secs}s restantes): {reason}",
                        "code": code,
                        "is_circuit_breaker": True,
                        "retry_after_seconds": wait_secs,
                    }
                }
            throttle_ms = int(META_GUARD_STATE.get("throttle_delay_ms") or 0)

    if throttle_ms > 0:
        time.sleep(min(throttle_ms, 1500) / 1000.0)

    merged = dict(existing_query)
    if isinstance(params, dict):
        for k, v in params.items():
            if str(k).lower() == "access_token" or v is None:
                continue
            merged[k] = json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)

    merged["access_token"] = token

    if req_method in ("GET", "DELETE"):
        qs_encoded = urllib.parse.urlencode(merged)
        target_url = f"https://graph.facebook.com{clean_path}?{qs_encoded}"
        req = urllib.request.Request(target_url, method=req_method)
    else:
        target_url = f"https://graph.facebook.com{clean_path}"
        body_bytes = urllib.parse.urlencode(merged).encode("utf-8")
        req = urllib.request.Request(
            target_url,
            data=body_bytes,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw_txt = resp.read().decode("utf-8", errors="replace")
            try:
                parsed_json = json.loads(raw_txt)
            except Exception:
                parsed_json = {"raw": raw_txt}
            scrubbed = _scrub_meta_secret(parsed_json, token)
            _record_meta_telemetry(resp.status, clean_path, resp.headers, scrubbed)
            return resp.status, scrubbed
    except urllib.error.HTTPError as e:
        raw_txt = e.read().decode("utf-8", errors="replace")
        try:
            parsed_json = json.loads(raw_txt)
        except Exception:
            parsed_json = {"error": {"message": raw_txt or f"HTTP {e.code}"}}
        scrubbed = _scrub_meta_secret(parsed_json, token)
        _record_meta_telemetry(e.code, clean_path, e.headers, scrubbed)
        return e.code, scrubbed
    except Exception as e:
        return 502, _scrub_meta_secret({"error": {"message": str(e)}}, token)


def _load_meta_health_audit_from_onedrive(timeout=5):
    encoded = urllib.parse.quote(ONEDRIVE_HEALTH_AUDIT_REMOTE_PATH)
    meta_url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}?select=id,@microsoft.graph.downloadUrl,@content.downloadUrl"
    tok, _ = get_graph_access_token()
    if not tok:
        return None
    try:
        req = urllib.request.Request(meta_url, headers={"Authorization": f"Bearer {tok}"}, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            meta = json.loads(resp.read().decode("utf-8"))
        dl_url = meta.get("@microsoft.graph.downloadUrl") or meta.get("@content.downloadUrl")
        if not dl_url:
            return None
        with urllib.request.urlopen(urllib.request.Request(dl_url, method="GET"), timeout=timeout) as dl_resp:
            data = json.loads(dl_resp.read().decode("utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_meta_health_audit_to_onedrive(data):
    tok, _ = get_graph_access_token()
    if not tok:
        return False
    encoded = urllib.parse.quote(ONEDRIVE_HEALTH_AUDIT_REMOTE_PATH)
    put_url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}:/content"
    body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        put_url,
        data=body,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json; charset=utf-8"},
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def load_meta_health_audit():
    global META_HEALTH_AUDIT_MEM
    with META_HEALTH_AUDIT_LOCK:
        if META_HEALTH_AUDIT_MEM is not None:
            return dict(META_HEALTH_AUDIT_MEM)
        data = None
        if os.path.exists(META_HEALTH_AUDIT_PATH):
            try:
                with open(META_HEALTH_AUDIT_PATH, "r", encoding="utf-8") as f:
                    d = json.load(f)
                if isinstance(d, dict):
                    data = d
            except Exception:
                pass
        if data is None and load_env_vars().get("ONEDRIVE_REFRESH_TOKEN"):
            remote = _load_meta_health_audit_from_onedrive()
            if isinstance(remote, dict):
                data = remote
                try:
                    with open(META_HEALTH_AUDIT_PATH, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                except Exception:
                    pass
        if not isinstance(data, dict):
            data = {"last_duc_check_ts": 0, "last_duc_check_at": None, "last_duc_checked_by": None, "backup_app_ready": False}
        META_HEALTH_AUDIT_MEM = data
        return dict(data)


def save_meta_health_audit(audit_data):
    global META_HEALTH_AUDIT_MEM
    with META_HEALTH_AUDIT_LOCK:
        META_HEALTH_AUDIT_MEM = dict(audit_data)
        try:
            with open(META_HEALTH_AUDIT_PATH, "w", encoding="utf-8") as f:
                json.dump(audit_data, f, indent=2, ensure_ascii=False)
        except Exception:
            pass
    if load_env_vars().get("ONEDRIVE_REFRESH_TOKEN"):
        threading.Thread(target=_save_meta_health_audit_to_onedrive, args=(dict(audit_data),), daemon=True).start()


def build_meta_app_health_report(account_id="", manual_token=""):
    """Consulta saúde real do token, app, permissões, cota e conta Meta (sem jamais expor tokens)."""
    token = resolve_meta_token(manual_token)
    audit = load_meta_health_audit()
    cfg = load_env_vars()
    selected_acc = (account_id or cfg.get("DEFAULT_AD_ACCOUNT_ID") or "").strip()
    now = time.time()

    with META_GUARD_LOCK:
        guard = {
            "circuit_open_until": META_GUARD_STATE["circuit_open_until"],
            "circuit_reason": META_GUARD_STATE["circuit_reason"],
            "circuit_code": META_GUARD_STATE["circuit_code"],
            "throttle_delay_ms": META_GUARD_STATE["throttle_delay_ms"],
            "last_usage": dict(META_GUARD_STATE["last_usage"]),
            "recent_errors": list(META_GUARD_STATE["recent_errors"]),
            "dev_mode_blocked": META_GUARD_STATE["dev_mode_blocked"],
            "token_blocked": META_GUARD_STATE["token_blocked"],
            "token_blocked_reason": META_GUARD_STATE["token_blocked_reason"],
            "last_ok_at": META_GUARD_STATE["last_ok_at"],
        }

    checks = []
    app_info = {"id": (cfg.get("META_APP_ID") or "").strip(), "name": "", "link": ""}
    token_info = {
        "configured": bool(token),
        "source": "manual" if (manual_token or "").strip() else ("server" if cfg.get("META_ACCESS_TOKEN") else "none"),
        "is_valid": False,
        "type": "",
        "expires_at": None,
        "days_until_expiry": None,
        "user_id": "",
        "user_name": "",
        "missing_scopes": [],
        "granted_scopes": [],
    }
    account_info = None
    required_scopes = ["ads_management", "ads_read", "business_management", "pages_read_engagement", "pages_show_list"]

    if not token:
        checks.append({
            "id": "token",
            "level": "red",
            "title": "Token da Meta não configurado",
            "detail": "Configure META_ACCESS_TOKEN no Render (.env) ou informe um token manual.",
        })
    else:
        st_me, me_res = _execute_meta_graph_request("GET", "/v21.0/me?fields=id,name", None, manual_token, bypass_circuit=True)
        if 200 <= st_me < 300 and isinstance(me_res, dict) and me_res.get("id"):
            token_info["is_valid"] = True
            token_info["user_id"] = str(me_res.get("id", ""))
            token_info["user_name"] = str(me_res.get("name", ""))
        else:
            err_obj = (me_res or {}).get("error", {}) if isinstance(me_res, dict) else {}
            checks.append({
                "id": "token",
                "level": "red",
                "title": "Falha de autenticação na Meta API",
                "detail": str(err_obj.get("message") or f"HTTP {st_me} ao validar /me"),
            })

        # Permissões concedidas ao token atual
        st_perm, perm_res = _execute_meta_graph_request("GET", "/v21.0/me/permissions", None, manual_token, bypass_circuit=True)
        if 200 <= st_perm < 300 and isinstance(perm_res, dict) and isinstance(perm_res.get("data"), list):
            granted = [p.get("permission") for p in perm_res["data"] if p.get("status") == "granted" and p.get("permission")]
            token_info["granted_scopes"] = granted
            token_info["missing_scopes"] = [s for s in required_scopes if s not in granted]

        # debug_token com o próprio token para identificar App ID, tipo (SYSTEM_USER vs USER) e expiração
        st_dbg, dbg_res = _execute_meta_graph_request("GET", "/v21.0/debug_token", {"input_token": token}, manual_token, bypass_circuit=True)
        if 200 <= st_dbg < 300 and isinstance(dbg_res, dict) and isinstance(dbg_res.get("data"), dict):
            dd = dbg_res["data"]
            if dd.get("app_id"):
                app_info["id"] = str(dd.get("app_id"))
            if dd.get("application"):
                app_info["name"] = str(dd.get("application"))
            token_info["is_valid"] = bool(dd.get("is_valid", token_info["is_valid"]))
            token_info["type"] = str(dd.get("type") or "")
            exp = int(dd.get("expires_at") or 0)
            token_info["expires_at"] = exp
            if exp > 0:
                token_info["days_until_expiry"] = round((exp - now) / 86400.0, 1)
            if isinstance(dd.get("scopes"), list) and not token_info["granted_scopes"]:
                token_info["granted_scopes"] = dd["scopes"]
                token_info["missing_scopes"] = [s for s in required_scopes if s not in dd["scopes"]]
            if dd.get("error") and isinstance(dd["error"], dict):
                checks.append({
                    "id": "debug_token_err",
                    "level": "red",
                    "title": "Token sinalizado como inválido pela Meta",
                    "detail": str(dd["error"].get("message") or "Erro no debug_token"),
                })

        if app_info["id"] and not app_info["name"]:
            st_app, app_res = _execute_meta_graph_request("GET", f"/v21.0/{app_info['id']}?fields=id,name,link", None, manual_token, bypass_circuit=True)
            if 200 <= st_app < 300 and isinstance(app_res, dict) and app_res.get("id"):
                app_info["name"] = str(app_res.get("name") or "")
                app_info["link"] = str(app_res.get("link") or "")

        if token_info["is_valid"]:
            if token_info["expires_at"] == 0:
                checks.append({
                    "id": "token_ok",
                    "level": "green",
                    "title": "Token ativo e permanente",
                    "detail": f"Autenticado como {token_info['user_name'] or 'Usuário do Sistema'}" + (f" ({token_info['type']})" if token_info["type"] else "") + ".",
                })
            elif token_info["days_until_expiry"] is not None:
                if token_info["days_until_expiry"] <= 0:
                    checks.append({"id": "token_exp", "level": "red", "title": "Token expirado", "detail": "Gere um novo token permanente de Usuário do Sistema."})
                elif token_info["days_until_expiry"] < 15:
                    checks.append({
                        "id": "token_exp_soon",
                        "level": "yellow",
                        "title": f"Token expira em {token_info['days_until_expiry']} dia(s)",
                        "detail": "Recomenda-se trocar pelo token permanente ('Never') de Usuário do Sistema no BM.",
                    })
                else:
                    checks.append({
                        "id": "token_ok",
                        "level": "green",
                        "title": f"Token válido (expira em {token_info['days_until_expiry']} dias)",
                        "detail": f"Autenticado como {token_info['user_name']}.",
                    })
            else:
                checks.append({
                    "id": "token_ok",
                    "level": "green",
                    "title": "Token autenticado na Meta Graph API",
                    "detail": f"Conectado como {token_info['user_name'] or token_info['user_id']}.",
                })

        if token_info["missing_scopes"]:
            critical_missing = [s for s in token_info["missing_scopes"] if s in ("ads_management", "ads_read")]
            checks.append({
                "id": "scopes",
                "level": "red" if critical_missing else "yellow",
                "title": f"Permissões ausentes: {', '.join(token_info['missing_scopes'])}",
                "detail": "Gere o token marcando todas as permissões necessárias no Usuário do Sistema.",
            })
        elif token_info["granted_scopes"]:
            checks.append({
                "id": "scopes_ok",
                "level": "green",
                "title": "Permissões essenciais completas (5/5)",
                "detail": ", ".join(required_scopes),
            })

        # Saúde da Conta de Anúncios & Verificação da BM
        if selected_acc:
            acc_norm = selected_acc if selected_acc.startswith("act_") else f"act_{selected_acc}"
            st_acc, acc_res = _execute_meta_graph_request(
                "GET",
                f"/v21.0/{acc_norm}?fields=id,name,account_status,disable_reason,business{{id,name,verification_status}}",
                None,
                manual_token,
                bypass_circuit=True,
            )
            if 200 <= st_acc < 300 and isinstance(acc_res, dict) and acc_res.get("id"):
                st_code = int(acc_res.get("account_status") or 0)
                dis_reason = int(acc_res.get("disable_reason") or 0)
                biz = acc_res.get("business") if isinstance(acc_res.get("business"), dict) else {}
                biz_ver = str(biz.get("verification_status") or "")
                account_info = {
                    "id": acc_res.get("id"),
                    "name": acc_res.get("name", ""),
                    "account_status": st_code,
                    "disable_reason": dis_reason,
                    "business_id": biz.get("id", ""),
                    "business_name": biz.get("name", ""),
                    "business_verification_status": biz_ver,
                }
                if st_code == 1:
                    checks.append({
                        "id": "ad_account_ok",
                        "level": "green",
                        "title": f"Conta de Anúncios Ativa ({acc_res.get('name', acc_norm)})",
                        "detail": f"Status Meta: Ativa (código 1).",
                    })
                elif st_code == 3:
                    checks.append({
                        "id": "ad_account_warn",
                        "level": "yellow",
                        "title": f"Conta com Pagamento Pendente ({acc_res.get('name', acc_norm)})",
                        "detail": "Account status = 3 (Unsettled). Regularize o faturamento para evitar pausa nas campanhas.",
                    })
                else:
                    checks.append({
                        "id": "ad_account_err",
                        "level": "red",
                        "title": f"Conta de Anúncios Restrita/Inativa (status {st_code})",
                        "detail": f"Conta {acc_res.get('name', acc_norm)} • disable_reason={dis_reason}. Confira a Qualidade da Conta.",
                    })

                if biz:
                    if biz_ver.lower() == "verified":
                        checks.append({
                            "id": "bm_verified",
                            "level": "green",
                            "title": f"BM Verificada ({biz.get('name', biz.get('id', 'BM'))})",
                            "detail": "Portfólio Empresarial com verificação confirmada pela Meta.",
                        })
                    elif biz_ver:
                        checks.append({
                            "id": "bm_unverified",
                            "level": "yellow",
                            "title": f"BM sem verificação completa ({biz_ver})",
                            "detail": "Verifique o Portfólio Empresarial e vincule o App para reduzir risco de queda.",
                        })

    # Re-lê telemetria atualizada após as consultas acima
    with META_GUARD_LOCK:
        usage = dict(META_GUARD_STATE["last_usage"])
        open_until = META_GUARD_STATE["circuit_open_until"]
        circuit_reason = META_GUARD_STATE["circuit_reason"]
        throttle_ms = META_GUARD_STATE["throttle_delay_ms"]
        dev_blocked = META_GUARD_STATE["dev_mode_blocked"]
        token_blocked = META_GUARD_STATE["token_blocked"]
        token_blocked_reason = META_GUARD_STATE["token_blocked_reason"]
        recent_errors = list(META_GUARD_STATE["recent_errors"])

    circuit_secs_left = max(0, int(round(open_until - time.time())))
    max_pct = int(usage.get("max_pct") or 0)

    if circuit_secs_left > 0:
        checks.append({
            "id": "circuit_open",
            "level": "red",
            "title": f"Circuit Breaker Ativo ({circuit_secs_left}s restantes)",
            "detail": circuit_reason or "Requisições pausadas temporariamente para proteger o App contra rajada/ban.",
        })
    elif max_pct >= 70:
        checks.append({
            "id": "rate_high",
            "level": "yellow",
            "title": f"Uso de Cota Meta elevado ({max_pct}%)",
            "detail": f"Espaçamento automático anti-rajada ativado ({throttle_ms}ms entre chamadas).",
        })
    elif usage.get("updated_at"):
        checks.append({
            "id": "rate_ok",
            "level": "green",
            "title": f"Cota / Rate Limit saudável ({max_pct}%)",
            "detail": f"Call={usage.get('call_count', 0)}% • CPU={usage.get('total_cputime', 0)}% • Tempo={usage.get('total_time', 0)}% • Conta={usage.get('acc_util_pct', 0)}%.",
        })

    if dev_blocked:
        checks.append({
            "id": "dev_mode",
            "level": "yellow",
            "title": "Erro 1885183 detectado (Modo de Desenvolvimento)",
            "detail": "Alguma criação falhou com App em Desenvolvimento. Coloque o App em Live ou use Usuário do Sistema na BM.",
        })
    if token_blocked:
        checks.append({
            "id": "token_blocked",
            "level": "red",
            "title": "Bloqueio ou restrição sinalizado pela Meta",
            "detail": token_blocked_reason or "A Meta retornou erro de bloqueio/restrição no último lote.",
        })

    # Checagem manual de DUC (Data Use Checkup) & Alerts Inbox (não expostos por API da Meta)
    last_duc_ts = float(audit.get("last_duc_check_ts") or 0)
    duc_age_days = round((now - last_duc_ts) / 86400.0, 1) if last_duc_ts > 0 else None
    if last_duc_ts <= 0:
        checks.append({
            "id": "duc_check",
            "level": "yellow",
            "title": "DUC / Alerts Inbox nunca confirmado no painel",
            "detail": "A Meta não expõe DUC/Alertas Obrigatórios via API. Abra o painel do App, confira DUC/Alertas e clique em 'Marcar Conferido Hoje'.",
        })
    elif duc_age_days > 30:
        checks.append({
            "id": "duc_check",
            "level": "yellow",
            "title": f"Conferência de DUC/Alertas pendente ({int(duc_age_days)} dias atrás)",
            "detail": "Faz mais de 30 dias da última checagem manual de Alerts Inbox e Data Use Checkup.",
        })
    else:
        checks.append({
            "id": "duc_check",
            "level": "green",
            "title": f"DUC / Alertas conferido há {int(duc_age_days)} dia(s)",
            "detail": f"Última confirmação por {audit.get('last_duc_checked_by') or 'equipe'} em {audit.get('last_duc_check_at')}.",
        })

    if not audit.get("backup_app_ready"):
        checks.append({
            "id": "backup_app",
            "level": "yellow",
            "title": "Plano B (App Reserva) não marcado como pronto",
            "detail": "Mantenha 1 App reserva + token pronto para colar no Render caso o principal sofra revisão.",
        })
    else:
        checks.append({
            "id": "backup_app",
            "level": "green",
            "title": "Plano B (App Reserva) marcado como pronto",
            "detail": "Contingência confirmada para troca rápida de META_ACCESS_TOKEN.",
        })

    levels = [c["level"] for c in checks]
    if "red" in levels:
        overall = "red"
    elif "yellow" in levels:
        overall = "yellow"
    else:
        overall = "green"

    app_id_for_links = app_info["id"]
    links = {
        "app_dashboard": f"https://developers.facebook.com/apps/{app_id_for_links}/" if app_id_for_links else "https://developers.facebook.com/apps/",
        "alerts_inbox": f"https://developers.facebook.com/apps/{app_id_for_links}/alerts/inbox/" if app_id_for_links else "https://developers.facebook.com/apps/",
        "app_settings": f"https://developers.facebook.com/apps/{app_id_for_links}/settings/basic/" if app_id_for_links else "https://developers.facebook.com/apps/",
        "account_quality": "https://business.facebook.com/accountquality/",
        "bm_security": f"https://business.facebook.com/settings/security?business_id={account_info['business_id']}" if (account_info and account_info.get("business_id")) else "https://business.facebook.com/settings/security/",
    }

    return {
        "success": True,
        "overall": overall,
        "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "app": app_info,
        "token": token_info,
        "account": account_info,
        "usage": usage,
        "guard": {
            "circuit_open": circuit_secs_left > 0,
            "circuit_seconds_left": circuit_secs_left,
            "circuit_reason": circuit_reason if circuit_secs_left > 0 else "",
            "throttle_delay_ms": throttle_ms,
            "recent_errors": recent_errors,
        },
        "audit": {
            "last_duc_check_ts": last_duc_ts,
            "last_duc_check_at": audit.get("last_duc_check_at"),
            "last_duc_checked_by": audit.get("last_duc_checked_by"),
            "duc_age_days": duc_age_days,
            "backup_app_ready": bool(audit.get("backup_app_ready", False)),
        },
        "links": links,
        "checks": checks,
    }


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
    with GRAPH_TOKEN_LOCK:
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


GRAPH_THUMB_CACHE = {}
TRANSLATION_CACHE = {}


def _translate_single_text(txt, source_lang, tl_code):
    """Traduz texto com cache e múltiplos provedores (clients5, googleapis gtx, MyMemory) para evitar HTTP 429."""
    if not txt or not isinstance(txt, str):
        return txt
    stripped = txt.strip()
    if tl_code.lower() == source_lang.lower() or not any(c.isalpha() for c in stripped):
        return txt

    cache_key = (source_lang.lower(), tl_code.lower(), txt)
    with GRAPH_LOCK:
        if cache_key in TRANSLATION_CACHE:
            return TRANSLATION_CACHE[cache_key]

    headers = {"User-Agent": "Mozilla/5.0"}
    joined = None

    # 1. Google Translate clients5 (não costuma dar 429)
    try:
        u1 = "https://clients5.google.com/translate_a/t?" + urllib.parse.urlencode({
            "client": "dict-chrome-ex",
            "sl": source_lang,
            "tl": tl_code,
            "q": txt,
        })
        req = urllib.request.Request(u1, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
            if isinstance(raw, list) and raw:
                if all(isinstance(x, str) for x in raw):
                    joined = " ".join(x.strip() for x in raw if x and x.strip())
                elif isinstance(raw[0], str):
                    joined = raw[0]
                elif isinstance(raw[0], list) and raw[0] and isinstance(raw[0][0], str):
                    joined = raw[0][0]
            elif isinstance(raw, dict) and isinstance(raw.get("sentences"), list):
                joined = "".join(str(s.get("trans") or "") for s in raw["sentences"] if isinstance(s, dict))
    except Exception:
        joined = None

    # 2. Google Translate gtx
    if not joined:
        try:
            u2 = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode({
                "client": "gtx",
                "sl": source_lang,
                "tl": tl_code,
                "dt": "t",
                "q": txt,
            })
            req = urllib.request.Request(u2, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
                cand = "".join(seg[0] for seg in raw[0] if seg and seg[0])
                if cand:
                    joined = cand
        except Exception:
            joined = None

    # 3. MyMemory fallback
    if not joined:
        try:
            u3 = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode({
                "q": txt,
                "langpair": f"{source_lang}|{tl_code}",
            })
            req = urllib.request.Request(u3, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = json.loads(resp.read().decode("utf-8"))
                cand = (raw.get("responseData") or {}).get("translatedText")
                if cand and "MYMEMORY WARNING" not in cand.upper():
                    joined = cand
        except Exception:
            joined = None

    if not joined:
        gemini_k = load_env_vars().get("GEMINI_API_KEY", "").strip()
        if gemini_k:
            try:
                cand_gem = studio_engine.gemini_translate_text(txt, tl_code, "", gemini_k, source_lang=source_lang)
                if cand_gem:
                    joined = cand_gem
            except Exception:
                joined = None

    if not joined:
        return txt

    if stripped == stripped.upper() and any(c.isalpha() for c in stripped):
        joined = joined.upper()

    with GRAPH_LOCK:
        TRANSLATION_CACHE[cache_key] = joined
    return joined


def _extract_block_and_lang(rel_subfolders):
    """Extrai (block, lang) a partir das subpastas relativas dentro da pasta do nicho."""
    parts = [p.strip() for p in (rel_subfolders or []) if p and p.strip()]
    if not parts:
        return "", ""
    if len(parts) == 1:
        single = parts[0]
        if single.lower().startswith("bloco"):
            return single, ""
        return "", single
    return " / ".join(parts[:-1]), parts[-1]


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
        m_num = re.match(r"^(\d+)", name)
        num = int(m_num.group(1)) if m_num else 0
        block_folder, lang_folder = _extract_block_and_lang(rel_parts[1:])
        item_data = {
            "id": item_id,
            "name": name,
            "num": num,
            "block": block_folder,
            "lang": lang_folder,
            "size": item.get("size", 0),
            "url": f"/api/graph/file/{item_id}/{urllib.parse.quote(name)}",
        }
        if 1 <= num <= 3:
            niche["videos"]["feed"] = [v for v in niche["videos"]["feed"] if v.get("id") != item_id]
            niche["videos"]["feed"].append(item_data)
        elif 4 <= num <= 9:
            niche["videos"]["reels"] = [v for v in niche["videos"]["reels"] if v.get("id") != item_id]
            niche["videos"]["reels"].append(item_data)

    _recompute_niche_status(niche)


def fetch_single_niche_videos_from_graph(niche_name, videos_id=None, tok=None):
    """Busca diretamente no OneDrive Nuvem os vídeos de um nicho específico (preservando Bloco A/B e Idioma)."""
    if not tok:
        tok, err = get_graph_access_token()
        if not tok:
            return None, err or "OneDrive não autenticado"

    if not videos_id:
        _, _, videos_id = _find_work_folder_ids(tok)
        if not videos_id:
            return None, "Pasta Vídeos não encontrada no OneDrive"

    encoded = urllib.parse.quote(niche_name.strip())
    root_res = _graph_get(f"https://graph.microsoft.com/v1.0/me/drive/items/{videos_id}:/{encoded}", tok)
    if "error" in root_res or "id" not in root_res:
        return {"feed": [], "reels": [], "found_in_cloud": False}, None

    feed = []
    reels = []
    current_level = [(root_res["id"], ())]
    with ThreadPoolExecutor(max_workers=6) as pool:
        while current_level:
            results = list(pool.map(lambda node: (node[1], _graph_list_all_children(node[0], tok)), current_level))
            next_level = []
            for rel_folders, children in results:
                for ch in children:
                    cname = ch.get("name", "")
                    if "folder" in ch:
                        next_level.append((ch["id"], rel_folders + (cname,)))
                    elif "file" in ch and cname.lower().endswith(".mp4"):
                        m_num = re.match(r"^(\d+)", cname)
                        num = int(m_num.group(1)) if m_num else 0
                        block_folder, lang_folder = _extract_block_and_lang(list(rel_folders))
                        item_data = {
                            "id": ch["id"],
                            "name": cname,
                            "num": num,
                            "block": block_folder,
                            "lang": lang_folder,
                            "size": ch.get("size", 0),
                            "url": f"/api/graph/file/{ch['id']}/{urllib.parse.quote(cname)}",
                        }
                        if 1 <= num <= 3:
                            feed.append(item_data)
                        elif 4 <= num <= 9:
                            reels.append(item_data)
            current_level = next_level

    with GRAPH_LOCK:
        niches_map = GRAPH_SYNC_STATE["niches_map"]
        if niche_name not in niches_map:
            niches_map[niche_name] = {
                "name": niche_name,
                "audios": [],
                "videos": {"feed": [], "reels": []},
                "status": "pending",
                "source": "graph",
            }
        niches_map[niche_name]["videos"]["feed"] = feed
        niches_map[niche_name]["videos"]["reels"] = reels
        niches_map[niche_name]["deep_synced"] = True
        _recompute_niche_status(niches_map[niche_name])

    return {"feed": feed, "reels": reels, "found_in_cloud": True}, None


def load_campaign_creatives():
    """Carrega as vinculações salvas entre Campanhas e Pacotes de Criativo do OneDrive."""
    if not os.path.exists(CAMPAIGN_CREATIVES_PATH):
        return {}
    try:
        with open(CAMPAIGN_CREATIVES_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Erro ao ler .campaign_creatives.json: {e}")
        return {}


def save_campaign_creatives(data):
    """Grava as vinculações de campanha em disco para toda a equipe."""
    try:
        with open(CAMPAIGN_CREATIVES_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Erro ao salvar .campaign_creatives.json: {e}")
        return False


def _normalize_pack_text(txt):
    import unicodedata
    nfd = unicodedata.normalize('NFD', txt or '')
    clean = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-zA-Z0-9]', '', clean).lower()


def _split_pack_query_tokens(query_txt):
    import unicodedata
    nfd = unicodedata.normalize('NFD', query_txt or '')
    clean = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    raw_parts = re.split(r'[\s._/\-]+', clean.strip())
    tokens = []
    for p in raw_parts:
        al = re.sub(r'[^a-zA-Z0-9]', '', p).lower()
        if al and len(al) >= 2:
            tokens.append(al)
    return tokens


def _matches_pack_query(folder_name, target_norm, query_tokens):
    n_norm = _normalize_pack_text(folder_name)
    if not n_norm:
        return False
    if target_norm and (target_norm in n_norm or (len(n_norm) >= 4 and n_norm in target_norm)):
        return True
    if query_tokens and all(tok in n_norm for tok in query_tokens):
        return True
    return False


def _pack_date_sort_key(folder_name):
    m = re.search(r'(\d{2})[./-](\d{2})[./-](\d{2,4})', folder_name or '')
    if not m:
        return (0, 0, 0, 0)
    d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
    y_int = int(y) + 2000 if len(y) == 2 else int(y)
    return (1, y_int, mo, d)


def _refresh_videos_root_index(tok=None):
    if not tok:
        tok, _ = get_graph_access_token()
    if not tok:
        return False
    _, _, videos_id = _find_work_folder_ids(tok)
    if not videos_id:
        return False
    for ch in _graph_list_all_children(videos_id, tok):
        if "folder" in ch:
            cname = (ch.get("name") or "").strip()
            if cname:
                with GRAPH_LOCK:
                    if cname not in GRAPH_SYNC_STATE["niches_map"]:
                        GRAPH_SYNC_STATE["niches_map"][cname] = {
                            "name": cname,
                            "audios": [],
                            "videos": {"feed": [], "reels": []},
                            "status": "pending",
                            "source": "graph",
                        }
    return True


def list_onedrive_video_folders(query="", force_refresh=False):
    """Lista todas as pastas de Vídeos no OneDrive ordenadas por data (mais novas primeiro), com filtro opcional por tokens."""
    cfg = load_env_vars()
    has_graph = bool(cfg.get("ONEDRIVE_REFRESH_TOKEN"))
    target_norm = _normalize_pack_text(query)
    query_tokens = _split_pack_query_tokens(query)

    names_rows = []
    if has_graph:
        with GRAPH_LOCK:
            is_empty = len(GRAPH_SYNC_STATE.get("niches_map", {})) == 0
        if force_refresh or is_empty:
            _refresh_videos_root_index()
        with GRAPH_LOCK:
            items = list(GRAPH_SYNC_STATE.get("niches_map", {}).values())
        if (target_norm or query_tokens) and not force_refresh:
            has_hit = any(_matches_pack_query(n.get("name", ""), target_norm, query_tokens) for n in items)
            if not has_hit:
                if _refresh_videos_root_index():
                    with GRAPH_LOCK:
                        items = list(GRAPH_SYNC_STATE.get("niches_map", {}).values())
        for n in items:
            cname = (n.get("name") or "").strip()
            if not cname:
                continue
            if (target_norm or query_tokens) and not _matches_pack_query(cname, target_norm, query_tokens):
                continue
            v_cnt = len(n.get("videos", {}).get("feed", [])) + len(n.get("videos", {}).get("reels", []))
            names_rows.append({"name": cname, "videos_count": v_cnt, "status": n.get("status", "pending")})
    else:
        for n in scan_onedrive_folders(DEFAULT_WORK_DIR, force_reload=force_refresh):
            cname = (n.get("name") or "").strip()
            if not cname:
                continue
            if (target_norm or query_tokens) and not _matches_pack_query(cname, target_norm, query_tokens):
                continue
            v_cnt = len(n.get("videos", {}).get("feed", [])) + len(n.get("videos", {}).get("reels", []))
            names_rows.append({"name": cname, "videos_count": v_cnt, "status": n.get("status", "pending")})

    names_rows.sort(key=lambda r: (_pack_date_sort_key(r["name"]), r["name"].lower()), reverse=True)
    return names_rows


def find_niche_candidate_packs(niche_slug, force_refresh=False):
    """Busca pacotes de criativo do OneDrive para o nicho/busca manual, separando Bloco A / Bloco B e ordenando da data mais nova para a mais antiga."""
    if not niche_slug:
        return []

    _norm = _normalize_pack_text
    _pack_date_key = _pack_date_sort_key
    target_norm = _normalize_pack_text(niche_slug)
    query_tokens = _split_pack_query_tokens(niche_slug)
    if not target_norm and not query_tokens:
        return []

    cfg = load_env_vars()
    has_graph = bool(cfg.get("ONEDRIVE_REFRESH_TOKEN"))

    source_niches = []
    if has_graph:
        with GRAPH_LOCK:
            is_empty = len(GRAPH_SYNC_STATE.get("niches_map", {})) == 0

        if force_refresh or is_empty:
            _refresh_videos_root_index()

        candidate_names = []
        with GRAPH_LOCK:
            niches_map = GRAPH_SYNC_STATE.get("niches_map", {})
            for nname in niches_map.keys():
                if _matches_pack_query(nname, target_norm, query_tokens):
                    candidate_names.append(nname)

        if not candidate_names and not force_refresh:
            if _refresh_videos_root_index():
                with GRAPH_LOCK:
                    niches_map = GRAPH_SYNC_STATE.get("niches_map", {})
                    for nname in niches_map.keys():
                        if _matches_pack_query(nname, target_norm, query_tokens):
                            candidate_names.append(nname)

        any_refreshed = False
        to_fetch = []
        for cname in candidate_names:
            with GRAPH_LOCK:
                niche_obj = GRAPH_SYNC_STATE.get("niches_map", {}).get(cname)
                cached_vids = (
                    (niche_obj or {}).get("videos", {}).get("feed", [])
                    + (niche_obj or {}).get("videos", {}).get("reels", [])
                )
                already_deep = bool((niche_obj or {}).get("deep_synced")) and all("block" in v for v in cached_vids)
                needs_fetch = force_refresh or (not already_deep)
            if needs_fetch:
                to_fetch.append(cname)

        if to_fetch:
            tok, _ = get_graph_access_token()
            videos_id = None
            if tok:
                _, _, videos_id = _find_work_folder_ids(tok)
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda c: fetch_single_niche_videos_from_graph(c, videos_id=videos_id, tok=tok), to_fetch))
            any_refreshed = True

        with GRAPH_LOCK:
            for cname in candidate_names:
                niche_obj = GRAPH_SYNC_STATE.get("niches_map", {}).get(cname)
                if niche_obj:
                    source_niches.append(niche_obj)

        if any_refreshed:
            _save_graph_cache_to_disk()
    else:
        local_niches = scan_onedrive_folders(DEFAULT_WORK_DIR, force_reload=force_refresh)
        for niche_obj in local_niches:
            if _matches_pack_query(niche_obj.get("name", ""), target_norm, query_tokens):
                source_niches.append(niche_obj)

    lang_priority = {"PORTUGUES": 1, "ESPANHOL": 2, "INGLES": 3, "FRANCES": 4}
    matched_packs = []

    for niche_obj in source_niches:
        folder_name = niche_obj["name"]
        raw_vids = niche_obj["videos"]["feed"] + niche_obj["videos"]["reels"]
        if not raw_vids:
            continue

        seen_keys = set()
        blocks_map = {}
        for v in raw_vids:
            dedup_key = v.get("id") or v.get("url")
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)
            block_name = (v.get("block") or "").strip()
            blocks_map.setdefault(block_name, []).append(v)

        for block_name in sorted(blocks_map.keys()):
            pack_vids = blocks_map[block_name]
            by_lang = {}
            for v in pack_vids:
                lang_label = (v.get("lang") or "Sem Idioma").strip() or "Sem Idioma"
                v_out = dict(v)
                v_out["thumb_url"] = f"/api/graph/thumb/{v['id']}" if v.get("id") else ""
                bucket = "feed" if 1 <= v_out.get("num", 0) <= 3 else "reels"
                by_lang.setdefault(lang_label, {"feed": [], "reels": []})[bucket].append(v_out)

            for lang_buckets in by_lang.values():
                lang_buckets["feed"].sort(key=lambda x: (x.get("num", 0), x.get("name", "")))
                lang_buckets["reels"].sort(key=lambda x: (x.get("num", 0), x.get("name", "")))

            langs = sorted(
                by_lang.keys(),
                key=lambda l: (lang_priority.get(_norm(l).upper(), 99), l),
            )

            all_feed = []
            all_reels = []
            for l in langs:
                all_feed.extend(by_lang[l]["feed"])
                all_reels.extend(by_lang[l]["reels"])

            pack_id = f"{folder_name} :: {block_name}" if block_name else folder_name
            display_name = f"{folder_name} — {block_name}" if block_name else folder_name
            matched_packs.append({
                "pack_id": pack_id,
                "name": display_name,
                "folder_name": folder_name,
                "block": block_name,
                "status": "completed" if len(pack_vids) >= 6 else "partial",
                "languages": langs,
                "videos_count": len(pack_vids),
                "by_lang": by_lang,
                "feed": all_feed,
                "reels": all_reels,
                "sample_thumbs": [v["thumb_url"] or v["url"] for v in (all_feed[:3] + all_reels[:3])],
            })

    # Primeiro ordena por pasta + bloco ascendente (Bloco A antes de Bloco B)
    matched_packs.sort(key=lambda p: (p["folder_name"], p["block"]))
    # Depois ordena por data mais nova primeiro (Timsort preserva Bloco A antes de Bloco B)
    matched_packs.sort(key=lambda p: (_pack_date_key(p["folder_name"]), p["folder_name"]), reverse=True)
    return matched_packs


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
            ("video", videos_id, "video_delta_link"),
            ("audio", audios_id, "audio_delta_link"),
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
                for root_dir, _, files in os.walk(entry.path):
                    rel_sub = os.path.relpath(root_dir, entry.path)
                    rel_parts = rel_sub.split(os.sep) if rel_sub != "." else []
                    block_folder, lang_name = _extract_block_and_lang(rel_parts)
                    for fname in files:
                        if fname.lower().endswith(".mp4"):
                            m_num = re.match(r"^(\d+)", fname)
                            num = int(m_num.group(1)) if m_num else 0
                            rel_url_path = "/".join([urllib.parse.quote(p) for p in os.path.relpath(os.path.join(root_dir, fname), videos_dir).split(os.sep)])
                            fpath = os.path.join(root_dir, fname)
                            item_data = {
                                "name": fname,
                                "num": num,
                                "block": block_folder,
                                "lang": lang_name,
                                "size": os.path.getsize(fpath),
                                "url": f"/api/video/{rel_url_path}",
                            }
                            if 1 <= num <= 3:
                                niche["videos"]["feed"].append(item_data)
                            elif 4 <= num <= 9:
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
    def address_string(self):
        # Evita reverse DNS blocking (socket.getfqdn) a cada resposta HTTP
        return self.client_address[0] if self.client_address else "unknown"

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Meta-Token")
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

    def _get_client_ip(self):
        xff = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        if xff:
            return xff
        return self.client_address[0] if self.client_address else "unknown"

    def _read_json_body(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len <= 0:
            return {}
        raw = self.rfile.read(content_len).decode("utf-8")
        return json.loads(raw) if raw else {}

    def _extract_auth_token(self, qs=None, allow_query=False):
        auth_header = (self.headers.get("Authorization") or "").strip()
        if auth_header.lower().startswith("bearer "):
            return auth_header[7:].strip()
        if allow_query and qs:
            q_tok = (qs.get("t", [""])[0] or "").strip()
            if q_tok:
                return q_tok
        return ""

    def _authenticate_request(self, qs=None, allow_media_scope=False, require_admin=False, allow_mcp=False, silent=False):
        raw_tok = self._extract_auth_token(qs=qs, allow_query=allow_media_scope)
        payload = verify_signed_token(raw_tok)
        if not payload:
            if not silent:
                self._send_json({
                    "success": False,
                    "auth_error": True,
                    "code": "AUTH_REQUIRED",
                    "error": "Sessão ausente ou expirada. Faça login novamente."
                }, 401)
            return None

        scope = payload.get("scope", "")
        if scope == "media":
            if not allow_media_scope or require_admin:
                if not silent:
                    self._send_json({"success": False, "auth_error": True, "code": "AUTH_REQUIRED", "error": "Token inválido para esta rota."}, 401)
                return None
            store = load_users_store()
            user = next((u for u in store.get("users", []) if u.get("username") == payload.get("username")), None)
            if not user or int(user.get("pwd_version", 1)) != int(payload.get("pv", 1)) or user.get("must_change_password"):
                if not silent:
                    self._send_json({"success": False, "auth_error": True, "code": "AUTH_REQUIRED", "error": "Sessão expirada."}, 401)
                return None
            return user

        if scope != "session":
            if not silent:
                self._send_json({"success": False, "auth_error": True, "code": "AUTH_REQUIRED", "error": "Token inválido."}, 401)
            return None

        store = load_users_store()
        user = next((u for u in store.get("users", []) if u.get("username") == payload.get("username")), None)
        if not user or int(user.get("pwd_version", 1)) != int(payload.get("pv", 1)):
            if not silent:
                self._send_json({
                    "success": False,
                    "auth_error": True,
                    "code": "SESSION_EXPIRED",
                    "error": "Sua sessão expirou após alteração de senha."
                }, 401)
            return None

        if user.get("must_change_password") and not allow_mcp:
            if not silent:
                self._send_json({
                    "success": False,
                    "auth_error": True,
                    "code": "PASSWORD_CHANGE_REQUIRED",
                    "error": "Você precisa alterar a senha provisória antes de usar o painel."
                }, 403)
            return None

        if require_admin and user.get("role") != "Administrador":
            if not silent:
                self._send_json({"success": False, "error": "Acesso restrito a administradores."}, 403)
            return None

        return user

    def _upload_video_file_to_meta(self, account_id, access_token, title, filename, tmp_path, graph_version="v21.0"):
        import http.client
        boundary = "----TwoDHubBoundary" + uuid.uuid4().hex
        pre_fields = b"".join([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{fn}\"\r\n\r\n{fv}\r\n".encode("utf-8")
            for fn, fv in [("access_token", access_token), ("title", title)]
        ])
        file_header = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"source\"; filename=\"{filename}\"\r\n"
            f"Content-Type: video/mp4\r\n\r\n"
        ).encode("utf-8")
        footer = f"\r\n--{boundary}--\r\n".encode("utf-8")
        file_size = os.path.getsize(tmp_path)
        total_len = len(pre_fields) + len(file_header) + file_size + len(footer)

        conn = http.client.HTTPSConnection("graph-video.facebook.com", timeout=240)
        conn.putrequest("POST", f"/{graph_version}/{account_id}/advideos")
        conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        conn.putheader("Content-Length", str(total_len))
        conn.endheaders()
        conn.send(pre_fields)
        conn.send(file_header)
        with open(tmp_path, "rb") as vf:
            while True:
                chunk = vf.read(1024 * 512)
                if not chunk:
                    break
                conn.send(chunk)
        conn.send(footer)

        resp = conn.getresponse()
        resp_headers = dict(resp.getheaders())
        raw_res = resp.read().decode("utf-8", errors="ignore")
        conn.close()
        scrubbed = _scrub_meta_secret(raw_res, access_token)
        try:
            parsed_vid = json.loads(scrubbed)
        except Exception:
            parsed_vid = {"raw": scrubbed}
        _record_meta_telemetry(resp.status, f"/{graph_version}/{account_id}/advideos", resp_headers, parsed_vid)
        return resp.status, scrubbed

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Meta-Token")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        # --------------------------------------------------------
        # 1. STATUS GERAL DO BACKEND & AUTENTICAÇÃO
        # --------------------------------------------------------
        if path == "/api/status":
            authed_user = self._authenticate_request(silent=True)
            if not authed_user:
                self._send_json({"status": "online", "auth_required": True})
                return

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

        elif path == "/api/auth/me":
            user = self._authenticate_request(allow_mcp=True)
            if not user:
                return
            _, media_tok = _issue_session_tokens(user)
            self._send_json({
                "success": True,
                "must_change_password": bool(user.get("must_change_password", False)),
                "media_token": media_tok,
                "user": safe_user_dict(user),
                "meta_config": get_public_meta_config(),
            })

        elif path == "/api/users":
            admin = self._authenticate_request(require_admin=True)
            if not admin:
                return
            store = load_users_store()
            self._send_json({
                "success": True,
                "users": [safe_user_dict(u) for u in store.get("users", [])],
            })

        # --------------------------------------------------------
        # 2. FLUXO OAUTH2 DO ONEDRIVE (MICROSOFT GRAPH API)
        # --------------------------------------------------------
        elif path == "/api/onedrive/auth":
            admin = self._authenticate_request(require_admin=True)
            if not admin:
                return
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
            if not self._authenticate_request():
                return
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
            if not self._authenticate_request():
                return
            try:
                reload_force = qs.get("reload", ["false"])[0] == "true"
                source_pref = qs.get("source", ["auto"])[0]
                cfg = load_env_vars()
                has_graph = bool(cfg.get("ONEDRIVE_REFRESH_TOKEN"))

                # Sempre prioriza OneDrive Nuvem (Graph API) quando conectado, inclusive localmente
                use_graph = (source_pref == "graph") or (source_pref != "local" and has_graph)

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

        elif path == "/api/onedrive/niche-videos":
            if not self._authenticate_request():
                return
            niche_name = (qs.get("name", [""])[0] or "").strip()
            if not niche_name:
                self._send_json({"success": False, "error": "Parâmetro 'name' obrigatório"}, 400)
                return
            videos, err = fetch_single_niche_videos_from_graph(niche_name)
            if err:
                self._send_json({"success": False, "error": err}, 500)
                return
            self._send_json({"success": True, "niche": niche_name, "videos": videos})

        elif path == "/api/onedrive/folders":
            if not self._authenticate_request():
                return
            q_str = (qs.get("q", [""])[0] or "").strip()
            force_refresh = qs.get("refresh", ["false"])[0].lower() == "true"
            folders = list_onedrive_video_folders(query=q_str, force_refresh=force_refresh)
            self._send_json({"success": True, "count": len(folders), "folders": folders})

        elif path == "/api/onedrive/niche-packs":
            if not self._authenticate_request():
                return
            niche = (qs.get("niche", [""])[0] or qs.get("name", [""])[0] or "").strip()
            if not niche:
                self._send_json({"success": False, "error": "Parâmetro 'niche' obrigatório"}, 400)
                return
            force_refresh = qs.get("refresh", ["false"])[0].lower() == "true"
            packs = find_niche_candidate_packs(niche, force_refresh=force_refresh)
            self._send_json({"success": True, "niche": niche, "packs": packs})

        elif path == "/api/campaign-creatives":
            if not self._authenticate_request():
                return
            data = load_campaign_creatives()
            self._send_json({"success": True, "links": data})

        # --------------------------------------------------------
        # 4. STREAM / DOWNLOAD DIRETO & MINIATURA VIA MICROSOFT GRAPH CDN
        # --------------------------------------------------------
        elif path.startswith("/api/graph/thumb/"):
            if not self._authenticate_request(qs=qs, allow_media_scope=True):
                return
            parts = [p for p in path.replace("/api/graph/thumb/", "").split("/") if p]
            item_id = parts[0] if parts else ""
            if not item_id:
                self._send_json({"error": "ID do item inválido"}, 400)
                return

            size_pref = (qs.get("size", ["medium"])[0] or "medium").lower()
            if size_pref not in ("small", "medium", "large"):
                size_pref = "medium"

            cache_key = f"{item_id}:{size_pref}"
            now_ts = time.time()
            thumb_url = None
            with GRAPH_LOCK:
                cached = GRAPH_THUMB_CACHE.get(cache_key)
                if cached and cached[1] > now_ts:
                    thumb_url = cached[0]

            if not thumb_url:
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"error": err or "Não autenticado"}, 401)
                    return
                res = _graph_get(f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}/thumbnails", tok)
                sets = res.get("value", []) if isinstance(res, dict) else []
                if sets:
                    first_set = sets[0]
                    thumb_url = (
                        (first_set.get(size_pref) or {}).get("url")
                        or (first_set.get("medium") or {}).get("url")
                        or (first_set.get("large") or {}).get("url")
                        or (first_set.get("small") or {}).get("url")
                    )
                if not thumb_url:
                    self._send_json({"error": "Miniatura indisponível", "detail": res}, 404)
                    return
                with GRAPH_LOCK:
                    GRAPH_THUMB_CACHE[cache_key] = (thumb_url, now_ts + 900)

            if qs.get("format", [""])[0] == "json":
                self._send_json({"success": True, "id": item_id, "size": size_pref, "thumb_url": thumb_url})
                return

            self.send_response(302)
            self.send_header("Location", thumb_url)
            self.send_header("Cache-Control", "public, max-age=600")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

        elif path.startswith("/api/graph/file/"):
            if not self._authenticate_request(qs=qs, allow_media_scope=True):
                return
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
            if not self._authenticate_request():
                return
            cfg_meta = get_public_meta_config()
            self._send_json({
                "success": True,
                **cfg_meta,
            })

        elif path == "/api/meta/app-health":
            if not self._authenticate_request():
                return
            try:
                acc_q = (qs.get("account_id", [""])[0] or "").strip()
                manual_tok = (self.headers.get("X-Meta-Token", "") or "").strip()
                report = build_meta_app_health_report(account_id=acc_q, manual_token=manual_tok)
                self._send_json(report)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        # --------------------------------------------------------
        # 5B. TWOD CRIATIVOS STUDIO V2 (ONEDRIVE + FFMPEG NUVEM)
        # --------------------------------------------------------
        elif path == "/api/studio/campaigns":
            if not self._authenticate_request():
                return
            try:
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return
                search_q = (qs.get("search", [""])[0] or "").strip()
                limit_q = int((qs.get("limit", ["20"])[0] or "20"))
                res = studio_engine.list_studio_campaigns_cloud(tok, _find_work_folder_ids, search=search_q, limit=limit_q)
                self._send_json(res, 200 if res.get("success") else 400)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/studio/audit":
            if not self._authenticate_request():
                return
            try:
                camp_q = (qs.get("name", [""])[0] or "").strip()
                if not camp_q:
                    self._send_json({"success": False, "error": "Parâmetro 'name' obrigatório"}, 400)
                    return
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return
                res = studio_engine.audit_campaign_cloud(camp_q, tok, _find_work_folder_ids)
                self._send_json(res)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/studio/render/status":
            if not self._authenticate_request():
                return
            self._send_json(studio_engine.get_render_status_snapshot())

        elif path.startswith("/api/audio/"):
            if not self._authenticate_request(qs=qs, allow_media_scope=True):
                return
            parts = path.replace("/api/audio/", "").split("/")
            if len(parts) >= 2:
                niche_name = parts[0]
                file_name = "/".join(parts[1:])
                filepath = os.path.join(DEFAULT_WORK_DIR, "Arquivos de Áudio", niche_name, file_name)
                self._serve_file(filepath)
            else:
                self._send_json({"error": "Caminho de áudio inválido"}, 400)

        elif path.startswith("/api/video/"):
            if not self._authenticate_request(qs=qs, allow_media_scope=True):
                return
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

        elif path in ["/styles.css", "/app.js", "/studio.js", "/campaign_builder.js", "/privacy.html", "/README.md"]:
            self._serve_file(os.path.join(DASHBOARD_DIR, path.lstrip("/")))

        else:
            self._send_json({"error": "Rota não encontrada"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        qs = parse_qs(parsed.query)

        if path == "/api/auth/login":
            client_ip = self._get_client_ip()
            if not _check_login_rate_limit(client_ip):
                self._send_json({
                    "success": False,
                    "error": "Muitas tentativas inválidas seguidas. Aguarde alguns minutos."
                }, 429)
                return
            try:
                payload = self._read_json_body()
                username = (payload.get("username") or "").strip().lower()
                password = (payload.get("password") or "").strip()
                if not username or not password:
                    self._send_json({"success": False, "error": "Usuário e senha são obrigatórios."}, 400)
                    return

                store = load_users_store()
                user = next((u for u in store.get("users", []) if (u.get("username") or "").lower() == username), None)
                if not user or not verify_password(password, user.get("salt", ""), user.get("password_hash", "")):
                    _record_login_failure(client_ip)
                    self._send_json({"success": False, "error": "Usuário ou senha incorretos."}, 401)
                    return

                _clear_login_failures(client_ip)
                user["lastLogin"] = time.strftime("%d/%m %H:%M")
                save_users_store(store, sync_remote=True, wait_remote=False)

                session_tok, media_tok = _issue_session_tokens(user)
                self._send_json({
                    "success": True,
                    "token": session_tok,
                    "media_token": media_tok,
                    "must_change_password": bool(user.get("must_change_password", False)),
                    "user": safe_user_dict(user),
                    "meta_config": get_public_meta_config(),
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/auth/change-password":
            authed = self._authenticate_request(allow_mcp=True)
            if not authed:
                return
            try:
                payload = self._read_json_body()
                current_pwd = (payload.get("current_password") or "").strip()
                new_pwd = (payload.get("new_password") or "").strip()

                if len(new_pwd) < 6:
                    self._send_json({"success": False, "error": "A nova senha deve ter pelo menos 6 caracteres."}, 400)
                    return

                cfg = load_env_vars()
                initial_pwd = cfg.get("HUB_INITIAL_PASSWORD", "").strip() or "123456"
                if new_pwd == initial_pwd or new_pwd == "123456":
                    self._send_json({"success": False, "error": "Escolha uma senha pessoal diferente da senha padrão inicial."}, 400)
                    return

                store = load_users_store()
                user = next((u for u in store.get("users", []) if u.get("username") == authed.get("username")), None)
                if not user:
                    self._send_json({"success": False, "error": "Usuário não encontrado."}, 404)
                    return

                if not user.get("must_change_password", False):
                    if not verify_password(current_pwd, user.get("salt", ""), user.get("password_hash", "")):
                        self._send_json({"success": False, "error": "Senha atual incorreta."}, 400)
                        return

                if verify_password(new_pwd, user.get("salt", ""), user.get("password_hash", "")):
                    self._send_json({"success": False, "error": "A nova senha deve ser diferente da senha atual."}, 400)
                    return

                new_salt, new_hash = hash_password(new_pwd)
                user["salt"] = new_salt
                user["password_hash"] = new_hash
                user["must_change_password"] = False
                user["pwd_version"] = int(user.get("pwd_version", 1)) + 1
                synced_cloud = save_users_store(store, sync_remote=True, wait_remote=True)

                session_tok, media_tok = _issue_session_tokens(user)
                self._send_json({
                    "success": True,
                    "token": session_tok,
                    "media_token": media_tok,
                    "must_change_password": False,
                    "synced_cloud": bool(synced_cloud),
                    "user": safe_user_dict(user),
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/users/preferences":
            authed = self._authenticate_request()
            if not authed:
                return
            try:
                payload = self._read_json_body()
                store = load_users_store()
                user = next((u for u in store.get("users", []) if u.get("username") == authed.get("username")), None)
                if not user:
                    self._send_json({"success": False, "error": "Usuário não encontrado."}, 404)
                    return
                if payload.get("themeMode") in ("light", "dark", "auto"):
                    user["themeMode"] = payload["themeMode"]
                if "scheduleStart" in payload:
                    user["scheduleStart"] = str(payload["scheduleStart"])[:5]
                if "scheduleEnd" in payload:
                    user["scheduleEnd"] = str(payload["scheduleEnd"])[:5]
                save_users_store(store, sync_remote=True, wait_remote=False)
                self._send_json({"success": True, "user": safe_user_dict(user)})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/users":
            admin = self._authenticate_request(require_admin=True)
            if not admin:
                return
            try:
                payload = self._read_json_body()
                name = (payload.get("name") or "").strip()
                raw_uname = (payload.get("username") or name).strip().lower().replace(" ", "")
                pwd = (payload.get("password") or "123456").strip()
                role = payload.get("role") if payload.get("role") in ("Administrador", "Operador") else "Operador"
                if not name or not raw_uname:
                    self._send_json({"success": False, "error": "Nome e usuário obrigatórios."}, 400)
                    return
                if len(pwd) < 6:
                    self._send_json({"success": False, "error": "Senha provisória deve ter pelo menos 6 caracteres."}, 400)
                    return

                store = load_users_store()
                if any((u.get("username") or "").lower() == raw_uname for u in store.get("users", [])):
                    self._send_json({"success": False, "error": "Este nome de usuário já existe."}, 400)
                    return

                salt, p_hash = hash_password(pwd)
                new_user = {
                    "id": f"usr_{int(time.time() * 1000)}",
                    "username": raw_uname,
                    "name": name,
                    "role": role,
                    "salt": salt,
                    "password_hash": p_hash,
                    "must_change_password": True,
                    "pwd_version": 1,
                    "themeMode": "dark",
                    "scheduleStart": "06:00",
                    "scheduleEnd": "18:00",
                    "lastLogin": "Nunca",
                }
                store["users"].append(new_user)
                save_users_store(store, sync_remote=True, wait_remote=True)
                self._send_json({"success": True, "user": safe_user_dict(new_user)})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/users/reset-password":
            admin = self._authenticate_request(require_admin=True)
            if not admin:
                return
            try:
                payload = self._read_json_body()
                target_uname = (payload.get("username") or "").strip().lower()
                new_pwd = (payload.get("new_password") or "123456").strip()
                if not target_uname or len(new_pwd) < 6:
                    self._send_json({"success": False, "error": "Usuário e nova senha (mín. 6 caracteres) obrigatórios."}, 400)
                    return

                store = load_users_store()
                target = next((u for u in store.get("users", []) if (u.get("username") or "").lower() == target_uname), None)
                if not target:
                    self._send_json({"success": False, "error": "Usuário não encontrado."}, 404)
                    return

                salt, p_hash = hash_password(new_pwd)
                target["salt"] = salt
                target["password_hash"] = p_hash
                target["must_change_password"] = True
                target["pwd_version"] = int(target.get("pwd_version", 1)) + 1
                save_users_store(store, sync_remote=True, wait_remote=True)
                self._send_json({"success": True, "user": safe_user_dict(target)})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/users/delete":
            admin = self._authenticate_request(require_admin=True)
            if not admin:
                return
            try:
                payload = self._read_json_body()
                target_uname = (payload.get("username") or "").strip().lower()
                if not target_uname or target_uname == admin.get("username"):
                    self._send_json({"success": False, "error": "Operação inválida para o usuário informado."}, 400)
                    return
                store = load_users_store()
                store["users"] = [u for u in store.get("users", []) if (u.get("username") or "").lower() != target_uname]
                save_users_store(store, sync_remote=True, wait_remote=True)
                self._send_json({"success": True})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/meta/config":
            admin = self._authenticate_request(require_admin=True)
            if not admin:
                return
            try:
                payload = self._read_json_body()
                is_cloud = bool(os.environ.get("RENDER") or os.environ.get("RAILWAY_ENVIRONMENT"))
                updates = {}
                if "default_account_id" in payload:
                    updates["DEFAULT_AD_ACCOUNT_ID"] = payload["default_account_id"]
                if "meta_access_token" in payload:
                    tok_val = str(payload["meta_access_token"] or "").strip()
                    if tok_val:
                        updates["META_ACCESS_TOKEN"] = tok_val
                    elif not is_cloud:
                        updates["META_ACCESS_TOKEN"] = ""
                if "gemini_api_key" in payload:
                    g_val = str(payload["gemini_api_key"] or "").strip()
                    if g_val:
                        updates["GEMINI_API_KEY"] = g_val
                    elif not is_cloud:
                        updates["GEMINI_API_KEY"] = ""
                if "cloudflare_account_id" in payload:
                    cf_acc = str(payload["cloudflare_account_id"] or "").strip()
                    if cf_acc:
                        updates["CLOUDFLARE_ACCOUNT_ID"] = cf_acc
                    elif not is_cloud:
                        updates["CLOUDFLARE_ACCOUNT_ID"] = ""
                if "cloudflare_api_token" in payload:
                    cf_tok = str(payload["cloudflare_api_token"] or "").strip()
                    if cf_tok:
                        updates["CLOUDFLARE_API_TOKEN"] = cf_tok
                    elif not is_cloud:
                        updates["CLOUDFLARE_API_TOKEN"] = ""

                if updates:
                    save_env_vars(updates)
                env_vars = load_env_vars()
                self._send_json({
                    "success": True,
                    "has_server_token": bool(env_vars.get("META_ACCESS_TOKEN", "").strip()),
                    "has_gemini_key": bool(env_vars.get("GEMINI_API_KEY", "").strip()),
                    "has_cloudflare": bool(env_vars.get("CLOUDFLARE_ACCOUNT_ID", "").strip() and env_vars.get("CLOUDFLARE_API_TOKEN", "").strip()),
                    "is_cloud": is_cloud,
                    "message": "Salvo no ambiente em memória. Para fixar em nuvem definitivamente, configure nas Environment Variables do Render." if is_cloud else "Configurações salvas no .env local.",
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/meta/graph":
            authed = self._authenticate_request()
            if not authed:
                return
            try:
                payload = self._read_json_body()
                status_code, res_json = _execute_meta_graph_request(
                    payload.get("method", "GET"),
                    payload.get("path", ""),
                    payload.get("params"),
                    payload.get("manual_token", ""),
                )
                self._send_json(res_json, status_code)
            except Exception as e:
                self._send_json({"error": {"message": str(e)}}, 500)

        elif path == "/api/meta/app-health/ack":
            authed = self._authenticate_request()
            if not authed:
                return
            try:
                payload = self._read_json_body()
                action = str(payload.get("action") or "").strip().lower()
                audit = load_meta_health_audit()
                if action == "duc_checked":
                    audit["last_duc_check_ts"] = time.time()
                    audit["last_duc_check_at"] = time.strftime("%d/%m/%Y %H:%M")
                    audit["last_duc_checked_by"] = authed.get("name") or authed.get("username") or "equipe"
                    save_meta_health_audit(audit)
                elif action == "toggle_backup":
                    audit["backup_app_ready"] = bool(payload.get("ready", not audit.get("backup_app_ready", False)))
                    save_meta_health_audit(audit)
                elif action == "reset_circuit":
                    with META_GUARD_LOCK:
                        META_GUARD_STATE["circuit_open_until"] = 0.0
                        META_GUARD_STATE["circuit_reason"] = ""
                        META_GUARD_STATE["circuit_code"] = None
                        META_GUARD_STATE["throttle_delay_ms"] = 0
                        META_GUARD_STATE["token_blocked"] = False
                        META_GUARD_STATE["token_blocked_reason"] = ""
                        META_GUARD_STATE["dev_mode_blocked"] = False
                else:
                    self._send_json({"success": False, "error": "Ação inválida."}, 400)
                    return

                acc_id = str(payload.get("account_id") or "").strip()
                manual_tok = str(payload.get("manual_token") or self.headers.get("X-Meta-Token", "") or "").strip()
                report = build_meta_app_health_report(account_id=acc_id, manual_token=manual_tok)
                self._send_json(report)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/meta/upload-video":
            authed = self._authenticate_request()
            if not authed:
                return
            try:
                payload = self._read_json_body()
                account_id = payload.get("account_id", "").strip()
                access_token = resolve_meta_token(payload.get("access_token", ""))
                title = payload.get("title", "criativo.mp4").strip()
                local_path_rel = payload.get("local_url", "").strip()
                graph_item_id = payload.get("graph_item_id", "").strip()
                graph_version = payload.get("graph_version", "v21.0").strip()

                if not account_id or not access_token:
                    self._send_json({"success": False, "error": "account_id e META_ACCESS_TOKEN obrigatórios"}, 400)
                    return

                filename = os.path.basename(local_path_rel) if local_path_rel else (title if title.endswith(".mp4") else f"{title}.mp4")
                tmp_path = None
                cleanup_tmp = False

                try:
                    if local_path_rel.startswith("/api/video/"):
                        parts = unquote(local_path_rel.replace("/api/video/", "")).split("/")
                        if len(parts) >= 2:
                            filepath = os.path.join(DEFAULT_WORK_DIR, "Vídeos", *parts)
                            if os.path.isfile(filepath):
                                tmp_path = filepath
                    elif graph_item_id:
                        tok, err = get_graph_access_token()
                        if not tok:
                            self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                            return
                        meta = _graph_get(f"https://graph.microsoft.com/v1.0/me/drive/items/{graph_item_id}", tok)
                        dl_url = meta.get("@microsoft.graph.downloadUrl") or meta.get("@content.downloadUrl")
                        if dl_url:
                            fd, tmp_path = tempfile.mkstemp(prefix="twod_vid_", suffix=".mp4")
                            os.close(fd)
                            cleanup_tmp = True
                            with urllib.request.urlopen(dl_url, timeout=180) as vr, open(tmp_path, "wb") as tf:
                                shutil.copyfileobj(vr, tf, length=1024 * 512)

                    if not tmp_path or not os.path.isfile(tmp_path):
                        self._send_json({"success": False, "error": "Arquivo de vídeo não encontrado para upload"}, 404)
                        return

                    resp_status, raw_res = self._upload_video_file_to_meta(
                        account_id, access_token, title, filename, tmp_path, graph_version
                    )
                    if 200 <= resp_status < 300:
                        self._send_json({"success": True, "result": json.loads(raw_res)})
                    else:
                        self._send_json({"success": False, "error": raw_res}, resp_status)
                finally:
                    if cleanup_tmp and tmp_path and os.path.exists(tmp_path):
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/meta/upload-video-binary":
            authed = self._authenticate_request()
            if not authed:
                return
            tmp_path = None
            try:
                account_id = (qs.get("account_id", [""])[0] or "").strip()
                title = (qs.get("title", ["video.mp4"])[0] or "video.mp4").strip()
                filename = os.path.basename((qs.get("filename", [title])[0] or title).strip()) or "video.mp4"
                graph_version = (qs.get("graph_version", ["v21.0"])[0] or "v21.0").strip()
                manual_tok = (self.headers.get("X-Meta-Token") or "").strip()
                access_token = resolve_meta_token(manual_tok)

                if not account_id or not access_token:
                    self._send_json({"success": False, "error": "account_id e META_ACCESS_TOKEN obrigatórios"}, 400)
                    return

                content_len = int(self.headers.get("Content-Length", 0))
                if content_len <= 0:
                    self._send_json({"success": False, "error": "Corpo de vídeo vazio."}, 400)
                    return

                fd, tmp_path = tempfile.mkstemp(prefix="twod_up_", suffix=".mp4")
                os.close(fd)
                remaining = content_len
                with open(tmp_path, "wb") as tf:
                    while remaining > 0:
                        chunk = self.rfile.read(min(remaining, 1024 * 512))
                        if not chunk:
                            break
                        tf.write(chunk)
                        remaining -= len(chunk)

                resp_status, raw_res = self._upload_video_file_to_meta(
                    account_id, access_token, title, filename, tmp_path, graph_version
                )
                if 200 <= resp_status < 300:
                    self._send_json({"success": True, "result": json.loads(raw_res)})
                else:
                    self._send_json({"success": False, "error": raw_res}, resp_status)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

        elif path == "/api/translate":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                texts = payload.get("texts", [])
                target_lang = (payload.get("target_lang") or "es").strip()
                source_lang = (payload.get("source_lang") or "pt").strip()

                tl_map = {"iw": "he", "tl": "fil"}
                tl_code = tl_map.get(target_lang, target_lang)

                translated = [_translate_single_text(txt, source_lang, tl_code) for txt in texts]

                self._send_json({"success": True, "target_lang": target_lang, "translations": translated})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/campaign-creatives":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                camp_id = str(payload.get("campaign_id", "")).strip()
                if not camp_id:
                    self._send_json({"success": False, "error": "campaign_id obrigatório"}, 400)
                    return
                current = load_campaign_creatives()
                if payload.get("delete"):
                    if camp_id in current:
                        del current[camp_id]
                        save_campaign_creatives(current)
                    self._send_json({"success": True, "deleted": camp_id})
                    return

                current[camp_id] = {
                    "campaign_id": camp_id,
                    "campaign_name": payload.get("campaign_name", ""),
                    "pack_id": payload.get("pack_id", "") or payload.get("niche_pack", ""),
                    "niche_pack": payload.get("niche_pack", ""),
                    "folder_name": payload.get("folder_name", ""),
                    "block": payload.get("block", ""),
                    "niche_slug": payload.get("niche_slug", ""),
                    "account_id": payload.get("account_id", ""),
                    "thumbs": payload.get("thumbs", []),
                    "languages": payload.get("languages", []),
                    "linked_at": time.strftime("%Y-%m-%d %H:%M:%S")
                }
                save_campaign_creatives(current)
                self._send_json({"success": True, "link": current[camp_id]})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        # --------------------------------------------------------
        # 5B. POSTS DO TWOD CRIATIVOS STUDIO V2
        # --------------------------------------------------------
        elif path == "/api/studio/create-campaign":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                niche = (payload.get("niche") or "").strip()
                date_str = (payload.get("date") or "").strip()
                use_blocks = bool(payload.get("use_blocks", True))
                create_audio = bool(payload.get("create_audio", True))
                create_video = bool(payload.get("create_video", True))
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return
                res = studio_engine.create_campaign_folders_cloud(
                    niche, date_str, use_blocks, tok, _find_work_folder_ids,
                    create_audio=create_audio, create_video=create_video,
                )
                threading.Thread(target=start_graph_sync_background, kwargs={"force_full": False}, daemon=True).start()
                self._send_json(res)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 400 if isinstance(e, ValueError) else 500)

        elif path == "/api/studio/generate-audios":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                camp = str(payload.get("campaign") or "").strip()
                date_str = str(payload.get("date") or "").strip()
                script_pt = str(payload.get("script_pt") or "").strip()
                langs = payload.get("languages") or ["pt", "es", "en"]
                voice = str(payload.get("voice") or "Kore").strip()
                style = str(payload.get("style") or "").strip()
                pretranslated = payload.get("translations") if isinstance(payload.get("translations"), dict) else {}
                audio_folder_id = str(payload.get("audio_folder_id") or "").strip()
                gemini_key = str(payload.get("gemini_api_key") or "").strip() or load_env_vars().get("GEMINI_API_KEY", "").strip()

                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return

                res = studio_engine.generate_audios_to_onedrive_cloud(
                    camp, date_str, script_pt, langs, voice, style, gemini_key,
                    _translate_single_text, tok, _find_work_folder_ids,
                    pretranslated_map=pretranslated,
                    audio_folder_id=audio_folder_id,
                )

                # Atualiza cache local do OneDrive com os novos MP3s gerados
                if res.get("generated"):
                    camp_key = res["campaign_name"]
                    with GRAPH_LOCK:
                        nmap = GRAPH_SYNC_STATE["niches_map"]
                        nobj = nmap.setdefault(camp_key, {
                            "name": camp_key,
                            "audios": [],
                            "videos": {"feed": [], "reels": []},
                            "status": "pending",
                            "source": "graph",
                        })
                        for g in res["generated"]:
                            lc = g["lang_code"].upper()
                            nobj["audios"] = [a for a in nobj["audios"] if (a.get("lang") or "").upper() != lc]
                            nobj["audios"].append({
                                "id": g["item_id"],
                                "name": g["filename"],
                                "lang": lc,
                                "size": 0,
                                "url": g["url"],
                            })
                        _recompute_niche_status(nobj)
                    _save_graph_cache_to_disk()

                self._send_json(res, 200 if res.get("success") else 400)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 400 if isinstance(e, ValueError) else 500)

        elif path == "/api/studio/upload-audio":
            if not self._authenticate_request():
                return
            tmp_path = None
            try:
                camp = (qs.get("campaign", [""])[0] or "").strip()
                date_str = (qs.get("date", [""])[0] or "").strip()
                lang = (qs.get("lang", [""])[0] or "").strip()
                filename = os.path.basename((qs.get("filename", ["audio.mp3"])[0] or "audio.mp3").strip())
                content_len = int(self.headers.get("Content-Length", "0") or 0)
                if content_len <= 0 or content_len > 100 * 1024 * 1024:
                    self._send_json({"success": False, "error": "Tamanho de arquivo de áudio inválido (máx 100MB)."}, 400)
                    return
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return

                fd, tmp_path = tempfile.mkstemp(prefix="twod_aud_", suffix=os.path.splitext(filename)[1] or ".mp3")
                os.close(fd)
                remaining = content_len
                with open(tmp_path, "wb") as tf:
                    while remaining > 0:
                        chunk = self.rfile.read(min(remaining, 1024 * 256))
                        if not chunk:
                            break
                        tf.write(chunk)
                        remaining -= len(chunk)

                res = studio_engine.upload_audio_to_onedrive_cloud(camp, date_str, lang, filename, tmp_path, tok, _find_work_folder_ids)
                threading.Thread(target=start_graph_sync_background, kwargs={"force_full": False}, daemon=True).start()
                self._send_json(res)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 400 if isinstance(e, ValueError) else 500)
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass

        elif path == "/api/studio/stage-file":
            if not self._authenticate_request():
                return
            try:
                batch_id = (qs.get("batch_id", [""])[0] or "").strip()
                filename = os.path.basename((qs.get("filename", ["file.png"])[0] or "file.png").strip())
                if not re.match(r"^[a-zA-Z0-9_-]{4,64}$", batch_id):
                    self._send_json({"success": False, "error": "batch_id inválido."}, 400)
                    return
                content_len = int(self.headers.get("Content-Length", "0") or 0)
                if content_len <= 0 or content_len > 80 * 1024 * 1024:
                    self._send_json({"success": False, "error": "Tamanho de arquivo inválido."}, 400)
                    return
                stage_dir = os.path.join(tempfile.gettempdir(), f"twod_stage_{batch_id}")
                os.makedirs(stage_dir, exist_ok=True)
                dest_path = os.path.join(stage_dir, filename)
                remaining = content_len
                with open(dest_path, "wb") as tf:
                    while remaining > 0:
                        chunk = self.rfile.read(min(remaining, 1024 * 256))
                        if not chunk:
                            break
                        tf.write(chunk)
                        remaining -= len(chunk)
                self._send_json({"success": True, "batch_id": batch_id, "filename": filename, "size": os.path.getsize(dest_path)})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/studio/commit-images":
            if not self._authenticate_request():
                return
            stage_dir = None
            try:
                payload = self._read_json_body()
                batch_id = str(payload.get("batch_id") or "").strip()
                camp = str(payload.get("campaign") or "").strip()
                date_str = str(payload.get("date") or "").strip()
                block = str(payload.get("block") or "").strip()
                lang = str(payload.get("lang") or "pt").strip()
                if not re.match(r"^[a-zA-Z0-9_-]{4,64}$", batch_id):
                    self._send_json({"success": False, "error": "batch_id inválido."}, 400)
                    return
                stage_dir = os.path.join(tempfile.gettempdir(), f"twod_stage_{batch_id}")
                if not os.path.isdir(stage_dir):
                    self._send_json({"success": False, "error": "Nenhum arquivo enviado neste lote."}, 400)
                    return
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return

                staged = [
                    (fn, os.path.join(stage_dir, fn))
                    for fn in sorted(os.listdir(stage_dir))
                    if os.path.isfile(os.path.join(stage_dir, fn))
                ]
                res = studio_engine.upload_standardized_images_cloud(camp, date_str, block, lang, staged, tok, _find_work_folder_ids)
                self._send_json(res)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 400 if isinstance(e, ValueError) else 500)
            finally:
                if stage_dir and os.path.isdir(stage_dir):
                    shutil.rmtree(stage_dir, ignore_errors=True)

        elif path == "/api/studio/import-zip":
            if not self._authenticate_request():
                return
            tmp_zip = None
            try:
                camp = (qs.get("campaign", [""])[0] or "").strip()
                date_str = (qs.get("date", [""])[0] or "").strip()
                content_len = int(self.headers.get("Content-Length", "0") or 0)
                if content_len <= 0 or content_len > 250 * 1024 * 1024:
                    self._send_json({"success": False, "error": "Tamanho de ZIP inválido (máx 250MB)."}, 400)
                    return
                tok, err = get_graph_access_token()
                if not tok:
                    self._send_json({"success": False, "error": err or "OneDrive não autenticado"}, 401)
                    return
                fd, tmp_zip = tempfile.mkstemp(prefix="twod_zipin_", suffix=".zip")
                os.close(fd)
                remaining = content_len
                with open(tmp_zip, "wb") as tf:
                    while remaining > 0:
                        chunk = self.rfile.read(min(remaining, 1024 * 512))
                        if not chunk:
                            break
                        tf.write(chunk)
                        remaining -= len(chunk)
                res = studio_engine.import_zip_to_onedrive_cloud(camp, date_str, tmp_zip, tok, _find_work_folder_ids)
                threading.Thread(target=start_graph_sync_background, kwargs={"force_full": False}, daemon=True).start()
                self._send_json(res)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 400 if isinstance(e, ValueError) else 500)
            finally:
                if tmp_zip and os.path.exists(tmp_zip):
                    try:
                        os.unlink(tmp_zip)
                    except OSError:
                        pass

        elif path == "/api/studio/render/start":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                campaigns = payload.get("campaigns") or []
                options = {
                    "round_duration": payload.get("round_duration", True),
                    "cleanup_translated": payload.get("cleanup_translated", True),
                    "force_overwrite": payload.get("force_overwrite", False),
                    "languages": payload.get("languages") or [],
                }

                def _on_render_done(camp_list):
                    tok, _ = get_graph_access_token()
                    if tok:
                        for c_name in camp_list:
                            try:
                                fetch_single_niche_videos_from_graph(c_name, tok=tok)
                            except Exception:
                                pass
                        _save_graph_cache_to_disk()

                res = studio_engine.start_render_job_async(
                    campaigns, options, get_graph_access_token, _find_work_folder_ids, _on_render_done
                )
                self._send_json(res, 200 if res.get("success") else 400)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/studio/render/pause":
            if not self._authenticate_request():
                return
            res = studio_engine.pause_or_resume_render_job()
            self._send_json(res, 200 if res.get("success") else 400)

        elif path == "/api/studio/render/cancel":
            if not self._authenticate_request():
                return
            res = studio_engine.cancel_render_job()
            self._send_json(res, 200 if res.get("success") else 400)

        elif path == "/api/studio/prepare-creative-plan":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                niche_info = payload.get("niche") or {}
                langs = payload.get("languages") or ["pt", "es", "en"]
                gemini_key = str(payload.get("gemini_api_key") or "").strip() or load_env_vars().get("GEMINI_API_KEY", "").strip()
                plan = cloudflare_image.build_niche_creative_plan(
                    niche_info,
                    target_langs=langs,
                    api_key=gemini_key,
                    translate_fn=_translate_single_text,
                )
                self._send_json({"success": True, **plan})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        elif path == "/api/studio/generate-base-image":
            if not self._authenticate_request():
                return
            try:
                payload = self._read_json_body()
                env_vars = load_env_vars()
                cf_acc = str(payload.get("cloudflare_account_id") or "").strip() or env_vars.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
                cf_tok = str(payload.get("cloudflare_api_token") or "").strip() or env_vars.get("CLOUDFLARE_API_TOKEN", "").strip()
                prompt_en = str(payload.get("prompt_en") or "").strip()
                preferred_model = str(payload.get("model") or "").strip()
                neg = str(payload.get("negative_prompt") or "").strip()
                res = cloudflare_image.generate_clean_image_cf(
                    prompt_en,
                    cf_acc,
                    cf_tok,
                    preferred_model=preferred_model,
                    negative_prompt=neg,
                )
                self._send_json(res)
            except cloudflare_image.CloudflareQuotaError as qe:
                self._send_json({"success": False, "quota_exceeded": True, "error": str(qe)}, 429)
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 400 if isinstance(e, ValueError) else 500)

        else:
            self._send_json({"error": "Rota não encontrada"}, 404)


def run():
    load_graph_cache_from_disk()
    cfg = load_env_vars()
    if cfg.get("ONEDRIVE_REFRESH_TOKEN"):
        # Carrega disco local imediatamente sem bloquear a subida da porta HTTP
        load_users_store(sync_remote=False, allow_seed_fallback=False)

        def _boot_sync():
            try:
                _sync_users_from_onedrive_once(max_attempts=2, timeout=8)
            finally:
                _USERS_BOOT_EVENT.set()
            start_graph_sync_background(force_full=False)

        threading.Thread(target=_boot_sync, daemon=True).start()
    else:
        _USERS_BOOT_EVENT.set()
        load_users_store(sync_remote=False, allow_seed_fallback=True)

    host = "0.0.0.0" if (os.environ.get("RENDER") or os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PORT")) else "127.0.0.1"
    server_address = (host, PORT)
    httpd = ThreadingHTTPServer(server_address, APIHandler)
    print(f"🚀 TwoD Hub Dashboard & Cloud API rodando em http://{host}:{PORT}")
    print(f"📁 Diretório local de referência: {DEFAULT_WORK_DIR}")
    httpd.serve_forever()


if __name__ == "__main__":
    run()
