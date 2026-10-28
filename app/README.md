# Go Streams 0.17.0

Estúdio para vídeos, playlists e transmissão RTMP/RTMPS. Versão Windows compilada e pacote macOS experimental, ainda sem execução validada num Mac. Implementação independente orientada pelos recursos e modelos do Livecaster 4.12 inspecionados com REA. Não inclui binários, licenças, credenciais ou serviços privados do fornecedor.

## Edição Electron 0.17.0

A edição Electron tem janela e navegador incorporados. O instalador `.exe` cria atalhos no ambiente de trabalho e no menu Iniciar. Os dados mantêm-se em `%LOCALAPPDATA%\Go Streams\data`, separados dos ficheiros instalados, e o perfil Electron fica em `data\electron-session`. Atualizações e desinstalação preservam essa pasta.

Projetos e credenciais existentes são reutilizados. As preferências locais do antigo navegador podem ser copiadas na primeira abertura; os cookies protegidos do Edge/Chrome ficam intactos no perfil original e não são convertidos em cookies Electron. A passagem para um navegador diferente pode exigir autenticação inicial. Nas atualizações Electron seguintes, a pasta de sessão não muda.

Ao fechar a janela Electron, o motor é encerrado. Se houver transmissões ou operações ativas, a aplicação pede confirmação antes de as parar. Os links externos HTTPS abrem no navegador predefinido. A janela não expõe Node.js à interface e mantém o sandbox e o isolamento de contexto.

## Instalador Windows 0.16.0

Abra `GoStreams-0.16.0-Windows-Setup.msi`. Inclui todos os componentes e cria atalhos no ambiente de trabalho e no menu Iniciar, para o utilizador atual. A aplicação fica em `%LOCALAPPDATA%\Programs\Go Streams`; os dados ficam em `%LOCALAPPDATA%\Go Streams\data`.

Para atualizar, encerre o Go Streams e execute o MSI novo sobre a instalação existente. Não precisa de desinstalar primeiro. Projetos, definições, credenciais protegidas, perfis do navegador e sessões guardadas ficam fora dos ficheiros substituídos. A desinstalação também conserva essa pasta de dados. As transmissões em curso devem ser terminadas antes da atualização; os tokens temporários do motor são recriados ao abrir.

Na primeira instalação, os dados já existentes na pasta normal são reutilizados. Se o portable guardava os dados junto do executável, o instalador permite indicar essa pasta (a que contém `project.json`). A migração copia os conteúdos sem apagar a origem e nunca substitui dados de uma instalação já utilizada. Feche a versão portable antes de copiar o perfil do navegador.

O código de atualização usa uma identidade MSI fixa entre versões e recusa versões anteriores. Os pacotes assinados do canal de atualização podem agora ser `.msi`, mantendo essa extensão após descarregar. A instalação é iniciada pelo utilizador depois de fechar a aplicação.

O MSI foi gerado e o conteúdo pode ser verificado com `python scripts/verify-windows-installer.py release/GoStreams-0.16.0-Windows-Setup.msi --payload`. Os testes nativos adicionais usam `--native`; o serviço Windows Installer tem de estar disponível. O pacote não tem assinatura Authenticode.

## Abrir e atualizar

Abra `GoStreams/GoStreams.exe` no ZIP, mantendo a pasta completa. Na árvore de desenvolvimento: `release/GoStreams-0.15.5/GoStreams.exe`. Encerre a versão anterior pelo botão **Encerrar Go Streams** antes de abrir esta versão. Fechar só a janela deixa o motor ativo.

O pacote completo inclui Node.js, FFmpeg, FFprobe e yt-dlp. O utilizador final não precisa de instalar estas ferramentas, npm ou Python. Extraia a pasta completa e mantenha `runtime` e `vendor` junto da aplicação. Deixe os caminhos das ferramentas vazios nas Definições para usar as cópias incluídas; os caminhos personalizados continuam a ter prioridade. Windows utiliza Edge/Chrome e pode abrir no navegador predefinido. O launcher Windows usa o .NET Framework do Windows. Não inclui um navegador próprio.

Ao substituir uma instalação, preserve a pasta `data` e faça uma cópia antes da atualização. O iniciador de uma pasta `GoStreams-VERSÃO` sem dados reutiliza a pasta de dados de uma versão irmã existente, preferindo a mais recente. Não copia nem apaga os dados anteriores. Por predefinição, os agendamentos ficam desarmados ao reabrir. Em Definições pode autorizar a manutenção dos agendamentos já ativos entre sessões. Isto não ativa os pausados nem reinicia emissões interrompidas; o motor precisa de estar aberto.

## Funções

- Biblioteca em lista ou grelha, pesquisa, miniaturas, pré-visualização, renomeação e remoção das referências. Importação com conversão opcional de formatos incompatíveis para MP4/H.264/AAC. Originais preservados; Ferramentas normaliza resolução, áudio e fps para combinar formatos diferentes.
- Vídeo único ou playlist, limite simultâneo configurável (seis por predefinição; 0 remove o limite da aplicação), contagem de 0–120 segundos pela API (0/5/10/30 na interface), cancelamento antes do envio, pausa, retoma, reinício e paragem por canal.
- Repetição definida no canal, na playlist ou substituída para uma emissão. Repete o conteúdo numa ligação contínua. Não recria automaticamente eventos no painel da plataforma.
- Playlists ordenadas por arrasto ou setas, vídeos repetidos, qualidade 720p/1080p. A playlist guardada continua protegida enquanto está em uso. No monitor pode editar a fila da sessão, preservando o vídeo atual e os anteriores; aplica-se aos próximos vídeos e reabre a ligação na posição guardada. Os perfis Facebook/Restream não disponibilizam esta alteração de fila, de acordo com os avisos encontrados no original.
- Agendamentos de vídeo ou playlist, vários destinos, fuso IANA, edição e ativação por sessão ou manutenção da ativação explicitamente autorizada em Definições. Horas ambíguas exigem escolha; horários perdidos em mais de 60 segundos não disparam.
- Monitor separado, vídeo atual e progresso; histórico por sessão e por vídeo, incluindo posição e ciclo. Filtros de hoje/semana civil/mês civil, pesquisa, ordenação e exportação CSV. Retenção configurável de 500, 5.000 ou 50.000 eventos; 500 por predefinição. Falhas de agendamento têm classificação e filtro próprios e não aparecem como transmissões terminadas.
- Cópia direta H.264/AAC ou recodificação com bitrate, 25/30/60 fps e proporções 16:9, 4:3, 1:1, 21:9 e 9:16.
- Downloads individuais YouTube: progresso, cancelamento, miniatura, duração, duplicados, pré-visualização e importação opcional. Podem ficar separados em Ferramentas até escolher Adicionar à biblioteca. SMTP STARTTLS ou TLS direto (incluindo porta 465), com credenciais próprias, teste de envio e notificações de estado. Inclui falhas de agendamento anteriores à criação da transmissão e horários perdidos, evitando repetir o alerta já emitido por uma transmissão que falhou. A autenticação é efetuada apenas depois de validar o certificado TLS e o nome do servidor. O transporte usa Node em ambos os sistemas; não executa PowerShell para enviar emails.
- Ajuda integrada e indicações de preparação específicas por plataforma. Verifique limites e validade das chaves no painel da plataforma.
- Importação/exportação de projetos sem chaves, preservando referências e agendamentos de vídeo único. A importação acrescenta dados e deixa novos canais sem chave e agendamentos desarmados.

