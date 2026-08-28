# Manual do operador

Guia passo a passo para instalar, rodar e operar a Central de Prospecção da Lemoncaps na sua máquina.

O sistema roda **local**. Nada é publicado na internet e nenhuma mensagem sai da máquina enquanto as integrações estiverem em modo simulado.

---

## 1. Antes de começar

Você precisa de:

- **Node.js 24** (versão LTS). Confira com `node --version`.
- **pnpm 11**. Instale com `npm install -g pnpm` se não tiver.

Instale as dependências do projeto:

```bash
pnpm install
```

---

## 2. Arquivos de configuração

Dois arquivos guardam tudo que é específico do seu negócio. **Nenhum dos dois vai para o Git.**

### `config/business.json`

Identidade da empresa, oferta, público-alvo e — o mais importante — as afirmações que a IA pode e não pode enviar.

Se ainda não existir, copie o modelo:

```bash
cp config/business.example.json config/business.json
```

Depois preencha com os dados reais.

> **A parte que mais importa: `verifiedClaims`.**
> A IA só pode enviar o que está nessa lista, **sem parafrasear**. Escreva cada afirmação exatamente na forma que pode chegar ao lead.
>
> - Serve: `"Operação em Cuiabá/MT"`, `"Atua com projetos de marca própria"`.
> - Não serve: `"as melhores taxas do mercado"` — superlativo não é afirmação verificável.
>
> A lista `unverifiedClaims` é o bloqueio explícito. No nosso caso ela cobre o terreno regulado: cura, tratamento de doenças, emagrecimento garantido, eficácia clínica sem estudo e registro na Anvisa sem documentação. **Não remova esses itens sem documentação oficial que os sustente.**

Campos que ainda não existem podem ficar como `null` (é o caso de `affiliateGroupLink` hoje). O sistema mostra "não configurado" no painel em vez de inventar um link.

### `.env`

Copie o modelo e preencha:

```bash
cp .env.example .env
```

Enquanto você estiver testando, **mantenha estas quatro linhas como estão**:

```
BROWSER_MODE=simulated
INSTAGRAM_MODE=simulated
BROWSER_LIVE_AUTHORIZED=false
INSTAGRAM_LIVE_AUTHORIZED=false
```

Elas são a trava de segurança: com esses valores, nenhuma mensagem real é enviada, aconteça o que acontecer.

---

## 3. Chave da OpenAI

1. Acesse <https://platform.openai.com/api-keys>.
2. Crie a chave dentro de um **projeto separado**, só para este sistema. Assim, se precisar revogar, você não derruba nada mais.
3. Escolha a permissão **Restricted**. Não use uma chave com permissão total.
4. Vá em **Settings → Limits** e defina um **hard limit mensal**. Esse é o seu freio de verdade: o limite da OpenAI corta o gasto mesmo que algo dê errado do lado de cá.
5. Cole a chave no `.env`, em `OPENAI_API_KEY`.

Defina também `OPENAI_MONTHLY_BUDGET_USD`. O sistema soma o custo de cada chamada e **pausa sozinho** ao bater nesse teto — é uma segunda barreira, antes do limite da OpenAI.

> Os nomes dos modelos em `OPENAI_MODEL` e `OPENAI_MODEL_FAST` precisam ser **identificadores exatos**. Apelidos que mudam sozinhos (qualquer coisa com `latest`) são recusados na inicialização, porque a qualidade das mensagens mudaria sem aviso.

---

## 4. Rodar

Um único comando sobe o painel e o worker juntos:

```bash
pnpm dev
```

- **Painel:** <http://localhost:3000>
- **Worker:** roda no mesmo terminal, processando a fila de trabalhos.

Para ver o sistema funcionando com dados de demonstração:

```bash
pnpm evidence
```

Esse comando cadastra leads de exemplo e percorre o fluxo real: descoberta, deduplicação, pontuação, recebimento de resposta por webhook, decisão da IA e distribuição em experimento. Tudo em modo simulado.

