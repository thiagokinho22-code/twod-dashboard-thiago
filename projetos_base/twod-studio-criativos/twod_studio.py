import os
import sys
import glob
import math
import re
import json
import time
from datetime import datetime
import shutil
import zipfile
import threading
import subprocess
import unicodedata
import customtkinter as ctk
from tkinter import filedialog, messagebox
import imageio_ffmpeg

SESSION_STATE_FILE = os.path.join(os.path.expanduser("~"), ".twod_studio_session.json")

def load_session_state():
    try:
        if os.path.exists(SESSION_STATE_FILE):
            with open(SESSION_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None

def save_session_state(state):
    try:
        with open(SESSION_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def clear_session_state():
    try:
        if os.path.exists(SESSION_STATE_FILE):
            os.remove(SESSION_STATE_FILE)
    except Exception:
        pass

def is_image_valid(filepath):
    """
    Verifica a integridade basica do arquivo de imagem antes de passar ao FFmpeg,
    evitando que imagens truncadas/corrompidas facam o parser entrar em loop infinito.
    """
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
                tail = f.read()
                return b"IEND" in tail
            elif header.startswith(b"\xff\xd8"):
                f.seek(max(0, sz - 32))
                tail = f.read()
                return b"\xff\xd9" in tail
            elif header.startswith(b"RIFF") and b"WEBP" in header:
                return True
        return True
    except Exception:
        return False

def get_ffmpeg_path():
    if getattr(sys, "frozen", False):
        base_path = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        bin_dir = os.path.join(base_path, "imageio_ffmpeg", "binaries")
        if os.path.exists(bin_dir):
            for f in os.listdir(bin_dir):
                if f.startswith("ffmpeg") and f.endswith(".exe"):
                    return os.path.join(bin_dir, f)
        direct_ffmpeg = os.path.join(base_path, "ffmpeg.exe")
        if os.path.exists(direct_ffmpeg):
            return direct_ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return "ffmpeg"

FFMPEG_PATH = get_ffmpeg_path()

BASE_VIDEOS_DIR = r"C:\Users\thiag\OneDrive\Documentos\Trabalho\Vídeos"
BASE_AUDIOS_DIR = r"C:\Users\thiag\OneDrive\Documentos\Trabalho\Arquivos de Áudio"

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

def run_ffmpeg(cmd, capture_stdout=False, timeout=120, process_holder=None):
    """
    Executa o FFmpeg 100% em segundo plano (background silencioso):
    - Oculta completamente qualquer janela de console/CMD (sem popups na tela).
    - Nao rouba o foco do teclado/mouse enquanto o usuario usa outros aplicativos.
    - Define prioridade 'Abaixo do Normal' para nao travar a maquina.
    - Timeout de 120s para impedir travamentos por corrupcao de arquivos.
    - Suporta cancelamento e rastreamento de processo via process_holder.
    """
    startupinfo = None
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NO_WINDOW
        if hasattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS"):
            creationflags |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0  # SW_HIDE (oculta janela)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            startupinfo=startupinfo,
            creationflags=creationflags
        )
        if process_holder is not None and isinstance(process_holder, list):
            process_holder[0] = proc

        stdout, stderr = proc.communicate(timeout=timeout)
        retcode = proc.returncode
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        stdout, stderr = proc.communicate()
        retcode = -1
        err_extra = f"\n[TIMEOUT] FFmpeg excedeu o limite de segurança de {timeout}s e foi cancelado.".encode("utf-8")
        stderr = (stderr or b"") + err_extra
    except Exception as e:
        retcode = -1
        stdout = b""
        stderr = str(e).encode("utf-8")
    finally:
        if process_holder is not None and isinstance(process_holder, list):
            process_holder[0] = None

    class RunResult:
        def __init__(self, code, out, err):
            self.returncode = code
            self.stdout = out
            self.stderr = err

    return RunResult(retcode, stdout, stderr)

def get_audio_duration(audio_path):
    """Calcula a duracao exata do audio em segundos usando FFmpeg silencioso."""
    try:
        cmd = [FFMPEG_PATH, "-i", audio_path]
        p = run_ffmpeg(cmd)
        stderr = p.stderr.decode("utf-8", errors="replace")
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", stderr)
        if m:
            h, mins, s = m.groups()
            return int(h) * 3600 + int(mins) * 60 + float(s)
    except Exception:
        pass
    return 15.0

def get_img_dims(path):
    """Obtem dimensoes (largura, altura) da imagem via FFmpeg silencioso."""
    try:
        cmd = [FFMPEG_PATH, "-i", path]
        res = run_ffmpeg(cmd)
        for line in res.stderr.decode("utf-8", errors="replace").splitlines():
            if "Stream #0:0" in line and "Video:" in line:
                m = re.search(r"(\d+)x(\d+)", line)
                if m:
                    return int(m.group(1)), int(m.group(2))
    except Exception:
        pass
    return 1080, 1080

def extract_trailing_num(p):
    """Extrai numero ao final do nome do arquivo para ordenar paginas do Canva."""
    nums = re.findall(r"\d+", os.path.splitext(os.path.basename(p))[0])
    return int(nums[-1]) if nums else 0

def normalize_text(text):
    """Remove acentos e converte para minusculo para busca inteligente."""
    if not text:
        return ""
    return unicodedata.normalize("NFKD", str(text)).encode("ASCII", "ignore").decode("utf-8").lower().strip()

def normalize_folder_key(name):
    """
    Normaliza completamente o nome de pasta/arquivo ignorando maiúsculas/minúsculas,
    acentos, espaços, hífens, underlines e pontos extras para casamento perfeito.
    """
    if not name:
        return ""
    norm = normalize_text(name)
    return re.sub(r"[\s_\-\.]+", "", norm)

def is_master_images_folder(name):
    """Verifica se o nome da pasta corresponde a '1. Imagens' (ignorando maiúsculas, acentos e espaços)."""
    k = normalize_folder_key(name)
    return k in ("1imagens", "1imagem", "imagens", "1imagenspt")

def find_subfolder_ci(parent_dir, target_names):
    """
    Busca uma subpasta dentro de parent_dir ignorando maiúsculas/minúsculas e acentos.
    Retorna (caminho_completo, nome_real_da_subpasta) ou (None, None).
    """
    if not parent_dir or not os.path.isdir(parent_dir):
        return None, None
    if isinstance(target_names, str):
        target_names = [target_names]
    target_keys = {normalize_folder_key(t) for t in target_names}
    try:
        for sub in os.listdir(parent_dir):
            sub_p = os.path.join(parent_dir, sub)
            if os.path.isdir(sub_p) and normalize_folder_key(sub) in target_keys:
                return sub_p, sub
    except Exception:
        pass
    return None, None

def discover_campaign_blocks(camp_path):
    """
    Localiza 'Bloco A' e 'Bloco B' dentro da campanha sem diferenciar maiúsculas/minúsculas ou acentos.
    Retorna lista de tuplas (label_exibicao, caminho_bloco).
    """
    blocks = []
    if not camp_path or not os.path.isdir(camp_path):
        return blocks
    for canonical_label in ["Bloco A", "Bloco B"]:
        bp, real_name = find_subfolder_ci(camp_path, [canonical_label])
        if bp:
            blocks.append((real_name, bp))
    return blocks

def find_matching_audio_folder(camp_name, base_audios_dir=BASE_AUDIOS_DIR):
    """
    Localiza a pasta correspondente em 'Arquivos de Áudio' ignorando totalmente
    diferenças de maiúsculas/minúsculas, acentos, espaços ou pontuação.
    Retorna (caminho_completo_da_pasta, nome_exato_da_pasta_no_disco) ou (None, None).
    """
    if not camp_name or not os.path.exists(base_audios_dir):
        return None, None

    target_key = normalize_folder_key(camp_name)
    try:
        entries = [d for d in os.listdir(base_audios_dir) if os.path.isdir(os.path.join(base_audios_dir, d))]
    except Exception:
        return None, None

    # 1. Casamento exato insensível a maiúsculas/minúsculas, acentos e separadores
    for d in entries:
        if normalize_folder_key(d) == target_key:
            return os.path.join(base_audios_dir, d), d

    # 2. Casamento secundário ignorando apenas acentos e caixa (preservando palavras)
    norm_camp = normalize_text(camp_name)
    for d in entries:
        if normalize_text(d) == norm_camp:
            return os.path.join(base_audios_dir, d), d

    return None, None

def extract_campaign_date(name, mtime=None):
    """
    Extrai a data do nome da pasta da campanha (ex: 'MensagemSecreta 03.11.26', 'Nicho 27-10-2026', 'Nicho 03.11').
    Retorna uma tupla (ano, mes, dia) para ordenação e agrupamento automático por data, ou None se não encontrar.
    """
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
            fallback_year = datetime.fromtimestamp(mtime).year if mtime else datetime.now().year
            return (fallback_year, month, day)

    return None

LANGUAGES_DB = {
    # BLOCO-01: Espanhol
    "es": {
        "name": "Espanhol",
        "code": "es",
        "block": "BLOCO-01 (Espanhol)",
        "keys": [
            "es", "espanhol", "spanish", "espanha", "chile", "argentina", "colombia", "colômbia",
            "venezuela", "peru", "porto rico", "portorico", "costa rica", "costarica", "equador",
            "honduras", "panama", "panamá", "nicaragua", "nicarágua", "el salvador", "elsalvador",
            "guatemala", "republica dominicana", "república dominicana", "repdom", "mexico", "méxico", "bolivia", "bolívia"
        ]
    },
    # BLOCO-02: Europa & Ásia
    "sr": {
        "name": "Sérvio",
        "code": "sr",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["sr", "servio", "sérvio", "serbian", "servia", "sérvia"]
    },
    "it": {
        "name": "Italiano",
        "code": "it",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["it", "italiano", "italian", "italia", "itália"]
    },
    "de": {
        "name": "Alemão",
        "code": "de",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["de", "alemao", "alemão", "german", "alemanha", "suica alemao", "suíça alemão", "luxemburgo", "austria", "áustria"]
    },
    "nl": {
        "name": "Holandês",
        "code": "nl",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["nl", "holandes", "holandês", "dutch", "holanda", "belgica holandes", "bélgica holandês", "belgica", "bélgica"]
    },
    "ro": {
        "name": "Romeno",
        "code": "ro",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["ro", "romeno", "romanian", "romenia", "romênia"]
    },
    "hu": {
        "name": "Húngaro",
        "code": "hu",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["hu", "hungaro", "húngaro", "hungarian", "hungria"]
    },
    "cs": {
        "name": "Tcheco",
        "code": "cs",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["cs", "cz", "tcheco", "czech", "republica tcheca", "república tcheca"]
    },
    "sk": {
        "name": "Eslovaco",
        "code": "sk",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["sk", "eslovaco", "slovak", "eslovaquia", "eslováquia"]
    },
    "hi": {
        "name": "Hindi",
        "code": "hi",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["hi", "hindi", "india", "índia", "indiano"]
    },
    "id": {
        "name": "Indonésio",
        "code": "id",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["id", "indonesio", "indonésio", "indonesian", "indonesia", "indonésia"]
    },
    "ur": {
        "name": "Urdu",
        "code": "ur",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["ur", "urdu", "urdur", "paquistao", "paquistão", "pakistan"]
    },
    "pl": {
        "name": "Polonês",
        "code": "pl",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["pl", "polones", "polonês", "polish", "polonia", "polônia"]
    },
    "uk": {
        "name": "Ucraniano",
        "code": "uk",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["uk", "ua", "ucraniano", "ukrainian", "ucrania", "ucrânia"]
    },
    "tl": {
        "name": "Filipino",
        "code": "tl",
        "block": "BLOCO-02 (Europa / Ásia)",
        "keys": ["tl", "fil", "filipino", "tagalog", "filipinas"]
    },
    # BLOCO-03: Francês
    "fr": {
        "name": "Francês",
        "code": "fr",
        "block": "BLOCO-03 (Francês)",
        "keys": [
            "fr", "frances", "francês", "french", "franca", "frança", "benin", "burkina faso", "burkinafaso",
            "congo", "costa do marfim", "costadomarfim", "gabao", "gabão", "guine", "guiné", "mali", "senegal",
            "togo", "burundi", "camaroes", "camarões", "canada", "canadá", "haiti", "haïti", "madagascar",
            "suica frances", "suíça francês", "algeria", "algéria", "mauritania", "mauritânia",
            "marrocos frances", "marrocos francês", "tunisia frances", "tunísia francês", "belgica frances", "bélgica francês"
        ]
    },
    # BLOCO-04: Russo
    "ru": {
        "name": "Russo",
        "code": "ru",
        "block": "BLOCO-04 (Russo)",
        "keys": [
            "ru", "russo", "russian", "russia", "rússia", "cazaquistao", "cazaquistão", "uzbequistao", "uzbequistão",
            "belarus", "azerbaijao", "azerbaijão", "tadjiquistao", "tadjiquistão", "quirguistao", "quirguistão",
            "armenia", "armênia", "georgia", "geórgia", "lituania", "lituânia"]
    },
    # BLOCO-05: Árabe
    "ar": {
        "name": "Árabe",
        "code": "ar",
        "block": "BLOCO-05 (Árabe)",
        "keys": [
            "ar", "arabe", "árabe", "arabic", "egito", "marrocos", "marrocos arabe", "marrocos árabe",
            "libia", "líbia", "iraque", "tunisia", "tunísia", "tunisia arabe", "tunísia árabe",
            "palestina", "iemen", "iêmen", "jordania", "jordânia", "algeria arabe", "argelia arabe", "argélia árabe"
        ]
    },
    # BLOCO-06: Inglês
    "en": {
        "name": "Inglês",
        "code": "en",
        "block": "BLOCO-06 (Inglês)",
        "keys": [
            "en", "ingles", "inglês", "english", "irlanda", "africa do sul", "africadosul", "reino unido", "reinounido",
            "uk", "emirados arabes unidos", "emirados árabes unidos", "eau", "nova zelandia", "nova zelândia", "novazelandia",
            "australia", "austrália", "nigeria", "nigéria", "jamaica", "singapura", "estados unidos", "usa"
        ]
    },
    # Base Master: Português
    "pt": {
        "name": "Português",
        "code": "pt",
        "block": "Base Master (Português)",
        "keys": ["pt", "portugues", "português", "portuguese", "brasil", "portugal", "1. imagens", "1. imagens pt"]
    },
    # Outros Idiomas do Acervo
    "bn": {"name": "Bengali", "code": "bn", "block": "Outros Idiomas", "keys": ["bn", "bengali", "bangladesh"]},
    "bg": {"name": "Búlgaro", "code": "bg", "block": "Outros Idiomas", "keys": ["bg", "bulgaro", "búlgaro", "bulgaria", "bulgária"]},
    "zh": {"name": "Chinês", "code": "zh", "block": "Outros Idiomas", "keys": ["zh", "chines", "chinês", "chinese", "china"]},
    "ko": {"name": "Coreano", "code": "ko", "block": "Outros Idiomas", "keys": ["ko", "coreano", "korean", "coreia", "coréia"]},
    "hr": {"name": "Croata", "code": "hr", "block": "Outros Idiomas", "keys": ["hr", "croata", "croatian", "croacia", "croácia"]},
    "da": {"name": "Dinamarquês", "code": "da", "block": "Outros Idiomas", "keys": ["da", "dinamarques", "dinamarquês", "danish", "dinamarca"]},
    "el": {"name": "Grego", "code": "el", "block": "Outros Idiomas", "keys": ["el", "grego", "greek", "grecia", "grécia"]},
    "ja": {"name": "Japonês", "code": "ja", "block": "Outros Idiomas", "keys": ["ja", "japones", "japonês", "japanese", "japao", "japão"]},
    "tr": {"name": "Turco", "code": "tr", "block": "Outros Idiomas", "keys": ["tr", "turco", "turkish", "turquia"]},
    "vi": {"name": "Vietnamita", "code": "vi", "block": "Outros Idiomas", "keys": ["vi", "vietnamita", "vietnamese", "vietnam", "vietnã"]},
}

def identify_language_from_name(name):
    """Identifica o codigo do idioma a partir do nome de pasta ou arquivo de audio."""
    if not name:
        return None
    norm_name = normalize_text(name)
    base_no_ext = os.path.splitext(norm_name)[0]

    # 1. Exact match with code
    for code in LANGUAGES_DB:
        if base_no_ext == code:
            return code

    # 2. Check suffix or prefix with code (ex: 5G_es, adestrar_pt, pt_video)
    for code in LANGUAGES_DB:
        if base_no_ext.endswith(f"_{code}") or base_no_ext.endswith(f"-{code}") or base_no_ext.startswith(f"{code}_"):
            return code

    # 3. Check alias keys in normalized name
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

    # 4. Fallback: substring for longer keys
    for code, info in LANGUAGES_DB.items():
        for k in info["keys"]:
            norm_k = normalize_text(k)
            if len(norm_k) >= 4 and norm_k in base_no_ext:
                return code
    return None

def sort_creatives(image_paths):
    """
    Garante a ordem padrao de criativos do Meta Ads:
    - 1, 2, 3: Criativos Quadrados / Feed (1080x1080 ou similar)
    - 4, 5, 6: Criativos Verticais / Stories / Reels (1080x1920 ou similar)
    Se ja estiverem nomeadas 1.png..6.png, preserva 1 a 6.
    """
    if not image_paths:
        return []

    # Se todas ja forem 1..6
    all_single_digits = True
    for p in image_paths:
        base = os.path.splitext(os.path.basename(p))[0]
        if not re.match(r"^[1-6]$", base):
            all_single_digits = False
            break
    if all_single_digits:
        return sorted(image_paths, key=lambda x: int(os.path.splitext(os.path.basename(x))[0]))

    squares, verticals = [], []
    for p in image_paths:
        w, h = get_img_dims(p)
        if h > w * 1.1:
            verticals.append(p)
        else:
            squares.append(p)

    squares = sorted(squares, key=lambda x: (extract_trailing_num(x), os.path.basename(x).lower()))
    verticals = sorted(verticals, key=lambda x: (extract_trailing_num(x), os.path.basename(x).lower()))
    return squares + verticals

def standardize_folder_images(folder_path):
    """
    Renomeia com segurança as imagens para 1.png..6.png:
    - 1, 2, 3: Quadrado / Feed (aspecto ~ 1:1)
    - 4, 5, 6: Vertical / Reels (aspecto ~ 9:16)
    Retorna (lista_de_imagens, foi_renomeado).
    """
    if not os.path.exists(folder_path):
        return [], False

    exts = (".png", ".jpg", ".jpeg")
    imgs = [os.path.join(folder_path, f) for f in os.listdir(folder_path) if f.lower().endswith(exts)]
    if not imgs:
        return [], False

    # Verifica se ja estao todas no formato exato 1..N
    base_names = set(os.path.splitext(os.path.basename(f))[0] for f in imgs)
    if base_names == set(str(i) for i in range(1, len(imgs) + 1)):
        return sort_creatives(imgs), False

    sorted_imgs = sort_creatives(imgs)

    # Passo 1: Renomear para nomes temporários para evitar conflito de arquivos
    temp_list = []
    for idx, p in enumerate(sorted_imgs, start=1):
        ext = os.path.splitext(p)[1].lower()
        tmp = os.path.join(folder_path, f"__tmp_ren_{idx}{ext}")
        if p != tmp:
            try:
                os.rename(p, tmp)
            except Exception:
                pass
        temp_list.append((idx, tmp, ext))

    # Passo 2: Renomear para 1.ext .. N.ext
    final_list = []
    for idx, tmp, ext in temp_list:
        final = os.path.join(folder_path, f"{idx}{ext}")
        if os.path.exists(final) and final != tmp:
            try:
                os.remove(final)
            except Exception:
                pass
        try:
            os.rename(tmp, final)
            final_list.append(final)
        except Exception:
            final_list.append(tmp)

    return final_list, True

def get_clean_zip_filename(info):
    """
    Decodifica o nome de arquivo de uma entrada ZIP com suporte a UTF-8 (flag 0x800),
    CP437 ou CP1252, evitando caracteres corrompidos em acentos e nomes de pastas.
    """
    raw_name = info.filename
    if not (info.flag_bits & 0x800):
        try:
            raw_name = info.filename.encode("cp437").decode("utf-8")
        except Exception:
            try:
                raw_name = info.filename.encode("cp437").decode("cp1252")
            except Exception:
                pass
    return raw_name.replace("\\", "/").strip("/")

def find_recent_gpt_zips():
    """
    Localiza os arquivos ZIP na pasta Downloads do usuário ordenados por data (mais recente primeiro).
    """
    downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
    results = []
    if not os.path.exists(downloads_dir):
        return results

    try:
        for f in os.listdir(downloads_dir):
            if f.lower().endswith(".zip"):
                full_p = os.path.join(downloads_dir, f)
                try:
                    stat = os.stat(full_p)
                    size_mb = stat.st_size / (1024 * 1024)
                    results.append({
                        "path": full_p,
                        "name": f,
                        "size_mb": size_mb,
                        "mtime": stat.st_mtime,
                        "date_str": datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M")
                    })
                except Exception:
                    pass
        results.sort(key=lambda x: x["mtime"], reverse=True)
    except Exception:
        pass
    return results

def analyze_zip_creatives(zip_path, base_audios_dir=BASE_AUDIOS_DIR):
    """
    Analisa previamente o arquivo ZIP do GPT identificando:
    - Se existe pasta raiz envoltória redundante (para remover prefixo).
    - Agrupamento dos nichos detectados e contagem de imagens.
    - Se o nicho já possui pasta correspondente em 'Arquivos de Áudio'.
    """
    if not zip_path or not os.path.isfile(zip_path):
        return {"valid": False, "error": "Arquivo ZIP não encontrado.", "niches": {}, "total_files": 0}

    try:
        with zipfile.ZipFile(zip_path, "r") as z:
            entries = [e for e in z.infolist() if not e.is_dir()]
            clean_entries = []
            for e in entries:
                cname = get_clean_zip_filename(e)
                if not cname:
                    continue
                # Ignorar metadados do macOS e arquivos ocultos do sistema
                if cname.startswith("__MACOSX") or os.path.basename(cname).startswith("._") or cname.endswith(".DS_Store"):
                    continue
                clean_entries.append((e, cname))

            if not clean_entries:
                return {"valid": False, "error": "O arquivo ZIP está vazio ou não contém arquivos válidos.", "niches": {}, "total_files": 0}

            # Detecta se há pasta raiz única envoltória
            top_dirs = set(c[1].split("/")[0] for c in clean_entries if "/" in c[1])
            strip_prefix = ""
            if len(top_dirs) == 1:
                s_root = list(top_dirs)[0]
                sub_paths = [c[1][len(s_root)+1:] for c in clean_entries if c[1].startswith(s_root + "/")]
                sub_top = set(p.split("/")[0] for p in sub_paths if "/" in p)
                is_direct = any(p.startswith(("Bloco A/", "Bloco B/", "1. Imagens/")) for p in sub_paths)
                if not is_direct and len(sub_top) > 1:
                    strip_prefix = s_root + "/"

            niches = {}
            for entry, cname in clean_entries:
                rel = cname[len(strip_prefix):] if strip_prefix and cname.startswith(strip_prefix) else cname
                parts = rel.split("/")
                if len(parts) > 1:
                    niche_name = parts[0]
                    niches.setdefault(niche_name, []).append((entry, rel))

            if not niches:
                return {"valid": False, "error": "Não foram detectadas pastas organizadas por nicho no arquivo ZIP.", "niches": {}, "total_files": 0}

            niches_details = {}
            for niche_name, file_tuples in niches.items():
                blocks = set()
                langs = set()
                img_count = 0
                for _, rel in file_tuples:
                    p_parts = rel.split("/")
                    if len(p_parts) >= 3:
                        if normalize_folder_key(p_parts[1]) in ("blocoa", "blocob"):
                            blocks.add(p_parts[1])
                            langs.add(p_parts[2])
                        else:
                            langs.add(p_parts[1])
                    if rel.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                        img_count += 1

                matched_folder_path, matched_folder_name = find_matching_audio_folder(niche_name, base_audios_dir)
                audio_matched = (matched_folder_path is not None)
                if not matched_folder_name:
                    matched_folder_name = ""

                niches_details[niche_name] = {
                    "files": file_tuples,
                    "blocks": sorted(list(blocks)),
                    "langs": sorted(list(langs)),
                    "total_imgs": img_count,
                    "audio_matched": audio_matched,
                    "audio_folder": matched_folder_name
                }

            return {
                "valid": True,
                "strip_prefix": strip_prefix,
                "niches": niches_details,
                "total_files": len(clean_entries),
                "error": None
            }
    except Exception as e:
        return {"valid": False, "error": f"Erro ao ler arquivo ZIP: {str(e)}", "niches": {}, "total_files": 0}

def audit_campaign_files(camp_name, camp_path, audios):
    """
    Audita a integridade de uma campanha antes de renderizar:
    - Valida integridade das imagens (is_image_valid) em cada bloco e idioma.
    - Casamento e teste de áudio (get_audio_duration) correspondente em 'Arquivos de Áudio'
      sem diferenciar maiúsculas/minúsculas ou acentos.
    - Verifica se vídeos já foram renderizados previamente.
    """
    audio_folder_path, audio_folder_name = find_matching_audio_folder(camp_name, BASE_AUDIOS_DIR)

    report = {
        "camp_name": camp_name,
        "camp_path": camp_path,
        "video_folder_name": os.path.basename(os.path.normpath(camp_path)),
        "audio_folder_name": audio_folder_name,
        "audio_folder_path": audio_folder_path,
        "blocks": {},
        "total_images": 0,
        "valid_images": 0,
        "corrupt_images": [],
        "missing_audios": [],
        "matched_audios": [],
        "already_rendered_videos": 0,
        "status": "ok",
        "status_desc": ""
    }

    blocks = discover_campaign_blocks(camp_path)
    if not blocks:
        blocks = [("", camp_path)]

    for b_name, bp in blocks:
        b_key = b_name if b_name else "Único"
        report["blocks"][b_key] = {}

        alt_pt, _ = find_subfolder_ci(bp, ["1. Imagens", "1.Imagens", "Imagens"])
        dest_pt_existing, _ = find_subfolder_ci(bp, ["Português", "Portugues"])
        dest_pt = dest_pt_existing if dest_pt_existing else os.path.join(bp, "Português")
        pt_dir = alt_pt if alt_pt else dest_pt_existing

        langs_to_check = []
        if pt_dir:
            langs_to_check.append(("Português", "pt", pt_dir, dest_pt))

        for sub in os.listdir(bp):
            sub_p = os.path.join(bp, sub)
            if not os.path.isdir(sub_p) or is_master_images_folder(sub):
                continue
            code = identify_language_from_name(sub)
            if code and code != "pt":
                lang_name = LANGUAGES_DB[code]["name"]
                langs_to_check.append((lang_name, code, sub_p, sub_p))

        for lang_name, code, src_folder, dest_folder in langs_to_check:
            raw_imgs = [os.path.join(src_folder, f) for f in os.listdir(src_folder) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
            rendered_vids = [os.path.join(dest_folder, f) for f in os.listdir(dest_folder) if f.lower().endswith(".mp4")] if os.path.exists(dest_folder) else []
            report["already_rendered_videos"] += len(rendered_vids)

            valid_imgs = []
            corrupt_imgs = []
            for img_p in raw_imgs:
                if is_image_valid(img_p):
                    valid_imgs.append(img_p)
                else:
                    corrupt_imgs.append(img_p)
                    report["corrupt_images"].append({
                        "path": img_p,
                        "name": os.path.basename(img_p),
                        "folder": src_folder,
                        "lang": lang_name,
                        "block": b_key
                    })

            report["total_images"] += len(raw_imgs)
            report["valid_images"] += len(valid_imgs)

            audio_path = audios.get(lang_name)
            audio_info = None
            if audio_path and os.path.exists(audio_path):
                dur = get_audio_duration(audio_path)
                audio_info = {
                    "path": audio_path,
                    "filename": os.path.basename(audio_path),
                    "duration": dur,
                    "ok": (dur > 0)
                }
                report["matched_audios"].append(audio_info)
            else:
                report["missing_audios"].append({
                    "lang": lang_name,
                    "block": b_key,
                    "camp": camp_name
                })

            report["blocks"][b_key][lang_name] = {
                "folder": src_folder,
                "subfolder_name": os.path.basename(os.path.normpath(src_folder)),
                "imgs_count": len(raw_imgs),
                "valid_imgs_count": len(valid_imgs),
                "corrupt_imgs": corrupt_imgs,
                "rendered_videos": len(rendered_vids),
                "audio": audio_info
            }

    if report["corrupt_images"]:
        report["status"] = "error"
        report["status_desc"] = f"🚨 {len(report['corrupt_images'])} imagem(ns) corrompida(s)!"
    elif report["missing_audios"]:
        report["status"] = "error"
        report["status_desc"] = f"⚠️ Falta áudio para {len(report['missing_audios'])} idioma(s)!"
    elif report["total_images"] == 0 and report["already_rendered_videos"] > 0:
        report["status"] = "warning"
        report["status_desc"] = f"✅ Já renderizado ({report['already_rendered_videos']} vídeos MP4 presentes)."
    elif report["total_images"] == 0:
        report["status"] = "warning"
        report["status_desc"] = "⚠️ Nenhuma imagem bruta encontrada nas pastas."
    else:
        report["status"] = "ok"
        report["status_desc"] = f"✅ 100% Pronto ({report['valid_images']} imagens válidas)"

    return report

class TwodStudioApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("TWOD Criativos Studio V2 - Automação Total de Criativos")
        self.geometry("860x860")
        self.minsize(780, 720)

        self.is_processing = False
        self.is_paused = False
        self.is_cancelled = False
        self.pause_event = threading.Event()
        self.pause_event.set()
        self.current_ffmpeg_proc = [None]
        self.active_mode = None

        self.daily_campaigns = []
        self.campaign_checkboxes = {}
        self.all_discovered_camps = []
        self.campaign_checked_state = {}
        self.campaign_limit = 10
        self._search_after_id = None

        # Manual multi-language state
        self.manual_detected_data = {}
        self.manual_lang_vars = {}
        self.manual_lang_badges = {}
        self.manual_lang_rows = {}

        # Error tracking & resolution state
        self.last_failed_items = []
        self.last_cleanup_candidates = []
        self.last_do_cleanup = False
        self.error_dialog = None
        self.import_zip_dialog = None
        self.checklist_dialog = None

        self._build_ui()
        self._check_previous_session()
        self._scan_daily_campaigns()

    def _build_ui(self):
        # Header Frame
        header = ctk.CTkFrame(self, fg_color="#18191b", corner_radius=0)
        header.pack(fill="x", padx=0, pady=0)

        header_content = ctk.CTkFrame(header, fg_color="transparent")
        header_content.pack(fill="x", padx=25, pady=(16, 4))

        badge = ctk.CTkLabel(
            header_content, 
            text="PRO V2", 
            font=("Segoe UI", 11, "bold"), 
            fg_color="#8b3dff", 
            text_color="#ffffff", 
            corner_radius=6, 
            padx=8, 
            pady=2
        )
        badge.pack(side="left", padx=(0, 10))

        title = ctk.CTkLabel(
            header_content, 
            text="TWOD Criativos Studio", 
            font=("Segoe UI", 20, "bold"), 
            text_color="#ffffff"
        )
        title.pack(side="left")

        sub = ctk.CTkLabel(
            header, 
            text="Gerador Automático de Vídeos MP4 para Meta Ads (Lote dos 3 Nichos do Dia ou Pasta Individual)", 
            font=("Segoe UI", 12), 
            text_color="#94a3b8"
        )
        sub.pack(anchor="w", padx=25, pady=(0, 14))

        # Tabs Container
        self.tabview = ctk.CTkTabview(
            self, 
            fg_color="transparent", 
            segmented_button_selected_color="#8b3dff", 
            segmented_button_selected_hover_color="#7c3aed"
        )
        self.tabview.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        self.tab_batch = self.tabview.add("🚀 Nichos do Dia (Lote Automático)")
        self.tab_single = self.tabview.add("🎯 Modo Manual (Multi-Idiomas)")

        self._build_batch_tab()
        self._build_single_tab()

        # Shared Global Footer / Log Console
        footer = ctk.CTkFrame(self, fg_color="#18191b", corner_radius=0)
        footer.pack(fill="x", side="bottom")

        # Persistent Error Resolution Banner (aparece apenas se houver itens com erro)
        self.error_banner = ctk.CTkFrame(footer, fg_color="#381010", corner_radius=8, border_width=1, border_color="#ef4444")

        self.lbl_error_banner = ctk.CTkLabel(
            self.error_banner, 
            text="🚨 Erros de Renderização", 
            font=("Segoe UI", 12, "bold"), 
            text_color="#fca5a5"
        )
        self.lbl_error_banner.pack(side="left", padx=12, pady=6)

        self.btn_banner_details = ctk.CTkButton(
            self.error_banner,
            text="📋 Abrir Pastas & Detalhes",
            height=28,
            font=("Segoe UI", 11, "bold"),
            fg_color="#ef4444",
            hover_color="#dc2626",
            command=self._show_error_dialog
        )
        self.btn_banner_details.pack(side="right", padx=(4, 10), pady=6)

        self.btn_banner_retry = ctk.CTkButton(
            self.error_banner,
            text="🔁 Reverificar & Renderizar Erros",
            height=28,
            font=("Segoe UI", 11, "bold"),
            fg_color="#10b981",
            hover_color="#059669",
            command=self._retry_failed_items
        )
        self.btn_banner_retry.pack(side="right", padx=4, pady=6)

        self.progress_bar = ctk.CTkProgressBar(footer, fg_color="#2e2f34", progress_color="#10b981", height=10)
        self.progress_bar.set(0)
        self.progress_bar.pack(fill="x", padx=20, pady=(10, 6))

        self.log_text = ctk.CTkTextbox(footer, height=140, font=("Consolas", 11), fg_color="#0d0e11", text_color="#cbd5e1")
        self.log_text.pack(fill="x", padx=20, pady=(0, 10))
        self.log_text.insert("end", "Pronto! Selecione uma opção acima para começar.\n")
        self.log_text.configure(state="disabled")

    def _log(self, msg):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _check_previous_session(self):
        st = load_session_state()
        if st and st.get("status", "").startswith("incompleto_"):
            mode = "Lote Diário" if st.get("mode") == "batch" else "Modo Manual"
            status_desc = "Pausado" if "pausado" in st.get("status") else ("Com Erros" if "erros" in st.get("status") else "Interrompido/Cancelado")
            ts = st.get("timestamp", "")
            self._log(f"⚠️ [SESSÃO ANTERIOR]: Identificada sessão anterior de {mode} ({status_desc} em {ts}).")
            self._log("   💡 Ao iniciar a renderização, os vídeos já prontos serão pulados instantaneamente!")
            if st.get("failed_items"):
                self.last_failed_items = st.get("failed_items", [])
                self.last_cleanup_candidates = st.get("cleanup_candidates", [])
                self.last_do_cleanup = st.get("do_cleanup", False)
                self.after(500, self._update_error_banner)
                self._log(f"   🚨 {len(self.last_failed_items)} erro(s) pendente(s) da sessão anterior. Clique no banner vermelho para abrir a pasta ou reprocessar!")

    def _open_folder_or_file(self, file_path, folder_path):
        """Abre o Windows Explorer selecionando o arquivo com problema ou na pasta correspondente."""
        try:
            if file_path and os.path.exists(file_path):
                subprocess.Popen(f'explorer /select,"{os.path.abspath(file_path)}"')
                return
        except Exception:
            pass
        try:
            if folder_path and os.path.exists(folder_path):
                os.startfile(folder_path)
                return
        except Exception as e:
            self._log(f"⚠️ Não foi possível abrir o local: {e}")

    def _update_error_banner(self):
        """Atualiza a visibilidade e o texto do banner de erro na janela principal."""
        if hasattr(self, "error_banner"):
            if self.last_failed_items:
                count = len(self.last_failed_items)
                self.lbl_error_banner.configure(
                    text=f"🚨 {count} erro(s) pendente(s) de renderização! Imagens originais estão preservadas."
                )
                self.error_banner.pack(fill="x", padx=20, pady=(6, 4), before=self.progress_bar)
            else:
                self.error_banner.pack_forget()

    def _show_error_dialog(self):
        """Abre a janela modal com relatório detalhado de erros e botões de ação direta."""
        if not self.last_failed_items:
            messagebox.showinfo("Tudo Certo", "Não há erros pendentes registrados no momento!")
            return

        if self.error_dialog is not None and self.error_dialog.winfo_exists():
            self.error_dialog.lift()
            self.error_dialog.focus()
            self._populate_error_dialog_cards()
            return

        dialog = ctk.CTkToplevel(self)
        self.error_dialog = dialog
        dialog.title("🚨 Central de Correção de Erros - TWOD Criativos Studio")
        dialog.geometry("740x560")
        dialog.minsize(680, 480)
        dialog.transient(self)

        # Header
        top_frame = ctk.CTkFrame(dialog, fg_color="#18191b", corner_radius=0)
        top_frame.pack(fill="x", padx=0, pady=0)

        t_lbl = ctk.CTkLabel(
            top_frame,
            text="🚨 Central de Resolução de Erros de Renderização",
            font=("Segoe UI", 16, "bold"),
            text_color="#fca5a5"
        )
        t_lbl.pack(anchor="w", padx=20, pady=(14, 2))

        sub_lbl = ctk.CTkLabel(
            top_frame,
            text="Identificamos arquivos que não puderam ser renderizados. Suas imagens originais foram PRESERVADAS intactas.\nClique em 'Abrir Pasta' para substituir/corrigir o arquivo e depois clique em 'Reverificar e Renderizar'.",
            font=("Segoe UI", 11),
            text_color="#94a3b8",
            justify="left"
        )
        sub_lbl.pack(anchor="w", padx=20, pady=(0, 12))

        # Scrollable container for cards
        self.error_scroll = ctk.CTkScrollableFrame(dialog, fg_color="transparent")
        self.error_scroll.pack(fill="both", expand=True, padx=16, pady=10)

        # Bottom Action Bar
        b_bar = ctk.CTkFrame(dialog, fg_color="#18191b", corner_radius=0)
        b_bar.pack(fill="x", side="bottom")

        b_content = ctk.CTkFrame(b_bar, fg_color="transparent")
        b_content.pack(fill="x", padx=16, pady=12)

        btn_retry = ctk.CTkButton(
            b_content,
            text="🔁 REVERIFICAR & RENDERIZAR ERROS",
            font=("Segoe UI", 13, "bold"),
            fg_color="#10b981",
            hover_color="#059669",
            height=42,
            command=self._retry_failed_items
        )
        btn_retry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        btn_refresh = ctk.CTkButton(
            b_content,
            text="🔍 Reverificar Status",
            width=150,
            height=42,
            font=("Segoe UI", 11, "bold"),
            fg_color="#334155",
            hover_color="#475569",
            command=self._populate_error_dialog_cards
        )
        btn_refresh.pack(side="left", padx=(0, 8))

        btn_close = ctk.CTkButton(
            b_content,
            text="✕ Fechar",
            width=90,
            height=42,
            font=("Segoe UI", 11, "bold"),
            fg_color="#27272a",
            hover_color="#3f3f46",
            command=dialog.destroy
        )
        btn_close.pack(side="left")

        self._populate_error_dialog_cards()
        dialog.focus()

    def _populate_error_dialog_cards(self):
        """Renderiza os cards detalhados de cada erro na janela modal."""
        if not hasattr(self, "error_scroll") or not self.error_scroll.winfo_exists():
            return

        for w in self.error_scroll.winfo_children():
            w.destroy()

        if not self.last_failed_items:
            empty_lbl = ctk.CTkLabel(
                self.error_scroll,
                text="🎉 Nenhum erro pendente! Todos os vídeos foram renderizados com sucesso.",
                font=("Segoe UI", 14, "bold"),
                text_color="#10b981"
            )
            empty_lbl.pack(pady=40)
            return

        for idx, item in enumerate(self.last_failed_items, start=1):
            card = ctk.CTkFrame(self.error_scroll, fg_color="#212226", corner_radius=10, border_width=1, border_color="#3f3f46")
            card.pack(fill="x", pady=6)

            h_row = ctk.CTkFrame(card, fg_color="transparent")
            h_row.pack(fill="x", padx=14, pady=(10, 4))

            title = f"{idx}. {item['campaign']} > {item['bloco']} > {item['lang']} > {item['out_name']}"
            lbl_t = ctk.CTkLabel(h_row, text=title, font=("Segoe UI", 13, "bold"), text_color="#f87171")
            lbl_t.pack(side="left")

            btn_open = ctk.CTkButton(
                h_row,
                text="📂 Abrir Pasta / Arquivo",
                height=28,
                width=160,
                font=("Segoe UI", 11, "bold"),
                fg_color="#334155",
                hover_color="#475569",
                command=lambda p=item["img_path"], f=item["folder"]: self._open_folder_or_file(p, f)
            )
            btn_open.pack(side="right")

            # Motivo do erro
            r_box = ctk.CTkFrame(card, fg_color="#18191b", corner_radius=6)
            r_box.pack(fill="x", padx=14, pady=4)

            lbl_r = ctk.CTkLabel(
                r_box,
                text=f"⚠️ Motivo: {item['reason']}",
                font=("Segoe UI", 11),
                text_color="#fca5a5",
                wraplength=660,
                justify="left"
            )
            lbl_r.pack(anchor="w", padx=10, pady=6)

            # Caminho e status atual de integridade
            f_row = ctk.CTkFrame(card, fg_color="transparent")
            f_row.pack(fill="x", padx=14, pady=(2, 10))

            lbl_path = ctk.CTkLabel(
                f_row,
                text=f"Arquivo: {os.path.basename(item['img_path'])} em {item['folder']}",
                font=("Consolas", 10),
                text_color="#94a3b8",
                wraplength=480,
                justify="left"
            )
            lbl_path.pack(side="left")

            # Verifica integridade atual do arquivo em tempo real
            is_now_valid = is_image_valid(item["img_path"])
            if is_now_valid:
                badge_text = "✨ Imagem corrigida! Pronta para gerar"
                badge_color = "#10b981"
            else:
                badge_text = "❌ Ainda corrompida / incompleta"
                badge_color = "#ef4444"

            lbl_badge = ctk.CTkLabel(
                f_row,
                text=badge_text,
                font=("Segoe UI", 11, "bold"),
                text_color=badge_color
            )
            lbl_badge.pack(side="right")

    def _retry_failed_items(self):
        """Inicia a reverificação e o reprocessamento dos itens que falharam anteriormente."""
        if self.is_processing:
            messagebox.showwarning("Aviso", "Já existe um processamento em andamento!")
            return

        if not self.last_failed_items:
            messagebox.showinfo("Tudo Certo", "Não há erros pendentes para reprocessar!")
            return

        self.is_processing = True
        self.is_paused = False
        self.is_cancelled = False
        self.pause_event.set()
        self._update_pause_cancel_ui()

        threading.Thread(target=self._retry_failed_worker, daemon=True).start()

    def _retry_failed_worker(self):
        """Thread trabalhadora para retestar e renderizar apenas os arquivos pendentes."""
        try:
            total_retry = len(self.last_failed_items)
            self._log(f"\n🔁 [REVERIFICAÇÃO] Testando {total_retry} arquivo(s) com erro anterior...")

            resolved_items = []
            still_failed = []

            for idx, item in enumerate(self.last_failed_items, start=1):
                if self.is_cancelled:
                    self._log("⏹️ Reprocessamento cancelado pelo usuário.")
                    break

                img_path = item["img_path"]
                out_path = item["out_path"]
                out_name = item["out_name"]
                lang = item["lang"]
                target_dur = item["target_dur"]
                audio = item["audio"]

                # 1. Verificar se a imagem agora é válida
                if not is_image_valid(img_path):
                    self._log(f"   ❌ [{idx}/{total_retry}] [{lang} > {out_name}] Imagem continua corrompida ou incompleta: {os.path.basename(img_path)}")
                    item["reason"] = f"Imagem '{os.path.basename(img_path)}' ainda inválida/incompleta (substitua o arquivo e tente novamente)"
                    still_failed.append(item)
                    continue

                # 2. Imagem agora é válida! Renderizar com FFmpeg
                self._log(f"   ✨ [{idx}/{total_retry}] [{lang} > {out_name}] Imagem validada com sucesso! Renderizando...")
                cmd = [
                    FFMPEG_PATH,
                    "-loop", "1",
                    "-i", img_path,
                    "-i", audio,
                    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-c:v", "libx264",
                    "-tune", "stillimage",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-af", "apad",
                    "-t", str(target_dur),
                    "-pix_fmt", "yuv420p",
                    "-y",
                    out_path
                ]

                res = run_ffmpeg(cmd, timeout=120, process_holder=self.current_ffmpeg_proc)
                if res.returncode == 0:
                    self._log(f"   ✅ [{idx}/{total_retry}] [{lang} > {out_name}] Vídeo gerado com sucesso!")
                    resolved_items.append(item)
                else:
                    err_msg = res.stderr.decode("utf-8", errors="replace")
                    self._log(f"   ❌ [{idx}/{total_retry}] [{lang} > {out_name}] Erro no FFmpeg: {err_msg[:160]}")
                    item["reason"] = f"Erro no FFmpeg: {err_msg[:120].strip()}"
                    still_failed.append(item)

            self.last_failed_items = still_failed
            self.after(100, self._update_error_banner)
            self.after(100, self._populate_error_dialog_cards)

            if len(still_failed) == 0:
                # 100% de sucesso!
                clear_session_state()
                if self.last_do_cleanup and self.last_cleanup_candidates:
                    deleted_count = 0
                    for img_p in self.last_cleanup_candidates:
                        try:
                            if os.path.exists(img_p):
                                os.remove(img_p)
                                deleted_count += 1
                        except Exception as e:
                            self._log(f"   ⚠️ Aviso ao excluir imagem: {e}")
                    self._log(f"\n🗑️ [LIMPEZA FINAL] Todos os erros foram corrigidos! {deleted_count} imagens originais traduzidas foram removidas com segurança.")

                self.last_cleanup_candidates = []
                self._log(f"\n🎉 SUCESSO TOTAL! Todos os {len(resolved_items)} vídeo(s) com erro foram corrigidos e gerados!\n")
                messagebox.showinfo("Sucesso!", f"Excelente! Todos os {len(resolved_items)} vídeo(s) que estavam pendentes foram corrigidos e gerados com sucesso!")
                if self.error_dialog is not None and self.error_dialog.winfo_exists():
                    self.error_dialog.destroy()
            else:
                self._log(f"\n⚠️ {len(resolved_items)} vídeo(s) corrigido(s). Ainda restam {len(still_failed)} pendência(s).")
                messagebox.showwarning(
                    "Ainda há pendências",
                    f"{len(resolved_items)} vídeo(s) foram corrigidos e gerados com sucesso!\n\nPorém ainda restam {len(still_failed)} item(ns) com erro.\nVerifique os arquivos indicados e tente novamente."
                )

        except Exception as e:
            self._log(f"❌ Erro durante a reverificação: {str(e)}")
            messagebox.showerror("Erro", str(e))

        finally:
            self.is_processing = False
            self.is_paused = False
            self.is_cancelled = False
            self._update_pause_cancel_ui()
            self._update_manual_action_button()

    def _on_pause_clicked(self):
        if not self.is_processing:
            return

        if not self.is_paused:
            self.is_paused = True
            self.pause_event.clear()
            self._update_pause_cancel_ui()
            save_session_state({
                "mode": self.active_mode,
                "status": "incompleto_pausado",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            self._log("\n⏸️ [PAUSADO] Processamento pausado pelo usuário! Status salvo como 'incompleto_pausado'.")
            self._log("   Você pode retomar agora clicando em '▶️ Continuar' ou fechar o programa e finalizar depois.")
        else:
            self.is_paused = False
            self.pause_event.set()
            self._update_pause_cancel_ui()
            self._log("\n▶️ [RETOMANDO] Continuando renderização de onde parou...")

    def _on_cancel_clicked(self):
        if not self.is_processing:
            return

        if messagebox.askyesno("Confirmar Cancelamento", "Deseja realmente interromper e cancelar a renderização atual?\n\nOs vídeos já concluídos serão preservados intactos!"):
            self.is_cancelled = True
            self.is_paused = False
            self.pause_event.set()

            if self.current_ffmpeg_proc[0] is not None:
                try:
                    self.current_ffmpeg_proc[0].kill()
                except Exception:
                    pass

            save_session_state({
                "mode": self.active_mode,
                "status": "incompleto_cancelado",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            self._log("\n⏹️ [CANCELADO] Processamento interrompido pelo usuário! Os vídeos já renderizados foram preservados.")

    def _update_pause_cancel_ui(self):
        if self.is_processing:
            if self.is_paused:
                p_text = "▶️ Continuar"
                p_color = "#10b981"
                p_hover = "#059669"
            else:
                p_text = "⏸️ Pausar"
                p_color = "#f59e0b"
                p_hover = "#d97706"

            if hasattr(self, "btn_batch_pause"):
                self.btn_batch_pause.configure(state="normal", text=p_text, fg_color=p_color, hover_color=p_hover)
                self.btn_batch_cancel.configure(state="normal")
            if hasattr(self, "btn_single_pause"):
                self.btn_single_pause.configure(state="normal", text=p_text, fg_color=p_color, hover_color=p_hover)
                self.btn_single_cancel.configure(state="normal")
        else:
            if hasattr(self, "btn_batch_pause"):
                self.btn_batch_pause.configure(state="disabled", text="⏸️ Pausar", fg_color="#334155", hover_color="#475569")
                self.btn_batch_cancel.configure(state="disabled")
            if hasattr(self, "btn_single_pause"):
                self.btn_single_pause.configure(state="disabled", text="⏸️ Pausar", fg_color="#334155", hover_color="#475569")
                self.btn_single_cancel.configure(state="disabled")

    # =========================================================================
    # TAB 1: BATCH DAILY NICHES
    # =========================================================================
    def _build_batch_tab(self):
        # 1. Action Bottom Bar (FIXO na parte inferior da aba - sempre visivel sem rolagem!)
        action_bar = ctk.CTkFrame(self.tab_batch, fg_color="#18191b", corner_radius=12, border_width=1, border_color="#2e2f34")
        action_bar.pack(side="bottom", fill="x", padx=10, pady=(6, 8))

        act_row = ctk.CTkFrame(action_bar, fg_color="transparent")
        act_row.pack(fill="x", padx=12, pady=10)

        self.btn_run_batch = ctk.CTkButton(
            act_row, 
            text="🚀 GERAR TODOS OS NICHOS MARCADOS (1-CLIQUE)", 
            height=48, 
            font=("Segoe UI", 14, "bold"), 
            fg_color="#8b3dff", 
            hover_color="#7c3aed",
            command=self._start_batch_generation
        )
        self.btn_run_batch.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.btn_batch_verify = ctk.CTkButton(
            act_row,
            text="🔍 Verificar Arquivos",
            width=165,
            height=48,
            font=("Segoe UI", 12, "bold"),
            fg_color="#0d9488",
            hover_color="#0f766e",
            command=self._open_preflight_checklist
        )
        self.btn_batch_verify.pack(side="left", padx=(0, 8))

        self.btn_batch_pause = ctk.CTkButton(
            act_row,
            text="⏸️ Pausar",
            width=110,
            height=48,
            font=("Segoe UI", 12, "bold"),
            fg_color="#334155",
            hover_color="#475569",
            state="disabled",
            command=self._on_pause_clicked
        )
        self.btn_batch_pause.pack(side="left", padx=(0, 8))

        self.btn_batch_cancel = ctk.CTkButton(
            act_row,
            text="⏹️ Cancelar",
            width=110,
            height=48,
            font=("Segoe UI", 12, "bold"),
            fg_color="#ef4444",
            hover_color="#dc2626",
            state="disabled",
            command=self._on_cancel_clicked
        )
        self.btn_batch_cancel.pack(side="left")

        # 2. Scrollable Container para o conteudo da aba
        container = ctk.CTkScrollableFrame(self.tab_batch, fg_color="transparent")
        container.pack(side="top", fill="both", expand=True, padx=10, pady=(5, 4))

        # Header of Batch Tab (Top Card)
        top_card = ctk.CTkFrame(container, fg_color="#212226", corner_radius=12, border_width=1, border_color="#2e2f34")
        top_card.pack(fill="x", pady=(0, 12))

        top_row = ctk.CTkFrame(top_card, fg_color="transparent")
        top_row.pack(fill="x", padx=16, pady=(14, 6))

        self.lbl_batch_title = ctk.CTkLabel(top_row, text="📅 Campanhas / Nichos Detectados", font=("Segoe UI", 15, "bold"), text_color="#f1f5f9")
        self.lbl_batch_title.pack(side="left")

        # Toolbar Row 1: Ações Principais de Pacote e Verificação
        toolbar_row1 = ctk.CTkFrame(top_card, fg_color="transparent")
        toolbar_row1.pack(fill="x", padx=16, pady=(0, 6))

        self.btn_import_gpt_zip = ctk.CTkButton(
            toolbar_row1,
            text="📦 Descompactar ZIP do GPT",
            height=32,
            font=("Segoe UI", 11, "bold"),
            fg_color="#0284c7",
            hover_color="#0369a1",
            command=self._open_import_zip_dialog
        )
        self.btn_import_gpt_zip.pack(side="left", padx=(0, 6))

        self.btn_verify_files = ctk.CTkButton(
            toolbar_row1,
            text="🔍 Verificar Arquivos (Checklist)",
            height=32,
            font=("Segoe UI", 11, "bold"),
            fg_color="#0d9488",
            hover_color="#0f766e",
            command=self._open_preflight_checklist
        )
        self.btn_verify_files.pack(side="left", padx=(0, 6))

        btn_refresh = ctk.CTkButton(
            toolbar_row1, 
            text="🔄 Atualizar (10)", 
            height=32, 
            width=120,
            fg_color="#334155", 
            hover_color="#475569", 
            font=("Segoe UI", 11, "bold"),
            command=self._refresh_campaigns_initial
        )
        btn_refresh.pack(side="left")

        # Toolbar Row 2: Ações de Seleção de Lista
        toolbar_row2 = ctk.CTkFrame(top_card, fg_color="transparent")
        toolbar_row2.pack(fill="x", padx=16, pady=(0, 10))

        btn_select_all = ctk.CTkButton(
            toolbar_row2, 
            text="☑️ Marcar Todos", 
            width=115, 
            height=28, 
            fg_color="#334155", 
            hover_color="#475569", 
            font=("Segoe UI", 11, "bold"),
            command=lambda: self._toggle_all_campaigns(True)
        )
        btn_select_all.pack(side="left", padx=(0, 6))

        btn_unselect_all = ctk.CTkButton(
            toolbar_row2, 
            text="⬜ Desmarcar Todos", 
            width=125, 
            height=28, 
            fg_color="#334155", 
            hover_color="#475569", 
            font=("Segoe UI", 11, "bold"),
            command=lambda: self._toggle_all_campaigns(False)
        )
        btn_unselect_all.pack(side="left", padx=(0, 6))

        btn_clear = ctk.CTkButton(
            toolbar_row2, 
            text="🧹 Limpar Lista", 
            width=105, 
            height=28, 
            fg_color="#334155", 
            hover_color="#475569", 
            font=("Segoe UI", 11, "bold"),
            command=self._clear_campaigns_list
        )
        btn_clear.pack(side="left")

        # Search Bar Row
        search_frame = ctk.CTkFrame(top_card, fg_color="#18191b", corner_radius=8, border_width=1, border_color="#2e2f34")
        search_frame.pack(fill="x", padx=16, pady=(0, 10))

        lbl_search_icon = ctk.CTkLabel(search_frame, text="🔍", font=("Segoe UI", 13))
        lbl_search_icon.pack(side="left", padx=(10, 4))

        self.search_var = ctk.StringVar()
        self.search_var.trace_add("write", lambda *args: self._on_search_change())

        self.search_entry = ctk.CTkEntry(
            search_frame,
            textvariable=self.search_var,
            placeholder_text="Pesquisar nicho ou data (ex: Ansiedade, 27-10)...",
            height=32,
            border_width=0,
            fg_color="transparent",
            font=("Segoe UI", 12)
        )
        self.search_entry.pack(side="left", fill="x", expand=True, padx=4, pady=3)
        self.search_entry.bind("<Return>", lambda e: self._render_campaign_cards())
        self.search_entry.bind("<Escape>", lambda e: self._clear_search())

        self.btn_clear_search = ctk.CTkButton(
            search_frame,
            text="✕ Limpar",
            width=70,
            height=26,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=self._clear_search
        )
        self.btn_clear_search.pack(side="right", padx=(4, 6), pady=3)

        b_desc = ctk.CTkLabel(
            top_card, 
            text="O Studio busca os nichos em 'Trabalho\\Vídeos' e casa automaticamente com os áudios correspondentes (Português, Espanhol, Inglês):", 
            font=("Segoe UI", 12), 
            text_color="#94a3b8",
            wraplength=700,
            justify="left"
        )
        b_desc.pack(anchor="w", padx=16, pady=(0, 12))

        # Checklist container for discovered campaigns
        self.campaigns_list_frame = ctk.CTkFrame(container, fg_color="transparent")
        self.campaigns_list_frame.pack(fill="x", pady=(0, 12))

        # Batch Options Card
        opt_card = ctk.CTkFrame(container, fg_color="#212226", corner_radius=12, border_width=1, border_color="#2e2f34")
        opt_card.pack(fill="x", pady=(0, 14))

        opt_title = ctk.CTkLabel(opt_card, text="⚙️ Regras de Automação do Lote", font=("Segoe UI", 13, "bold"), text_color="#e2e8f0")
        opt_title.pack(anchor="w", padx=16, pady=(12, 6))

        # Option 1: Ceil Duration
        self.chk_batch_round = ctk.CTkCheckBox(
            opt_card, 
            text="Arredondar duração do áudio para cima (ex: 15.23s ➔ 16s com silêncio suave)", 
            font=("Segoe UI", 12, "bold"),
            fg_color="#8b3dff", 
            hover_color="#7c3aed"
        )
        self.chk_batch_round.select()
        self.chk_batch_round.pack(anchor="w", padx=16, pady=(6, 4))

        # Option 2: Image Cleanup (Non-Portuguese only, strictly after 100% completion)
        self.chk_batch_cleanup = ctk.CTkCheckBox(
            opt_card, 
            text="Excluir imagens brutas traduzidas somente após tudo concluído (100% sucesso)", 
            font=("Segoe UI", 12, "bold"),
            fg_color="#8b3dff", 
            hover_color="#7c3aed"
        )
        self.chk_batch_cleanup.select()
        self.chk_batch_cleanup.pack(anchor="w", padx=16, pady=(6, 2))

        lbl_cleanup_hint = ctk.CTkLabel(
            opt_card,
            text="   🛡️ As imagens só são apagadas se NENHUM erro ocorrer e não for pausado/cancelado. '1. Imagens' NUNCA é apagada.",
            font=("Segoe UI", 11),
            text_color="#10b981",
            justify="left"
        )
        lbl_cleanup_hint.pack(anchor="w", padx=16, pady=(0, 6))

        # Option 3: Rename master images in 1. Imagens
        self.chk_batch_rename_master = ctk.CTkCheckBox(
            opt_card, 
            text="Renomear e padronizar imagens de '1. Imagens' para 1 a 6 (1-3 Feed, 4-6 Reels)", 
            font=("Segoe UI", 12, "bold"),
            fg_color="#8b3dff", 
            hover_color="#7c3aed"
        )
        self.chk_batch_rename_master.select()
        self.chk_batch_rename_master.pack(anchor="w", padx=16, pady=(4, 6))

        lbl_direct_info = ctk.CTkLabel(
            opt_card,
            text="📁 Salva os vídeos diretamente na pasta do idioma (1.mp4 a 6.mp4), sem subpastas e sem zip.",
            font=("Segoe UI", 12, "bold"),
            text_color="#38bdf8",
            justify="left"
        )
        lbl_direct_info.pack(anchor="w", padx=16, pady=(6, 14))

    def _on_search_change(self):
        if self._search_after_id:
            try:
                self.after_cancel(self._search_after_id)
            except Exception:
                pass
        self._search_after_id = self.after(160, self._render_campaign_cards)

    def _clear_search(self):
        if hasattr(self, "search_var"):
            self.search_var.set("")
        if hasattr(self, "search_entry"):
            self.search_entry.focus_set()

    def _on_campaign_checked(self, name, var):
        self.campaign_checked_state[name] = var.get()

    def _refresh_campaigns_initial(self):
        if hasattr(self, "search_var") and self.search_var.get():
            self.search_var.set("")
        self._scan_daily_campaigns(reset_limit=True)

    def _load_more_campaigns(self):
        self.campaign_limit += 10
        self._render_campaign_cards()

    def _clear_campaigns_list(self):
        for widget in self.campaigns_list_frame.winfo_children():
            widget.destroy()
        self.daily_campaigns.clear()
        self.campaign_checked_state.clear()
        self.campaign_limit = 10
        if hasattr(self, "search_var"):
            self.search_var.set("")
        if hasattr(self, "lbl_batch_title"):
            self.lbl_batch_title.configure(text="📅 Campanhas / Nichos Detectados (0)")

        empty_card = ctk.CTkFrame(self.campaigns_list_frame, fg_color="#18191b", corner_radius=10, border_width=1, border_color="#2e2f34")
        empty_card.pack(fill="x", pady=8)

        lbl = ctk.CTkLabel(
            empty_card, 
            text="✨ A lista foi limpa!\nClique no botão '🔄 Atualizar (10)' acima para recarregar as pastas.",
            font=("Segoe UI", 12),
            text_color="#94a3b8",
            justify="center"
        )
        lbl.pack(pady=20)
        self._log("🧹 Lista de campanhas limpa.")

    def _toggle_all_campaigns(self, select_all=True):
        if not self.daily_campaigns:
            return
        for c in self.daily_campaigns:
            c["var"].set(select_all)
            self.campaign_checked_state[c["name"]] = select_all
        action_name = "marcadas" if select_all else "desmarcadas"
        self._log(f"Todas as campanhas exibidas foram {action_name}.")

    def _scan_daily_campaigns(self, reset_limit=False, preserve_checked=False):
        if reset_limit:
            self.campaign_limit = 10

        self.all_discovered_camps = []
        if os.path.exists(BASE_VIDEOS_DIR):
            for d in os.listdir(BASE_VIDEOS_DIR):
                p = os.path.join(BASE_VIDEOS_DIR, d)
                if not os.path.isdir(p):
                    continue
                has_blocks = len(discover_campaign_blocks(p)) > 0
                has_direct_langs = any(
                    is_master_images_folder(sub) or (identify_language_from_name(sub) is not None)
                    for sub in os.listdir(p) if os.path.isdir(os.path.join(p, sub))
                )
                has_direct_imgs = any(f.lower().endswith((".png", ".jpg", ".jpeg")) for f in os.listdir(p))
                if has_blocks or has_direct_langs or has_direct_imgs:
                    try:
                        mtime = os.path.getmtime(p)
                    except Exception:
                        mtime = 0
                    self.all_discovered_camps.append((d, mtime, p))

            self.all_discovered_camps.sort(key=lambda x: x[1], reverse=True)

        if not preserve_checked:
            self.campaign_checked_state.clear()
            if self.all_discovered_camps:
                top_name, top_mtime, _ = self.all_discovered_camps[0]
                latest_date = extract_campaign_date(top_name, top_mtime)
                if latest_date is not None:
                    for c_name, c_mtime, _ in self.all_discovered_camps:
                        self.campaign_checked_state[c_name] = (extract_campaign_date(c_name, c_mtime) == latest_date)
                else:
                    latest_mday = datetime.fromtimestamp(top_mtime).date() if top_mtime else None
                    for c_name, c_mtime, _ in self.all_discovered_camps:
                        c_mday = datetime.fromtimestamp(c_mtime).date() if c_mtime else None
                        self.campaign_checked_state[c_name] = (c_mday == latest_mday and latest_mday is not None)

        self._render_campaign_cards()

    def _render_campaign_cards(self):
        # Cancel any pending search debounce
        self._search_after_id = None

        # Clear previous widgets in list frame
        for widget in self.campaigns_list_frame.winfo_children():
            widget.destroy()

        self.daily_campaigns.clear()

        if not os.path.exists(BASE_VIDEOS_DIR):
            lbl = ctk.CTkLabel(self.campaigns_list_frame, text="Pasta 'Trabalho\\Vídeos' não localizada.", text_color="#ef4444")
            lbl.pack(pady=10)
            return

        total_found = len(self.all_discovered_camps)
        if total_found == 0:
            lbl = ctk.CTkLabel(self.campaigns_list_frame, text="Nenhuma campanha encontrada em 'Trabalho\\Vídeos'.", text_color="#94a3b8")
            lbl.pack(pady=10)
            return

        query = self.search_var.get().strip() if hasattr(self, "search_var") else ""
        norm_query = normalize_text(query)

        if norm_query:
            # Filter all discovered campaigns by query
            filtered_camps = [c for c in self.all_discovered_camps if norm_query in normalize_text(c[0])]
            displayed_camps = filtered_camps
            if hasattr(self, "lbl_batch_title"):
                self.lbl_batch_title.configure(text=f"🔍 Busca: '{query}' ({len(displayed_camps)} encontrados)")

            if len(displayed_camps) == 0:
                empty_card = ctk.CTkFrame(self.campaigns_list_frame, fg_color="#18191b", corner_radius=10, border_width=1, border_color="#2e2f34")
                empty_card.pack(fill="x", pady=8)

                lbl = ctk.CTkLabel(
                    empty_card, 
                    text=f"🔍 Nenhum nicho encontrado para '{query}'.\nVerifique o texto digitado ou clique em '✕ Limpar'.",
                    font=("Segoe UI", 12),
                    text_color="#94a3b8",
                    justify="center"
                )
                lbl.pack(pady=20)
                return
        else:
            # Include checked campaigns outside top limit + recent campaigns
            checked_camps = [c for c in self.all_discovered_camps if self.campaign_checked_state.get(c[0], False)]
            recent_camps = self.all_discovered_camps[:self.campaign_limit]
            displayed_names = set()
            displayed_camps = []
            for c in self.all_discovered_camps:
                if c in checked_camps or c in recent_camps:
                    if c[0] not in displayed_names:
                        displayed_names.add(c[0])
                        displayed_camps.append(c)

            if hasattr(self, "lbl_batch_title"):
                self.lbl_batch_title.configure(text=f"📅 Campanhas Detectadas ({len(displayed_camps)} de {total_found})")

        for idx, (camp_name, _, camp_path) in enumerate(displayed_camps):
            # Match audios (case & accent insensitive)
            audios = self._find_audios_for_campaign(camp_name)
            _, matched_audio_folder = find_matching_audio_folder(camp_name, BASE_AUDIOS_DIR)

            # Discover structure and images (with or without Bloco A / Bloco B)
            blocks_info = []
            blocks = discover_campaign_blocks(camp_path)
            if not blocks:
                blocks = [("", camp_path)]

            for b_name, bp in blocks:
                langs_found = []
                # Check for 1. Imagens (Português)
                alt, _ = find_subfolder_ci(bp, ["1. Imagens", "1.Imagens", "Imagens"])
                if alt:
                    pt_imgs = [f for f in os.listdir(alt) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                    if pt_imgs:
                        langs_found.append(f"Português ({len(pt_imgs)})")

                # Scan all other subdirectories for languages
                for sub in os.listdir(bp):
                    sub_p = os.path.join(bp, sub)
                    if not os.path.isdir(sub_p) or is_master_images_folder(sub):
                        continue
                    code = identify_language_from_name(sub)
                    if code:
                        lang_name = LANGUAGES_DB[code]["name"]
                        if lang_name == "Português" and any("Português" in lf for lf in langs_found):
                            continue
                        sub_imgs = [f for f in os.listdir(sub_p) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                        if sub_imgs:
                            langs_found.append(f"{lang_name} ({len(sub_imgs)})")

                if langs_found:
                    tag = f"{b_name}: " if b_name else "Direto: "
                    blocks_info.append(tag + ", ".join(langs_found))

            card = ctk.CTkFrame(self.campaigns_list_frame, fg_color="#18191b", corner_radius=10, border_width=1, border_color="#2e2f34")
            card.pack(fill="x", pady=4)

            # Determine checked state:
            is_checked = self.campaign_checked_state.get(camp_name, False)
            self.campaign_checked_state[camp_name] = is_checked

            chk_var = ctk.BooleanVar(value=is_checked)
            chk = ctk.CTkCheckBox(
                card, 
                text=f"📁 {camp_name}", 
                font=("Segoe UI", 13, "bold"), 
                variable=chk_var,
                fg_color="#8b3dff", 
                hover_color="#7c3aed",
                command=lambda n=camp_name, v=chk_var: self._on_campaign_checked(n, v)
            )
            chk.pack(anchor="w", padx=16, pady=(12, 4))

            audio_folder_str = f"'{matched_audio_folder}'" if matched_audio_folder else "Não encontrada"
            details_text = f"   • Estrutura: {' | '.join(blocks_info) if blocks_info else 'Nenhum criativo encontrado'}\n"
            details_text += f"   • Pasta Áudio: {audio_folder_str}  |  Áudios Casados: {', '.join(audios.keys()) if audios else 'Nenhum áudio casado'}"

            lbl_info = ctk.CTkLabel(card, text=details_text, font=("Consolas", 11), text_color="#94a3b8", justify="left")
            lbl_info.pack(anchor="w", padx=16, pady=(0, 10))

            camp_data = {
                "name": camp_name,
                "path": camp_path,
                "audios": audios,
                "var": chk_var
            }
            self.daily_campaigns.append(camp_data)

        # "Carregar Mais" button if more campaigns exist (only when not searching)
        if not norm_query and len(displayed_camps) < total_found:
            remaining = total_found - len(displayed_camps)
            btn_load_more = ctk.CTkButton(
                self.campaigns_list_frame,
                text=f"➕ Carregar Mais (+10 Pastas) — {remaining} pastas mais antigas disponíveis",
                height=36,
                fg_color="#212226",
                hover_color="#334155",
                font=("Segoe UI", 12, "bold"),
                border_width=1,
                border_color="#3b3d45",
                command=self._load_more_campaigns
            )
            btn_load_more.pack(fill="x", pady=(10, 4))

    def _find_audios_for_campaign(self, camp_name):
        mapping = {}
        target_dir, _ = find_matching_audio_folder(camp_name, BASE_AUDIOS_DIR)

        if target_dir and os.path.exists(target_dir):
            for af in os.listdir(target_dir):
                if af.lower().endswith((".mp3", ".wav", ".m4a", ".aac")):
                    full_p = os.path.join(target_dir, af)
                    code = identify_language_from_name(af)
                    if code and code in LANGUAGES_DB:
                        lang_name = LANGUAGES_DB[code]["name"]
                        mapping[lang_name] = full_p
        return mapping

    # =========================================================================
    # IMPORTADOR INTELIGENTE DE CRIATIVOS DO GPT (ZIP ➔ VÍDEOS)
    # =========================================================================
    def _open_import_zip_dialog(self):
        if self.import_zip_dialog is not None and self.import_zip_dialog.winfo_exists():
            self.import_zip_dialog.lift()
            self.import_zip_dialog.focus()
            return

        dialog = ctk.CTkToplevel(self)
        self.import_zip_dialog = dialog
        dialog.title("📦 Descompactar Criativos do GPT para a Pasta Vídeos")
        dialog.geometry("740x630")
        dialog.minsize(680, 520)
        dialog.transient(self)

        # Header Frame
        top_frame = ctk.CTkFrame(dialog, fg_color="#18191b", corner_radius=0)
        top_frame.pack(fill="x", padx=0, pady=0)

        header_content = ctk.CTkFrame(top_frame, fg_color="transparent")
        header_content.pack(fill="x", padx=20, pady=(14, 4))

        badge = ctk.CTkLabel(
            header_content,
            text="IMPORTADOR GPT",
            font=("Segoe UI", 10, "bold"),
            fg_color="#0284c7",
            text_color="#ffffff",
            corner_radius=6,
            padx=8,
            pady=2
        )
        badge.pack(side="left", padx=(0, 10))

        t_lbl = ctk.CTkLabel(
            header_content,
            text="📦 Descompactar Criativos na Pasta Vídeos",
            font=("Segoe UI", 16, "bold"),
            text_color="#f1f5f9"
        )
        t_lbl.pack(side="left")

        sub_lbl = ctk.CTkLabel(
            top_frame,
            text="O Studio lê o pacote ZIP do ChatGPT e salva os nichos organizados diretamente em 'Trabalho\\Vídeos',\nintegrando-os automaticamente com os áudios correspondentes para geração imediata.",
            font=("Segoe UI", 11),
            text_color="#94a3b8",
            justify="left"
        )
        sub_lbl.pack(anchor="w", padx=20, pady=(0, 12))

        # Main Scrollable Content
        main_content = ctk.CTkScrollableFrame(dialog, fg_color="transparent")
        main_content.pack(fill="both", expand=True, padx=16, pady=(10, 6))

        # File Selector Card
        sel_card = ctk.CTkFrame(main_content, fg_color="#212226", corner_radius=10, border_width=1, border_color="#2e2f34")
        sel_card.pack(fill="x", pady=(0, 10))

        sel_lbl = ctk.CTkLabel(sel_card, text="📂 Arquivo ZIP de Criativos:", font=("Segoe UI", 12, "bold"), text_color="#e2e8f0")
        sel_lbl.pack(anchor="w", padx=16, pady=(10, 4))

        file_row = ctk.CTkFrame(sel_card, fg_color="transparent")
        file_row.pack(fill="x", padx=16, pady=(0, 6))

        zip_var = ctk.StringVar()
        entry_zip = ctk.CTkEntry(file_row, textvariable=zip_var, font=("Segoe UI", 11), height=34, fg_color="#18191b")
        entry_zip.pack(side="left", fill="x", expand=True, padx=(0, 8))

        btn_browse = ctk.CTkButton(
            file_row,
            text="📁 Escolher Outro...",
            width=135,
            height=34,
            font=("Segoe UI", 11, "bold"),
            fg_color="#334155",
            hover_color="#475569"
        )
        btn_browse.pack(side="right")

        lbl_auto_detected = ctk.CTkLabel(sel_card, text="", font=("Segoe UI", 11), text_color="#38bdf8", justify="left")
        lbl_auto_detected.pack(anchor="w", padx=16, pady=(0, 10))

        # Preview Container Frame
        lbl_preview_title = ctk.CTkLabel(main_content, text="📋 Conteúdo Detectado no ZIP:", font=("Segoe UI", 13, "bold"), text_color="#f1f5f9")
        lbl_preview_title.pack(anchor="w", pady=(4, 6))

        preview_cards_frame = ctk.CTkFrame(main_content, fg_color="transparent")
        preview_cards_frame.pack(fill="x", pady=(0, 10))

        # Automation Options Card
        opt_card = ctk.CTkFrame(main_content, fg_color="#212226", corner_radius=10, border_width=1, border_color="#2e2f34")
        opt_card.pack(fill="x", pady=(0, 10))

        chk_auto_select = ctk.CTkCheckBox(
            opt_card,
            text="☑️ Marcar esses nichos automaticamente na lista após extrair (prontos para renderizar)",
            font=("Segoe UI", 12, "bold"),
            fg_color="#8b3dff",
            hover_color="#7c3aed"
        )
        chk_auto_select.select()
        chk_auto_select.pack(anchor="w", padx=16, pady=(12, 6))

        chk_delete_zip = ctk.CTkCheckBox(
            opt_card,
            text="🗑️ Excluir o arquivo ZIP do Downloads após extrair com sucesso (economizar espaço)",
            font=("Segoe UI", 12),
            fg_color="#ef4444",
            hover_color="#dc2626"
        )
        chk_delete_zip.pack(anchor="w", padx=16, pady=(0, 12))

        # Destination info
        dest_card = ctk.CTkFrame(main_content, fg_color="#18191b", corner_radius=8, border_width=1, border_color="#2e2f34")
        dest_card.pack(fill="x", pady=(0, 10))
        lbl_dest = ctk.CTkLabel(
            dest_card,
            text=f"📍 Destino da Extração:\n{BASE_VIDEOS_DIR}",
            font=("Segoe UI", 11),
            text_color="#94a3b8",
            justify="left"
        )
        lbl_dest.pack(anchor="w", padx=14, pady=8)

        # Bottom Bar (Fixed)
        b_bar = ctk.CTkFrame(dialog, fg_color="#18191b", corner_radius=0)
        b_bar.pack(fill="x", side="bottom")

        # Progress elements
        prog_bar = ctk.CTkProgressBar(b_bar, fg_color="#2e2f34", progress_color="#10b981", height=8)
        prog_bar.set(0)

        lbl_status = ctk.CTkLabel(b_bar, text="Aguardando confirmação para extrair...", font=("Segoe UI", 11), text_color="#94a3b8")
        lbl_status.pack(anchor="w", padx=20, pady=(10, 4))

        b_content = ctk.CTkFrame(b_bar, fg_color="transparent")
        b_content.pack(fill="x", padx=16, pady=(0, 12))

        btn_extract = ctk.CTkButton(
            b_content,
            text="📥 EXTRAIR E SALVAR NA PASTA VÍDEOS",
            font=("Segoe UI", 13, "bold"),
            fg_color="#10b981",
            hover_color="#059669",
            height=44
        )
        btn_extract.pack(side="left", fill="x", expand=True, padx=(0, 8))

        btn_cancel = ctk.CTkButton(
            b_content,
            text="✕ Cancelar",
            width=100,
            height=44,
            font=("Segoe UI", 12, "bold"),
            fg_color="#334155",
            hover_color="#475569",
            command=dialog.destroy
        )
        btn_cancel.pack(side="left")

        current_analysis = [None]

        def render_preview(path_to_zip):
            for w in preview_cards_frame.winfo_children():
                w.destroy()

            if not path_to_zip or not os.path.isfile(path_to_zip):
                empty = ctk.CTkFrame(preview_cards_frame, fg_color="#212226", corner_radius=8)
                empty.pack(fill="x", pady=4)
                lbl = ctk.CTkLabel(empty, text="Selecione um arquivo ZIP acima para analisar o conteúdo.", text_color="#94a3b8")
                lbl.pack(pady=16)
                btn_extract.configure(state="disabled")
                current_analysis[0] = None
                return

            analysis = analyze_zip_creatives(path_to_zip)
            current_analysis[0] = analysis

            if not analysis["valid"]:
                err_card = ctk.CTkFrame(preview_cards_frame, fg_color="#381010", corner_radius=8, border_width=1, border_color="#ef4444")
                err_card.pack(fill="x", pady=4)
                lbl = ctk.CTkLabel(err_card, text=f"⚠️ {analysis['error']}", text_color="#fca5a5", font=("Segoe UI", 11, "bold"))
                lbl.pack(padx=14, pady=12)
                btn_extract.configure(state="disabled")
                return

            niches = analysis["niches"]
            for n_name, n_info in niches.items():
                card = ctk.CTkFrame(preview_cards_frame, fg_color="#212226", corner_radius=8, border_width=1, border_color="#2e2f34")
                card.pack(fill="x", pady=3)

                row1 = ctk.CTkFrame(card, fg_color="transparent")
                row1.pack(fill="x", padx=14, pady=(10, 4))

                lbl_n = ctk.CTkLabel(row1, text=f"📁 {n_name}", font=("Segoe UI", 13, "bold"), text_color="#f1f5f9")
                lbl_n.pack(side="left")

                badge_txt = f"{n_info['total_imgs']} imagens"
                lbl_cnt = ctk.CTkLabel(row1, text=badge_txt, font=("Segoe UI", 11, "bold"), fg_color="#8b3dff", text_color="#ffffff", corner_radius=6, padx=8, pady=2)
                lbl_cnt.pack(side="right")

                b_str = ", ".join(n_info["blocks"]) if n_info["blocks"] else "Direto"
                l_str = ", ".join(n_info["langs"]) if n_info["langs"] else "Padrão"
                detail_txt = f"   • Estrutura: {b_str} | Idiomas: {l_str}\n"

                if n_info["audio_matched"]:
                    detail_txt += f"   • Áudio: Encontrado em 'Arquivos de Áudio\\{n_info['audio_folder']}' ✅"
                    lbl_det = ctk.CTkLabel(card, text=detail_txt, font=("Consolas", 11), text_color="#86efac", justify="left")
                else:
                    detail_txt += "   • Áudio: Ainda não localizado na pasta 'Arquivos de Áudio' (adicione depois) ℹ️"
                    lbl_det = ctk.CTkLabel(card, text=detail_txt, font=("Consolas", 11), text_color="#fde047", justify="left")
                lbl_det.pack(anchor="w", padx=14, pady=(0, 10))

            tot_imgs = sum(n["total_imgs"] for n in niches.values())
            lbl_status.configure(text=f"✨ {len(niches)} nicho(s) detectados ({tot_imgs} imagens no total). Pronto para salvar em 'Vídeos'.")
            btn_extract.configure(state="normal")

        def choose_custom_zip():
            downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
            chosen = filedialog.askopenfilename(
                title="Selecione o arquivo ZIP de Criativos do GPT",
                initialdir=downloads_dir if os.path.exists(downloads_dir) else os.getcwd(),
                filetypes=[("Arquivos ZIP", "*.zip"), ("Todos os Arquivos", "*.*")],
                parent=dialog
            )
            if chosen:
                zip_var.set(chosen)
                lbl_auto_detected.configure(text=f"Arquivo selecionado manualmente: {os.path.basename(chosen)}")
                render_preview(chosen)

        btn_browse.configure(command=choose_custom_zip)

        def on_extract_start():
            analysis = current_analysis[0]
            z_path = zip_var.get()
            if not analysis or not analysis["valid"] or not z_path:
                messagebox.showwarning("Aviso", "Selecione um arquivo ZIP válido antes de extrair!", parent=dialog)
                return

            btn_extract.configure(state="disabled", text="⏳ Extraindo Criativos...")
            btn_cancel.configure(state="disabled")
            btn_browse.configure(state="disabled")
            entry_zip.configure(state="disabled")
            prog_bar.pack(fill="x", padx=20, pady=(0, 6), before=lbl_status)
            prog_bar.set(0)

            threading.Thread(
                target=self._extract_zip_worker,
                args=(
                    dialog,
                    z_path,
                    analysis,
                    chk_auto_select.get(),
                    chk_delete_zip.get(),
                    prog_bar,
                    lbl_status,
                    btn_extract,
                    btn_cancel,
                    btn_browse
                ),
                daemon=True
            ).start()

        btn_extract.configure(command=on_extract_start)

        # Detecção inteligente inicial
        recent_zips = find_recent_gpt_zips()
        if recent_zips:
            best_zip = recent_zips[0]
            zip_var.set(best_zip["path"])
            lbl_auto_detected.configure(
                text=f"✨ Arquivo mais recente do Downloads detectado automaticamente ({best_zip['date_str']} - {best_zip['size_mb']:.1f} MB)"
            )
            render_preview(best_zip["path"])
        else:
            render_preview(None)

        dialog.focus()

    def _extract_zip_worker(self, dialog, zip_path, analysis, auto_check, delete_zip, prog_bar, lbl_status, btn_extract, btn_cancel, btn_browse):
        try:
            niches = analysis["niches"]
            total_files = sum(len(n["files"]) for n in niches.values())
            extracted_count = 0
            os.makedirs(BASE_VIDEOS_DIR, exist_ok=True)

            self._log(f"\n📦 [IMPORTAÇÃO ZIP] Descompactando {len(niches)} nicho(s) ({total_files} imagens) diretamente na pasta 'Vídeos'...")

            with zipfile.ZipFile(zip_path, "r") as z:
                for niche_name, n_info in niches.items():
                    for entry, rel_path in n_info["files"]:
                        # Proteção obrigatória contra ZipSlip
                        target_path = os.path.normpath(os.path.join(BASE_VIDEOS_DIR, rel_path))
                        if not target_path.startswith(os.path.normpath(BASE_VIDEOS_DIR)):
                            continue

                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        with z.open(entry) as src, open(target_path, "wb") as dst:
                            shutil.copyfileobj(src, dst)

                        extracted_count += 1
                        pct = extracted_count / max(1, total_files)
                        prog_text = f"Extraindo ({extracted_count}/{total_files}): {niche_name}..."
                        try:
                            dialog.after(0, lambda p=pct, t=prog_text: (prog_bar.set(p), lbl_status.configure(text=t)))
                        except Exception:
                            pass

            if delete_zip:
                try:
                    os.remove(zip_path)
                    self._log(f"   🗑️ Arquivo ZIP original removido do Downloads conforme solicitado: {os.path.basename(zip_path)}")
                except Exception as e:
                    self._log(f"   ⚠️ Aviso: Não foi possível remover o arquivo ZIP original: {e}")

            if auto_check:
                self.campaign_checked_state.clear()
                for niche_name in niches:
                    self.campaign_checked_state[niche_name] = True

            # Atualizar campanhas na interface principal
            def _refresh_after_zip():
                if hasattr(self, "search_var") and self.search_var.get():
                    self.search_var.set("")
                self._scan_daily_campaigns(reset_limit=True, preserve_checked=auto_check)

            self.after(100, _refresh_after_zip)

            msg_niches = "\n".join(f"   • {n} ({info['total_imgs']} imagens)" for n, info in niches.items())
            self._log(f"✅ [SUCESSO] {len(niches)} nichos salvos com sucesso na pasta 'Vídeos':\n{msg_niches}")

            try:
                dialog.after(0, lambda: self._on_zip_extraction_success(dialog, list(niches.keys()), total_files))
            except Exception:
                pass

        except Exception as e:
            err_msg = f"Erro ao descompactar arquivos do ZIP: {str(e)}"
            self._log(f"❌ {err_msg}")
            try:
                dialog.after(0, lambda: messagebox.showerror("Erro na Extração", err_msg, parent=dialog))
                dialog.after(0, lambda: (
                    btn_extract.configure(state="normal", text="📥 EXTRAIR E SALVAR NA PASTA VÍDEOS"),
                    btn_cancel.configure(state="normal"),
                    btn_browse.configure(state="normal"),
                    lbl_status.configure(text=f"❌ Erro: {str(e)[:80]}")
                ))
            except Exception:
                pass

    def _on_zip_extraction_success(self, dialog, niche_names, total_files):
        try:
            if dialog.winfo_exists():
                dialog.destroy()
        except Exception:
            pass

        n_list_str = "\n".join(f"• {n}" for n in niche_names)
        messagebox.showinfo(
            "Criativos Salvos com Sucesso!",
            f"🎉 {len(niche_names)} nichos ({total_files} imagens) foram salvos com sucesso na pasta 'Vídeos'!\n\n"
            f"{n_list_str}\n\n"
            f"Eles foram adicionados ao topo e já estão marcados na lista para geração dos vídeos MP4!"
        )

    # =========================================================================
    # CHECKLIST PRÉ-RENDER (VALIDAÇÃO DE IMAGENS E CASAMENTO DE ÁUDIOS)
    # =========================================================================
    def _open_preflight_checklist(self):
        if self.checklist_dialog is not None and self.checklist_dialog.winfo_exists():
            self.checklist_dialog.lift()
            self.checklist_dialog.focus()
            return

        selected_camps = [c for c in self.daily_campaigns if c["var"].get()]
        if not selected_camps:
            if not self.daily_campaigns:
                messagebox.showwarning("Aviso", "Nenhuma campanha encontrada em 'Trabalho\\Vídeos' para verificar!", parent=self)
                return
            if messagebox.askyesno("Nenhum nicho marcado", "Nenhum nicho está marcado com [☑️].\n\nDeseja marcar e verificar todos os nichos visíveis na lista?", parent=self):
                selected_camps = self.daily_campaigns
                for c in selected_camps:
                    c["var"].set(True)
                    self.campaign_checked_state[c["name"]] = True
            else:
                return

        dialog = ctk.CTkToplevel(self)
        self.checklist_dialog = dialog
        dialog.title("📋 Checklist Pré-Render - Validação de Arquivos")
        dialog.geometry("820x660")
        dialog.minsize(720, 540)
        dialog.transient(self)

        # Header Frame
        top_frame = ctk.CTkFrame(dialog, fg_color="#18191b", corner_radius=0)
        top_frame.pack(fill="x", padx=0, pady=0)

        header_content = ctk.CTkFrame(top_frame, fg_color="transparent")
        header_content.pack(fill="x", padx=20, pady=(14, 4))

        badge = ctk.CTkLabel(
            header_content,
            text="CHECKLIST PRÉ-RENDER",
            font=("Segoe UI", 10, "bold"),
            fg_color="#0d9488",
            text_color="#ffffff",
            corner_radius=6,
            padx=8,
            pady=2
        )
        badge.pack(side="left", padx=(0, 10))

        t_lbl = ctk.CTkLabel(
            header_content,
            text="📋 Validação de Arquivos & Áudios",
            font=("Segoe UI", 16, "bold"),
            text_color="#f1f5f9"
        )
        t_lbl.pack(side="left")

        sub_lbl = ctk.CTkLabel(
            top_frame,
            text="Verificação completa pré-render: casamento de áudios com imagens, integridade de arquivos e detecção de corrupção.",
            font=("Segoe UI", 11),
            text_color="#94a3b8",
            justify="left"
        )
        sub_lbl.pack(anchor="w", padx=20, pady=(0, 12))

        # Main Scrollable Content
        main_content = ctk.CTkScrollableFrame(dialog, fg_color="transparent")
        main_content.pack(fill="both", expand=True, padx=16, pady=(10, 6))

        # Banner Frame (Resultado Geral)
        banner_frame = ctk.CTkFrame(main_content, fg_color="transparent")
        banner_frame.pack(fill="x", pady=(0, 12))

        # Cards Frame (Lista de Campanhas)
        cards_frame = ctk.CTkFrame(main_content, fg_color="transparent")
        cards_frame.pack(fill="x", pady=(0, 10))

        # Bottom Bar (Fixed)
        b_bar = ctk.CTkFrame(dialog, fg_color="#18191b", corner_radius=0)
        b_bar.pack(fill="x", side="bottom")

        b_content = ctk.CTkFrame(b_bar, fg_color="transparent")
        b_content.pack(fill="x", padx=16, pady=12)

        btn_start_holder = [None]
        btn_recheck_holder = [None]

        def run_checklist():
            for w in banner_frame.winfo_children():
                w.destroy()
            for w in cards_frame.winfo_children():
                w.destroy()

            # Auditar campanhas selecionadas
            current_selected = [c for c in self.daily_campaigns if c["var"].get()]
            if not current_selected:
                empty = ctk.CTkLabel(cards_frame, text="Nenhum nicho selecionado no momento.", font=("Segoe UI", 12), text_color="#94a3b8")
                empty.pack(pady=20)
                return

            results = []
            for c in current_selected:
                audios = self._find_audios_for_campaign(c["name"])
                report = audit_campaign_files(c["name"], c["path"], audios)
                results.append(report)

            total_valid_imgs = sum(r["valid_images"] for r in results)
            total_corrupt_imgs = sum(len(r["corrupt_images"]) for r in results)
            total_matched_audios = sum(len(r["matched_audios"]) for r in results)
            total_missing_audios = sum(len(r["missing_audios"]) for r in results)
            total_vids = sum(r["valid_images"] for r in results)

            is_all_clean = (total_corrupt_imgs == 0 and total_missing_audios == 0 and total_valid_imgs > 0)

            # 1. Render Banner
            if is_all_clean:
                b_color = "#064e3b"
                b_border = "#10b981"
                t_title = "✨ 100% PRONTO PARA RENDERIZAR! (TUDO APROVADO)"
                t_color = "#86efac"
                t_desc = f"Todos os {len(results)} nichos possuem imagens válidas e áudios casados correspondentes. Seguro para iniciar!"
            elif total_corrupt_imgs > 0 or total_missing_audios > 0:
                b_color = "#381010"
                b_border = "#ef4444"
                t_title = "🚨 ATENÇÃO: PENDÊNCIAS DETECTADAS ANTES DO RENDER"
                t_color = "#fca5a5"
                t_desc = "Foram detectadas imagens corrompidas ou áudios ausentes. Corrija os arquivos antes de iniciar para evitar erros."
            else:
                b_color = "#1e293b"
                b_border = "#38bdf8"
                t_title = "ℹ️ NENHUMA NOVA IMAGEM BRUTA DETECTADA"
                t_color = "#38bdf8"
                t_desc = "As campanhas selecionadas podem já ter sido renderizadas ou não possuem imagens brutas para processar."

            banner_card = ctk.CTkFrame(banner_frame, fg_color=b_color, corner_radius=10, border_width=1, border_color=b_border)
            banner_card.pack(fill="x", pady=2)

            lbl_bt = ctk.CTkLabel(banner_card, text=t_title, font=("Segoe UI", 13, "bold"), text_color=t_color)
            lbl_bt.pack(anchor="w", padx=16, pady=(10, 2))

            lbl_bd = ctk.CTkLabel(banner_card, text=t_desc, font=("Segoe UI", 11), text_color="#cbd5e1", justify="left")
            lbl_bd.pack(anchor="w", padx=16, pady=(0, 8))

            # Chips Row
            chips_row = ctk.CTkFrame(banner_card, fg_color="transparent")
            chips_row.pack(fill="x", padx=16, pady=(0, 10))

            def make_chip(parent, text, color, txt_color="#ffffff"):
                lbl = ctk.CTkLabel(parent, text=text, font=("Segoe UI", 11, "bold"), fg_color=color, text_color=txt_color, corner_radius=6, padx=10, pady=3)
                lbl.pack(side="left", padx=(0, 6))

            make_chip(chips_row, f"📁 {len(results)} Nichos", "#18191b", "#cbd5e1")
            make_chip(chips_row, f"🖼️ {total_valid_imgs} Imagens Válidas", "#18191b", "#86efac")
            make_chip(chips_row, f"🎵 {total_matched_audios} Áudios Casados", "#18191b", "#38bdf8")
            make_chip(chips_row, f"🎬 {total_vids} Vídeos a Gerar", "#18191b", "#c084fc")

            if total_corrupt_imgs > 0:
                make_chip(chips_row, f"❌ {total_corrupt_imgs} Imagens Corrompidas", "#ef4444", "#ffffff")
            if total_missing_audios > 0:
                make_chip(chips_row, f"⚠️ {total_missing_audios} Áudios Ausentes", "#f59e0b", "#18191b")

            # 2. Render Cards para cada Campanha
            for r in results:
                c_border = "#ef4444" if (r["corrupt_images"] or r["missing_audios"]) else "#2e2f34"
                c_card = ctk.CTkFrame(cards_frame, fg_color="#212226", corner_radius=10, border_width=1, border_color=c_border)
                c_card.pack(fill="x", pady=5)

                # Card Top Row
                c_top = ctk.CTkFrame(c_card, fg_color="transparent")
                c_top.pack(fill="x", padx=16, pady=(10, 4))

                c_title = ctk.CTkLabel(c_top, text=f"📁 {r['camp_name']}", font=("Segoe UI", 13, "bold"), text_color="#f1f5f9")
                c_title.pack(side="left")

                if r["corrupt_images"] or r["missing_audios"]:
                    b_badge = ctk.CTkLabel(c_top, text="🚨 PENDÊNCIAS DETECTADAS", font=("Segoe UI", 10, "bold"), fg_color="#ef4444", text_color="#ffffff", corner_radius=6, padx=8, pady=2)
                elif r["valid_images"] > 0:
                    b_badge = ctk.CTkLabel(c_top, text=f"✅ 100% PRONTO ({r['valid_images']} imgs)", font=("Segoe UI", 10, "bold"), fg_color="#10b981", text_color="#ffffff", corner_radius=6, padx=8, pady=2)
                else:
                    b_badge = ctk.CTkLabel(c_top, text="ℹ️ JÁ RENDERIZADO", font=("Segoe UI", 10, "bold"), fg_color="#334155", text_color="#cbd5e1", corner_radius=6, padx=8, pady=2)
                b_badge.pack(side="right")

                # Box de Confirmacao Visual das Pastas (Videos vs Audio)
                folders_box = ctk.CTkFrame(c_card, fg_color="#18191b", corner_radius=8, border_width=1, border_color="#2e2f34")
                folders_box.pack(fill="x", padx=16, pady=(2, 6))

                v_row = ctk.CTkFrame(folders_box, fg_color="transparent")
                v_row.pack(fill="x", padx=12, pady=(6, 2))

                v_folder_name = r.get("video_folder_name") or r["camp_name"]
                lbl_v_folder = ctk.CTkLabel(
                    v_row,
                    text=f"🎬 Pasta de Vídeos:  Trabalho\\Vídeos\\{v_folder_name}  ✅",
                    font=("Consolas", 11, "bold"),
                    text_color="#38bdf8",
                    justify="left"
                )
                lbl_v_folder.pack(side="left")

                btn_open_v = ctk.CTkButton(
                    v_row,
                    text="📂 Abrir Vídeos",
                    width=105,
                    height=22,
                    font=("Segoe UI", 10, "bold"),
                    fg_color="#334155",
                    hover_color="#475569",
                    command=lambda p=r["camp_path"]: self._open_folder_or_file(None, p)
                )
                btn_open_v.pack(side="right")

                a_row = ctk.CTkFrame(folders_box, fg_color="transparent")
                a_row.pack(fill="x", padx=12, pady=(2, 6))

                a_folder_name = r.get("audio_folder_name")
                a_folder_path = r.get("audio_folder_path")
                if a_folder_name and a_folder_path:
                    a_txt = f"🎵 Pasta de Áudio:   Trabalho\\Arquivos de Áudio\\{a_folder_name}  ✅"
                    a_col = "#86efac"
                    target_open_a = a_folder_path
                else:
                    a_txt = f"🎵 Pasta de Áudio:   ❌ Não encontrada em 'Trabalho\\Arquivos de Áudio' (esperado: {v_folder_name})"
                    a_col = "#fca5a5"
                    target_open_a = BASE_AUDIOS_DIR

                lbl_a_folder = ctk.CTkLabel(
                    a_row,
                    text=a_txt,
                    font=("Consolas", 11, "bold"),
                    text_color=a_col,
                    justify="left"
                )
                lbl_a_folder.pack(side="left")

                btn_open_a = ctk.CTkButton(
                    a_row,
                    text="📂 Abrir Áudio",
                    width=105,
                    height=22,
                    font=("Segoe UI", 10, "bold"),
                    fg_color="#334155",
                    hover_color="#475569",
                    command=lambda p=target_open_a: self._open_folder_or_file(None, p)
                )
                btn_open_a.pack(side="right")

                # Structure details
                for b_name, b_langs in r["blocks"].items():
                    b_lbl = ctk.CTkLabel(c_card, text=f"   🔹 {b_name}:", font=("Segoe UI", 11, "bold"), text_color="#94a3b8")
                    b_lbl.pack(anchor="w", padx=16, pady=(2, 1))

                    for l_name, l_info in b_langs.items():
                        sub_name = l_info.get("subfolder_name", l_name)
                        imgs_txt = f"{l_info['valid_imgs_count']} imagens válidas (pasta '{sub_name}')"
                        if l_info["corrupt_imgs"]:
                            imgs_txt += f" (❌ {len(l_info['corrupt_imgs'])} corrompidas)"
                        if l_info["rendered_videos"] > 0 and l_info["valid_imgs_count"] == 0:
                            imgs_txt = f"{l_info['rendered_videos']} vídeos MP4 já gerados (pasta '{sub_name}')"

                        if l_info["audio"]:
                            aud_txt = f"🎵 Áudio: '{l_info['audio']['filename']}' ({l_info['audio']['duration']:.1f}s) ✅"
                            t_color = "#86efac" if not l_info["corrupt_imgs"] else "#fca5a5"
                        else:
                            aud_txt = "⚠️ Áudio AUSENTE em 'Arquivos de Áudio' ❌"
                            t_color = "#fde047"

                        line_txt = f"      • {l_name}: {imgs_txt}  |  {aud_txt}"
                        lbl_line = ctk.CTkLabel(c_card, text=line_txt, font=("Consolas", 11), text_color=t_color, justify="left")
                        lbl_line.pack(anchor="w", padx=16, pady=1)

                # Sub-alert para imagens corrompidas
                if r["corrupt_images"]:
                    alert_img = ctk.CTkFrame(c_card, fg_color="#381010", corner_radius=6, border_width=1, border_color="#ef4444")
                    alert_img.pack(fill="x", padx=16, pady=(6, 4))

                    for bad in r["corrupt_images"]:
                        bad_row = ctk.CTkFrame(alert_img, fg_color="transparent")
                        bad_row.pack(fill="x", padx=10, pady=4)

                        bad_lbl = ctk.CTkLabel(
                            bad_row, 
                            text=f"❌ Imagem corrompida: {bad['name']} ({bad['block']} > {bad['lang']})", 
                            font=("Segoe UI", 11, "bold"), 
                            text_color="#fca5a5"
                        )
                        bad_lbl.pack(side="left")

                        btn_open = ctk.CTkButton(
                            bad_row,
                            text="📂 Abrir Pasta",
                            width=95,
                            height=24,
                            font=("Segoe UI", 10, "bold"),
                            fg_color="#ef4444",
                            hover_color="#dc2626",
                            command=lambda p=bad["path"], f=bad["folder"]: self._open_folder_or_file(p, f)
                        )
                        btn_open.pack(side="right")

                # Sub-alert para áudios ausentes
                if r["missing_audios"]:
                    alert_aud = ctk.CTkFrame(c_card, fg_color="#382510", corner_radius=6, border_width=1, border_color="#f59e0b")
                    alert_aud.pack(fill="x", padx=16, pady=(4, 8))

                    aud_row = ctk.CTkFrame(alert_aud, fg_color="transparent")
                    aud_row.pack(fill="x", padx=10, pady=4)

                    m_langs = ", ".join(m["lang"] for m in r["missing_audios"])
                    aud_lbl = ctk.CTkLabel(
                        aud_row, 
                        text=f"⚠️ Áudio ausente para: {m_langs} (adicione na pasta de áudio correspondente)", 
                        font=("Segoe UI", 11, "bold"), 
                        text_color="#fde047"
                    )
                    aud_lbl.pack(side="left")

                    btn_open_aud = ctk.CTkButton(
                        aud_row,
                        text="📂 Abrir Áudios",
                        width=100,
                        height=24,
                        font=("Segoe UI", 10, "bold"),
                        fg_color="#d97706",
                        hover_color="#b45309",
                        command=lambda: self._open_folder_or_file(None, BASE_AUDIOS_DIR)
                    )
                    btn_open_aud.pack(side="right")

            # 3. Update Bottom Buttons
            if btn_start_holder[0]:
                if is_all_clean:
                    btn_start_holder[0].configure(
                        text="🚀 TUDO CERTO! INICIAR RENDERIZAÇÃO AGORA",
                        fg_color="#10b981",
                        hover_color="#059669",
                        command=lambda: (dialog.destroy(), self._start_batch_generation())
                    )
                else:
                    def confirm_start():
                        if messagebox.askyesno(
                            "Confirmar Início com Pendências",
                            "Existem pendências detectadas (áudios ausentes ou imagens corrompidas).\n\nDeseja iniciar a renderização mesmo assim?\nOs itens com erro serão ignorados e poderão ser corrigidos depois.",
                            parent=dialog
                        ):
                            dialog.destroy()
                            self._start_batch_generation()

                    btn_start_holder[0].configure(
                        text="⚠️ INICIAR MESMO COM PENDÊNCIAS",
                        fg_color="#d97706",
                        hover_color="#b45309",
                        command=confirm_start
                    )

        # Bottom Bar Elements
        btn_start = ctk.CTkButton(
            b_content,
            text="🚀 INICIAR RENDERIZAÇÃO AGORA",
            font=("Segoe UI", 13, "bold"),
            fg_color="#10b981",
            hover_color="#059669",
            height=46
        )
        btn_start.pack(side="left", fill="x", expand=True, padx=(0, 8))
        btn_start_holder[0] = btn_start

        btn_recheck = ctk.CTkButton(
            b_content,
            text="🔄 Reverificar",
            width=130,
            height=46,
            font=("Segoe UI", 12, "bold"),
            fg_color="#334155",
            hover_color="#475569",
            command=run_checklist
        )
        btn_recheck.pack(side="left", padx=(0, 8))
        btn_recheck_holder[0] = btn_recheck

        btn_close = ctk.CTkButton(
            b_content,
            text="✕ Fechar",
            width=90,
            height=46,
            font=("Segoe UI", 12, "bold"),
            fg_color="#27272a",
            hover_color="#3f3f46",
            command=dialog.destroy
        )
        btn_close.pack(side="left")

        run_checklist()
        dialog.focus()

    def _start_batch_generation(self):
        if self.is_processing:
            return

        selected_camps = [c for c in self.daily_campaigns if c["var"].get()]
        if not selected_camps:
            messagebox.showwarning("Aviso", "Selecione pelo menos uma campanha para processar!")
            return

        self.is_processing = True
        self.is_paused = False
        self.is_cancelled = False
        self.pause_event.set()
        self.active_mode = "batch"
        self.btn_run_batch.configure(state="disabled", text="⏳ Processando Nichos do Dia...")
        self._update_pause_cancel_ui()
        self.progress_bar.set(0)

        threading.Thread(target=self._process_batch_worker, args=(selected_camps,), daemon=True).start()

    def _process_batch_worker(self, campaigns):
        try:
            do_round = self.chk_batch_round.get()
            do_cleanup = self.chk_batch_cleanup.get()
            do_rename_master = self.chk_batch_rename_master.get()

            jobs = []
            for camp in campaigns:
                camp_path = camp["path"]
                audios = camp["audios"]

                blocks = discover_campaign_blocks(camp_path)
                if not blocks:
                    blocks = [("", camp_path)]

                for b_name, bp in blocks:
                    # Discover all language folders inside this block
                    target_langs = []
                    # Portuguese: images come from "1. Imagens" (or "Português"), but videos MUST ALWAYS be saved in "Português"!
                    alt_pt, _ = find_subfolder_ci(bp, ["1. Imagens", "1.Imagens", "Imagens"])
                    dest_pt_existing, _ = find_subfolder_ci(bp, ["Português", "Portugues"])
                    dest_pt = dest_pt_existing if dest_pt_existing else os.path.join(bp, "Português")
                    if alt_pt:
                        target_langs.append(("Português", "pt", alt_pt, dest_pt))
                    elif dest_pt_existing:
                        target_langs.append(("Português", "pt", dest_pt_existing, dest_pt_existing))

                    # Check other subdirectories
                    for sub in os.listdir(bp):
                        sub_p = os.path.join(bp, sub)
                        if not os.path.isdir(sub_p) or is_master_images_folder(sub):
                            continue
                        code = identify_language_from_name(sub)
                        if code and code != "pt":
                            lang_name = LANGUAGES_DB[code]["name"]
                            target_langs.append((lang_name, code, sub_p, sub_p))

                    # Fallback for single folder without language subdirectories
                    if not target_langs and not b_name:
                        direct_imgs = [os.path.join(bp, f) for f in os.listdir(bp) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                        if direct_imgs:
                            dest_f = bp
                            b_basename = os.path.basename(os.path.normpath(bp))
                            if is_master_images_folder(b_basename):
                                dest_f = os.path.join(os.path.dirname(os.path.normpath(bp)), "Português")
                            target_langs.append(("Português", "pt", bp, dest_f))

                    for lang, code, src_folder, dest_folder in target_langs:
                        imgs = []
                        if code == "pt":
                            if do_rename_master:
                                _, was_ren = standardize_folder_images(src_folder)
                                if was_ren:
                                    tag = f"{camp['name']} > {b_name} > 1. Imagens" if b_name else f"{camp['name']} > 1. Imagens"
                                    self._log(f"   🪄 [{tag}] Imagens renomeadas e padronizadas para 1.png..6.png")
                            imgs = [os.path.join(src_folder, f) for f in os.listdir(src_folder) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                        else:
                            imgs = [os.path.join(src_folder, f) for f in os.listdir(src_folder) if f.lower().endswith((".png", ".jpg", ".jpeg"))]

                        if not imgs:
                            continue

                        # Find matching audio
                        audio_path = audios.get(lang)
                        if not audio_path and os.path.exists(dest_folder):
                            in_folder = [os.path.join(dest_folder, f) for f in os.listdir(dest_folder) if f.lower().endswith((".mp3", ".wav"))]
                            if in_folder:
                                audio_path = in_folder[0]
                        if not audio_path and os.path.exists(src_folder):
                            in_folder = [os.path.join(src_folder, f) for f in os.listdir(src_folder) if f.lower().endswith((".mp3", ".wav"))]
                            if in_folder:
                                audio_path = in_folder[0]

                        if audio_path and os.path.exists(audio_path):
                            sorted_images = sort_creatives(imgs)
                            jobs.append({
                                "campaign": camp["name"],
                                "bloco": b_name if b_name else "Único",
                                "lang": lang,
                                "src_folder": src_folder,
                                "dest_folder": dest_folder,
                                "images": sorted_images,
                                "audio": audio_path
                            })

            total_jobs = len(jobs)
            total_videos = sum(len(j["images"]) for j in jobs)
            self._log(f"\n🚀 [LOTE DIÁRIO] Iniciando renderização de {total_jobs} conjuntos ({total_videos} vídeos no total)...")

            current_video_idx = 0
            total_completed = 0
            total_errors = 0
            cleanup_candidates = []
            failed_items = []

            for job in jobs:
                if self.is_cancelled:
                    break

                camp = job["campaign"]
                bloco = job["bloco"]
                lang = job["lang"]
                src_folder = job["src_folder"]
                dest_folder = job["dest_folder"]
                images = job["images"]
                audio = job["audio"]

                os.makedirs(dest_folder, exist_ok=True)
                output_folder = dest_folder

                raw_dur = get_audio_duration(audio)
                target_dur = math.ceil(raw_dur) if do_round else raw_dur

                bloco_tag = f" > {bloco}" if bloco and bloco != "Único" else ""
                self._log(f"\n📂 [{camp}{bloco_tag} > {lang}]")
                self._log(f"   • Pasta de Saída (Vídeos): {output_folder}")
                self._log(f"   • Áudio: {os.path.basename(audio)} ({raw_dur:.2f}s ➔ {target_dur}s)")

                generated_files = []

                for idx, img_path in enumerate(images, start=1):
                    if self.is_cancelled:
                        break

                    if self.is_paused:
                        self._log("   ⏸️ [PAUSA] Aguardando clique em 'Continuar'...")
                        self.pause_event.wait()
                        if self.is_cancelled:
                            break

                    current_video_idx += 1
                    out_name = f"{idx}.mp4"
                    out_path = os.path.join(output_folder, out_name)

                    # Verifica se o vídeo já existe e está completo (evita reprocessamento)
                    if os.path.exists(out_path) and os.path.getsize(out_path) > 10240:
                        self._log(f"   ⏩ [{current_video_idx}/{total_videos}] {out_name} já existe e está pronto! Pulando...")
                        generated_files.append(out_path)
                        total_completed += 1
                        self.progress_bar.set(current_video_idx / total_videos)
                        continue

                    # Verifica integridade da imagem para não travar FFmpeg
                    if not is_image_valid(img_path):
                        reason = f"Imagem '{os.path.basename(img_path)}' corrompida ou incompleta (arquivo truncado/sem IEND do Canva)"
                        self._log(f"   ⚠️ [ALERTA] {reason}. Pulando para não travar!")
                        total_errors += 1
                        failed_items.append({
                            "campaign": camp,
                            "bloco": bloco,
                            "lang": lang,
                            "out_name": out_name,
                            "out_path": out_path,
                            "img_path": img_path,
                            "folder": src_folder,
                            "audio": audio,
                            "target_dur": target_dur,
                            "reason": reason,
                            "do_cleanup": do_cleanup,
                            "is_master": (lang.lower() in ["português", "portugues", "pt"])
                        })
                        self.progress_bar.set(current_video_idx / total_videos)
                        continue

                    cmd = [
                        FFMPEG_PATH,
                        "-loop", "1",
                        "-i", img_path,
                        "-i", audio,
                        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                        "-c:v", "libx264",
                        "-tune", "stillimage",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-af", "apad",
                        "-t", str(target_dur),
                        "-pix_fmt", "yuv420p",
                        "-y",
                        out_path
                    ]

                    res = run_ffmpeg(cmd, timeout=120, process_holder=self.current_ffmpeg_proc)

                    if self.is_cancelled:
                        if os.path.exists(out_path) and os.path.getsize(out_path) < 10240:
                            try:
                                os.remove(out_path)
                            except Exception:
                                pass
                        break

                    if res.returncode != 0:
                        total_errors += 1
                        err_msg = res.stderr.decode("utf-8", errors="replace")
                        reason = f"Falha no FFmpeg ao renderizar {out_name}: {err_msg[:120].strip()}"
                        self._log(f"   ❌ Erro em {out_name}: {err_msg[:200]}")
                        failed_items.append({
                            "campaign": camp,
                            "bloco": bloco,
                            "lang": lang,
                            "out_name": out_name,
                            "out_path": out_path,
                            "img_path": img_path,
                            "folder": src_folder,
                            "audio": audio,
                            "target_dur": target_dur,
                            "reason": reason,
                            "do_cleanup": do_cleanup,
                            "is_master": (lang.lower() in ["português", "portugues", "pt"])
                        })
                    else:
                        generated_files.append(out_path)
                        total_completed += 1
                        self._log(f"   ✅ [{current_video_idx}/{total_videos}] {out_name} OK ({target_dur}s)")

                    self.progress_bar.set(current_video_idx / total_videos)

                # Coletar candidatos para limpeza futura (SEM apagar agora!)
                is_portuguese = lang.lower() in ["português", "portugues", "pt"] or src_folder.endswith("1. Imagens")
                if is_portuguese:
                    self._log(f"   🛡️ [{lang}] Imagens master PRESERVADAS em '{os.path.basename(src_folder)}'.")
                elif do_cleanup:
                    for img_p in images:
                        if img_p not in cleanup_candidates:
                            cleanup_candidates.append(img_p)

            # Avaliação final pós-lote
            if self.is_cancelled:
                self._log(f"\n⏹️ [CANCELADO] Renderização interrompida. {total_completed} vídeos concluídos foram preservados.")
                self._log("🛡️ [PRESERVAÇÃO] Nenhuma imagem foi apagada porque o processo foi cancelado.")
                messagebox.showwarning("Cancelado", f"Processo cancelado pelo usuário!\n{total_completed} vídeos gerados foram preservados.\nTodas as imagens originais foram mantidas intactas.")
            elif self.is_paused:
                self._log(f"\n⏸️ [PAUSADO] Processo pausado. {total_completed} vídeos concluídos até o momento.")
                self._log("🛡️ [PRESERVAÇÃO] Nenhuma imagem foi apagada enquanto o processo estiver pausado.")
            else:
                if len(failed_items) == 0:
                    clear_session_state()
                    self.last_failed_items = []
                    self.after(100, self._update_error_banner)
                    if do_cleanup and cleanup_candidates:
                        deleted_count = 0
                        for img_p in cleanup_candidates:
                            try:
                                if os.path.exists(img_p):
                                    os.remove(img_p)
                                    deleted_count += 1
                            except Exception as e:
                                self._log(f"   ⚠️ Aviso ao apagar imagem: {e}")
                        self._log(f"\n🗑️ [LIMPEZA FINAL] {deleted_count} imagens originais traduzidas foram removidas com segurança (100% de sucesso sem nenhum erro)!")

                    self._log(f"\n🎉 SUCESSO TOTAL! Todos os {total_videos} vídeos do lote foram gerados com perfeição!\n")
                    messagebox.showinfo("Lote Concluído!", f"Sucesso! Todos os {total_videos} vídeos dos nichos do dia foram renderizados com duração arredondada!")
                else:
                    self.last_failed_items = failed_items
                    self.last_cleanup_candidates = cleanup_candidates
                    self.last_do_cleanup = do_cleanup
                    save_session_state({
                        "mode": "batch",
                        "status": "incompleto_erros",
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "failed_items": failed_items,
                        "cleanup_candidates": cleanup_candidates,
                        "do_cleanup": do_cleanup
                    })
                    self.after(200, self._update_error_banner)
                    self.after(500, self._show_error_dialog)
                    self._log(f"\n⚠️ Processamento concluído com {len(failed_items)} erro(s). Imagens originais PRESERVADAS para conferência.")
                    self._log("💡 Abrindo Central de Resolução de Erros com atalhos diretos para as pastas...")

        except Exception as e:
            self._log(f"❌ Erro durante o lote: {str(e)}")
            messagebox.showerror("Erro", f"Ocorreu um erro no processamento: {str(e)}")

        finally:
            self.is_processing = False
            self.is_paused = False
            self.is_cancelled = False
            self.btn_run_batch.configure(state="normal", text="🚀 GERAR TODOS OS NICHOS MARCADOS (1-CLIQUE)")
            self._update_pause_cancel_ui()

    # =========================================================================
    # TAB 2: MANUAL MULTI-LANGUAGE MODE
    # =========================================================================
    def _build_single_tab(self):
        # 1. Action Bottom Bar (FIXO na parte inferior da aba manual)
        action_bar = ctk.CTkFrame(self.tab_single, fg_color="#18191b", corner_radius=12, border_width=1, border_color="#2e2f34")
        action_bar.pack(side="bottom", fill="x", padx=10, pady=(6, 8))

        act_row = ctk.CTkFrame(action_bar, fg_color="transparent")
        act_row.pack(fill="x", padx=12, pady=10)

        self.btn_generate = ctk.CTkButton(
            act_row, 
            text="⚡ GERAR VÍDEOS DOS IDIOMAS SELECIONADOS", 
            height=48, 
            font=("Segoe UI", 14, "bold"), 
            fg_color="#8b3dff", 
            hover_color="#7c3aed",
            command=self._start_single_generation
        )
        self.btn_generate.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.btn_single_pause = ctk.CTkButton(
            act_row,
            text="⏸️ Pausar",
            width=110,
            height=48,
            font=("Segoe UI", 12, "bold"),
            fg_color="#334155",
            hover_color="#475569",
            state="disabled",
            command=self._on_pause_clicked
        )
        self.btn_single_pause.pack(side="left", padx=(0, 8))

        self.btn_single_cancel = ctk.CTkButton(
            act_row,
            text="⏹️ Cancelar",
            width=110,
            height=48,
            font=("Segoe UI", 12, "bold"),
            fg_color="#ef4444",
            hover_color="#dc2626",
            state="disabled",
            command=self._on_cancel_clicked
        )
        self.btn_single_cancel.pack(side="left")

        # 2. Scrollable Container para o conteudo da aba manual
        container = ctk.CTkScrollableFrame(self.tab_single, fg_color="transparent")
        container.pack(side="top", fill="both", expand=True, padx=10, pady=(5, 4))

        # Card 1: Pastas de Trabalho (Vídeos & Áudios lado a lado compacto)
        folders_card = ctk.CTkFrame(container, fg_color="#212226", corner_radius=12, border_width=1, border_color="#2e2f34")
        folders_card.pack(fill="x", pady=(0, 12))

        f_header = ctk.CTkFrame(folders_card, fg_color="transparent")
        f_header.pack(fill="x", padx=16, pady=(12, 8))

        f_title = ctk.CTkLabel(f_header, text="📁 1. Pastas de Trabalho (Vídeos & Áudios)", font=("Segoe UI", 14, "bold"), text_color="#f1f5f9")
        f_title.pack(side="left")

        btn_refresh_manual = ctk.CTkButton(
            f_header,
            text="🔄 Atualizar Pastas",
            width=125,
            height=28,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=self._analyze_manual_folder
        )
        btn_refresh_manual.pack(side="right")

        self.btn_rename_manual = ctk.CTkButton(
            f_header,
            text="🪄 Padronizar (1 a 6)",
            width=135,
            height=28,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=self._manual_rename_images
        )
        self.btn_rename_manual.pack(side="right", padx=(0, 6))

        # Grid de 2 colunas lado a lado
        cols_frame = ctk.CTkFrame(folders_card, fg_color="transparent")
        cols_frame.pack(fill="x", padx=16, pady=(0, 12))
        cols_frame.grid_columnconfigure(0, weight=1)
        cols_frame.grid_columnconfigure(1, weight=1)

        # Coluna 1: Pasta de Vídeos/Criativos
        left_col = ctk.CTkFrame(cols_frame, fg_color="#18191b", corner_radius=8, border_width=1, border_color="#2e2f34")
        left_col.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=0)

        lbl_v_title = ctk.CTkLabel(left_col, text="🎬 Pasta dos Criativos / Vídeos:", font=("Segoe UI", 12, "bold"), text_color="#e2e8f0")
        lbl_v_title.pack(anchor="w", padx=12, pady=(10, 4))

        row_v = ctk.CTkFrame(left_col, fg_color="transparent")
        row_v.pack(fill="x", padx=12, pady=(0, 6))

        self.folder_entry = ctk.CTkEntry(row_v, placeholder_text="Cole ou busque a pasta...", height=32, font=("Segoe UI", 11))
        self.folder_entry.pack(side="left", fill="x", expand=True, padx=(0, 6))
        self.folder_entry.bind("<Return>", lambda e: self._analyze_manual_folder())
        self.folder_entry.bind("<FocusOut>", lambda e: self._analyze_manual_folder())

        self.btn_browse = ctk.CTkButton(
            row_v,
            text="📂 Buscar...",
            width=85,
            height=32,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=self._choose_folder
        )
        self.btn_browse.pack(side="right")

        self.lbl_images = ctk.CTkLabel(left_col, text="Nenhuma pasta selecionada", font=("Segoe UI", 10), text_color="#64748b", wraplength=350, justify="left")
        self.lbl_images.pack(anchor="w", padx=12, pady=(0, 8))

        # Coluna 2: Pasta de Áudios
        right_col = ctk.CTkFrame(cols_frame, fg_color="#18191b", corner_radius=8, border_width=1, border_color="#2e2f34")
        right_col.grid(row=0, column=1, sticky="nsew", padx=(6, 0), pady=0)

        lbl_a_title = ctk.CTkLabel(right_col, text="🎧 Pasta dos Áudios:", font=("Segoe UI", 12, "bold"), text_color="#e2e8f0")
        lbl_a_title.pack(anchor="w", padx=12, pady=(10, 4))

        row_a = ctk.CTkFrame(right_col, fg_color="transparent")
        row_a.pack(fill="x", padx=12, pady=(0, 6))

        self.audio_entry = ctk.CTkEntry(row_a, placeholder_text="Pasta de áudios ou .mp3...", height=32, font=("Segoe UI", 11))
        self.audio_entry.pack(side="left", fill="x", expand=True, padx=(0, 6))
        self.audio_entry.bind("<Return>", lambda e: self._analyze_manual_folder())
        self.audio_entry.bind("<FocusOut>", lambda e: self._analyze_manual_folder())

        self.btn_audio = ctk.CTkButton(
            row_a,
            text="🎧 Buscar...",
            width=85,
            height=32,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=self._choose_audio
        )
        self.btn_audio.pack(side="right")

        self.lbl_audio = ctk.CTkLabel(right_col, text="Nenhum áudio selecionado", font=("Segoe UI", 10), text_color="#64748b", wraplength=350, justify="left")
        self.lbl_audio.pack(anchor="w", padx=12, pady=(0, 8))

        # Card 3: Multi-Language Selector Card (Caixas de Seleção)
        lang_card = ctk.CTkFrame(container, fg_color="#212226", corner_radius=12, border_width=1, border_color="#2e2f34")
        lang_card.pack(fill="x", pady=(0, 14))

        lang_header = ctk.CTkFrame(lang_card, fg_color="transparent")
        lang_header.pack(fill="x", padx=16, pady=(14, 6))

        l_title = ctk.CTkLabel(lang_header, text="🌐 3. Seletor de Idiomas (Marque as Caixas)", font=("Segoe UI", 14, "bold"), text_color="#f1f5f9")
        l_title.pack(side="left")

        # Quick Actions Toolbar
        l_toolbar = ctk.CTkFrame(lang_card, fg_color="transparent")
        l_toolbar.pack(fill="x", padx=16, pady=(0, 8))

        btn_chk_detected = ctk.CTkButton(
            l_toolbar,
            text="🎯 Marcar Detectados",
            width=140,
            height=30,
            fg_color="#8b3dff",
            hover_color="#7c3aed",
            font=("Segoe UI", 11, "bold"),
            command=self._manual_select_detected
        )
        btn_chk_detected.pack(side="left", padx=(0, 6))

        btn_chk_all = ctk.CTkButton(
            l_toolbar,
            text="☑️ Marcar Todos",
            width=110,
            height=30,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=lambda: self._manual_toggle_all(True)
        )
        btn_chk_all.pack(side="left", padx=(0, 6))

        btn_unchk_all = ctk.CTkButton(
            l_toolbar,
            text="⬜ Desmarcar Todos",
            width=120,
            height=30,
            fg_color="#334155",
            hover_color="#475569",
            font=("Segoe UI", 11, "bold"),
            command=lambda: self._manual_toggle_all(False)
        )
        btn_unchk_all.pack(side="left", padx=(0, 6))

        # Search / filter inside language list
        self.manual_lang_search_var = ctk.StringVar()
        self.manual_lang_search_var.trace_add("write", lambda *a: self._filter_manual_langs_display())

        entry_search_lang = ctk.CTkEntry(
            l_toolbar,
            textvariable=self.manual_lang_search_var,
            placeholder_text="🔍 Filtrar idioma...",
            height=30,
            width=150,
            font=("Segoe UI", 11)
        )
        entry_search_lang.pack(side="right")

        # Scrollable container for language checkboxes
        self.manual_langs_scroll = ctk.CTkScrollableFrame(lang_card, height=270, fg_color="#18191b", corner_radius=8, border_width=1, border_color="#2e2f34")
        self.manual_langs_scroll.pack(fill="x", padx=16, pady=(0, 14))

        # Populate language checkboxes grouped by blocks
        self.manual_lang_vars.clear()
        self.manual_lang_badges.clear()
        self.manual_lang_rows.clear()

        # Group by blocks
        blocks_order = [
            "BLOCO-01 (Espanhol)",
            "BLOCO-02 (Europa / Ásia)",
            "BLOCO-03 (Francês)",
            "BLOCO-04 (Russo)",
            "BLOCO-05 (Árabe)",
            "BLOCO-06 (Inglês)",
            "Base Master (Português)",
            "Outros Idiomas"
        ]

        grouped = {b: [] for b in blocks_order}
        for code, info in LANGUAGES_DB.items():
            b = info.get("block", "Outros Idiomas")
            grouped.setdefault(b, []).append((code, info))

        for block_name in blocks_order:
            items = grouped.get(block_name, [])
            if not items:
                continue

            block_label = ctk.CTkLabel(
                self.manual_langs_scroll,
                text=f"📌 {block_name}",
                font=("Segoe UI", 12, "bold"),
                text_color="#c084fc",
                anchor="w"
            )
            block_label.pack(fill="x", padx=10, pady=(8, 4))

            for code, info in items:
                row = ctk.CTkFrame(self.manual_langs_scroll, fg_color="#212226", corner_radius=6, height=34)
                row.pack(fill="x", padx=8, pady=2)
                row.pack_propagate(False)

                var = ctk.BooleanVar(value=False)
                self.manual_lang_vars[code] = var

                chk = ctk.CTkCheckBox(
                    row,
                    text=f"{info['name']} ({code})",
                    font=("Segoe UI", 12, "bold"),
                    variable=var,
                    fg_color="#8b3dff",
                    hover_color="#7c3aed",
                    command=self._on_manual_checkbox_changed
                )
                chk.pack(side="left", padx=(10, 8), pady=4)

                badge = ctk.CTkLabel(
                    row,
                    text="(Não detectado nesta pasta)",
                    font=("Consolas", 11),
                    text_color="#64748b"
                )
                badge.pack(side="right", padx=(0, 12), pady=4)

                self.manual_lang_badges[code] = badge
                self.manual_lang_rows[code] = row

        # Card 4: Settings Card
        s_card = ctk.CTkFrame(container, fg_color="#212226", corner_radius=12, border_width=1, border_color="#2e2f34")
        s_card.pack(fill="x", pady=(0, 14))

        s_title = ctk.CTkLabel(s_card, text="⚙️ 4. Configurações de Saída", font=("Segoe UI", 14, "bold"), text_color="#f1f5f9")
        s_title.pack(anchor="w", padx=16, pady=(14, 8))

        self.chk_single_round = ctk.CTkCheckBox(
            s_card, 
            text="Arredondar duração do áudio para cima (ex: 15.23s ➔ 16s com silêncio suave)", 
            font=("Segoe UI", 12, "bold"),
            fg_color="#8b3dff",
            hover_color="#7c3aed"
        )
        self.chk_single_round.select()
        self.chk_single_round.pack(anchor="w", padx=16, pady=(0, 6))

        # Option 2: Image Cleanup (Non-Portuguese only, strictly after 100% completion)
        self.chk_single_cleanup = ctk.CTkCheckBox(
            s_card, 
            text="Excluir imagens brutas traduzidas somente após tudo concluído (100% sucesso)", 
            font=("Segoe UI", 12, "bold"),
            fg_color="#8b3dff",
            hover_color="#7c3aed"
        )
        self.chk_single_cleanup.select()
        self.chk_single_cleanup.pack(anchor="w", padx=16, pady=(0, 4))

        lbl_cleanup_hint = ctk.CTkLabel(
            s_card,
            text="   🛡️ As imagens só são apagadas se NENHUM erro ocorrer e não for pausado/cancelado. '1. Imagens' NUNCA é apagada.",
            font=("Segoe UI", 11),
            text_color="#10b981",
            justify="left"
        )
        lbl_cleanup_hint.pack(anchor="w", padx=16, pady=(0, 6))

        lbl_single_direct = ctk.CTkLabel(
            s_card,
            text="📁 Salva os vídeos diretamente na pasta do idioma (1.mp4 a 6.mp4), sem subpastas e sem zip.",
            font=("Segoe UI", 11, "bold"),
            text_color="#38bdf8",
            justify="left"
        )
        lbl_single_direct.pack(anchor="w", padx=16, pady=(4, 14))

    def _choose_folder(self):
        initial = BASE_VIDEOS_DIR if os.path.exists(BASE_VIDEOS_DIR) else os.path.expanduser("~")
        folder = filedialog.askdirectory(title="Selecione a pasta de criativos ou campanha", initialdir=initial)
        if not folder:
            return

        self.folder_entry.delete(0, "end")
        self.folder_entry.insert(0, folder)
        self._log(f"Pasta de criativos selecionada: {folder}")
        self._analyze_manual_folder()

    def _choose_audio(self):
        initial = BASE_AUDIOS_DIR if os.path.exists(BASE_AUDIOS_DIR) else os.path.expanduser("~")
        # Ask whether user wants to pick a folder of audios or single file
        path = filedialog.askdirectory(title="Selecione a pasta de áudios da campanha", initialdir=initial)
        if not path:
            path = filedialog.askopenfilename(
                title="Ou selecione um arquivo de áudio específico",
                initialdir=initial,
                filetypes=[("Arquivos de Áudio", "*.mp3 *.wav *.m4a *.aac *.ogg"), ("Todos os Arquivos", "*.*")]
            )
        if not path:
            return

        self.audio_entry.delete(0, "end")
        self.audio_entry.insert(0, path)
        self._log(f"Áudio(s) selecionado(s): {path}")
        self._analyze_manual_folder()

    def _analyze_manual_folder(self):
        folder = self.folder_entry.get().strip()
        if not folder:
            self.lbl_images.configure(text="ℹ️ Selecione ou cole a pasta de criativos para analisar", text_color="#64748b")
            return
        if not os.path.exists(folder):
            self.lbl_images.configure(text=f"❌ Pasta não encontrada: {os.path.basename(folder)}", text_color="#ef4444")
            return

        self._log(f"🔄 Analisando pastas em modo manual: {os.path.basename(folder)}...")

        # Auto-discover matching audio folder in BASE_AUDIOS_DIR if audio_entry is empty
        current_audio = self.audio_entry.get().strip()
        if not current_audio or not os.path.exists(current_audio):
            bname = os.path.basename(folder)
            if normalize_folder_key(bname) in ("blocoa", "blocob") or is_master_images_folder(bname) or identify_language_from_name(bname):
                parent = os.path.dirname(folder)
                bname = os.path.basename(parent)
                if normalize_folder_key(bname) in ("blocoa", "blocob"):
                    bname = os.path.basename(os.path.dirname(parent))

            target_dir, matched_a_name = find_matching_audio_folder(bname, BASE_AUDIOS_DIR)
            if target_dir and os.path.exists(target_dir):
                self.audio_entry.delete(0, "end")
                self.audio_entry.insert(0, target_dir)
                current_audio = target_dir
                self._log(f"🎧 Pasta de áudios casada automaticamente: {matched_a_name}")

        self.manual_detected_data.clear()

        # 1. Discover language folders and images inside folder
        subdirs = [d for d in os.listdir(folder) if os.path.isdir(os.path.join(folder, d))]
        blocks_found = discover_campaign_blocks(folder)
        if blocks_found:
            # Campaign folder containing blocks
            for _, bp in blocks_found:
                for sub in os.listdir(bp):
                    sub_p = os.path.join(bp, sub)
                    if os.path.isdir(sub_p):
                        code = "pt" if is_master_images_folder(sub) else identify_language_from_name(sub)
                        if code:
                            imgs = [os.path.join(sub_p, f) for f in os.listdir(sub_p) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                            if imgs:
                                self.manual_detected_data[code] = {"folder": sub_p, "images": imgs}
        else:
            # Check subdirectories directly
            for sub in subdirs:
                sub_p = os.path.join(folder, sub)
                code = "pt" if is_master_images_folder(sub) else identify_language_from_name(sub)
                if code:
                    imgs = [os.path.join(sub_p, f) for f in os.listdir(sub_p) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                    if imgs:
                        self.manual_detected_data[code] = {"folder": sub_p, "images": imgs}

        # If no subfolder was recognized, check if folder itself contains images directly
        if not self.manual_detected_data:
            direct_imgs = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
            if direct_imgs:
                code = identify_language_from_name(os.path.basename(folder)) or "pt"
                self.manual_detected_data[code] = {"folder": folder, "images": direct_imgs}

        # 2. Match audios
        audio_input = self.audio_entry.get().strip()
        if audio_input and os.path.exists(audio_input):
            if os.path.isdir(audio_input):
                for af in os.listdir(audio_input):
                    if af.lower().endswith((".mp3", ".wav", ".m4a", ".aac")):
                        code = identify_language_from_name(af)
                        if code and code in self.manual_detected_data:
                            self.manual_detected_data[code]["audio"] = os.path.join(audio_input, af)
            elif os.path.isfile(audio_input):
                code = identify_language_from_name(os.path.basename(audio_input))
                if code and code in self.manual_detected_data:
                    self.manual_detected_data[code]["audio"] = audio_input
                elif len(self.manual_detected_data) == 1:
                    only_code = list(self.manual_detected_data.keys())[0]
                    self.manual_detected_data[only_code]["audio"] = audio_input

        # 3. Update Checkboxes & Badges
        for code, info in LANGUAGES_DB.items():
            if code in self.manual_detected_data:
                data = self.manual_detected_data[code]
                img_cnt = len(data.get("images", []))
                has_audio = "audio" in data and os.path.exists(data["audio"])
                audio_str = os.path.basename(data["audio"]) if has_audio else "⚠️ Sem áudio"
                color = "#10b981" if has_audio else "#f59e0b"
                icon = "🎵" if has_audio else ""

                self.manual_lang_vars[code].set(True)
                if code in self.manual_lang_badges:
                    self.manual_lang_badges[code].configure(
                        text=f"📁 {img_cnt} imgs | {icon} {audio_str}",
                        text_color=color
                    )
            else:
                self.manual_lang_vars[code].set(False)
                if code in self.manual_lang_badges:
                    self.manual_lang_badges[code].configure(
                        text="(Não detectado nesta pasta)",
                        text_color="#64748b"
                    )

        total_detected = len(self.manual_detected_data)
        total_audios = sum(1 for d in self.manual_detected_data.values() if "audio" in d)

        if total_detected > 0:
            det_names = [LANGUAGES_DB[c]["name"] for c in self.manual_detected_data.keys()]
            self.lbl_images.configure(
                text=f"✨ {total_detected} idioma(s) detectado(s): {', '.join(det_names[:6])}{'...' if len(det_names) > 6 else ''}",
                text_color="#10b981"
            )
        else:
            self.lbl_images.configure(
                text="❌ Nenhuma pasta de idioma ou imagens encontradas nesta pasta",
                text_color="#ef4444"
            )

        if total_audios > 0:
            self.lbl_audio.configure(
                text=f"✅ {total_audios} de {total_detected} áudio(s) correspondentes casados com sucesso!",
                text_color="#10b981"
            )
        else:
            self.lbl_audio.configure(
                text="⚠️ Nenhum áudio casado automaticamente para os idiomas detectados",
                text_color="#f59e0b"
            )

        self._update_manual_action_button()

    def _manual_select_detected(self):
        for code, var in self.manual_lang_vars.items():
            var.set(code in self.manual_detected_data)
        self._update_manual_action_button()

    def _manual_toggle_all(self, select_all=True):
        for var in self.manual_lang_vars.values():
            var.set(select_all)
        self._update_manual_action_button()

    def _on_manual_checkbox_changed(self):
        self._update_manual_action_button()

    def _update_manual_action_button(self):
        checked_codes = [c for c, v in self.manual_lang_vars.items() if v.get()]
        count = len(checked_codes)
        if count == 0:
            self.btn_generate.configure(text="⚡ SELECIONE AO MENOS 1 IDIOMA PARA GERAR")
        elif count == 1:
            code = checked_codes[0]
            name = LANGUAGES_DB[code]["name"]
            self.btn_generate.configure(text=f"⚡ GERAR VÍDEOS DE {name.upper()} ({code.upper()})")
        else:
            self.btn_generate.configure(text=f"⚡ GERAR VÍDEOS DOS {count} IDIOMAS SELECIONADOS")

    def _filter_manual_langs_display(self):
        query = normalize_text(self.manual_lang_search_var.get())
        for code, row in self.manual_lang_rows.items():
            info = LANGUAGES_DB[code]
            if not query or query in normalize_text(info["name"]) or query in code or any(query in normalize_text(k) for k in info["keys"]):
                row.pack(fill="x", padx=8, pady=2)
            else:
                row.pack_forget()

    def _manual_rename_images(self):
        folder = self.folder_entry.get().strip()
        if not folder or not os.path.exists(folder):
            messagebox.showwarning("Aviso", "Por favor, selecione uma pasta válida primeiro!")
            return

        checked_codes = [c for c, v in self.manual_lang_vars.items() if v.get()]
        folders_to_rename = []

        if self.manual_detected_data:
            for code in checked_codes:
                if code in self.manual_detected_data:
                    f = self.manual_detected_data[code].get("folder")
                    if f and os.path.exists(f) and f not in folders_to_rename:
                        folders_to_rename.append(f)
        if not folders_to_rename:
            folders_to_rename.append(folder)

        total_renamed = 0
        for f in folders_to_rename:
            imgs, was_ren = standardize_folder_images(f)
            if was_ren:
                total_renamed += 1
                self._log(f"🪄 [Renomear] {len(imgs)} imagens padronizadas para 1 a 6 em: {os.path.basename(f)}")

        if total_renamed > 0:
            messagebox.showinfo("Sucesso!", f"Imagens padronizadas para 1 a 6 com sucesso em {total_renamed} pasta(s)!")
            self._analyze_manual_folder()
        else:
            messagebox.showinfo("Aviso", "As imagens selecionadas já estão no padrão 1 a 6 (1-3 Feed, 4-6 Reels)!")

    def _start_single_generation(self):
        if self.is_processing:
            return

        folder = self.folder_entry.get().strip()
        if not folder or not os.path.exists(folder):
            messagebox.showwarning("Aviso", "Por favor, selecione uma pasta válida primeiro!")
            return

        checked_codes = [c for c, v in self.manual_lang_vars.items() if v.get()]
        if not checked_codes:
            messagebox.showwarning("Aviso", "Selecione pelo menos um idioma para processar!")
            return

        jobs = []
        missing_images = []
        missing_audios = []

        audio_input = self.audio_entry.get().strip()
        audio_dir = audio_input if os.path.isdir(audio_input) else (os.path.dirname(audio_input) if os.path.isfile(audio_input) else "")

        for code in checked_codes:
            info = LANGUAGES_DB[code]
            lang_name = info["name"]

            # 1. Resolve image folder
            target_img_folder = None
            imgs = []

            if code in self.manual_detected_data and os.path.exists(self.manual_detected_data[code].get("folder", "")):
                target_img_folder = self.manual_detected_data[code]["folder"]
            else:
                for sub in os.listdir(folder):
                    sub_p = os.path.join(folder, sub)
                    if os.path.isdir(sub_p):
                        if identify_language_from_name(sub) == code or (code == "pt" and sub == "1. Imagens"):
                            target_img_folder = sub_p
                            break

            if not target_img_folder:
                direct_imgs = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith((".png", ".jpg", ".jpeg"))]
                if direct_imgs:
                    target_img_folder = folder

            if target_img_folder and os.path.exists(target_img_folder):
                imgs = [os.path.join(target_img_folder, f) for f in os.listdir(target_img_folder) if f.lower().endswith((".png", ".jpg", ".jpeg"))]

            if not imgs:
                missing_images.append(f"{lang_name} ({code})")
                continue

            # 2. Resolve audio
            audio_path = None
            if code in self.manual_detected_data and self.manual_detected_data[code].get("audio") and os.path.exists(self.manual_detected_data[code]["audio"]):
                audio_path = self.manual_detected_data[code]["audio"]
            elif os.path.isfile(audio_input) and len(checked_codes) == 1:
                audio_path = audio_input
            elif audio_dir and os.path.exists(audio_dir):
                for af in os.listdir(audio_dir):
                    if af.lower().endswith((".mp3", ".wav", ".m4a", ".aac")):
                        if identify_language_from_name(af) == code:
                            audio_path = os.path.join(audio_dir, af)
                            break

            if not audio_path or not os.path.exists(audio_path):
                missing_audios.append(f"{lang_name} ({code})")
                continue

            dest_folder = target_img_folder
            if code == "pt":
                # Portuguese videos must NEVER be saved inside "1. Imagens"
                folder_name = os.path.basename(os.path.normpath(target_img_folder))
                parent_dir = os.path.dirname(os.path.normpath(target_img_folder))
                if folder_name.lower() in ["1. imagens", "1.imagens", "imagens"]:
                    dest_folder = os.path.join(parent_dir, "Português")
                elif not folder_name.lower().startswith("portug"):
                    dest_folder = os.path.join(target_img_folder, "Português")

            jobs.append({
                "lang_code": code,
                "lang_name": lang_name,
                "src_folder": target_img_folder,
                "dest_folder": dest_folder,
                "images": sort_creatives(imgs),
                "audio": audio_path
            })

        if not jobs:
            msg = "Não foi possível montar os criativos:\n"
            if missing_images:
                msg += f"• Sem imagens: {', '.join(missing_images)}\n"
            if missing_audios:
                msg += f"• Sem áudio casado: {', '.join(missing_audios)}\n"
            messagebox.showwarning("Aviso", msg)
            return

        if missing_audios or missing_images:
            warn = "Alguns idiomas selecionados não puderam ser montados:\n"
            if missing_images:
                warn += f"• Sem imagens: {', '.join(missing_images)}\n"
            if missing_audios:
                warn += f"• Sem áudio: {', '.join(missing_audios)}\n"
            warn += f"\nDeseja continuar e renderizar os {len(jobs)} idioma(s) prontos?"
            if not messagebox.askyesno("Continuar?", warn):
                return

        self.is_processing = True
        self.is_paused = False
        self.is_cancelled = False
        self.pause_event.set()
        self.active_mode = "manual"
        self.btn_generate.configure(state="disabled", text="⏳ Renderizando Idiomas...")
        self._update_pause_cancel_ui()
        self.progress_bar.set(0)

        threading.Thread(target=self._process_multi_manual_worker, args=(jobs,), daemon=True).start()

    def _process_multi_manual_worker(self, jobs):
        try:
            do_round = self.chk_single_round.get()
            do_cleanup = self.chk_single_cleanup.get()

            total_jobs = len(jobs)
            total_videos = sum(len(j["images"]) for j in jobs)
            self._log(f"\n🚀 [MODO MANUAL] Iniciando renderização de {total_jobs} idioma(s) ({total_videos} vídeos no total)...")

            current_video_idx = 0
            total_completed = 0
            total_errors = 0
            cleanup_candidates = []
            failed_items = []
            self.last_failed_items = []
            self.last_cleanup_candidates = []
            self.last_do_cleanup = do_cleanup

            for job in jobs:
                if self.is_cancelled:
                    break

                lang_code = job["lang_code"]
                lang_name = job["lang_name"]
                src_folder = job["src_folder"]
                dest_folder = job["dest_folder"]
                images = job["images"]
                audio = job["audio"]

                is_portuguese = (
                    lang_code == "pt"
                    or lang_name.lower() in ["português", "portugues"]
                    or "1. imagens" in src_folder.lower()
                    or "1. imagens" in dest_folder.lower()
                    or os.path.basename(src_folder).lower() in ["1. imagens", "1.imagens", "imagens"]
                )

                os.makedirs(dest_folder, exist_ok=True)
                raw_dur = get_audio_duration(audio)
                target_dur = math.ceil(raw_dur) if do_round else raw_dur

                self._log(f"\n📂 [{lang_name} ({lang_code})]")
                self._log(f"   • Pasta: {dest_folder}")
                self._log(f"   • Áudio: {os.path.basename(audio)} ({raw_dur:.2f}s ➔ {target_dur}s)")

                generated_files = []

                for idx, img_path in enumerate(images, start=1):
                    if self.is_cancelled:
                        break

                    if self.is_paused:
                        self._log("   ⏸️ [PAUSA] Aguardando clique em 'Continuar'...")
                        self.pause_event.wait()
                        if self.is_cancelled:
                            break

                    current_video_idx += 1
                    out_name = f"{idx}.mp4"
                    out_path = os.path.join(dest_folder, out_name)

                    # Verifica se o vídeo já existe e está completo (evita reprocessamento)
                    if os.path.exists(out_path) and os.path.getsize(out_path) > 10240:
                        self._log(f"   ⏩ [{current_video_idx}/{total_videos}] {out_name} já existe e está pronto! Pulando...")
                        generated_files.append(out_path)
                        total_completed += 1
                        self.progress_bar.set(current_video_idx / total_videos)
                        continue

                    # Verifica integridade da imagem para não travar FFmpeg
                    if not is_image_valid(img_path):
                        reason = f"Imagem '{os.path.basename(img_path)}' corrompida, vazia ou incompleta"
                        self._log(f"   ⚠️ [ALERTA] Imagem {os.path.basename(img_path)} corrompida ou incompleta. Pulando!")
                        total_errors += 1
                        failed_items.append({
                            "campaign": os.path.basename(os.path.dirname(os.path.normpath(src_folder))) or "Modo Manual",
                            "bloco": os.path.basename(os.path.normpath(src_folder)),
                            "lang": lang_name,
                            "out_name": out_name,
                            "out_path": out_path,
                            "img_path": img_path,
                            "folder": src_folder,
                            "audio": audio,
                            "target_dur": target_dur,
                            "reason": reason,
                            "do_cleanup": do_cleanup,
                            "is_master": is_portuguese
                        })
                        self.progress_bar.set(current_video_idx / total_videos)
                        continue

                    cmd = [
                        FFMPEG_PATH,
                        "-loop", "1",
                        "-i", img_path,
                        "-i", audio,
                        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                        "-c:v", "libx264",
                        "-tune", "stillimage",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-af", "apad",
                        "-t", str(target_dur),
                        "-pix_fmt", "yuv420p",
                        "-y",
                        out_path
                    ]

                    res = run_ffmpeg(cmd, timeout=120, process_holder=self.current_ffmpeg_proc)

                    if self.is_cancelled:
                        if os.path.exists(out_path) and os.path.getsize(out_path) < 10240:
                            try:
                                os.remove(out_path)
                            except Exception:
                                pass
                        break

                    if res.returncode != 0:
                        total_errors += 1
                        err_msg = res.stderr.decode("utf-8", errors="replace").strip()
                        reason = f"Falha no FFmpeg ao renderizar {out_name}: {err_msg[:120].strip()}"
                        self._log(f"   ❌ Erro em {out_name}: {err_msg[:200]}")
                        failed_items.append({
                            "campaign": os.path.basename(os.path.dirname(os.path.normpath(src_folder))) or "Modo Manual",
                            "bloco": os.path.basename(os.path.normpath(src_folder)),
                            "lang": lang_name,
                            "out_name": out_name,
                            "out_path": out_path,
                            "img_path": img_path,
                            "folder": src_folder,
                            "audio": audio,
                            "target_dur": target_dur,
                            "reason": reason,
                            "do_cleanup": do_cleanup,
                            "is_master": is_portuguese
                        })
                    else:
                        generated_files.append(out_path)
                        total_completed += 1
                        self._log(f"   ✅ [{current_video_idx}/{total_videos}] {out_name} OK ({target_dur}s)")

                    self.progress_bar.set(current_video_idx / total_videos)

                # Coletar candidatos para limpeza futura (SEM apagar agora!)
                if is_portuguese:
                    self._log(f"   🛡️ [{lang_name}] Imagens master PRESERVADAS em '{os.path.basename(src_folder)}'.")
                elif do_cleanup:
                    for img_p in images:
                        if img_p not in cleanup_candidates:
                            cleanup_candidates.append(img_p)

            # Avaliação final pós-geração manual
            if self.is_cancelled:
                self.last_failed_items = failed_items
                self.last_cleanup_candidates = cleanup_candidates
                save_session_state({
                    "mode": "manual",
                    "status": "incompleto_cancelado",
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "failed_items": failed_items,
                    "cleanup_candidates": cleanup_candidates,
                    "do_cleanup": do_cleanup
                })
                self.after(200, self._update_error_banner)
                self._log(f"\n⏹️ [CANCELADO] Renderização interrompida. {total_completed} vídeos concluídos foram preservados.")
                self._log("🛡️ [PRESERVAÇÃO] Nenhuma imagem foi apagada porque o processo foi cancelado.")
                messagebox.showwarning("Cancelado", f"Processo cancelado pelo usuário!\n{total_completed} vídeos gerados foram preservados.\nTodas as imagens originais foram mantidas intactas.")
            elif self.is_paused:
                self.last_failed_items = failed_items
                self.last_cleanup_candidates = cleanup_candidates
                save_session_state({
                    "mode": "manual",
                    "status": "incompleto_pausado",
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "failed_items": failed_items,
                    "cleanup_candidates": cleanup_candidates,
                    "do_cleanup": do_cleanup
                })
                self.after(200, self._update_error_banner)
                self._log(f"\n⏸️ [PAUSADO] Processo pausado. {total_completed} vídeos concluídos até o momento.")
                self._log("🛡️ [PRESERVAÇÃO] Nenhuma imagem foi apagada enquanto o processo estiver pausado.")
            else:
                if len(failed_items) == 0 and total_errors == 0:
                    clear_session_state()
                    self.last_failed_items = []
                    self.last_cleanup_candidates = []
                    self.after(100, self._update_error_banner)
                    if do_cleanup and cleanup_candidates:
                        deleted_count = 0
                        for img_p in cleanup_candidates:
                            try:
                                if os.path.exists(img_p):
                                    os.remove(img_p)
                                    deleted_count += 1
                            except Exception as e:
                                self._log(f"   ⚠️ Aviso ao apagar imagem: {e}")
                        self._log(f"\n🗑️ [LIMPEZA FINAL] {deleted_count} imagens originais traduzidas foram removidas com segurança (100% de sucesso sem nenhum erro)!")

                    self._log(f"\n🎉 SUCESSO! Todos os {total_videos} vídeos de {total_jobs} idioma(s) foram gerados com perfeição!\n")
                    messagebox.showinfo("Sucesso!", f"Os {total_videos} vídeos MP4 de {total_jobs} idioma(s) foram gerados com sucesso!")
                else:
                    self.last_failed_items = failed_items
                    self.last_cleanup_candidates = cleanup_candidates
                    self.last_do_cleanup = do_cleanup
                    save_session_state({
                        "mode": "manual",
                        "status": "incompleto_erros",
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "failed_items": failed_items,
                        "cleanup_candidates": cleanup_candidates,
                        "do_cleanup": do_cleanup
                    })
                    self.after(200, self._update_error_banner)
                    self.after(500, self._show_error_dialog)
                    self._log(f"\n⚠️ Processamento concluído com {len(failed_items)} erro(s). Imagens originais PRESERVADAS para conferência.")
                    self._log("💡 Abrindo Central de Resolução de Erros com atalhos diretos para as pastas...")

        except Exception as e:
            self._log(f"❌ Erro: {str(e)}")
            messagebox.showerror("Erro", str(e))

        finally:
            self.is_processing = False
            self.is_paused = False
            self.is_cancelled = False
            self._update_manual_action_button()
            self._update_pause_cancel_ui()

if __name__ == "__main__":
    app = TwodStudioApp()
    app.mainloop()