## Alterações da 0.11.1

- Texto base e menus com 16 px, botões e formulários maiores, títulos de secção mais visíveis e textos secundários com melhor contraste. Tabelas deixam de usar cabeçalhos pequenos em maiúsculas; os detalhes passam a uma escala de leitura maior.
- Menu lateral alargado para 260 px no modo expandido. O modo compacto mantém 76 px e permite percorrer todos os destinos. Mantém a ligação do autor e os idiomas.
- Botões principais com altura mínima de 44 px, controlos de formulário mais altos e espaçamentos adaptados. Painéis do dashboard passam a uma coluna em janelas médias; formulários e ações reorganizam-se nas pequenas.
- 15 regressões de geração dos ecrãs e localização aprovadas. O verificador de navegador inclui agora medidas mínimas de texto do menu e altura dos botões. A inspeção visual desta versão no navegador ainda está pendente; os resultados visuais da 0.10.2 não certificam esta alteração.

## Alterações da 0.11.0

- Inglês por predefinição no primeiro arranque, sem selecionar automaticamente o idioma do sistema. Seletor com English, Español, Français, हिन्दी, العربية, 中文, বাংলা, Русский, Bahasa Indonesia e Português. A escolha é guardada neste navegador e mantida ao reabrir.
- Catálogo inglês para os textos de interface; os outros idiomas traduzem a navegação, ações, estados e campos principais. Textos longos de ajuda, avisos e mensagens sem tradução específica usam inglês como alternativa. Diagnósticos de ferramentas e dados introduzidos pelo utilizador não são traduzidos automaticamente. Não se afirma que todos os textos estejam traduzidos em cada idioma.
- Árabe com direção da direita para a esquerda, menu do lado direito e campos técnicos de URLs, chaves e emails mantidos da esquerda para a direita. Formatos de data seguem o idioma escolhido; o fuso horário dos agendamentos não muda.
- A mudança de idioma recarrega apenas a interface e não interrompe o motor nem altera dados do projeto. Rascunhos por guardar e janelas abertas impedem a mudança para evitar perder alterações.
- Menu: “Criado por Antonio Fradique” e “Mais Produtos: AntonioFradique.net”, com ligação HTTPS que abre numa nova janela com proteção noopener/noreferrer. O menu compacto mantém a ligação AF e o texto completo acessível.
- 198 testes locais aprovados, incluindo idiomas, persistência, direção árabe, preservação de dados e geração dos onze ecrãs nos dez idiomas. O percurso de navegador acrescenta a seleção dos idiomas e a persistência; a execução desse percurso nesta versão continua pendente.

Os catálogos editáveis estão em `public/locales`; a compilação gera `public/i18n-data.js`. Não há tradução por serviços externos nem dependência de internet para mudar de idioma.

## Alterações da 0.10.2

193 testes locais aprovados, sem falhas, e compilação Windows concluída.

- Pedidos simultâneos de encerramento partilham a mesma conclusão e cada serviço recebe o pedido uma única vez. Uma falha síncrona ou assíncrona num serviço não impede o pedido de limpeza aos restantes. Falhas são devolvidas a todos os chamadores e registadas sem divulgar dados internos.
- O botão de saída apresenta encerramento em curso após o pedido, sem declarar que todas as operações já terminaram.
- O verificador opcional de interface guarda `.tmp/ui-check/result.json` com versão, resultado, verificações concluídas, erros e lista de capturas. Guarda cada um dos onze ecrãs a 1440, 800 e 390 px quando o percurso chega a essa fase. `GO_STREAMS_UI_OUTPUT` permite selecionar outra pasta de resultados. Uma falha de arranque não é marcada como aprovação.
- Foi exercitado um arranque de verificador deliberadamente falhado, com módulo de navegador controlado: resultado negativo, zero verificações visuais e nenhuma captura. Isto valida a apresentação de falhas, não o navegador.

A tentativa de navegador real nesta sessão terminou antes da interface, com erros de acesso negado e falha do Edge. A validação visual atual requer executar `scripts/verify-desktop.ps1` na sessão Windows normal. A equivalência integral continua por demonstrar, incluindo comparação visual, fornecedores externos, execução Mac e ensaio 24/7.

## Alterações da 0.10.1

Validação local: 191 testes aprovados, sem falhas, e compilação Windows concluída.

- Comparação direta com os estilos instalados do Livecaster 4.12 (`wwwroot/assets/css/custom.css`): cabeçalho principal rosa `#e10a51`, cabeçalhos de janela e botões principais `#e70952`, texto branco nos cabeçalhos e estado ativo do menu. Os valores foram implementados no código próprio, sem incorporar folhas de estilo ou imagens do fornecedor. Isto confirma referências de estilo, não igualdade visual em execução.
- Renomeação de playlists através de uma ação própria, sem alterar a sequência, abrir uma ligação nova ou interromper uma emissão. O monitor e o contexto ativo recebem o novo nome; referências dos agendamentos continuam ligadas à mesma playlist. A edição da sequência guardada permanece protegida durante a emissão.
- Renomeação durante a validação inicial mantém o nome coerente quando o contexto da emissão é criado. Nomes inválidos e playlists inexistentes são recusados sem alterar os dados.
- O script opcional de navegador verifica as cores calculadas do cabeçalho e da janela e o percurso de renomeação. Estas verificações novas ainda não foram executadas num navegador; as regressões de motor e API são distintas da validação visual.