Para produção local:

```bash
pnpm build
pnpm start
```

---

## 5. Pausar

**Pelo painel:** menu **Operação → Pausar tudo**. O worker para de enviar na hora, e a mudança fica registrada no log de auditoria com data, hora e responsável.

O sistema também **pausa sozinho** quando detecta risco: estouro do orçamento de IA, circuito de integração aberto, erro repetido ou divergência entre canais.

> Se o registro da pausa estiver ausente ou corrompido no banco, o sistema assume **pausado**. A falha sempre cai para o lado seguro.

---

## 6. Backup e restauração

Os backups saem na pasta `backups/`, e cada um passa por verificação de integridade ao ser criado.

Para restaurar:

1. Pare o sistema (`Ctrl+C` no terminal do `pnpm dev`).
2. Guarde o banco atual, por segurança:
   ```bash
   mv data/prospecting.db data/prospecting.db.antigo
   ```
3. Copie o backup escolhido para o lugar:
   ```bash
   cp backups/NOME-DO-BACKUP.db data/prospecting.db
   ```
4. Suba de novo com `pnpm dev` e confira no painel se os números batem.

> Teste a restauração **antes** de precisar dela. Backup que nunca foi restaurado não é backup, é esperança.

---

## 7. Se a chave da OpenAI vazar

Nesta ordem:

1. Vá em <https://platform.openai.com/api-keys> e **revogue a chave** imediatamente. Isso vem antes de qualquer investigação.
2. Crie uma chave nova, no mesmo projeto restrito, e atualize o `.env`.
3. Confira o consumo em **Usage** no painel da OpenAI, procurando gasto que não foi seu.
4. Verifique se a chave não foi parar em algum commit:
   ```bash
   git log -p --all -S "sk-"
   ```
   Se tiver ido, revogar já resolveu o risco — mas troque também qualquer outro segredo que estivesse no mesmo arquivo.

O `.gitignore` já bloqueia `.env`, `config/business.json`, o banco e as pastas de dados. Não force o commit desses arquivos com `git add -f`.

---

## 8. Sobre a camada de navegador

O projeto contém uma integração com o Chrome via Playwright/CDP, **hoje desligada**:

- `BROWSER_MODE=simulated` faz tudo rodar contra uma página local de teste.
- Os trabalhos de primeiro contato pelo navegador **não estão registrados no worker**. Se algum for enfileirado, ele falha e aparece na fila de exceções do painel, em vez de rodar silenciosamente.

Vale registrar o motivo, porque é uma questão de risco e não de configuração: abrir conversa por automação de navegador contorna uma restrição que a Meta impõe de propósito — a API oficial não permite iniciar conversa com quem nunca respondeu. Isso expõe a conta a bloqueio e vai contra os Termos de Uso do Instagram.

O caminho que o sistema percorre é o sancionado: **quem responde entra pelo webhook oficial, e a conversa segue pela API oficial da Meta**, que é exatamente para isso que existe.

> ⚠️ **Se você optar por usar a porta de depuração do Chrome:** ela dá **controle total** sobre a sessão logada — ler mensagens, publicar, mudar senha. Mantenha sempre em `127.0.0.1`, **nunca** em `0.0.0.0`, e nunca em máquina compartilhada. Use um perfil dedicado, separado do seu Chrome pessoal.

---

## 9. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `next dev` falha com `ENOENT spawn pnpm` | pnpm fora do PATH | Instale com `npm install -g pnpm` e abra um terminal novo |
| "You can access the existing server at..." | Já tem um servidor rodando | Use o que está no ar, ou pare com `taskkill /PID <numero> /F` |
| Worker sobe mas nada acontece | Operação pausada | Veja **Operação** no painel e retome |
| `OPENAI_MODEL must be an exact model identifier` | Nome de modelo com apelido flutuante | Troque por um identificador exato, sem `latest` |
| Painel abre sem nenhum lead | Banco vazio | Rode `pnpm evidence` para popular com dados de demonstração |
