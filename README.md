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
4. Fazer deploy do Worker para ativar o segredo.
5. Abrir o site, preencher nome da empresa, nome/e-mail do administrador, senha (mínimo 12 caracteres) e a chave temporária.
6. Depois de concluir a configuração inicial, remover `BOOTSTRAP_SECRET` do Worker.

O cadastro inicial é protegido por uma chave de uso único e por uma trava transacional no D1. A senha é armazenada como hash PBKDF2-HMAC-SHA-256 com salt individual. Sessões expiram em 8 horas; o token é guardado apenas no `sessionStorage` da aba e no D1 somente como hash.

## Limitações
Ainda faltam módulos de funcionários, escalas, marcações, comprovantes, AFD/AEJ, sincronização com a Hora Legal Brasileira, trilha de integridade completa, backups testados e validação legal/técnica do REP-P. É necessário revisar a aplicação com profissionais técnicos e trabalhistas antes de qualquer uso oficial.

O repositório é público para usar GitHub Pages no GitHub Free. Não commitar senhas, tokens, chaves, CPF ou dados reais de empregados.