Continua por demonstrar a equivalência integral, incluindo o desenho de todos os estados, fornecedores externos, execução Mac e ensaio prolongado 24/7.

## Alterações da 0.10.0

188 testes locais aprovados, sem falhas, e compilação Windows concluída. Inclui cancelamento de FFmpeg real; não envia dados para plataformas externas.

- Ferramentas apresenta as conversões em curso, título, tipo, hora de início e fase: análise, conversão, incorporação na biblioteca ou cancelamento. Não apresenta uma percentagem estimada.
- Cancelamento individual durante a análise ou conversão, incluindo conversões iniciadas pela importação. O original é preservado e o ficheiro incompleto é removido após terminar o processo. Quando a incorporação na biblioteca já começou, aguarda-se a sua conclusão para preservar referências válidas.
- O pedido de cancelamento usa a mesma sessão local e proteção de origem das outras alterações. Pedidos repetidos durante o cancelamento são idempotentes; operações terminadas são recusadas.
- Falhas ao criar a pasta de destino libertam a operação e deixam de poder bloquear o encerramento. Cancelamento, falha e conclusão libertam a reserva do vídeo.
- Regressões cobrem o cancelamento com FFmpeg real, resultados incompletos, falha da pasta, incorporação final e o percurso do botão até à API autenticada.

A igualdade visual integral com o original, os fornecedores externos, a execução Mac e o comportamento prolongado 24/7 continuam por validar. Esta função foi validada localmente; o percurso de navegador da nova secção ainda não foi executado nesta versão.

## Alterações da 0.9.2

Validação desta versão: 183 testes locais aprovados, sem falhas, e compilação Windows concluída.

- Erros definitivos de autenticação, certificado, codec, leitura de ficheiros e espaço em disco terminam com erro, sem esgotar tentativas de recuperação nem serem apresentados como perda de rede. Falhas temporárias de rede conservam a recuperação e a pausa configuradas. Erros sem classificação conservam as tentativas limitadas.
- Parar/pausar suporta falha do comando enviado ao FFmpeg: tenta terminar apenas o processo dessa sessão. A instalação do temporizador antes do comando evita deixar temporizadores antigos quando o processo fecha imediatamente.
- O monitor apresenta o detalhe escapado do erro e a ligação ao painel do produtor configurado. Os valores de fps e bitrate são limpos ao fechar o processo; o botão de paragem fica indisponível enquanto a sessão termina. As últimas sessões mostram a causa da falha.
- Novas regressões exercitam erros definitivos, falha temporária seguida de pausa, comando de paragem quebrado, fecho imediato, apresentação segura de erros e botão de paragem.

A comparação visual completa com o original, a execução num Mac, os destinos e fornecedores externos e o ensaio prolongado 24/7 continuam por validar. As verificações locais não demonstram equivalência integral.

## Alterações da 0.9.1

177 testes locais aprovados, sem falhas. Ensaio adicional aprovado: sete processos FFmpeg reais em repetição durante 300 segundos, mínimo de 301,179 segundos reproduzidos, com saída local descartada e sem ligação a plataformas. Não substitui a validação de 24/7. A comparação dos modelos e textos do Livecaster continua a ser parcial; estes resultados não demonstram equivalência integral.

- Uma playlist associada a um agendamento pendente não pode ser guardada vazia. Esvaziar uma playlist sem agendamentos elimina as preparações de canal que ficariam sem conteúdo.
- Respostas tardias da atualização automática respeitam o campo que entretanto recebeu foco e a página atual. A navegação estável não é reconstruída desnecessariamente e os botões do monitor conservam o foco de teclado.
- O editor de playlists preserva o vídeo selecionado ao acrescentar, ordenar ou retirar itens. Guardar uma fila pausada indica corretamente que não retoma a transmissão.
- A cópia direta desativa visualmente os controlos de recodificação, conservando os valores ao guardar e ao voltar à recodificação. Pesquisas sem resultados têm mensagens próprias; testes de playlists vazias e normalização sem vídeos ficam indisponíveis.
- Janelas de pré-visualização impedem a submissão nativa do formulário, evitando navegação acidental. O script opcional de interface inclui as novas regressões de codificação e playlist agendada; ainda não foi executado num navegador nesta versão.

## Alterações da 0.9.0

Validação local: 168 testes aprovados, sem falhas, e compilação Windows concluída. A estrutura do pacote Mac é verificada separadamente; a execução num Mac continua pendente.

- Transporte SMTP comum a Windows e Mac: STARTTLS e TLS direto, AUTH PLAIN/LOGIN apenas na ligação cifrada, certificados e nome do servidor verificados, mensagens UTF-8, cancelamento e prazo máximo. Os testes incluem dois handshakes TLS reais sobre fluxos em memória, sem portas de rede nem envio externo, e regressões de certificado inválido, credenciais recusadas, respostas fragmentadas e injeção.
- Menu lateral com botão para recolher/expandir, estado acessível e preferência local. Mantém todos os destinos e o comportamento compacto automático nos ecrãs pequenos. O controlo e a nova seleção de segurança SMTP estão incluídos no script de navegador.
- Pacote `GoStreams-Mac/GoStreams.app`, gerado a partir do mesmo código. Deteta Node 24+, usa seletor nativo de ficheiros e guarda dados em `~/Library/Application Support/Go Streams`. Reabrir a aplicação reutiliza a sessão existente. Downloads usam grupos de processos próprios no Mac, para cancelar também os subprocessos.
- Atualizações assinadas verificam a plataforma de destino; o editor pode gerar manifestos `win32` ou `darwin`. Não foi publicado um servidor de atualizações.

