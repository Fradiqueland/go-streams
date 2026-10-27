GO STREAMS vVERSION - MAC PORTABLE

ABERTURA DIRETA
No Mac, extraia o ZIP e abra Mac-Portable/GoStreams.app com um duplo clique.
O Finder apresenta a app como um unico programa. Todos os seus recursos e
runtimes estao dentro do pacote .app; nao e preciso instalar dependencias.
Nao abra nem copie apenas o executavel dentro de Contents/MacOS.

IMPORTACAO NO CONSTRUTOR
1. No construtor: Software portable > Escolher pasta > Mac-Portable.
2. Em Programa para Mac, selecione GoStreams.app e guarde o modulo.
3. Exporte o produto para Mac. A versao Windows usa a sua entrada Windows existente.
4. No Mac, o modulo abre GoStreams.app numa janela propria do sistema/browser.
   Pode tambem abrir GoStreams.app diretamente de uma pasta local, sem DMG.

Intel e Apple Silicon: o iniciador nativo e universal e escolhe os componentes
incluidos para o processador. Nao necessita de Rosetta, Node.js, Electron,
FFmpeg, FFprobe ou yt-dlp instalados separadamente. Usa o browser do sistema.
Requer macOS 13.5 ou posterior.

EXTRACAO NO MAC
Extraia o ZIP completo pelo Finder ou pelo Terminal:
  ditto -x -k "GoStreams-vVERSION-Mac-Portable.zip" "$HOME/Downloads/GoStreams-Portable"
Nao retire ficheiros de dentro de GoStreams.app. Nao renomeie pastas internas.
O ZIP regista as permissoes Unix, diretorios e ligacoes simbolicas existentes.

IMPORTACAO NUM CONSTRUTOR WINDOWS
Extraia a pasta Mac-Portable completa e selecione-a; nao selecione o DMG nem
apenas Contents/MacOS/GoStreams. A entrada correta e GoStreams.app.
O Windows nao representa os bits de execucao Unix como um Mac. A importacao
pelo Windows depende de o construtor preservar/restaurar essas permissoes ao
exportar. Se o construtor avisar que as perdeu ou bloquear a exportacao, use
a versao corrigida do construtor ou extraia e importe o ZIP diretamente num Mac.
O ficheiro mac-portable-manifest.json regista os modos e os hashes originais;
nao substitui suporte a permissoes no construtor. Nao remova assinaturas para
contornar erros. Esta aplicacao ainda nao tem assinatura Developer ID/notarizacao.

DADOS E FUNCIONAMENTO
Definicoes, sessoes e chaves ficam em:
  ~/Library/Application Support/Go Streams
Os videos locais mantem-se nos caminhos originais. A pasta entregue nao inclui
os seus projetos pessoais nem copias de videos. Ficheiros externos usados por
um projeto precisam de continuar acessiveis no Mac.
Encerrar Go Streams termina o motor; fechar apenas a janela pode deixa-lo ativo.

VALIDACAO
Integridade, recursos, dois processadores e permissoes do ZIP verificados.
A abertura nativa num Mac e a execucao do produto final do construtor ainda
nao foram testadas neste ambiente Windows. Nao e uma certificacao Mac.

Criado por Antonio Fradique
https://AntonioFradique.net
