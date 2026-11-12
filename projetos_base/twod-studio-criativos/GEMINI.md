# TWOD Criativos Studio — Regras do Workspace

Este repositório contém a ferramenta **TWOD Criativos Studio V2**, desenvolvida para automatizar a renderização de criativos diários (vídeos MP4) para Meta Ads.

## Diretrizes Fundamentais

1. **Nichos Diários e Estrutura:**
   - Pasta de Vídeos: `C:\Users\thiag\OneDrive\Documentos\Trabalho\Vídeos\<Nicho> <Data>`
   - Pasta de Áudios: `C:\Users\thiag\OneDrive\Documentos\Trabalho\Arquivos de Áudio\<Nicho> <Data>`
   - São 3 nichos por dia, com `Bloco A` e `Bloco B`.

2. **Ciclo de Vida das Imagens:**
   - **`1. Imagens` (Português):** NUNCA deletar. As imagens são padronizadas como `1.png` a `6.png` (1-3 Feed, 4-6 Reels).
   - **`Espanhol` e `Inglês`:** As imagens brutas originais devem ser apagadas após gerar os vídeos MP4.

3. **Geração dos Vídeos:**
   - Vídeos salvos diretamente na pasta do idioma como `1.mp4` a `6.mp4` (sem subpasta `Videos_MP4` e sem `.zip`).
   - Duração do áudio sempre arredondada para cima com `math.ceil` e silêncio suave (`-af apad`).
   - Correção obrigatória de dimensões com `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"`.

4. **Executável Desktop:**
   - O executável principal fica na Área de Trabalho: `C:\Users\thiag\OneDrive\Área de Trabalho\TWOD Criativos Studio.exe`.
   - Sempre que `twod_studio.py` for alterado, o executável deve ser automaticamente recompilado e substituído na Área de Trabalho.