O pacote Mac ainda não foi executado num Mac, nem assinado/notarizado pela Apple. É uma entrega experimental com verificações de estrutura e testes dos caminhos específicos através de dependências controladas; não equivale a uma certificação de compatibilidade. As dependências não estão incorporadas. As capturas novas foram lidas por extração de texto, mas a transferência dos píxeis falhou; não foi demonstrada igualdade visual com o Livecaster.

## Alterações da 0.8.0

- Notificações e registos de agendamento para chave em falta, canal ocupado, capacidade esgotada e horário ultrapassado. As falhas posteriores à criação da transmissão conservam os alertas por canal, sem acrescentar um email duplicado do agendamento.
- Definições de capacidade e retenção, com gravação atómica e preservação dos rascunhos dos outros formulários. Reduzir a capacidade não para as emissões existentes; canais pausados, contagens e testes ocupam lugares. Sem limite de aplicação não significa capacidade física ilimitada.
- Persistência opcional dos agendamentos já autorizados. Importações continuam desarmadas e não importam esta autorização. Sessões interrompidas não são reiniciadas.
- Perfil TikTok com introdução manual de servidor/chave e orientação no formulário; não há login OAuth nem validação de uma conta TikTok real.

## Recuperação e segurança

Pausar fecha a ligação RTMP; retomar reabre a partir da posição indicada pelo codificador. Esta posição não confirma o último fotograma recebido pelo público. A plataforma pode terminar o evento durante a interrupção.

**Recuperar ligação** tenta novamente após 3, 10 e 30 segundos. **Pausar se a ligação cair** reserva o canal e guarda a posição quando é detetada uma falha de ligação; com ambas ativas, pausa depois das tentativas. Erros de autenticação, formato ou descodificação não são tratados como prova de perda de internet. Parar cancela contagens e tentativas pendentes. Continuar após falha de vídeo pode abrir uma nova ligação com os vídeos restantes.

Servidor apenas em `127.0.0.1`, sessão aleatória, validação Host/Origin/CSRF e CSP. Chaves AES-GCM com proteção Windows DPAPI. Preserve `vault.dpapi` juntamente com os dados; pertence à mesma conta Windows. No Mac, preserve `vault.key`, gravado com permissões 0600: é uma chave local privada, não uma integração com o Porta-chaves do macOS. O destino completo está nos argumentos do FFmpeg durante a emissão, acessível à mesma conta. A remoção de entradas da biblioteca não apaga os vídeos originais.

## Atualizações assinadas

Em Definições pode configurar um manifesto HTTPS, a chave pública Ed25519 do editor e verificações ao abrir/a cada 24 horas. A assinatura, produto, plataforma, versão, tamanho e SHA-256 são verificados antes de aceitar o pacote. O download é explícito; a instalação é feita com a aplicação encerrada, preservando `data`.

O projeto ainda não tem um canal de distribuição publicado/configurado. Não há instalação automática de novas versões. O script `scripts/sign-release.mjs` prepara manifestos com uma chave privada própria do editor, mantida fora da árvore distribuída. Não são criadas nem incluídas chaves privadas no pacote.

## Desenvolvimento e validação

`npm run check`, `npm test`, `npm run build`. O pacote inclui o código-fonte e os testes. Os testes usam FFmpeg/FFprobe reais para leitura, codificação, cópia, conversão e pausa/retoma local. SMTP inclui TLS real sobre fluxos em memória; downloads e atualizações usam serviços controlados, sem acesso a fornecedores externos.

A geração dos onze ecrãs, estados vazios/preenchidos, contagem e filtros é testada sem navegador. O script opcional `scripts/ui-check.mjs` usa Playwright e Edge para os fluxos visuais; requer `GO_STREAMS_PLAYWRIGHT_PACKAGE` apontando para um package.json de uma instalação com Playwright.

Em 24/10/2026, a base 0.7.0 passou 128 testes locais e, na sessão Windows normal do utilizador, dois testes de transporte HTTP/RTMP e 48 verificações de interface sem erros de JavaScript. As capturas do dashboard foram inspecionadas a 1440, 800 e 390 px. A 0.8.0 passou 140 testes locais, sem falhas. Acrescenta regressões de alertas, limites, persistência, histórico e formulário; o script opcional do navegador passa a incluir a gravação das novas opções. O resultado anterior de 48 verificações não valida automaticamente esse novo percurso.

Na 0.8.0 foi concluído um ensaio de 60 segundos com sete processos FFmpeg reais em repetição, usando cópia direta e saída local descartada. Não envia RTMP nem substitui um ensaio de 24–72 horas ou a validação com uma plataforma. `node scripts/soak-check.mjs --seconds 86400 --streams 7` permite executar o ensaio prolongado no computador; o resultado fica em `.tmp/soak-result.json`. Não é iniciado automaticamente. Downloads reais do YouTube, emails para fornecedores externos, destinos de transmissão externos, comparação visual integral com o original e execução do pacote macOS continuam por validar.

## Comparação funcional — 24/10/2026

A versão 0.7.0 corrigiu concorrência entre agendamentos, importações, reinícios, encerramento e alterações de fila. Desativar ou adiar um agendamento enquanto outro inicia passa a ser respeitado. Parar cancela um reinício pendente. A conversão para MP4 mantém resolução e fps e faz remultiplexagem quando os codecs já são compatíveis; Normalizar continua a criar a cópia uniforme a 720p/30 fps. É possível retirar explicitamente um vídeo de todas as playlists inativas e mostrar/ocultar uma chave ou palavra-passe que esteja a ser introduzida, sem revelar segredos guardados.

O REA confirmou os métodos `GetGoLiveDetailsByChannelId`, `UpdateAutoRestartOnEnd`, `UpdateEndOnVideoFailure` e `ReplaceVideosForChannelAndStream` no modelo instalado. A cobertura reportada é parcial. Os textos de menus, tabelas e avisos foram comparados com `C:/Livecaster/Languages/en.json`. As dez capturas fornecidas confirmaram, através do texto extraído, os campos de canal, tabelas, pesquisas, paginação e opções de codificação. Não foi possível inspecionar os pixels; isto não constitui comparação visual. Isto não demonstra que todas as funções internas ou comportamentos foram reproduzidos.

