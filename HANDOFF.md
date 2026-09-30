# Handoff do PokeBot

Este documento permite retomar o projeto em outro computador ou conversa sem depender do histórico do chat.

## Objetivo

O PokeBot e um aplicativo desktop Windows em Electron com dois modulos independentes:

1. **Enquetes**: monitora um grupo no WhatsApp Web e vota automaticamente em opcoes da ultima mensagem que combinem com termos configurados.
2. **Compras**: monitora links cadastrados da Amazon.com.br e, quando encontrar uma oferta dentro do preco maximo, adiciona ao carrinho e abre a revisao do pedido. O pedido final nunca e enviado automaticamente.

## Repositorio e projeto

- Repositorio: `https://github.com/Gibaaz/PokeBot.git`
- Projeto local atual: `D:\Projects\whatsapp-poll-bot`
- Branch principal: `main`
- Plataforma alvo: Windows x64
- Stack: Node.js, Electron, Playwright e JavaScript sem framework frontend

## Comandos

```powershell
npm install
npm start
npm run check
npm run build
```

- `npm start`: inicia o aplicativo Electron para desenvolvimento.
- `npm run check`: valida a sintaxe de todos os scripts relevantes.
- `npm run build`: gera o executavel portatil em `release\PokeBot 1.0.0.exe`.

Feche todos os processos `PokeBot` antes de rodar `npm run build`; caso contrario, o Windows bloqueia a substituicao do executavel.

## Estrutura

```text
src/
  bot.js                 Automacao de enquetes do WhatsApp Web
  product-monitor.js     Monitoramento Amazon e checkout assistido
  main.js                Processo principal Electron e armazenamento local
  preload.cjs            Ponte IPC segura entre interface e processo principal
public/
  index.html             Interface desktop
  app.js                 Estado e eventos da interface
  styles.css             Estilos responsivos inspirados no shadcn/ui
config.example.json      Exemplo de configuracao de enquetes
```

## Dados locais e seguranca

Nada abaixo deve ser enviado ao Git:

- `config.json`: configuracao local antiga/de desenvolvimento.
- Perfil WhatsApp: pasta `whatsapp-profile` nos dados locais da aplicacao.
- Perfil Amazon: pasta `amazon-profile` nos dados locais da aplicacao.
- Lista de compras: `products.json` nos dados locais da aplicacao.
- Executaveis: pasta `release`.

O Electron usa `app.getPath('userData')`, portanto instalacoes empacotadas guardam configuracoes e sessoes em uma pasta gravavel do Windows, nunca dentro de `app.asar`.

## Modulo Enquetes

### Fluxo

1. Configure nome exato do grupo e termos no painel Enquetes.
2. Clique em Iniciar.
3. Leia o QR code do WhatsApp se for solicitado.
4. O bot abre o grupo e monitora somente a ultima mensagem visivel.
5. Se a ultima mensagem for uma enquete, clica uma unica vez em opcoes que correspondam aos termos.

### Protecoes implementadas

- Normaliza acentos, maiusculas e repeticoes de letras nos termos.
- Ignora contadores de votos ao identificar uma opcao, evitando o segundo clique que remove o voto.
- Impede varreduras simultaneas.
- Pausa se a conversa aberta nao for mais o grupo configurado.
- Para e mostra erro se a janela do WhatsApp fechar.

### Limites conhecidos

O WhatsApp Web muda o DOM com frequencia. Os seletores em `src/bot.js` podem precisar de ajuste caso o bot nao localize a busca, o grupo ou opcoes de enquete.

## Modulo Compras

### Fluxo

1. Abra a aba Compras.
2. Adicione o link da Amazon.com.br, preco maximo e intervalo.
3. Clique em Iniciar monitor.
4. A janela da Amazon abre usando um perfil persistente separado.
5. Faca login manualmente se necessario.
6. O bot verifica cada item ativo em intervalos de 1, 2 ou 5 minutos.
7. Quando houver oferta dentro do limite, tenta adicionar ao carrinho e abrir a revisao do pedido.
8. O item fica em `Em revisao` e e desativado para nao repetir a tentativa.
9. Se voce recusar a compra ou remover o item do carrinho, clique em `Voltar a monitorar` para reativar o item.

### Comportamento de seguranca

- O fluxo para antes do botao final de envio do pedido.
- Login, CAPTCHA, verificacao ou preco nao identificado colocam o item em atencao para resolucao manual.
- O perfil da Amazon e separado do perfil do WhatsApp.
- O alerta sonoro usa o dispositivo de audio padrao do Windows quando um produto fica disponivel dentro do limite.

### Limitacoes atuais

- Apenas Amazon.com.br e suportada.
- O bot depende dos seletores atuais da Amazon e pode requerer manutencao se a pagina mudar.
- A validacao de vendedor e frete ainda nao foi adicionada; atualmente a decisao usa disponibilidade e preco maximo.
- Quando houver varias ofertas, a pagina pode exigir revisao manual se nao expuser um botao de carrinho identificavel.

## Interface

- A barra lateral separa as funcoes em Enquetes e Compras.
- Controles do WhatsApp so aparecem em Enquetes.
- Controles da Amazon so aparecem em Compras.
- A aba Compras usa dois paineis em tela larga: produtos a esquerda e eventos a direita.
- Em telas menores, os paineis ficam empilhados.

## Estado de desenvolvimento

As ultimas alteracoes importantes incluem:

- Monitoramento Amazon e checkout assistido.
- Barra lateral separando Enquetes e Compras.
- Alertas sonoros para disponibilidade.
- Acao `Voltar a monitorar` apos revisao ou atencao.
- Ajuste responsivo da tela de Compras.

Antes de alterar automacoes, rode `npm run check`. Antes de entregar uma nova versao ao usuario, rode `npm run build` depois de fechar o aplicativo.

## Proximos passos sugeridos

1. Testar manualmente o monitor com item esgotado, item disponivel e item acima do limite.
2. Adicionar configuracao por item para vendedor permitido e limite de frete.
3. Salvar capturas de tela apenas em falhas de monitoramento para diagnostico.
4. Adicionar testes unitarios para extracao de ASIN e conversao de preco brasileiro.
5. Ajustar seletores de WhatsApp/Amazon somente apos registrar o DOM ou mensagem de erro observada.

## Padrao de commits

Usar Conventional Commits com emoji, conforme `iuricode/padroes-de-commits`:

```text
✨ feat: Nova funcionalidade
🐛 fix: Correcao de bug
💄 feat: Alteracao visual
📚 docs: Atualizacao de documentacao
📦 build: Alteracao de empacotamento
```

Criar commits pequenos e separados por responsabilidade. Antes de enviar, rodar `git status`, `git diff --check`, `git log --oneline -10` e `npm run check`.
