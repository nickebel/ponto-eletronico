# Ponto Eletrônico

Base inicial de um sistema web de controle de jornada, com frontend e backend no mesmo repositório.

> **Somente desenvolvimento:** esta versão é uma prévia visual e uma base técnica. Não registra ponto, não gera AFD/AEJ válidos e não deve ser usada para controlar a jornada de empregados. Não insira dados reais de funcionários.

## Arquitetura
- **Frontend:** GitHub Pages, servido a partir da pasta `public/`.
- **Backend/API:** Cloudflare Workers, em `worker/src/index.js`.
- **Banco planejado:** Cloudflare D1, acessado apenas pelo Worker.
- **Publicação do frontend:** GitHub Actions a cada atualização da pasta `public/` na branch `main`.

## Estrutura
- `public/`: interface estática.
- `public/assets/config.js`: URL pública da API; sem segredos.
- `worker/src/`: backend executado no Cloudflare Workers.
- `migrations/`: esquema inicial do D1.
- `wrangler.toml`: configuração do Worker.

## GitHub Pages
1. No repositório, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Aguarde o workflow **Deploy GitHub Pages** terminar em Actions.
4. O endereço esperado do projeto é `https://nickebel.github.io/ponto-eletronico/`.

O GitHub Pages no GitHub Free requer um repositório público. Por isso, este repositório deve conter apenas código-fonte e documentação sem segredos ou dados pessoais. O site publicado é público. Para manter o código privado, use um plano GitHub compatível com Pages privado ou outra hospedagem.

## Cloudflare Worker e D1
1. Instale Node.js LTS e execute `npm install`.
2. O banco D1 `ponto-db` foi criado e seu ID já está configurado em `wrangler.toml`.
3. Confira se o banco aparece na mesma conta Cloudflare autenticada pelo Wrangler. O ID é um identificador, não um token.
4. Configure no Cloudflare os segredos necessários com `wrangler secret put NOME_DO_SEGREDO`; nunca os commite.
5. Teste localmente com `npm run dev:api`.
6. Publique a API com `npm run deploy:api`.
7. Depois de publicado, copie a URL `workers.dev` e configure `API_BASE_URL` em `public/assets/config.js`.

O Worker permite CORS somente para o endereço GitHub Pages deste projeto e endereços locais de desenvolvimento. Se mudar o domínio, ajuste a lista de origens permitidas no Worker.

## Conformidade
O enquadramento como REP-P depende da implementação e validação dos requisitos aplicáveis da Portaria MTP nº 671/2021 e seus anexos, do registro do programa no INPI e da documentação técnica exigida. Este repositório ainda não atende a esses requisitos. O projeto precisa de revisão técnica e trabalhista antes de qualquer uso oficial.

## Segurança e privacidade
- Não armazene tokens, senhas, CPFs ou dados de empregados no Git.
- Use somente dados sintéticos durante o desenvolvimento.
- Autenticação, autorização, trilha de auditoria, integridade, retenção, redundância e backups ainda precisam ser projetados, implementados e testados.