| Área | Estado da comparação |
| --- | --- |
| Vídeos, canais, coleções, emissão direta, agendamentos e registos | Implementados; testes locais e API |
| Preparação por canal e políticas durante a emissão | Implementadas; persistência e controlo testados |
| Atualização de fila e repetição | Implementadas com reabertura de ligação; continuidade idêntica ao original não demonstrada |
| Botões, formulários, pesquisas, paginação e ligações | Percursos principais testados com ações reais e API; 48 verificações de navegador aprovadas na 0.7.0; novo formulário da 0.8.0 testado por callbacks/API, navegador por repetir |
| YouTube, SMTP e destinos RTMP externos | Implementados; integração externa real por validar |
| Design e fluxo completo na janela original | Dashboard Go Streams inspecionado em três larguras; igualdade visual com o original não demonstrada |
| Atualizações | Verificação e download assinados, separados por plataforma; distribuição não configurada e instalação manual |
| macOS | Pacote experimental gerado; arranque, seletor, SMTP e cancelamento adaptados; execução num Mac por validar |
| Conta, licença, loja, suporte e serviços privados do fornecedor | Não replicados na aplicação independente |

A edição da fila valida novamente os ficheiros e não permite remover ou deslocar o vídeo atual. Se a reprodução avançar durante essa validação e tornar a mudança incompatível, a sessão fica pausada e preserva a fila anterior. Parar ou encerrar cancela a alteração. O tempo total permanece cumulativo após alterações e falhas de descodificação.

## Verificação na sessão Windows normal

`scripts/verify-desktop.ps1` executa os testes opcionais HTTP/RTMP local e interface, regista os resultados em `.tmp/desktop-verification-DATA.txt` e devolve erro se algum teste falhar. Não transmite para plataformas externas. O teste de interface requer Playwright instalado e pode usar `GO_STREAMS_PLAYWRIGHT_PACKAGE`; o script deteta a instalação local do runtime quando disponível. Mantenha as proteções do navegador ativas.

Comandos separados: `npm test` (testes locais sem sockets), `npm run test:wire` (HTTP e emissão RTMP local) e `npm run test:ui` (navegador e capturas). O sucesso de uma bateria não substitui as restantes. A equivalência integral depende ainda de comparar o comportamento e o desenho do original em execução, além das integrações externas e dos serviços privados não reproduzidos.


### 0.12.0 — Vídeos por ligação

Na Biblioteca de vídeos, **Adicionar por ligação** aceita vídeos individuais do YouTube ou URLs HTTPS diretos para ficheiros MP4 públicos. Guarda o endereço e metadados; não descarrega uma cópia completa nem cria miniaturas. A reprodução usa memória temporária e tráfego de Internet. O teste local continua a guardar um excerto de até 8 segundos.

As fontes podem ser usadas nos canais, playlists e agendamentos existentes. Playlists precisam de fontes com formatos compatíveis, tal como os ficheiros locais. Pausa/retoma, repetição e recuperação usam o mesmo motor. Conversão e normalização continuam exclusivas de ficheiros locais. O export/import preserva os endereços e volta a validar as fontes; não exporta as ligações temporárias resolvidas do YouTube.

YouTube requer yt-dlp e um formato MP4 com áudio e vídeo juntos. A qualidade depende desse formato. O endereço temporário é renovado periodicamente e após uma recusa 401/403. Diretos sem duração, HLS, autenticação/cookies e vídeos sem formato combinado não são suportados nesta opção. Não há garantia de acesso contínuo a todas as fontes do YouTube.

O acesso remoto valida HTTPS e cada redirecionamento, recusa endereços privados/reservados e fixa a resolução DNS por ligação. O FFmpeg recebe apenas endereços locais temporários, limitados ao formato MP4. As ligações temporárias e mensagens contendo URLs não entram no histórico. Não são permitidas fontes IPv6 nesta versão.

Validação: testes automatizados de API/interface, persistência, proteção de rede, renovação de ligações, filas, pausa/retoma, recuperação e encerramento. O teste opcional `verify-desktop.ps1` inclui agora um terceiro cenário: dois vídeos remotos simulados lidos pelo FFmpeg real, sem transmissão externa. A execução neste ambiente foi bloqueada por `connect EACCES` no teste de ligação local; falta executar esse cenário no Windows normal e validar um vídeo real do YouTube. Não foi feita validação visual no navegador nesta versão.


### 0.12.1 — Verificação e correções de fontes remotas

A seleção YouTube agora exige MP4 progressivo por HTTPS, evitando escolher uma playlist HLS identificada pelo yt-dlp como extensão MP4. Preserva User-Agent e outros cabeçalhos de leitura permitidos, sem transportar cookies, autenticação ou Host fornecidos pela origem. A resolução DNS passa a ter limite de tempo e cancelamento, para não prender operações no encerramento. Nomes de ficheiro com escapes incompletos deixam de impedir uma importação válida.

Verificação local: testes completos e compilação. O navegador terminou antes dos testes, com erros de permissões/crashpad. Os três testes opcionais de transporte foram bloqueados na preparação por `connect EACCES` em localhost. A reprodução real de vídeos remotos, incluindo YouTube, continua por validar no Windows normal; não houve transmissões externas.


### 0.13.0 — Cópias completas de projetos e definições

Em **Definições → Cópia de segurança completa**, pode exportar **Projeto e definições**, **Apenas projeto** ou **Apenas definições**. O ficheiro JSON é cifrado com AES-256-GCM e uma chave derivada da palavra-passe por scrypt. A palavra-passe tem de ter pelo menos 10 caracteres e não é guardada; sem ela não se recupera o backup. As chaves de transmissão e palavras-passe SMTP são incluídas dentro da parte cifrada e novamente protegidas pelo cofre do computador de destino ao restaurar.

O restauro substitui as categorias selecionadas, preservando identificadores, nomes, ordem e repetições nas playlists, canais e ligações, preparações, horários e estado dos agendamentos, histórico e registos de downloads. As definições incluem ferramentas, codificação, limites, notificações, atualizações, idioma, disposição da biblioteca e menu compacto. Exportar e restaurar novamente não duplica conteúdos. A importação anterior sem chaves continua disponível como alternativa para acrescentar projetos.

