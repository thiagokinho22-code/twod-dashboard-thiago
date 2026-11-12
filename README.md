# TwoD Hub — Central de Automações & Performance

Este repositório contém o esqueleto da **Dashboard Central da TwoD Company**, unificando as ferramentas de performance, geração de criativos diários, duplicação no Meta Ads e integração com a FUN Digital e WordPress.

---

## 🚀 Como Executar / Testar Localmente

Basta dar dois cliques no arquivo:
👉 `index.html` (abrirá direto no seu navegador Chrome/Edge).

---

## 👥 Usuários Pré-configurados (Acesso Rápido)

Na tela de login inicial, você pode usar os botões de **1 clique** ou digitar:

| Usuário | Senha | Cargo | Permissões |
| :--- | :--- | :--- | :--- |
| `thiago` | `123456` | **Administrador** | Acesso total + Gestão de Usuários |
| `alexandre` | `123456` | **Operador** | Ferramentas operacionais |
| `wesley` | `123456` | **Operador** | Ferramentas operacionais |

---

## ✨ Recursos Implementados no Esqueleto

1. **Autenticação & Controle de Cargos:**
   * Usuários com perfil `Administrador` têm acesso à aba exclusiva **Gestão de Usuários** (para criar novos logins, resetar senhas ou remover membros).
   * Operadores têm acesso apenas às ferramentas de trabalho.

2. **Motor de Tema (Claro, Escuro e Agendado):**
   * **Modo Claro (☀️):** Cores limpas e alto contraste.
   * **Modo Escuro (🌙):** Tema escuro para conforto visual.
   * **Automático por Horário (⏰):** Você define os horários (ex: das 06:00 às 18:00 fica Claro, fora desse intervalo vira Escuro automaticamente).

3. **Status de Conexões:**
   * Microsoft OneDrive (leitura/gravação de áudios e vídeos).
   * Meta Marketing API (duplicação sem navegador).
   * FUN Digital (integração com a extensão).
   * WordPress REST API (ajustes em massa).

4. **Fila FUN Digital (Controle de Sites):**
   * Inicializado com os **9 sites** da rotina diária (Ai, App, Twodcompany, F4rol, Hub, Kiocom, Kiuvix, Thehatsune).
   * Botão de **Ocultar/Exibir (Beta)** para não poluir a tela dos auxiliares com projetos em teste.
   * Opção para cadastrar novos sites e idiomas (PT, ES, EN).

5. **Módulos Prontos para Conexão Backend:**
   * 🎬 *Gerador de Criativos (TWOD Studio V2)*
   * 🚀 *Gerador Rápido de Campanhas Meta Ads*
   * 🔄 *Duplicador Meta Ads por Blocos de Países*
   * 📝 *WordPress Automator (Tags e Comentários)*

