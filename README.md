# Controle de Jornada

Base inicial de um sistema web de controle de jornada, com frontend e API no mesmo repositório.

> **Somente desenvolvimento:** esta versão é uma prévia visual e uma base técnica. Não registra ponto, não gera AFD/AEJ válidos e não deve ser usada para controlar a jornada de empregados. Não insira dados reais de funcionários.

## Stack
- Frontend: HTML, CSS e JavaScript.
- Hospedagem/API: Cloudflare Pages + Pages Functions.
- Banco planejado: Cloudflare D1.
- Repositório único para frontend, backend e migrações.

## Estrutura
- `public/`: interface web.
- `functions/api/`: endpoints server-side.
- `migrations/`: esquema inicial do D1.
- `wrangler.toml`: configuração Cloudflare.

## Desenvolvimento local
1. Instale Node.js LTS.
2. Execute `npm install`.
3. Execute `npm run dev`.

A prévia apresenta somente dados fictícios. O relógio exibido é o do navegador e não é confiável para registro oficial.

## Cloudflare
Configure Pages com diretório de saída `public` e sem comando de build. Depois, crie o banco D1, configure o binding `DB` no projeto Pages e atualize o `wrangler.toml` com o ID real do banco antes de aplicar migrações.

## Conformidade
O enquadramento como REP-P depende da implementação e validação dos requisitos aplicáveis da Portaria MTP nº 671/2021 e seus anexos, registro do programa no INPI e documentação técnica exigida. Este repositório ainda não atende a esses requisitos. O projeto precisa de revisão técnica e trabalhista antes de qualquer uso oficial.

## Segurança e privacidade
- **Torne este repositório privado antes de conectar serviços ou iniciar qualquer uso empresarial.**
- Nunca armazene tokens, senhas, CPFs ou dados de empregados no Git.
- Use dados sintéticos durante o desenvolvimento.
- Autenticação, autorização, trilha de auditoria, integridade, retenção, redundância e backups ainda precisam ser projetados, implementados e testados.