O restauro exige que as operações estejam paradas e uma confirmação explícita na interface, pois repõe também os automatismos guardados. Não retoma processos ou transmissões interrompidas. Downloads ou agendamentos capturados durante o arranque ficam marcados como interrompidos. Ficheiros de vídeo, ferramentas e miniaturas não são incorporados: precisam de continuar acessíveis nos caminhos guardados, ou de ser novamente disponibilizados no computador de destino. O limite é 16 MB de dados antes da cifra.

Os testes verificam o ciclo completo exportar/restaurar/exportar entre cofres diferentes, igualdade do conteúdo lógico, ausência de duplicados, reposição das chaves, preferências e configurações, importações parciais e preservação dos dados perante palavra-passe errada, adulteração, referências inválidas ou operações em curso. As limitações de validação real de navegador, rede e YouTube indicadas acima mantêm-se.


### 0.13.1 — Fotografia no menu

Fotografia de Antonio Fradique incorporada no pacote, entre o nome do autor e a ligação Mais Produtos. Apresentação completa no menu expandido e avatar compacto no menu recolhido. Não depende de uma ligação externa para carregar.

### 0.13.2 — Importação de várias ligações

Na Biblioteca, abra **Importar vídeos → Adicionar por ligação**. Cole até 100 ligações de vídeos, uma por linha. As entradas repetidas são ignoradas e os vídeos são analisados sequencialmente. Se alguma ligação falhar, as restantes são mantidas e o formulário conserva apenas as que precisam de correção. O título opcional aplica-se apenas à importação de uma única ligação. As limitações das fontes online indicadas acima mantêm-se.

### 0.13.3 — yt-dlp portátil

O yt-dlp é resolvido dentro da pasta da aplicação, sem depender do PATH ou de uma instalação global. Downloads, fontes YouTube e diagnóstico usam a mesma escolha. Um caminho definido pelo utilizador mantém prioridade. Mover a aplicação não grava caminhos absolutos para a ferramenta no projeto.

Para preparar esta versão a partir do código, execute `node scripts/prepare-portable.mjs` com Internet. O comando descarrega a versão oficial 2026.10.21 para Windows x64 e macOS universal, verifica os tamanhos e SHA-256 publicados no lançamento, verifica as licenças pelo identificador Git fixado e inclui o arquivo oficial do código-fonte. Depois testa localmente a versão do executável, compila e, no Windows, cria o ZIP na pasta `release` usando Python. Os executáveis oficiais incluem os componentes EJS; o processo usa o Node da aplicação para os desafios JavaScript, sem instalar componentes remotos em execução.

A compilação recusa ficheiros ausentes ou alterados. Ficheiros já verificados são reutilizados sem novo download; uma falha não substitui ficheiros existentes nem altera os dados da aplicação. As licenças de terceiros e o código-fonte do yt-dlp acompanham cada pacote em `vendor/yt-dlp`; a origem e os identificadores estão no manifesto. O yt-dlp é um processo independente, sem modificações.

Estado desta entrega de código: integração testada; o download dos executáveis foi bloqueado por falha de DNS no ambiente de desenvolvimento. Execute o comando de preparação acima para obter o pacote com yt-dlp realmente incluído. Não foi validado um acesso real ao YouTube nem a execução do binário macOS.

### 0.14.0 — Ferramentas incluídas

Windows x64: Node.js 24.14.1 (executável OpenJS com assinatura válida), FFmpeg/FFprobe 9.0.2 da instalação WinGet Gyan e yt-dlp 2026.10.21, copiados sem modificações. Os binários, licenças e indicação das origens acompanham o pacote. O iniciador usa exclusivamente o Node incluído. A análise, conversão, transmissão, diagnóstico e downloads procuram as ferramentas junto da aplicação, incluindo depois de mover a pasta.

Preparação: `node scripts/prepare-portable.mjs` cria o pacote do sistema atual. Para preparar Mac num Windows: `node scripts/prepare-portable.mjs --platform=darwin`. Para ambos: `--platform=all`. A preparação Mac inclui versões próprias de Node, FFmpeg e FFprobe para Intel e Apple Silicon; yt-dlp é universal. Os ficheiros são verificados antes de compilar e as permissões de execução são guardadas no ZIP. Python só é usado para construir/extrair os pacotes, nunca pela aplicação final.

A compilação Mac precisa de descarregar as dependências e a execução num Mac continua por validar. O Windows deve ser encerrado pelo botão Encerrar antes de abrir uma nova versão; preserve os dados existentes.

### 0.14.1 — Verificação dos pacotes autónomos

O pacote Mac exige macOS 13.5 ou posterior, conforme o Node incluído. A construção lê as arquiteturas, versões mínimas e bibliotecas dos executáveis Mac e rejeita dependências externas como Homebrew. Inclui Intel e Apple Silicon; a execução nativa continua por validar num Mac.

No Windows, a proteção DPAPI, o seletor de ficheiros e o cancelamento de processos usam as ferramentas do sistema por caminho absoluto. Um yt-dlp ausente num pacote completo produz uma indicação de reparação, sem recorrer silenciosamente a outra instalação. As Definições e Ferramentas explicam os componentes incluídos nos dez idiomas.

### 0.14.2 — Recuperação de downloads e texto internacional

Falhas ao localizar as ferramentas incluídas terminam o download e libertam o lugar, sem bloquear o encerramento. Títulos com acentos, emoji e caracteres asiáticos mantêm-se intactos entre blocos de saída; a última linha é lida mesmo sem mudança de linha. O limite de saída das ferramentas conta bytes UTF-8. Uma operação que excedeu o prazo continua a ser uma falha mesmo que o processo termine com código zero.

Downloads falhados, cancelados ou interrompidos têm o botão Tentar novamente. A nova tentativa mantém a preferência de importação e o histórico anterior, com proteção contra duplicados em curso. A ajuda esclarece que o yt-dlp está incluído; a importação apresenta exemplos de caminhos adequados a Windows e Mac.

