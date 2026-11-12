import os
import json
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

# ========================================================
# TWOD HUB — BACKEND REST API (LEITOR NATIVO DO ONEDRIVE)
# ========================================================

# Auto-detecta a pasta do OneDrive de Trabalho
DEFAULT_WORK_DIR = os.path.join(os.path.expanduser("~"), "OneDrive", "Documentos", "Trabalho")
if not os.path.exists(DEFAULT_WORK_DIR):
    # Fallback para o caminho absoluto padrão
    DEFAULT_WORK_DIR = r"C:\Users\thiag\OneDrive\Documentos\Trabalho"

PORT = int(os.environ.get("PORT", 8000))

def scan_onedrive_folders(base_path=DEFAULT_WORK_DIR):
    """Varre as pastas de Áudios e Vídeos no OneDrive e retorna o mapa completo de nichos."""
    audios_dir = os.path.join(base_path, "Arquivos de Áudio")
    videos_dir = os.path.join(base_path, "Vídeos")

    niches = {}

    def get_or_create(niche_name):
        if niche_name not in niches:
            niches[niche_name] = {
                "name": niche_name,
                "audios": [],
                "videos": {"feed": [], "reels": []},
                "status": "pending"
            }
        return niches[niche_name]

    # 1. Escaneia Áudios
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
                            "url": f"/api/audio/{entry.name}/{f.name}"
                        })

    # 2. Escaneia Vídeos
    if os.path.exists(videos_dir):
        for entry in os.scandir(videos_dir):
            if entry.is_dir():
                niche = get_or_create(entry.name)
                for lang_dir in os.scandir(entry.path):
                    if lang_dir.is_dir():
                        for vf in os.scandir(lang_dir.path):
                            if vf.is_file() and vf.name.lower().endswith(".mp4"):
                                num = int(vf.name[0]) if vf.name[0].isdigit() else 0
                                is_feed = 1 <= num <= 3
                                is_reels = 4 <= num <= 6

                                item_data = {
                                    "name": vf.name,
                                    "num": num,
                                    "lang": lang_dir.name,
                                    "size": vf.stat().st_size,
                                    "url": f"/api/video/{entry.name}/{lang_dir.name}/{vf.name}"
                                }
                                if is_feed:
                                    niche["videos"]["feed"].append(item_data)
                                elif is_reels:
                                    niche["videos"]["reels"].append(item_data)

    # 3. Calcula o status de cada nicho
    for n in niches.values():
        total = len(n["videos"]["feed"]) + len(n["videos"]["reels"])
        if total >= 6:
            n["status"] = "completed"
        elif total > 0:
            n["status"] = "partial"
        else:
            n["status"] = "pending"

    sorted_niches = sorted(list(niches.values()), key=lambda x: x["name"])
    return sorted_niches

class APIHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))

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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        with open(filepath, "rb") as f:
            while chunk := f.read(64 * 1024):
                self.wfile.write(chunk)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        # 1. Status do Backend
        if path == "/api/status":
            exists = os.path.exists(DEFAULT_WORK_DIR)
            self._send_json({
                "status": "online",
                "backend": "Python 3.11",
                "onedrive_path": DEFAULT_WORK_DIR,
                "onedrive_accessible": exists
            })

        # 2. Rota Principal: Listagem de Nichos e Arquivos via API
        elif path == "/api/onedrive/niches":
            try:
                niches = scan_onedrive_folders(DEFAULT_WORK_DIR)
                self._send_json({
                    "success": True,
                    "count": len(niches),
                    "niches": niches
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        # 3. Streaming de Áudio: /api/audio/<niche>/<filename>
        elif path.startswith("/api/audio/"):
            parts = path.replace("/api/audio/", "").split("/")
            if len(parts) >= 2:
                niche_name = parts[0]
                file_name = "/".join(parts[1:])
                filepath = os.path.join(DEFAULT_WORK_DIR, "Arquivos de Áudio", niche_name, file_name)
                self._serve_file(filepath)
            else:
                self._send_json({"error": "Caminho de áudio inválido"}, 400)

        # 4. Streaming de Vídeo: /api/video/<niche>/<lang>/<filename>
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

        else:
            self._send_json({"error": "Rota não encontrada"}, 404)

def run():
    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, APIHandler)
    print(f"🚀 TwoD Backend API rodando em http://localhost:{PORT}")
    print(f"📁 Monitorando OneDrive em: {DEFAULT_WORK_DIR}")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
