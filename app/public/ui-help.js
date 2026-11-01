import {language} from './i18n.js';

export const uiText=(en,pt)=>language()==='pt-PT'?pt:en;
const say=pair=>pair?uiText(...pair):'';
const actions={
 'go-live':['Choose a prepared video or playlist and its destinations. Nothing is broadcast until you confirm.','Escolha um vídeo ou playlist e os destinos. Nada é transmitido antes da sua confirmação.'],
 'single-live':['Prepare this video for one or more channels, then confirm the broadcast.','Prepare este vídeo para um ou vários canais e confirme a transmissão.'],
 'playlist-live':['Prepare this playlist for one or more channels.','Prepare esta playlist para um ou vários canais.'],
 'plan-channel':['Choose and save the content for this channel without starting a broadcast.','Escolha e guarde o conteúdo deste canal sem iniciar a transmissão.'],
 'plan-start':['Start the saved channel plan after confirmation and any configured countdown.','Inicie a preparação guardada do canal após confirmar e aguardar a contagem definida.'],
 'plan-schedule':['Choose a future time for this channel to start its prepared content.','Escolha quando este canal deve transmitir o conteúdo preparado.'],
 'channel-new':['Add the platform server and stream key. Adding a channel does not start streaming.','Adicione o servidor e a chave da plataforma. Adicionar um canal não inicia uma transmissão.'],
 'channel-edit':['Change this channel’s name, platform links, server or stream key.','Altere o nome, as ligações, o servidor ou a chave deste canal.'],
 'import':['Add existing videos from your computer or use the video-link option.','Adicione vídeos do computador ou use a opção de ligações de vídeo.'],
 'import-link':['Add video links to the library without downloading source copies.','Adicione ligações à biblioteca sem descarregar cópias dos vídeos.'],
 'playlist-new':['Create an ordered sequence of videos. It can repeat and run on several destinations.','Crie uma sequência ordenada de vídeos, com repetição e vários destinos.'],
 'playlist-edit':['Change the videos, their order and the playlist playback options.','Altere os vídeos, a ordem e as opções de reprodução da playlist.'],
 'playlist-rename':['Change the playlist name without changing its videos.','Altere o nome da playlist sem alterar os vídeos.'],
 'schedule-new':['Choose the content, destinations, date and time. Check the time zone and activation.','Escolha o conteúdo, os destinos, a data e a hora. Confirme o fuso horário e a ativação.'],
 'schedule-edit':['Change a future schedule. Check its destinations and time zone before saving.','Altere um agendamento futuro. Confirme os destinos e o fuso horário antes de guardar.'],
 'arm':['Activate or pause this schedule. The computer and application must be running at its start time.','Ative ou pause o agendamento. O computador e a aplicação têm de estar ligados à hora prevista.'],
 'stop-job':['Stop this transmission and release its channel. Other destinations continue.','Pare esta transmissão e liberte o canal. Os outros destinos continuam.'],
 'stop-all':['Stop the transmissions shown in the monitor. Review the confirmation before proceeding.','Pare as transmissões do monitor. Reveja a confirmação antes de continuar.'],
 'pause-job':['Pause this prepared-video transmission while retaining its playback position.','Pause esta emissão de vídeos preparados, mantendo a posição de reprodução.'],
 'resume-job':['Resume the paused transmission from its retained position.','Retome a transmissão pausada a partir da posição guardada.'],
 'restart-job':['Restart this prepared-video transmission from the beginning.','Reinicie esta transmissão de vídeos preparados desde o início.'],
 'job-settings':['Adjust the running transmission’s repeat and recovery options.','Altere as opções de repetição e recuperação da transmissão em curso.'],
 'job-queue':['Review the next videos while preserving the current and already-played part of the queue.','Reveja os próximos vídeos, preservando o vídeo atual e a parte já reproduzida.'],
 'test-media':['Test this video locally without publishing it to a platform.','Teste este vídeo localmente, sem o publicar numa plataforma.'],
 'preview-media':['Open a local preview of this video. It does not start a public broadcast.','Abra uma pré-visualização local deste vídeo. Não inicia uma transmissão pública.'],
 'preview-playlist':['Test this playlist locally before broadcasting. Add videos first if the playlist is empty.','Teste a playlist localmente antes de transmitir. Adicione vídeos se estiver vazia.'],
 'tool-preview':['Create a short local playback test using the selected profile.','Crie um teste local curto com o perfil selecionado.'],
 'view-preview':['Watch the result of the completed local playback test.','Veja o resultado do teste local concluído.'],
 'normalize':['Create compatible video copies for playlist playback. Review the selected sources first.','Crie cópias compatíveis para reprodução em playlist. Reveja primeiro os vídeos selecionados.'],
 'cancel-conversion':['Cancel the conversion in progress.','Cancele a conversão em curso.'],
 'overlays':['Set up your moving banners and image before the next transmission.','Configure os seus banners em movimento e a imagem antes da próxima transmissão.'],
 'download-new':['Download a video to this computer and optionally add it to the library.','Descarregue um vídeo para o computador e, se quiser, adicione-o à biblioteca.'],
 'cancel-download':['Cancel this download.','Cancele este download.'],
 'retry-download':['Try this failed or cancelled download again.','Tente novamente este download falhado ou cancelado.'],
 'download-import':['Add this downloaded video to the library.','Adicione este vídeo descarregado à biblioteca.'],
 'preview-download':['Watch the downloaded video locally.','Veja localmente o vídeo descarregado.'],
 'remove-download':['Remove this download entry. Review the confirmation before proceeding.','Remova este registo de download. Reveja a confirmação antes de continuar.'],
 'delete-media':['Review the options for removing this video and any managed copy.','Reveja as opções de remoção deste vídeo e da eventual cópia gerida.'],
 'delete-channel':['Review the confirmation before removing this destination. Stop operations using it first.','Reveja a confirmação antes de remover este destino. Pare primeiro as operações que o utilizam.'],
 'delete-playlist':['Review the confirmation before deleting this playlist. Its source videos stay in the library.','Reveja a confirmação antes de eliminar esta playlist. Os vídeos de origem ficam na biblioteca.'],
 'delete-schedule':['Remove this future schedule after confirmation.','Remova este agendamento futuro após confirmar.'],
 'rename-media':['Change the video’s library title.','Altere o título do vídeo na biblioteca.'],
 'media-grid':['Show videos as cards with thumbnails.','Mostre os vídeos em cartões com miniaturas.'],
 'media-list':['Show videos in a compact table.','Mostre os vídeos numa tabela compacta.'],
 'backup-export':['Export an encrypted backup of the selected project/settings. A password is required.','Exporte uma cópia de segurança cifrada do projeto ou definições selecionados. É necessária uma palavra-passe.'],
 'backup-restore':['Restore an encrypted backup. Review which project or settings it will replace.','Restaure uma cópia cifrada. Reveja o projeto ou as definições que serão substituídos.'],
 'import-project':['Import a project configuration and review its video references and channels.','Importe uma configuração de projeto e reveja as referências dos vídeos e os canais.'],
 'test-email':['Send a real test email using the SMTP settings you saved.','Envie um email de teste real com as definições SMTP guardadas.'],
 'check-updates':['Check the configured signed update feed.','Verifique o canal de atualizações assinado que foi configurado.'],
 'download-update':['Download the verified update package to this computer.','Descarregue o pacote de atualização verificado para este computador.'],
 'reconnect':['Reconnect to the local application engine and refresh its status.','Volte a ligar ao motor local e atualize o estado.'],
 'go-tools':['Open local testing and video preparation tools.','Abra as ferramentas de teste local e preparação de vídeos.'],
 'clear-history':['Clear activity records after confirmation.','Limpe os registos de atividade após confirmar.'],
 'clear-schedules':['Review the confirmation before removing schedules.','Reveja a confirmação antes de remover os agendamentos.']
};
const capture={
 preview:['Open the camera, screen or microphone preview. Preview alone never broadcasts.','Abra a pré-visualização da câmara, ecrã ou microfone. A pré-visualização, por si só, nunca transmite.'],
 start:['Start sending the current preview to the selected platforms after your confirmation.','Comece a enviar a pré-visualização para as plataformas selecionadas após confirmar.'],
 stop:['Stop all live destinations from this capture. Independent local recording can continue.','Pare todos os destinos desta captação ao vivo. A gravação local independente pode continuar.'],
 release:['Close the preview and release its devices. Any live output or recording using this capture must end.','Feche a pré-visualização e liberte os dispositivos. As emissões e a gravação que usam esta captação têm de terminar.'],
 mute:['Turn microphone sound off or back on without changing the selected destinations.','Desligue ou volte a ligar o som do microfone sem mudar os destinos selecionados.']
};
const production={
 record:['Record the composed picture and mixed sound on this computer. This does not start a public broadcast.','Grave a imagem composta e o som misturado neste computador. Isto não inicia uma transmissão pública.'],
 'stop-record':['Finish the local recording and save its playable file in the chosen folder. Live destinations continue.','Termine a gravação e guarde o ficheiro na pasta escolhida. Os destinos ao vivo continuam.'],
 'choose-recording-folder':['Choose where recording files will be written. Choosing a folder does not start recording.','Escolha onde serão escritos os ficheiros. Escolher uma pasta não inicia a gravação.'],
 'save-recording-preferences':['Remember the folder and whether to ask again before each recording.','Guarde a pasta e a opção de voltar a perguntar antes de cada gravação.'],
 recover:['Try to finalize the interrupted recording using its preserved local data.','Tente finalizar a gravação interrompida usando os dados locais preservados.'],
 'save-scene':['Save the current appearance in the selected scene on this browser profile.','Guarde o aspeto atual na cena selecionada, neste perfil do navegador.'],
 'load-scene':['Load the selected saved appearance into the studio.','Carregue no estúdio o aspeto guardado da cena selecionada.'],
 'clear-images':['Remove your selected logo and background image from the studio composition.','Remova o logótipo e a imagem de fundo que selecionou para a composição do estúdio.'],
 'play-clip':['Replace the live picture with the selected local clip and its sound until it ends.','Substitua a imagem ao vivo pelo clip local e respetivo som até terminar.'],
 'stop-clip':['End the clip and return to the live picture and sound.','Termine o clip e regresse à imagem e ao som ao vivo.'],
 snapshot:['Save the current composed preview as a PNG image.','Guarde a pré-visualização composta atual como imagem PNG.'],
 teleprompter:['Start or pause scrolling your private notes. Notes are not drawn into the broadcast.','Inicie ou pause o movimento das notas privadas. As notas não são desenhadas na transmissão.']
};
const routes={
 dashboard:['See status and choose between live capture and prepared videos.','Veja o estado e escolha entre captação ao vivo e vídeos preparados.'],
 capture:['Open the studio for camera, screen or microphone-only capture and optional local recording.','Abra o estúdio para câmara, ecrã ou apenas microfone, com gravação local opcional.'],
 golive:['Prepare prerecorded videos or playlists for your configured channels.','Prepare vídeos pré-gravados ou playlists para os canais configurados.'],
 live:['Monitor active transmissions and use their stop, pause and recovery controls.','Acompanhe as transmissões ativas e use os controlos de paragem, pausa e recuperação.'],
 chat:['Read connected platform chats and reply to the selected conversation.','Leia os chats ligados e responda à conversa selecionada.'],
 media:['Add, find and preview your videos and video links.','Adicione, procure e pré-visualize vídeos e ligações de vídeo.'],
 playlists:['Organize videos into ordered, optionally repeating programmes.','Organize os vídeos em programas ordenados, com repetição opcional.'],
 channels:['Manage platform destinations, servers and protected stream keys.','Gira os destinos, servidores e chaves de transmissão protegidas.'],
 schedules:['Choose future transmission times and check which schedules are active.','Escolha horários futuros e confirme quais os agendamentos ativos.'],
 tools:['Test playback locally and prepare compatible video copies.','Teste a reprodução local e prepare cópias compatíveis dos vídeos.'],
 history:['Review finished transmissions and activity records.','Consulte transmissões terminadas e registos de atividade.'],
 settings:['Configure output quality, operation, backups and optional integrations.','Configure a qualidade de saída, a operação, as cópias de segurança e as integrações opcionais.'],
 help:['Open the application guide and platform setup information.','Abra o guia da aplicação e a informação de configuração das plataformas.']
};
const chat={
 reply:['Select this message as the reply target, then write and send your response.','Selecione esta mensagem como destino da resposta; depois escreva e envie o texto.'],
 feature:['Show this comment in the live studio picture.','Mostre este comentário na imagem do estúdio ao vivo.'],
 'hide-featured':['Remove the featured comment from the studio picture.','Retire o comentário destacado da imagem do estúdio.'],
 'cancel-reply':['Clear the selected reply target while keeping the draft text.','Retire o destino da resposta, mantendo o texto do rascunho.'],
 filter:['Choose which connected chats to display. This changes only the view.','Escolha os chats ligados a apresentar. Isto altera apenas a vista.'],
 authorize:['Authorize your chat account on its platform. This does not start a broadcast.','Autorize a sua conta de chat na plataforma. Isto não inicia uma transmissão.'],
 'disconnect-account':['Disconnect this chat account from the local studio.','Desligue esta conta de chat do estúdio local.'],
 'disconnect-chat':['Stop reading this conversation. Video transmissions continue.','Deixe de receber esta conversa. As transmissões de vídeo continuam.']
};
const fields={
 name:['Choose a descriptive name so you can recognize this item later.','Escolha um nome descritivo para reconhecer este elemento mais tarde.'],
 title:['Set the title requested by this form.','Defina o título pedido neste formulário.'],
 url:['Enter the requested server or content address. Keep stream keys in their separate field.','Indique o endereço do servidor ou conteúdo pedido. Coloque as chaves no respetivo campo separado.'],
 host:['Enter the SMTP server supplied by your email provider.','Indique o servidor SMTP fornecido pelo seu serviço de email.'],
 port:['Use the port and connection security specified by your email provider.','Use a porta e a segurança de ligação indicadas pelo seu serviço de email.'],
 security:['Select the TLS connection mode required by your email provider.','Selecione o modo de ligação TLS exigido pelo seu serviço de email.'],
 username:['Enter the account username required by the configured service.','Indique o nome de utilizador exigido pelo serviço configurado.'],
 from:['Set the sender address authorized by your email provider.','Defina o remetente autorizado pelo seu serviço de email.'],
 to:['Set the email address that should receive the notifications.','Defina o endereço que deve receber as notificações.'],
 loop:['Repeat this playlist until its transmission is stopped.','Repita esta playlist até parar a transmissão.'],
 endOnVideoFailure:['Stop the programme when a video fails, instead of skipping unavailable content.','Termine o programa quando um vídeo falhar, em vez de saltar conteúdo indisponível.'],
 pauseOnDisconnect:['Pause this prepared-video transmission after a lost connection so it can be resumed.','Pause esta emissão de vídeos preparados após perder a ligação, para a poder retomar.'],
 source:['Choose camera, screen, both, or microphone only. Microphone only never requests a camera.','Escolha câmara, ecrã, ambos ou apenas microfone. Apenas microfone nunca pede acesso à câmara.'],
 camera:['Choose the camera for the next preview. Close the current preview before changing devices.','Escolha a câmara da próxima pré-visualização. Feche a pré-visualização atual antes de mudar os dispositivos.'],
 microphone:['Choose the microphone for the next preview.','Escolha o microfone da próxima pré-visualização.'],
 useMic:['Include microphone audio. In microphone-only mode it stays included; use mute to silence it.','Inclua o som do microfone. No modo Apenas microfone permanece incluído; use Silenciar para cortar o som.'],
 systemAudio:['Request sound from the shared screen or tab when the system supports it.','Peça som do ecrã ou separador partilhado quando o sistema o permitir.'],
 quality:['Choose 720p or 1080p. Higher resolution needs more processing and upload capacity.','Escolha 720p ou 1080p. Mais resolução exige mais processamento e capacidade de upload.'],
 aspect:['Choose the picture shape: horizontal, vertical or another available ratio.','Escolha o formato da imagem: horizontal, vertical ou outra proporção disponível.'],
 recordingDirectory:['Recording data and finished files are written directly to this folder.','Os dados da gravação e os ficheiros concluídos são escritos diretamente nesta pasta.'],
 askRecordingFolder:['Keep this on to choose a folder before every recording. Turn it off and save to reuse the default folder.','Ative para escolher a pasta antes de cada gravação. Desative e guarde para reutilizar a pasta predefinida.'],
 layout:['Choose how available camera and screen pictures share the video frame.','Escolha como as imagens disponíveis da câmara e do ecrã ocupam o vídeo.'],
 background:['Choose the background colour, also used for microphone-only broadcasts.','Escolha a cor de fundo, também usada nas emissões apenas com microfone.'],
 backgroundImage:['Choose a local picture to use as the studio background.','Escolha uma imagem local para usar como fundo do estúdio.'],
 logo:['Choose your own image for the studio composition.','Escolha a sua imagem para a composição do estúdio.'],
 mirror:['Flip the camera picture horizontally.','Inverta a imagem da câmara na horizontal.'],
 micVolume:['Adjust microphone volume. Muting the microphone still takes priority.','Ajuste o volume do microfone. Silenciar o microfone continua a ter prioridade.'],
 screenVolume:['Adjust the volume of captured screen or tab sound.','Ajuste o volume do som captado do ecrã ou separador.'],
 notes:['Keep private presenter notes here. They are not included in the broadcast picture.','Guarde aqui notas privadas do apresentador. Não são incluídas na imagem transmitida.'],
 scene:['Choose the scene to save or load.','Escolha a cena que pretende guardar ou carregar.'],
 clipFile:['Choose a local MP4 or WebM clip. It plays only when you press the clip playback button.','Escolha um clip local MP4 ou WebM. Só é reproduzido quando carrega no botão de reprodução do clip.'],
 videoBitrate:['Set the video data rate. More bitrate uses more upload capacity and recording space.','Defina a taxa de dados do vídeo. Mais bitrate usa mais upload e espaço nas gravações.'],
 audioBitrate:['Set the audio data rate for encoding.','Defina a taxa de dados usada na codificação do áudio.'],
 fps:['Set frames per second for the selected encoding profile.','Defina os fotogramas por segundo do perfil de codificação.'],
 copy:['Keep source resolution and frame rate when no configured overlays require the selected profile. Bitrates still apply.','Mantenha a resolução e os fps da origem quando as sobreposições configuradas não exigirem o perfil selecionado. Os bitrates continuam a aplicar-se.'],
 maxConcurrent:['Limit simultaneous transmissions and local tests. Zero removes the application limit, not the computer’s physical limits.','Limite as transmissões e os testes simultâneos. Zero retira o limite da aplicação, mantendo os limites físicos do computador.'],
 historyLimit:['Set how many activity records to retain. Saving a lower limit removes older records.','Defina quantos registos de atividade conservar. Guardar um limite menor remove registos antigos.'],
 persistSchedules:['Allow already-activated future schedules to stay active after reopening the application.','Permita que os agendamentos futuros já ativados se mantenham ativos ao reabrir a aplicação.'],
 ffmpeg:['Leave empty to use the included FFmpeg. Enter a custom absolute path only when needed.','Deixe vazio para usar o FFmpeg incluído. Indique um caminho absoluto personalizado apenas se necessário.'],
 ffprobe:['Leave empty to use the included FFprobe for inspecting media.','Deixe vazio para usar o FFprobe incluído na análise dos vídeos.'],
 ytdlp:['Leave empty to use the included video downloader.','Deixe vazio para usar o descarregador de vídeos incluído.'],
 key:['Enter the platform stream key. Existing protected keys are kept when this field is left empty.','Introduza a chave de transmissão da plataforma. Uma chave protegida existente é mantida se deixar este campo vazio.'],
 password:['Enter the password required by this form. Existing stored passwords are never shown here.','Introduza a palavra-passe pedida neste formulário. As palavras-passe já guardadas nunca são apresentadas aqui.'],
 countdown:['Choose the delay before transmission starts.','Escolha o intervalo antes de a transmissão começar.'],
 autoRestart:['Repeat the programme automatically when it reaches the end.','Repita automaticamente o programa quando chegar ao fim.'],
 autoReconnect:['Try to recover an interrupted destination connection.','Tente recuperar uma ligação interrompida ao destino.'],
 confirmed:['Review the content and destinations before authorizing the operation.','Reveja o conteúdo e os destinos antes de autorizar a operação.'],
 timeZone:['Select the time zone used to interpret the scheduled date and time.','Selecione o fuso horário usado para interpretar a data e a hora do agendamento.']
};
const forms={
 'capture-form':capture.preview,
 'settings-form':['Save custom tool paths. Empty paths use the included tools.','Guarde os caminhos personalizados. Os campos vazios usam as ferramentas incluídas.'],
 'encoding-form':['Save the output profile for new transmissions and local tests. Running sessions keep their current profile.','Guarde o perfil de saída para novas transmissões e testes. As sessões em curso mantêm o perfil atual.'],
 'operation-form':['Save capacity, activity retention and schedule persistence preferences.','Guarde a capacidade, a retenção de registos e a persistência dos agendamentos.'],
 'notification-form':['Save email notification settings. The separate test button sends an actual email.','Guarde as notificações por email. O botão de teste separado envia um email real.'],
 'update-form':['Save the trusted update feed and verification key.','Guarde o canal de atualizações e a chave de verificação de confiança.']
};