O encerramento aguarda também a validação de importações de projeto e impede gravações tardias. Caminhos personalizados que deixaram de existir continuam visíveis para correção, sem bloquear a gravação de outras definições. Leitores simultâneos reutilizam uma ligação YouTube já renovada quando uma rejeição antiga chega atrasada, evitando resoluções adicionais desnecessárias.


### 0.14.3 — Dados portable e bibliotecas maiores

Os vídeos descarregados, convertidos e normalizados dentro da pasta de dados recebem referências relativas. Depois de abrir esta versão na localização atual, pode encerrar a aplicação e mover a pasta de dados completa: as referências internas são recuperadas ao reabrir. Se copiar a pasta, a nova instância usa os vídeos da nova cópia, mesmo que a anterior ainda exista. Vídeos locais externos e ligações remotas conservam as localizações originais; não são criadas cópias adicionais. A cópia de segurança continua a excluir os ficheiros de vídeo, mas recupera as referências internas quando esses ficheiros já foram transferidos para a nova pasta de dados. As chaves Windows continuam vinculadas à conta DPAPI; para outro computador/conta, utilize o restauro da cópia de segurança cifrada.

Importações deixam de confundir vídeos distintos cujos nomes diferem apenas em maiúsculas num volume sensível a maiúsculas/minúsculas. Bibliotecas com mais de 1.000 vídeos e históricos com mais de 5.000 downloads podem ser restaurados; mantém-se o limite de 16 MB de dados da cópia, a validação dos identificadores e a integridade criptográfica.

O verificador portable testa também a conversão, a mudança efetiva da pasta de dados, a leitura do vídeo após a mudança e a preservação do original, usando as ferramentas incluídas e PATH vazio.


### 0.14.4 — Encerramento e respostas tardias

Pedidos cujo corpo JSON termina de chegar depois do início do encerramento são recusados antes de alterar o projeto. Isto protege definições, canais, playlists e as restantes ações da API contra gravações tardias.

A verificação e o download de atualizações voltam a confirmar o cancelamento após receber a resposta, durante a leitura e antes da validação/gravação final. Uma resposta tardia não fica marcada como atualização disponível ou pacote concluído. Ficheiros parciais são removidos e os pacotes anteriormente verificados são preservados. Os testes usam transportes controlados e não contactam servidores externos.


### 0.14.5 — Validação de emissões e filas durante o encerramento

O encerramento aguarda as verificações de vídeo que já estavam em curso para iniciar emissões ou alterar filas. Parar uma emissão durante a preparação impede a verificação dos vídeos seguintes e não inicia processos de transmissão. A alteração de fila volta a confirmar o estado da sessão após cada vídeo verificado.

O restauro de cópias de segurança recusa substituir o projeto enquanto estas verificações estão em curso, mesmo que a emissão correspondente já tenha sido parada. A proteção é confirmada antes e depois de decifrar a cópia. Os testes não transmitem para plataformas externas.


### 0.14.6 — Preferências do navegador e textos da interface

A interface abre mesmo quando o navegador bloqueia o armazenamento local de preferências. Lista e grelha continuam disponíveis nessa situação; a aplicação informa que a escolha é válida apenas para a sessão atual. Valores de apresentação antigos ou inválidos regressam à vista em lista. Isto não altera os vídeos, as definições do motor ou os dados guardados pela aplicação.

Os contadores de canais/agendamentos, o estado de agendamento iniciado e a pesquisa do histórico passam pelo catálogo de idiomas, com traduções nos nove idiomas adicionais. O verificador de navegador acrescenta três verificações para abrir a interface e alternar as vistas com armazenamento bloqueado (74 verificações previstas). A execução nativa deste percurso novo ainda precisa de ser validada.


### 0.14.7 — Duplicados após limpar o histórico de downloads

Vídeos YouTube importados na biblioteca conservam a ligação de origem, tanto na importação automática como manual. Retirar o registo de Ferramentas não apaga o vídeo nem permite descarregá-lo novamente enquanto esse ficheiro continuar disponível na biblioteca. Registos antigos ainda presentes são associados aos vídeos correspondentes ao abrir a aplicação, sem cópias adicionais.

A cópia de segurança completa preserva essa associação, incluindo após transferir os ficheiros internos para outra pasta de dados. Se o vídeo deixou de existir, a referência antiga não bloqueia um novo download. Históricos já apagados antes desta versão não permitem reconstruir a origem de vídeos antigos sem essa informação.

Uma falha imediata ao iniciar as ferramentas devolve também o estado de erro correto na resposta da API, em vez de indicar um download em curso que já terminou.


### 0.14.8 — Encerramento da interface e ligações HTTP

Depois de confirmado o encerramento, respostas tardias da atualização automática não voltam a mostrar o dashboard nem um aviso de perda de ligação. Cliques repetidos partilham um único pedido de encerramento; se o pedido falhar, o botão volta a ficar disponível para tentar novamente.

Após terminar os serviços e os processos de vídeo, o servidor fecha também as ligações HTTP ainda ativas, incluindo pedidos com corpo incompleto. Isto evita que uma ligação bloqueada mantenha o motor aberto indefinidamente. O verificador nativo acrescenta um quarto teste de transporte para esse caso; a execução deste teste em socket real fica pendente da sessão Windows normal.


### 0.15.0 — Dois banners rolantes e imagem na emissão

Em **Entrar em direto → Banners e imagem** ou **Definições → Configurar sobreposições**, prepare os elementos antes de iniciar: dois banners independentes, no topo e em baixo, com texto e emojis, cores, tamanho, velocidade, direção e opacidade do fundo. Pode acrescentar uma imagem PNG, JPG, GIF animado ou WebP (até 2 MB e 4096 × 4096), com largura, posição horizontal/vertical e opacidade. A pré-visualização no editor é aproximada; utilize o teste local para verificar o resultado do motor.

Guardar aplica as opções às próximas emissões e testes locais em todos os canais. As sessões em curso mantêm as opções com que começaram, incluindo após pausa e retoma. O motor inclui as sobreposições na saída enviada à plataforma, sem editar nem duplicar os vídeos originais. Isto ativa a recodificação mesmo que a cópia direta esteja selecionada e aumenta o trabalho do processador. As imagens estáticas são lidas a um fotograma por segundo; os banners mantêm o movimento à taxa de fotogramas da emissão. Os GIFs conservam a animação em repetição.

