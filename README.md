# Poll Runner

Aplicativo desktop para monitorar enquetes de um grupo no WhatsApp Web. Ele analisa apenas a ultima mensagem visivel e vota uma unica vez nas opcoes compatíveis com os termos configurados.

## Execucao

```powershell
npm start
```

O aplicativo abre como uma janela do Windows. Nele voce configura o grupo, adiciona ou remove termos, ajusta a frequencia e inicia ou para o bot.

Na primeira inicializacao, clique em **Iniciar bot** e leia o QR code na janela do WhatsApp Web. A sessao e a configuracao ficam salvas nos dados locais do aplicativo no Windows.

O repositorio inclui `config.example.json` somente como referencia. A configuracao usada pelo aplicativo e salva localmente e nao deve ser enviada ao Git.

## Executavel Windows

Para gerar um executavel portatil, execute:

```powershell
npm run build
```

O arquivo `.exe` sera criado na pasta `release`. Ele abre como aplicativo do Windows, sem servidor ou navegador para o painel.

## Observacoes

- O bot usa automacao do WhatsApp Web, que nao e uma integracao oficial e pode contrariar os termos do WhatsApp.
- Se o nome do grupo mudar, atualize-o no painel antes da proxima inicializacao.
- Mantenha o computador e a conexao ativos para o monitoramento funcionar.