export function helpFor(control){
 if(!control)return '';
 const d=control.dataset||{},form=control.form||control.closest?.('form');
 if(d.help)return d.help;
 let value=say(actions[d.action]||capture[d.capture]||production[d.production]);
 if(d.capture==='start'&&control.disabled)value=control.closest?.('.live-capture-studio')?.querySelector('[data-capture="stop"]')?.disabled===false?uiText('This capture is already broadcasting. Use Stop all live destinations to finish it.','Esta captação já está em transmissão. Use Parar todos os destinos ao vivo para terminar.'):uiText('Open a preview, select at least one free destination and tick the broadcast confirmation first.','Abra a pré-visualização, selecione pelo menos um destino livre e marque a confirmação da transmissão.');
 if(d.production==='record'&&control.disabled)value=uiText('Open a preview first. Finish the current recording or folder operation before starting another.','Abra primeiro a pré-visualização. Termine a gravação ou a escolha da pasta em curso antes de iniciar outra.');
 if(value)return value;
 if(d.chat)return say(chat[d.chat])||uiText('Manage the selected platform chat.','Gira o chat da plataforma selecionada.');
 if(d.secret)return uiText('Show or hide only the value you entered. This does not reveal an existing stored secret.','Mostre ou oculte apenas o valor que introduziu. Isto não revela um segredo já guardado.');
 if('move' in d)return uiText('Move this video one position in the playlist. Save the form to keep the new order.','Mova este vídeo uma posição na playlist. Guarde o formulário para manter a nova ordem.');
 if('remove' in d)return uiText('Remove this occurrence from the playlist. The library video is kept. Save to apply.','Retire esta ocorrência da playlist. O vídeo fica na biblioteca. Guarde para aplicar.');
 const id=control.id||'',name=control.name||'';
 if(id==='add-media-button')return uiText('Append the selected video to the playlist. The same video can appear more than once.','Adicione o vídeo selecionado ao fim da playlist. Pode adicionar o mesmo vídeo várias vezes.');
 if(control.classList?.contains('close')||control.classList?.contains('cancel'))return uiText('Close this window and discard unsaved edits. An operation already submitted continues.','Feche esta janela e descarte as alterações por guardar. Uma operação já submetida continua.');
 if(id==='exit')return uiText('Close the studio. Active operations must be stopped before it exits.','Encerre o estúdio. As operações ativas têm de parar antes de sair.');
 if(id==='sidebar-toggle')return uiText('Expand or collapse the menu. Every section remains available.','Expanda ou recolha o menu. Todas as secções continuam disponíveis.');
 if(id==='language-select')return uiText('Change the interface language. Save open edits before switching.','Mude o idioma da interface. Guarde as alterações abertas antes de mudar.');
 if(d.pageKey||d.pageSize)return uiText('Change the displayed results page or the number of results per page.','Mude a página de resultados ou a quantidade de resultados por página.');
 if(d.filter||id==='search'||id==='downloads-search')return uiText('Filter the displayed results without changing saved media or transmissions.','Filtre os resultados apresentados sem alterar os vídeos guardados ou as transmissões.');
 if(fields[name])return say(fields[name]);
 const href=control.getAttribute?.('href')||'';
 if(href.startsWith('#')&&routes[href.slice(1)])return say(routes[href.slice(1)]);
 if(href==='/api/export')return uiText('Download the project configuration without stream keys. Video files are not included.','Transfira a configuração do projeto sem chaves de transmissão. Os ficheiros de vídeo não são incluídos.');
 if(href.startsWith('/api/recordings/'))return uiText('Download a copy of this completed local recording. Its original stays in the recording folder.','Transfira uma cópia desta gravação concluída. O original fica na pasta das gravações.');
 if(href.startsWith('https://')||href.startsWith('http://'))return uiText('Open this address in the browser. This does not start a transmission.','Abra este endereço no navegador. Isto não inicia uma transmissão.');
 if(control.tagName==='SUMMARY')return uiText('Expand or collapse this group of optional settings. Your current selections are retained.','Expanda ou recolha este grupo de opções. As seleções atuais são mantidas.');
 if(control.tagName==='BUTTON'&&control.type==='submit'){
  if(form?.classList?.contains('chat-compose'))return uiText('Send this message to the selected platform conversation. Viewers of that chat can see it.','Envie esta mensagem à conversa da plataforma selecionada. Os participantes desse chat podem vê-la.');
  if(forms[form?.id])return say(forms[form.id]);
  const hint=form?.querySelector?.('.form-hint')?.textContent?.trim();
  return hint||uiText('Review the choices in this form, then save or confirm them.','Reveja as escolhas deste formulário e guarde ou confirme.');
 }
 if(['INPUT','SELECT','TEXTAREA'].includes(control.tagName))return uiText('Set this option before saving or starting the operation. Its label describes the value to enter.','Defina esta opção antes de guardar ou iniciar a operação. A etiqueta indica o valor a introduzir.');
 return control.getAttribute?.('title')||control.getAttribute?.('aria-label')||'';
}