Os banners são desenhados uma vez pelo navegador, incluindo os emojis disponíveis no sistema, e guardados como pequenas imagens transparentes. A aplicação utiliza o FFmpeg incorporado; não requer instalar componentes adicionais. As imagens ficam na pasta de dados e são incluídas na cópia de segurança cifrada das definições ou de tudo. Os ficheiros de vídeo continuam excluídos dessa cópia. Para desativar, desmarque Ativar nos três elementos e guarde antes da próxima emissão.

A privacidade do evento YouTube continua a ser escolhida no painel do YouTube Studio. Não foi acrescentada uma integração OAuth nem um seletor que apenas alterasse uma preferência local sem efeito na plataforma.

O verificador de navegador passa a prever 79 verificações, incluindo edição, pré-visualização, imagens, persistência e desativação das sobreposições. Este percurso novo requer validação na sessão Windows normal. A execução nativa Mac permanece pendente.


### 0.15.1 — Recuperação de imagens e preparação do canal

É possível desativar sobreposições mesmo quando a imagem guardada desapareceu, ficou danificada ou o caminho personalizado do FFprobe deixou de funcionar. Referências desativadas a imagens ausentes/danificadas são limpas. Uma imagem ativa inválida continua a impedir o início com essa configuração, em vez de desaparecer silenciosamente da emissão.

Novas imagens são verificadas numa pasta temporária antes de serem guardadas. Falhas de validação ou cancelamento limpam os ficheiros temporários e preservam as definições anteriores; a validação para ao detetar o encerramento. Selecionar novamente a imagem original repara uma cópia guardada danificada, mantendo a mesma referência de conteúdo.

Na preparação de um canal, a indicação de que Guardar não inicia a emissão passa a texto informativo. A confirmação obrigatória mantém-se no início de transmissões e nos agendamentos. O verificador de navegador passa a prever 80 verificações; o novo percurso precisa de execução na sessão Windows normal.


### 0.15.2 - Restauro e integridade das sobreposições

O restauro verifica as imagens com o FFprobe incluído antes de substituir o projeto, mesmo que a cópia contenha caminhos personalizados de ferramentas que já não existem. Imagens inválidas ou demasiado grandes são recusadas sem guardar os ficheiros nem alterar as definições. Cópias válidas reparam imagens guardadas danificadas.

Durante a validação do restauro, a interface pode consultar o estado, mas as alterações e os disparos de novos agendamentos aguardam a conclusão. Encerrar cancela a validação e limpa a pasta temporária. A exportação também verifica a integridade dos ficheiros guardados para não produzir uma cópia com imagens já danificadas.


### 0.15.3 - Arranque e janela Windows

O iniciador Windows espera pela resposta autenticada do motor antes de abrir a interface, usa um perfil de navegador exclusivo e volta à mesma janela nas aberturas seguintes. Encerrar Go Streams fecha também a janela criada pelo iniciador, sem terminar o navegador pessoal. O ficheiro CloseGoStreams.cmd permite pedir o encerramento desta sessão, com confirmação, mesmo quando a interface não responde. O perfil desktop-browser e desktop-startup.log ficam na pasta de dados. Não são exportados nos pacotes. A página de arranque inclui uma mensagem visível e uma opção para tentar novamente se os módulos não carregarem.


### 0.15.4 - Janela adicional do Edge no arranque

O arranque Windows seleciona explicitamente o perfil Default do navegador exclusivo do Go Streams, inicializa o marcador First Run sem reescrever preferências e suprime a recuperação de separadores e o início de sessão implícito nesse processo. As opções são iguais no iniciador nativo e no arranque por Node. Não são alteradas políticas ou preferências do Edge pessoal. A abertura visual num Windows normal continua a exigir validação fora do ambiente de execução restrito.


### 0.15.5 - Windows num ficheiro único

O ficheiro GoStreams-0.15.5-SingleFile.exe inclui a aplicação e todos os componentes do portable Windows. Na primeira abertura extrai e verifica os recursos em %LOCALAPPDATA%/Go Streams/Cache; nas seguintes reutiliza a cópia verificada. Não faz downloads nem instala serviços. O Edge/Chrome do sistema continua a apresentar a interface.

As definições ficam em %LOCALAPPDATA%/Go Streams/data. Se o EXE estiver junto a um portable anterior com data/project.json ou GoStreams/data/project.json, reutiliza esses dados. Uma pasta GoStreams-data ao lado do EXE permite escolher dados portáteis; GO_STREAMS_DATA tem prioridade. Os vídeos locais continuam referenciados no local original. A cópia do EXE para outro computador não transporta os dados locais nem as chaves DPAPI; use exportação/importação encriptada e leve os vídeos necessários.

Para reconstruir: node scripts/build.mjs --platform=win32, seguido de node scripts/build-single-file.mjs. O modo --verify verifica/extrai sem abrir a interface nem iniciar o motor; GO_STREAMS_CACHE pode apontar para uma pasta de teste. --close pede o encerramento com confirmação. O arranque visual fora do ambiente restrito continua pendente.


## Mac 0.15.5: uma aplicacao clicavel

Mac-Portable/GoStreams.app inclui o iniciador universal Intel/Apple Silicon, Node.js, FFmpeg, FFprobe, yt-dlp e o icone escolhido. Usa o browser disponivel no Mac (incluindo o browser predefinido do sistema); nao necessita de instalar runtimes. Requer macOS 13.5 ou posterior. As definicoes permanecem em ~/Library/Application Support/Go Streams, fora do pacote da aplicacao.

Para preparar: node scripts/build.mjs --platform=darwin; depois python scripts/package-mac-portable.py --destination release/GoStreams-0.15.5-Mac-Portable/Mac-Portable. O ZIP contem a pasta Mac-Portable com os modos Unix e ficheiros verificados, sem projetos pessoais. Extraia no Mac com Finder ou ditto; num construtor Windows, a exportacao tem de preservar/restaurar os modos do manifesto. O pacote completo e uma unica app no Finder; nao e um binario isolado que permita remover os recursos internos. A execucao real num Mac continua por testar, sem assinatura Developer ID ou notarizacao.
