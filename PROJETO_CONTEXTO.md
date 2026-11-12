# TwoD Hub — Contexto e Próximos Passos do Projeto

Este arquivo foi gerado para você abrir no outro computador e permitir que o agente continue o projeto exatamente de onde paramos, sem você precisar explicar tudo de novo.

---

## 📌 O que é o TwoD Hub?
É a **Dashboard Central da TwoD Company**, criada para unificar as ferramentas que a equipe vinha usando de forma separada:
1. **TWOD Criativos Studio V2 (Python / FFmpeg):** Renderiza os 6 vídeos diários (3 Feed 1080x1080 e 3 Reels 1080x1920) para os nichos em PT, ES e EN.
2. **Meta Ads Block Automator & Duplicador:** Duplicação em massa por blocos de países, orçamento de $1, anunciante verificado e tradução de textos.
3. **TwoD AutoFill (Extensão criada pelo auxiliar Alexandre):**
   - **FUN Digital:** Fila automática dos 9 sites (Ai, App, Twodcompany, F4rol, Hub, Kiocom, Kiuvix, Thehatsune), seleção de categoria, autor e preenchimento dos 3 textos secundários da IA.
   - **WordPress:** Ajuste em massa de tags e comentários nos blogs da rede.

---

## 🏗️ Decisões de Arquitetura Alinhadas
1. **Armazenamento:** Integração com o **Microsoft OneDrive** (`Documentos\Trabalho`) via Microsoft Graph API. Zero custo extra de armazenamento.
2. **Hospedagem & Atualizações:** Servidor na nuvem (ex: Render/Railway) conectado ao **GitHub**. Qualquer atualização é feita no Git e todo mundo recebe dando F5 (sem precisar de `.exe`).
3. **Meta Ads:** Migração gradual para a **Meta Marketing API oficial** (100% gratuita, sem travar o navegador).
4. **Permissões & Usuários:**
   - `thiago` (Administrador): Acesso total + Gestão de Usuários.
   - `alexandre` e auxiliares (Operadores): Foco nas ferramentas.
5. **Aparência:** Modos Claro, Escuro e Automático por Horário programável.

---

## 📂 Organização das Pastas e Códigos-Fonte
Tudo foi copiado e centralizado nesta mesma pasta do OneDrive:

1. **Dashboard Central Atual:**
   - `index.html`: Layout da nova central com autenticação, abas e modais.
   - `styles.css`: Estilização e suporte aos temas Claro / Escuro / Agendado por Horário.
   - `app.js`: Lógica de usuários, agendamento de temas e controle dos 9 sites da FUN Digital.
   - `README.md`: Instruções de acesso e logins de teste.

2. **Projetos Originais de Apoio (em `projetos_base/`):**
   - 📁 `projetos_base/twod-studio-criativos/`: Código fonte completo em Python (`twod_studio.py`), arquivos de configuração, executável e motor FFmpeg.
   - 📁 `projetos_base/extensao-duplicador-meta/`: Código fonte completo da extensão do Chrome para o Gerenciador de Anúncios (`automator.js`, `blocks.js`, etc.).
   - 📁 `projetos_base/extensao-alexandre-autofill/`: Código fonte completo da extensão do Alexandre para FUN Digital, Meta Ads e WordPress (`content.js`, `posts_data.js`, etc.).
   - 📁 `projetos_base/documentos_apoio/`: Histórico de automações e scripts PowerShell de pastas.

3. **Histórico Completo de Chats Salvos (em `historico_conversas/`):**
   - Contém a transcrição formatada de todas as conversas anteriores desde 04/11 até hoje (Meta Ads, AutoAds Blocos do Alexandre, planilhas de nichos e esta conversa).

---

## 🎯 Próximo Passo
Quando for continuar no outro PC:
- Conectar o backend Python para testar a leitura de arquivos no OneDrive e renderização dos criativos na nuvem (Fase 1).