export function tooltipPosition(anchor,size,viewport){
 const gap=10,pad=12,width=Math.min(size.width,Math.max(1,viewport.width-pad*2)),height=Math.min(size.height,Math.max(1,viewport.height-pad*2));
 const left=Math.max(pad,Math.min(anchor.left+(anchor.width-width)/2,viewport.width-width-pad));
 let top=anchor.bottom+gap;if(top+height>viewport.height-pad)top=anchor.top-height-gap;
 return {left,top:Math.max(pad,Math.min(top,viewport.height-height-pad))};
}

const installations=new WeakMap();
export function installContextHelp(doc=globalThis.document,win=globalThis.window){
 if(!doc?.body||!doc.createElement||!win?.addEventListener)return null;
 if(installations.has(doc))return installations.get(doc);
 const tip=doc.createElement('div');tip.id='control-help';tip.setAttribute('role','tooltip');tip.hidden=true;doc.body.appendChild(tip);
 let active=null,originalTitle=null,generatedLabel=null,showTimer,hideTimer,blocked=null,positionRule,pointerTarget=null;
 const clear=()=>{win.clearTimeout(showTimer);win.clearTimeout(hideTimer);showTimer=hideTimer=null;};
 function hide(){
  clear();tip.hidden=true;
  if(active){
   const ids=(active.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);
   if(ids.length)active.setAttribute('aria-describedby',ids.join(' '));else active.removeAttribute('aria-describedby');
   if(originalTitle!==null&&!active.hasAttribute('title'))active.setAttribute('title',originalTitle);
   if(generatedLabel!==null&&active.getAttribute('aria-label')===generatedLabel)active.removeAttribute('aria-label');
  }
  active=null;originalTitle=null;generatedLabel=null;
 }
 function show(control){
  clear();const content=helpFor(control);if(!content||!control.isConnected)return;
  if(active===control&&!tip.hidden){tip.textContent=content;return;}
  hide();active=control;originalTitle=control.getAttribute('title');
  if(originalTitle!==null){if(!control.getAttribute('aria-label')&&!control.textContent.trim()){generatedLabel=originalTitle;control.setAttribute('aria-label',generatedLabel);}control.removeAttribute('title');}
  const parent=control.closest('dialog[open]')||doc.body;if(tip.parentNode!==parent)parent.appendChild(tip);
  tip.textContent=content;tip.hidden=false;
  const ids=new Set((control.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));ids.add(tip.id);control.setAttribute('aria-describedby',[...ids].join(' '));
  position();
 }
 function position(){
  if(!active||tip.hidden)return;
  // Change an existing external stylesheet rule; no inline styles or CSP exception.
  if(!positionRule)for(const sheet of doc.styleSheets)try{positionRule=[...sheet.cssRules].find(rule=>rule.selectorText==='#control-help');if(positionRule)break;}catch{}
  if(positionRule){const viewport={width:doc.documentElement?.clientWidth||win.innerWidth,height:win.innerHeight};positionRule.style.setProperty('max-width',Math.max(1,Math.min(360,viewport.width-24))+'px');positionRule.style.setProperty('max-height',Math.max(1,viewport.height-24)+'px');const point=tooltipPosition(active.getBoundingClientRect(),tip.getBoundingClientRect(),viewport);positionRule.style.setProperty('left',point.left+'px');positionRule.style.setProperty('top',point.top+'px');}
 }
 const target=event=>event.target?.closest?.('button,a,input,select,textarea,summary,[data-help]');
 const laterHide=()=>{win.clearTimeout(hideTimer);hideTimer=win.setTimeout(()=>{if(doc.activeElement!==active)hide();},160);};
 doc.addEventListener('pointerover',event=>{
  if(event.pointerType==='touch'||tip.contains(event.target)){win.clearTimeout(hideTimer);return;}
  const control=target(event);if(!control||control===blocked||!helpFor(control))return;
  pointerTarget=control;clear();showTimer=win.setTimeout(()=>show(control),350);
 });
 doc.addEventListener('pointerout',event=>{
  const next=event.relatedTarget;
  if(blocked&&!blocked.contains(next))blocked=null;
  if(active&&(active.contains(next)||tip.contains(next)))return;
  pointerTarget=null;
  if(tip.contains(event.target)||active?.contains(event.target))laterHide();else win.clearTimeout(showTimer);
 });
 doc.addEventListener('focusin',event=>{const control=target(event);if(control&&control!==blocked)show(control);});
 doc.addEventListener('focusout',event=>{if(blocked?.contains(event.target))blocked=null;if(active?.contains(event.target))hide();});
 doc.addEventListener('pointerdown',event=>{if(!tip.contains(event.target))hide();},true);
 doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!tip.hidden){blocked=active;event.preventDefault();event.stopPropagation();hide();}},true);
 doc.addEventListener('close',hide,true);doc.addEventListener('scroll',event=>{if(!tip.contains(event.target))hide();},true);win.addEventListener('resize',hide);win.addEventListener('blur',hide);
 const observer=typeof win.MutationObserver==='function'?new win.MutationObserver(()=>{if(active&&!active.isConnected)hide();else if(active&&!tip.hidden){const content=helpFor(active)||originalTitle||'';if(content!==tip.textContent){tip.textContent=content;position();}}}):null;observer?.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
 const installed={hide,tip,isReading:()=>Boolean((pointerTarget?.isConnected&&(showTimer||(!tip.hidden&&active===pointerTarget)))||(!tip.hidden&&active===doc.activeElement))};installations.set(doc,installed);return installed;
}
