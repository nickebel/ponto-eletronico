# Ponto Eletrônico

Base de desenvolvimento de um sistema web de controle de jornada.

> **Não é um REP-P pronto para uso.** A aplicação está em desenvolvimento. Não inserir dados reais de empregados nem utilizar para registrar jornada oficialmente.

## Arquitetura
- Frontend: GitHub Pages (`public/`).
- API: Cloudflare Worker (`worker/src/index.js`).
- Banco: Cloudflare D1 (`ponto-db`, binding `DB`).
- Frontend publicado por GitHub Actions; Worker publicado pela integração Git do Cloudflare.

## Primeira configuração e autenticação
1. Executar as instruções SQL de `migrations/0002_auth.sql` no Console do D1, uma por vez.
2. No painel Cloudflare, abrir **Workers & Pages → ponto-eletronico → Settings → Variables and Secrets**.
3. Criar um segredo chamado `BOOTSTRAP_SECRET`, com pelo menos 32 caracteres aleatórios. Não coloque o valor no GitHub nem nesta conversa.
4. Criar outro segredo chamado `PASSWORD_PEPPER`, também com pelo menos 32 caracteres aleatórios. **Esse segredo precisa permanecer no Worker**; guarde-o em um gerenciador de senhas e nunca o coloque no GitHub.
5. Fazer deploy do Worker para ativar os segredos.
6. Abrir o site, preencher nome da empresa, nome/e-mail do administrador, senha (mínimo 12 caracteres) e a chave temporária.
7. Depois de concluir a configuração inicial, remover apenas `BOOTSTRAP_SECRET` do Worker. **Não remova `PASSWORD_PEPPER`**, pois ele é necessário para validar os logins.

O cadastro inicial é protegido por uma chave de uso único e por uma trava transacional no D1. A senha é pré-processada com HMAC-SHA-256 usando o segredo persistente `PASSWORD_PEPPER` e, em seguida, armazenada como hash PBKDF2-HMAC-SHA-256 com salt individual e 100.000 iterações. O limite de 100.000 iterações é imposto pelo runtime atual do Cloudflare Workers; essa configuração não equivale à recomendação de 600.000 iterações da OWASP. A proteção adicional por pepper reduz o risco em caso de exposição isolada do banco, mas não elimina a necessidade de uma revisão de segurança antes de produção. Sessões expiram em 8 horas; o token é guardado apenas no `sessionStorage` da aba e no D1 somente como hash.

## Limitações
Ainda faltam módulos de funcionários, escalas, marcações, comprovantes, AFD/AEJ, sincronização com a Hora Legal Brasileira, trilha de integridade completa, backups testados e validação legal/técnica do REP-P. É necessário revisar a aplicação com profissionais técnicos e trabalhistas antes de qualquer uso oficial.

O repositório é público para usar GitHub Pages no GitHub Free. Não commitar senhas, tokens, chaves, CPF ou dados reais de empregados.
